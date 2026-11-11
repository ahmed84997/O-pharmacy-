import { describe, it, expect } from 'vitest';
import { buildSeed } from './seed';
import { allocate, priceCart, saveSale, voidSale, holdSale, resumeHeld, savePurchase, addShortage, stockOf, searchItems, effectiveCost, marginPct, isExpired, Db, Want } from './domain';

const TODAY = '2026-11-11';
const NOW = '2026-11-11T12:30:00.000Z';
const base = () => buildSeed(TODAY);
const byName = (db: Db, p: string) => db.items.find(i => i.name.startsWith(p))!;
const w = (itemId: string, qty: number, unit: 'pack' | 'sub' = 'pack', extra: Partial<Want> = {}): Want => ({ key: itemId + qty + unit, itemId, qty, unit, discountPct: 0, ...extra });
const total = (db: Db) => db.batches.reduce((s, b) => s + b.qty, 0);

describe('seed', () => {
  const db = base();
  it('has items, customers, suppliers and about 150 past invoices', () => {
    expect(db.items.length).toBeGreaterThan(230); expect(db.items.length).toBeLessThanOrEqual(300);
    expect(db.customers).toHaveLength(40); expect(db.suppliers).toHaveLength(15); expect(db.invoices).toHaveLength(150);
  });
  it('is deterministic', () => { expect(base().items.map(i => i.name)).toEqual(db.items.map(i => i.name)); });
  it('contains the deliberate traps', () => {
    expect(stockOf(db, byName(db, 'سيتيريزين 10').id)).toBe(0);
    expect(db.batches.some(b => isExpired(b, TODAY))).toBe(true);
    expect(db.customers.some(c => c.balance > c.limit)).toBe(true);
    expect(db.items.some(i => i.suspended)).toBe(true);
    expect(new Set(db.items.map(i => i.barcode)).size).toBe(db.items.length);
  });
  it('uses no middle dot or bullet separators', () => { expect(JSON.stringify(db.items)).not.toMatch(/[·•]/); });
});

describe('FEFO and pricing', () => {
  const db = base(); const para = byName(db, 'باراسيتامول 500');
  it('takes the nearest expiry first and spills into the next batch', () => {
    const a = allocate(db, para.id, para.perPack * 4);
    expect(a.missing).toBe(0); expect(a.parts).toHaveLength(2);
    expect(a.parts[0].batch.expiry < a.parts[1].batch.expiry).toBe(true);
    expect(a.parts[0].qty).toBe(para.perPack * 3);
  });
  it('never sells expired stock', () => {
    const amox = byName(db, 'اموكسيسيلين 500');
    expect(allocate(db, amox.id, 10 ** 6).parts.every(p => !isExpired(p.batch, TODAY))).toBe(true);
  });
  it('a forced batch overrides the order', () => {
    const later = db.batches.filter(b => b.itemId === para.id && b.qty > 0).sort((a, b) => b.expiry.localeCompare(a.expiry))[0];
    expect(allocate(db, para.id, para.perPack, later.id).parts[0].batch.id).toBe(later.id);
  });
  it('prices each batch at its own price and applies discount', () => {
    const p = priceCart(db, [w(para.id, 4, 'pack', { discountPct: 10 })]);
    expect(p.lines).toHaveLength(2);
    expect(p.net).toBeCloseTo(p.gross * 0.9, 1);
    expect(p.cost).toBeGreaterThan(0);
  });
  it('sub-unit sales price pro rata', () => {
    const p = priceCart(db, [w(para.id, 5, 'sub')]);
    expect(p.lines[0].qtyBase).toBe(5);
    expect(p.lines[0].unitPrice).toBeCloseTo(p.lines[0].total / 5, 1);
  });
  it('reports missing quantity when stock is short', () => {
    const z = byName(db, 'سيتيريزين 10');
    expect(priceCart(db, [w(z.id, 1)]).missing[0].missingBase).toBe(z.perPack);
  });
});

