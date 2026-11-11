import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { ACCOUNTS_MIGRATIONS, AccError, AccountService, BooksService, LedgerService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const admin: Person = { id: 'ad', roles: ['A'], branchIds: ['b1'] };
const acct: Person = { id: 'ac', roles: ['X'], branchIds: ['b1'] };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as AccError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `bk${++n}`;
const prep = () => {
  const clock = { t: Date.parse('2026-12-10T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), ACCOUNTS_MIGRATIONS); const as = new AccountService(hub); const lg = new LedgerService(hub, as); const bk = new BooksService(hub);
  as.seedDefaults(owner); bk.seedChart(owner); const cat = (name: string) => as.categories(owner).find(c => c.name === name)!.id; const coa = (c: string) => bk.accounts(owner).find(a => a.code === c)!.id;
  const cash = as.createAccount(owner, { name: 'الخزنة', kind: 'cash', openingMinor: 100000, openingDate: '2026-12-01' }); const bank = as.createAccount(owner, { name: 'بنك مصر', kind: 'bank', openingDate: '2026-12-01' });
  bk.map(owner, 'money', cash.id, coa('1100')); bk.map(owner, 'money', bank.id, coa('1200')); bk.map(owner, 'opening', 'equity', coa('3100')); bk.map(owner, 'category', cat('تقفيلة نقدية'), coa('4100')); bk.map(owner, 'category', cat('مصروفات أخرى'), coa('5200'));
  const post = (o: Record<string, unknown>) => lg.post(owner, { key: key(), date: '2026-12-02', ...o } as never).entry;
  return { hub, clock, as, lg, bk, cat, coa, cash, bank, post };
};

describe('chart of accounts and journal', () => {
  it('the Admin builds the chart; codes are unique; a child shares its parent type; an account with a balance cannot be switched off', () => {
    const s = prep(); expect(s.bk.accounts(owner)).toHaveLength(11); expect(s.bk.seedChart(owner)).toBe(0); expect(code(() => s.bk.createAccount(owner, { code: '1100', name: 'x', type: 'asset' }))).toBe('duplicate'); expect(code(() => s.bk.createAccount(acct, { code: '9', name: 'x', type: 'asset' }))).toBe('forbidden');
    expect(code(() => s.bk.createAccount(owner, { code: '1110', name: 'x', type: 'income', parentId: s.coa('1100') }))).toBe('invalid'); const sub = s.bk.createAccount(owner, { code: '1110', name: 'خزنة فرعية', type: 'asset', parentId: s.coa('1100') }); s.bk.renameAccount(owner, sub.id, 'خزنة الفرع'); s.bk.setAccountActive(owner, sub.id, false);
    expect(s.bk.accounts(owner)).toHaveLength(11); expect(() => s.hub.db.exec('DELETE FROM coa_accounts')).toThrow(); expect(() => s.hub.db.exec("UPDATE coa_accounts SET type='income'")).toThrow(); expect(code(() => s.bk.map(owner, 'money', s.cash.id, s.coa('4100')))).toBe('invalid');
  });
  it('journal entries must balance in whole piasters; a mistake is reversed, never edited; the original shows what reversed it', () => {
    const s = prep(); const L = (c: string, d?: number, cr?: number) => ({ coaId: s.coa(c), debitMinor: d, creditMinor: cr }); const base = { key: key(), date: '2026-12-03', memo: 'مصروف يدوي' };
    expect(code(() => s.bk.post(owner, { ...base, lines: [L('5200', 1000), L('1100', undefined, 900)] }))).toBe('invalid'); expect(code(() => s.bk.post(owner, { ...base, key: key(), lines: [L('5200', 1000)] }))).toBe('invalid'); expect(code(() => s.bk.post(owner, { ...base, key: key(), lines: [L('5200', 10.5), L('1100', undefined, 10.5)] }))).toBe('invalid');
    expect(code(() => s.bk.post(owner, { ...base, key: key(), lines: [L('5200', 5, 5), L('1100', undefined, 0)] }))).toBe('invalid'); expect(code(() => s.bk.post(acct, { ...base, key: key(), lines: [L('5200', 1000), L('1100', undefined, 1000)] }))).toBe('forbidden');
    const k = key(); const a = s.bk.post(owner, { ...base, key: k, lines: [L('5200', 1000), L('1100', undefined, 1000)] }); expect(s.bk.post(owner, { ...base, key: k, lines: [L('5200', 1000), L('1100', undefined, 1000)] }).replay).toBe(true); expect(a.entry.journalNo).toBe('J-000001');
    expect(code(() => s.bk.reverse(owner, a.entry.id, ' '))).toBe('invalid'); const r = s.bk.reverse(owner, a.entry.id, 'غلط'); expect(r).toMatchObject({ reversesId: a.entry.id }); expect(s.bk.getEntry(owner, a.entry.id).reversedBy).toBe(r.id); expect(code(() => s.bk.reverse(owner, a.entry.id, 'x'))).toBe('state'); expect(code(() => s.bk.reverse(owner, r.id, 'x'))).toBe('state');
    expect(s.bk.trialBalance(acct, '2026-12-31').rows).toEqual([]); expect(() => s.hub.db.exec('DELETE FROM journal_lines')).toThrow(); expect(() => s.hub.db.exec("UPDATE journal_entries SET memo='x'")).toThrow();
  });
});

describe('ledger to journal and the statements', () => {
  it('journalises openings and ledger entries by the mappings; unmapped ones are reported; the three statements agree', () => {
    const s = prep(); s.post({ accountId: s.cash.id, kind: 'in', categoryId: s.cat('تقفيلة نقدية'), amountMinor: 500000 }); s.post({ accountId: s.cash.id, kind: 'out', categoryId: s.cat('مصروفات أخرى'), amountMinor: 120000 }); s.post({ accountId: s.cash.id, kind: 'transfer', toAccountId: s.bank.id, categoryId: s.cat('تحويل بين الحسابات'), amountMinor: 300000 });
    s.post({ accountId: s.cash.id, kind: 'in', categoryId: s.cat('وارد آخر'), amountMinor: 7000 }); // category not mapped
    const r = s.bk.journaliseLedger(owner); expect(r).toMatchObject({ posted: 4, reversed: 0 }); expect(r.skipped).toEqual([{ ref: 'L-000004', why: 'unmapped' }]); expect(s.bk.journaliseLedger(owner)).toMatchObject({ posted: 0 });
    const tb = s.bk.trialBalance(acct, '2026-12-31'); expect(tb).toMatchObject({ balanced: true, totalDebitMinor: 600000 }); expect(tb.rows.find(x => x.code === '1100')).toMatchObject({ debitMinor: 180000 }); expect(tb.rows.find(x => x.code === '1200')).toMatchObject({ debitMinor: 300000 });
    expect(s.bk.incomeStatement(acct, '2026-12-01', '2026-12-31')).toMatchObject({ totalIncomeMinor: 500000, totalExpensesMinor: 120000, netMinor: 380000 }); const bs = s.bk.balanceSheet(acct, '2026-12-31'); expect(bs).toMatchObject({ balanced: true, totalAssetsMinor: 480000, retainedProfitMinor: 380000, totalEquityMinor: 480000 });
    s.bk.map(owner, 'category', s.cat('وارد آخر'), s.coa('4200')); expect(s.bk.journaliseLedger(owner).posted).toBe(1); expect(s.bk.balanceSheet(acct, '2026-12-31').balanced).toBe(true); expect(code(() => s.bk.trialBalance(mgr, '2026-12-31'))).toBe('forbidden');
  });
  it('a voided ledger entry is reversed in the journal', () => {
    const s = prep(); const e = s.post({ accountId: s.cash.id, kind: 'out', categoryId: s.cat('مصروفات أخرى'), amountMinor: 50000 }); s.bk.journaliseLedger(owner); expect(s.bk.incomeStatement(acct, '2026-12-01', '2026-12-31').netMinor).toBe(-50000);
    s.lg.void(owner, e.id, 'غلط'); expect(s.bk.journaliseLedger(owner)).toMatchObject({ posted: 0, reversed: 1 }); expect(s.bk.incomeStatement(acct, '2026-12-01', '2026-12-31').netMinor).toBe(0); expect(s.bk.journaliseLedger(owner).reversed).toBe(0); expect(s.bk.trialBalance(acct, '2026-12-31').balanced).toBe(true);
  });
});

describe('closing periods', () => {
  it('closing needs the month to be over and fully journalised; a closed month accepts nothing until it is reopened with a reason', () => {
    const s = prep(); const e = s.post({ accountId: s.cash.id, kind: 'in', categoryId: s.cat('تقفيلة نقدية'), amountMinor: 1000 }); expect(code(() => s.bk.closePeriod(owner, '2026-12'))).toBe('state'); // not ended
    s.clock.t = Date.parse('2027-01-05T10:00:00Z'); expect(code(() => s.bk.closePeriod(mgr, '2026-12'))).toBe('forbidden'); expect(code(() => s.bk.closePeriod(owner, '2026-12'))).toBe('state'); // not journalised yet
    s.bk.journaliseLedger(owner); s.bk.closePeriod(owner, '2026-12'); expect(s.bk.periods(acct)).toMatchObject([{ month: '2026-12', status: 'closed' }]); expect(code(() => s.bk.closePeriod(owner, '2026-12'))).toBe('state');
    expect(code(() => s.post({ date: '2026-12-20', accountId: s.cash.id, kind: 'in', categoryId: s.cat('تقفيلة نقدية'), amountMinor: 5 }))).toBe('state'); expect(code(() => s.lg.void(owner, e.id, 'x'))).toBe('state');
    expect(code(() => s.bk.post(owner, { key: key(), date: '2026-12-15', memo: 'x', lines: [{ coaId: s.coa('5200'), debitMinor: 5 }, { coaId: s.coa('1100'), creditMinor: 5 }] }))).toBe('state');
    expect(code(() => s.bk.reopenPeriod(admin, '2026-12', ' '))).toBe('invalid'); expect(code(() => s.bk.reopenPeriod(mgr, '2026-12', 'x'))).toBe('forbidden'); s.bk.reopenPeriod(admin, '2026-12', 'تصحيح'); expect(s.lg.void(owner, e.id, 'تصحيح').status).toBe('void');
    expect(s.hub.db.prepare('SELECT action FROM period_events ORDER BY seq').all().map(x => x.action)).toEqual(['closed', 'reopened']); expect(() => s.hub.db.exec('DELETE FROM fin_periods')).toThrow();
  });
});
