import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, StockService, StocktakeService, TakeError, type ItemInput } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const mgr2: Person = { id: 'mg2', roles: ['M'], branchIds: ['b1'] };
const pharm: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const setup = (rules?: { separationOfDuties: () => boolean; activeApprovers: () => number }) => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), MIGRATIONS); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' });
  return { hub, items, bs, st: new StockService(hub, items, bs), tk: new StocktakeService(hub, rules) };
};
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as TakeError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `k${++n}`;
const rec = (s: ReturnType<typeof setup>, itemId: string, o: Record<string, unknown> = {}) => s.bs.receive(owner, { key: key(), itemId, lot: 'L1', expiry: '2027-06-30', qty: 5, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 4500, pharmacistPriceMinor: 4200, ...o } as never);
const qty = (s: ReturnType<typeof setup>, itemId: string) => s.st.onHand(itemId);

describe('adjustments', () => {
  it('a request changes nothing until someone else approves; then one ledger movement and a log', () => {
    const s = setup(); const it = s.items.create(owner, drug()); const b = rec(s, it.id).batch; const r = s.tk.requestAdjustment(keeper, { key: 'a1', itemId: it.id, batchId: b.id, qtyBase: -3, reasonCode: 'damaged', note: 'علبة اتكسرت' });
    expect(r).toMatchObject({ adjNo: 'A-000001', status: 'pending', qtyBase: -3, valueMinor: null }); expect(qty(s, it.id)).toBe(100);
    const done = s.tk.approveAdjustment(mgr, 'A-000001'); expect(done).toMatchObject({ status: 'approved', decidedBy: 'mg', valueMinor: -450, flagged: false }); expect(qty(s, it.id)).toBe(97);
    expect(s.hub.auditEntries().map(a => a.action)).toEqual(expect.arrayContaining(['adjustment.requested', 'adjustment.approved'])); expect(s.hub.verifyAudit()).toBeNull();
    expect(code(() => s.tk.approveAdjustment(mgr, 'A-000001'))).toBe('state'); expect(code(() => s.tk.rejectAdjustment(mgr, 'A-000001', 'x'))).toBe('state');
  });
  it('the maker cannot approve their own request unless one-person pharmacy (then it is flagged)', () => {
    const s = setup(); const it = s.items.create(owner, drug()); const b = rec(s, it.id).batch;
    s.tk.requestAdjustment(mgr, { key: 'a1', itemId: it.id, batchId: b.id, qtyBase: 5, reasonCode: 'found', note: 'لقيت' }); expect(code(() => s.tk.approveAdjustment(mgr, 'A-000001'))).toBe('separation');
    const solo = setup({ separationOfDuties: () => true, activeApprovers: () => 1 }); const i2 = solo.items.create(owner, drug()); const b2 = rec(solo, i2.id).batch;
    solo.tk.requestAdjustment(mgr, { key: 'a1', itemId: i2.id, batchId: b2.id, qtyBase: 5, reasonCode: 'found', note: 'x' }); expect(solo.tk.approveAdjustment(mgr, 'A-000001').flagged).toBe(true);
  });
  it('rules: permission, reason, quantity, repeated key, not more than the store holds, reject needs a reason', () => {
    const s = setup(); const it = s.items.create(owner, drug()); const other = s.items.create(owner, drug({ nameAr: 'تانى' })); const b = rec(s, it.id).batch; const base = { key: 'a', itemId: it.id, batchId: b.id, qtyBase: -1, reasonCode: 'lost' as const, note: 'n' };
    expect(code(() => s.tk.requestAdjustment(pharm, base))).toBe('forbidden'); expect(code(() => s.tk.requestAdjustment(keeper, { ...base, note: ' ' }))).toBe('invalid'); expect(code(() => s.tk.requestAdjustment(keeper, { ...base, qtyBase: 0 }))).toBe('invalid');
    expect(code(() => s.tk.requestAdjustment(keeper, { ...base, reasonCode: 'x' as never }))).toBe('invalid'); expect(code(() => s.tk.requestAdjustment(keeper, { ...base, itemId: other.id }))).toBe('not-found');
    expect(code(() => s.tk.requestAdjustment(keeper, { ...base, qtyBase: -101 }))).toBe('insufficient'); expect(code(() => s.tk.requestAdjustment(keeper, { ...base, storeId: 'nope' }))).toBe('invalid');
    const a = s.tk.requestAdjustment(keeper, base); expect(s.tk.requestAdjustment(keeper, base).adjNo).toBe(a.adjNo); expect(s.tk.adjustments(mgr)).toHaveLength(1);
    expect(code(() => s.tk.rejectAdjustment(mgr, a.adjNo, ''))).toBe('invalid'); expect(code(() => s.tk.approveAdjustment(keeper, a.adjNo))).toBe('forbidden');
    expect(s.tk.rejectAdjustment(mgr, a.adjNo, 'مش مظبوطة')).toMatchObject({ status: 'rejected', decisionNote: 'مش مظبوطة' }); expect(qty(s, it.id)).toBe(100);
  });
  it('if stock fell after the request, approval fails and nothing changes; values only for cost viewers; records are never deleted or edited', () => {
    const s = setup(); const it = s.items.create(owner, drug()); const b = rec(s, it.id).batch; s.tk.requestAdjustment(keeper, { key: 'a', itemId: it.id, batchId: b.id, qtyBase: -90, reasonCode: 'lost', note: 'n' });
    s.hub.record({ key: 'sale', storeId: 'MAIN', itemId: it.id, batchId: b.id, qty: -50, kind: 'sale', actor: 'cs' }); expect(code(() => s.tk.approveAdjustment(mgr, 'A-000001'))).toBe('insufficient'); expect(qty(s, it.id)).toBe(50);
    expect(s.tk.adjustments(keeper)[0]!.valueMinor).toBeNull(); expect(s.tk.adjustments(mgr)[0]!.valueMinor).toBe(-13500);
    for (const q of ['DELETE FROM adjustments', 'UPDATE adjustments SET qty_base=-1']) expect(() => s.hub.db.exec(q), q).toThrow();
    s.tk.rejectAdjustment(mgr, 'A-000001', 'x'); expect(() => s.hub.db.exec("UPDATE adjustments SET note='z'")).toThrow();
  });
});

