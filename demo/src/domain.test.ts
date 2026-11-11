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
