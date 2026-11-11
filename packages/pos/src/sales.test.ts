import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, StockService, type ItemInput } from '@o-pharmacy/inventory';
import { POS_MIGRATIONS, PosError, SaleService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const cashier2: Person = { id: 'cs2', roles: ['C'], branchIds: ['b1'] };
const cashierOwn: Person = { id: 'cs', roles: ['C'], grants: ['sale.view_own'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const setup = (allowNegative = false) => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS]); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' });
  return { hub, items, bs, st: new StockService(hub, items, bs), pos: new SaleService(hub, items, bs, { allowNegative: () => allowNegative }) };
};
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'شريط', factor: 10 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as PosError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `k${++n}`;
const rec = (s: ReturnType<typeof setup>, itemId: string, o: Record<string, unknown> = {}) => s.bs.receive(owner, { key: key(), itemId, lot: 'L1', expiry: '2027-06-30', qty: 5, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 4500, pharmacistPriceMinor: 4200, ...o } as never);
const open = (s: ReturnType<typeof setup>, who = cashier, terminal = 'T1', float = 50000) => s.pos.openSession(who, { key: key(), terminal, openingFloatMinor: float }).id;
const prep = () => { const s = setup(); const a = s.items.create(owner, drug()); rec(s, a.id, { lot: 'OLD', expiry: '2027-03-31', qty: 1, publicPriceMinor: 4000, pharmacistPriceMinor: 3700 }); rec(s, a.id, { lot: 'NEW', expiry: '2028-03-31', qty: 2 }); return { ...s, a, sid: open(s) }; };

describe('cashier session', () => {
  it('one open session per terminal and per person; repeat key is the same session; float must be whole piasters', () => {
    const s = setup(); const k = key(); const a = s.pos.openSession(cashier, { key: k, terminal: 'T1', openingFloatMinor: 10000 }); expect(a).toMatchObject({ sessionNo: 'CS-000001', replay: false }); expect(s.pos.openSession(cashier, { key: k, terminal: 'T1', openingFloatMinor: 10000 })).toMatchObject({ id: a.id, replay: true });
    expect(code(() => s.pos.openSession(cashier2, { key: key(), terminal: 'T1', openingFloatMinor: 0 }))).toBe('state'); expect(code(() => s.pos.openSession(cashier, { key: key(), terminal: 'T2', openingFloatMinor: 0 }))).toBe('state');
    expect(code(() => s.pos.openSession(cashier2, { key: key(), terminal: ' ', openingFloatMinor: 0 }))).toBe('invalid'); expect(code(() => s.pos.openSession(cashier2, { key: key(), terminal: 'T2', openingFloatMinor: -1 }))).toBe('invalid'); expect(code(() => s.pos.openSession(keeper, { key: key(), terminal: 'T9', openingFloatMinor: 0 }))).toBe('forbidden');
    expect(s.pos.openSessionOf('cs')).toMatchObject({ terminal: 'T1' }); expect(s.pos.openSessionOf('nobody')).toBeNull();
  });
  it('close: counted cash vs expected (float + sales); the cashier does not see expected, reviewers do; a difference needs a note; then a new session can open', () => {
    const s = prep(); s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'شريط' }], cashMinor: 5000 }); // 10 units from OLD = 2000
    expect(s.pos.sessionSummary(mgr, s.sid)).toMatchObject({ salesCount: 1, salesMinor: 2000, expectedCashMinor: 52000, status: 'open' }); expect(code(() => s.pos.sessionSummary(cashier, s.sid))).toBe('forbidden');
    expect(code(() => s.pos.closeSession(cashier, s.sid, { countedCashMinor: 51000 }))).toBe('invalid'); expect(code(() => s.pos.closeSession(cashier2, s.sid, { countedCashMinor: 52000 }))).toBe('forbidden'); expect(code(() => s.pos.closeSession(cashier, s.sid, { countedCashMinor: -1 }))).toBe('invalid');
    expect(s.pos.closeSession(cashier, s.sid, { countedCashMinor: 51000, note: 'short by 10' })).toEqual({ closed: true }); expect(s.pos.sessionSummary(mgr, s.sid)).toMatchObject({ status: 'closed', expectedCashMinor: 52000, countedCashMinor: 51000, diffMinor: -1000 });
    expect(code(() => s.pos.closeSession(cashier, s.sid, { countedCashMinor: 1 }))).toBe('state'); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1 }], cashMinor: 99999 }))).toBe('session'); expect(open(s, cashier, 'T1')).toBeTruthy();
    for (const q of ['DELETE FROM cashier_sessions', "UPDATE cashier_sessions SET note='x'", 'UPDATE cashier_sessions SET opening_float_minor=1']) expect(() => s.hub.db.exec(q), q).toThrow();
  });
  it('a reviewer may close for the cashier and sees the result; an exact count needs no note', () => {
    const s = setup(); const sid = open(s); const r = s.pos.closeSession(mgr, sid, { countedCashMinor: 50000 }); expect(r).toEqual({ closed: true, expectedMinor: 50000, countedMinor: 50000, diffMinor: 0 });
  });
});

