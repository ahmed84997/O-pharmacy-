import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, StockService, type ItemInput } from '@o-pharmacy/inventory';
import { POS_MIGRATIONS, PosError, SaleService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const cashierDisc: Person = { id: 'cs', roles: ['C'], grants: ['sale.discount'], branchIds: ['b1'] };
const setup = () => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS]); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' });
  return { hub, items, bs, st: new StockService(hub, items, bs), pos: new SaleService(hub, items, bs, { maxDiscountPct: () => 5 }) };
};
const drug = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }], ...o });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as PosError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `k${++n}`;
const prep = (who: Person = cashier) => { const s = setup(); const a = s.items.create(owner, drug()); s.bs.receive(owner, { key: key(), itemId: a.id, lot: 'L1', expiry: '2028-03-31', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4500 }); const sid = s.pos.openSession(who, { key: key(), terminal: 'T1', openingFloatMinor: 10000 }).id; return { ...s, a, sid }; };
const L = (itemId: string, qty = 1, o: Record<string, unknown> = {}) => ({ itemId, qty, ...o });

describe('payments', () => {
  it('card exact; cash and card mixed with change; the drawer expects cash only', () => {
    const s = prep(); const card = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], payments: [{ method: 'card', amountMinor: 5000, ref: 'AUTH-1' }] }); expect(card).toMatchObject({ totalMinor: 5000, tenderedMinor: 0, changeMinor: 0, codMinor: 0 });
    const mixed = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 3)], payments: [{ method: 'card', amountMinor: 5000, ref: 'AUTH-2' }, { method: 'cash', amountMinor: 20000 }] }); expect(mixed).toMatchObject({ totalMinor: 15000, tenderedMinor: 20000, changeMinor: 10000 });
    expect(s.pos.sale(owner, mixed.saleNo).payments).toEqual([{ method: 'cash', amountMinor: 10000, ref: null }, { method: 'card', amountMinor: 5000, ref: 'AUTH-2' }]);
    expect(s.pos.sessionSummary(mgr, s.sid)).toMatchObject({ salesMinor: 20000, cardMinor: 10000, cashMinor: 10000, expectedCashMinor: 20000 }); expect(s.pos.closeSession(mgr, s.sid, { countedCashMinor: 20000 })).toMatchObject({ diffMinor: 0 });
  });
  it('rules: card needs its reference, card cannot exceed the total, not enough money, two cash payments, negative', () => {
    const s = prep(); const sell = (p: unknown[]) => () => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], payments: p as never }); const c0 = s.hub.movementCount();
    expect(code(sell([{ method: 'card', amountMinor: 5000, ref: ' ' }]))).toBe('invalid'); expect(code(sell([{ method: 'card', amountMinor: 6000, ref: 'A' }]))).toBe('invalid'); expect(code(sell([{ method: 'card', amountMinor: 3000, ref: 'A' }, { method: 'cash', amountMinor: 1000 }]))).toBe('underpaid');
    expect(code(sell([{ method: 'cash', amountMinor: 1 }, { method: 'cash', amountMinor: 1 }]))).toBe('invalid'); expect(code(sell([{ method: 'cash', amountMinor: -1 }]))).toBe('invalid'); expect(code(sell([]))).toBe('underpaid'); expect(s.hub.movementCount()).toBe(c0);
  });
});

describe('discounts', () => {
  it('a line discount in basis points, rounded half up per batch pick; needs sale.discount; above the limit needs the override; sale-level default; limit comes from config', () => {
    const s = prep(ph); // pharmacist template has sale.discount, not the override
    const r = s.pos.createSale(ph, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 1, { unitName: 'حبة', discountBp: 500 })], cashMinor: 1000 }); expect(r).toMatchObject({ totalMinor: 250 - 13, discountMinor: 13 }); // 5000/20 = 250; 5% = 12.5 -> 13
    expect(code(() => s.pos.createSale(ph, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 1, { discountBp: 501 })], cashMinor: 9999 }))).toBe('discount-limit');
    const ok = s.pos.createSale(ph, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 2, { unitName: 'حبة' }), L(s.a.id, 2, { unitName: 'حبة', discountBp: 100 })], discountBp: 500, cashMinor: 9999 }); expect(s.pos.sale(owner, ok.saleNo).lines.map(l => l.discountMinor)).toEqual([25, 5]);
    expect(code(() => s.pos.createSale(ph, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], discountBp: 20000, cashMinor: 9999 }))).toBe('invalid');
  });
  it('permission: the cashier template has no discount; with the grant only up to the limit; the manager (override) can go higher; profit is after the discount', () => {
    const s = prep(); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 1, { discountBp: 100 })], cashMinor: 9999 }))).toBe('forbidden');
    const c = setup(); const a = c.items.create(owner, drug()); c.bs.receive(owner, { key: key(), itemId: a.id, lot: 'L', expiry: '2028-03-31', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000 }); const sid = c.pos.openSession(cashierDisc, { key: key(), terminal: 'T1', openingFloatMinor: 0 }).id;
    expect(code(() => c.pos.createSale(cashierDisc, { key: key(), sessionId: sid, lines: [L(a.id, 1, { discountBp: 600 })], cashMinor: 9999 }))).toBe('discount-limit'); const r = c.pos.createSale(cashierDisc, { key: key(), sessionId: sid, lines: [L(a.id, 1, { discountBp: 500 })], cashMinor: 9999 }); expect(r.discountMinor).toBe(250);
    const m = setup(); const b = m.items.create(owner, drug()); m.bs.receive(owner, { key: key(), itemId: b.id, lot: 'L', expiry: '2028-03-31', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000 }); const ms = m.pos.openSession(mgr, { key: key(), terminal: 'T1', openingFloatMinor: 0 }).id;
    const big = m.pos.createSale(mgr, { key: key(), sessionId: ms, lines: [L(b.id, 1, { discountBp: 2000 })], cashMinor: 9999 }); expect(big).toMatchObject({ totalMinor: 4000, discountMinor: 1000 }); expect(m.pos.sale(owner, big.saleNo)).toMatchObject({ grossMinor: 5000, discountMinor: 1000, profitMinor: 4000 - 3000 });
  });
});

