import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, StockError, StockService, type ItemInput } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const pharm: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const store: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const setup = (today = '2026-12-01') => { const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), MIGRATIONS); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => today }); return { hub, items, bs, st: new StockService(hub, items, bs) }; };
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as StockError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `k${++n}`;
const rec = (bs: BatchService, itemId: string, o: Record<string, unknown> = {}) => bs.receive(owner, { key: key(), itemId, lot: 'L1', expiry: '2027-06-30', qty: 5, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 4500, pharmacistPriceMinor: 4200, ...o } as never);

describe('stores', () => {
  it('the main store exists from the start; stores are created, listed and never deleted', () => {
    const { hub, st } = setup(); expect(st.stores().map(s => [s.id, s.sellable])).toEqual([['MAIN', true]]);
    const w = st.createStore(mgr, 'مخزن خلفي', 'warehouse'); const e = st.createStore(mgr, 'منتهي الصلاحية', 'expired'); expect(w.sellable).toBe(true); expect(e.sellable).toBe(false);
    expect(code(() => st.createStore(mgr, 'مخزن خلفي', 'warehouse'))).toBe('invalid'); expect(code(() => st.createStore(mgr, '', 'warehouse'))).toBe('invalid'); expect(code(() => st.createStore(mgr, 'x', 'main'))).toBe('invalid'); expect(code(() => st.createStore(pharm, 'y', 'warehouse'))).toBe('forbidden');
    for (const sql of ['DELETE FROM stores', "UPDATE stores SET sellable=1 WHERE kind='expired'", "UPDATE stores SET kind='warehouse' WHERE id='MAIN'"]) expect(() => hub.db.exec(sql), sql).toThrow();
    expect(hub.auditEntries().filter(a => a.action === 'store.created')).toHaveLength(2);
  });
  it('a store can be switched off only when empty; the main store never', () => {
    const { items, bs, st } = setup(); const w = st.createStore(mgr, 'خلفي', 'warehouse'); const it = items.create(owner, drug()); rec(bs, it.id, { storeId: w.id });
    expect(code(() => st.setStoreActive(mgr, w.id, false))).toBe('not-empty'); expect(code(() => st.setStoreActive(mgr, 'MAIN', false))).toBe('blocked');
    st.transfer(mgr, { key: 'mv', itemId: it.id, qtyBase: 100, fromStore: w.id, toStore: 'MAIN' }); st.setStoreActive(mgr, w.id, false); expect(st.stores().map(s => s.id)).toEqual(['MAIN']); expect(st.stores(true)).toHaveLength(2);
    expect(code(() => rec(bs, it.id, { storeId: w.id }))).toBe('invalid'); st.setStoreActive(mgr, w.id, true); expect(code(() => st.setStoreActive(mgr, 'nope', true))).toBe('not-found');
  });
  it('only sellable stores feed the cashier: returns and expired stores are never sold from', () => {
    const { items, bs, st } = setup(); const it = items.create(owner, drug()); const r = st.createStore(mgr, 'مرتجعات', 'returns'); rec(bs, it.id, { qty: 1, storeId: r.id });
    expect(bs.allocate(it.id, 5)).toMatchObject({ picks: [], missingBase: 5 }); expect(st.onHand(it.id)).toBe(20); expect(st.onHand(it.id, { sellableOnly: true })).toBe(0);
    rec(bs, it.id, { lot: 'L2', qty: 1 }); expect(bs.allocate(it.id, 5).picks.map(p => p.lot)).toEqual(['L2']); expect(bs.allocate(it.id, 5, { storeId: r.id }).picks).toEqual([]);
  });
});

