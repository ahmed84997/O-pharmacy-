import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { ACCOUNTS_MIGRATIONS, AccError, AccountService, ChequeService, InboxService, LedgerService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const acct: Person = { id: 'ac', roles: ['X'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as AccError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `ck${++n}`;
const DAYS = `CREATE TABLE day_closings (id TEXT PRIMARY KEY, business_date TEXT NOT NULL UNIQUE, req_key TEXT, sessions_count INTEGER, totals_json TEXT NOT NULL, note TEXT, closed_by TEXT, closed_at TEXT);`;
const prep = () => {
  const clock = { t: Date.parse('2026-12-01T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), ACCOUNTS_MIGRATIONS); hub.db.exec(DAYS);
  const as = new AccountService(hub); const lg = new LedgerService(hub, as); as.seedDefaults(owner);
  const cat = (name: string) => as.categories(owner).find(c => c.name === name)!.id;
  const ch = new ChequeService(hub, lg, d => cat(d === 'received' ? 'وارد آخر' : 'طلبية مورد')); const ib = new InboxService(hub, lg);
  const cash = as.createAccount(owner, { name: 'الخزنة', kind: 'cash', openingMinor: 100000 }); const bank = as.createAccount(owner, { name: 'بنك مصر', kind: 'bank' });
  return { hub, clock, as, lg, ch, ib, cat, cash, bank };
};

describe('accounts and categories', () => {
  it('the Admin adds, renames and switches accounts as they like; names are unique; money in an account blocks switching it off', () => {
    const s = prep(); const w = s.as.createAccount(owner, { name: ' محفظة أورانج ', kind: 'wallet' }); expect(w).toMatchObject({ name: 'محفظة أورانج', balanceMinor: 0, active: true });
    expect(code(() => s.as.createAccount(owner, { name: 'محفظة أورانج', kind: 'wallet' }))).toBe('duplicate'); expect(code(() => s.as.createAccount(owner, { name: 'x', kind: 'cash', openingMinor: 10.5 }))).toBe('invalid'); expect(code(() => s.as.createAccount(acct, { name: 'y', kind: 'cash' }))).toBe('forbidden');
    expect(s.as.rename(owner, w.id, 'أورانج كاش').name).toBe('أورانج كاش'); expect(code(() => s.as.rename(owner, w.id, 'الخزنة'))).toBe('duplicate');
    expect(code(() => s.as.setActive(owner, s.cash.id, false, 'x'))).toBe('state'); expect(code(() => s.as.setActive(owner, w.id, false))).toBe('invalid'); s.as.setActive(owner, w.id, false, 'اتقفلت');
    expect(s.as.list(owner).map(a => a.name)).toEqual(['الخزنة', 'بنك مصر']); expect(s.as.list(owner, { includeInactive: true })).toHaveLength(3); expect(s.as.list(acct)).toHaveLength(2); expect(code(() => s.as.list(cashier))).toBe('forbidden');
    expect(() => s.hub.db.exec('DELETE FROM money_accounts')).toThrow(); expect(() => s.hub.db.exec("UPDATE money_accounts SET opening_minor=1")).toThrow();
    expect(s.as.seedDefaults(owner)).toBe(0); const c = s.as.createCategory(owner, { name: 'إيجار', kind: 'out' }); s.as.renameCategory(owner, c.id, 'إيجار المحل'); s.as.setCategoryActive(owner, c.id, false); expect(s.as.categories(owner).some(x => x.id === c.id)).toBe(false);
  });
});

describe('ledger', () => {
  it('in, out and transfer move balances in whole piasters; a transfer counts on both sides; the statement runs balance by balance', () => {
    const s = prep(); s.as.createAccount(owner, { name: 'tmp', kind: 'other' });
    s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.cash.id, kind: 'in', categoryId: s.cat('تقفيلة نقدية'), amountMinor: 50000 }); s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.cash.id, kind: 'out', categoryId: s.cat('مصروفات أخرى'), amountMinor: 12050, party: 'كهرباء' });
    s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.cash.id, kind: 'transfer', toAccountId: s.bank.id, categoryId: s.cat('تحويل بين الحسابات'), amountMinor: 80000 });
    expect(s.as.get(owner, s.cash.id).balanceMinor).toBe(100000 + 50000 - 12050 - 80000); expect(s.as.get(owner, s.bank.id).balanceMinor).toBe(80000); expect(s.as.total(owner)).toBe(100000 + 50000 - 12050);
    const st = s.lg.statement(acct, s.cash.id, '2026-12-01', '2026-12-01'); expect(st).toMatchObject({ openingMinor: 100000, totalInMinor: 50000, totalOutMinor: 92050, closingMinor: 57950 }); expect(st.lines.map(l => l.balanceMinor)).toEqual([150000, 137950, 57950]);
    expect(s.lg.statement(acct, s.bank.id, '2026-12-01', '2026-12-01').lines[0]).toMatchObject({ inMinor: 80000 }); expect(s.lg.statement(acct, s.cash.id, '2026-12-02', '2026-12-03')).toMatchObject({ openingMinor: 57950, closingMinor: 57950, lines: [] });
    expect(s.lg.list(acct, { accountId: s.bank.id })).toHaveLength(1); expect(s.lg.list(acct, { kind: 'in' })).toHaveLength(1);
  });
  it('refuses bad entries: wrong category kind, fractions, future date, same account transfer, a cash box below zero; a bank may overdraw; replays by key', () => {
    const s = prep(); const base = { key: key(), date: '2026-12-01', accountId: s.cash.id, kind: 'out' as const, categoryId: s.cat('مصروفات أخرى'), amountMinor: 100 };
    expect(code(() => s.lg.post(owner, { ...base, key: key(), categoryId: s.cat('تقفيلة نقدية') }))).toBe('invalid'); expect(code(() => s.lg.post(owner, { ...base, key: key(), amountMinor: 10.5 }))).toBe('invalid'); expect(code(() => s.lg.post(owner, { ...base, key: key(), amountMinor: 0 }))).toBe('invalid');
    expect(code(() => s.lg.post(owner, { ...base, key: key(), date: '2027-01-01' }))).toBe('invalid'); expect(code(() => s.lg.post(owner, { ...base, key: key(), date: '2026-13-40' }))).toBe('invalid'); expect(code(() => s.lg.post(owner, { ...base, key: key(), toAccountId: s.bank.id }))).toBe('invalid');
    expect(code(() => s.lg.post(owner, { ...base, key: key(), kind: 'transfer', categoryId: s.cat('تحويل بين الحسابات'), toAccountId: s.cash.id }))).toBe('invalid'); expect(code(() => s.lg.post(owner, { ...base, key: key(), amountMinor: 100001 }))).toBe('insufficient');
    expect(code(() => s.lg.post(acct, { ...base, key: key() }))).toBe('forbidden'); expect(code(() => s.lg.post(owner, { ...base, key: key(), date: '2026-11-30' }))).toBe('invalid'); // before the account opened (1 Dec)
    const a = s.lg.post(owner, { ...base, key: 'same', amountMinor: 700 }); const b = s.lg.post(owner, { ...base, key: 'same', amountMinor: 700 }); expect([a.replay, b.replay, b.entry.id === a.entry.id]).toEqual([false, true, true]);
    expect(code(() => s.lg.post(owner, { ...base, key: key(), accountId: s.bank.id, amountMinor: 5000 }))).toBe('no error'); expect(s.as.get(owner, s.bank.id).balanceMinor).toBe(-5000);
  });
  it('void keeps the entry with its reason and gives the money back; never delete or edit', () => {
    const s = prep(); const e = s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.cash.id, kind: 'out', categoryId: s.cat('مصروفات أخرى'), amountMinor: 30000 }).entry; expect(s.as.get(owner, s.cash.id).balanceMinor).toBe(70000);
    expect(code(() => s.lg.void(owner, e.id, ' '))).toBe('invalid'); expect(code(() => s.lg.void(acct, e.id, 'x'))).toBe('forbidden'); expect(s.lg.void(owner, e.id, 'مبلغ غلط')).toMatchObject({ status: 'void', voidReason: 'مبلغ غلط' }); expect(s.as.get(owner, s.cash.id).balanceMinor).toBe(100000);
    expect(code(() => s.lg.void(owner, e.id, 'x'))).toBe('state'); expect(s.lg.list(acct)).toHaveLength(0); expect(s.lg.list(acct, { includeVoid: true })).toHaveLength(1);
    expect(() => s.hub.db.exec('DELETE FROM ledger_entries')).toThrow(); expect(() => s.hub.db.exec('UPDATE ledger_entries SET amount_minor=1')).toThrow();
    const inn = s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.bank.id, kind: 'in', categoryId: s.cat('وارد آخر'), amountMinor: 1000 }).entry; s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.bank.id, kind: 'transfer', toAccountId: s.cash.id, categoryId: s.cat('تحويل بين الحسابات'), amountMinor: 1000 });
    const t = s.lg.post(owner, { key: key(), date: '2026-12-01', accountId: s.cash.id, kind: 'transfer', toAccountId: s.bank.id, categoryId: s.cat('تحويل بين الحسابات'), amountMinor: 100000 }).entry; expect(inn.id).toBeTruthy(); expect(t.status).toBe('posted');
  });
});

