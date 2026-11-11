import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { OPS_MIGRATIONS } from '@o-pharmacy/ops';
import { ACCOUNTS_MIGRATIONS, AccountService, LedgerService } from '@o-pharmacy/accounts';
import { HR_MIGRATIONS } from '@o-pharmacy/hr';
import { CONTRACT_MIGRATIONS } from '@o-pharmacy/contracts';
import { BUILTIN_REPORTS, REPORT_MIGRATIONS, ReportCentre, ReportError } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as ReportError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `rk${++n}`;
const prep = (all = true) => {
  const migs = all ? [...MIGRATIONS, ...POS_MIGRATIONS, ...OPS_MIGRATIONS, ...ACCOUNTS_MIGRATIONS, ...HR_MIGRATIONS, ...CONTRACT_MIGRATIONS, ...REPORT_MIGRATIONS] : [...REPORT_MIGRATIONS];
  const clock = { t: Date.parse('2026-12-10T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), migs); const rc = new ReportCentre(hub);
  if (!all) return { hub, clock, rc } as never as ReturnType<typeof full>; return full(hub, clock, rc);
};
const full = (hub: Hub, clock: { t: number }, rc: ReportCentre) => {
  const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-10' } as never); const sales = new SaleService(hub, items, bs, { maxDiscountPct: () => 5 }); const cust = new CustomerService(hub, sales);
  const a = items.create(owner, { nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }] });
  bs.receive(owner, { key: key(), itemId: a.id, lot: 'L1', expiry: '2026-12-31', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4800 } as never); bs.receive(owner, { key: key(), itemId: a.id, lot: 'L2', expiry: '2028-03-31', qty: 40, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4800 } as never);
  const sid = sales.openSession(ph, { key: key(), terminal: 'T1', openingFloatMinor: 10000 }).id; const sell = (qty = 1, o: Record<string, unknown> = {}) => sales.createSale(ph, { key: key(), sessionId: sid, lines: [{ itemId: a.id, qty, unitName: 'علبة' }], cashMinor: 5000 * qty, ...o } as never);
  return { hub, clock, rc, items, bs, sales, cust, a, sell };
};

describe('catalogue and permissions', () => {
  it('offers only what a person may open and what the data has; money reports need the financial permission; pay needs Admin-level', () => {
    const s = prep(); const keys = (p: Person) => s.rc.catalogue(p).map(x => x.key);
    expect(keys(owner)).toHaveLength(BUILTIN_REPORTS.length); expect(keys(mgr)).toContain('sales_by_day'); expect(keys(mgr)).not.toContain('payroll_summary'); expect(keys(ph)).toContain('expiring_batches'); expect(keys(ph)).not.toContain('sales_by_day'); expect(keys(ph)).not.toContain('stock_valuation'); expect(keys(cashier)).toEqual([]);
    expect(code(() => s.rc.run(ph, 'sales_by_day'))).toBe('forbidden'); expect(code(() => s.rc.run(mgr, 'payroll_summary', { month: '2026-11' }))).toBe('forbidden'); expect(code(() => s.rc.run(owner, 'nope'))).toBe('not-found');
    const bare = prep(false) as never as { rc: ReportCentre }; expect(bare.rc.catalogue(owner)).toEqual([]); expect(code(() => bare.rc.run(owner, 'sales_by_day'))).toBe('not-found');
  });
});

