import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchError, BatchService, ItemService, MIGRATIONS, amountFor, parseExpiry, type ItemInput } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const pharm: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const TODAY = '2026-12-01';
const setup = () => { const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), MIGRATIONS); const items = new ItemService(hub); return { hub, items, bs: new BatchService(hub, items, { today: () => TODAY }) }; };
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'شريط', factor: 10 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as BatchError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `k${++n}`;
const rec = (bs: BatchService, itemId: string, o: Record<string, unknown> = {}) => bs.receive(owner, { key: key(), itemId, lot: 'L1', expiry: '2027-06-30', qty: 5, costMinor: 3000, publicPriceMinor: 4500, pharmacistPriceMinor: 4200, ...o } as never);

describe('expiry parsing and money', () => {
  it('month/year means the last day of the month', () => {
    expect(parseExpiry('12/27')).toBe('2027-12-31'); expect(parseExpiry('2/2028')).toBe('2028-02-29'); expect(parseExpiry('2027-09')).toBe('2027-09-30'); expect(parseExpiry('2027-09-15')).toBe('2027-09-15');
    for (const bad of ['13/27', '2027-02-30', 'soon', '', '2027']) expect(() => parseExpiry(bad), bad).toThrow();
  });
  it('rounds half up to a piaster, once per pick', () => { expect(amountFor(1, 4500, 20)).toBe(225); expect(amountFor(3, 4550, 20)).toBe(683); expect(amountFor(1, 1, 3)).toBe(0); expect(amountFor(2, 1, 3)).toBe(1); expect(amountFor(20, 4500, 20)).toBe(4500); });
});

