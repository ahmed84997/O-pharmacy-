import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, BuyError, ItemService, MIGRATIONS, PurchasingService, StockService, type InvoiceLineInput, type ItemInput } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const mgr2: Person = { id: 'mg2', roles: ['M'], branchIds: ['b1'] };
const pharm: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const setup = () => { const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), MIGRATIONS); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); return { hub, items, bs, st: new StockService(hub, items, bs), pu: new PurchasingService(hub, items, bs) }; };
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as BuyError).code ?? (e as Error).message; } return 'no error'; };
const line = (itemId: string, o: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({ itemId, lot: 'L1', expiry: '2027-06-30', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 4500, pharmacistPriceMinor: 4200, ...o });
let n = 0; const key = () => `k${++n}`;
const prep = () => { const s = setup(); const a = s.items.create(owner, drug({ nameAr: 'أ' })); const b = s.items.create(owner, drug({ nameAr: 'ب' })); const sup = s.pu.createSupplier(mgr, { name: 'المتحدة', phone: '0100' }); return { ...s, a, b, sup }; };

describe('suppliers', () => {
  it('create, update, search, switch off with reason; never deleted; names unique; permissions', () => {
    const s = setup(); const x = s.pu.createSupplier(mgr, { name: ' المتحدة ', phone: '01' }); expect(x).toMatchObject({ code: 'S-000001', name: 'المتحدة', active: true });
    expect(code(() => s.pu.createSupplier(mgr, { name: 'المتحدة' }))).toBe('duplicate'); expect(code(() => s.pu.createSupplier(mgr, { name: '  ' }))).toBe('invalid'); expect(code(() => s.pu.createSupplier(pharm, { name: 'y' }))).toBe('forbidden');
    expect(s.pu.updateSupplier(mgr, x.id, { phone: '02', taxNo: '123' })).toMatchObject({ phone: '02', taxNo: '123', name: 'المتحدة' }); const y = s.pu.createSupplier(mgr, { name: 'الدلتا' }); expect(code(() => s.pu.updateSupplier(mgr, y.id, { name: 'المتحدة' }))).toBe('duplicate');
    expect(s.pu.suppliers(pharm, { q: 'دلت' }).map(v => v.name)).toEqual(['الدلتا']); expect(code(() => s.pu.setSupplierActive(mgr, y.id, false, ''))).toBe('invalid'); s.pu.setSupplierActive(mgr, y.id, false, 'stopped dealing');
    expect(s.pu.suppliers(pharm).map(v => v.name)).toEqual(['المتحدة']); expect(s.pu.suppliers(pharm, { includeInactive: true })).toHaveLength(2); expect(code(() => s.pu.suppliers(cashier))).toBe('forbidden');
    expect(() => s.hub.db.exec('DELETE FROM suppliers')).toThrow(); expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: y.id, lines: [line('x')] }))).toBe('state');
  });
});

