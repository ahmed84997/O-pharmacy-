import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { BatchError, type BatchService, type ItemService } from '@o-pharmacy/inventory';

export type PosErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'insufficient' | 'underpaid' | 'no-price' | 'session' | 'discount-limit' | 'credit-limit' | 'day-closed';
export class PosError extends Error { constructor(public code: PosErrorCode, m: string, public detail?: unknown) { super(m); } }
export interface SaleLineInput { itemId: string; qty: number; unitName?: string; batchId?: string; priceKind?: 'public' | 'pharmacist'; /** discount in basis points (500 = 5%) */ discountBp?: number }
export type PaymentInput = { method: 'cash'; amountMinor: number } | { method: 'card'; amountMinor: number; ref: string };
export interface DeliveryInput { name: string; phone: string; address: string; feeMinor?: number; note?: string }
export interface SaleInput {
  key: string; sessionId: string; lines: SaleLineInput[]; deviceId?: string;
  /** Shorthand for one cash payment (the cash handed over). */
  cashMinor?: number; payments?: PaymentInput[];
  /** Discount in basis points for every line that has none of its own. Above config sale.cashierDiscountMaxPct needs sale.discount.override. */
  discountBp?: number;
  /** The customer on the invoice (history, statements). With `onCredit` the part not paid now goes on the customer's account (credit sale: needs sale.credit.create, an active customer and room under the credit limit). */
  customerId?: string; onCredit?: boolean;
  /** Home delivery: what is not paid now is cash on delivery, collected later with collectDelivery. */
  delivery?: DeliveryInput; fromHold?: string;
}
export interface SaleResult { creditMinor?: number; onAccountMinor?: number; id: string; saleNo: string; totalMinor: number; tenderedMinor: number; changeMinor: number; discountMinor: number; codMinor: number; lines: number; replay: boolean }
export interface CloseResult { closed: true; expectedMinor?: number; countedMinor?: number; diffMinor?: number }

const div = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