describe('receiving batches (D14)', () => {
  it('creates the batch, the stock movement, audit and outbox together; stock counts in base units', () => {
    const { hub, items, bs } = setup(); const it = items.create(owner, drug());
    const r = rec(bs, it.id, { qty: 5, unitName: 'علبة' }); expect(r.created).toBe(true); expect(r.batch).toMatchObject({ lot: 'L1', expiry: '2027-06-30', publicPriceMinor: 4500, pharmacistPriceMinor: 4200, status: 'active', priceUnit: { name: 'علبة', factor: 20 } });
    expect(bs.balances(it.id).get(r.batch.id)).toBe(100); expect(hub.balance(it.id)).toBe(100);
    expect(hub.auditEntries().some(e => e.action === 'stock.purchase')).toBe(true); expect(hub.auditEntries().some(e => e.action === 'batch.created')).toBe(true); expect(hub.outboxPending().some(o => o.type === 'batch.created')).toBe(true); expect(hub.verifyAudit()).toBeNull();
  });
  it('same lot and expiry with the same prices adds to the batch; a repeated delivery adds nothing; other prices conflict', () => {
    const { items, bs } = setup(); const it = items.create(owner, drug()); const a = rec(bs, it.id, { key: 'inv1:1', qty: 2, unitName: 'علبة' });
    const b = rec(bs, it.id, { key: 'inv2:1', qty: 1, unitName: 'علبة' }); expect(b.created).toBe(false); expect(b.batch.id).toBe(a.batch.id); expect(bs.balances(it.id).get(a.batch.id)).toBe(60);
    expect(rec(bs, it.id, { key: 'inv2:1', qty: 1, unitName: 'علبة' }).replay).toBe(true); expect(bs.balances(it.id).get(a.batch.id)).toBe(60);
    expect(code(() => rec(bs, it.id, { publicPriceMinor: 5000, pharmacistPriceMinor: 4700 }))).toBe('price-conflict');
  });
  it('price rules: drug needs the state public price, pharmacist <= public, non-drug prices live on the item (D20)', () => {
    const { items, bs } = setup(); const it = items.create(owner, drug());
    expect(code(() => rec(bs, it.id, { publicPriceMinor: undefined, pharmacistPriceMinor: undefined }))).toBe('invalid'); expect(code(() => rec(bs, it.id, { pharmacistPriceMinor: 5000 }))).toBe('invalid');
    expect(code(() => rec(bs, it.id, { costMinor: -1 }))).toBe('invalid'); expect(code(() => rec(bs, it.id, { costMinor: 10.5 }))).toBe('invalid');
    const nd = items.create(owner, { nameAr: 'كريم', kind: 'non_drug', listPriceMinor: 8000, units: [{ name: 'عبوة', factor: 1 }] });
    expect(code(() => rec(bs, nd.id, { publicPriceMinor: 8000 }))).toBe('invalid'); expect(rec(bs, nd.id, { publicPriceMinor: undefined, pharmacistPriceMinor: undefined, costMinor: 5000 }).batch.publicPriceMinor).toBeNull();
    const svc = items.create(owner, { nameAr: 'قياس ضغط', kind: 'service', units: [{ name: 'مرة', factor: 1 }] }); expect(code(() => rec(bs, svc.id))).toBe('invalid');
  });
  it('refuses expired batches, suspended items, empty lots, bad quantities; warns about near expiry and cost above price', () => {
    const { items, bs } = setup(); const it = items.create(owner, drug());
    expect(code(() => rec(bs, it.id, { expiry: '2026-11-30' }))).toBe('expired'); expect(code(() => rec(bs, it.id, { lot: ' ' }))).toBe('invalid'); expect(code(() => rec(bs, it.id, { qty: 0 }))).toBe('invalid'); expect(code(() => rec(bs, it.id, { qty: 1.5 }))).toBe('invalid');
    const w = rec(bs, it.id, { lot: 'L2', expiry: '2027-01-15', costMinor: 5000 }); expect(w.warnings).toEqual(expect.arrayContaining(['cost-above-price', 'near-expiry:45']));
    items.setStatus(owner, it.id, 'suspended', 'recall'); expect(code(() => rec(bs, it.id, { lot: 'L3' }))).toBe('blocked');
  });
  it('permissions: cashier cannot receive; failed validation leaves nothing behind', () => {
    const { hub, items, bs } = setup(); const it = items.create(owner, drug()); const before = hub.auditEntries().length;
    expect(code(() => bs.receive(cashier, { key: 'x', itemId: it.id, lot: 'L', expiry: '2027-06-30', qty: 1, costMinor: 1, publicPriceMinor: 2 }))).toBe('forbidden');
    expect(code(() => rec(bs, it.id, { qty: -1 }))).toBe('invalid'); expect(hub.auditEntries().length).toBe(before); expect(bs.balances(it.id).size).toBe(0);
  });
});