describe('purchase invoices', () => {
  it('one invoice, several lines: batches, stock and total are created together; repeating the key changes nothing', () => {
    const s = prep(); const k = key(); const r = s.pu.postInvoice(keeper, { key: k, supplierId: s.sup.id, supplierRef: 'INV-77', lines: [line(s.a.id), line(s.b.id, { lot: 'B9', qty: 5, costMinor: 1000, publicPriceMinor: 2000, pharmacistPriceMinor: 1800 })] });
    expect(r).toMatchObject({ piNo: 'PI-000001', totalMinor: 30000 + 5000, lines: 2, replay: false }); expect(s.st.onHand(s.a.id)).toBe(200); expect(s.st.onHand(s.b.id)).toBe(100);
    const c = s.hub.movementCount(); expect(s.pu.postInvoice(keeper, { key: k, supplierId: s.sup.id, supplierRef: 'INV-77', lines: [line(s.a.id)] })).toMatchObject({ replay: true, piNo: 'PI-000001', totalMinor: 35000 }); expect(s.hub.movementCount()).toBe(c);
    const inv = s.pu.invoice(keeper, 'PI-000001'); expect(inv.lines.map(l => [l.itemName, l.paidBase, l.totalMinor])).toEqual([['أ', 200, 30000], ['ب', 100, 5000]]); expect(s.pu.invoices(keeper)).toHaveLength(1); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('a bonus adds free stock and lowers the effective cost per unit', () => {
    const s = prep(); s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { qty: 10, bonusQty: 2, costMinor: 3000 })] });
    expect(s.st.onHand(s.a.id)).toBe(240); const l = s.pu.invoice(keeper, 'PI-000001').lines[0]!; expect(l).toMatchObject({ paidBase: 200, bonusBase: 40, costMinor: 3000, effCostMinor: 2500, totalMinor: 30000 }); expect(s.bs.batches(mgr, s.a.id)[0]!.costMinor).toBe(2500);
  });
  it('rules: duplicate supplier invoice number, empty invoice, bad lines, expired batch, price conflict: nothing is written', () => {
    const s = prep(); s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, supplierRef: 'X1', lines: [line(s.a.id)] }); const c = s.hub.movementCount();
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, supplierRef: 'X1', lines: [line(s.b.id)] }))).toBe('duplicate'); expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [] }))).toBe('invalid');
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.b.id), line(s.a.id, { expiry: '2026-01-31' })] }))).toBe('invalid'); expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.b.id), line(s.a.id, { costMinor: 3100 })] }))).toBe('invalid');
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.b.id, { qty: 0 })] }))).toBe('invalid'); expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.b.id, { bonusQty: -1 })] }))).toBe('invalid');
    expect(code(() => s.pu.postInvoice(cashier, { key: key(), supplierId: s.sup.id, lines: [line(s.b.id)] }))).toBe('forbidden'); expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: 'nope', lines: [line(s.b.id)] }))).toBe('not-found');
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, storeId: 'nope', lines: [line(s.b.id)] }))).toBe('invalid'); expect(s.hub.movementCount()).toBe(c); expect(s.pu.invoices(keeper)).toHaveLength(1);
  });
  it('near-expiry and cost-above-price come back as warnings with the line number', () => {
    const s = prep(); const r = s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id), line(s.b.id, { expiry: '2027-01-31', costMinor: 5000 })] }); expect(r.warnings).toEqual(expect.arrayContaining(['line 2: near-expiry:61', 'line 2: cost-above-price']));
  });
  it('void (management, by someone else): reverses every line; refused once the stock is sold; never deleted', () => {
    const s = prep(); s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id), line(s.b.id)] }); expect(code(() => s.pu.voidInvoice(keeper, 'PI-000001', 'x'))).toBe('forbidden'); expect(code(() => s.pu.voidInvoice(mgr, 'PI-000001', ' '))).toBe('invalid');
    const bid = s.pu.invoice(keeper, 'PI-000001').lines[1]!.batchId; s.hub.record({ key: 'sale', storeId: 'MAIN', itemId: s.b.id, batchId: bid, qty: -1, kind: 'sale', actor: 'cs' }); const c = s.hub.movementCount();
    expect(code(() => s.pu.voidInvoice(mgr, 'PI-000001', 'wrong'))).toBe('sold'); expect(s.hub.movementCount()).toBe(c); s.hub.record({ key: 'back', storeId: 'MAIN', itemId: s.b.id, batchId: bid, qty: 1, kind: 'return', actor: 'cs' });
    s.pu.voidInvoice(mgr, 'PI-000001', 'entered twice'); expect(s.st.onHand(s.a.id)).toBe(0); expect(s.st.onHand(s.b.id)).toBe(0); expect(s.pu.invoice(keeper, 'PI-000001')).toMatchObject({ status: 'void', voidReason: 'entered twice' });
    expect(code(() => s.pu.voidInvoice(mgr, 'PI-000001', 'again'))).toBe('state'); for (const q of ['DELETE FROM purchase_invoices', 'UPDATE purchase_invoices SET total_minor=1', 'UPDATE purchase_invoice_lines SET paid_base=1', 'DELETE FROM purchase_invoice_lines']) expect(() => s.hub.db.exec(q), q).toThrow();
    expect(s.pu.invoices(keeper, { status: 'void' })).toHaveLength(1); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('the maker cannot void their own invoice (separation of duties)', () => {
    const s = prep(); s.pu.postInvoice(mgr, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id)] }); expect(code(() => s.pu.voidInvoice(mgr, 'PI-000001', 'x'))).toBe('separation'); s.pu.voidInvoice(mgr2, 'PI-000001', 'x'); expect(s.st.onHand(s.a.id)).toBe(0);
  });
});