/** Cashier sessions and the sale core: cash sales from the nearest-expiry batches (FEFO, each batch at its own price), void while the session is open. */
export class SaleService {
  constructor(private hub: Hub, private items: ItemService, private batches: BatchService, private o: { allowNegative?: () => boolean; maxDiscountPct?: () => number; timeZone?: string } = {}) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new PosError('forbidden', `missing permission ${perm}`); }
  /** @internal */ next(k: string, prefix: string): string {
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
      if (this.db.prepare('SELECT 1 FROM day_closings WHERE business_date=?').get(this.businessDate(this.hub.now()))) throw new PosError('day-closed', 'today is already closed: no new session');
      const t = this.db.prepare("SELECT user_id FROM cashier_sessions WHERE terminal=? AND status='open'").get(terminal); if (t) throw new PosError('state', `terminal ${terminal} already has an open session`);
      if (this.db.prepare("SELECT 1 FROM cashier_sessions WHERE user_id=? AND status='open'").get(actor.id)) throw new PosError('state', 'you already have an open session: close it first');
      const id = uuidv7(), no = this.next('session', 'CS');
      this.db.prepare('INSERT INTO cashier_sessions(id,session_no,req_key,terminal,user_id,opening_float_minor,opened_at) VALUES(?,?,?,?,?,?,?)').run(id, no, s.key, terminal, actor.id, s.openingFloatMinor, this.hub.now());
      this.hub.audit(actor.id, 'session.opened', 'cashier_session', no, { terminal, openingFloatMinor: s.openingFloatMinor }); this.hub.emit('session.opened', { sessionNo: no, terminal, userId: actor.id });
      return { id, sessionNo: no, replay: false };
    });
  }
  /** The pharmacy's calendar date (YYYY-MM-DD) of a timestamp, in its time zone (default Africa/Cairo). */
  businessDate(iso: string): string { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: this.o.timeZone ?? 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; }
  /** @internal */ expectedCash(id: string): number { return this.expected(id, Number(this.session(id).opening_float_minor)); }
  customerBalance(customerId: string): number { return Number(this.db.prepare('SELECT COALESCE(SUM(amount_minor),0) b FROM customer_ledger WHERE customer_id=?').get(customerId)!.b); }
  /** @internal */ session(id: string) { const r = this.db.prepare('SELECT * FROM cashier_sessions WHERE id=?').get(id); if (!r) throw new PosError('not-found', `session ${id}`); return r; }
  /** Cash that should be in the drawer: the float plus the cash payments of posted sales (change already given back is not counted). Card and cash-on-delivery are not in the drawer. */
  private expected(id: string, float: number): number { return float + Number(this.db.prepare("SELECT COALESCE(SUM(p.amount_minor),0) t FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE p.session_id=? AND p.method='cash' AND s.status='posted'").get(id)!.t) - Number(this.db.prepare("SELECT COALESCE(SUM(cash_minor),0) t FROM sale_returns WHERE session_id=?").get(id)!.t) + Number(this.db.prepare("SELECT COALESCE(SUM(-amount_minor),0) t FROM customer_ledger WHERE session_id=? AND kind='payment' AND method='cash'").get(id)!.t); }
  /** The cashier counts the drawer without seeing the expected amount; only reviewers (`drawer.close.review`) get expected and difference back. A difference needs a note. */
  closeSession(actor: Person, id: string, c: { countedCashMinor: number; note?: string }): CloseResult {
    this.need(actor, 'cashier_session.close'); if (!Number.isInteger(c.countedCashMinor) || c.countedCashMinor < 0) throw new PosError('invalid', 'counted cash must be whole piasters, zero or more');
    return this.db.tx(() => {
      const s = this.session(id); if (s.status !== 'open') throw new PosError('state', 'the session is already closed');
      const reviewer = can(actor, 'drawer.close.review', this.hub.branchId); if (String(s.user_id) !== actor.id && !reviewer) throw new PosError('forbidden', 'only the cashier or a reviewer may close this session');
      const held = Number(this.db.prepare("SELECT COUNT(*) c FROM held_bills WHERE session_id=? AND status='open'").get(id)!.c); if (held > 0) throw new PosError('state', `${held} held bill(s) are still open: resume or cancel them first`, { held });
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
    return { sessionNo: String(s.session_no), terminal: String(s.terminal), userId: String(s.user_id), status: String(s.status), openingFloatMinor: Number(s.opening_float_minor), salesCount: Number(a.n), salesMinor: Number(a.t), voidCount: Number(v.n), voidMinor: Number(v.t), cardMinor: this.sumPay(id, 'card'), cashMinor: this.sumPay(id, 'cash'), codOwedMinor: Number(this.db.prepare("SELECT COALESCE(SUM(p.amount_minor),0) t FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.session_id=? AND p.method='cod' AND s.status='posted' AND NOT EXISTS (SELECT 1 FROM sale_payments q WHERE q.sale_id = p.sale_id AND q.method='cash' AND q.ref='cash on delivery')").get(id)!.t), expectedCashMinor: this.expected(id, Number(s.opening_float_minor)), countedCashMinor: s.counted_cash_minor === null ? null : Number(s.counted_cash_minor), diffMinor: s.diff_minor === null ? null : Number(s.diff_minor) };
  }
  private sumPay(sessionId: string, method: string): number { return Number(this.db.prepare("SELECT COALESCE(SUM(p.amount_minor),0) t FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE p.session_id=? AND p.method=? AND s.status='posted'").get(sessionId, method)!.t); }
  openSessionOf(userId: string): { id: string; sessionNo: string; terminal: string } | null { const r = this.db.prepare("SELECT id, session_no, terminal FROM cashier_sessions WHERE user_id=? AND status='open'").get(userId); return r ? { id: String(r.id), sessionNo: String(r.session_no), terminal: String(r.terminal) } : null; }

  // ---------- sale ----------
  /** One sale in ONE transaction: stock leaves the nearest-expiry batches first (each at its own price), discounts and money are whole piasters (rounded half up once per batch pick), payments (cash, card, or cash on delivery) add up to the total, the ledger and the sale agree or nothing is written. */
  createSale(actor: Person, s: SaleInput): SaleResult { return this.createSaleCore(actor, s, 0); }
  /** @internal swap credit (the refund value of the returned goods) can only come from ReturnService.swap. */
  createSaleCore(actor: Person, s: SaleInput, swapCreditMax: number): SaleResult & { creditMinor: number } {
    this.need(actor, 'sale.create'); if (!s.lines?.length) throw new PosError('invalid', 'a sale needs at least one line');
    const pays: PaymentInput[] = s.payments ?? (s.cashMinor !== undefined ? [{ method: 'cash', amountMinor: s.cashMinor }] : []);
    for (const p of pays) { if (!Number.isInteger(p.amountMinor) || p.amountMinor < 0) throw new PosError('invalid', 'payments must be whole piasters'); if (p.method === 'card' && !p.ref?.trim()) throw new PosError('invalid', 'a card payment needs its approval reference'); }
    if (pays.filter(p => p.method === 'card').length > 1 || pays.filter(p => p.method === 'cash').length > 1) throw new PosError('invalid', 'one cash and one card payment at most');
    const fee = s.delivery?.feeMinor ?? 0; if (!Number.isInteger(fee) || fee < 0) throw new PosError('invalid', 'delivery fee must be whole piasters');
    if (s.delivery) { for (const f of ['name', 'phone', 'address'] as const) if (!s.delivery[f]?.trim()) throw new PosError('invalid', `delivery ${f} is required`); }
    const maxBp = (this.o.maxDiscountPct?.() ?? 5) * 100;
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT * FROM sales WHERE req_key=?').get(s.key);
      if (prior) { const cod = this.db.prepare("SELECT COALESCE(SUM(amount_minor),0) c FROM sale_payments WHERE sale_id=? AND method='cod'").get(String(prior.id))!; return { onAccountMinor: Number(prior.credit_minor), creditMinor: Number(prior.swap_credit_minor), id: String(prior.id), saleNo: String(prior.sale_no), totalMinor: Number(prior.total_minor), tenderedMinor: Number(prior.tendered_minor), changeMinor: Number(prior.change_minor), discountMinor: Number(prior.discount_minor), codMinor: Number(cod.c), lines: Number(this.db.prepare('SELECT COUNT(DISTINCT line_no) c FROM sale_lines WHERE sale_id=?').get(String(prior.id))!.c), replay: true }; }
      const sess = this.session(s.sessionId); if (sess.status !== 'open') throw new PosError('session', 'the session is closed'); if (String(sess.user_id) !== actor.id) throw new PosError('session', 'this session belongs to another cashier');
      if (s.fromHold) { const h = this.db.prepare('SELECT * FROM held_bills WHERE id=?').get(s.fromHold); if (!h) throw new PosError('not-found', 'held bill'); if (h.status !== 'open') throw new PosError('state', 'that held bill is already closed'); if (String(h.session_id) !== s.sessionId) throw new PosError('session', 'the held bill belongs to another session'); this.need(actor, 'sale.resume'); }
      const id = uuidv7(), no = this.next('sale', 'S'); const rows: unknown[][] = []; let gross = 0, discount = 0; const short: { line: number; itemId: string; missingBase: number }[] = [];
      s.lines.forEach((l, i) => {
        const bp = l.discountBp ?? s.discountBp ?? 0; if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new PosError('invalid', `line ${i + 1}: discount must be 0 to 10000 basis points`);
        if (bp > 0) { this.need(actor, 'sale.discount'); if (bp > maxBp && !can(actor, 'sale.discount.override', this.hub.branchId)) throw new PosError('discount-limit', `line ${i + 1}: a discount above ${maxBp / 100}% needs a manager`, { maxBp }); }
        const disc = (amount: number) => div(amount * bp, 10000);
        const item = this.items.get(l.itemId); if (!item) throw new PosError('not-found', `line ${i + 1}: item`);
        const unit = l.unitName ? item.units.find(x => x.name === l.unitName) : item.units[item.units.length - 1]; if (!unit) throw new PosError('invalid', `line ${i + 1}: unknown unit`);
        if (!unit.sellable) throw new PosError('invalid', `line ${i + 1}: ${unit.name} is not a sellable unit`); if (!Number.isInteger(l.qty) || l.qty <= 0) throw new PosError('invalid', `line ${i + 1}: quantity must be a positive whole number`);
        if (item.status !== 'active') throw new PosError('invalid', `line ${i + 1}: item is ${item.status}`); if (l.priceKind === 'pharmacist') this.need(actor, 'sale.discount');
        const qtyBase = l.qty * unit.factor;
        if (item.kind === 'service') { // no stock: price x quantity
          if (item.listPriceMinor === null) throw new PosError('no-price', `line ${i + 1}: the service has no price`); const f = item.units[item.units.length - 1]!.factor; const amount = div(qtyBase * item.listPriceMinor, f); const d = disc(amount);
          rows.push([uuidv7(), id, i + 1, 1, l.itemId, null, l.qty, unit.name, qtyBase, f, item.listPriceMinor, amount, 0, null, d]); gross += amount; discount += d; return;
        }
        let al; try { al = this.batches.allocate(l.itemId, qtyBase, { forceBatchId: l.batchId, priceKind: l.priceKind }); } catch (e) { if (e instanceof BatchError) throw new PosError('invalid', `line ${i + 1}: ${e.message}`); throw e; }
        let missing = al.missingBase;
        if (missing > 0 && item.kind === 'non_drug' && this.o.allowNegative?.() && item.listPriceMinor !== null && !l.batchId) { // config sale.allowNegativeStock: sell what the system does not show (non-drugs only: a drug price needs a batch)
          const f = item.units[item.units.length - 1]!.factor; const amount = div(missing * item.listPriceMinor, f); const d = disc(amount); const mv = this.hub.record({ key: `${s.key}:${i}:neg`, storeId: 'MAIN', itemId: l.itemId, batchId: null, qty: -missing, kind: 'sale', ref: no, actor: actor.id, deviceId: s.deviceId, allowNegative: true });
          if (!mv.ok) throw new PosError('insufficient', `line ${i + 1}: stock refused`); rows.push([uuidv7(), id, i + 1, 99, l.itemId, null, l.qty, unit.name, missing, f, item.listPriceMinor, amount, 0, mv.id, d]); gross += amount; discount += d; missing = 0;
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
          const d = disc(p.amountMinor); rows.push([uuidv7(), id, i + 1, k + 1, l.itemId, p.batchId, l.qty, unit.name, p.qtyBase, p.priceUnitFactor, p.unitPriceMinor, p.amountMinor, cost, first, d]); gross += p.amountMinor; discount += d;
        });
      });
      if (short.length) throw new PosError('insufficient', 'not enough stock to sell', { short });
      const total = gross - discount + fee; const credit = Math.min(swapCreditMax, total); const card = pays.filter(p => p.method === 'card').reduce((a, p) => a + p.amountMinor, 0); const cashIn = pays.filter(p => p.method === 'cash').reduce((a, p) => a + p.amountMinor, 0);
      if (card > total - credit) throw new PosError('invalid', 'the card payment is more than the total', { totalMinor: total - credit }); const due = total - credit - card; const cashApplied = Math.min(cashIn, due); const change = cashIn - cashApplied; const cod = due - cashApplied; /* split below into account and delivery parts */
      const onAcct = s.onCredit ? cod : 0; const cod2 = cod - onAcct;
      if (s.onCredit) { this.need(actor, 'sale.credit.create'); if (!s.customerId) throw new PosError('invalid', 'a credit sale needs a customer'); }
      if (cod2 > 0 && !s.delivery) throw new PosError('underpaid', 'the payments are less than the total', { totalMinor: total });
      if (s.customerId) { const c = this.db.prepare('SELECT * FROM customers WHERE id=?').get(s.customerId); if (!c) throw new PosError('not-found', 'customer'); if (Number(c.active) !== 1) throw new PosError('state', 'this customer is suspended');
        if (onAcct > 0) { const bal = this.customerBalance(s.customerId); if (bal + onAcct > Number(c.credit_limit_minor)) throw new PosError('credit-limit', 'this would pass the customer credit limit', { balanceMinor: bal, limitMinor: Number(c.credit_limit_minor), roomMinor: Math.max(0, Number(c.credit_limit_minor) - bal) }); } }
      const now = this.hub.now(); this.db.prepare('INSERT INTO sales(id,sale_no,req_key,session_id,total_minor,tendered_minor,change_minor,created_by,created_at,gross_minor,discount_minor,delivery_fee_minor,channel,swap_credit_minor,customer_id,credit_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, no, s.key, s.sessionId, total, cashIn, change, actor.id, now, gross, discount, fee, s.delivery ? 'home_delivery' : 'counter', credit, s.customerId ?? null, onAcct);
      for (const r of rows) this.db.prepare('INSERT INTO sale_lines(id,sale_id,line_no,pick_no,item_id,batch_id,req_qty,req_unit,qty_base,price_unit_factor,unit_price_minor,amount_minor,cost_amount_minor,movement_id,discount_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...r);
      const pay = (method: string, sessionId: string | null, amount: number, tendered: number, chg: number, ref: string | null) => this.db.prepare('INSERT INTO sale_payments(id,sale_id,session_id,method,amount_minor,tendered_minor,change_minor,ref,by,at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uuidv7(), id, sessionId, method, amount, tendered, chg, ref, actor.id, now);
      if (cashApplied > 0) pay('cash', s.sessionId, cashApplied, cashIn, change, null); if (card > 0) pay('card', s.sessionId, card, 0, 0, pays.flatMap(p => (p.method === 'card' ? [p.ref.trim()] : []))[0] ?? null); if (cod2 > 0) pay('cod', null, cod2, 0, 0, null);
      if (onAcct > 0) this.db.prepare("INSERT INTO customer_ledger(id,customer_id,kind,amount_minor,ref,session_id,by,at) VALUES(?,?,'sale',?,?,?,?,?)").run(uuidv7(), s.customerId!, onAcct, no, s.sessionId, actor.id, now);
      if (s.delivery) this.db.prepare('INSERT INTO sale_deliveries(sale_id,name,phone,address,note,status_at,status_by) VALUES(?,?,?,?,?,?,?)').run(id, s.delivery.name.trim(), s.delivery.phone.trim(), s.delivery.address.trim(), s.delivery.note ?? null, now, actor.id);
      if (s.fromHold) this.db.prepare("UPDATE held_bills SET status='used', closed_at=?, sale_no=? WHERE id=?").run(now, no, s.fromHold);
      this.hub.audit(actor.id, 'sale.posted', 'sale', no, { sessionId: s.sessionId, totalMinor: total, discountMinor: discount, lines: s.lines.length, channel: s.delivery ? 'home_delivery' : 'counter', cod: cod2, onAccountMinor: onAcct, customerId: s.customerId ?? null }); this.hub.emit('sale.posted', { saleNo: no, sessionNo: String(sess.session_no), totalMinor: total, discountMinor: discount, cardMinor: card, codMinor: cod2, onAccountMinor: onAcct, lines: s.lines.length });
      return { id, saleNo: no, totalMinor: total, tenderedMinor: cashIn, changeMinor: change, discountMinor: discount, codMinor: cod2, onAccountMinor: onAcct, lines: s.lines.length, replay: false, creditMinor: credit };
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
      if (this.db.prepare("SELECT 1 FROM sale_payments p JOIN cashier_sessions c ON c.id = p.session_id WHERE p.sale_id=? AND c.status='closed'").get(String(sale.id))) throw new PosError('state', 'money for this sale is already in a closed session: use a return instead');
      if (this.db.prepare('SELECT 1 FROM sale_returns WHERE sale_id=?').get(String(sale.id))) throw new PosError('state', 'part of this sale was returned: it cannot be voided');
      const dv = this.db.prepare('SELECT status FROM sale_deliveries WHERE sale_id=?').get(String(sale.id)); if (dv && dv.status === 'delivered') throw new PosError('state', 'the order was delivered: use a return instead');
      for (const mv of this.db.prepare("SELECT id FROM movements WHERE ref=? AND kind='sale' ORDER BY rowid").all(saleNo)) { const m = this.hub.reverse(`VOID:${saleNo}:${String(mv.id)}`, String(mv.id), actor.id, `void ${saleNo}: ${reason.trim()}`); if (!m.ok) throw new PosError('state', `cannot reverse a movement (${m.reason})`); }
      if (Number(sale.credit_minor) > 0) this.db.prepare("INSERT INTO customer_ledger(id,customer_id,kind,amount_minor,ref,note,by,at) VALUES(?,?,'void',?,?,?,?,?)").run(uuidv7(), String(sale.customer_id), -Number(sale.credit_minor), saleNo, reason.trim(), actor.id, this.hub.now());
      this.db.prepare("UPDATE sales SET status='void', void_by=?, void_at=?, void_reason=? WHERE id=?").run(actor.id, this.hub.now(), reason.trim(), String(sale.id));
      if (dv) this.db.prepare("UPDATE sale_deliveries SET status='failed', failed_reason=?, status_at=?, status_by=? WHERE sale_id=?").run(`sale voided: ${reason.trim()}`, this.hub.now(), actor.id, String(sale.id));
      this.hub.audit(actor.id, 'sale.voided', 'sale', saleNo, { reason: reason.trim(), totalMinor: Number(sale.total_minor) }); this.hub.emit('sale.voided', { saleNo, totalMinor: Number(sale.total_minor) });
    });
  }

  // ---------- held bills ----------
  /** Parks the basket without touching stock (the customer went to fetch something). The session cannot close while a held bill is open. */
  holdBill(actor: Person, h: { key: string; sessionId: string; lines: SaleLineInput[]; note?: string }): { id: string; holdNo: string; replay: boolean } {
    this.need(actor, 'sale.hold'); if (!h.lines?.length) throw new PosError('invalid', 'a held bill needs at least one line');
    for (const [i, l] of h.lines.entries()) { if (!this.items.get(l.itemId)) throw new PosError('not-found', `line ${i + 1}: item`); if (!Number.isInteger(l.qty) || l.qty <= 0) throw new PosError('invalid', `line ${i + 1}: quantity must be a positive whole number`); }
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT id, hold_no FROM held_bills WHERE req_key=?').get(h.key); if (prior) return { id: String(prior.id), holdNo: String(prior.hold_no), replay: true };
      const sess = this.session(h.sessionId); if (sess.status !== 'open') throw new PosError('session', 'the session is closed'); if (String(sess.user_id) !== actor.id) throw new PosError('session', 'this session belongs to another cashier');
      const id = uuidv7(), no = this.next('hold', 'H'); this.db.prepare('INSERT INTO held_bills(id,hold_no,req_key,session_id,user_id,lines,note,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, no, h.key, h.sessionId, actor.id, JSON.stringify(h.lines), h.note ?? null, this.hub.now());
      this.hub.audit(actor.id, 'hold.created', 'held_bill', no, { lines: h.lines.length }); this.hub.emit('hold.created', { holdNo: no, sessionNo: String(sess.session_no) }); return { id, holdNo: no, replay: false };
    });
  }
  /** The basket back, to be sold with `createSale({ fromHold })`. Prices and stock are read again at sale time. */
  resumeBill(actor: Person, holdId: string): { id: string; holdNo: string; lines: SaleLineInput[]; note: string | null } {
    this.need(actor, 'sale.resume'); const h = this.db.prepare('SELECT * FROM held_bills WHERE id=?').get(holdId); if (!h) throw new PosError('not-found', 'held bill'); if (h.status !== 'open') throw new PosError('state', `that held bill is ${String(h.status)}`);
    if (String(h.user_id) !== actor.id && !can(actor, 'sale.view_all', this.hub.branchId)) throw new PosError('forbidden', 'only the cashier who parked it or management may resume it');
    return { id: String(h.id), holdNo: String(h.hold_no), lines: JSON.parse(String(h.lines)) as SaleLineInput[], note: (h.note as string) ?? null };
  }
  cancelHold(actor: Person, holdId: string, reason: string): void {
    this.need(actor, 'sale.hold'); if (!reason?.trim()) throw new PosError('invalid', 'a reason is required');
    this.db.tx(() => { const h = this.db.prepare('SELECT * FROM held_bills WHERE id=?').get(holdId); if (!h) throw new PosError('not-found', 'held bill'); if (h.status !== 'open') throw new PosError('state', `that held bill is ${String(h.status)}`);
      if (String(h.user_id) !== actor.id && !can(actor, 'sale.view_all', this.hub.branchId)) throw new PosError('forbidden', 'only the cashier who parked it or management may cancel it');
      this.db.prepare("UPDATE held_bills SET status='cancelled', closed_at=?, closed_reason=? WHERE id=?").run(this.hub.now(), reason.trim(), holdId); this.hub.audit(actor.id, 'hold.cancelled', 'held_bill', String(h.hold_no), { reason: reason.trim() }); });
  }
  heldBills(actor: Person, o: { sessionId?: string; status?: 'open' | 'used' | 'cancelled' } = {}) {
    this.need(actor, 'sale.resume'); const all = can(actor, 'sale.view_all', this.hub.branchId); const w: string[] = []; const a: unknown[] = []; if (!all) { w.push('user_id=?'); a.push(actor.id); } if (o.sessionId) { w.push('session_id=?'); a.push(o.sessionId); } w.push('status=?'); a.push(o.status ?? 'open');
    return this.db.prepare(`SELECT id, hold_no, session_id, user_id, note, status, created_at, sale_no, lines FROM held_bills WHERE ${w.join(' AND ')} ORDER BY rowid`).all(...a).map(r => ({ id: String(r.id), holdNo: String(r.hold_no), sessionId: String(r.session_id), userId: String(r.user_id), note: (r.note as string) ?? null, status: String(r.status), createdAt: String(r.created_at), saleNo: (r.sale_no as string) ?? null, lineCount: (JSON.parse(String(r.lines)) as unknown[]).length }));
  }

  // ---------- home delivery ----------
  /** Pending, out for delivery (with the agent), delivered, or failed. A failed delivery voids the sale and returns the stock (only while the session is open; later it is a return, Sprint 4.3). */
  setDeliveryStatus(actor: Person, saleNo: string, status: 'out_for_delivery' | 'failed', o: { agent?: string; reason?: string } = {}): void {
    this.need(actor, status === 'failed' ? 'sale.void' : 'sale.create');
    if (status === 'failed') { if (!o.reason?.trim()) throw new PosError('invalid', 'a reason is required'); this.voidSale(actor, saleNo, `delivery failed: ${o.reason.trim()}`); return; }
    if (!o.agent?.trim()) throw new PosError('invalid', 'the delivery agent is required');
    this.db.tx(() => { const d = this.deliveryOf(saleNo); if (d.status !== 'pending') throw new PosError('state', `the delivery is ${String(d.status)}`); this.db.prepare("UPDATE sale_deliveries SET status='out_for_delivery', agent=?, status_at=?, status_by=? WHERE sale_id=?").run(o.agent!.trim(), this.hub.now(), actor.id, String(d.sale_id)); this.hub.audit(actor.id, 'delivery.out', 'sale', saleNo, { agent: o.agent!.trim() }); this.hub.emit('delivery.out', { saleNo, agent: o.agent!.trim() }); });
  }
  private deliveryOf(saleNo: string) { const r = this.db.prepare("SELECT d.*, s.status sale_status FROM sale_deliveries d JOIN sales s ON s.id = d.sale_id WHERE s.sale_no=?").get(saleNo); if (!r) throw new PosError('not-found', `no delivery for ${saleNo}`); if (r.sale_status !== 'posted') throw new PosError('state', 'the sale is void'); return r; }
  /** The agent is back with the cash on delivery: it goes into the CURRENT open session of whoever receives it (change returned if the agent was paid more). */
  collectDelivery(actor: Person, saleNo: string, c: { cashMinor: number }): { codMinor: number; changeMinor: number } {
    this.need(actor, 'sale.create'); if (!Number.isInteger(c.cashMinor) || c.cashMinor < 0) throw new PosError('invalid', 'cash must be whole piasters');
    return this.db.tx(() => {
      const d = this.deliveryOf(saleNo); if (d.status !== 'out_for_delivery') throw new PosError('state', `the delivery is ${String(d.status)}: it must be out for delivery`);
      const sess = this.openSessionOf(actor.id); if (!sess) throw new PosError('session', 'open your cashier session to receive the cash');
      const cod = Number(this.db.prepare("SELECT COALESCE(SUM(amount_minor),0) c FROM sale_payments WHERE sale_id=? AND method='cod'").get(String(d.sale_id))!.c); if (c.cashMinor < cod) throw new PosError('underpaid', 'the cash is less than the amount due on delivery', { codMinor: cod });
      const chg = c.cashMinor - cod; const now = this.hub.now();
      if (cod > 0) this.db.prepare("INSERT INTO sale_payments(id,sale_id,session_id,method,amount_minor,tendered_minor,change_minor,ref,by,at) VALUES(?,?,?,'cash',?,?,?,?,?,?)").run(uuidv7(), String(d.sale_id), sess.id, cod, c.cashMinor, chg, 'cash on delivery', actor.id, now);
      this.db.prepare("UPDATE sale_deliveries SET status='delivered', status_at=?, status_by=? WHERE sale_id=?").run(now, actor.id, String(d.sale_id));
      this.hub.audit(actor.id, 'delivery.collected', 'sale', saleNo, { codMinor: cod, sessionNo: sess.sessionNo }); this.hub.emit('delivery.collected', { saleNo, codMinor: cod, sessionNo: sess.sessionNo }); return { codMinor: cod, changeMinor: chg };
    });
  }
  deliveries(actor: Person, o: { status?: 'pending' | 'out_for_delivery' | 'delivered' | 'failed' } = {}) {
    this.need(actor, 'sale.view_all'); const w = o.status ? 'WHERE d.status=?' : '';
    return this.db.prepare(`SELECT s.sale_no, s.total_minor, d.name, d.phone, d.address, d.status, d.agent, d.status_at, COALESCE((SELECT SUM(amount_minor) FROM sale_payments p WHERE p.sale_id = s.id AND p.method='cod'),0) cod FROM sale_deliveries d JOIN sales s ON s.id = d.sale_id ${w} ORDER BY s.rowid DESC`).all(...(o.status ? [o.status] : [])).map(r => ({ saleNo: String(r.sale_no), totalMinor: Number(r.total_minor), name: String(r.name), phone: String(r.phone), address: String(r.address), status: String(r.status), agent: (r.agent as string) ?? null, statusAt: String(r.status_at), codMinor: Number(r.cod) }));
  }

  // ---------- reading ----------
  sale(actor: Person, saleNo: string) {
    const all = can(actor, 'sale.view_all', this.hub.branchId); if (!all) this.need(actor, 'sale.view_own'); const h = this.db.prepare('SELECT * FROM sales WHERE sale_no=?').get(saleNo); if (!h) throw new PosError('not-found', saleNo);
    if (!all && String(h.created_by) !== actor.id) throw new PosError('forbidden', 'you may only see your own sales'); const cost = can(actor, 'stock.cost.view', this.hub.branchId);
    const lines = this.db.prepare('SELECT l.*, i.name_ar, b.lot, b.expiry FROM sale_lines l JOIN items i ON i.id=l.item_id LEFT JOIN batches b ON b.id=l.batch_id WHERE l.sale_id=? ORDER BY l.line_no, l.pick_no').all(String(h.id)).map(l => ({ lineNo: Number(l.line_no), pickNo: Number(l.pick_no), itemId: String(l.item_id), itemName: String(l.name_ar), batchId: (l.batch_id as string) ?? null, lot: (l.lot as string) ?? null, expiry: (l.expiry as string) ?? null, reqQty: Number(l.req_qty), reqUnit: String(l.req_unit), qtyBase: Number(l.qty_base), unitPriceMinor: Number(l.unit_price_minor), priceUnitFactor: Number(l.price_unit_factor), amountMinor: Number(l.amount_minor), discountMinor: Number(l.discount_minor), costMinor: cost ? Number(l.cost_amount_minor) : null }));
    const payments = this.db.prepare('SELECT method, amount_minor, ref, session_id FROM sale_payments WHERE sale_id=? ORDER BY rowid').all(String(h.id)).map(p => ({ method: String(p.method), amountMinor: Number(p.amount_minor), ref: (p.ref as string) ?? null }));
    const dl = this.db.prepare('SELECT * FROM sale_deliveries WHERE sale_id=?').get(String(h.id)); const returned = Number(this.db.prepare('SELECT COALESCE(SUM(total_minor),0) t FROM sale_returns WHERE sale_id=?').get(String(h.id))!.t);
    return { saleNo, customerId: (h.customer_id as string) ?? null, onAccountMinor: Number(h.credit_minor), returnedMinor: returned, swapCreditMinor: Number(h.swap_credit_minor), status: String(h.status), channel: String(h.channel), grossMinor: Number(h.gross_minor), discountMinor: Number(h.discount_minor), deliveryFeeMinor: Number(h.delivery_fee_minor), payments, delivery: dl ? { name: String(dl.name), phone: String(dl.phone), address: String(dl.address), status: String(dl.status), agent: (dl.agent as string) ?? null } : null, sessionId: String(h.session_id), totalMinor: Number(h.total_minor), tenderedMinor: Number(h.tendered_minor), changeMinor: Number(h.change_minor), createdBy: String(h.created_by), createdAt: String(h.created_at), voidReason: (h.void_reason as string) ?? null, lines, profitMinor: cost && h.status === 'posted' ? Number(h.total_minor) - Number(h.delivery_fee_minor) - lines.reduce((s, l) => s + (l.costMinor ?? 0), 0) : null };
  }
  sales(actor: Person, o: { sessionId?: string; status?: 'posted' | 'void' } = {}) {
    const all = can(actor, 'sale.view_all', this.hub.branchId); if (!all) this.need(actor, 'sale.view_own'); const w: string[] = []; const a: unknown[] = []; if (!all) { w.push('created_by=?'); a.push(actor.id); } if (o.sessionId) { w.push('session_id=?'); a.push(o.sessionId); } if (o.status) { w.push('status=?'); a.push(o.status); }
    return this.db.prepare(`SELECT sale_no, status, total_minor, created_by, created_at FROM sales ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY rowid DESC`).all(...a).map(r => ({ saleNo: String(r.sale_no), status: String(r.status), totalMinor: Number(r.total_minor), createdBy: String(r.created_by), createdAt: String(r.created_at) }));
  }
}
