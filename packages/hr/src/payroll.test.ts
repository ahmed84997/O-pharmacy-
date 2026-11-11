import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { OPS_MIGRATIONS } from '@o-pharmacy/ops';
import { HR_MIGRATIONS, HrError, PayrollService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as HrError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `pk${++n}`;
const prep = () => {
  const clock = { t: Date.parse('2026-12-10T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), [...OPS_MIGRATIONS.filter(m => m.id === 'ops_0004_attendance'), ...HR_MIGRATIONS]); const pr = new PayrollService(hub);
  const day = (p: string, d: string, o: Record<string, unknown> = {}) => hub.db.prepare('INSERT INTO attendance_days(id,person_id,work_date,status,late_minutes,worked_minutes,overtime_minutes,overtime_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`${p}${d}`, p, d, (o.status as string) ?? 'present', (o.late as number) ?? 0, (o.worked as number) ?? 480, (o.ot as number) ?? 0, (o.otStatus as string) ?? 'none', '2026-11-01T00:00:00Z');
  pr.setProfile(owner, { personId: 'ph', baseSalaryMinor: 300000, hoursPerDay: 8, effectiveFrom: '2026-01-01' }); pr.setProfile(owner, { personId: 'sk', baseSalaryMinor: 240000, hoursPerDay: 8, cycleStartDay: 15, effectiveFrom: '2026-01-01' });
  day('ph', '2026-11-02', { late: 12 }); day('ph', '2026-11-03', { worked: 500, ot: 60, otStatus: 'approved' }); day('ph', '2026-11-04', { status: 'absent', worked: 0 }); day('ph', '2026-11-05', { ot: 30, otStatus: 'pending' }); day('ph', '2026-11-06', { status: 'leave', worked: 0 });
  day('sk', '2026-10-20', { late: 30 }); day('sk', '2026-11-20', { late: 100 });
  return { hub, clock, pr };
};

describe('pay profiles', () => {
  it('only Admin-level people set or see pay; bad values are refused; cycles per person', () => {
    const s = prep(); expect(code(() => s.pr.setProfile(mgr, { personId: 'x', baseSalaryMinor: 1, hoursPerDay: 8, effectiveFrom: '2026-01-01' }))).toBe('forbidden'); expect(code(() => s.pr.profile(mgr, 'ph'))).toBe('forbidden'); expect(code(() => s.pr.preview(cashier, '2026-11'))).toBe('forbidden');
    for (const bad of [{ baseSalaryMinor: 10.5 }, { baseSalaryMinor: -1 }, { hoursPerDay: 0 }, { hoursPerDay: 25 }, { cycleStartDay: 29 }, { effectiveFrom: '1/1' }]) expect(code(() => s.pr.setProfile(owner, { personId: 'x', baseSalaryMinor: 1, hoursPerDay: 8, effectiveFrom: '2026-01-01', ...bad }))).toBe('invalid');
    expect(s.pr.profile(owner, 'ph')).toMatchObject({ baseSalaryMinor: 300000, cycleStartDay: 1 }); s.pr.setProfile(owner, { personId: 'ph', baseSalaryMinor: 350000, hoursPerDay: 8, effectiveFrom: '2026-12-01' }); expect(s.pr.profile(owner, 'ph', '2026-11-30')?.baseSalaryMinor).toBe(300000); expect(s.pr.profile(owner, 'ph')?.baseSalaryMinor).toBe(350000);
    expect(PayrollService.period('2026-11', 1)).toEqual({ start: '2026-11-01', end: '2026-11-30' }); expect(PayrollService.period('2026-11', 15)).toEqual({ start: '2026-10-15', end: '2026-11-14' }); expect(PayrollService.period('2026-01', 10)).toEqual({ start: '2025-12-10', end: '2026-01-09' });
    expect(() => s.hub.db.exec('UPDATE pay_profiles SET base_salary_minor=1')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM pay_profiles')).toThrow();
  });
});

describe('payroll', () => {
  it('works out late, absence, approved overtime only, bonuses and deductions in whole piasters; leave is not deducted; another cycle day uses its own period', () => {
    const s = prep(); const add = (kind: 'bonus' | 'advance' | 'penalty', amountMinor: number, date: string) => s.pr.addAdjustment(owner, { key: key(), personId: 'ph', kind, amountMinor, date, reason: 'سبب' });
    add('bonus', 5000, '2026-11-10'); add('advance', 20000, '2026-11-12'); const pen = add('penalty', 1000, '2026-11-15'); const outside = add('bonus', 99999, '2026-12-02'); expect(outside.adjNo).toBe('ADJ-000004');
    const [ph, sk] = s.pr.preview(owner, '2026-11'); expect(ph).toMatchObject({ personId: 'ph', periodStart: '2026-11-01', periodEnd: '2026-11-30', baseMinor: 300000, ratePerHourMinor: 1250, lateMinutes: 12, lateDeductionMinor: 250, overtimeMinutes: 60, overtimePayMinor: 1250, absentDays: 1, absenceDeductionMinor: 10000, plusMinor: 5000, minusMinor: 21000, netMinor: 275000 });
    expect(sk).toMatchObject({ personId: 'sk', periodStart: '2026-10-15', periodEnd: '2026-11-14', lateMinutes: 30, lateDeductionMinor: 500, netMinor: 239500 });
    s.pr.voidAdjustment(owner, pen.id, 'اتلغت'); expect(s.pr.preview(owner, '2026-11', ['ph'])[0]!.netMinor).toBe(276000); expect(code(() => s.pr.voidAdjustment(owner, pen.id, 'x'))).toBe('state'); expect(s.pr.adjustments(owner, 'ph', '2026-11-01', '2026-11-30').map(a => a.status)).toEqual(['active', 'active', 'void']);
    expect(code(() => s.pr.addAdjustment(owner, { key: key(), personId: 'ph', kind: 'bonus', amountMinor: 1.5, date: '2026-11-10', reason: 'x' }))).toBe('invalid'); expect(code(() => s.pr.addAdjustment(owner, { key: key(), personId: 'ph', kind: 'bonus', amountMinor: 5, date: '2026-11-10', reason: ' ' }))).toBe('invalid'); expect(() => s.hub.db.exec('DELETE FROM pay_adjustments')).toThrow();
  });
  it('a run saves immutable payslips once per period; the month must be over; a wrong run is voided and run again; paying is recorded once', () => {
    const s = prep(); s.pr.addAdjustment(owner, { key: key(), personId: 'ph', kind: 'advance', amountMinor: 20000, date: '2026-11-12', reason: 'سلفة' }); expect(code(() => s.pr.run(owner, { key: key(), month: '2026-12' }))).toBe('state'); expect(code(() => s.pr.run(mgr, { key: key(), month: '2026-11' }))).toBe('forbidden');
    const k = key(); const r = s.pr.run(owner, { key: k, month: '2026-11' }); expect(r).toMatchObject({ runNo: 'PR-000001', slips: 2, skipped: [], replay: false, totalNetMinor: 510500 }); expect(s.pr.run(owner, { key: k, month: '2026-11' }).replay).toBe(true);
    expect(code(() => s.pr.run(owner, { key: key(), month: '2026-11' }))).toBe('state'); expect(code(() => s.pr.addAdjustment(owner, { key: key(), personId: 'ph', kind: 'bonus', amountMinor: 1, date: '2026-11-20', reason: 'x' }))).toBe('state'); expect(() => s.hub.db.exec('UPDATE payslips SET net_minor=1')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM payroll_runs')).toThrow();
    const slips = s.pr.payslips(owner, { month: '2026-11' }); expect(slips).toHaveLength(2); expect(s.pr.unpaid(owner)).toHaveLength(2); const ph = slips.find(x => x.personId === 'ph')!; expect(ph.netMinor).toBe(271000);
    s.pr.markPaid(owner, ph.id, 'cash'); expect(code(() => s.pr.markPaid(owner, ph.id, 'bank'))).toBe('state'); expect(s.pr.unpaid(owner)).toHaveLength(1); expect(code(() => s.pr.voidRun(owner, 'PR-000001', 'x'))).toBe('state'); // one is already paid
    const t = prep(); t.pr.run(owner, { key: key(), month: '2026-11' }); expect(code(() => t.pr.voidRun(owner, 'PR-000001', ' '))).toBe('invalid'); t.pr.voidRun(owner, 'PR-000001', 'غلط في الحضور'); expect(t.pr.payslips(owner)).toEqual([]); expect(t.pr.payslips(owner, { includeVoid: true })).toHaveLength(2);
    t.pr.addAdjustment(owner, { key: key(), personId: 'ph', kind: 'bonus', amountMinor: 1000, date: '2026-11-20', reason: 'بعد الإلغاء' }); const again = t.pr.run(owner, { key: key(), month: '2026-11' }); expect(again).toMatchObject({ runNo: 'PR-000002', slips: 2 }); expect(code(() => t.pr.markPaid(owner, t.pr.payslips(owner, { includeVoid: true }).find(x => x.runId !== again.runNo && false)?.id ?? 'none', 'cash'))).toBe('not-found');
  });
});