describe('held bills', () => {
  it('hold keeps stock untouched; resume then sell closes it; the session cannot close while one is open; cancel needs a reason; others cannot resume', () => {
    const s = prep(); const h = s.pos.holdBill(cashier, { key: 'h1', sessionId: s.sid, lines: [L(s.a.id, 2)], note: 'جاى يجيب فلوس' }); expect(h).toMatchObject({ holdNo: 'H-000001', replay: false }); expect(s.pos.holdBill(cashier, { key: 'h1', sessionId: s.sid, lines: [L(s.a.id, 2)] })).toMatchObject({ id: h.id, replay: true }); expect(s.st.onHand(s.a.id)).toBe(200);
    expect(code(() => s.pos.closeSession(cashier, s.sid, { countedCashMinor: 10000 }))).toBe('state'); expect(s.pos.heldBills(cashier)).toHaveLength(1); const back = s.pos.resumeBill(cashier, h.id); expect(back).toMatchObject({ holdNo: 'H-000001', note: 'جاى يجيب فلوس' }); expect(back.lines).toEqual([L(s.a.id, 2)]);
    const other: Person = { id: 'x', roles: ['C'], grants: ['sale.resume'], branchIds: ['b1'] }; expect(code(() => s.pos.resumeBill(other, h.id))).toBe('forbidden'); expect(s.pos.resumeBill(mgr, h.id).lines).toHaveLength(1);
    const sale = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: back.lines, cashMinor: 10000, fromHold: h.id }); expect(sale.totalMinor).toBe(10000); expect(s.pos.heldBills(cashier)).toEqual([]); expect(s.pos.heldBills(cashier, { status: 'used' })[0]).toMatchObject({ saleNo: sale.saleNo });
    expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: back.lines, cashMinor: 10000, fromHold: h.id }))).toBe('state'); expect(code(() => s.pos.resumeBill(cashier, h.id))).toBe('state');
    const h2 = s.pos.holdBill(cashier, { key: 'h2', sessionId: s.sid, lines: [L(s.a.id)] }); expect(code(() => s.pos.cancelHold(cashier, h2.id, ' '))).toBe('invalid'); s.pos.cancelHold(cashier, h2.id, 'customer left'); expect(code(() => s.pos.cancelHold(cashier, h2.id, 'again'))).toBe('state'); expect(s.pos.closeSession(cashier, s.sid, { countedCashMinor: 20000 })).toEqual({ closed: true });
    for (const q of ['DELETE FROM held_bills', "UPDATE held_bills SET lines='[]'", "UPDATE held_bills SET status='open'"]) expect(() => s.hub.db.exec(q), q).toThrow();
  });
  it('rules: empty basket, unknown item, bad quantity, closed session, permission', () => {
    const s = prep(); expect(code(() => s.pos.holdBill(cashier, { key: key(), sessionId: s.sid, lines: [] }))).toBe('invalid'); expect(code(() => s.pos.holdBill(cashier, { key: key(), sessionId: s.sid, lines: [L('nope')] }))).toBe('not-found'); expect(code(() => s.pos.holdBill(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 0)] }))).toBe('invalid');
    expect(code(() => s.pos.holdBill({ id: 'k', roles: ['S'], branchIds: ['b1'] }, { key: key(), sessionId: s.sid, lines: [L(s.a.id)] }))).toBe('forbidden'); s.pos.closeSession(cashier, s.sid, { countedCashMinor: 10000 }); expect(code(() => s.pos.holdBill(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)] }))).toBe('session');
  });
});

