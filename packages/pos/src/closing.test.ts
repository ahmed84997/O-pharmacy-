import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { ClosingService, CustomerService, POS_MIGRATIONS, PosError, ReturnService, SaleService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as PosError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `zk${++n}`;
const prep = (o: { activeApprovers?: number } = {}) => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS]); const items = new ItemService(hub);
  const bs = new BatchService(hub, items, { today: () => '2026-12-01' } as never); const sales = new SaleService(hub, items, bs, { maxDiscountPct: () => 5 }); const cust = new CustomerService(hub, sales); const ret = new ReturnService(hub, items, sales);
  const z = new ClosingService(hub, sales, { activeApprovers: () => o.activeApprovers ?? 2 });
  const a = items.create(owner, { nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }] }); bs.receive(owner, { key: key(), itemId: a.id, lot: 'L1', expiry: '2028-03-31', qty: 50, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4500 });
  const c = cust.create(owner, { name: 'أحمد علي' }); cust.setCreditLimit(owner, c.id, 100000, 'ok');
  const open = (who: Person, terminal: string, float = 10000) => sales.openSession(who, { key: key(), terminal, openingFloatMinor: float }).id;
  const sell = (who: Person, sid: string, o: Record<string, unknown> = {}) => sales.createSale(who, { key: key(), sessionId: sid, lines: [{ itemId: a.id, qty: 1 }], cashMinor: 5000, ...o } as never);
  return { hub, sales, cust, ret, z, a, c, open, sell };
};

describe('session report', () => {
  it('adds up sales by payment, credit, returns, voids and customer payments; the drawer part is for reviewers only; the cashier sees the rest after closing', () => {
    const s = prep(); const sid = s.open(ph, 'T1'); s.sell(ph, sid); s.sell(ph, sid, { cashMinor: undefined, payments: [{ method: 'card', amountMinor: 5000, ref: 'A1' }] }); const cr = s.sell(ph, sid, { customerId: s.c.id, onCredit: true, cashMinor: 2000 });
    const v = s.sell(ph, sid); s.sales.voidSale(mgr, v.saleNo, 'typo'); const sale2 = s.sell(ph, sid, { discountBp: 500 }); s.ret.returnSale(ph, { key: key(), saleNo: sale2.saleNo, sessionId: sid, lines: [{ lineNo: 1, qty: 1, unitName: 'علبة' }], reasonCode: 'changed_mind', refund: { method: 'cash' } });
    s.cust.receivePayment(ph, { key: key(), customerId: s.c.id, sessionId: sid, amountMinor: 1000, method: 'cash' }); expect(cr.onAccountMinor).toBe(3000);
    const r = s.z.report(mgr, sid); expect(r.sales).toMatchObject({ count: 4, cardMinor: 5000, onAccountMinor: 3000 }); expect(r.sales.cashMinor).toBe(5000 + 2000 + 4750); expect(r.voids).toEqual({ count: 1, totalMinor: 5000 }); expect(r.returns).toMatchObject({ count: 1, totalMinor: 4750, cashMinor: 4750 }); expect(r.customerPayments).toEqual({ cashMinor: 1000, cardMinor: 0 });
    expect(r.drawer).toMatchObject({ openingFloatMinor: 10000, expectedCashMinor: 10000 + 5000 + 2000 + 4750 - 4750 + 1000, countedCashMinor: null }); expect(code(() => s.z.report(ph, sid))).toBe('state');
    s.sales.closeSession(ph, sid, { countedCashMinor: 18000, note: 'short' }); const mine = s.z.report(ph, sid); expect(mine.sales.count).toBe(4); expect(mine.drawer).toBeUndefined(); expect(s.z.report(mgr, sid).drawer).toMatchObject({ countedCashMinor: 18000, diffMinor: 0, closeNote: 'short' });
    const other = s.open(cashier, 'T2'); expect(code(() => s.z.report(cashier, other))).toBe('state'); expect(code(() => s.z.report(cashier, sid))).toBe('forbidden');
  });
});

