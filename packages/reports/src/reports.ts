import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import type { Col, ParamDef, ReportContext, ReportDef, ReportResult } from './types';
import { BUILTIN_REPORTS } from './builtin';

export type ReportErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state';
export class ReportError extends Error { constructor(public code: ReportErrorCode, m: string) { super(m); } }
export interface ReportRules { timeZone: string; maxRows: number }
export const DEFAULT_REPORT_RULES: ReportRules = { timeZone: 'Africa/Cairo', maxRows: 5000 };
export interface CatalogueEntry { key: string; title: string; category: string; params: ParamDef[]; canExport: boolean }
export interface RunOutput extends ReportResult { key: string; title: string; params: Record<string, string | number>; truncated: boolean }
export interface SavedView { id: string; personId: string; reportKey: string; name: string; params: Record<string, string | number>; shared: boolean }
const DATE = /^\d{4}-\d{2}-\d{2}$/; const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The report centre: one place for every report, with filters, saved views and CSV export. A report is offered only to people who hold all of its permissions and only when the tables it reads exist. Each run and each export is written to an append-only log. */
export class ReportCentre {
  private defs = new Map<string, ReportDef>();
  constructor(private hub: Hub, defs: ReportDef[] = BUILTIN_REPORTS, private rules: ReportRules = DEFAULT_REPORT_RULES) { for (const d of defs) this.defs.set(d.key, d); }
  private get db() { return this.hub.db; }
  private has = (t: string) => !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  private localDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: this.rules.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  private ctx(): ReportContext { const now = this.hub.now(); return { db: this.db, now, today: this.localDate(now), localDate: this.localDate, has: this.has }; }
  private allowed(a: Person, d: ReportDef): boolean { return d.needs.every(this.has) && d.permissions.every(p => can(a, p, this.hub.branchId)); }
  private def(a: Person, key: string): ReportDef { const d = this.defs.get(key); if (!d) throw new ReportError('not-found', 'report'); if (!d.needs.every(this.has)) throw new ReportError('not-found', 'report is not available here'); if (!this.allowed(a, d)) throw new ReportError('forbidden', `not allowed to see ${key}`); return d; }
  private defaultOf(v: string | number | undefined, today: string): string | number | undefined {
    if (typeof v !== 'string' || !v.startsWith('@')) return v; const [y, m] = today.split('-').map(Number) as [number, number];
    if (v === '@today') return today; if (v === '@month_start') return `${today.slice(0, 7)}-01`; if (v === '@last_month') return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; return v;
  }
  private clean(d: ReportDef, raw: Record<string, unknown>, today: string): Record<string, string | number> {
    const out: Record<string, string | number> = {}; for (const p of d.params) {
      let v: unknown = raw[p.name]; if (v === undefined || v === null || v === '') v = this.defaultOf(p.default, today);
      if (v === undefined) { if (p.required) throw new ReportError('invalid', `${p.label} is required`); continue; }
      if (p.type === 'int') { const n = Number(v); if (!Number.isInteger(n) || (p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) throw new ReportError('invalid', `${p.label} must be a whole number${p.min !== undefined ? ` from ${p.min} to ${p.max}` : ''}`); out[p.name] = n; }
      else if (p.type === 'date') { if (typeof v !== 'string' || !DATE.test(v)) throw new ReportError('invalid', `${p.label} must be a date`); out[p.name] = v; }
      else if (p.type === 'month') { if (typeof v !== 'string' || !MONTH.test(v)) throw new ReportError('invalid', `${p.label} must be a month YYYY-MM`); out[p.name] = v; }
      else { if (typeof v !== 'string' || !v.trim()) throw new ReportError('invalid', `${p.label} is required`); out[p.name] = v.trim(); }
    }
    if (typeof out.from === 'string' && typeof out.to === 'string' && out.from > out.to) throw new ReportError('invalid', 'from is after to'); return out;
  }
  private log(a: Person, key: string, action: 'run' | 'export', params: unknown, rows: number): void { this.db.prepare('INSERT INTO report_runs(id,person_id,report_key,action,params_json,rows_count,at) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), a.id, key, action, JSON.stringify(params), rows, this.hub.now()); }
  /** What this person may open, grouped by category by the caller. */
  catalogue(a: Person): CatalogueEntry[] { return [...this.defs.values()].filter(d => this.allowed(a, d)).map(d => ({ key: d.key, title: d.title, category: d.category, params: d.params, canExport: can(a, 'report.export', this.hub.branchId) })); }
  run(a: Person, key: string, raw: Record<string, unknown> = {}): RunOutput {
    const d = this.def(a, key); const c = this.ctx(); const params = this.clean(d, raw, c.today); const r = d.run(c, params); const truncated = r.rows.length > this.rules.maxRows; const rows = truncated ? r.rows.slice(0, this.rules.maxRows) : r.rows;
    this.log(a, key, 'run', params, rows.length); return { key, title: d.title, params, columns: r.columns, rows, totals: truncated ? undefined : r.totals, truncated };
  }
  /** CSV with a UTF-8 byte-order mark (so Excel reads Arabic), money as decimals, and cells that start with = + - @ neutralised so a spreadsheet never runs them as a formula. */
  export(a: Person, key: string, raw: Record<string, unknown> = {}): { filename: string; csv: string; rows: number } {
    if (!can(a, 'report.export', this.hub.branchId)) throw new ReportError('forbidden', 'missing permission report.export');
    const d = this.def(a, key); const c = this.ctx(); const params = this.clean(d, raw, c.today); const r = d.run(c, params); if (r.rows.length > this.rules.maxRows) throw new ReportError('invalid', `too many rows (over ${this.rules.maxRows}): narrow the filters`);
    const cell = (col: Col, v: string | number | null | undefined): string => { if (v === null || v === undefined) return ''; let s = col.type === 'money' && typeof v === 'number' ? `${v < 0 ? '-' : ''}${Math.floor(Math.abs(v) / 100)}.${String(Math.abs(v) % 100).padStart(2, '0')}` : String(v); if (col.type === 'text' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [r.columns.map(x => cell({ ...x, type: 'int' }, x.label)).join(','), ...r.rows.map(row => r.columns.map(x => cell(x, row[x.key])).join(',')), ...(r.totals ? [r.columns.map(x => cell(x, r.totals![x.key])).join(',')] : [])];
    this.log(a, key, 'export', params, r.rows.length); return { filename: `${key}-${c.today}.csv`, csv: `﻿${lines.join('\r\n')}\r\n`, rows: r.rows.length };
  }
  saveView(a: Person, v: { reportKey: string; name: string; params?: Record<string, unknown>; shared?: boolean }): string {
    const d = this.def(a, v.reportKey); if (!v.name?.trim()) throw new ReportError('invalid', 'a view needs a name'); const params = this.clean(d, v.params ?? {}, this.ctx().today);
    if (v.shared && !can(a, 'report.export', this.hub.branchId)) throw new ReportError('forbidden', 'only leads share a view');
    const id = uuidv7(); this.hub.db.tx(() => { this.db.prepare('INSERT INTO saved_views(id,person_id,report_key,name,params_json,shared,archived,created_at) VALUES(?,?,?,?,?,?,0,?)').run(id, a.id, v.reportKey, v.name.trim(), JSON.stringify(v.params ? params : {}), v.shared ? 1 : 0, this.hub.now()); this.hub.audit(a.id, 'report.view_saved', 'saved_view', id, { report: v.reportKey }); }); return id;
  }
  /** My views, plus the ones leads shared, for reports I may open. */
  views(a: Person): SavedView[] { return this.db.prepare('SELECT * FROM saved_views WHERE archived=0 AND (person_id=? OR shared=1) ORDER BY created_at, id').all(a.id).filter(r => { const d = this.defs.get(String(r.report_key)); return d && this.allowed(a, d); }).map(r => ({ id: String(r.id), personId: String(r.person_id), reportKey: String(r.report_key), name: String(r.name), params: JSON.parse(String(r.params_json)), shared: r.shared === 1 })); }
  runView(a: Person, id: string): RunOutput { const v = this.views(a).find(x => x.id === id); if (!v) throw new ReportError('not-found', 'view'); return this.run(a, v.reportKey, v.params); }
  archiveView(a: Person, id: string): void { const r = this.db.prepare('SELECT * FROM saved_views WHERE id=?').get(id); if (!r) throw new ReportError('not-found', 'view'); if (r.person_id !== a.id) throw new ReportError('forbidden', 'not your view'); if (r.archived === 1) throw new ReportError('state', 'already archived'); this.db.tx(() => { this.db.prepare('UPDATE saved_views SET archived=1 WHERE id=?').run(id); this.hub.audit(a.id, 'report.view_archived', 'saved_view', id, {}); }); }
  history(a: Person, limit = 50): { reportKey: string; action: string; rows: number; at: string }[] { if (!can(a, 'report.export', this.hub.branchId)) throw new ReportError('forbidden', 'leads only'); return this.db.prepare('SELECT * FROM report_runs ORDER BY seq DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 500)).map(r => ({ reportKey: String(r.report_key), action: String(r.action), rows: Number(r.rows_count), at: String(r.at) })); }
}