describe('cheques', () => {
  it('a received cheque waits, then clears into the ledger; an issued one pays out; bounced and cancelled move nothing', () => {
    const s = prep(); const r = s.ch.register(acct, { key: key(), direction: 'received', chequeNo: '123456', bankName: 'CIB', party: 'شركة تأمين', amountMinor: 250000, dueDate: '2026-12-05', accountId: s.bank.id }); expect(r).toMatchObject({ ref: 'CHQ-000001', status: 'pending' });
    expect(code(() => s.ch.register(acct, { key: key(), direction: 'received', chequeNo: '123456', bankName: 'CIB', party: 'x', amountMinor: 1, dueDate: '2026-12-05', accountId: s.bank.id }))).toBe('duplicate'); expect(code(() => s.ch.register(cashier, { key: key(), direction: 'issued', chequeNo: '1', party: 'x', amountMinor: 1, dueDate: '2026-12-05', accountId: s.bank.id }))).toBe('forbidden');
    expect(s.ch.due(acct, 7)).toMatchObject({ comingInMinor: 250000, goingOutMinor: 0, cheques: [{ late: false }] }); expect(s.as.get(owner, s.bank.id).balanceMinor).toBe(0);
    s.clock.t = Date.parse('2026-12-05T10:00:00Z'); const c = s.ch.clear(acct, r.id, '2026-12-05'); expect(c.status).toBe('cleared'); expect(s.as.get(owner, s.bank.id).balanceMinor).toBe(250000); expect(s.lg.get(owner, c.entryId!)).toMatchObject({ kind: 'in', refNo: '123456', sourceRef: `cheque:${r.id}` });
    expect(code(() => s.ch.clear(acct, r.id))).toBe('state'); expect(code(() => s.lg.void(owner, c.entryId!, 'x'))).toBe('state'); // from a cheque: cancel it there
    const o = s.ch.register(acct, { key: key(), direction: 'issued', chequeNo: '777', party: 'المتحدة للأدوية', amountMinor: 100000, dueDate: '2026-12-02', accountId: s.bank.id }); s.clock.t += 3 * 86400000; expect(s.ch.due(acct)).toMatchObject({ goingOutMinor: 100000, cheques: [{ late: true }] });
    s.ch.clear(acct, o.id); expect(s.as.get(owner, s.bank.id).balanceMinor).toBe(150000);
    const b = s.ch.register(acct, { key: key(), direction: 'received', chequeNo: '9', party: 'عميل', amountMinor: 5000, dueDate: '2026-12-10', accountId: s.bank.id }); expect(code(() => s.ch.bounce(acct, b.id, ' '))).toBe('invalid'); s.ch.bounce(acct, b.id, 'رصيد غير كاف'); expect(code(() => s.ch.clear(acct, b.id))).toBe('state'); s.ch.cancel(acct, b.id, 'اتلغى');
    expect(s.ch.history(acct, b.id).map(h => h.to)).toEqual(['pending', 'bounced', 'cancelled']); expect(s.as.get(owner, s.bank.id).balanceMinor).toBe(150000); expect(code(() => s.as.setActive(owner, s.bank.id, false, 'x'))).toBe('state');
    expect(() => s.hub.db.exec("UPDATE cheques SET amount_minor=1")).toThrow(); expect(() => s.hub.db.exec('DELETE FROM cheque_events')).toThrow();
  });
});