describe('purchase orders', () => {
  it('draft, send, receive in parts through invoices, then received; cancel needs a reason and closes it', () => {
    const s = prep(); const o = s.pu.createOrder(pharm, { key: 'po1', supplierId: s.sup.id, lines: [{ itemId: s.a.id, qty: 10, unitName: 'علبة' }, { itemId: s.b.id, qty: 5 }] }); expect(o).toMatchObject({ poNo: 'PO-000001', replay: false }); expect(s.pu.createOrder(pharm, { key: 'po1', supplierId: s.sup.id, lines: [{ itemId: s.a.id, qty: 1 }] })).toMatchObject({ id: o.id, replay: true });
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, poId: o.id, lines: [line(s.a.id)] }))).toBe('state'); s.pu.sendOrder(pharm, o.id); expect(code(() => s.pu.sendOrder(pharm, o.id))).toBe('state');
    s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, poId: o.id, lines: [line(s.a.id, { qty: 4 })] }); expect(s.pu.orderStatus(pharm, o.id)).toMatchObject({ status: 'partly_received' }); expect(s.pu.orderStatus(pharm, o.id).lines.map(l => [l.orderedBase, l.receivedBase, l.remainingBase])).toEqual([[200, 80, 120], [100, 0, 100]]);
    s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, poId: o.id, lines: [line(s.a.id, { lot: 'L2', qty: 6 }), line(s.b.id, { lot: 'B', qty: 5, publicPriceMinor: 2000, pharmacistPriceMinor: 1800 })] }); expect(s.pu.orderStatus(pharm, o.id).status).toBe('received');
    s.pu.voidInvoice(mgr, 'PI-000002', 'x'); expect(s.pu.orderStatus(pharm, o.id).status).toBe('partly_received'); expect(code(() => s.pu.cancelOrder(mgr, o.id, ''))).toBe('invalid'); s.pu.cancelOrder(mgr, o.id, 'supplier cannot deliver');
    expect(code(() => s.pu.cancelOrder(mgr, o.id, 'again'))).toBe('state'); expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, poId: o.id, lines: [line(s.a.id, { lot: 'L3' })] }))).toBe('state'); for (const q of ['DELETE FROM purchase_orders', 'DELETE FROM purchase_order_lines', 'UPDATE purchase_order_lines SET qty_base=1']) expect(() => s.hub.db.exec(q), q).toThrow();
  });
  it('rules: lines, duplicates, units, permission, order of another supplier, cashier', () => {
    const s = prep(); const other = s.pu.createSupplier(mgr, { name: 'تانى' }); expect(code(() => s.pu.createOrder(pharm, { key: key(), supplierId: s.sup.id, lines: [] }))).toBe('invalid');
    expect(code(() => s.pu.createOrder(pharm, { key: key(), supplierId: s.sup.id, lines: [{ itemId: s.a.id, qty: 1 }, { itemId: s.a.id, qty: 2 }] }))).toBe('invalid'); expect(code(() => s.pu.createOrder(pharm, { key: key(), supplierId: s.sup.id, lines: [{ itemId: s.a.id, qty: 1, unitName: 'x' }] }))).toBe('invalid');
    expect(code(() => s.pu.createOrder(cashier, { key: key(), supplierId: s.sup.id, lines: [{ itemId: s.a.id, qty: 1 }] }))).toBe('forbidden'); const o = s.pu.createOrder(pharm, { key: key(), supplierId: s.sup.id, lines: [{ itemId: s.a.id, qty: 1 }] }); s.pu.sendOrder(pharm, o.id);
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: other.id, poId: o.id, lines: [line(s.a.id)] }))).toBe('invalid'); expect(code(() => s.pu.cancelOrder(pharm, o.id, 'x'))).toBe('forbidden');
  });
});