describe('home delivery', () => {
  const dl = { name: 'محمد', phone: '0100', address: 'شارع 1', feeMinor: 1500 };
  it('sale with a fee; the unpaid part is cash on delivery; the drawer does not expect it until collected; collected into the collector\'s open session', () => {
    const s = prep(); const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id, 2)], delivery: dl, payments: [{ method: 'cash', amountMinor: 2000 }] }); expect(r).toMatchObject({ totalMinor: 10000 + 1500, tenderedMinor: 2000, codMinor: 9500 });
    expect(s.pos.sale(owner, r.saleNo)).toMatchObject({ channel: 'home_delivery', deliveryFeeMinor: 1500, delivery: { status: 'pending', name: 'محمد' }, profitMinor: 10000 - 6000 }); expect(s.pos.sessionSummary(mgr, s.sid)).toMatchObject({ expectedCashMinor: 12000, codOwedMinor: 9500 });
    expect(code(() => s.pos.collectDelivery(cashier, r.saleNo, { cashMinor: 9500 }))).toBe('state'); expect(code(() => s.pos.setDeliveryStatus(cashier, r.saleNo, 'out_for_delivery'))).toBe('invalid'); s.pos.setDeliveryStatus(cashier, r.saleNo, 'out_for_delivery', { agent: 'أحمد' }); expect(code(() => s.pos.setDeliveryStatus(cashier, r.saleNo, 'out_for_delivery', { agent: 'x' }))).toBe('state');
    expect(s.pos.deliveries(mgr, { status: 'out_for_delivery' })).toMatchObject([{ saleNo: r.saleNo, agent: 'أحمد', codMinor: 9500 }]); expect(code(() => s.pos.collectDelivery(cashier, r.saleNo, { cashMinor: 9000 }))).toBe('underpaid');
    expect(s.pos.collectDelivery(cashier, r.saleNo, { cashMinor: 10000 })).toEqual({ codMinor: 9500, changeMinor: 500 }); expect(s.pos.sessionSummary(mgr, s.sid)).toMatchObject({ expectedCashMinor: 21500, codOwedMinor: 0 }); expect(s.pos.deliveries(mgr, { status: 'delivered' })).toHaveLength(1);
    expect(code(() => s.pos.collectDelivery(cashier, r.saleNo, { cashMinor: 9500 }))).toBe('state'); expect(() => s.hub.db.exec("UPDATE sale_deliveries SET status='pending'")).toThrow(); expect(code(() => s.pos.voidSale(mgr, r.saleNo, 'x'))).toBe('state');
  });
  it('cash on delivery with a later session: money lands in the session of whoever receives it; no open session = refused', () => {
    const s = prep(); const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], delivery: dl, payments: [] }); expect(r).toMatchObject({ totalMinor: 6500, codMinor: 6500, tenderedMinor: 0 }); s.pos.setDeliveryStatus(cashier, r.saleNo, 'out_for_delivery', { agent: 'أحمد' });
    s.pos.closeSession(cashier, s.sid, { countedCashMinor: 10000 }); expect(code(() => s.pos.collectDelivery(cashier, r.saleNo, { cashMinor: 6500 }))).toBe('session'); const sid2 = s.pos.openSession(cashier, { key: key(), terminal: 'T1', openingFloatMinor: 0 }).id;
    s.pos.collectDelivery(cashier, r.saleNo, { cashMinor: 6500 }); expect(s.pos.sessionSummary(mgr, sid2)).toMatchObject({ expectedCashMinor: 6500, salesCount: 0 });
  });
  it('card prepaid delivery has nothing to collect; a failed delivery voids the sale and returns the stock; details are required', () => {
    const s = prep(); const r = s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], delivery: dl, payments: [{ method: 'card', amountMinor: 6500, ref: 'A' }] }); expect(r.codMinor).toBe(0); expect(s.st.onHand(s.a.id)).toBe(180);
    expect(code(() => s.pos.setDeliveryStatus(cashier, r.saleNo, 'failed', { reason: 'x' }))).toBe('forbidden'); expect(code(() => s.pos.setDeliveryStatus(mgr, r.saleNo, 'failed', {}))).toBe('invalid'); s.pos.setDeliveryStatus(mgr, r.saleNo, 'failed', { reason: 'لم يرد' });
    expect(s.st.onHand(s.a.id)).toBe(200); expect(s.pos.sale(owner, r.saleNo)).toMatchObject({ status: 'void', delivery: { status: 'failed' } }); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], delivery: { ...dl, phone: ' ' }, cashMinor: 9999 }))).toBe('invalid');
    expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], delivery: dl, payments: [{ method: 'card', amountMinor: 9000, ref: 'A' }] }))).toBe('invalid'); expect(code(() => s.pos.deliveries(cashier))).toBe('forbidden');
  });
  it('a counter sale cannot leave an amount unpaid', () => { const s = prep(); expect(code(() => s.pos.createSale(cashier, { key: key(), sessionId: s.sid, lines: [L(s.a.id)], cashMinor: 100 }))).toBe('underpaid'); });
});