describe('review of a difference', () => {
  it('needs a closed session and a note when there is a difference; only a reviewer may review', () => {
    const s = prep(); const sid = s.open(ph, 'T1', 0); s.sell(ph, sid); expect(code(() => s.z.reviewSession(mgr, { sessionId: sid, decision: 'accepted', note: 'x' }))).toBe('state'); s.sales.closeSession(ph, sid, { countedCashMinor: 4900, note: 'counted short' });
    expect(code(() => s.z.reviewSession(mgr, { sessionId: sid, decision: 'accepted' }))).toBe('invalid'); expect(code(() => s.z.reviewSession(ph, { sessionId: sid, decision: 'accepted', note: 'ok' }))).toBe('forbidden'); expect(code(() => s.z.reviewSession(mgr, { sessionId: sid, decision: 'accepted', note: 'ok' }))).toBe('no error');
  });
  it('separation of duties: a reviewer cannot accept their own session when others can; in a one-person pharmacy it is allowed and flagged', () => {
    const s = prep(); const sid = s.open(mgr, 'T1', 0); s.sell(mgr, sid); s.sales.closeSession(mgr, sid, { countedCashMinor: 5000 }); expect(code(() => s.z.reviewSession(mgr, { sessionId: sid, decision: 'accepted' }))).toBe('forbidden'); expect(s.z.reviewSession(owner, { sessionId: sid, decision: 'accepted' })).toEqual({ flagged: false });
    const one = prep({ activeApprovers: 1 }); const id = one.open(mgr, 'T1', 0); one.sell(mgr, id); one.sales.closeSession(mgr, id, { countedCashMinor: 5000 }); expect(one.z.reviewSession(mgr, { sessionId: id, decision: 'accepted' })).toEqual({ flagged: true });
  });
  it('escalate needs a note, then a later acceptance replaces it as the current decision', () => {
    const s = prep(); const sid = s.open(ph, 'T1', 0); s.sell(ph, sid); s.sales.closeSession(ph, sid, { countedCashMinor: 4000, note: 'short' }); expect(code(() => s.z.reviewSession(mgr, { sessionId: sid, decision: 'escalated' }))).toBe('invalid');
    s.z.reviewSession(mgr, { sessionId: sid, decision: 'escalated', note: 'check camera' }); expect(s.z.report(mgr, sid).drawer?.review).toMatchObject({ decision: 'escalated', note: 'check camera' }); expect(s.z.blockers(mgr, '2026-12-01').unreviewed).toEqual(['CS-000001']);
    s.z.reviewSession(owner, { sessionId: sid, decision: 'accepted', note: 'found the receipt' }); expect(s.z.report(mgr, sid).drawer?.review).toMatchObject({ decision: 'accepted' }); expect(s.z.blockers(mgr, '2026-12-01').unreviewed).toEqual([]);
    expect(() => s.hub.db.prepare('UPDATE session_reviews SET note=?').run('x')).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM session_reviews').run()).toThrow();
  });
});

describe('closing the day', () => {
  it('is blocked by an open session or an unaccepted difference; then it snapshots the totals, is final, repeat is safe, and no new session opens on that day', () => {
    const s = prep(); const a = s.open(ph, 'T1', 0); const b = s.open(cashier, 'T2', 0); s.sell(ph, a); s.sell(ph, a, { cashMinor: undefined, payments: [{ method: 'card', amountMinor: 5000, ref: 'A1' }] }); s.sell(cashier, b);
    expect(code(() => s.z.closeDay(mgr, { key: key(), date: '2026-12-01' }))).toBe('state'); expect(s.z.blockers(mgr, '2026-12-01').open).toEqual(['CS-000001', 'CS-000002']);
    s.sales.closeSession(ph, a, { countedCashMinor: 5000 }); s.sales.closeSession(cashier, b, { countedCashMinor: 4800, note: 'short 2' }); expect(s.z.blockers(mgr, '2026-12-01')).toEqual({ open: [], unreviewed: ['CS-000002'] }); expect(code(() => s.z.closeDay(mgr, { key: key(), date: '2026-12-01' }))).toBe('state');
    s.z.reviewSession(mgr, { sessionId: b, decision: 'accepted', note: 'cashier owes 2' }); const k = key(); const d = s.z.closeDay(mgr, { key: k, date: '2026-12-01', note: 'normal day' });
    expect(d).toMatchObject({ date: '2026-12-01', replay: false, totals: { sessions: 2, salesCount: 3, salesMinor: 15000, cashMinor: 10000, cardMinor: 5000, expectedCashMinor: 10000, countedCashMinor: 9800, diffMinor: -200 } });
    expect(s.z.closeDay(mgr, { key: k, date: '2026-12-01' })).toMatchObject({ replay: true }); expect(code(() => s.z.closeDay(mgr, { key: key(), date: '2026-12-01' }))).toBe('state'); expect(code(() => s.open(ph, 'T9'))).toBe('day-closed');
    expect(s.z.days(owner)).toHaveLength(1); expect(s.z.days(owner)[0]).toMatchObject({ date: '2026-12-01', closedBy: 'mg', note: 'normal day' }); expect(() => s.hub.db.prepare('UPDATE day_closings SET note=?').run('x')).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM day_closings').run()).toThrow();
  });
  it('rules: reviewers only, valid date, not in the future, needs sessions, time zone decides the date', () => {
    const s = prep(); expect(code(() => s.z.closeDay(ph, { key: key(), date: '2026-12-01' }))).toBe('forbidden'); expect(code(() => s.z.closeDay(mgr, { key: key(), date: '1/12/2026' }))).toBe('invalid'); expect(code(() => s.z.closeDay(mgr, { key: key(), date: '2026-12-02' }))).toBe('invalid'); expect(code(() => s.z.closeDay(mgr, { key: key(), date: '2026-12-01' }))).toBe('state');
    expect(s.sales.businessDate('2026-12-01T22:30:00Z')).toBe('2026-12-02'); expect(s.sales.businessDate('2026-12-01T10:00:00Z')).toBe('2026-12-01');
  });
});
