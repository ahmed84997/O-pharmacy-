import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { BatchError, type BatchService, type ItemService } from '@o-pharmacy/inventory';

export type PosErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'insufficient' | 'underpaid' | 'no-price' | 'session';
export class PosError extends Error { constructor(public code: PosErrorCode, m: string, public detail?: unknown) { super(m); } }
export interface SaleLineInput { itemId: string; qty: number; unitName?: string; batchId?: string; priceKind?: 'public' | 'pharmacist' }
export interface SaleInput { key: string; sessionId: string; lines: SaleLineInput[]; cashMinor: number; deviceId?: string }
export interface SaleResult { id: string; saleNo: string; totalMinor: number; tenderedMinor: number; changeMinor: number; lines: number; replay: boolean }
export interface CloseResult { closed: true; expectedMinor?: number; countedMinor?: number; diffMinor?: number }

const div = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

/** Cashier sessions and the sale core: cash sales from the nearest-expiry batches (FEFO, each batch at its own price), void while the session is open. */
export class SaleService {
  constructor(private hub: Hub, private items: ItemService, private batches: BatchService, private o: { allowNegative?: () => boolean } = {}) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new PosError('forbidden', `missing permission ${perm}`); }
  private next(k: string, prefix: string): string {
    const n = Number(this.db.prepare('SELECT v FROM pos_counters WHERE k=?').get(k)?.v ?? 0) + 1;
    this.db.prepare('INSERT INTO pos_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`;
  }

  // ---------- cashier session ----------
  /** One open session per terminal and per person. The opening float is the cash already in the drawer. */
  openSession(actor: Person, s: { key: string; terminal: string; openingFloatMinor: number }): { id: string; sessionNo: string; replay: boolean } {
    this.need(actor, 'cashier_session.open'); const terminal = s.terminal?.trim(); if (!terminal) throw new PosError('invalid', 'terminal is required');
    if (!Number.isInteger(s.openingFloatMinor) || s.openingFloatMinor < 0) throw new PosError('invalid', 'opening float must be whole piasters, zero or more');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT id, session_no FROM cashier_sessions WHERE req_key=?').get(s.key); if (prior) return { id: String(prior.id), sessionNo: String(prior.session_no), replay: true };
      const t = this.db.prepare("SELECT user_id FROM cashier_sessions WHERE terminal=? AND status='open'").get(terminal); if (t) throw new PosError('state', `terminal ${terminal} already has an open session`);
      if (this.db.prepare("SELECT 1 FROM cashier_sessions WHERE user_id=? AND status='open'").get(actor.id)) throw new PosError('state', 'you already have an open session: close it first');
      const id = uuidv7(), no = this.next('session', 'CS');
      this.db.prepare('INSERT INTO cashier_sessions(id,session_no,req_key,terminal,user_id,opening_float_minor,opened_at) VALUES(?,?,?,?,?,?,?)').run(id, no, s.key, terminal, actor.id, s.openingFloatMinor, this.hub.now());
      this.hub.audit(actor.id, 'session.opened', 'cashier_session', no, { terminal, openingFloatMinor: s.openingFloatMinor }); this.hub.emit('session.opened', { sessionNo: no, terminal, userId: actor.id });
      return { id, sessionNo: no, replay: false };
    });
  }
  private session(id: string) { const r = this.db.prepare('SELECT * FROM cashier_sessions WHERE id=?').get(id); if (!r) throw new PosError('not-found', `session ${id}`); return r; }
  private expected(id: string, float: number): number { return float + Number(this.db.prepare("SELECT COALESCE(SUM(total_minor),0) t FROM sales WHERE session_id=? AND status='posted'").get(id)!.t); }
  /** The cashier counts the drawer without seeing the expected amount; only reviewers (`drawer.close.review`) get expected and difference back. A difference needs a note. */
  closeSession(actor: Person, id: string, c: { countedCashMinor: number; note?: string }): CloseResult {
    this.need(actor, 'cashier_session.close'); if (!Number.isInteger(c.countedCashMinor) || c.countedCashMinor < 0) throw new PosError('invalid', 'counted cash must be whole piasters, zero or more');
    return this.db.tx(() => {
      const s = this.session(id); if (s.status !== 'open') throw new PosError('state', 'the session is already closed');
      const reviewer = can(actor, 'drawer.close.review', this.hub.branchId); if (String(s.user_id) !== actor.id && !reviewer) throw new PosError('forbidden', 'only the cashier or a reviewer may close this session');
      const exp = this.expected(id, Number(s.opening_float_minor)); const diff = c.countedCashMinor - exp; if (diff !== 0 && !c.note?.trim()) throw new PosError('invalid', 'a note is required when the count differs');
      this.db.prepare("UPDATE cashier_sessions SET status='closed', closed_at=?, closed_by=?, counted_cash_minor=?, expected_cash_minor=?, diff_minor=?, close_note=? WHERE id=?").run(this.hub.now(), actor.id, c.countedCashMinor, exp, diff, c.note?.trim() ?? null, id);
      this.hub.audit(actor.id, 'session.closed', 'cashier_session', String(s.session_no), { counted: c.countedCashMinor, expected: exp, diff }); this.hub.emit('session.closed', { sessionNo: String(s.session_no), expectedMinor: exp, countedMinor: c.countedCashMinor, diffMinor: diff });
      return reviewer ? { closed: true, expectedMinor: exp, countedMinor: c.countedCashMinor, diffMinor: diff } : { closed: true };
    });
  }
  /** Reviewers only: the numbers of one session (open or closed). */
  sessionSummary(actor: Person, id: string) {
    this.need(actor, 'drawer.close.review'); const s = this.session(id);
    const a = this.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_minor),0) t FROM sales WHERE session_id=? AND status='posted'").get(id)!; const v = this.db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_minor),0) t FROM sales WHERE session_id=? AND status='void'").get(id)!;
    return { sessionNo: String(s.session_no), terminal: String(s.terminal), userId: String(s.user_id), status: String(s.status), openingFloatMinor: Number(s.opening_float_minor), salesCount: Number(a.n), salesMinor: Number(a.t), voidCount: Number(v.n), voidMinor: Number(v.t), expectedCashMinor: this.expected(id, Number(s.opening_float_minor)), countedCashMinor: s.counted_cash_minor === null ? null : Number(s.counted_cash_minor), diffMinor: s.diff_minor === null ? null : Number(s.diff_minor) };
  }
  openSessionOf(userId: string): { id: string; sessionNo: string; terminal: string } | null { const r = this.db.prepare("SELECT id, session_no, terminal FROM cashier_sessions WHERE user_id=? AND status='open'").get(userId); return r ? { id: String(r.id), sessionNo: String(r.session_no), terminal: String(r.terminal) } : null; }

  // ---------- sale ----------
  /** One cash sale in ONE transaction: stock leaves the nearest-expiry batches first (each at its own price), money is whole piasters rounded half up once per batch pick, the ledger and the sale agree or nothing is written. */
  createSale(actor: Person, s: SaleInput): SaleResult {
    this.need(actor, 'sale.create'); if (!s.lines?.length) throw new PosError('invalid', 'a sale needs at least one line'); if (!Number.isInteger(s.cashMinor) || s.cashMinor < 0) throw new PosError('invalid', 'cash must be whole piasters');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT * FROM sales WHERE req_key=?').get(s.key); if (prior) return { id: String(prior.id), saleNo: String(prior.sale_no), totalMinor: Number(prior.total_minor), tenderedMinor: Number(prior.tendered_minor), changeMinor: Number(prior.change_minor), lines: Number(this.db.prepare('SELECT COUNT(DISTINCT line_no) c FROM sale_lines WHERE sale_id=?').get(String(prior.id))!.c), replay: true };
      const sess = this.session(s.sessionId); if (sess.status !== 'open') throw new PosError('session', 'the session is closed'); if (String(sess.user_id) !== actor.id) throw new PosError('session', 'this session belongs to another cashier');
      const id = uuidv7(), no = this.next('sale', 'S'); const rows: unknown[][] = []; let total = 0; const short: { line: number; itemId: string; missingBase: number }[] = [];
      s.lines.forEach((l, i) => {
        const item = this.items.get(l.itemId); if (!item) throw new PosError('not-found', `line ${i + 1}: item`);
        const unit = l.unitName ? item.units.find(x => x.name === l.unitName) : item.units[item.units.length - 1]; if (!unit) throw new PosError('invalid', `line ${i + 1}: unknown unit`);
        if (!unit.sellable) throw new PosError('invalid', `line ${i + 1}: ${unit.name} is not a sellable unit`); if (!Number.isInteger(l.qty) || l.qty <= 0) throw new PosError('invalid', `line ${i + 1}: quantity must be a positive whole number`);
        if (item.status !== 'active') throw new PosError('invalid', `line ${i + 1}: item is ${item.status}`); if (l.priceKind === 'pharmacist') this.need(actor, 'sale.discount');
        const qtyBase = l.qty * unit.factor;
        if (item.kind === 'service') { // no stock: price x quantity
          if (item.listPriceMinor === null) throw new PosError('no-price', `line ${i + 1}: the service has no price`); const f = item.units[item.units.length - 1]!.factor; const amount = div(qtyBase * item.listPriceMinor, f);
          rows.push([uuidv7(), id, i + 1, 1, l.itemId, null, l.qty, unit.name, qtyBase, f, item.listPriceMinor, amount, 0, null]); total += amount; return;
        }
        let al; try { al = this.batches.allocate(l.itemId, qtyBase, { forceBatchId: l.batchId, priceKind: l.priceKind }); } catch (e) { if (e instanceof BatchError) throw new PosError('invalid', `line ${i + 1}: ${e.message}`); throw e; }
        let missing = al.missingBase;
        if (missing > 0 && item.kind === 'non_drug' && this.o.allowNegative?.() && item.listPriceMinor !== null && !l.batchId) { // config sale.allowNegativeStock: sell what the system does not show (non-drugs only: a drug price needs a batch)
          const f = item.units[item.units.length - 1]!.factor; const amount = div(missing * item.listPriceMinor, f); const mv = this.hub.record({ key: `${s.key}:${i}:neg`, storeId: 'MAIN', itemId: l.itemId, batchId: null, qty: -missing, kind: 'sale', ref: no, actor: actor.id, deviceId: s.deviceId, allowNegative: true });
          if (!mv.ok) throw new PosError('insufficient', `line ${i + 1}: stock refused`); rows.push([uuidv7(), id, i + 1, 99, l.itemId, null, l.qty, unit.name, missing, f, item.listPriceMinor, amount, 0, mv.id]); total += amount; missing = 0;
        }
        if (missing > 0) { short.push({ line: i + 1, itemId: l.itemId, missingBase: missing }); return; }
        al.picks.forEach((p, k) => {
          if (p.unitPriceMinor === null) throw new PosError('no-price', `line ${i + 1}: the item has no selling price`);
          const b = this.db.prepare('SELECT b.cost_minor c, u.factor f FROM batches b JOIN item_units u ON u.id=b.price_unit_id WHERE b.id=?').get(p.batchId)!; const cost = div(p.qtyBase * Number(b.c), Number(b.f));
          let first: string | null = null;
          for (const [j, part] of this.storesOf(p.batchId, p.qtyBase).entries()) {
            const mv = this.hub.record({ key: `${s.key}:${i}:${k}:${j}`, storeId: part.storeId, itemId: l.itemId, batchId: p.batchId, qty: -part.qty, kind: 'sale', ref: no, actor: actor.id, deviceId: s.deviceId });
            if (!mv.ok) throw new PosError('insufficient', `line ${i + 1}: stock changed during the sale`); first ??= mv.id;
          }
          rows.push([uuidv7(), id, i + 1, k + 1, l.itemId, p.batchId, l.qty, unit.name, p.qtyBase, p.priceUnitFactor, p.unitPriceMinor, p.amountMinor, cost, first]); total += p.amountMinor;
        });
      });
      if (short.length) throw new PosError('insufficient', 'not enough stock to sell', { short });
      if (s.cashMinor < total) throw new PosError('underpaid', 'the cash received is less than the total', { totalMinor: total });
      this.db.prepare('INSERT INTO sales(id,sale_no,req_key,session_id,total_minor,tendered_minor,change_minor,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, no, s.key, s.sessionId, total, s.cashMinor, s.cashMinor - total, actor.id, this.hub.now());
      for (const r of rows) this.db.prepare('INSERT INTO sale_lines(id,sale_id,line_no,pick_no,item_id,batch_id,req_qty,req_unit,qty_base,price_unit_factor,unit_price_minor,amount_minor,cost_amount_minor,movement_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...r);
      this.hub.audit(actor.id, 'sale.posted', 'sale', no, { sessionId: s.sessionId, totalMinor: total, lines: s.lines.length }); this.hub.emit('sale.posted', { saleNo: no, sessionNo: String(sess.session_no), totalMinor: total, lines: s.lines.length });
      return { id, saleNo: no, totalMinor: total, tenderedMinor: s.cashMinor, changeMinor: s.cashMinor - total, lines: s.lines.length, replay: false };
    });
  }
  /** Which sellable stores give this batch's quantity (main store first); a batch spread over several stores is drawn from each. */
  private storesOf(batchId: string, qtyBase: number): { storeId: string; qty: number }[] {
    const rows = this.db.prepare("SELECT m.store_id id, SUM(m.qty) q FROM movements m JOIN stores s ON s.id = m.store_id AND s.sellable = 1 AND s.active = 1 WHERE m.batch_id=? GROUP BY m.store_id HAVING SUM(m.qty) > 0 ORDER BY (m.store_id = 'MAIN') DESC, m.store_id").all(batchId);
    const out: { storeId: string; qty: number }[] = []; let need = qtyBase; for (const r of rows) { if (need <= 0) break; const q = Math.min(need, Number(r.q)); out.push({ storeId: String(r.id), qty: q }); need -= q; }
    if (need > 0) throw new PosError('insufficient', 'stock changed during the sale'); return out;
  }

  /** Voids a sale (management) while its session is still open: every movement is reversed. After the session closes, a return is the way (Sprint 4.3). */
  voidSale(actor: Person, saleNo: string, reason: string): void {
    this.need(actor, 'sale.void'); if (!reason?.trim()) throw new PosError('invalid', 'a reason is required');
    this.db.tx(() => {
      const sale = this.db.prepare('SELECT * FROM sales WHERE sale_no=?').get(saleNo); if (!sale) throw new PosError('not-found', saleNo); if (sale.status !== 'posted') throw new PosError('state', 'already void');
      if (this.session(String(sale.session_id)).status !== 'open') throw new PosError('state', 'the cashier session is closed: use a return instead');
      for (const mv of this.db.prepare("SELECT id FROM movements WHERE ref=? AND kind='sale' ORDER BY rowid").all(saleNo)) { const m = this.hub.reverse(`VOID:${saleNo}:${String(mv.id)}`, String(mv.id), actor.id, `void ${saleNo}: ${reason.trim()}`); if (!m.ok) throw new PosError('state', `cannot reverse a movement (${m.reason})`); }
      this.db.prepare("UPDATE sales SET status='void', void_by=?, void_at=?, void_reason=? WHERE id=?").run(actor.id, this.hub.now(), reason.trim(), String(sale.id));
      this.hub.audit(actor.id, 'sale.voided', 'sale', saleNo, { reason: reason.trim(), totalMinor: Number(sale.total_minor) }); this.hub.emit('sale.voided', { saleNo, totalMinor: Number(sale.total_minor) });
    });
  }

  // ---------- reading ----------
  sale(actor: Person, saleNo: string) {
    const all = can(actor, 'sale.view_all', this.hub.branchId); if (!all) this.need(actor, 'sale.view_own'); const h = this.db.prepare('SELECT * FROM sales WHERE sale_no=?').get(saleNo); if (!h) throw new PosError('not-found', saleNo);
    if (!all && String(h.created_by) !== actor.id) throw new PosError('forbidden', 'you may only see your own sales'); const cost = can(actor, 'stock.cost.view', this.hub.branchId);
    const lines = this.db.prepare('SELECT l.*, i.name_ar, b.lot, b.expiry FROM sale_lines l JOIN items i ON i.id=l.item_id LEFT JOIN batches b ON b.id=l.batch_id WHERE l.sale_id=? ORDER BY l.line_no, l.pick_no').all(String(h.id)).map(l => ({ lineNo: Number(l.line_no), pickNo: Number(l.pick_no), itemId: String(l.item_id), itemName: String(l.name_ar), batchId: (l.batch_id as string) ?? null, lot: (l.lot as string) ?? null, expiry: (l.expiry as string) ?? null, reqQty: Number(l.req_qty), reqUnit: String(l.req_unit), qtyBase: Number(l.qty_base), unitPriceMinor: Number(l.unit_price_minor), priceUnitFactor: Number(l.price_unit_factor), amountMinor: Number(l.amount_minor), costMinor: cost ? Number(l.cost_amount_minor) : null }));
    return { saleNo, status: String(h.status), sessionId: String(h.session_id), totalMinor: Number(h.total_minor), tenderedMinor: Number(h.tendered_minor), changeMinor: Number(h.change_minor), createdBy: String(h.created_by), createdAt: String(h.created_at), voidReason: (h.void_reason as string) ?? null, lines, profitMinor: cost && h.status === 'posted' ? Number(h.total_minor) - lines.reduce((s, l) => s + (l.costMinor ?? 0), 0) : null };
  }
  sales(actor: Person, o: { sessionId?: string; status?: 'posted' | 'void' } = {}) {
    const all = can(actor, 'sale.view_all', this.hub.branchId); if (!all) this.need(actor, 'sale.view_own'); const w: string[] = []; const a: unknown[] = []; if (!all) { w.push('created_by=?'); a.push(actor.id); } if (o.sessionId) { w.push('session_id=?'); a.push(o.sessionId); } if (o.status) { w.push('status=?'); a.push(o.status); }
    return this.db.prepare(`SELECT sale_no, status, total_minor, created_by, created_at FROM sales ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY rowid DESC`).all(...a).map(r => ({ saleNo: String(r.sale_no), status: String(r.status), totalMinor: Number(r.total_minor), createdBy: String(r.created_by), createdAt: String(r.created_at) }));
  }
}