describe('transfers between stores', () => {
  const two = () => { const s = setup(); const it = s.items.create(owner, drug()); const w = s.st.createStore(mgr, 'خلفي', 'warehouse');
    const a = rec(s.bs, it.id, { lot: 'OLD', expiry: '2027-03-31', qty: 1, publicPriceMinor: 4000, pharmacistPriceMinor: 3700 }); const b = rec(s.bs, it.id, { lot: 'NEW', expiry: '2028-03-31', qty: 2 }); return { ...s, it, w, a, b }; };
  it('moves nearest expiry first across batches, keeping each batch, with one transfer number', () => {
    const { st, bs, it, w, a, b } = two(); const r = st.transfer(store, { key: 't1', itemId: it.id, qtyBase: 30, fromStore: 'MAIN', toStore: w.id, reason: 'restock back store' });
    expect(r).toMatchObject({ transferNo: 'T-000001', replay: false }); expect(r.moved).toEqual([{ batchId: a.batch.id, qtyBase: 20 }, { batchId: b.batch.id, qtyBase: 10 }]);
    expect(bs.balances(it.id, { storeId: 'MAIN' }).get(a.batch.id) ?? 0).toBe(0); expect(bs.balances(it.id, { storeId: w.id }).get(a.batch.id)).toBe(20); expect(bs.balances(it.id, { storeId: 'MAIN' }).get(b.batch.id)).toBe(30);
    expect(st.onHand(it.id)).toBe(60); expect(st.byStore(owner, it.id).map(x => [x.storeName, x.qtyBase])).toEqual([['المخزن الرئيسي', 30], ['خلفي', 30]]);
  });
  it('a chosen batch can be moved; not enough stock moves nothing; same store, bad quantity, unknown store, service are refused', () => {
    const { hub, st, it, w, b } = two(); const before = hub.movementCount();
    expect(st.transfer(store, { key: 't2', itemId: it.id, qtyBase: 10, fromStore: 'MAIN', toStore: w.id, batchId: b.batch.id }).moved).toEqual([{ batchId: b.batch.id, qtyBase: 10 }]);
    expect(code(() => st.transfer(store, { key: 't3', itemId: it.id, qtyBase: 500, fromStore: 'MAIN', toStore: w.id }))).toBe('insufficient'); expect(hub.movementCount()).toBe(before + 2);
    expect(code(() => st.transfer(store, { key: 't4', itemId: it.id, qtyBase: 1, fromStore: 'MAIN', toStore: 'MAIN' }))).toBe('invalid'); expect(code(() => st.transfer(store, { key: 't5', itemId: it.id, qtyBase: 0, fromStore: 'MAIN', toStore: w.id }))).toBe('invalid');
    expect(code(() => st.transfer(store, { key: 't6', itemId: it.id, qtyBase: 1, fromStore: 'MAIN', toStore: 'ghost' }))).toBe('invalid'); expect(code(() => st.transfer(cashier, { key: 't7', itemId: it.id, qtyBase: 1, fromStore: 'MAIN', toStore: w.id }))).toBe('forbidden');
    expect(code(() => st.transfer(store, { key: 't8', itemId: 'nope', qtyBase: 1, fromStore: 'MAIN', toStore: w.id }))).toBe('not-found');
  });
  it('repeating the same key changes nothing and returns the same transfer', () => {
    const { hub, st, it, w } = two(); const a = st.transfer(store, { key: 'same', itemId: it.id, qtyBase: 25, fromStore: 'MAIN', toStore: w.id }); const c = hub.movementCount(); const b = st.transfer(store, { key: 'same', itemId: it.id, qtyBase: 25, fromStore: 'MAIN', toStore: w.id });
    expect(b).toMatchObject({ replay: true, transferNo: a.transferNo, moved: a.moved }); expect(hub.movementCount()).toBe(c);
  });
  it('writes audit and outbox; transfer rows and movements cannot be edited or deleted; expired stock may be moved to an expired store', () => {
    const { hub, items, bs, st } = setup('2027-07-15'); const it = items.create(owner, drug()); const old = new BatchService(hub, items, { today: () => '2026-12-01' }); const b = old.receive(owner, { key: 'r', itemId: it.id, lot: 'E', expiry: '2027-06-30', qty: 1, unitName: 'علبة', costMinor: 1000, publicPriceMinor: 2000 });
    const ex = st.createStore(mgr, 'منتهي', 'expired'); expect(bs.allocate(it.id, 5).picks).toEqual([]); st.transfer(mgr, { key: 'x', itemId: it.id, qtyBase: 20, fromStore: 'MAIN', toStore: ex.id, reason: 'expired' });
    expect(st.onHand(it.id, { storeId: ex.id })).toBe(20); expect(hub.auditEntries().at(-1)).toMatchObject({ action: 'store.transfer' }); expect(hub.outboxPending().at(-1)).toMatchObject({ type: 'store.transferred' }); expect(b.batch.lot).toBe('E');
    for (const sql of ['DELETE FROM store_transfers', "UPDATE store_transfers SET qty_base=1", 'DELETE FROM movements']) expect(() => hub.db.exec(sql), sql).toThrow(); expect(hub.verifyAudit()).toBeNull();
  });
});

