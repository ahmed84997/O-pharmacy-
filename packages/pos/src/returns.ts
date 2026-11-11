import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import type { ItemService } from '@o-pharmacy/inventory';
import { PosError, type PaymentInput, type SaleInput, type SaleLineInput, type SaleService } from './sales';

export type ReturnReason = 'wrong_item' | 'changed_mind' | 'damaged' | 'doctor_changed' | 'other';
const REASONS: ReturnReason[] = ['wrong_item', 'changed_mind', 'damaged', 'doctor_changed', 'other'];
export interface ReturnLineInput { lineNo: number; qty: number; unitName?: string; /** only this batch's pick of the line */ batchId?: string }
export interface ReturnInput {
  key: string; saleNo: string; sessionId: string; lines: ReturnLineInput[]; reasonCode: ReturnReason; note?: string;
  /** resellable goes back to the main store; damaged goes to a returns store and is never sold. */
  condition?: 'resellable' | 'damaged';
  /** How the money goes back: cash from the drawer or the card (needs the card reference). Not needed for a swap that nets to zero. */
  refund?: { method: 'cash' } | { method: 'card'; ref: string };
}
export interface ReturnResult { id: string; returnNo: string; totalMinor: number; cashMinor: number; cardMinor: number; creditMinor: number; replay: boolean }
export interface SwapInput extends Omit<ReturnInput, 'key'> { key: string; newLines: SaleLineInput[]; payments?: PaymentInput[]; cashMinor?: number; discountBp?: number }

const div = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

/** Returns from a sale and item swaps. Goods go back to the batch they were sold from, the refund is the exact net price paid (discount included) so a full return refunds exactly what was paid. After the session closes a return is the way to undo a sale. */
export class ReturnService {
  constructor(private hub: Hub, private items: ItemService, private sales: SaleService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new PosError('forbidden', `missing permission ${perm}`); }

  private plan(actor: Person, r: ReturnInput) {
    if (!r.lines?.length) throw new PosError('invalid', 'a return needs at least one line'); if (!REASONS.includes(r.reasonCode)) throw new PosError('invalid', 'bad reason code');
    const sale = this.db.prepare('SELECT * FROM sales WHERE sale_no=?').get(r.saleNo); if (!sale) throw new PosError('not-found', r.saleNo); if (sale.status !== 'posted') throw new PosError('state', 'the sale is void');
    const dv = this.db.prepare('SELECT status FROM sale_deliveries WHERE sale_id=?').get(String(sale.id)); if (dv && dv.status !== 'delivered') throw new PosError('state', 'the delivery is not finished: mark it failed instead (the sale is voided and the stock comes back)');
    const sess = this.sales.session(r.sessionId); if (sess.status !== 'open') throw new PosError('session', 'the session is closed'); if (String(sess.user_id) !== actor.id) throw new PosError('session', 'this session belongs to another user');
    const cond = r.condition ?? 'resellable'; let dest: string | null = null;
    if (cond === 'damaged') { const st = this.db.prepare("SELECT id FROM stores WHERE kind='returns' AND active=1 ORDER BY id LIMIT 1").get(); if (!st) throw new PosError('invalid', 'create a returns store first (damaged goods must not go back to the shelf)'); dest = String(st.id); } else dest = 'MAIN';
    const out: { saleLineId: string; itemId: string; batchId: string | null; qtyBase: number; refund: number; store: string | null }[] = [];
    const used = new Map<string, number>(); // base units already planned in this request per sale line
    for (const [i, l] of r.lines.entries()) {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new PosError('invalid', `line ${i + 1}: quantity must be a positive whole number`);
      const picks = this.db.prepare('SELECT * FROM sale_lines WHERE sale_id=? AND line_no=? ORDER BY pick_no DESC').all(String(sale.id), l.lineNo).filter(p => !l.batchId || p.batch_id === l.batchId); if (!picks.length) throw new PosError('not-found', `line ${i + 1}: that sale line does not exist`);
      const item = this.items.get(String(picks[0]!.item_id))!; const unit = l.unitName ? item.units.find(x => x.name === l.unitName) : item.units[item.units.length - 1]; if (!unit) throw new PosError('invalid', `line ${i + 1}: unknown unit`);
      let need = l.qty * unit.factor;
      for (const p of picks) {
        if (need <= 0) break; const before = Number(this.db.prepare('SELECT COALESCE(SUM(qty_base),0) q FROM sale_return_lines WHERE sale_line_id=?').get(String(p.id))!.q) + (used.get(String(p.id)) ?? 0); const room = Number(p.qty_base) - before; if (room <= 0) continue;
        const take = Math.min(need, room); const net = Number(p.amount_minor) - Number(p.discount_minor); const refund = div(net * (before + take), Number(p.qty_base)) - div(net * before, Number(p.qty_base));
        out.push({ saleLineId: String(p.id), itemId: String(p.item_id), batchId: (p.batch_id as string) ?? null, qtyBase: take, refund, store: item.kind === 'service' ? null : dest }); used.set(String(p.id), (used.get(String(p.id)) ?? 0) + take); need -= take;
      }
      if (need > 0) throw new PosError('invalid', `line ${i + 1}: more than was sold (or already returned)`, { line: i + 1, missingBase: need });
    }
    return { sale, sess, cond, items: out, total: out.reduce((a, x) => a + x.refund, 0) };
  }

