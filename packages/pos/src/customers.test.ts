import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, type ItemInput } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, PosError, ReturnService, SaleService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as PosError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `ck${++n}`;
const drug = (): ItemInput => ({ nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }] });
const prep = () => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS]); const items = new ItemService(hub);
  const bs = new BatchService(hub, items, { today: () => '2026-12-01' } as never); const sales = new SaleService(hub, items, bs, { maxDiscountPct: () => 5 }); const cust = new CustomerService(hub, sales); const ret = new ReturnService(hub, items, sales);
  const a = items.create(owner, drug()); bs.receive(owner, { key: key(), itemId: a.id, lot: 'L1', expiry: '2028-03-31', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4500 });
  const sid = sales.openSession(ph, { key: key(), terminal: 'T1', openingFloatMinor: 10000 }).id; const c = cust.create(owner, { name: 'أحمد علي', phone: '٠١٠٠١٢٣٤٥٦٧' }); cust.setCreditLimit(owner, c.id, 20000, 'trusted');
  return { hub, sales, cust, ret, a, sid, c };
};
const credit = (s: ReturnType<typeof prep>, qty: number, o: Record<string, unknown> = {}) => s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty }], customerId: s.c.id, onCredit: true, ...o } as never);

describe('customers', () => {
  it('create with a code, Arabic digits in the phone become Latin; duplicate phone refused; search by name or phone; permissions; no delete', () => {
    const s = prep(); expect(s.cust.get(owner, s.c.id)).toMatchObject({ code: 'C-000001', phone: '01001234567', creditLimitMinor: 20000, balanceMinor: 0, active: true });
    expect(code(() => s.cust.create(owner, { name: 'تانى', phone: '01001234567' }))).toBe('invalid'); expect(code(() => s.cust.create(owner, { name: ' ' }))).toBe('invalid'); expect(code(() => s.cust.create({ ...cashier, denies: ['customer.create'] }, { name: 'x' }))).toBe('forbidden');
    expect(s.cust.search(owner, 'أحمد')).toHaveLength(1); expect(s.cust.search(owner, '0100123')).toHaveLength(1); expect(s.cust.search(owner, 'zzz')).toHaveLength(0);
    expect(code(() => s.cust.setCreditLimit(ph, s.c.id, 5, 'x'))).toBe('forbidden'); expect(code(() => s.cust.setCreditLimit(owner, s.c.id, 5, ' '))).toBe('invalid');
    expect(() => s.hub.db.prepare('DELETE FROM customers').run()).toThrow(); s.cust.openingBalance(owner, s.c.id, 100, 'x'); expect(() => s.hub.db.prepare('UPDATE customer_ledger SET amount_minor=1').run()).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM customer_ledger').run()).toThrow();
    s.cust.setActive(owner, s.c.id, false, 'left'); expect(s.cust.search(owner, 'أحمد')).toHaveLength(0); expect(s.cust.search(owner, 'أحمد', { includeInactive: true })).toHaveLength(1);
  });
});

describe('credit sales', () => {
  it('the unpaid part goes on the account; part cash plus rest on credit; the limit holds; no credit by default; needs permission and customer', () => {
    const s = prep(); const r = credit(s, 1); expect(r).toMatchObject({ totalMinor: 5000, onAccountMinor: 5000 }); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(5000);
    const part = credit(s, 1, { cashMinor: 2000 }); expect(part).toMatchObject({ onAccountMinor: 3000 }); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(8000);
    expect(s.sales.sessionSummary(mgr, s.sid)).toMatchObject({ expectedCashMinor: 10000 + 2000 });
    const room = code(() => credit(s, 3)); expect(room).toBe('credit-limit'); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(8000); credit(s, 2); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(18000);
    const nolimit = s.cust.create(owner, { name: 'جديد' }); expect(code(() => credit(s, 1, { customerId: nolimit.id }))).toBe('credit-limit');
    expect(code(() => credit(s, 1, { customerId: undefined }))).toBe('invalid');
    const cs = s.sales.openSession(cashier, { key: key(), terminal: 'T2', openingFloatMinor: 0 }).id; expect(code(() => s.sales.createSale(cashier, { key: key(), sessionId: cs, lines: [{ itemId: s.a.id, qty: 1 }], customerId: s.c.id, onCredit: true } as never))).toBe('forbidden');
    s.cust.setActive(owner, s.c.id, false, 'bad payer'); expect(code(() => credit(s, 1))).toBe('state');
  });
  it('a repeat of the same key does not charge twice', () => {
    const s = prep(); const k = key(); const mk = () => s.sales.createSale(ph, { key: k, sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1 }], customerId: s.c.id, onCredit: true } as never); mk(); const again = mk(); expect(again.replay).toBe(true); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(5000);
  });
  it('voiding a credit sale removes it from the balance; the statement shows both entries', () => {
    const s = prep(); const r = credit(s, 1); s.sales.voidSale(mgr, r.saleNo, 'wrong customer'); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(0);
    const st = s.cust.statement(owner, s.c.id); expect(st.lines.map(l => l.kind)).toEqual(['sale', 'void']); expect(st.lines.map(l => l.balanceMinor)).toEqual([5000, 0]); expect(st.closing).toBe(0);
  });
});