describe('stocktake', () => {
  const prep = () => { const s = setup(); const a = s.items.create(owner, drug({ nameAr: 'أ' })); const b = s.items.create(owner, drug({ nameAr: 'ب' })); const a1 = rec(s, a.id, { lot: 'A1', qty: 1 }).batch; const a2 = rec(s, a.id, { lot: 'A2', expiry: '2028-01-31', qty: 1 }).batch; const b1 = rec(s, b.id, { lot: 'B1', qty: 2 }).batch; return { ...s, a, b, a1, a2, b1 }; };
  const lineOf = (s: ReturnType<typeof prep>, id: string, batchId: string) => s.tk.lines(mgr, id).find(l => l.batchId === batchId)!.id;

  it('full flow: snapshot, blind count, submit, review, apply: ledger matches the count', () => {
    const s = prep(); const t = s.tk.startStocktake(keeper, { key: 'st1' }); expect(t).toMatchObject({ stNo: 'ST-000001', lines: 3, replay: false });
    const blind = s.tk.lines(keeper, t.id); expect(blind.every(l => l.systemQty === null && l.variance === null)).toBe(true); expect(blind.map(l => l.itemName)).toEqual(['أ', 'أ', 'ب']);
    s.tk.count(keeper, t.id, lineOf(s, t.id, s.a1.id), 18); s.tk.count(keeper, t.id, lineOf(s, t.id, s.a2.id), 20); s.tk.count(keeper, t.id, lineOf(s, t.id, s.b1.id), 43);
    expect(s.tk.lines(mgr, t.id).map(l => [l.systemQty, l.countedQty, l.variance])).toEqual([[20, 18, -2], [20, 20, 0], [40, 43, 3]]);
    expect(s.tk.submit(keeper, t.id)).toEqual({ uncounted: 0 }); const rv = s.tk.review(mgr, t.id); expect(rv).toMatchObject({ shortageUnits: 2, overageUnits: 3, uncounted: 0, netValueMinor: Math.round(-2 * 3000 / 20 + 3 * 3000 / 20) }); expect(rv.diffs).toHaveLength(2);
    expect(s.tk.review(owner, t.id).netValueMinor).toBe(150); expect(code(() => s.tk.review(keeper, t.id))).toBe('forbidden');
    expect(s.tk.apply(mgr, t.id)).toEqual({ adjusted: 2, skipped: 0 }); expect(s.st.onHand(s.a.id)).toBe(38); expect(s.st.onHand(s.b.id)).toBe(43); expect(s.hub.verifyAudit()).toBeNull();
    expect(s.st.card(owner, s.b.id).lines.at(-1)).toMatchObject({ kind: 'adjust', qty: 3, ref: 'ST-000001' }); expect(code(() => s.tk.apply(mgr2, t.id))).toBe('state');
  });
  it('sales during the count do not distort the variance (system quantity is taken when the line is counted)', () => {
    const s = prep(); const t = s.tk.startStocktake(keeper, { key: 'st' }); s.hub.record({ key: 'sale1', storeId: 'MAIN', itemId: s.b.id, batchId: s.b1.id, qty: -5, kind: 'sale', actor: 'cs' });
    s.tk.count(keeper, t.id, lineOf(s, t.id, s.b1.id), 35); expect(s.tk.lines(mgr, t.id).find(l => l.batchId === s.b1.id)).toMatchObject({ systemQty: 35, variance: 0 });
    s.tk.submit(keeper, t.id); s.tk.apply(mgr, t.id); expect(s.st.onHand(s.b.id)).toBe(35);
  });
  it('found stock (a batch not in the snapshot) can be counted; uncounted lines are left alone and reported', () => {
    const s = prep(); const c = rec(s, s.b.id, { lot: 'C1', expiry: '2029-01-31', qty: 1, storeId: s.st.createStore(mgr, 'خلفي', 'warehouse').id }).batch; const t = s.tk.startStocktake(keeper, { key: 'st' });
    expect(s.tk.lines(mgr, t.id)).toHaveLength(3); const extra = s.tk.countExtra(keeper, t.id, s.b.id, c.id, 7); expect(extra).toBeTruthy(); expect(s.tk.lines(mgr, t.id)).toHaveLength(4);
    s.tk.count(keeper, t.id, lineOf(s, t.id, s.a1.id), 20); expect(s.tk.submit(keeper, t.id)).toEqual({ uncounted: 2 }); expect(s.tk.review(mgr, t.id)).toMatchObject({ uncounted: 2, overageUnits: 7 });
    expect(s.tk.apply(mgr, t.id)).toEqual({ adjusted: 1, skipped: 2 }); expect(s.st.onHand(s.a.id)).toBe(40); expect(s.st.byStore(owner, s.b.id).find(x => x.storeId === 'MAIN')!.qtyBase).toBe(40 + 7);
  });
  it('scope: one store at a time, chosen items only, repeated key is the same stocktake, bad store refused', () => {
    const s = prep(); const t = s.tk.startStocktake(keeper, { key: 'x', itemIds: [s.a.id] }); expect(t.lines).toBe(2); expect(s.tk.startStocktake(keeper, { key: 'x' })).toMatchObject({ id: t.id, replay: true, lines: 2 });
    expect(code(() => s.tk.startStocktake(keeper, { key: 'y' }))).toBe('state'); expect(code(() => s.tk.startStocktake(keeper, { key: 'z', storeId: 'nope' }))).toBe('invalid'); expect(code(() => s.tk.startStocktake(cashier, { key: 'q' }))).toBe('forbidden');
    const w = s.st.createStore(mgr, 'خلفي', 'warehouse'); expect(s.tk.startStocktake(keeper, { key: 'w', storeId: w.id }).lines).toBe(0); expect(s.tk.list(keeper).map(x => x.status)).toEqual(['open', 'open']);
  });
  it('state rules: no counting after submit; maker cannot approve own count; send back to recount; cancel needs a reason and closes it for good', () => {
    const s = prep(); const t = s.tk.startStocktake(mgr, { key: 'st' }); const l = lineOf(s, t.id, s.a1.id); expect(code(() => s.tk.count(keeper, t.id, l, -1))).toBe('invalid'); expect(code(() => s.tk.count(keeper, t.id, 'nope', 1))).toBe('not-found');
    s.tk.count(mgr, t.id, l, 19); expect(code(() => s.tk.apply(mgr, t.id))).toBe('state'); s.tk.submit(mgr, t.id); expect(code(() => s.tk.count(mgr, t.id, l, 20))).toBe('state'); expect(code(() => s.tk.apply(mgr, t.id))).toBe('separation');
    expect(code(() => s.tk.reopen(mgr2, t.id, ''))).toBe('invalid'); s.tk.reopen(mgr2, t.id, 'recount A'); s.tk.count(mgr, t.id, l, 20); s.tk.submit(mgr, t.id); expect(s.tk.apply(mgr2, t.id).adjusted).toBe(0);
    const t2 = s.tk.startStocktake(keeper, { key: 'st2' }); expect(code(() => s.tk.cancelStocktake(keeper, t2.id, ''))).toBe('invalid'); expect(code(() => s.tk.cancelStocktake(pharm, t2.id, 'x'))).toBe('forbidden'); s.tk.cancelStocktake(keeper, t2.id, 'غلط');
    expect(code(() => s.tk.count(keeper, t2.id, 'x', 1))).toBe('state'); expect(code(() => s.tk.cancelStocktake(mgr, t2.id, 'again'))).toBe('state'); expect(s.tk.list(mgr, 'cancelled')).toHaveLength(1);
    for (const q of ['DELETE FROM stocktakes', 'DELETE FROM stocktake_lines', "UPDATE stocktakes SET note='z'", 'UPDATE stocktake_lines SET counted_qty=1']) expect(() => s.hub.db.exec(q), q).toThrow();
  });
  it('apply is all-or-nothing: if one line cannot be applied nothing is written', () => {
    const s = prep(); const t = s.tk.startStocktake(keeper, { key: 'st' }); s.tk.count(keeper, t.id, lineOf(s, t.id, s.b1.id), 10); s.tk.count(keeper, t.id, lineOf(s, t.id, s.a1.id), 25); s.tk.submit(keeper, t.id);
    s.hub.record({ key: 'sale', storeId: 'MAIN', itemId: s.b.id, batchId: s.b1.id, qty: -39, kind: 'sale', actor: 'cs' }); const before = s.hub.movementCount();
    expect(code(() => s.tk.apply(mgr, t.id))).toBe('insufficient'); expect(s.hub.movementCount()).toBe(before); expect(s.tk.list(mgr, 'submitted')).toHaveLength(1); expect(s.st.onHand(s.a.id)).toBe(40);
  });
});