describe('stock card (kardex)', () => {
  it('lists movements with a running balance; opening balance for a date range; store filter; lots need batch view', () => {
    const times = ['2026-12-01T08:00:00Z', '2026-12-02T08:00:00Z', '2026-12-03T08:00:00Z']; let i = 0; const hub = Hub.open('b1', ':memory:', () => new Date(times[Math.min(i, 2)]!), MIGRATIONS);
    const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); const st = new StockService(hub, items, bs); const it = items.create(owner, drug()); const w = st.createStore(mgr, 'خلفي', 'warehouse');
    rec(bs, it.id, { lot: 'A', qty: 2 }); i = 1; hub.record({ key: 's1', storeId: 'MAIN', itemId: it.id, batchId: [...bs.balances(it.id).keys()][0]!, qty: -5, kind: 'sale', actor: 'cs', ref: 'INV-1' }); i = 2; st.transfer(store, { key: 't', itemId: it.id, qtyBase: 10, fromStore: 'MAIN', toStore: w.id });
    const all = st.card(owner, it.id); expect(all.lines.map(l => [l.kind, l.qty, l.balance])).toEqual([['purchase', 40, 40], ['sale', -5, 35], ['transfer_out', -10, 25], ['transfer_in', 10, 35]]); expect(all.closing).toBe(35); expect(all.lines[0]!.lot).toBe('A');
    const day2 = st.card(owner, it.id, { fromIso: '2026-12-02T00:00:00Z' }); expect(day2.opening).toBe(40); expect(day2.lines).toHaveLength(3); expect(day2.closing).toBe(35); expect(st.card(owner, it.id, { fromIso: '2026-12-01T00:00:00Z', toIso: '2026-12-01T23:59:59Z' }).lines).toHaveLength(1);
    const wh = st.card(owner, it.id, { storeId: w.id }); expect(wh.lines.map(l => l.balance)).toEqual([10]); expect(st.card(cashier, it.id).lines[0]!.lot).toBeNull(); expect(code(() => st.card({ id: 'x', roles: ['D'], branchIds: ['b1'] }, it.id))).toBe('forbidden');
    expect(all.lines[1]).toMatchObject({ ref: 'INV-1', actor: 'cs' });
  });
});