describe('sale core', () => {
  it('quantity in a chosen unit; two batches in one line; stock on hand falls; sale lines keep batch, unit and price', () => {
    const s = prep(); const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 3, unitName: 'شريط' }], cashMinor: 10000 }); // 30 units: 20 OLD at 4000/box + 10 NEW at 4500/box
    expect(r.totalMinor).toBe(4000 + 2250); expect(s.st.onHand(s.a.id)).toBe(60 - 30); const sale = s.pos.sale(owner, r.saleNo); expect(sale.lines.map(l => [l.lot, l.qtyBase, l.unitPriceMinor, l.amountMinor, l.reqQty, l.reqUnit])).toEqual([['OLD', 20, 4000, 4000, 3, 'شريط'], ['NEW', 10, 4500, 2250, 3, 'شريط']]);
    expect(sale.lines.map(l => l.costMinor)).toEqual([3000, 1500]); expect(sale.profitMinor).toBe(6250 - 4500); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('rounds half up once per batch pick; a pharmacist price needs the discount permission', () => {
    const s = setup(); const a = s.items.create(owner, drug({ nameAr: 'س' })); rec(s, a.id, { qty: 1, publicPriceMinor: 1010, pharmacistPriceMinor: 900, lot: 'R' }); const sid = open(s, ph, 'T3');
    const r = s.pos.createSale(ph, { key: key(), sessionId: sid, lines: [{ itemId: a.id, qty: 1, unitName: 'حبة' }], cashMinor: 100 }); expect(r.totalMinor).toBe(51); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: open(s, cashier, 'T4'), lines: [{ itemId: a.id, qty: 1, unitName: 'حبة', priceKind: 'pharmacist' }], cashMinor: 100 }))).toBe('forbidden');
    expect(s.pos.createSale(ph, { key: key(), sessionId: sid, lines: [{ itemId: a.id, qty: 2, unitName: 'حبة', priceKind: 'pharmacist' }], cashMinor: 200 }).totalMinor).toBe(90);
  });
  it('repeating the key sells nothing twice', () => {
    const s = prep(); const k = key(); const a = s.pos.createSale(cashier, { key: k, sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'شريط' }], cashMinor: 5000 }); const c = s.hub.movementCount(); const b = s.pos.createSale(cashier, { key: k, sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'شريط' }], cashMinor: 5000 });
    expect(b).toMatchObject({ replay: true, saleNo: a.saleNo, totalMinor: a.totalMinor }); expect(s.hub.movementCount()).toBe(c); expect(s.pos.sales(owner)).toHaveLength(1);
  });
  it('refusals leave no trace: not enough stock (all lines reported), underpaid, no lines, bad quantity or unit, someone else\'s session, permission', () => {
    const s = prep(); const b = s.items.create(owner, drug({ nameAr: 'ب' })); const c0 = s.hub.movementCount(); const sell = (lines: never[] | { itemId: string; qty: number; unitName?: string }[], cash = 99999, who = cashier, sid = s.sid) => () => s.pos.createSale(who, { key: key(), sessionId: sid, lines: lines as never, cashMinor: cash });
    expect(code(sell([{ itemId: s.a.id, qty: 1, unitName: 'حبة' }, { itemId: s.a.id, qty: 100 }, { itemId: b.id, qty: 1 }]))).toBe('insufficient'); try { sell([{ itemId: s.a.id, qty: 100 }, { itemId: b.id, qty: 1 }])(); } catch (e) { expect((e as PosError).detail).toMatchObject({ short: [{ line: 1 }, { line: 2 }] }); }
    expect(code(sell([{ itemId: s.a.id, qty: 1, unitName: 'علبة' }], 100))).toBe('underpaid'); expect(code(sell([]))).toBe('invalid'); expect(code(sell([{ itemId: s.a.id, qty: 0 }]))).toBe('invalid'); expect(code(sell([{ itemId: s.a.id, qty: 1, unitName: 'x' }]))).toBe('invalid'); expect(code(sell([{ itemId: 'nope', qty: 1 }]))).toBe('not-found');
    expect(code(sell([{ itemId: s.a.id, qty: 1 }], 99999, cashier2))).toBe('session'); expect(code(sell([{ itemId: s.a.id, qty: 1 }], 99999, keeper))).toBe('forbidden'); expect(code(sell([{ itemId: s.a.id, qty: 1 }], -5))).toBe('invalid'); expect(s.hub.movementCount()).toBe(c0); expect(s.pos.sales(owner)).toEqual([]);
  });
  it('never sells held or non-sellable-store stock; a chosen batch is honoured; a batch spread over two stores is drawn from both', () => {
    const s = prep(); const ret = s.st.createStore(mgr, 'مرتجع', 'returns'); const x = rec(s, s.a.id, { lot: 'RET', expiry: '2027-01-31', qty: 1, storeId: ret.id });
    expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'علبة', batchId: x.batch.id }], cashMinor: 9999 }))).toBe('invalid');
    const newB = s.bs.batches(owner, s.a.id).find(b => b.lot === 'NEW')!; const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'علبة', batchId: newB.id }], cashMinor: 9999 }); expect(s.pos.sale(owner, r.saleNo).lines[0]!.lot).toBe('NEW');
    const w = s.st.createStore(mgr, 'خلفي', 'warehouse'); s.st.transfer(keeper, { key: key(), itemId: s.a.id, qtyBase: 10, fromStore: 'MAIN', toStore: w.id, batchId: newB.id }); // NEW: 10 in MAIN, 10 in the warehouse
    const left = s.bs.balances(s.a.id, { sellableOnly: true }).get(newB.id)!; const r2 = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: left, unitName: 'حبة', batchId: newB.id }], cashMinor: 99999 }); expect(s.st.onHand(s.a.id, { sellableOnly: true })).toBe(20); expect(r2.totalMinor).toBeGreaterThan(0);
    const moves = s.hub.db.prepare("SELECT store_id FROM movements WHERE ref=? AND kind='sale'").all(r2.saleNo).map(m => String(m.store_id)); expect(new Set(moves)).toEqual(new Set(['MAIN', w.id]));
  });
  it('held batch is not sold', () => { const s = prep(); const oldB = s.bs.batches(owner, s.a.id).find(b => b.lot === 'OLD')!; s.bs.setStatus(owner, oldB.id, 'quarantined', 'recall'); const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], cashMinor: 99999 }); expect(s.pos.sale(owner, r.saleNo).lines.map(l => l.lot)).toEqual(['NEW']); });
  it('non-drug uses the item price per largest unit; a service takes no stock; a missing price is refused; negative stock only when configured and only for non-drugs', () => {
    const s = setup(); const p = s.items.create(owner, { nameAr: 'كريم', kind: 'non_drug', listPriceMinor: 12050, units: [{ name: 'علبة', factor: 1 }] }); const e = s.items.create(owner, { nameAr: 'حقنة', kind: 'service', listPriceMinor: 2500, units: [{ name: 'مرة', factor: 1 }] }); const np = s.items.create(owner, { nameAr: 'بلا سعر', kind: 'non_drug', units: [{ name: 'علبة', factor: 1 }] });
    s.bs.receive(owner, { key: key(), itemId: p.id, lot: 'N1', expiry: '2028-01-31', qty: 3, costMinor: 5000 }); s.bs.receive(owner, { key: key(), itemId: np.id, lot: 'N2', expiry: '2028-01-31', qty: 3, costMinor: 5000 }); const sid = open(s);
    const r = s.pos.createSale(cashier, { key: key(), sessionId: sid, lines: [{ itemId: p.id, qty: 2 }, { itemId: e.id, qty: 3 }], cashMinor: 50000 }); expect(r.totalMinor).toBe(24100 + 7500); expect(s.st.onHand(p.id)).toBe(1); expect(s.st.onHand(e.id)).toBe(0);
    expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: sid, lines: [{ itemId: np.id, qty: 1 }], cashMinor: 50000 }))).toBe('no-price'); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: sid, lines: [{ itemId: p.id, qty: 5 }], cashMinor: 99999 }))).toBe('insufficient');
    const t = setup(true); const p2 = t.items.create(owner, { nameAr: 'كريم', kind: 'non_drug', listPriceMinor: 1000, units: [{ name: 'علبة', factor: 1 }] }); const d = t.items.create(owner, drug()); const sid2 = open(t);
    const r2 = t.pos.createSale(cashier, { key: key(), sessionId: sid2, lines: [{ itemId: p2.id, qty: 2 }], cashMinor: 5000 }); expect(r2.totalMinor).toBe(2000); expect(t.st.onHand(p2.id)).toBe(-2); expect(code(() => t.pos.createSale(cashier, { key: key(), sessionId: sid2, lines: [{ itemId: d.id, qty: 1 }], cashMinor: 5000 }))).toBe('insufficient');
    t.pos.voidSale(mgr, r2.saleNo, 'x'); expect(t.st.onHand(p2.id)).toBe(0);
  });
  it('suspended items are not sold', () => { const s = prep(); s.items.setStatus(owner, s.a.id, 'suspended', 'x'); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1 }], cashMinor: 99999 }))).toBe('invalid'); });
});