  /** The goods go back on the shelf first, so a swap can sell the very batch that just came back (nearest expiry first). */
  private moveStock(actor: Person, r: ReturnInput, pl: ReturnType<ReturnService['plan']>, no: string): void {
    for (const [i, x] of pl.items.entries()) if (x.store) { const m = this.hub.record({ key: `${r.key}:${i}:ret`, storeId: x.store, itemId: x.itemId, batchId: x.batchId, qty: x.qtyBase, kind: 'return', ref: no, reason: r.reasonCode, actor: actor.id }); if (!m.ok) throw new PosError('state', 'the stock movement was refused'); }
  }
  private write(actor: Person, r: ReturnInput, pl: ReturnType<ReturnService['plan']>, kind: 'return' | 'swap', credit: number, swapSaleNo: string | null, no: string): ReturnResult {
    const refundDue = pl.total - credit; let cash = 0, card = 0, ref: string | null = null;
    if (refundDue > 0) {
      const m = r.refund?.method; if (!m) throw new PosError('invalid', 'say how the money goes back (cash or card)');
      if (m === 'card') { ref = (r.refund as { ref?: string }).ref?.trim() ?? ''; if (!ref) throw new PosError('invalid', 'a card refund needs its reference'); const paid = Number(this.db.prepare("SELECT COALESCE(SUM(amount_minor),0) t FROM sale_payments WHERE sale_id=? AND method='card'").get(String(pl.sale.id))!.t); const done = Number(this.db.prepare('SELECT COALESCE(SUM(card_minor),0) t FROM sale_returns WHERE sale_id=?').get(String(pl.sale.id))!.t); if (refundDue > paid - done) throw new PosError('invalid', 'a card refund cannot exceed what was paid by card', { cardLeftMinor: paid - done }); card = refundDue; }
      else cash = refundDue;
    }
    const id = uuidv7(); const now = this.hub.now();
    this.db.prepare('INSERT INTO sale_returns(id,return_no,req_key,sale_id,session_id,kind,reason_code,note,total_minor,cash_minor,card_minor,credit_minor,card_ref,swap_sale_no,by,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, no, r.key, String(pl.sale.id), r.sessionId, kind, r.reasonCode, r.note ?? null, pl.total, cash, card, credit, ref, swapSaleNo, actor.id, now);
    for (const x of pl.items) {
      this.db.prepare('INSERT INTO sale_return_lines(id,return_id,sale_line_id,item_id,batch_id,qty_base,refund_minor,store_id,condition) VALUES(?,?,?,?,?,?,?,?,?)').run(uuidv7(), id, x.saleLineId, x.itemId, x.batchId, x.qtyBase, x.refund, x.store, pl.cond);
    }
    this.hub.audit(actor.id, `sale.${kind}`, 'sale_return', no, { saleNo: r.saleNo, totalMinor: pl.total, cashMinor: cash, cardMinor: card, creditMinor: credit, reason: r.reasonCode, condition: pl.cond }); this.hub.emit(`sale.${kind === 'swap' ? 'swapped' : 'returned'}`, { returnNo: no, saleNo: r.saleNo, totalMinor: pl.total, cashMinor: cash, cardMinor: card, creditMinor: credit });
    return { id, returnNo: no, totalMinor: pl.total, cashMinor: cash, cardMinor: card, creditMinor: credit, replay: false };
  }
  private replay(key: string): ReturnResult | null { const p = this.db.prepare('SELECT * FROM sale_returns WHERE req_key=?').get(key); return p ? { id: String(p.id), returnNo: String(p.return_no), totalMinor: Number(p.total_minor), cashMinor: Number(p.cash_minor), cardMinor: Number(p.card_minor), creditMinor: Number(p.credit_minor), replay: true } : null; }

  /** Return goods from a sale (`sale.return`): stock back to the batch it came from, money back as cash or card. */
  returnSale(actor: Person, r: ReturnInput): ReturnResult {
    this.need(actor, 'sale.return');
    return this.db.tx(() => { const again = this.replay(r.key); if (again) return again; const pl = this.plan(actor, r); const no = this.sales.next('return', 'R'); this.moveStock(actor, r, pl, no); return this.write(actor, r, pl, 'return', 0, null, no); });
  }
  /** Swap (`sale.swap`): goods come back and new goods go out in one step; the refund value is credit against the new sale. The customer pays the difference, or gets it back if the new goods cost less. */
  swap(actor: Person, s: SwapInput): ReturnResult & { newSaleNo: string; newTotalMinor: number } {
    this.need(actor, 'sale.swap'); if (!s.newLines?.length) throw new PosError('invalid', 'a swap needs new goods: use a return instead');
    return this.db.tx(() => {
      const again = this.replay(s.key); if (again) { const p = this.db.prepare('SELECT swap_sale_no FROM sale_returns WHERE req_key=?').get(s.key)!; const ns = this.db.prepare('SELECT total_minor FROM sales WHERE sale_no=?').get(String(p.swap_sale_no))!; return { ...again, newSaleNo: String(p.swap_sale_no), newTotalMinor: Number(ns.total_minor) }; }
      const pl = this.plan(actor, s); const sin: SaleInput = { key: `${s.key}:sale`, sessionId: s.sessionId, lines: s.newLines, payments: s.payments, cashMinor: s.cashMinor, discountBp: s.discountBp };
      const no = this.sales.next('return', 'R'); this.moveStock(actor, s, pl, no); const sale = this.sales.createSaleCore(actor, sin, pl.total); const res = this.write(actor, s, pl, 'swap', sale.creditMinor, sale.saleNo, no);
      return { ...res, newSaleNo: sale.saleNo, newTotalMinor: sale.totalMinor };
    });
  }

  /** What has been returned from a sale (own sales, or all with sale.view_all). */
  returnsOf(actor: Person, saleNo: string) {
    const all = can(actor, 'sale.view_all', this.hub.branchId); if (!all) this.need(actor, 'sale.view_own'); const sale = this.db.prepare('SELECT * FROM sales WHERE sale_no=?').get(saleNo); if (!sale) throw new PosError('not-found', saleNo); if (!all && String(sale.created_by) !== actor.id) throw new PosError('forbidden', 'you may only see your own sales');
    return this.db.prepare('SELECT * FROM sale_returns WHERE sale_id=? ORDER BY rowid').all(String(sale.id)).map(r => ({ returnNo: String(r.return_no), kind: String(r.kind), reasonCode: String(r.reason_code), totalMinor: Number(r.total_minor), cashMinor: Number(r.cash_minor), cardMinor: Number(r.card_minor), creditMinor: Number(r.credit_minor), swapSaleNo: (r.swap_sale_no as string) ?? null, by: String(r.by), at: String(r.at),
      lines: this.db.prepare('SELECT l.*, i.name_ar, b.lot FROM sale_return_lines l JOIN items i ON i.id = l.item_id LEFT JOIN batches b ON b.id = l.batch_id WHERE l.return_id=? ORDER BY l.rowid').all(String(r.id)).map(x => ({ itemName: String(x.name_ar), lot: (x.lot as string) ?? null, qtyBase: Number(x.qty_base), refundMinor: Number(x.refund_minor), condition: String(x.condition) })) }));
  }
  /** Reviewers: all returns of a session (the drawer closing needs them). */
  sessionReturns(actor: Person, sessionId: string) { this.need(actor, 'drawer.close.review'); return this.db.prepare('SELECT return_no, kind, total_minor, cash_minor, card_minor, credit_minor, by, at FROM sale_returns WHERE session_id=? ORDER BY rowid').all(sessionId).map(r => ({ returnNo: String(r.return_no), kind: String(r.kind), totalMinor: Number(r.total_minor), cashMinor: Number(r.cash_minor), cardMinor: Number(r.card_minor), creditMinor: Number(r.credit_minor), by: String(r.by), at: String(r.at) })); }
}