describe('payments and refunds on the account', () => {
  it('a payment reduces the balance and adds cash to the drawer; never more than owed; card needs a reference; own open session only; repeat is safe', () => {
    const s = prep(); credit(s, 2); const pay = (o: Record<string, unknown>) => () => s.cust.receivePayment(ph, { key: key(), customerId: s.c.id, sessionId: s.sid, amountMinor: 4000, method: 'cash', ...o } as never);
    expect(pay({})()).toMatchObject({ balanceMinor: 6000 }); expect(s.sales.sessionSummary(mgr, s.sid).expectedCashMinor).toBe(10000 + 4000);
    expect(code(pay({ amountMinor: 7000 }))).toBe('invalid'); expect(code(pay({ method: 'card' }))).toBe('invalid'); expect(pay({ method: 'card', ref: 'AUTH-9', amountMinor: 1000 })()).toMatchObject({ balanceMinor: 5000 });
    expect(s.sales.sessionSummary(mgr, s.sid).expectedCashMinor).toBe(14000); const k = key(); s.cust.receivePayment(ph, { key: k, customerId: s.c.id, sessionId: s.sid, amountMinor: 500, method: 'cash' }); expect(s.cust.receivePayment(ph, { key: k, customerId: s.c.id, sessionId: s.sid, amountMinor: 500, method: 'cash' }).replay).toBe(true); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(4500);
    expect(code(() => s.cust.receivePayment(mgr, { key: key(), customerId: s.c.id, sessionId: s.sid, amountMinor: 1, method: 'cash' }))).toBe('session');
    s.sales.closeSession(mgr, s.sid, { countedCashMinor: 14500 }); expect(code(pay({ amountMinor: 1 }))).toBe('session');
  });
  it('returning goods from a credit sale can go back onto the account, never more than was charged to it', () => {
    const s = prep(); const sale = credit(s, 2); const r = s.ret.returnSale(ph, { key: key(), saleNo: sale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 1, unitName: 'علبة' }], reasonCode: 'changed_mind', refund: { method: 'account' } });
    expect(r).toMatchObject({ totalMinor: 5000, accountMinor: 5000, cashMinor: 0 }); expect(s.cust.get(owner, s.c.id).balanceMinor).toBe(5000);
    const cashSale = s.sales.createSale(ph, { key: key(), sessionId: s.sid, lines: [{ itemId: s.a.id, qty: 1 }], cashMinor: 5000, customerId: s.c.id } as never); expect(code(() => s.ret.returnSale(ph, { key: key(), saleNo: cashSale.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 1, unitName: 'علبة' }], reasonCode: 'other', refund: { method: 'account' } }))).toBe('invalid');
    expect(s.cust.statement(owner, s.c.id).lines.map(l => l.kind)).toEqual(['sale', 'return']); expect(s.sales.sessionSummary(mgr, s.sid).expectedCashMinor).toBe(15000);
  });
  it('statement with a date range starts from the earlier balance; owing lists who owes, biggest first; an opening balance only on an empty account', () => {
    const s = prep(); const b = s.cust.create(owner, { name: 'ب' }); s.cust.openingBalance(owner, b.id, 9000, 'from the old books'); expect(code(() => s.cust.openingBalance(owner, b.id, 1, 'again'))).toBe('state'); credit(s, 1);
    expect(s.cust.owing(owner).map(o => [o.name, o.balanceMinor])).toEqual([['ب', 9000], ['أحمد علي', 5000]]); const st = s.cust.statement(owner, s.c.id, { fromIso: '2026-12-02T00:00:00Z' }); expect(st).toMatchObject({ opening: 5000, closing: 5000 }); expect(st.lines).toHaveLength(0);
    expect(code(() => s.cust.owing({ ...cashier, denies: ['customer.view'] }))).toBe('forbidden');
  });
});