describe('summary, valuation, low stock', () => {
  it('summary separates sellable from expired, held and non-sellable stock in one query', () => {
    const { items, bs, st } = setup('2026-12-01'); const a = items.create(owner, drug()); const r = st.createStore(mgr, 'مرتجع', 'returns');
    rec(bs, a.id, { lot: 'OK', qty: 1 }); const q = rec(bs, a.id, { lot: 'HELD', expiry: '2027-08-31', qty: 1 }); bs.setStatus(owner, q.batch.id, 'quarantined', 'recall'); rec(bs, a.id, { lot: 'RET', expiry: '2027-09-30', qty: 1, storeId: r.id });
    expect(st.summary(cashier, [a.id]).get(a.id)).toEqual({ total: 60, sellable: 20 }); expect(code(() => st.summary({ id: 'x', roles: ['D'], branchIds: ['b1'] }))).toBe('forbidden');
  });
  it('valuation at cost per batch (cost view only), expired value shown apart', () => {
    const { hub, items, bs, st } = setup('2026-12-01'); const a = items.create(owner, drug()); const b = items.create(owner, drug({ nameAr: 'ايبوبروفين' }));
    rec(bs, a.id, { lot: 'A', qty: 2, costMinor: 3000 }); rec(bs, b.id, { lot: 'B', qty: 1, costMinor: 1000 }); const late = new BatchService(hub, items, { today: () => '2026-12-01' });
    late.receive(owner, { key: 'e', itemId: b.id, lot: 'EXP', expiry: '2026-12-02', qty: 1, unitName: 'علبة', costMinor: 500, publicPriceMinor: 900 });
    const later = new StockService(hub, items, new BatchService(hub, items, { today: () => '2026-12-10' })); const v = later.valuation(owner);
    expect(v.items.map(x => [x.name, x.valueMinor, x.expiredValueMinor])).toEqual([['باراسيتامول 500', 6000, 0], ['ايبوبروفين', 1500, 500]]); expect(v).toMatchObject({ totalMinor: 7500, expiredMinor: 500 });
    expect(code(() => st.valuation(pharm))).toBe('forbidden'); expect(st.valuation(mgr).totalMinor).toBe(7500);
  });
  it('low stock: at or below the reorder level, sellable stock only, biggest shortfall first; services and suspended items ignored', () => {
    const { items, bs, st } = setup(); const a = items.create(owner, drug({ nameAr: 'أ', reorderLevel: 30 })); const b = items.create(owner, drug({ nameAr: 'ب', reorderLevel: 10 })); const c = items.create(owner, drug({ nameAr: 'ج', reorderLevel: 0 })); const d = items.create(owner, drug({ nameAr: 'د', reorderLevel: 50 }));
    items.create(owner, { nameAr: 'خدمة', kind: 'service', reorderLevel: 5, units: [{ name: 'مرة', factor: 1 }] }); rec(bs, a.id, { qty: 1 }); rec(bs, b.id, { qty: 3 }); rec(bs, c.id, { qty: 0 + 1 }); items.setStatus(owner, d.id, 'suspended', 'x');
    expect(st.lowStock(pharm).map(x => [x.name, x.onHand, x.shortfall])).toEqual([['أ', 20, 10]]); rec(bs, a.id, { lot: 'L9', expiry: '2027-08-31', qty: 1 }); expect(st.lowStock(pharm)).toEqual([]);
  });
});

describe('scale', () => {
  it('25,000 items with 3 batches each: item list summary and a stock card stay fast', () => {
    const { hub, st } = setup(); const t0 = Date.now();
    hub.db.tx(() => { const ii = hub.db.prepare("INSERT INTO items(id,code,name_ar,kind,search_text,created_at,created_by,updated_at) VALUES(?,?,?,'drug','x','t','u','t')"), iu = hub.db.prepare("INSERT INTO item_units(id,item_id,name,factor,is_base) VALUES(?,?,'حبة',1,1)"),
      ib = hub.db.prepare("INSERT INTO batches(id,item_id,lot,expiry,price_unit_id,cost_minor,public_price_minor,received_at,received_by) VALUES(?,?,?,?,?,100,200,'t','u')"), im = hub.db.prepare("INSERT INTO movements(id,branch_id,store_id,item_id,batch_id,qty,kind,actor,created_at) VALUES(?,?,?,?,?,5,'purchase','u','2026-12-01T00:00:00Z')");
      for (let i = 0; i < 25000; i++) { ii.run('i' + i, 'C' + i, 'صنف ' + i); iu.run('u' + i, 'i' + i); for (let k = 0; k < 3; k++) { ib.run(`b${i}-${k}`, 'i' + i, 'L' + k, `2027-0${k + 1}-15`, 'u' + i); im.run(`m${i}-${k}`, 'b1', 'MAIN', 'i' + i, `b${i}-${k}`); } } });
    const seed = Date.now() - t0; const t1 = performance.now(); const s = st.summary(owner); const sumMs = performance.now() - t1; const t2 = performance.now(); for (let i = 0; i < 100; i++) st.card(owner, 'i' + i * 200); const cardMs = (performance.now() - t2) / 100;
    console.log(`75k movements: seed ${seed} ms, summary of 25k items ${sumMs.toFixed(0)} ms, stock card ${cardMs.toFixed(2)} ms`); expect(s.size).toBe(25000); expect(sumMs).toBeLessThan(1500); expect(cardMs).toBeLessThan(30);
  });
});
