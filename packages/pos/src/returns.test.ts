import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, StockService, type ItemInput } from '@o-pharmacy/inventory';
import { POS_MIGRATIONS, PosError, ReturnService, SaleService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const cashierRet: Person = { id: 'cs', roles: ['C'], grants: ['sale.return', 'sale.swap'], branchIds: ['b1'] };
const setup = () => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS]); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); const sales = new SaleService(hub, items, bs, { maxDiscountPct: () => 5 });
  return { hub, items, bs, sales, st: new StockService(hub, items, bs), ret: new ReturnService(hub, items, sales) };
};
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as PosError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `k${++n}`;
/** OLD: 1 box at 40.00 (4000), NEW: 2 boxes at 45.00 (4500); a second item B (non-drug, 12.05 each). */
const prep = () => {
  const s = setup(); const a = s.items.create(owner, drug()); const b = s.items.create(owner, { nameAr: 'كريم', kind: 'non_drug', listPriceMinor: 1205, units: [{ name: 'علبة', factor: 1 }] });
  const rec = (o: Record<string, unknown>) => s.bs.receive(owner, { key: key(), itemId: a.id, unitName: 'علبة', costMinor: 3000, ...o } as never);
  rec({ lot: 'OLD', expiry: '2027-03-31', qty: 1, publicPriceMinor: 4000 }); rec({ lot: 'NEW', expiry: '2028-03-31', qty: 2, publicPriceMinor: 4500 }); s.bs.receive(owner, { key: key(), itemId: b.id, lot: 'N', expiry: '2029-01-31', qty: 10, costMinor: 500 });
  const sid = s.sales.openSession(ph, { key: key(), terminal: 'T1', openingFloatMinor: 10000 }).id; return { ...s, a, b, sid };
};
/** sells 30 units: 20 OLD (4000) + 10 NEW (2250) = 6250, with a 10% manager discount variant when asked */
const sell30 = (s: ReturnType<typeof prep>, o: Record<string, unknown> = {}) => s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 30, unitName: 'حبة' }], cashMinor: 10000, ...o } as never);