describe('returns to supplier and price comparison', () => {
  it('a return reduces the batch, is valued at batch cost, needs a reason, cannot exceed stock, is idempotent and append-only', () => {
    const s = prep(); s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { qty: 2 })] }); const bid = s.pu.invoice(keeper, 'PI-000001').lines[0]!.batchId;
    const r = s.pu.returnToSupplier(keeper, { key: 'r1', supplierId: s.sup.id, invoiceId: s.pu.invoice(keeper, 'PI-000001').lines.length ? undefined : undefined, reason: 'تالف', lines: [{ batchId: bid, qty: 1, unitName: 'علبة' }, { batchId: bid, qty: 1 }].slice(0, 1) });
    expect(r).toMatchObject({ prNo: 'PR-000001', totalMinor: 3000, replay: false }); expect(s.st.onHand(s.a.id)).toBe(20); expect(s.pu.returnToSupplier(keeper, { key: 'r1', supplierId: s.sup.id, reason: 'تالف', lines: [{ batchId: bid, qty: 1, unitName: 'علبة' }] })).toMatchObject({ replay: true, prNo: 'PR-000001' }); expect(s.st.onHand(s.a.id)).toBe(20);
    expect(s.st.card(owner, s.a.id).lines.at(-1)).toMatchObject({ kind: 'return', qty: -20, ref: 'PR-000001' }); const c = s.hub.movementCount();
    expect(code(() => s.pu.returnToSupplier(keeper, { key: 'r2', supplierId: s.sup.id, reason: 'x', lines: [{ batchId: bid, qty: 30, unitName: 'حبة' }] }))).toBe('insufficient'); expect(s.hub.movementCount()).toBe(c);
    expect(code(() => s.pu.returnToSupplier(keeper, { key: 'r3', supplierId: s.sup.id, reason: ' ', lines: [{ batchId: bid, qty: 1 }] }))).toBe('invalid'); expect(code(() => s.pu.returnToSupplier(keeper, { key: 'r4', supplierId: s.sup.id, reason: 'x', lines: [{ batchId: bid, qty: 1 }, { batchId: bid, qty: 1 }] }))).toBe('invalid');
    expect(code(() => s.pu.returnToSupplier(cashier, { key: 'r5', supplierId: s.sup.id, reason: 'x', lines: [{ batchId: bid, qty: 1 }] }))).toBe('forbidden'); expect(code(() => s.pu.returnToSupplier(keeper, { key: 'r6', supplierId: s.sup.id, reason: 'x', lines: [{ batchId: 'nope', qty: 1 }] }))).toBe('not-found');
    for (const q of ['DELETE FROM purchase_returns', 'UPDATE purchase_returns SET reason=\'z\'', 'DELETE FROM purchase_return_lines']) expect(() => s.hub.db.exec(q), q).toThrow(); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('price history: last effective cost per supplier, cheapest first, void invoices ignored, permission needed', () => {
    const s = prep(); const t = s.pu.createSupplier(mgr, { name: 'الدلتا' });
    s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { costMinor: 3200 })] }); s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { lot: 'L2', costMinor: 3000 })] });
    s.pu.postInvoice(keeper, { key: key(), supplierId: t.id, lines: [line(s.a.id, { lot: 'L3', qty: 10, bonusQty: 1, costMinor: 3000 })] }); s.pu.postInvoice(keeper, { key: key(), supplierId: t.id, lines: [line(s.a.id, { lot: 'L4', costMinor: 2000 })] }); s.pu.voidInvoice(mgr, 'PI-000004', 'wrong price');
    expect(s.pu.priceHistory(pharm, s.a.id).map(p => [p.supplierName, p.effCostMinor])).toEqual([['الدلتا', 2727], ['المتحدة', 3000]]); expect(code(() => s.pu.priceHistory(cashier, s.a.id))).toBe('forbidden');
  });
});

describe('purchase invoices: discount, tax, lot left empty, held invoices (Sprint 7.8)', () => {
  it('keeps the discount, adds the tax to the total and the cost, and makes a batch per line when the pack has no lot', () => {
    const s = prep();
    const r = s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { lot: '', qty: 10, costMinor: 3000, discountBp: 2500, taxMinor: 1400 }), line(s.b.id, { lot: ' ', qty: 2, costMinor: 1000, publicPriceMinor: 2000, pharmacistPriceMinor: 1800 })] });
    expect(r.totalMinor).toBe(30000 + 1400 + 2000);
    const inv = s.pu.invoice(keeper, r.piNo); expect(inv.taxTotalMinor).toBe(1400);
    expect(inv.lines[0]).toMatchObject({ lot: 'PI-000001-1', discountBp: 2500, taxMinor: 1400, effCostMinor: 3140, publicPriceMinor: 4500, priceUnit: 'علبة' }); expect(inv.lines[1]!.lot).toBe('PI-000001-2');
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { lot: 'X', discountBp: 10001 })] }))).toBe('invalid');
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, lines: [line(s.a.id, { lot: 'Y', taxMinor: -1 })] }))).toBe('invalid');
  });
  it('holds an invoice without moving stock, updates it while open, posts it once and never deletes it', () => {
    const s = prep(); const k = key(); const d = s.pu.saveDraft(keeper, { key: k, supplierId: s.sup.id, supplierRef: 'A-1', lines: [{ itemId: s.a.id, qty: '3' }] });
    expect(d).toMatchObject({ draftNo: 'PH-000001', replay: false }); expect(s.pu.saveDraft(keeper, { key: k, lines: [] })).toMatchObject({ id: d.id, replay: true }); expect(s.st.onHand(s.a.id)).toBe(0);
    s.pu.saveDraft(keeper, { key: key(), id: d.id, supplierId: s.sup.id, supplierRef: 'A-1', lines: [{ itemId: s.a.id, qty: '3' }, { itemId: s.b.id, qty: '1' }] });
    expect(s.pu.drafts(keeper)).toMatchObject([{ draftNo: 'PH-000001', lines: 2, supplier: 'المتحدة' }]); expect(s.pu.draft(keeper, 'PH-000001').lines).toHaveLength(2);
    const r = s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, supplierRef: 'A-1', draftId: d.id, lines: [line(s.a.id)] });
    expect(s.pu.draft(keeper, d.id)).toMatchObject({ status: 'used', piNo: r.piNo }); expect(s.pu.drafts(keeper)).toHaveLength(0);
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, draftId: d.id, lines: [line(s.b.id, { lot: 'Z' })] }))).toBe('state');
    expect(code(() => s.pu.saveDraft(keeper, { key: key(), id: d.id, lines: [] }))).toBe('state');
    const d2 = s.pu.saveDraft(keeper, { key: key(), lines: [] }); expect(code(() => s.pu.cancelDraft(keeper, d2.id, ' '))).toBe('invalid'); s.pu.cancelDraft(keeper, d2.id, 'دخلت غلط');
    expect(s.pu.draft(keeper, d2.id).status).toBe('cancelled'); expect(() => s.hub.db.exec('DELETE FROM purchase_drafts')).toThrow(); expect(code(() => s.pu.drafts(cashier))).toBe('forbidden');
  });
});