describe('FEFO allocation (D21) with per-batch prices (D14)', () => {
  const twoBatches = () => { const s = setup(); const it = s.items.create(owner, drug());
    const old = rec(s.bs, it.id, { lot: 'OLD', expiry: '2027-03-31', qty: 1, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 4000, pharmacistPriceMinor: 3700 });
    const nw = rec(s.bs, it.id, { lot: 'NEW', expiry: '2028-03-31', qty: 2, unitName: 'علبة', costMinor: 3200, publicPriceMinor: 4500, pharmacistPriceMinor: 4200 }); return { ...s, it, old, nw }; };
  it('takes the nearest expiry first and splits across batches, each at its own price', () => {
    const { bs, it, old, nw } = twoBatches(); const a = bs.allocate(it.id, 30);
    expect(a.picks.map(p => [p.lot, p.qtyBase, p.unitPriceMinor])).toEqual([['OLD', 20, 4000], ['NEW', 10, 4500]]); expect(a.totalMinor).toBe(4000 + 2250); expect(a.missingBase).toBe(0);
    expect(a.picks[0]!.batchId).toBe(old.batch.id); expect(a.picks[1]!.batchId).toBe(nw.batch.id);
    expect(bs.allocate(it.id, 30, { priceKind: 'pharmacist' }).totalMinor).toBe(3700 + 2100);
  });
  it('reports a shortage instead of inventing stock', () => { const { bs, it } = twoBatches(); const a = bs.allocate(it.id, 100); expect(a.picks.reduce((s, p) => s + p.qtyBase, 0)).toBe(60); expect(a.missingBase).toBe(40); });
  it('sold stock is respected (stock comes from the ledger) and an emptied batch is skipped', () => {
    const { hub, bs, it, old } = twoBatches(); hub.record({ key: 's1', storeId: 'MAIN', itemId: it.id, batchId: old.batch.id, qty: -20, kind: 'sale', actor: 'u' });
    expect(bs.allocate(it.id, 5).picks.map(p => p.lot)).toEqual(['NEW']); expect(bs.balances(it.id).get(old.batch.id)).toBe(0);
  });
  it('an expired batch is never sold; a quarantined one neither; release brings it back', () => {
    const { hub, items, bs } = setup(); const it = items.create(owner, drug()); const b = rec(bs, it.id, { lot: 'A', expiry: '2026-12-15', qty: 1, unitName: 'علبة' });
    const late = new BatchService(hub, items, { today: () => '2026-12-20' }); expect(late.allocate(it.id, 5)).toMatchObject({ picks: [], missingBase: 5 });
    bs.setStatus(pharm, b.batch.id, 'quarantined', 'supplier recall'); expect(bs.allocate(it.id, 5).picks).toEqual([]); expect(bs.statusLog(b.batch.id)[0]).toMatchObject({ from: 'active', to: 'quarantined', by: 'ph', reason: 'supplier recall' });
    bs.setStatus(pharm, b.batch.id, 'active', 'cleared'); expect(bs.allocate(it.id, 5).picks).toHaveLength(1);
  });
  it('a chosen batch is honoured but never an expired, held or empty one', () => {
    const { bs, it, nw } = twoBatches(); expect(bs.allocate(it.id, 5, { forceBatchId: nw.batch.id }).picks[0]!.lot).toBe('NEW'); expect(code(() => bs.allocate(it.id, 5, { forceBatchId: 'nope' }))).toBe('blocked');
  });
  it('ties on expiry go to the batch received first; non-drug uses the free item price; suspended items cannot be allocated', () => {
    const { items, bs } = setup(); const it = items.create(owner, drug()); rec(bs, it.id, { lot: 'A', expiry: '2027-06-30', qty: 1 }); rec(bs, it.id, { lot: 'B', expiry: '2027-06-30', qty: 1 }); expect(bs.allocate(it.id, 1).picks[0]!.lot).toBe('A');
    const nd = items.create(owner, { nameAr: 'كريم', kind: 'non_drug', listPriceMinor: 8550, units: [{ name: 'عبوة', factor: 1 }] }); rec(bs, nd.id, { publicPriceMinor: undefined, pharmacistPriceMinor: undefined, qty: 4 });
    expect(bs.allocate(nd.id, 3)).toMatchObject({ totalMinor: 3 * 8550, missingBase: 0 }); items.setStatus(owner, it.id, 'suspended', 'x'); expect(code(() => bs.allocate(it.id, 1))).toBe('blocked');
  });
  it('rounding of a fractional unit price is once per pick', () => { const { bs, it } = twoBatches(); expect(bs.allocate(it.id, 3).totalMinor).toBe(amountFor(3, 4000, 20)); expect(amountFor(3, 4000, 20)).toBe(600); });
});