describe('returns', () => {
  it('goes back to the batch it was sold from; refund is the exact price paid; a full return refunds exactly the total; cash leaves the drawer', () => {
    const s = prep(); const sale = sell30(s); expect(s.st.onHand(s.a.id)).toBe(30);
    const r = s.ret.returnSale(ph, { key: key(), saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 30, unitName: 'حبة' }], reasonCode: 'changed_mind', refund: { method: 'cash' } }); expect(r).toMatchObject({ returnNo: 'R-000001', totalMinor: 6250, cashMinor: 6250, cardMinor: 0 });
    expect(s.st.onHand(s.a.id)).toBe(60); const b = s.bs.batches(owner, s.a.id); expect(b.map(x => [x.lot, x.qtyBase])).toEqual([['OLD', 20], ['NEW', 40]]); expect(s.sales.sessionSummary(mgr, s.sid)).toMatchObject({ expectedCashMinor: 10000 + 6250 - 6250 }); expect(s.sales.sale(owner, sale.saleNo).returnedMinor).toBe(6250);
    expect(s.ret.returnsOf(mgr, sale.saleNo)[0]!.lines.map(l => [l.lot, l.qtyBase, l.refundMinor, l.condition])).toEqual([['NEW', 10, 2250, 'resellable'], ['OLD', 20, 4000, 'resellable']]); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('partial returns add up exactly (no rounding drift); cannot return more than was sold; discount is respected', () => {
    const s = prep(); const sale = sell30(s, { discountBp: 500, cashMinor: 10000 }); // 4000 -> 3800, 2250 -> 2137.5 -> pick discount 112.5 -> 113 => 2137
    const total = s.sales.sale(owner, sale.saleNo).totalMinor; const step = (qty: number) => s.ret.returnSale(ph, { key: key(), saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty, unitName: 'حبة', batchId: undefined }], reasonCode: 'other', refund: { method: 'cash' } });
    const parts = [7, 7, 7, 9].map(q => step(q).totalMinor); expect(parts.reduce((a, b) => a + b, 0)).toBe(total); expect(code(() => step(1))).toBe('invalid');
  });
  it('rules: reason, quantity, unknown line, refund method, closed or foreign session, permission, void sale, repeated key', () => {
    const s = prep(); const sale = sell30(s); const base = { saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 1, unitName: 'حبة' }], reasonCode: 'other' as const, refund: { method: 'cash' as const } };
    expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), lines: [] }))).toBe('invalid'); expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), reasonCode: 'x' as never }))).toBe('invalid'); expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), lines: [{ lineNo: 1, qty: 0 }] }))).toBe('invalid');
    expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), lines: [{ lineNo: 9, qty: 1 }] }))).toBe('not-found'); expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), lines: [{ lineNo: 1, qty: 1, unitName: 'x' }] }))).toBe('invalid'); expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), refund: undefined }))).toBe('invalid');
    expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), refund: { method: 'card', ref: ' ' } }))).toBe('invalid'); expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), refund: { method: 'card', ref: 'R1' } }))).toBe('invalid'); // paid in cash, no card to refund
    expect(code(() => s.ret.returnSale(cashier, { ...base, key: key() }))).toBe('forbidden'); expect(code(() => s.ret.returnSale(mgr, { ...base, key: key() }))).toBe('session'); expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), saleNo: 'S-999' }))).toBe('not-found');
    const k = key(); const a = s.ret.returnSale(ph, { ...base, key: k }); const c = s.hub.movementCount(); expect(s.ret.returnSale(ph, { ...base, key: k })).toMatchObject({ replay: true, returnNo: a.returnNo }); expect(s.hub.movementCount()).toBe(c);
    expect(code(() => s.sales.voidSale(mgr, sale.saleNo, 'x'))).toBe('state'); s.sales.closeSession(ph, s.sid, { countedCashMinor: 10000 + 6250 - a.totalMinor }); expect(code(() => s.ret.returnSale(ph, { ...base, key: key() }))).toBe('session');
  });
  it('after the session is closed a return in a NEW session undoes the sale (the drawer of the new session pays the refund)', () => {
    const s = prep(); const sale = sell30(s); s.sales.closeSession(ph, s.sid, { countedCashMinor: 10000 + 6250 }); expect(code(() => s.sales.voidSale(mgr, sale.saleNo, 'late'))).toBe('state');
    const sid2 = s.sales.openSession(ph, { key: key(), terminal: 'T1', openingFloatMinor: 20000 }).id; s.ret.returnSale(ph, { key: key(), saleNo: sale.saleNo, sessionId: sid2, lines: [{ lineNo: 1, qty: 1, unitName: 'علبة', batchId: s.bs.batches(owner, s.a.id).find(x => x.lot === 'OLD')!.id }], reasonCode: 'wrong_item', refund: { method: 'cash' } });
    expect(s.sales.sessionSummary(mgr, sid2)).toMatchObject({ expectedCashMinor: 20000 - 4000 }); expect(s.ret.sessionReturns(mgr, sid2)).toHaveLength(1); expect(code(() => s.ret.sessionReturns(ph, sid2))).toBe('forbidden');
  });
  it('card refund only up to what was paid by card, with its reference; mixed sale returns split by method', () => {
    const s = prep(); const sale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1, unitName: 'علبة' }], payments: [{ method: 'card', amountMinor: 3000, ref: 'AUTH' }, { method: 'cash', amountMinor: 1000 }] }); expect(sale.totalMinor).toBe(4000);
    const one = (q: number, m: { method: 'cash' } | { method: 'card'; ref: string }) => s.ret.returnSale(ph, { key: key(), saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: q, unitName: 'حبة' }], reasonCode: 'other', refund: m });
    expect(code(() => one(18, { method: 'card', ref: 'R1' }))).toBe('invalid'); expect(one(15, { method: 'card', ref: 'R1' })).toMatchObject({ cardMinor: 3000 }); expect(code(() => one(1, { method: 'card', ref: 'R2' }))).toBe('invalid'); expect(one(5, { method: 'cash' })).toMatchObject({ cashMinor: 1000, cardMinor: 0 });
  });
  it('damaged goods need a returns store and never go back to the shelf; non-drug and service lines; negative-stock sale returns', () => {
    const s = prep(); const sale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }, { itemId: s.b.id, qty: 2 }], cashMinor: 10000 }); const base = { saleNo: sale.saleNo, sessionId: s.sid, reasonCode: 'damaged' as const, condition: 'damaged' as const, refund: { method: 'cash' as const } };
    expect(code(() => s.ret.returnSale(ph, { ...base, key: key(), lines: [{ lineNo: 1, qty: 20, unitName: 'حبة' }] }))).toBe('invalid'); const rs = s.st.createStore(mgr, 'مرتجعات', 'returns');
    const r = s.ret.returnSale(ph, { ...base, key: key(), lines: [{ lineNo: 1, qty: 20, unitName: 'حبة' }, { lineNo: 2, qty: 1 }] }); expect(r.totalMinor).toBe(4000 + 1205); expect(s.st.onHand(s.a.id, { storeId: rs.id })).toBe(20); expect(s.st.onHand(s.a.id, { sellableOnly: true })).toBe(40); expect(s.bs.allocate(s.a.id, 60).missingBase).toBe(20);
    expect(s.ret.returnsOf(mgr, sale.saleNo)[0]!.lines.every(l => l.condition === 'damaged')).toBe(true);
  });
  it('a delivery that is not finished cannot be returned; once delivered it can; view own needs the grant; returns are append-only', () => {
    const s = prep(); const sale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], delivery: { name: 'م', phone: '1', address: 'ع' }, payments: [] }); const base = { saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 1, unitName: 'حبة' }], reasonCode: 'other' as const, refund: { method: 'cash' as const } };
    expect(code(() => s.ret.returnSale(ph, { ...base, key: key() }))).toBe('state'); s.sales.setDeliveryStatus(ph, sale.saleNo, 'out_for_delivery', { agent: 'ا' }); s.sales.collectDelivery(ph, sale.saleNo, { cashMinor: 4000 }); const r = s.ret.returnSale(ph, { ...base, key: key() }); expect(r.totalMinor).toBe(200);
    expect(code(() => s.ret.returnsOf(cashier, sale.saleNo))).toBe('forbidden'); expect(s.ret.returnsOf(owner, sale.saleNo)).toHaveLength(1); for (const q of ['DELETE FROM sale_returns', 'UPDATE sale_returns SET total_minor=1', 'DELETE FROM sale_return_lines', 'UPDATE sale_return_lines SET qty_base=1']) expect(() => s.hub.db.exec(q), q).toThrow();
  });
});