describe('sale', () => {
  it('saves a cash sale, reduces stock, writes movements, numbers the invoice', () => {
    const db = base(); const para = byName(db, 'باراسيتامول 500'); const before = total(db);
    const r = saveSale(db, { wants: [w(para.id, 2)], type: 'cash', customerId: 'c0', role: 'cashier', now: NOW });
    if (!r.ok) throw new Error(r.error);
    expect(r.invoice.no).toBe('B1-000151'); expect(before - total(r.db)).toBe(para.perPack * 2);
    expect(r.db.movements[0].qtyBase).toBeLessThan(0); expect(r.db.invoices[0].id).toBe(r.invoice.id);
  });
  it('refuses empty, insufficient, suspended', () => {
    const db = base();
    expect(saveSale(db, { wants: [], type: 'cash', customerId: 'c0', role: 'cashier', now: NOW })).toMatchObject({ ok: false, error: 'empty' });
    const z = byName(db, 'سيتيريزين 10');
    expect(saveSale(db, { wants: [w(z.id, 1)], type: 'cash', customerId: 'c0', role: 'cashier', now: NOW })).toMatchObject({ ok: false, error: 'insufficient-stock' });
    const s = db.items.find(i => i.suspended)!;
    expect(saveSale(db, { wants: [w(s.id, 1)], type: 'cash', customerId: 'c0', role: 'cashier', now: NOW })).toMatchObject({ ok: false, error: 'suspended' });
  });
  it('credit sales respect the limit and add to the balance', () => {
    const db = base(); const para = byName(db, 'باراسيتامول 500');
    const over = db.customers.find(c => c.balance > c.limit)!;
    expect(saveSale(db, { wants: [w(para.id, 1)], type: 'credit', customerId: over.id, role: 'pharmacist', now: NOW })).toMatchObject({ ok: false, error: 'credit-limit' });
    expect(saveSale(db, { wants: [w(para.id, 1)], type: 'credit', customerId: 'c0', role: 'pharmacist', now: NOW })).toMatchObject({ ok: false, error: 'credit-not-allowed' });
    const ok = db.customers.find(c => c.kind === 'credit' && !c.suspended && c.limit - c.balance > 500)!;
    const r = saveSale(db, { wants: [w(para.id, 1)], type: 'credit', customerId: ok.id, role: 'pharmacist', now: NOW });
    if (!r.ok) throw new Error(r.error);
    expect(r.db.customers.find(c => c.id === ok.id)!.balance).toBeCloseTo(ok.balance + r.invoice.net, 2);
  });
});

