import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { AttendanceService, OPS_MIGRATIONS, OpsError } from './index';

const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const ph2: Person = { id: 'ph2', roles: ['P'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as OpsError).code ?? (e as Error).message; } return 'no error'; };
const T = (s: string) => Date.parse(s);
const prep = () => { const clock = { t: T('2026-12-01T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), OPS_MIGRATIONS_WITH_DEPS()); const as = new AttendanceService(hub); return { hub, clock, as }; };
function OPS_MIGRATIONS_WITH_DEPS() { return OPS_MIGRATIONS.filter(m => m.id === 'ops_0004_attendance'); }
const evening = [{ weekday: 2, start: '16:00', end: '00:00' }]; // Tuesday, overnight

describe('attendance', () => {
  it('check in late and out late: minutes, overtime waiting for a manager who is not the person', () => {
    const s = prep(); s.as.setSchedule(mgr, 'ph', evening, '2026-11-01'); s.clock.t = T('2026-12-01T14:10:00Z'); // 16:10 in Cairo
    const i = s.as.checkIn(ph); expect(i).toMatchObject({ workDate: '2026-12-01', lateMinutes: 5, status: 'present' }); expect(code(() => s.as.checkIn(ph))).toBe('state');
    s.clock.t = T('2026-12-01T22:40:00Z'); const o = s.as.checkOut(ph); expect(o).toMatchObject({ workedMinutes: 510, overtimeMinutes: 40, overtimeStatus: 'pending', earlyMinutes: 0 }); expect(code(() => s.as.checkOut(ph))).toBe('state');
    expect(s.as.team(mgr, '2026-12')[0]).toMatchObject({ personId: 'ph', overtimeMinutes: 0, overtimePending: 1 }); expect(code(() => s.as.decideOvertime(ph, o.id, true))).toBe('forbidden'); expect(code(() => s.as.decideOvertime(mgr, o.id, false))).toBe('invalid');
    expect(s.as.decideOvertime(mgr, o.id, true).overtimeStatus).toBe('approved'); expect(s.as.team(mgr, '2026-12')[0]).toMatchObject({ overtimeMinutes: 40, overtimePending: 0 }); expect(code(() => s.as.decideOvertime(mgr, o.id, true))).toBe('state');
    expect(() => s.hub.db.exec('DELETE FROM attendance_days')).toThrow(); expect(() => s.hub.db.exec('UPDATE attendance_events SET by=1')).toThrow();
  });
  it('a manager never decides their own overtime or leave; an old check-in is refused; a correction keeps the old times and a reason', () => {
    const s = prep(); s.as.setSchedule(mgr, 'ph', evening, '2026-11-01'); s.clock.t = T('2026-12-01T14:00:00Z'); const d = s.as.checkIn(ph); s.clock.t = T('2026-12-02T08:00:00Z'); // 18 h later
    expect(code(() => s.as.checkOut(ph))).toBe('invalid'); expect(code(() => s.as.correct(mgr, d.id, { checkOut: '2026-12-01T22:05:00Z', reason: ' ' }))).toBe('invalid');
    expect(code(() => s.as.correct(mgr, d.id, { checkOut: '2026-12-02T08:00:00Z', reason: 'نسي' }))).toBe('invalid'); expect(code(() => s.as.correct(ph, d.id, { checkOut: '2026-12-01T22:05:00Z', reason: 'x' }))).toBe('forbidden');
    const c = s.as.correct(mgr, d.id, { checkOut: '2026-12-01T22:05:00Z', reason: 'نسي يسجل الانصراف' }); expect(c).toMatchObject({ workedMinutes: 485, overtimeMinutes: 0, overtimeStatus: 'none', lateMinutes: 0 });
    const h = s.as.history(mgr, d.id); expect(h.at(-1)).toMatchObject({ action: 'correction', before: { checkOut: null }, reason: 'نسي يسجل الانصراف', by: 'mg' });
    s.clock.t = T('2026-12-08T14:00:00Z'); s.as.checkIn(mgr); const own = s.hub.db.prepare("SELECT id FROM attendance_days WHERE person_id='mg'").get()!; expect(code(() => s.as.correct(mgr, String(own.id), { checkOut: '2026-12-08T22:00:00Z', reason: 'x' }))).toBe('forbidden');
  });
  it('leave: request, approve by someone else, the day becomes leave not absence; absences only for scheduled days nobody covered', () => {
    const s = prep(); s.as.setSchedule(mgr, 'ph', evening, '2026-11-01'); s.as.setSchedule(mgr, 'ph2', evening, '2026-11-01');
    expect(code(() => s.as.requestLeave(ph, { date: '2026-11-30', type: 'leave', reason: 'x' }))).toBe('invalid'); const r = s.as.requestLeave(ph, { date: '2026-12-08', type: 'leave', reason: 'ظرف عائلي' }); expect(code(() => s.as.requestLeave(ph, { date: '2026-12-08', type: 'leave', reason: 'x' }))).toBe('duplicate');
    expect(s.as.pendingLeave(mgr)).toHaveLength(1); expect(code(() => s.as.decideLeave(ph2, r.id, true))).toBe('forbidden'); s.as.decideLeave(mgr, r.id, true); expect(code(() => s.as.decideLeave(mgr, r.id, false, 'x'))).toBe('state');
    expect(code(() => s.as.markAbsences(mgr, '2026-12-08', ['ph']))).toBe('invalid'); s.clock.t = T('2026-12-09T10:00:00Z');
    expect(s.as.markAbsences(mgr, '2026-12-08', ['ph', 'ph2', 'nobody'])).toEqual(['ph2']); expect(s.as.team(mgr, '2026-12')).toMatchObject([{ personId: 'ph', leave: 1, absent: 0 }, { personId: 'ph2', leave: 0, absent: 1 }]);
    expect(s.as.mine(ph, '2026-12')).toMatchObject([{ status: 'leave' }]);
  });
  it('schedules: a new pattern leaves the old days alone; no shift means no lateness; bad shifts are refused', () => {
    const s = prep(); expect(code(() => s.as.setSchedule(ph, 'ph', evening, '2026-11-01'))).toBe('forbidden'); expect(code(() => s.as.setSchedule(mgr, 'ph', [{ weekday: 2, start: '25:00', end: '01:00' }], '2026-11-01'))).toBe('invalid');
    s.as.setSchedule(mgr, 'ph', evening, '2026-11-01'); s.as.setSchedule(mgr, 'ph', [{ weekday: 2, start: '09:00', end: '17:00' }], '2026-12-02'); s.clock.t = T('2026-12-01T14:30:00Z'); expect(s.as.checkIn(ph)).toMatchObject({ lateMinutes: 25 }); // still the old 16:00 shift on 1 Dec
    s.clock.t = T('2026-12-01T22:00:00Z'); s.as.checkOut(ph); s.clock.t = T('2026-12-02T07:00:00Z'); expect(s.as.checkIn(ph)).toMatchObject({ plannedStart: null, lateMinutes: 0 }); // Wednesday: no shift
  });
});