describe('swap', () => {
  it('customer pays the difference when the new goods cost more; the refund value is credit against the new sale', () => {
    const s = prep(); const sale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], cashMinor: 4000 }); // 4000 from OLD
    const r = s.ret.swap(ph, { key: key(), saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 20, unitName: 'حبة' }], reasonCode: 'wrong_item', newLines: [{ itemId: s.b.id, qty: 5 }], cashMinor: 3000 }); // new = 6025, credit 4000, pay 2025
    expect(r).toMatchObject({ totalMinor: 4000, creditMinor: 4000, cashMinor: 0, newTotalMinor: 6025 }); expect(s.sales.sale(owner, r.newSaleNo)).toMatchObject({ swapCreditMinor: 4000, tenderedMinor: 3000, changeMinor: 975 }); expect(s.sales.sessionSummary(mgr, s.sid)).toMatchObject({ expectedCashMinor: 10000 + 4000 + 2025 });
    expect(s.st.onHand(s.a.id)).toBe(60); expect(s.st.onHand(s.b.id)).toBe(5);
  });
  it('refunds the difference when the new goods cost less; refund method needed only then; underpaid difference is refused and nothing is written', () => {
    const s = prep(); const sale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], cashMinor: 4000 }); const c0 = s.hub.movementCount(); const base = { saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 20, unitName: 'حبة' }], reasonCode: 'wrong_item' as const };
    expect(code(() => s.ret.swap(ph, { ...base, key: key(), newLines: [{ itemId: s.b.id, qty: 1 }] }))).toBe('invalid'); expect(code(() => s.ret.swap(ph, { ...base, key: key(), newLines: [{ itemId: s.b.id, qty: 9 }] }))).toBe('underpaid'); expect(s.hub.movementCount()).toBe(c0);
    const r = s.ret.swap(ph, { ...base, key: key(), newLines: [{ itemId: s.b.id, qty: 1 }], refund: { method: 'cash' } }); expect(r).toMatchObject({ totalMinor: 4000, creditMinor: 1205, cashMinor: 2795, newTotalMinor: 1205 }); expect(s.sales.sessionSummary(mgr, s.sid)).toMatchObject({ expectedCashMinor: 10000 + 4000 - 2795 });
  });
  it('same-item swap works; rules: needs new goods, permission, repeated key changes nothing', () => {
    const s = prep(); const sale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], cashMinor: 4000 }); const k = key(); const base = { saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 20, unitName: 'حبة' }], reasonCode: 'other' as const };
    expect(code(() => s.ret.swap(ph, { ...base, key: key(), newLines: [] }))).toBe('invalid'); expect(code(() => s.ret.swap(cashier, { ...base, key: key(), newLines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }] }))).toBe('forbidden');
    const a = s.ret.swap(ph, { ...base, key: k, newLines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], cashMinor: 5000 }); expect(a.newTotalMinor).toBe(4000); const c = s.hub.movementCount(); expect(s.ret.swap(ph, { ...base, key: k, newLines: [{ itemId: s.a.id, qty: 20, unitName: 'حبة' }], cashMinor: 5000 })).toMatchObject({ replay: true, returnNo: a.returnNo, newSaleNo: a.newSaleNo }); expect(s.hub.movementCount()).toBe(c);
    expect(code(() => s.ret.swap(cashierRet, { ...base, key: key(), newLines: [{ itemId: s.a.id, qty: 1 }] }))).toBe('session'); // a cashier with grants but no session of her own
  });
});
