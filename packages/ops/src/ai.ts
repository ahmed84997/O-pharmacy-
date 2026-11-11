import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { OpsError } from './requests';

/** Whatever answers the questions (a hosted model). The platform never depends on one vendor: the provider is injected. */
export interface AiProvider { readonly model: string; complete(system: string, user: string): Promise<string> }
export class FakeAiProvider implements AiProvider { calls: { system: string; user: string }[] = []; constructor(public reply = 'ok', public readonly model = 'fake', public fail = false) {} async complete(system: string, user: string): Promise<string> { this.calls.push({ system, user }); if (this.fail) throw new Error('provider down'); return this.reply; } }
export type AiKind = 'day_summary' | 'shortage_insight';
export interface AiRules { dailyLimit: number; timeZone: string }
export const DEFAULT_AI_RULES: AiRules = { dailyLimit: 20, timeZone: 'Africa/Cairo' };
const SYSTEM = 'أنت مساعد عمليات لصيدلية. اكتب بالعربية المصرية، باختصار، في نقاط قليلة. استخدم الأرقام المعطاة فقط ولا تخترع أرقاما. لا تعطي نصيحة طبية.';

/** The operations assistant. It only ever sees aggregate numbers and item names (never a customer, an employee or a phone number), and every run is recorded (who, what was sent, what came back, which model). A person can run a limited number per day. A provider failure is recorded and reported; nothing else in the system depends on the AI. */
export class AiService {
  constructor(private hub: Hub, private provider: AiProvider, private rules: AiRules = DEFAULT_AI_RULES) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  private n(sql: string, ...a: unknown[]): number { return Number(this.db.prepare(sql).get(...a)?.n ?? 0); }
  /** The numbers the assistant works from. Only counts and item names. */
  snapshot(): Record<string, unknown> {
    const now = Date.parse(this.hub.now()); const today = new Intl.DateTimeFormat('en-CA', { timeZone: this.rules.timeZone }).format(new Date(now)); const days = (d: number) => new Date(now - d * 86400000).toISOString(); const by = (kind: string) => Object.fromEntries(this.db.prepare('SELECT i.status s, COUNT(*) n FROM request_items i JOIN requests r ON r.id=i.request_id WHERE r.kind=? GROUP BY i.status').all(kind).map(r => [String(r.s), Number(r.n)]));
    return {
      customerItemsByStatus: by('customer_request'), shortageItemsByStatus: by('shortage'),
      customersNotCollectedFor7Days: this.n("SELECT COUNT(*) n FROM request_items WHERE status='notified' AND updated_at<=?", days(7)),
      openTasks: this.n("SELECT COUNT(*) n FROM staff_tasks WHERE status='open'"), overdueTasks: this.n("SELECT COUNT(*) n FROM staff_tasks WHERE status='open' AND due_date IS NOT NULL AND due_date<?", today),
      attendanceToday: { present: this.n("SELECT COUNT(*) n FROM attendance_days WHERE work_date=? AND status='present'", today), lateMinutes: this.n('SELECT COALESCE(SUM(late_minutes),0) n FROM attendance_days WHERE work_date=?', today), overtimeWaiting: this.n("SELECT COUNT(*) n FROM attendance_days WHERE overtime_status='pending'"), leaveWaiting: this.n("SELECT COUNT(*) n FROM leave_requests WHERE status='pending'") },
      ordersInProgress: this.n('SELECT COUNT(*) n FROM (SELECT po_id FROM order_stages GROUP BY po_id HAVING COUNT(*) < 6)'),
      topShortages30d: this.db.prepare("SELECT i.item_name name, COUNT(*) times FROM request_items i JOIN requests r ON r.id=i.request_id WHERE r.kind='shortage' AND i.created_at>=? GROUP BY i.item_name ORDER BY times DESC, name LIMIT 5").all(days(30)).map(r => ({ item: String(r.name), times: Number(r.times) })),
    };
  }
  async assist(actor: Person, kind: AiKind): Promise<{ id: string; text: string }> {
    this.need(actor, 'ai.assistant.use'); const today = this.hub.now().slice(0, 10);
    if (this.n('SELECT COUNT(*) n FROM ai_runs WHERE person_id=? AND at>=?', actor.id, `${today}T00:00:00.000Z`) >= this.rules.dailyLimit) throw new OpsError('state', 'daily AI limit reached');
    const snap = this.snapshot(); const input = JSON.stringify(kind === 'shortage_insight' ? { shortageItemsByStatus: snap.shortageItemsByStatus, topShortages30d: snap.topShortages30d } : snap);
    const ask = kind === 'day_summary' ? 'لخّص حالة الشغل النهارده وقولي أهم 3 حاجات أتابعها.' : 'بصّ على النواقص دي وقولي إيه الأصناف اللي لازم أطلبها بكميات أكبر ولماذا.';
    const id = uuidv7(); let text: string | null = null; let error: string | null = null;
    try { text = await this.provider.complete(SYSTEM, `${ask}\n${input}`); } catch (e) { error = (e as Error).message || 'failed'; }
    this.db.tx(() => { this.db.prepare('INSERT INTO ai_runs(id,person_id,kind,input,output,status,model,error,at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, actor.id, kind, input, text, error ? 'failed' : 'ok', this.provider.model, error, this.hub.now()); this.hub.audit(actor.id, 'ai.run', 'ai_run', id, { kind, status: error ? 'failed' : 'ok' }); });
    if (error || text === null) throw new OpsError('state', 'the assistant is not available right now');
    return { id, text };
  }
  runs(actor: Person, limit = 20) { this.need(actor, 'ai.assistant.use'); return this.db.prepare('SELECT id, kind, status, model, at FROM ai_runs WHERE person_id=? ORDER BY seq DESC LIMIT ?').all(actor.id, Math.min(limit, 100)).map(r => ({ id: String(r.id), kind: String(r.kind), status: String(r.status), model: String(r.model), at: String(r.at) })); }
}
