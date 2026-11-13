import { approvalAllowed, can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { BatchError, type BatchService, type ReceiveInput } from './batches';
import type { ItemService } from './items';

export type BuyErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'duplicate' | 'insufficient' | 'sold' | 'separation';
export class BuyError extends Error { constructor(public code: BuyErrorCode, m: string, public detail?: unknown) { super(m); } }
export interface Supplier { id: string; code: string; name: string; phone: string | null; address: string | null; taxNo: string | null; notes: string | null; active: boolean }
export interface SupplierInput { name: string; phone?: string; address?: string; taxNo?: string; notes?: string }
export interface InvoiceLineInput { itemId: string; lot: string; expiry: string; qty: number; unitName?: string; bonusQty?: number; costMinor: number; /** the supplier discount on this line, in basis points (12.5% = 1250); kept for reports */ discountBp?: number; /** tax on the whole line, piasters; goes into the cost (the pharmacy cannot reclaim it) */ taxMinor?: number; publicPriceMinor?: number; pharmacistPriceMinor?: number; priceUnitName?: string }
export interface InvoiceInput { key: string; supplierId: string; supplierRef?: string; poId?: string; storeId?: string; lines: InvoiceLineInput[]; deviceId?: string; /** a held invoice this one completes */ draftId?: string }
/** A held (suspended) purchase invoice: the lines as typed, no stock moves until it is posted. */
/** The expiry stored for an item that has none (the item card says so). */
export const NO_EXPIRY = '9999-12-31';
export interface DraftInput { key: string; id?: string; supplierId?: string; supplierRef?: string; poId?: string; note?: string; lines: unknown[] }
export interface InvoiceResult { id: string; piNo: string; totalMinor: number; lines: number; warnings: string[]; replay: boolean }
export interface ReturnInput { key: string; supplierId: string; invoiceId?: string; storeId?: string; reason: string; lines: { batchId: string; qty: number; unitName?: string }[] }

/** round half up, integer arithmetic only (money is whole piasters) */
const div = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

/** Suppliers, purchase orders, purchase invoices (each line creates or tops up a batch and its ledger movement in the same transaction) and returns to suppliers. */
export class PurchasingService {
  constructor(private hub: Hub, private items: ItemService, private batches: BatchService, private rules: { separationOfDuties: () => boolean; activeApprovers: () => number } = { separationOfDuties: () => true, activeApprovers: () => 2 }) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new BuyError('forbidden', `missing permission ${perm}`); }
  private next(k: string, prefix: string): string {
    const n = Number(this.db.prepare('SELECT v FROM inv_counters WHERE k=?').get(k)?.v ?? 0) + 1;
    this.db.prepare('INSERT INTO inv_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`;
  }
  private toSupplier = (r: Record<string, unknown>): Supplier => ({ id: String(r.id), code: String(r.code), name: String(r.name), phone: (r.phone as string) ?? null, address: (r.address as string) ?? null, taxNo: (r.tax_no as string) ?? null, notes: (r.notes as string) ?? null, active: Number(r.active) === 1 });
  private supplier(id: string, mustBeActive = false): Record<string, unknown> {
    const r = this.db.prepare('SELECT * FROM suppliers WHERE id=?').get(id); if (!r) throw new BuyError('not-found', `supplier ${id}`);
    if (mustBeActive && Number(r.active) !== 1) throw new BuyError('state', 'this supplier is switched off'); return r;
  }
  private store(id: string): void { if (!this.db.prepare('SELECT 1 FROM stores WHERE id=? AND active=1').get(id)) throw new BuyError('invalid', `unknown or inactive store ${id}`); }

  // ---------- suppliers ----------
  createSupplier(actor: Person, s: SupplierInput): Supplier {
    this.need(actor, 'supplier.create'); const name = s.name?.trim(); if (!name) throw new BuyError('invalid', 'supplier name is required');
    const id = uuidv7();
    try {
      this.db.tx(() => {
        const code = this.next('supplier', 'S');
        this.db.prepare('INSERT INTO suppliers(id,code,name,phone,address,tax_no,notes,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, code, name, s.phone ?? null, s.address ?? null, s.taxNo ?? null, s.notes ?? null, this.hub.now());
        this.hub.audit(actor.id, 'supplier.created', 'supplier', id, { code, name }); this.hub.emit('supplier.created', { id, code, name });
      });
    } catch (e) { if (e instanceof Error && /UNIQUE/.test(e.message)) throw new BuyError('duplicate', 'a supplier with this name exists'); throw e; }
    return this.toSupplier(this.supplier(id));
  }
  updateSupplier(actor: Person, id: string, p: Partial<SupplierInput>): Supplier {
    this.need(actor, 'supplier.update'); const cur = this.supplier(id); const name = p.name === undefined ? String(cur.name) : p.name.trim(); if (!name) throw new BuyError('invalid', 'supplier name is required');
    try {
      this.db.tx(() => {
        this.db.prepare('UPDATE suppliers SET name=?, phone=?, address=?, tax_no=?, notes=? WHERE id=?').run(name, p.phone ?? cur.phone ?? null, p.address ?? cur.address ?? null, p.taxNo ?? cur.tax_no ?? null, p.notes ?? cur.notes ?? null, id);
        this.hub.audit(actor.id, 'supplier.updated', 'supplier', id, { fields: Object.keys(p) }); this.hub.emit('supplier.updated', { id });
      });
    } catch (e) { if (e instanceof Error && /UNIQUE/.test(e.message)) throw new BuyError('duplicate', 'a supplier with this name exists'); throw e; }
    return this.toSupplier(this.supplier(id));
  }
  /** Suppliers are never deleted; switching one off keeps all its history. */
  setSupplierActive(actor: Person, id: string, active: boolean, reason: string): void {
    this.need(actor, 'supplier.update'); this.supplier(id); if (!reason?.trim()) throw new BuyError('invalid', 'a reason is required');
    this.db.tx(() => { this.db.prepare('UPDATE suppliers SET active=? WHERE id=?').run(active ? 1 : 0, id); this.hub.audit(actor.id, 'supplier.active', 'supplier', id, { active, reason: reason.trim() }); this.hub.emit('supplier.active', { id, active }); });
  }
  suppliers(actor: Person, o: { q?: string; includeInactive?: boolean } = {}): Supplier[] {
    this.need(actor, 'supplier.view'); const q = o.q?.trim();
    return this.db.prepare(`SELECT * FROM suppliers WHERE (? OR active=1) AND (? IS NULL OR name LIKE ? OR code LIKE ? OR phone LIKE ?) ORDER BY name`).all(o.includeInactive ? 1 : 0, q ?? null, `%${q}%`, `%${q}%`, `%${q}%`).map(this.toSupplier);
  }

  // ---------- purchase orders ----------
  createOrder(actor: Person, o: { key: string; supplierId: string; note?: string; lines: { itemId: string; qty: number; unitName?: string }[] }): { id: string; poNo: string; replay: boolean } {
    this.need(actor, 'purchase_order.create'); this.supplier(o.supplierId, true); if (!o.lines?.length) throw new BuyError('invalid', 'an order needs at least one line');
    const base = o.lines.map(l => { const it = this.items.get(l.itemId); if (!it) throw new BuyError('not-found', l.itemId); if (it.kind === 'service') throw new BuyError('invalid', 'a service cannot be ordered');
      const u = l.unitName ? it.units.find(x => x.name === l.unitName) : it.units[it.units.length - 1]; if (!u) throw new BuyError('invalid', `unknown unit ${l.unitName}`); if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BuyError('invalid', 'quantity must be a positive whole number'); return { itemId: l.itemId, qtyBase: l.qty * u.factor }; });
    if (new Set(base.map(b => b.itemId)).size !== base.length) throw new BuyError('invalid', 'an item appears twice in the order');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT id, po_no FROM purchase_orders WHERE req_key=?').get(o.key); if (prior) return { id: String(prior.id), poNo: String(prior.po_no), replay: true };
      const id = uuidv7(), no = this.next('po', 'PO'); this.db.prepare('INSERT INTO purchase_orders(id,po_no,req_key,supplier_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id, no, o.key, o.supplierId, o.note ?? null, actor.id, this.hub.now());
      for (const b of base) this.db.prepare('INSERT INTO purchase_order_lines(id,po_id,item_id,qty_base) VALUES(?,?,?,?)').run(uuidv7(), id, b.itemId, b.qtyBase);
      this.hub.audit(actor.id, 'po.created', 'purchase_order', no, { supplierId: o.supplierId, lines: base.length }); this.hub.emit('po.created', { poNo: no, supplierId: o.supplierId });
      return { id, poNo: no, replay: false };
    });
  }
  private order(id: string) { const r = this.db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id); if (!r) throw new BuyError('not-found', `order ${id}`); return r; }
  sendOrder(actor: Person, id: string): void {
    this.need(actor, 'purchase_order.update');
    this.db.tx(() => { const o = this.order(id); if (o.status !== 'draft') throw new BuyError('state', 'only a draft order can be sent'); this.db.prepare("UPDATE purchase_orders SET status='sent' WHERE id=?").run(id); this.hub.audit(actor.id, 'po.sent', 'purchase_order', String(o.po_no), {}); this.hub.emit('po.sent', { poNo: String(o.po_no) }); });
  }
  cancelOrder(actor: Person, id: string, reason: string): void {
    this.need(actor, 'purchase_order.cancel'); if (!reason?.trim()) throw new BuyError('invalid', 'a reason is required');
    this.db.tx(() => { const o = this.order(id); if (o.status === 'cancelled' || o.status === 'received') throw new BuyError('state', `an order that is ${String(o.status)} cannot be cancelled`);
      this.db.prepare("UPDATE purchase_orders SET status='cancelled', cancel_reason=? WHERE id=?").run(reason.trim(), id); this.hub.audit(actor.id, 'po.cancelled', 'purchase_order', String(o.po_no), { reason: reason.trim() }); this.hub.emit('po.cancelled', { poNo: String(o.po_no) }); });
  }
  /** Ordered vs received per line (received comes from posted invoices that name this order). */
  orderStatus(actor: Person, id: string) { this.need(actor, 'purchase_order.create'); return this.statusOf(id); }
  private statusOf(id: string) {
    const o = this.order(id);
    const lines = this.db.prepare(`SELECT l.item_id, i.name_ar, l.qty_base ordered, COALESCE((SELECT SUM(il.paid_base + il.bonus_base) FROM purchase_invoice_lines il JOIN purchase_invoices pi ON pi.id = il.invoice_id WHERE pi.po_id = l.po_id AND pi.status = 'posted' AND il.item_id = l.item_id), 0) received FROM purchase_order_lines l JOIN items i ON i.id = l.item_id WHERE l.po_id=? ORDER BY l.rowid`).all(id)
      .map(r => ({ itemId: String(r.item_id), itemName: String(r.name_ar), orderedBase: Number(r.ordered), receivedBase: Number(r.received), remainingBase: Math.max(0, Number(r.ordered) - Number(r.received)) }));
    return { poNo: String(o.po_no), status: String(o.status), supplierId: String(o.supplier_id), lines };
  }
  private refreshOrder(poId: string, actor: Person): void {
    const o = this.order(poId); if (o.status === 'cancelled' || o.status === 'draft') return;
    const st = this.statusOf(poId); const got = st.lines.some(l => l.receivedBase > 0); const all = st.lines.every(l => l.remainingBase === 0);
    const next = all ? 'received' : got ? 'partly_received' : 'sent'; if (next !== o.status) { this.db.prepare('UPDATE purchase_orders SET status=? WHERE id=?').run(next, poId); this.hub.audit(actor.id, 'po.status', 'purchase_order', String(o.po_no), { from: String(o.status), to: next }); }
  }

  // ---------- purchase invoices ----------
  /** Posts a supplier invoice: every line creates or tops up a batch and its ledger movement in ONE transaction; any bad line stops the whole invoice. A bonus (free quantity) lowers the effective cost per unit. */
  postInvoice(actor: Person, inv: InvoiceInput): InvoiceResult {
    this.need(actor, 'purchase_invoice.create'); const storeId = inv.storeId ?? 'MAIN'; this.store(storeId); this.supplier(inv.supplierId, true);
    if (!inv.lines?.length) throw new BuyError('invalid', 'an invoice needs at least one line'); const ref = inv.supplierRef?.trim() || null;
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT id, pi_no, total_minor FROM purchase_invoices WHERE req_key=?').get(inv.key);
      if (prior) return { id: String(prior.id), piNo: String(prior.pi_no), totalMinor: Number(prior.total_minor), lines: Number(this.db.prepare('SELECT COUNT(*) c FROM purchase_invoice_lines WHERE invoice_id=?').get(String(prior.id))!.c), warnings: [], replay: true };
      if (ref && this.db.prepare('SELECT 1 FROM purchase_invoices WHERE supplier_id=? AND supplier_ref=?').get(inv.supplierId, ref)) throw new BuyError('duplicate', 'this supplier invoice number was already entered');
      if (inv.poId) { const o = this.order(inv.poId); if (String(o.supplier_id) !== inv.supplierId) throw new BuyError('invalid', 'the order belongs to another supplier'); if (o.status === 'draft' || o.status === 'cancelled') throw new BuyError('state', `the order is ${String(o.status)}`); }
      let draft: Record<string, unknown> | undefined; if (inv.draftId) { draft = this.db.prepare('SELECT * FROM purchase_drafts WHERE id=?').get(inv.draftId); if (!draft) throw new BuyError('not-found', 'held invoice'); if (draft.status !== 'open') throw new BuyError('state', `the held invoice is ${String(draft.status)}`); }
      const id = uuidv7(), no = this.next('pi', 'PI'); const warnings: string[] = []; let total = 0, taxTotal = 0; const rows: unknown[][] = [];
      inv.lines.forEach((l, i) => {
        const item = this.items.get(l.itemId); if (!item) throw new BuyError('not-found', l.itemId);
        const unit = l.unitName ? item.units.find(x => x.name === l.unitName) : item.units[item.units.length - 1]; if (!unit) throw new BuyError('invalid', `line ${i + 1}: unknown unit`);
        const pu = l.priceUnitName ? item.units.find(x => x.name === l.priceUnitName) : item.units[item.units.length - 1]; if (!pu) throw new BuyError('invalid', `line ${i + 1}: unknown price unit`);
        const bonus = l.bonusQty ?? 0; if (!Number.isInteger(bonus) || bonus < 0) throw new BuyError('invalid', `line ${i + 1}: bonus must be zero or a whole number`);
        if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BuyError('invalid', `line ${i + 1}: quantity must be a positive whole number`); if (!Number.isInteger(l.costMinor) || l.costMinor < 0) throw new BuyError('invalid', `line ${i + 1}: cost must be whole piasters`);
        const disc = l.discountBp ?? 0; if (!Number.isInteger(disc) || disc < 0 || disc > 10000) throw new BuyError('invalid', `line ${i + 1}: discount must be 0 to 100%`);
        const tax = l.taxMinor ?? 0; if (!Number.isInteger(tax) || tax < 0) throw new BuyError('invalid', `line ${i + 1}: tax must be whole piasters`);
        const paidBase = l.qty * unit.factor, bonusBase = bonus * unit.factor; const eff = bonus || tax ? div(l.costMinor * l.qty + tax, l.qty + bonus) : l.costMinor; const lineTotal = div(paidBase * l.costMinor, pu.factor) + tax;
        const noExpiry = !l.expiry?.trim() && item.card.hasExpiry === false; // items without an expiry (D38): kept as a far date, shown as none
        const lot = l.lot?.trim() || `${no}-${i + 1}`; // no lot on the pack: one batch per invoice line, still sold by expiry first
        const rin: ReceiveInput = { key: `${inv.key}:${i}`, itemId: l.itemId, lot, expiry: noExpiry ? NO_EXPIRY : l.expiry, qty: l.qty + bonus, unitName: unit.name, costMinor: eff, publicPriceMinor: l.publicPriceMinor, pharmacistPriceMinor: l.pharmacistPriceMinor, priceUnitName: pu.name, storeId, sourceRef: no, deviceId: inv.deviceId };
        let res; try { res = this.batches.receive(actor, rin); } catch (e) { if (e instanceof BatchError) throw new BuyError(e.code === 'forbidden' ? 'forbidden' : 'invalid', `line ${i + 1}: ${e.message}`, { line: i + 1, code: e.code }); throw e; }
        warnings.push(...res.warnings.map(w => `line ${i + 1}: ${w}`)); const mv = JSON.parse(String(this.db.prepare('SELECT result FROM idempotency WHERE key=?').get(rin.key)!.result)) as { id: string };
        rows.push([uuidv7(), id, i + 1, l.itemId, res.batch.id, mv.id, paidBase, bonusBase, l.costMinor, eff, lineTotal, disc, tax]); total += lineTotal; taxTotal += tax;
      });
      this.db.prepare('INSERT INTO purchase_invoices(id,pi_no,req_key,supplier_id,supplier_ref,po_id,store_id,total_minor,tax_total_minor,draft_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, no, inv.key, inv.supplierId, ref, inv.poId ?? null, storeId, total, taxTotal, inv.draftId ?? null, actor.id, this.hub.now());
      if (draft) this.db.prepare("UPDATE purchase_drafts SET status='used', closed_by=?, closed_at=?, pi_no=? WHERE id=?").run(actor.id, this.hub.now(), no, String(draft.id));
      for (const r of rows) this.db.prepare('INSERT INTO purchase_invoice_lines(id,invoice_id,line_no,item_id,batch_id,movement_id,paid_base,bonus_base,cost_minor,eff_cost_minor,line_total_minor,discount_bp,tax_minor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...r);
      if (inv.poId) this.refreshOrder(inv.poId, actor);
      this.hub.audit(actor.id, 'purchase_invoice.posted', 'purchase_invoice', no, { supplierId: inv.supplierId, supplierRef: ref, lines: rows.length, totalMinor: total, taxMinor: taxTotal, draftId: inv.draftId ?? null }); this.hub.emit('purchase_invoice.posted', { piNo: no, supplierId: inv.supplierId, totalMinor: total, lines: rows.length });
      return { id, piNo: no, totalMinor: total, lines: rows.length, warnings, replay: false };
    });
  }
  /** Voids a posted invoice (management): reverses every line, only if none of that stock has been sold or moved away yet. */
  voidInvoice(actor: Person, piNo: string, reason: string): void {
    this.need(actor, 'purchase_invoice.void'); if (!reason?.trim()) throw new BuyError('invalid', 'a reason is required');
    this.db.tx(() => {
      const inv = this.db.prepare('SELECT * FROM purchase_invoices WHERE pi_no=?').get(piNo); if (!inv) throw new BuyError('not-found', piNo); if (inv.status !== 'posted') throw new BuyError('state', 'already void');
      const r = approvalAllowed(String(inv.created_by), actor.id, { separationOfDuties: this.rules.separationOfDuties(), activeApprovers: this.rules.activeApprovers() }); if (!r.ok) throw new BuyError('separation', 'someone other than the maker must void this invoice');
      const lines = this.db.prepare('SELECT * FROM purchase_invoice_lines WHERE invoice_id=? ORDER BY line_no').all(String(inv.id));
      const short = lines.filter(l => this.hub.balance(String(l.item_id), { storeId: String(inv.store_id), batchId: String(l.batch_id) }) < Number(l.paid_base) + Number(l.bonus_base));
      if (short.length) throw new BuyError('sold', 'some of this stock is already sold or moved: return it to the supplier instead', { lines: short.map(l => Number(l.line_no)) });
      for (const l of lines) { const m = this.hub.reverse(`VOID:${piNo}:${String(l.line_no)}`, String(l.movement_id), actor.id, `void ${piNo}: ${reason.trim()}`); if (!m.ok) throw new BuyError('insufficient', `line ${String(l.line_no)} cannot be reversed (${m.reason})`); }
      this.db.prepare("UPDATE purchase_invoices SET status='void', void_by=?, void_at=?, void_reason=?, flagged=? WHERE id=?").run(actor.id, this.hub.now(), reason.trim(), r.flagged ? 1 : 0, String(inv.id));
      if (inv.po_id) this.refreshOrder(String(inv.po_id), actor);
      this.hub.audit(actor.id, 'purchase_invoice.voided', 'purchase_invoice', piNo, { reason: reason.trim(), flagged: r.flagged }); this.hub.emit('purchase_invoice.voided', { piNo, supplierId: String(inv.supplier_id), totalMinor: Number(inv.total_minor) });
    });
  }
  invoice(actor: Person, piNo: string) {
    this.need(actor, 'purchase_invoice.create'); const h = this.db.prepare('SELECT * FROM purchase_invoices WHERE pi_no=?').get(piNo); if (!h) throw new BuyError('not-found', piNo);
    const lines = this.db.prepare('SELECT l.*, i.name_ar, b.lot, b.expiry, b.public_price_minor, u.name price_unit, u.factor price_factor FROM purchase_invoice_lines l JOIN items i ON i.id=l.item_id JOIN batches b ON b.id=l.batch_id JOIN item_units u ON u.id=b.price_unit_id WHERE l.invoice_id=? ORDER BY l.line_no').all(String(h.id))
      .map(l => ({ lineNo: Number(l.line_no), itemId: String(l.item_id), itemName: String(l.name_ar), batchId: String(l.batch_id), lot: String(l.lot), expiry: String(l.expiry), paidBase: Number(l.paid_base), bonusBase: Number(l.bonus_base), costMinor: Number(l.cost_minor), effCostMinor: Number(l.eff_cost_minor), totalMinor: Number(l.line_total_minor), discountBp: Number(l.discount_bp), taxMinor: Number(l.tax_minor), publicPriceMinor: l.public_price_minor == null ? null : Number(l.public_price_minor), priceUnit: String(l.price_unit), priceFactor: Number(l.price_factor) }));
    return { piNo, status: String(h.status), supplierId: String(h.supplier_id), supplierRef: (h.supplier_ref as string) ?? null, poId: (h.po_id as string) ?? null, storeId: String(h.store_id), totalMinor: Number(h.total_minor), taxTotalMinor: Number(h.tax_total_minor), createdBy: String(h.created_by), createdAt: String(h.created_at), voidReason: (h.void_reason as string) ?? null, lines };
  }
  invoices(actor: Person, o: { supplierId?: string; status?: 'posted' | 'void' } = {}) {
    this.need(actor, 'purchase_invoice.create'); const w: string[] = []; const a: unknown[] = []; if (o.supplierId) { w.push('supplier_id=?'); a.push(o.supplierId); } if (o.status) { w.push('status=?'); a.push(o.status); }
    return this.db.prepare(`SELECT pi_no, supplier_id, supplier_ref, status, total_minor, created_at FROM purchase_invoices ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY rowid DESC`).all(...a).map(r => ({ piNo: String(r.pi_no), supplierId: String(r.supplier_id), supplierRef: (r.supplier_ref as string) ?? null, status: String(r.status), totalMinor: Number(r.total_minor), createdAt: String(r.created_at) }));
  }

  // ---------- held (suspended) invoices ----------
  /** Holds an invoice being typed: saves the lines as they are (no stock moves). Saving again with the same id updates it while it is open. */
  saveDraft(actor: Person, d: DraftInput): { id: string; draftNo: string; replay: boolean } {
    this.need(actor, 'purchase_invoice.create'); if (!Array.isArray(d.lines) || d.lines.length > 400) throw new BuyError('invalid', 'a held invoice holds up to 400 lines');
    const text = JSON.stringify(d.lines); if (text.length > 400_000) throw new BuyError('invalid', 'the held invoice is too large');
    if (d.supplierId) this.supplier(d.supplierId); const now = this.hub.now();
    return this.db.tx(() => {
      if (d.id) {
        const cur = this.db.prepare('SELECT * FROM purchase_drafts WHERE id=?').get(d.id); if (!cur) throw new BuyError('not-found', 'held invoice'); if (cur.status !== 'open') throw new BuyError('state', `the held invoice is ${String(cur.status)}`);
        this.db.prepare('UPDATE purchase_drafts SET supplier_id=?, supplier_ref=?, po_id=?, lines=?, line_count=?, note=?, updated_by=?, updated_at=? WHERE id=?').run(d.supplierId ?? null, d.supplierRef?.trim() || null, d.poId ?? null, text, d.lines.length, d.note?.trim() || null, actor.id, now, d.id);
        this.hub.audit(actor.id, 'purchase_draft.saved', 'purchase_draft', String(cur.draft_no), { lines: d.lines.length }); return { id: d.id, draftNo: String(cur.draft_no), replay: false };
      }
      const prior = this.db.prepare('SELECT id, draft_no FROM purchase_drafts WHERE req_key=?').get(d.key); if (prior) return { id: String(prior.id), draftNo: String(prior.draft_no), replay: true };
      const id = uuidv7(), no = this.next('pd', 'PH');
      this.db.prepare('INSERT INTO purchase_drafts(id,draft_no,req_key,supplier_id,supplier_ref,po_id,lines,line_count,note,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, no, d.key, d.supplierId ?? null, d.supplierRef?.trim() || null, d.poId ?? null, text, d.lines.length, d.note?.trim() || null, actor.id, now, actor.id, now);
      this.hub.audit(actor.id, 'purchase_draft.held', 'purchase_draft', no, { lines: d.lines.length }); return { id, draftNo: no, replay: false };
    });
  }
  drafts(actor: Person) {
    this.need(actor, 'purchase_invoice.create');
    return this.db.prepare("SELECT d.id, d.draft_no, d.supplier_id, s.name supplier, d.supplier_ref, d.line_count, d.note, d.updated_at FROM purchase_drafts d LEFT JOIN suppliers s ON s.id=d.supplier_id WHERE d.status='open' ORDER BY d.updated_at DESC").all()
      .map(r => ({ id: String(r.id), draftNo: String(r.draft_no), supplierId: (r.supplier_id as string) ?? null, supplier: (r.supplier as string) ?? null, supplierRef: (r.supplier_ref as string) ?? null, lines: Number(r.line_count), note: (r.note as string) ?? null, updatedAt: String(r.updated_at) }));
  }
  draft(actor: Person, id: string) {
    this.need(actor, 'purchase_invoice.create'); const r = this.db.prepare('SELECT * FROM purchase_drafts WHERE id=? OR draft_no=?').get(id, id); if (!r) throw new BuyError('not-found', 'held invoice');
    return { id: String(r.id), draftNo: String(r.draft_no), status: String(r.status), supplierId: (r.supplier_id as string) ?? null, supplierRef: (r.supplier_ref as string) ?? null, poId: (r.po_id as string) ?? null, note: (r.note as string) ?? null, lines: JSON.parse(String(r.lines)) as unknown[], piNo: (r.pi_no as string) ?? null };
  }
  cancelDraft(actor: Person, id: string, reason: string): void {
    this.need(actor, 'purchase_invoice.create'); if (!reason?.trim()) throw new BuyError('invalid', 'a reason is required');
    this.db.tx(() => { const r = this.db.prepare('SELECT * FROM purchase_drafts WHERE id=?').get(id); if (!r) throw new BuyError('not-found', 'held invoice'); if (r.status !== 'open') throw new BuyError('state', `the held invoice is ${String(r.status)}`);
      this.db.prepare("UPDATE purchase_drafts SET status='cancelled', closed_by=?, closed_at=?, closed_reason=? WHERE id=?").run(actor.id, this.hub.now(), reason.trim(), id); this.hub.audit(actor.id, 'purchase_draft.cancelled', 'purchase_draft', String(r.draft_no), { reason: reason.trim() }); });
  }

  // ---------- returns to supplier ----------
  /** Sends stock back to a supplier: reduces the chosen batches (never below zero), valued at each batch's cost. A reason is required; repeating the key returns the same return. */
  returnToSupplier(actor: Person, r: ReturnInput): { id: string; prNo: string; totalMinor: number; replay: boolean } {
    this.need(actor, 'purchase_return.create'); const storeId = r.storeId ?? 'MAIN'; this.store(storeId); this.supplier(r.supplierId); if (!r.reason?.trim()) throw new BuyError('invalid', 'a reason is required'); if (!r.lines?.length) throw new BuyError('invalid', 'a return needs at least one line');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT id, pr_no, total_minor FROM purchase_returns WHERE req_key=?').get(r.key); if (prior) return { id: String(prior.id), prNo: String(prior.pr_no), totalMinor: Number(prior.total_minor), replay: true };
      if (r.invoiceId && !this.db.prepare('SELECT 1 FROM purchase_invoices WHERE id=? AND supplier_id=?').get(r.invoiceId, r.supplierId)) throw new BuyError('invalid', 'the invoice does not belong to this supplier');
      const id = uuidv7(), no = this.next('pr', 'PR'); const seen = new Set<string>(); let total = 0; const rows: unknown[][] = [];
      r.lines.forEach((l, i) => {
        if (seen.has(l.batchId)) throw new BuyError('invalid', `line ${i + 1}: batch listed twice`); seen.add(l.batchId);
        const b = this.db.prepare('SELECT b.item_id, b.cost_minor c, u.factor f FROM batches b JOIN item_units u ON u.id = b.price_unit_id WHERE b.id=?').get(l.batchId); if (!b) throw new BuyError('not-found', `line ${i + 1}: batch`);
        const item = this.items.get(String(b.item_id))!; const unit = l.unitName ? item.units.find(x => x.name === l.unitName) : item.units[0]; if (!unit) throw new BuyError('invalid', `line ${i + 1}: unknown unit`);
        if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BuyError('invalid', `line ${i + 1}: quantity must be a positive whole number`); const qb = l.qty * unit.factor; const value = div(qb * Number(b.c), Number(b.f));
        const m = this.hub.record({ key: `${r.key}:${i}`, storeId, itemId: String(b.item_id), batchId: l.batchId, qty: -qb, kind: 'return', ref: no, reason: r.reason.trim(), actor: actor.id });
        if (!m.ok) throw new BuyError('insufficient', `line ${i + 1}: the store holds less than that`, { line: i + 1 });
        rows.push([uuidv7(), id, String(b.item_id), l.batchId, qb, value]); total += value;
      });
      this.db.prepare('INSERT INTO purchase_returns(id,pr_no,req_key,supplier_id,invoice_id,store_id,reason,total_minor,by,at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, no, r.key, r.supplierId, r.invoiceId ?? null, storeId, r.reason.trim(), total, actor.id, this.hub.now());
      for (const x of rows) this.db.prepare('INSERT INTO purchase_return_lines(id,return_id,item_id,batch_id,qty_base,value_minor) VALUES(?,?,?,?,?,?)').run(...x);
      this.hub.audit(actor.id, 'purchase_return.posted', 'purchase_return', no, { supplierId: r.supplierId, lines: rows.length, totalMinor: total, reason: r.reason.trim() }); this.hub.emit('purchase_return.posted', { prNo: no, supplierId: r.supplierId, totalMinor: total });
      return { id, prNo: no, totalMinor: total, replay: false };
    });
  }

  // ---------- supplier prices ----------
  /** Last effective cost per price unit from each supplier for an item (bonus included), cheapest first: the comparison the buyer needs. */
  priceHistory(actor: Person, itemId: string) {
    this.need(actor, 'supplier_price.view');
    const rows = this.db.prepare(`SELECT s.id sid, s.name, l.eff_cost_minor c, pi.created_at at, pi.pi_no FROM purchase_invoice_lines l JOIN purchase_invoices pi ON pi.id = l.invoice_id AND pi.status='posted' JOIN suppliers s ON s.id = pi.supplier_id WHERE l.item_id=? ORDER BY pi.rowid DESC`).all(itemId);
    const seen = new Set<string>(); const out: { supplierId: string; supplierName: string; effCostMinor: number; at: string; piNo: string }[] = [];
    for (const r of rows) { const k = String(r.sid); if (seen.has(k)) continue; seen.add(k); out.push({ supplierId: k, supplierName: String(r.name), effCostMinor: Number(r.c), at: String(r.at), piNo: String(r.pi_no) }); }
    return out.sort((a, b) => a.effCostMinor - b.effCostMinor || a.supplierName.localeCompare(b.supplierName));
  }
}
