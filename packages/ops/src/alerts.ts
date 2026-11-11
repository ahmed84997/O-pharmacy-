import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { OpsError } from './requests';

const LEAD = ['O', 'A', 'M'];
export type AlertCategory = 'customer_requests' | 'orders' | 'attendance' | 'tasks' | 'system';
export interface Alert { id: string; category: AlertCategory; title: string; body: string | null; ref: string | null; createdAt: string; read: boolean }
export interface AlertRules { notifyHours: number; waitingDays: number; orderStallHours: number; openShiftHours: number }
export const DEFAULT_ALERT_RULES: AlertRules = { notifyHours: 4, waitingDays: 7, orderStallHours: 24, openShiftHours: 14 };

/** The staff notification centre: alerts for a person, grouped by category, read or unread, never deleted. `scan` looks for things that need someone (a customer not told, a customer who never came, an order stuck in a stage, an overdue task, overtime or leave waiting, a shift left open) and creates one alert per thing and person: scanning again never repeats an alert. Managers to alert are passed in (the people list lives outside this package). */
export class AlertService {
  constructor(private hub: Hub, private rules: AlertRules = DEFAULT_ALERT_RULES) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  /** Add an alert for one person. The dedupe key (optional) makes it happen only once. Returns false when it already existed. */
  push(personId: string, a: { category: AlertCategory; title: string; body?: string; ref?: string; dedupeKey?: string }): boolean {
    const key = a.dedupeKey ? `${a.dedupeKey}:${personId}` : null; if (key && this.db.prepare('SELECT 1 FROM alerts WHERE dedupe_key=?').get(key)) return false;
    this.db.prepare('INSERT INTO alerts(id,person_id,category,title,body,ref,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uuidv7(), personId, a.category, a.title, a.body ?? null, a.ref ?? null, key, this.hub.now()); return true;
  }
  inbox(actor: Person, o: { category?: AlertCategory; unreadOnly?: boolean; limit?: number } = {}): Alert[] {
    this.need(actor, 'notification.view');
    return this.db.prepare('SELECT * FROM alerts WHERE person_id=? AND (? IS NULL OR category=?) AND (? = 0 OR read_at IS NULL) ORDER BY seq DESC LIMIT ?').all(actor.id, o.category ?? null, o.category ?? null, o.unreadOnly ? 1 : 0, Math.min(o.limit ?? 50, 200))
      .map(r => ({ id: String(r.id), category: r.category as AlertCategory, title: String(r.title), body: (r.body as string) ?? null, ref: (r.ref as string) ?? null, createdAt: String(r.created_at), read: r.read_at !== null }));
  }
  unread(actor: Person): Record<string, number> { this.need(actor, 'notification.view'); const out: Record<string, number> = {}; for (const r of this.db.prepare('SELECT category, COUNT(*) n FROM alerts WHERE person_id=? AND read_at IS NULL GROUP BY category').all(actor.id)) out[String(r.category)] = Number(r.n); return out; }
  markRead(actor: Person, id: string): void { this.need(actor, 'notification.view'); const r = this.db.prepare('SELECT person_id FROM alerts WHERE id=?').get(id); if (!r || r.person_id !== actor.id) throw new OpsError('not-found', 'alert'); this.db.prepare('UPDATE alerts SET read_at=? WHERE id=? AND read_at IS NULL').run(this.hub.now(), id); }
  markAllRead(actor: Person, category?: AlertCategory): number { this.need(actor, 'notification.view'); return Number(this.db.prepare('UPDATE alerts SET read_at=? WHERE person_id=? AND read_at IS NULL AND (? IS NULL OR category=?)').run(this.hub.now(), actor.id, category ?? null, category ?? null).changes); }
  /** Look for what needs attention and create the alerts. Returns how many new alerts were made per category. */
  scan(actor: Person, managers: string[]): Record<string, number> {
    this.need(actor, 'notification.send'); if (!actor.roles.some(r => LEAD.includes(r))) throw new OpsError('forbidden', 'only a manager may run the scan');
    const out: Record<string, number> = {}; const add = (cat: AlertCategory, ok: boolean) => { if (ok) out[cat] = (out[cat] ?? 0) + 1; }; const now = Date.parse(this.hub.now()); const ago = (h: number) => new Date(now - h * 3600000).toISOString();
    return this.db.tx(() => {
      for (const r of this.db.prepare("SELECT i.id, i.item_name, i.status, rq.ref, rq.owner_id FROM request_items i JOIN requests rq ON rq.id=i.request_id WHERE rq.kind='customer_request' AND ((i.status='ready_to_notify' AND i.updated_at<=?) OR (i.status='notified' AND i.updated_at<=?))").all(ago(this.rules.notifyHours), ago(this.rules.waitingDays * 24)))
        add('customer_requests', r.status === 'ready_to_notify' ? this.push(String(r.owner_id), { category: 'customer_requests', title: `لسه محتاج تبلغ العميل: ${String(r.item_name)}`, ref: String(r.ref), dedupeKey: `tell:${String(r.id)}` }) : this.push(String(r.owner_id), { category: 'customer_requests', title: `العميل لم يستلم: ${String(r.item_name)}`, ref: String(r.ref), dedupeKey: `wait:${String(r.id)}` }));
      for (const s of this.db.prepare('SELECT po_id, MAX(at) last, COUNT(*) n FROM order_stages GROUP BY po_id HAVING n < 6 AND last <= ?').all(ago(this.rules.orderStallHours))) { const po = this.db.prepare('SELECT po_no FROM purchase_orders WHERE id=?').get(String(s.po_id)); for (const m of managers) add('orders', this.push(m, { category: 'orders', title: `طلبية واقفة في مرحلة: ${String(po?.po_no)}`, ref: String(po?.po_no), dedupeKey: `po:${String(s.po_id)}:${Number(s.n)}` })); }
      const today = this.hub.now().slice(0, 10); for (const t of this.db.prepare("SELECT id, task_no, title, assigned_to FROM staff_tasks WHERE status='open' AND due_date IS NOT NULL AND due_date < ?").all(today)) add('tasks', this.push(String(t.assigned_to), { category: 'tasks', title: `مهمة متأخرة: ${String(t.title)}`, ref: String(t.task_no), dedupeKey: `task:${String(t.id)}` }));
      for (const d of this.db.prepare("SELECT id, person_id, work_date FROM attendance_days WHERE overtime_status='pending'").all()) for (const m of managers) add('attendance', this.push(m, { category: 'attendance', title: `أوفرتايم منتظر موافقة: ${String(d.person_id)} ${String(d.work_date)}`, ref: String(d.id), dedupeKey: `ot:${String(d.id)}` }));
      for (const l of this.db.prepare("SELECT id, person_id, work_date FROM leave_requests WHERE status='pending'").all()) for (const m of managers) add('attendance', this.push(m, { category: 'attendance', title: `طلب إجازة منتظر: ${String(l.person_id)} ${String(l.work_date)}`, ref: String(l.id), dedupeKey: `leave:${String(l.id)}` }));
      for (const d of this.db.prepare('SELECT id, person_id, work_date FROM attendance_days WHERE check_in IS NOT NULL AND check_out IS NULL AND check_in <= ?').all(ago(this.rules.openShiftHours))) for (const m of managers) add('attendance', this.push(m, { category: 'attendance', title: `حضور مفتوح من وقت طويل: ${String(d.person_id)} ${String(d.work_date)}`, ref: String(d.id), dedupeKey: `open:${String(d.id)}` }));
      this.hub.audit(actor.id, 'alerts.scanned', 'alerts', 'scan', out); return out;
    });
  }
}