describe('visibility and reports', () => {
  it('cost is hidden from those who may not see cost (matrix rule 1); batch view needs permission', () => {
    const { items, bs } = setup(); const it = items.create(owner, drug()); rec(bs, it.id);
    expect(bs.batches(pharm, it.id)[0]).toMatchObject({ costMinor: null, publicPriceMinor: 4500 }); expect(bs.batches(mgr, it.id)[0]!.costMinor).toBe(3000); expect(code(() => bs.batches(cashier, it.id))).toBe('forbidden');
    expect(bs.batches(owner, it.id)[0]).toMatchObject({ qtyBase: 100, expired: false });
  });
  it('expiry report: window, nearest first, only batches with stock, value at cost for those who may see it', () => {
    const { hub, items, bs } = setup(); const a = items.create(owner, drug()); const b = items.create(owner, drug({ nameAr: 'ايبوبروفين' }));
    const x = rec(bs, a.id, { lot: 'X', expiry: '2027-01-20', qty: 2, unitName: 'علبة', costMinor: 3000 }); rec(bs, a.id, { lot: 'FAR', expiry: '2028-06-30', qty: 1 }); rec(bs, b.id, { lot: 'Y', expiry: '2026-12-31', qty: 1, unitName: 'علبة', costMinor: 1000 }); rec(bs, b.id, { lot: 'GONE', expiry: '2026-12-10', qty: 1 });
    hub.record({ key: 'sold', storeId: 'MAIN', itemId: b.id, batchId: bs.batches(owner, b.id).find(z => z.lot === 'GONE')!.id, qty: -20, kind: 'sale', actor: 'u' });
    const r = bs.expiryReport(owner, 90); expect(r.map(z => [z.lot, z.daysLeft, z.qtyBase, z.valueMinor])).toEqual([['Y', 30, 20, 1000], ['X', 50, 40, 6000]]); expect(r[0]!.itemName).toBe('ايبوبروفين');
    expect(bs.expiryReport(pharm, 90)[0]!.valueMinor).toBeNull(); expect(bs.expiryReport(owner, 40).map(z => z.lot)).toEqual(['Y']); expect(code(() => bs.expiryReport(cashier))).toBe('forbidden'); expect(x.batch.expiry).toBe('2027-01-20');
  });
});

describe('No-Delete and facts that never change', () => {
  it('prices, lot, expiry and cost cannot be edited; batches and logs cannot be deleted', () => {
    const { hub, items, bs } = setup(); const it = items.create(owner, drug()); const b = rec(bs, it.id); bs.setStatus(owner, b.batch.id, 'quarantined', 'x');
    for (const sql of ["UPDATE batches SET public_price_minor=1", "UPDATE batches SET cost_minor=1", "UPDATE batches SET expiry='2030-01-01'", "UPDATE batches SET lot='Z'", 'DELETE FROM batches', 'DELETE FROM batch_status_log', "UPDATE batch_status_log SET reason='y'"]) expect(() => hub.db.exec(sql), sql).toThrow();
    expect(code(() => bs.setStatus(owner, b.batch.id, 'quarantined', 'again'))).toBe('same-status'); expect(code(() => bs.setStatus(owner, b.batch.id, 'active', ' '))).toBe('reason-required'); expect(code(() => bs.setStatus(cashier, b.batch.id, 'active', 'x'))).toBe('forbidden');
  });
  it('the database itself refuses a drug batch without a state price and a batch for a service', () => {
    const { hub, items } = setup(); const d = items.create(owner, drug()); const s = items.create(owner, { nameAr: 'خدمة', kind: 'service', units: [{ name: 'مرة', factor: 1 }] }); const u = items.get(d.id)!.units[0]!.id; const su = items.get(s.id)!.units[0]!.id;
    const ins = (item: string, unit: string, pub: string) => hub.db.exec(`INSERT INTO batches(id,item_id,lot,expiry,price_unit_id,cost_minor,public_price_minor,received_at,received_by) VALUES('b${Math.random()}','${item}','L','2027-01-01','${unit}',1,${pub},'t','u')`);
    expect(() => ins(d.id, u, 'NULL')).toThrow(/state public price/); expect(() => ins(s.id, su, '5')).toThrow(/no batches/); expect(() => ins(d.id, u, '0')).toThrow();
  });
});