describe('reports', () => {
  it('sales by day agrees with the sales table, ignores voids, and uses the Cairo day; by item gives cost and profit', () => {
    const s = prep(); const x = s.sell(2); s.sell(1); const v = s.sell(1); s.sales.voidSale(owner, v.saleNo, 'غلط'); const real = Number(s.hub.db.prepare("SELECT SUM(total_minor) t FROM sales WHERE status='posted'").get()!.t);
    const r = s.rc.run(owner, 'sales_by_day', { from: '2026-12-01', to: '2026-12-31' }); expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ date: '2026-12-10', sales: 2, total: real, voids: 1 }); expect(r.totals).toMatchObject({ sales: 2, total: real }); expect(x.id).toBeTruthy();
    expect(s.rc.run(owner, 'sales_by_day', { from: '2026-12-11', to: '2026-12-31' }).rows).toEqual([]); expect(code(() => s.rc.run(owner, 'sales_by_day', { from: '2026-12-31', to: '2026-12-01' }))).toBe('invalid'); expect(code(() => s.rc.run(owner, 'sales_by_day', { from: 'x' }))).toBe('invalid');
    const it = s.rc.run(owner, 'sales_by_item', { from: '2026-12-01', to: '2026-12-31' }); expect(it.rows).toHaveLength(1); expect(it.rows[0]).toMatchObject({ item: 'باراسيتامول 500', qty: 60, amount: real, profit: real - Number(it.rows[0]!.cost) }); expect(code(() => s.rc.run(owner, 'sales_by_item', { limit: 0 }))).toBe('invalid');
  });
  it('stock valuation is stock times cost; expiring batches list only what is left and near, soonest first', () => {
    const s = prep(); s.sell(2); const v = s.rc.run(owner, 'stock_valuation'); expect(v.rows).toHaveLength(1); expect(v.totals!.value).toBe(48 * 3000); const e = s.rc.run(ph, 'expiring_batches', { days: 30 }); expect(e.rows).toHaveLength(1); expect(e.rows[0]).toMatchObject({ lot: 'L1', expiry: '2026-12-31', daysLeft: 21 }); expect(s.rc.run(ph, 'expiring_batches', { days: 900 }).rows).toHaveLength(2);
  });
  it('customer balances, account balances and due cheques', () => {
    const s = prep(); const c = s.cust.create(owner, { name: 'أحمد علي' }); s.cust.setCreditLimit(owner, c.id, 100000, 'ok'); s.sell(1, { customerId: c.id, onCredit: true, cashMinor: 0 }); const cb = s.rc.run(owner, 'customer_balances'); expect(cb.rows).toHaveLength(1); expect(cb.rows[0]!.name).toBe('أحمد علي'); expect(Number(cb.rows[0]!.balance)).toBeGreaterThan(0);
    const as = new AccountService(s.hub); const lg = new LedgerService(s.hub, as); as.seedDefaults(owner); const cash = as.createAccount(owner, { name: 'الخزنة', kind: 'cash', openingMinor: 10000, openingDate: '2026-12-01' }); const bank = as.createAccount(owner, { name: 'البنك', kind: 'bank', openingMinor: 0, openingDate: '2026-12-01' });
    const cat = (k: string) => String(s.hub.db.prepare('SELECT id FROM ledger_categories WHERE kind=? ORDER BY sort LIMIT 1').get(k)!.id); lg.post(owner, { key: key(), date: '2026-12-05', accountId: cash.id, kind: 'in', categoryId: cat('in'), amountMinor: 50000 }); lg.post(owner, { key: key(), date: '2026-12-06', accountId: cash.id, kind: 'out', categoryId: cat('out'), amountMinor: 7000 }); lg.post(owner, { key: key(), date: '2026-12-07', accountId: cash.id, kind: 'transfer', toAccountId: bank.id, categoryId: cat('transfer'), amountMinor: 20000 });
    const ab = s.rc.run(owner, 'account_balances'); const bal = (n: string) => ab.rows.find(r => r.account === n)!.balance; expect(bal('الخزنة')).toBe(as.balanceOf(cash.id)); expect(bal('البنك')).toBe(as.balanceOf(bank.id)); expect(bal('البنك')).toBe(20000); expect(ab.totals!.balance).toBe(10000 + 50000 - 7000);
    s.hub.db.prepare("INSERT INTO cheques(id,cheque_ref,req_key,direction,cheque_no,party,amount_minor,due_date,account_id,status,created_by,created_at) VALUES('c1','CHQ-1','q1','issued','77','مورد',9000,'2026-12-08',?,'pending','owner','2026-12-01T00:00:00Z')").run(bank.id); const cq = s.rc.run(owner, 'cheques_due', { days: 10 }); expect(cq.rows[0]).toMatchObject({ direction: 'صادر', late: 'متأخر', amount: 9000 });
  });
  it('the ops, hr and insurance reports run on empty data without error and with the right columns', () => {
    const s = prep(); for (const k of ['shortages_open', 'requests_by_status', 'attendance_summary', 'payroll_summary', 'claims_outstanding', 'purchases_by_supplier']) { const r = s.rc.run(owner, k, { month: '2026-11' }); expect(r.columns.length).toBeGreaterThan(1); expect(r.rows).toEqual(r.rows.filter(Boolean)); }
    s.hub.db.prepare("INSERT INTO attendance_days(id,person_id,work_date,status,late_minutes,worked_minutes,overtime_minutes,overtime_status,created_at) VALUES('d1','ph','2026-11-02','present',10,480,60,'approved','2026-11-02T10:00:00Z'),('d2','ph','2026-11-03','absent',0,0,0,'none','2026-11-03T10:00:00Z')").run(); expect(s.rc.run(owner, 'attendance_summary', { month: '2026-11' }).rows).toEqual([{ person: 'ph', present: 1, absent: 1, leave: 0, late: 10, worked: 480, overtime: 60 }]); expect(s.rc.run(owner, 'attendance_summary').params.month).toBe('2026-11'); expect(code(() => s.rc.run(owner, 'attendance_summary', { month: '11/2026' }))).toBe('invalid');
  });
});

