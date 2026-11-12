import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type Person } from '@o-pharmacy/core';
import { FINAL_STATES } from '@o-pharmacy/ops';
import type { App } from './compose';
import { AccessError } from './access';

type B = Record<string, unknown>;

/** The alert strip's settings. Kept in app_settings under one key; these are the only defaults (nothing else in the code decides them). */
export interface TickerSettings { enabled: boolean; expiryMonths: number; showExpiry: boolean; showShortages: boolean; showReady: boolean; showLowStock: boolean }
export const TICKER_DEFAULTS: TickerSettings = { enabled: true, expiryMonths: 3, showExpiry: true, showShortages: true, showReady: true, showLowStock: true };
export const TICKER_KEY = 'ticker';

export function tickerSettings(app: App): TickerSettings {
  try { const v = JSON.parse(app.access.setting(TICKER_KEY) ?? '{}') as Partial<TickerSettings>; return { ...TICKER_DEFAULTS, ...v }; } catch { return { ...TICKER_DEFAULTS }; }
}

export type GlanceEntry =
  | { kind: 'expiry'; itemId: string; name: string; qty: number; unit: string | null; expiry: string; expired: boolean }
  | { kind: 'shortage'; ref: string; name: string; qty: number }
  | { kind: 'ready'; ref: string; name: string; customer: string | null }
  | { kind: 'low'; itemId: string; name: string; qty: number; reorder: number };

/** Sprint 7.7: what the side bar counts and the alert strip shows, in one small read. Each part only for people who may see it. */
export function glanceRoutes(s: FastifyInstance, app: App): void {
  const db = app.hub.db; const me = (q: FastifyRequest): Person => q.person!; const br = app.hub.branchId;
  const open = FINAL_STATES.map(() => '?').join(',');
  const addMonths = (today: string, m: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

  s.get('/api/glance', async (q) => {
    const p = me(q); const t = tickerSettings(app); const today = app.batches.today(); const counts: Record<string, number> = {}; const entries: GlanceEntry[] = [];
    const seesExpiry = can(p, 'expiry.alerts.view', br) || can(p, 'stock.view', br);
    if (seesExpiry) {
      const lim = addMonths(today, t.expiryMonths);
      const rows = db.prepare(`SELECT b.item_id, i.name_ar, b.expiry, (SELECT COALESCE(SUM(m.qty),0) FROM movements m WHERE m.batch_id=b.id) q,
        (SELECT u.name FROM item_units u WHERE u.item_id=i.id AND u.is_base=1 LIMIT 1) unit
        FROM batches b JOIN items i ON i.id=b.item_id WHERE b.status='active' AND b.expiry<=? AND (SELECT COALESCE(SUM(m.qty),0) FROM movements m WHERE m.batch_id=b.id) > 0 ORDER BY b.expiry LIMIT 40`).all(lim);
      counts.nearExpiry = Number(db.prepare("SELECT COUNT(*) n FROM batches b WHERE b.status='active' AND b.expiry<=? AND (SELECT COALESCE(SUM(m.qty),0) FROM movements m WHERE m.batch_id=b.id) > 0").get(lim)!.n);
      if (t.showExpiry) for (const r of rows.slice(0, 15)) entries.push({ kind: 'expiry', itemId: String(r.item_id), name: String(r.name_ar), qty: Number(r.q), unit: r.unit == null ? null : String(r.unit), expiry: String(r.expiry).slice(0, 7), expired: String(r.expiry) < today });
    }
    if (can(p, 'shortage.view', br)) {
      counts.shortages = Number(db.prepare(`SELECT COUNT(*) n FROM request_items ri JOIN requests r ON r.id=ri.request_id WHERE r.kind='shortage' AND ri.status NOT IN (${open})`).get(...FINAL_STATES)!.n);
      if (t.showShortages) for (const r of db.prepare(`SELECT r.ref, ri.item_name, ri.qty FROM request_items ri JOIN requests r ON r.id=ri.request_id WHERE r.kind='shortage' AND ri.status NOT IN (${open}) ORDER BY ri.created_at DESC LIMIT 10`).all(...FINAL_STATES))
        entries.push({ kind: 'shortage', ref: String(r.ref), name: String(r.item_name), qty: Number(r.qty) });
    }
    if (can(p, 'customer_request.create', br) || can(p, 'notification.view', br)) {
      counts.ready = Number(db.prepare("SELECT COUNT(*) n FROM request_items WHERE status='ready_to_notify'").get()!.n);
      if (t.showReady) for (const r of db.prepare("SELECT r.ref, ri.item_name, c.name customer FROM request_items ri JOIN requests r ON r.id=ri.request_id LEFT JOIN customers c ON c.id=r.customer_id WHERE ri.status='ready_to_notify' ORDER BY ri.updated_at LIMIT 10").all())
        entries.push({ kind: 'ready', ref: String(r.ref), name: String(r.item_name), customer: r.customer == null ? null : String(r.customer) });
    }
    if (can(p, 'stock.view', br) && t.showLowStock) {
      for (const r of db.prepare(`SELECT id, name_ar, reorder_level, q FROM (SELECT i.id, i.name_ar, i.reorder_level, (SELECT COALESCE(SUM(m.qty),0) FROM movements m JOIN batches b ON b.id=m.batch_id WHERE b.item_id=i.id) q FROM items i WHERE i.status='active' AND i.reorder_level>0) WHERE q < reorder_level ORDER BY q LIMIT 10`).all())
        entries.push({ kind: 'low', itemId: String(r.id), name: String(r.name_ar), qty: Number(r.q), reorder: Number(r.reorder_level) });
    }
    if (can(p, 'staff_tasks.my', br)) counts.tasks = Number(db.prepare("SELECT COUNT(*) n FROM staff_tasks WHERE status='open' AND assigned_to=?").get(p.id)!.n);
    if (can(p, 'sale.hold', br)) counts.held = Number(db.prepare("SELECT COUNT(*) n FROM held_bills WHERE status='open' AND user_id=?").get(p.id)!.n);
    // interleave the kinds so one long list does not hide the others
    const by = (k: GlanceEntry['kind']) => entries.filter(e => e.kind === k); const lists = [by('expiry'), by('shortage'), by('ready'), by('low')]; const mixed: GlanceEntry[] = [];
    for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (i < l.length) mixed.push(l[i]!);
    return { counts, ticker: t.enabled ? mixed : [], settings: t };
  });

  s.post('/api/settings/ticker', async (q) => {
    const p = me(q); if (!can(p, 'settings.branch', br)) throw new AccessError('forbidden', 'settings.branch');
    const b = (q.body ?? {}) as B; const cur = tickerSettings(app); const months = b.expiryMonths === undefined ? cur.expiryMonths : Number(b.expiryMonths);
    if (!Number.isInteger(months) || months < 1 || months > 24) throw new AccessError('invalid', 'expiry months must be 1 to 24');
    const flag = (k: keyof TickerSettings) => (typeof b[k] === 'boolean' ? (b[k] as boolean) : (cur[k] as boolean));
    const next: TickerSettings = { enabled: flag('enabled'), expiryMonths: months, showExpiry: flag('showExpiry'), showShortages: flag('showShortages'), showReady: flag('showReady'), showLowStock: flag('showLowStock') };
    app.access.setSetting(TICKER_KEY, JSON.stringify(next), p.id); app.hub.audit(p.id, 'settings.ticker', 'settings', TICKER_KEY, next as unknown as B); return next;
  });
}