describe('inbox from closed days', () => {
  it('proposes the counted cash and card sales of each closed day once, posts only on approval, and can ignore with a reason', () => {
    const s = prep(); const ins = (d: string, cash: number, card: number) => s.hub.db.prepare('INSERT INTO day_closings(id,business_date,totals_json) VALUES(?,?,?)').run(`id${d}`, d, JSON.stringify({ countedCashMinor: cash, cardMinor: card }));
    expect(s.ib.feedClosings(owner)).toBe(0); ins('2026-12-01', 540000, 120000); ins('2026-12-02', 0, 30000); expect(s.ib.feedClosings(owner)).toBe(3); expect(s.ib.feedClosings(owner)).toBe(0); expect(code(() => s.ib.feedClosings(acct))).toBe('forbidden');
    const p = s.ib.list(acct); expect(p.map(x => [x.ref, x.amountMinor])).toEqual([['closing:2026-12-01:card', 120000], ['closing:2026-12-01:cash', 540000], ['closing:2026-12-02:card', 30000]]); expect(s.as.get(owner, s.cash.id).balanceMinor).toBe(100000);
    const cashRow = p.find(x => x.source === 'closing_cash')!; const r = s.ib.approve(owner, cashRow.id, { accountId: s.cash.id, categoryId: s.cat('تقفيلة نقدية') }); expect(r.row.status).toBe('approved'); expect(r.entry).toMatchObject({ amountMinor: 540000, sourceRef: 'closing:2026-12-01:cash' }); expect(s.as.get(owner, s.cash.id).balanceMinor).toBe(640000);
    expect(code(() => s.ib.approve(owner, cashRow.id, { accountId: s.cash.id, categoryId: s.cat('تقفيلة نقدية') }))).toBe('state'); const card = p.find(x => x.source === 'closing_card')!; expect(code(() => s.ib.ignore(owner, card.id, ' '))).toBe('invalid'); expect(s.ib.ignore(owner, card.id, 'اتحسبت يدوي').status).toBe('ignored');
    expect(s.ib.list(acct)).toHaveLength(1); expect(s.ib.feedClosings(owner)).toBe(0); expect(() => s.hub.db.exec('DELETE FROM ledger_inbox')).toThrow(); expect(() => s.hub.db.exec('UPDATE ledger_inbox SET amount_minor=1')).toThrow();
  });
});