describe('export, views and log', () => {
  it('exports CSV with a BOM, decimal money and a guard against formulas; needs report.export', () => {
    const s = prep(); const c = s.cust.create(owner, { name: '=HYPERLINK("x")' }); s.cust.setCreditLimit(owner, c.id, 100000, 'ok'); s.sell(1, { customerId: c.id, onCredit: true, cashMinor: 0 }); const e = s.rc.export(owner, 'customer_balances'); expect(e.csv.startsWith('﻿')).toBe(true); expect(e.csv).toContain(`"'=HYPERLINK(""x"")"`); expect(e.csv).toMatch(/\d+\.\d{2}\r\n/); expect(e.filename).toBe('customer_balances-2026-12-10.csv'); expect(e.rows).toBe(1);
    expect(code(() => s.rc.export(ph, 'expiring_batches'))).toBe('forbidden'); expect(code(() => s.rc.export(mgr, 'payroll_summary', { month: '2026-11' }))).toBe('forbidden');
  });
  it('saved views are private unless a lead shares them, run with their filters, are archived not deleted; every run is logged', () => {
    const s = prep(); s.sell(1); const id = s.rc.saveView(ph, { reportKey: 'expiring_batches', name: 'قريب جداً', params: { days: 30 } }); expect(s.rc.views(ph)).toHaveLength(1); expect(s.rc.views(cashier)).toEqual([]); expect(s.rc.runView(ph, id).rows).toHaveLength(1); expect(code(() => s.rc.runView(cashier, id))).toBe('not-found');
    expect(code(() => s.rc.saveView(ph, { reportKey: 'expiring_batches', name: 'x', shared: true }))).toBe('forbidden'); expect(code(() => s.rc.saveView(ph, { reportKey: 'sales_by_day', name: 'x' }))).toBe('forbidden'); expect(code(() => s.rc.saveView(ph, { reportKey: 'expiring_batches', name: ' ' }))).toBe('invalid'); expect(code(() => s.rc.saveView(ph, { reportKey: 'expiring_batches', name: 'x', params: { days: 0 } }))).toBe('invalid');
    const sh = s.rc.saveView(mgr, { reportKey: 'expiring_batches', name: 'للكل', params: { days: 400 }, shared: true }); expect(s.rc.views(ph).map(v => v.id)).toContain(sh); expect(code(() => s.rc.archiveView(ph, sh))).toBe('forbidden');
    s.rc.archiveView(ph, id); expect(s.rc.views(ph).map(v => v.id)).toEqual([sh]); expect(code(() => s.rc.archiveView(ph, id))).toBe('state'); expect(Number(s.hub.db.prepare('SELECT COUNT(*) n FROM saved_views').get()!.n)).toBe(2); expect(() => s.hub.db.exec('DELETE FROM saved_views')).toThrow();
    s.rc.export(mgr, 'expiring_batches'); const h = s.rc.history(mgr); expect(h[0]).toMatchObject({ reportKey: 'expiring_batches', action: 'export' }); expect(h.length).toBeGreaterThanOrEqual(2); expect(code(() => s.rc.history(ph))).toBe('forbidden'); expect(() => s.hub.db.exec('UPDATE report_runs SET rows_count=0')).toThrow();
  });
});