describe('void (No-Delete)', () => {
  const db0 = base(); const para = byName(db0, 'باراسيتامول 500');
  const sold = saveSale(db0, { wants: [w(para.id, 2)], type: 'cash', customerId: 'c0', role: 'cashier', now: NOW });
  if (!sold.ok) throw new Error('setup');
  it('needs a manager or owner and a reason', () => {
    expect(voidSale(sold.db, sold.invoice.id, 'x', 'cashier', NOW)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(voidSale(sold.db, sold.invoice.id, '  ', 'manager', NOW)).toMatchObject({ ok: false, error: 'reason-required' });
  });
  it('keeps the invoice, restores stock exactly, records who/when/why, cannot repeat', () => {
    const r = voidSale(sold.db, sold.invoice.id, 'خطأ في الصنف', 'manager', NOW);
    if (!r.ok) throw new Error(r.error);
    expect(total(r.db)).toBe(total(db0));
    const inv = r.db.invoices.find(i => i.id === sold.invoice.id)!;
    expect(inv).toMatchObject({ status: 'void', voidReason: 'خطأ في الصنف', voidBy: 'manager', voidAt: NOW });
    expect(r.db.invoices.length).toBe(sold.db.invoices.length);
    expect(voidSale(r.db, sold.invoice.id, 'again', 'owner', NOW)).toMatchObject({ ok: false, error: 'already-void' });
  });
  it('a credit void gives the customer balance back', () => {
    const c = db0.customers.find(x => x.kind === 'credit' && !x.suspended && x.limit - x.balance > 500)!;
    const s = saveSale(db0, { wants: [w(para.id, 1)], type: 'credit', customerId: c.id, role: 'pharmacist', now: NOW });
    if (!s.ok) throw new Error('setup');
    const v = voidSale(s.db, s.invoice.id, 'رجوع', 'owner', NOW); if (!v.ok) throw new Error(v.error);
    expect(v.db.customers.find(x => x.id === c.id)!.balance).toBeCloseTo(c.balance, 2);
  });
});

describe('hold and shortages', () => {
  it('holds and resumes a cart without touching stock', () => {
    const db = base(); const para = byName(db, 'باراسيتامول 500'); const before = total(db);
    const h = holdSale(db, { wants: [w(para.id, 1)], type: 'cash', customerId: 'c0', now: NOW }); if (!h.ok) throw new Error('x');
    expect(total(h.db)).toBe(before); expect(h.db.held).toHaveLength(1);
    const res = resumeHeld(h.db, h.db.held[0].id)!; expect(res.db.held).toHaveLength(0); expect(res.held.wants[0].itemId).toBe(para.id);
  });
  it('a no-stock attempt becomes one open shortage, not duplicates', () => {
    let db = base(); const z = byName(db, 'سيتيريزين 10');
    db = addShortage(db, z.id, 'no-stock', 'cashier', NOW); db = addShortage(db, z.id, 'no-stock', 'cashier', NOW);
    expect(db.shortages).toHaveLength(1);
  });
});

describe('purchase', () => {
  const db0 = base(); const para = byName(db0, 'باراسيتامول 500');
  const line = { itemId: para.id, expiry: '2028-12-31', qtyPack: 10, bonusPack: 2, costPack: 20, pricePack: para.publicPrice };
  it('computes effective cost with bonus and margin', () => {
    expect(effectiveCost(line)).toBeCloseTo(16.67, 2); expect(marginPct(line)).toBeGreaterThan(0);
  });
  it('creates a batch, adds stock incl. bonus, raises supplier balance by the unpaid part', () => {
    const sup = db0.suppliers[0];
    const r = savePurchase(db0, { supplierId: sup.id, lines: [line], paid: 50, role: 'pharmacist', now: NOW }); if (!r.ok) throw new Error(r.error);
    expect(total(r.db) - total(db0)).toBe(12 * para.perPack);
    expect(r.purchase.total).toBe(200);
    expect(r.db.suppliers[0].balance).toBeCloseTo(sup.balance + 150, 2);
    expect(r.db.batches.find(b => b.id === r.purchase.lines[0].batchId)!.costPack).toBeCloseTo(16.67, 2);
  });
  it('a changed state price makes a batch with its own price (D14)', () => {
    const r = savePurchase(db0, { supplierId: 's1', lines: [{ ...line, pricePack: para.publicPrice + 5 }], paid: 0, role: 'manager', now: NOW }); if (!r.ok) throw new Error(r.error);
    expect(r.db.batches.at(-1)!.priceChanged).toBe(true);
    const p = priceCart(r.db, [w(para.id, 1, 'pack', { batchId: r.db.batches.at(-1)!.id })]);
    expect(p.lines[0].unitPrice).toBe(para.publicPrice + 5);
  });
  it('cashier cannot buy; bad expiry and bad numbers are refused', () => {
    expect(savePurchase(db0, { supplierId: 's1', lines: [line], paid: 0, role: 'cashier', now: NOW })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(savePurchase(db0, { supplierId: 's1', lines: [{ ...line, expiry: '2020-01-01' }], paid: 0, role: 'owner', now: NOW })).toMatchObject({ ok: false, error: 'bad-expiry' });
    expect(savePurchase(db0, { supplierId: 's1', lines: [{ ...line, qtyPack: 0 }], paid: 0, role: 'owner', now: NOW })).toMatchObject({ ok: false, error: 'bad-line' });
  });
  it('closes an open shortage when the item is bought', () => {
    const d = addShortage(db0, para.id, 'manual', 'owner', NOW);
    const r = savePurchase(d, { supplierId: 's1', lines: [line], paid: 0, role: 'owner', now: NOW }); if (!r.ok) throw new Error(r.error);
    expect(r.db.shortages[0].status).toBe('ordered');
  });
});

describe('search', () => {
  it('finds by barcode exactly and by name fragment', () => {
    const db = base(); const it = db.items[10];
    expect(searchItems(db, it.barcode)[0].id).toBe(it.id);
    expect(searchItems(db, 'ميتفورمين').length).toBeGreaterThan(0);
    expect(searchItems(db, '')).toHaveLength(0);
  });
});

import { saveCustomer, cashReceipt, saveItem, draftLineFor, openShortageIds, customerStatement } from './domain';

describe('customers and cash receipts (Sprint 1.2)', () => {
  it('a manager adds a credit customer with a limit; names must be unique and non-empty', () => {
    const db = base();
    const r = saveCustomer(db, { input: { name: 'عميل جديد', kind: 'credit', limit: 4000 }, role: 'manager' }); if (!r.ok) throw new Error(r.error);
    expect(r.customer).toMatchObject({ kind: 'credit', limit: 4000, balance: 0 }); expect(r.db.customers).toHaveLength(41);
    expect(saveCustomer(r.db, { input: { name: 'عميل جديد', kind: 'credit', limit: 1 }, role: 'manager' })).toMatchObject({ ok: false, error: 'duplicate' });
    expect(saveCustomer(db, { input: { name: '  ', kind: 'cash', limit: 0 }, role: 'owner' })).toMatchObject({ ok: false, error: 'name-required' });
    expect(saveCustomer(db, { input: { name: 'س', kind: 'credit', limit: -5 }, role: 'owner' })).toMatchObject({ ok: false, error: 'bad-limit' });
  });
  it('a cashier can add a counter customer but never credit or a limit', () => {
    const r = saveCustomer(base(), { input: { name: 'عميل كاشير', kind: 'credit', limit: 9000 }, role: 'cashier' }); if (!r.ok) throw new Error(r.error);
    expect(r.customer).toMatchObject({ kind: 'cash', limit: 0 });
  });
  it('only management changes a limit or suspends; the walk-in customer is fixed', () => {
    const db = base(); const c = db.customers.find(x => x.kind === 'credit' && !x.suspended)!;
    expect(saveCustomer(db, { input: { id: c.id, name: c.name, kind: 'credit', limit: c.limit + 1000 }, role: 'pharmacist' })).toMatchObject({ ok: false, error: 'forbidden' });
    const ok = saveCustomer(db, { input: { id: c.id, name: c.name, kind: 'credit', limit: c.limit + 1000, suspended: true }, role: 'owner' }); if (!ok.ok) throw new Error(ok.error);
    expect(ok.customer).toMatchObject({ limit: c.limit + 1000, suspended: true });
    expect(saveCustomer(db, { input: { id: 'c0', name: 'x', kind: 'cash', limit: 0 }, role: 'owner' })).toMatchObject({ ok: false, error: 'forbidden' });
  });
  it('a receipt lowers the balance, is numbered, and cannot exceed the balance', () => {
    const db = base(); const c = db.customers.find(x => x.kind === 'credit' && x.balance > 100)!;
    const r = cashReceipt(db, { customerId: c.id, amount: 100, method: 'cash', role: 'cashier', now: NOW }); if (!r.ok) throw new Error(r.error);
    expect(r.receipt.no).toBe('B1-R00001'); expect(r.db.customers.find(x => x.id === c.id)!.balance).toBeCloseTo(c.balance - 100, 2);
    expect(r.receipt.balanceAfter).toBeCloseTo(c.balance - 100, 2); expect(r.db.receipts).toHaveLength(1);
    expect(cashReceipt(db, { customerId: c.id, amount: c.balance + 1, method: 'cash', role: 'owner', now: NOW })).toMatchObject({ ok: false, error: 'over-balance' });
    expect(cashReceipt(db, { customerId: c.id, amount: 0, method: 'cash', role: 'owner', now: NOW })).toMatchObject({ ok: false, error: 'bad-amount' });
    expect(cashReceipt(db, { customerId: 'c0', amount: 5, method: 'cash', role: 'owner', now: NOW })).toMatchObject({ ok: false, error: 'no-customer' });
  });
  it('credit sale then receipt then statement add up', () => {
    const db0 = base(); const para = byName(db0, 'باراسيتامول 500'); const c = db0.customers.find(x => x.kind === 'credit' && !x.suspended && x.limit - x.balance > 500)!;
    const s = saveSale(db0, { wants: [w(para.id, 1)], type: 'credit', customerId: c.id, role: 'pharmacist', now: NOW }); if (!s.ok) throw new Error(s.error);
    const r = cashReceipt(s.db, { customerId: c.id, amount: s.invoice.net, method: 'card', role: 'cashier', now: NOW }); if (!r.ok) throw new Error(r.error);
    expect(r.db.customers.find(x => x.id === c.id)!.balance).toBeCloseTo(c.balance, 2);
    const st = customerStatement(r.db, c.id); expect(st.invoices[0].id).toBe(s.invoice.id); expect(st.receipts).toHaveLength(1);
  });
});

describe('item card (Sprint 1.2)', () => {
  const input = { name: 'منتج تجريبي', drug: false, barcode: '6221999999991', perPack: 1, subUnit: '', publicPrice: 55 };
  it('adds a non-drug item with a free price; barcode and name stay unique', () => {
    const db = base(); const r = saveItem(db, { input, role: 'pharmacist' }); if (!r.ok) throw new Error(r.error);
    expect(r.item).toMatchObject({ drug: false, publicPrice: 55, packUnit: 'قطعة' });
    expect(saveItem(r.db, { input: { ...input, name: 'اخر' }, role: 'owner' })).toMatchObject({ ok: false, error: 'dup-barcode' });
    expect(saveItem(r.db, { input: { ...input, barcode: '6221999999992' }, role: 'owner' })).toMatchObject({ ok: false, error: 'duplicate' });
  });
  it('validates barcode, pack size, price and role', () => {
    const db = base();
    expect(saveItem(db, { input: { ...input, barcode: '12' }, role: 'owner' })).toMatchObject({ ok: false, error: 'bad-barcode' });
    expect(saveItem(db, { input: { ...input, perPack: 0 }, role: 'owner' })).toMatchObject({ ok: false, error: 'bad-pack' });
    expect(saveItem(db, { input: { ...input, publicPrice: 0 }, role: 'owner' })).toMatchObject({ ok: false, error: 'bad-price' });
    expect(saveItem(db, { input, role: 'cashier' })).toMatchObject({ ok: false, error: 'forbidden' });
  });
  it('a drug public price is locked (changes only by purchase, D14); a non-drug price is free', () => {
    const db = base(); const drug = byName(db, 'باراسيتامول 500'); const nd = db.items.find(i => !i.drug)!;
    const asIn = (i: typeof drug) => ({ id: i.id, name: i.name, drug: i.drug, barcode: i.barcode, perPack: i.perPack, subUnit: i.subUnit, publicPrice: i.publicPrice, alt: i.alt });
    expect(saveItem(db, { input: { ...asIn(drug), publicPrice: drug.publicPrice + 1 }, role: 'owner' })).toMatchObject({ ok: false, error: 'drug-price-locked' });
    expect(saveItem(db, { input: { ...asIn(drug), drug: false }, role: 'owner' })).toMatchObject({ ok: false, error: 'drug-flag-locked' });
    const ok = saveItem(db, { input: { ...asIn(nd), publicPrice: nd.publicPrice + 7 }, role: 'manager' }); if (!ok.ok) throw new Error(ok.error);
    expect(ok.item.publicPrice).toBe(nd.publicPrice + 7);
  });
  it('seed gives drugs alternatives of the same ingredient; saving drops unknown or self ids', () => {
    const db = base(); const para = byName(db, 'باراسيتامول 500');
    expect(para.alt.length).toBeGreaterThan(0); expect(para.alt.every(id => db.items.find(i => i.id === id)!.name.startsWith('باراسيتامول'))).toBe(true);
    const r = saveItem(db, { input: { id: para.id, name: para.name, drug: true, barcode: para.barcode, perPack: para.perPack, subUnit: para.subUnit, publicPrice: para.publicPrice, alt: [para.id, 'nope', para.alt[0]] }, role: 'owner' }); if (!r.ok) throw new Error(r.error);
    expect(r.item.alt).toEqual([para.alt[0]]);
  });
});

describe('shortage to purchase draft (Sprint 1.2)', () => {
  it('builds a prefilled line from the latest batch, and the saved purchase closes the shortage', () => {
    let db = base(); const z = byName(db, 'سيتيريزين 10');
    db = addShortage(db, z.id, 'no-stock', 'cashier', NOW);
    expect(openShortageIds(db)).toEqual([z.id]);
    const line = draftLineFor(db, z.id, 12)!;
    expect(line).toMatchObject({ itemId: z.id, qtyPack: 12, pricePack: z.publicPrice }); expect(line.costPack).toBeGreaterThan(0); expect(line.expiry > TODAY).toBe(true);
    const r = savePurchase(db, { supplierId: 's1', lines: [line], paid: 0, role: 'pharmacist', now: NOW }); if (!r.ok) throw new Error(r.error);
    expect(r.db.shortages[0].status).toBe('ordered'); expect(openShortageIds(r.db)).toEqual([]);
    expect(stockOf(r.db, z.id)).toBe(12 * z.perPack);
  });
  it('unknown item gives no draft', () => { expect(draftLineFor(base(), 'nope')).toBeNull(); });
});

import { restoreSale, restoreItem, requestTransfer, advanceTransfer, salesReport, expiryReport, shortagesReport, toCsv } from './domain';

describe('restore (Sprint 1.3)', () => {
  const db0 = base(); const para = byName(db0, 'باراسيتامول 500');
  const sold = saveSale(db0, { wants: [w(para.id, 2)], type: 'cash', customerId: 'c0', role: 'cashier', now: NOW }); if (!sold.ok) throw new Error('setup');
  const voided = voidSale(sold.db, sold.invoice.id, 'خطأ', 'manager', NOW); if (!voided.ok) throw new Error('setup');
  it('management restores a voided invoice and stock goes out again; history stays', () => {
    const r = restoreSale(voided.db, sold.invoice.id, 'owner', NOW); if (!r.ok) throw new Error(r.error);
    expect(total(r.db)).toBe(total(sold.db));
    expect(r.db.invoices.find(i => i.id === sold.invoice.id)).toMatchObject({ status: 'saved', restoredBy: 'owner', voidReason: 'خطأ' });
  });
  it('refuses for staff, for a non-void invoice, and when the stock is gone', () => {
    expect(restoreSale(voided.db, sold.invoice.id, 'pharmacist', NOW)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(restoreSale(sold.db, sold.invoice.id, 'owner', NOW)).toMatchObject({ ok: false, error: 'not-void' });
    const gone = { ...voided.db, batches: voided.db.batches.map(b => ({ ...b, qty: 0 })) };
    expect(restoreSale(gone, sold.invoice.id, 'owner', NOW)).toMatchObject({ ok: false, error: 'insufficient-stock' });
  });
  it('a restored credit invoice puts the balance back', () => {
    const c = db0.customers.find(x => x.kind === 'credit' && !x.suspended && x.limit - x.balance > 500)!;
    const s = saveSale(db0, { wants: [w(para.id, 1)], type: 'credit', customerId: c.id, role: 'pharmacist', now: NOW }); if (!s.ok) throw new Error('x');
    const v = voidSale(s.db, s.invoice.id, 'r', 'owner', NOW); if (!v.ok) throw new Error('x');
    const r = restoreSale(v.db, s.invoice.id, 'owner', NOW); if (!r.ok) throw new Error(r.error);
    expect(r.db.customers.find(x => x.id === c.id)!.balance).toBeCloseTo(c.balance + s.invoice.net, 2);
  });
  it('an archived item is restored by management only', () => {
    const s = db0.items.find(i => i.suspended)!;
    expect(restoreItem(db0, s.id, 'cashier')).toMatchObject({ ok: false, error: 'forbidden' });
    const r = restoreItem(db0, s.id, 'manager'); if (!r.ok) throw new Error(r.error);
    expect(r.db.items.find(i => i.id === s.id)!.suspended).toBe(false);
  });
});

describe('branch transfer request (Sprint 1.3)', () => {
  const db0 = base(); const item = db0.items.find(i => i.otherBranchQty >= 3)!;
  it('requests only what the other branch has, then moves through the chain; stock arrives only when received', () => {
    expect(requestTransfer(db0, { itemId: item.id, qtyPack: item.otherBranchQty + 1, role: 'manager', now: NOW })).toMatchObject({ ok: false, error: 'other-branch-short' });
    expect(requestTransfer(db0, { itemId: item.id, qtyPack: 0, role: 'manager', now: NOW })).toMatchObject({ ok: false, error: 'bad-line' });
    let r = requestTransfer(db0, { itemId: item.id, qtyPack: 3, role: 'manager', now: NOW }); if (!r.ok) throw new Error(r.error);
    let db = r.db; const id = r.transfer.id; const before = stockOf(db, item.id);
    for (const st of ['accepted', 'dispatched'] as const) { const a = advanceTransfer(db, id, 'manager', NOW); if (!a.ok) throw new Error(a.error); db = a.db; expect(db.transfers[0].status).toBe(st); }
    expect(db.items.find(i => i.id === item.id)!.otherBranchQty).toBe(item.otherBranchQty - 3); expect(stockOf(db, item.id)).toBe(before);
    const rec = advanceTransfer(db, id, 'manager', NOW); if (!rec.ok) throw new Error(rec.error); db = rec.db;
    expect(stockOf(db, item.id)).toBe(before + 3 * item.perPack); expect(db.transfers[0].log.map(l => l.status)).toEqual(['requested', 'accepted', 'dispatched', 'received']);
    expect(advanceTransfer(db, id, 'manager', NOW)).toMatchObject({ ok: false, error: 'already-done' });
  });
});

describe('report centre (Sprint 1.3)', () => {
  const db = base();
  it('sales by day groups, sums and ignores void unless asked', () => {
    const rows = salesReport(db, { from: '2000-01-01', to: '2100-01-01', group: 'day' });
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(150); expect(rows[0].key >= rows.at(-1)!.key).toBe(true);
    const total = rows.reduce((s, r) => s + r.net, 0); expect(total).toBeCloseTo(db.invoices.reduce((s, i) => s + i.net, 0), 1);
    const para = byName(db, 'باراسيتامول 500'); const s = saveSale(db, { wants: [w(para.id, 1)], type: 'cash', customerId: 'c0', role: 'cashier', now: TODAY + 'T12:30:00.000Z' }); if (!s.ok) throw new Error('x');
    const v = voidSale(s.db, s.invoice.id, 'r', 'owner', NOW); if (!v.ok) throw new Error('x');
    const f = { from: TODAY, to: TODAY, group: 'type' as const };
    const cnt = (d: Db, extra = {}) => salesReport(d, { ...f, ...extra }).reduce((a, r) => a + r.count, 0);
    expect(cnt(v.db)).toBe(cnt(db)); expect(cnt(v.db, { includeVoid: true })).toBe(cnt(db) + 1); expect(cnt(s.db)).toBe(cnt(db) + 1);
  });
  it('profit is net minus cost per group', () => { for (const r of salesReport(db, { from: '2000-01-01', to: '2100-01-01', group: 'type' })) expect(r.profit).toBeCloseTo(r.net - r.cost, 2); });
  it('expiry report lists expired and near-expiry batches, soonest first', () => {
    const rows = expiryReport(db, 90); expect(rows.length).toBeGreaterThan(0); expect(rows.every(r => r.days <= 90 && r.qty > 0)).toBe(true);
    expect(rows.some(r => r.days < 0)).toBe(true); for (let i = 1; i < rows.length; i++) expect(rows[i].days).toBeGreaterThanOrEqual(rows[i - 1].days);
  });
  it('shortages report filters by status and CSV escapes commas and quotes', () => {
    const d = addShortage(db, db.items[0].id, 'manual', 'owner', NOW);
    expect(shortagesReport(d, 'open')).toHaveLength(1); expect(shortagesReport(d, 'ordered')).toHaveLength(0);
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, 2]])).toBe('a,b\n"x,y","say ""hi"""\n1,2');
  });
});
