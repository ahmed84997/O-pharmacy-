import { approvalAllowed, can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { PosError, type SaleService } from './sales';

export interface SessionReport {
  sessionNo: string; terminal: string; userId: string; status: string; openedAt: string; closedAt: string | null;
  sales: { count: number; grossMinor: number; discountMinor: number; deliveryFeeMinor: number; totalMinor: number; cashMinor: number; cardMinor: number; onAccountMinor: number; codOwedMinor: number };
  voids: { count: number; totalMinor: number };
  returns: { count: number; totalMinor: number; cashMinor: number; cardMinor: number; accountMinor: number; swapCreditMinor: number };
  customerPayments: { cashMinor: number; cardMinor: number };
  /** Only for reviewers: what the drawer should hold, how it adds up, what was counted. The cashier does not see these (blind count). */
  drawer?: { openingFloatMinor: number; expectedCashMinor: number; countedCashMinor: number | null; diffMinor: number | null; closeNote: string | null; review: { decision: string; note: string | null; by: string; at: string } | null };
}
export interface DayTotals { sessions: number; salesCount: number; salesMinor: number; discountMinor: number; cashMinor: number; cardMinor: number; onAccountMinor: number; codOwedMinor: number; returnsMinor: number; voidsMinor: number; customerPaymentsMinor: number; expectedCashMinor: number; countedCashMinor: number; diffMinor: number }

/** Drawer closing (Sprint 4.6): the report of a session, the review of a difference by someone else, and closing the business day. A closed day is final; corrections go forward. */
export class ClosingService {
  constructor(private hub: Hub, private sales: SaleService, private o: { separationOfDuties?: () => boolean; activeApprovers?: () => number } = {}) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new PosError('forbidden', `missing permission ${perm}`); }
  private n(sql: string, ...a: unknown[]): number { return Number(this.db.prepare(sql).get(...a)!.t); }
  private latestReview(sessionId: string) { const r = this.db.prepare('SELECT decision, note, by, at FROM session_reviews WHERE session_id=? ORDER BY seq DESC LIMIT 1').get(sessionId); return r ? { decision: String(r.decision), note: (r.note as string) ?? null, by: String(r.by), at: String(r.at) } : null; }

  /** The report of one session. Reviewers (`drawer.close.review`) see the drawer part; the cashier sees the rest of their own closed session. */
  report(actor: Person, sessionId: string): SessionReport {
    const s = this.sales.session(sessionId); const reviewer = can(actor, 'drawer.close.review', this.hub.branchId);
    if (!reviewer) { this.need(actor, 'cashier_session.close'); if (String(s.user_id) !== actor.id) throw new PosError('forbidden', 'you may only see your own session'); if (s.status !== 'closed') throw new PosError('state', 'the report is available once the session is closed'); }
    const q = (col: string, from: string, w: string) => this.n(`SELECT ${col.startsWith('COUNT') ? col : `COALESCE(SUM(${col}),0)`} t FROM ${from} WHERE ${w}`, sessionId);
    const pay = (m: string) => this.n("SELECT COALESCE(SUM(p.amount_minor),0) t FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE p.session_id=? AND p.method='" + m + "' AND s.status='posted'", sessionId);
    const posted = "session_id=? AND status='posted'";
    const r: SessionReport = {
      sessionNo: String(s.session_no), terminal: String(s.terminal), userId: String(s.user_id), status: String(s.status), openedAt: String(s.opened_at), closedAt: (s.closed_at as string) ?? null,
      sales: { count: q('COUNT(*)', 'sales', posted), grossMinor: q('gross_minor', 'sales', posted), discountMinor: q('discount_minor', 'sales', posted), deliveryFeeMinor: q('delivery_fee_minor', 'sales', posted), totalMinor: q('total_minor', 'sales', posted), cashMinor: pay('cash'), cardMinor: pay('card'), onAccountMinor: q('credit_minor', 'sales', posted),
        codOwedMinor: this.n("SELECT COALESCE(SUM(p.amount_minor),0) t FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.session_id=? AND p.method='cod' AND s.status='posted'", sessionId) },
      voids: { count: q('COUNT(*)', 'sales', "session_id=? AND status='void'"), totalMinor: q('total_minor', 'sales', "session_id=? AND status='void'") },
      returns: { count: q('COUNT(*)', 'sale_returns', 'session_id=?'), totalMinor: q('total_minor', 'sale_returns', 'session_id=?'), cashMinor: q('cash_minor', 'sale_returns', 'session_id=?'), cardMinor: q('card_minor', 'sale_returns', 'session_id=?'), accountMinor: q('credit_minor', 'sale_returns', "session_id=? AND kind='return'"), swapCreditMinor: q('credit_minor', 'sale_returns', "session_id=? AND kind='swap'") },
      customerPayments: { cashMinor: this.n("SELECT COALESCE(SUM(-amount_minor),0) t FROM customer_ledger WHERE session_id=? AND kind='payment' AND method='cash'", sessionId), cardMinor: this.n("SELECT COALESCE(SUM(-amount_minor),0) t FROM customer_ledger WHERE session_id=? AND kind='payment' AND method='card'", sessionId) },
    };
    if (reviewer) r.drawer = { openingFloatMinor: Number(s.opening_float_minor), expectedCashMinor: s.expected_cash_minor === null ? this.sales.expectedCash(sessionId) : Number(s.expected_cash_minor), countedCashMinor: s.counted_cash_minor === null ? null : Number(s.counted_cash_minor), diffMinor: s.diff_minor === null ? null : Number(s.diff_minor), closeNote: (s.close_note as string) ?? null, review: this.latestReview(sessionId) };
    return r;
  }

  /** A reviewer other than the cashier accepts a closed session (a difference needs a note) or escalates it (always a note). Separation of duties applies; in a one-person pharmacy the review is flagged instead of refused. The latest review counts; none is deleted. */
  reviewSession(actor: Person, r: { sessionId: string; decision: 'accepted' | 'escalated'; note?: string }): { flagged: boolean } {
    this.need(actor, 'drawer.close.review'); if (r.decision !== 'accepted' && r.decision !== 'escalated') throw new PosError('invalid', 'decision must be accepted or escalated');
    return this.db.tx(() => {
      const s = this.sales.session(r.sessionId); if (s.status !== 'closed') throw new PosError('state', 'only a closed session can be reviewed');
      const diff = Number(s.diff_minor); const note = r.note?.trim(); if ((r.decision === 'escalated' || diff !== 0) && !note) throw new PosError('invalid', 'a note is required');
      const sod = approvalAllowed(String(s.user_id), actor.id, { separationOfDuties: this.o.separationOfDuties?.() ?? true, activeApprovers: this.o.activeApprovers?.() ?? 2 }); if (!sod.ok) throw new PosError('forbidden', 'the cashier cannot review their own session');
      this.db.prepare('INSERT INTO session_reviews(id,session_id,decision,note,flagged,by,at) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), r.sessionId, r.decision, note ?? null, sod.flagged ? 1 : 0, actor.id, this.hub.now());
      this.hub.audit(actor.id, `session.review.${r.decision}`, 'cashier_session', String(s.session_no), { diffMinor: diff, note: note ?? null, flagged: sod.flagged }); this.hub.emit('session.reviewed', { sessionNo: String(s.session_no), decision: r.decision, diffMinor: diff });
      return { flagged: sod.flagged };
    });
  }
  /** Sessions that stop the day from closing: open ones, and closed ones with a difference nobody accepted. */
  blockers(actor: Person, date: string): { open: string[]; unreviewed: string[] } {
    this.need(actor, 'drawer.close.review'); const open: string[] = [], unreviewed: string[] = [];
    for (const s of this.db.prepare('SELECT * FROM cashier_sessions ORDER BY rowid').all()) {
      const d = this.sales.businessDate(String(s.opened_at)); if (d > date) continue;
      if (s.status === 'open') { open.push(String(s.session_no)); continue; }
      if (d === date && Number(s.diff_minor) !== 0 && this.latestReview(String(s.id))?.decision !== 'accepted') unreviewed.push(String(s.session_no));
    }
    return { open, unreviewed };
  }
  /** Close the business day (`drawer.close.review`): every session of the day (and any older one still open) must be closed, every difference accepted. Stores a snapshot of the totals. Final. */
  closeDay(actor: Person, c: { key: string; date: string; note?: string }): { date: string; totals: DayTotals; replay: boolean } {
    this.need(actor, 'drawer.close.review'); if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) throw new PosError('invalid', 'date must be YYYY-MM-DD');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT business_date, totals_json FROM day_closings WHERE req_key=?').get(c.key); if (prior) return { date: String(prior.business_date), totals: JSON.parse(String(prior.totals_json)) as DayTotals, replay: true };
      if (c.date > this.sales.businessDate(this.hub.now())) throw new PosError('invalid', 'a day in the future cannot be closed');
      if (this.db.prepare('SELECT 1 FROM day_closings WHERE business_date=?').get(c.date)) throw new PosError('state', 'this day is already closed');
      const sessions = this.db.prepare('SELECT id FROM cashier_sessions ORDER BY rowid').all().filter(s => this.sales.businessDate(String(this.sales.session(String(s.id)).opened_at)) === c.date).map(s => String(s.id)); if (!sessions.length) throw new PosError('state', 'no sessions on this day');
      const b = this.blockers(actor, c.date); if (b.open.length || b.unreviewed.length) throw new PosError('state', 'the day cannot close yet', b);
      const t: DayTotals = { sessions: sessions.length, salesCount: 0, salesMinor: 0, discountMinor: 0, cashMinor: 0, cardMinor: 0, onAccountMinor: 0, codOwedMinor: 0, returnsMinor: 0, voidsMinor: 0, customerPaymentsMinor: 0, expectedCashMinor: 0, countedCashMinor: 0, diffMinor: 0 };
      for (const id of sessions) { const r = this.report(actor, id); t.salesCount += r.sales.count; t.salesMinor += r.sales.totalMinor; t.discountMinor += r.sales.discountMinor; t.cashMinor += r.sales.cashMinor; t.cardMinor += r.sales.cardMinor; t.onAccountMinor += r.sales.onAccountMinor; t.codOwedMinor += r.sales.codOwedMinor; t.returnsMinor += r.returns.totalMinor; t.voidsMinor += r.voids.totalMinor; t.customerPaymentsMinor += r.customerPayments.cashMinor + r.customerPayments.cardMinor; t.expectedCashMinor += r.drawer!.expectedCashMinor; t.countedCashMinor += r.drawer!.countedCashMinor ?? 0; t.diffMinor += r.drawer!.diffMinor ?? 0; }
      this.db.prepare('INSERT INTO day_closings(id,business_date,req_key,sessions_count,totals_json,note,closed_by,closed_at) VALUES(?,?,?,?,?,?,?,?)').run(uuidv7(), c.date, c.key, sessions.length, JSON.stringify(t), c.note?.trim() ?? null, actor.id, this.hub.now());
      this.hub.audit(actor.id, 'day.closed', 'business_day', c.date, { ...t }); this.hub.emit('day.closed', { date: c.date, ...t }); return { date: c.date, totals: t, replay: false };
    });
  }
  /** Closed days, newest first (reviewers). */
  days(actor: Person, limit = 60): { date: string; totals: DayTotals; closedBy: string; closedAt: string; note: string | null }[] {
    this.need(actor, 'drawer.close.review'); return this.db.prepare('SELECT * FROM day_closings ORDER BY business_date DESC LIMIT ?').all(limit).map(r => ({ date: String(r.business_date), totals: JSON.parse(String(r.totals_json)) as DayTotals, closedBy: String(r.closed_by), closedAt: String(r.closed_at), note: (r.note as string) ?? null }));
  }
}