describe('void and reading', () => {
  it('void (management, with a reason) while the session is open restores stock and cash expectation; never deleted; closed session refuses', () => {
    const s = prep(); const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 2, unitName: 'شريط' }], cashMinor: 5000 }); const r2 = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'علبة' }], cashMinor: 5000 });
    expect(code(() => s.pos.voidSale(cashier, r.saleNo, 'x'))).toBe('forbidden'); expect(code(() => s.pos.voidSale(mgr, r.saleNo, ' '))).toBe('invalid'); expect(code(() => s.pos.voidSale(mgr, 'S-999999', 'x'))).toBe('not-found');
    s.pos.voidSale(mgr, r.saleNo, 'customer left'); expect(s.st.onHand(s.a.id)).toBe(60 - 20); expect(s.pos.sale(owner, r.saleNo)).toMatchObject({ status: 'void', voidReason: 'customer left', profitMinor: null }); expect(s.pos.sessionSummary(mgr, s.sid)).toMatchObject({ salesCount: 1, voidCount: 1, expectedCashMinor: 50000 + r2.totalMinor });
    expect(code(() => s.pos.voidSale(mgr, r.saleNo, 'again'))).toBe('state'); s.pos.closeSession(mgr, s.sid, { countedCashMinor: 50000 + r2.totalMinor }); expect(code(() => s.pos.voidSale(mgr, r2.saleNo, 'late'))).toBe('state');
    for (const q of ['DELETE FROM sales', 'UPDATE sales SET total_minor=1', 'DELETE FROM sale_lines', 'UPDATE sale_lines SET amount_minor=1', "UPDATE sales SET status='posted' WHERE status='void'"]) expect(() => s.hub.db.exec(q), q).toThrow(); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('view own vs view all; cost and profit only for cost viewers', () => {
    const s = prep(); const sid2 = open(s, ph, 'T2'); const mine = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'شريط' }], cashMinor: 5000 }); const other = s.pos.createSale(ph, { key: key(), sessionId: sid2, lines: [{ itemId: s.a.id, qty: 1, unitName: 'شريط' }], cashMinor: 5000 });
    expect(code(() => s.pos.sales(cashier))).toBe('forbidden'); expect(s.pos.sales(cashierOwn).map(x => x.saleNo)).toEqual([mine.saleNo]); expect(code(() => s.pos.sale(cashierOwn, other.saleNo))).toBe('forbidden'); expect(s.pos.sales(mgr)).toHaveLength(2); expect(s.pos.sales(mgr, { sessionId: sid2 })).toHaveLength(1); expect(s.pos.sales(mgr, { status: 'void' })).toEqual([]);
    expect(s.pos.sale(cashierOwn, mine.saleNo)).toMatchObject({ profitMinor: null }); expect(s.pos.sale(cashierOwn, mine.saleNo).lines.every(l => l.costMinor === null)).toBe(true); expect(s.pos.sale(owner, mine.saleNo).profitMinor).toBeGreaterThan(0); expect(code(() => s.pos.sales(keeper))).toBe('forbidden');
  });
});