describe('item card, unit names and storage places (Sprint 7.9)', () => {
  it('keeps the card fields, checks them, lets an item without expiry be bought with no date, and never deletes the lists', () => {
    const s = setup();
    const it = s.items.create(owner, drug({ nameAr: 'شاش طبي', kind: 'non_drug', listPriceMinor: 1500, units: [{ name: 'قطعة', factor: 1 }, { name: 'كيس', factor: 10 }], card: { description: 'شاش معقم', defaultCostMinor: 1100, defaultDiscountBp: 1500, taxBp: 1400, hasExpiry: false, printLabel: false, autoShortage: true, hideOnReceipt: true } }));
    expect(it.card).toMatchObject({ description: 'شاش معقم', defaultCostMinor: 1100, defaultDiscountBp: 1500, taxBp: 1400, hasExpiry: false, printLabel: false, autoShortage: true, hideOnReceipt: true, defaultPriceMinor: null });
    const d = s.items.create(owner, drug({ nameAr: 'أوجمنتين', card: { defaultPriceMinor: 16800 } })); expect(d.card).toMatchObject({ defaultPriceMinor: 16800, hasExpiry: true, printLabel: true, autoShortage: false });
    expect(code(() => s.items.create(pharm, drug({ nameAr: 'x', card: { defaultPriceMinor: 100 } })))).toBe('forbidden');
    expect(code(() => s.items.create(owner, drug({ nameAr: 'y', card: { taxBp: 10001 } })))).toBe('invalid');
    expect(s.items.update(owner, d.id, { card: { taxBp: 500, autoShortage: true } }).card).toMatchObject({ taxBp: 500, autoShortage: true, defaultPriceMinor: 16800 });
    const sup = s.pu.createSupplier(mgr, { name: 'م' });
    const r = s.pu.postInvoice(keeper, { key: key(), supplierId: sup.id, lines: [{ itemId: it.id, lot: '', expiry: '', qty: 2, unitName: 'كيس', costMinor: 1100 }] }); expect(s.pu.invoice(keeper, r.piNo).lines[0]!.expiry).toBe('9999-12-31');
    expect(code(() => s.pu.postInvoice(keeper, { key: key(), supplierId: sup.id, lines: [{ itemId: d.id, lot: '', expiry: '', qty: 1, unitName: 'علبة', costMinor: 100, publicPriceMinor: 200 }] }))).toBe('invalid');
    // unit names and places
    expect(s.items.unitNames().map(u => u.name)).toEqual(expect.arrayContaining(['قرص', 'شريط', 'علبة'])); s.items.addUnitName(owner, 'سرنجة'); expect(code(() => s.items.addUnitName(owner, 'سرنجة'))).toBe('invalid'); expect(code(() => s.items.addUnitName(cashier, 'z'))).toBe('forbidden');
    const sh = s.items.addLocation(owner, 'رف A1'); s.items.addLocation(owner, 'الثلاجة'); expect(s.items.assignLocation(owner, [it.id, d.id], 'رف A1')).toBe(2); expect(s.items.get(d.id)!.location).toBe('رف A1');
    expect(s.items.locations().find(l => l.name === 'رف A1')!.items).toBe(2); expect(code(() => s.items.assignLocation(owner, [it.id], 'مش موجود'))).toBe('invalid');
    s.items.setLocationActive(owner, sh.id, false); expect(s.items.locations().map(l => l.name)).not.toContain('رف A1'); expect(s.items.locations(true).map(l => l.name)).toContain('رف A1');
    expect(() => s.hub.db.exec('DELETE FROM unit_names')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM item_locations')).toThrow();
  });
});
