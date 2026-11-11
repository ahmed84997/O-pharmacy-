import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { OpsError } from './requests';

export interface AttendanceRules { timeZone: string; graceMinutes: number; overtimeMinMinutes: number; maxOpenHours: number }
export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = { timeZone: 'Africa/Cairo', graceMinutes: 5, overtimeMinMinutes: 30, maxOpenHours: 16 };
export interface ShiftInput { weekday: number; start: string; end: string }
export interface AttendanceDay { id: string; personId: string; workDate: string; plannedStart: string | null; plannedEnd: string | null; checkIn: string | null; checkOut: string | null; status: 'present' | 'absent' | 'leave'; lateMinutes: number; earlyMinutes: number; workedMinutes: number; overtimeMinutes: number; overtimeStatus: 'none' | 'pending' | 'approved' | 'rejected' }
export interface LeaveRequest { id: string; personId: string; workDate: string; type: 'leave' | 'permission'; reason: string; status: 'pending' | 'approved' | 'rejected'; decidedBy: string | null; decisionNote: string | null }
const HM = /^([01]\d|2[0-3]):[0-5]\d$/; const DATE = /^\d{4}-\d{2}-\d{2}$/; const MIN = 60000;

/** Shifts, check in / out and leave. Times are real instants; shifts are local clock times in the pharmacy time zone (an overnight shift ends the next day). Lateness, early leave, worked and overtime minutes are worked out when the day is saved. Overtime waits for a manager. A manager never decides or corrects their own day. Nothing is deleted; every correction keeps the old values and a reason. Pay is not computed here (finance is Admin only). */
export class AttendanceService {
  constructor(private hub: Hub, private rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  private parts(ms: number) { const f = new Intl.DateTimeFormat('en-CA', { timeZone: this.rules.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)); const g = (t: string) => Number(f.find(x => x.type === t)!.value); return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') }; }
  /** The local calendar date (YYYY-MM-DD) of an instant. */
  localDate(ms: number): string { const p = this.parts(ms); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
  private weekdayOf(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
  /** A local date and HH:MM to an instant. */
  private at(date: string, hm: string, addDays = 0): number {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number]; const [h, mi] = hm.split(':').map(Number) as [number, number]; const wall = Date.UTC(y, m - 1, d + addDays, h, mi); let guess = wall;
    for (let k = 0; k < 3; k++) { const p = this.parts(guess); guess += wall - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi); } return guess;
  }
  private shiftOn(personId: string, date: string): { start: number; end: number; startHm: string; endHm: string } | null {
    const rows = this.db.prepare('SELECT start_hm, end_hm, effective_from FROM shift_schedules WHERE person_id=? AND weekday=? AND effective_from<=? ORDER BY effective_from DESC, seq DESC').all(personId, this.weekdayOf(date), date); if (!rows.length) return null;
    const latest = String(rows[0]!.effective_from); const r = rows.find(x => String(x.effective_from) === latest)!; if (r.start_hm === 'off') return null; const s = String(r.start_hm), e = String(r.end_hm);
    return { start: this.at(date, s), end: this.at(date, e, e <= s ? 1 : 0), startHm: s, endHm: e };
  }
  private view(r: Record<string, unknown>): AttendanceDay { return { id: String(r.id), personId: String(r.person_id), workDate: String(r.work_date), plannedStart: (r.planned_start as string) ?? null, plannedEnd: (r.planned_end as string) ?? null, checkIn: (r.check_in as string) ?? null, checkOut: (r.check_out as string) ?? null, status: r.status as AttendanceDay['status'], lateMinutes: Number(r.late_minutes), earlyMinutes: Number(r.early_minutes), workedMinutes: Number(r.worked_minutes), overtimeMinutes: Number(r.overtime_minutes), overtimeStatus: r.overtime_status as AttendanceDay['overtimeStatus'] }; }
  private day(id: string) { const r = this.db.prepare('SELECT * FROM attendance_days WHERE id=?').get(id); if (!r) throw new OpsError('not-found', 'attendance day'); return r; }
  private event(actor: Person, dayId: string, action: string, o: { before?: unknown; after?: unknown; reason?: string } = {}): void { this.db.prepare('INSERT INTO attendance_events(id,day_id,action,before,after,reason,by,at) VALUES(?,?,?,?,?,?,?,?)').run(uuidv7(), dayId, action, o.before === undefined ? null : JSON.stringify(o.before), o.after === undefined ? null : JSON.stringify(o.after), o.reason ?? null, actor.id, this.hub.now()); }
  /** Lateness, early leave, worked and overtime from the planned shift and the real times. */
  private figures(plannedStart: string | null, plannedEnd: string | null, checkIn: string, checkOut: string | null) {
    const ci = Date.parse(checkIn); let late = 0, early = 0, over = 0, worked = 0;
    if (plannedStart) late = Math.max(0, Math.round((ci - Date.parse(plannedStart)) / MIN) - this.rules.graceMinutes);
    if (checkOut) { const co = Date.parse(checkOut); worked = Math.max(0, Math.round((co - ci) / MIN)); if (plannedEnd) { const d = Math.round((co - Date.parse(plannedEnd)) / MIN); if (d < 0) early = -d; else if (d >= this.rules.overtimeMinMinutes) over = d; } }
    return { late, early, over, worked };
  }
  /** Set the weekly pattern from a date (weekdays not listed are days off). A new pattern never edits the old one. */
  setSchedule(actor: Person, personId: string, shifts: ShiftInput[], effectiveFrom: string): void {
    this.need(actor, 'attendance.approve'); if (!DATE.test(effectiveFrom)) throw new OpsError('invalid', 'effective date must be YYYY-MM-DD'); const seen = new Set<number>();
    for (const s of shifts) { if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6 || !HM.test(s.start) || !HM.test(s.end) || s.start === s.end) throw new OpsError('invalid', 'bad shift'); if (seen.has(s.weekday)) throw new OpsError('invalid', 'a weekday is listed twice'); seen.add(s.weekday); }
    this.db.tx(() => { const now = this.hub.now(); for (let w = 0; w < 7; w++) { const s = shifts.find(x => x.weekday === w); this.db.prepare('INSERT INTO shift_schedules(id,person_id,weekday,start_hm,end_hm,effective_from,set_by,at) VALUES(?,?,?,?,?,?,?,?)').run(uuidv7(), personId, w, s ? s.start : 'off', s ? s.end : 'off', effectiveFrom, actor.id, now); } this.hub.audit(actor.id, 'attendance.schedule_set', 'person', personId, { effectiveFrom }); });
  }
  /** Check in now. One open check-in at a time; the day takes the planned shift of that weekday. */
  checkIn(actor: Person): AttendanceDay {
    this.need(actor, 'attendance.record_own');
    return this.db.tx(() => {
      const open = this.db.prepare('SELECT 1 FROM attendance_days WHERE person_id=? AND check_in IS NOT NULL AND check_out IS NULL').get(actor.id); if (open) throw new OpsError('state', 'you are already checked in');
      const now = this.hub.now(); const date = this.localDate(Date.parse(now)); const old = this.db.prepare('SELECT * FROM attendance_days WHERE person_id=? AND work_date=?').get(actor.id, date);
      if (old && old.check_in) throw new OpsError('state', 'you already checked in today'); if (old && old.status === 'leave') throw new OpsError('state', 'today is an approved leave');
      const sh = this.shiftOn(actor.id, date); const ps = sh ? new Date(sh.start).toISOString() : null; const pe = sh ? new Date(sh.end).toISOString() : null; const f = this.figures(ps, pe, now, null);
      let id: string; if (old) { id = String(old.id); this.db.prepare("UPDATE attendance_days SET check_in=?, status='present', late_minutes=?, planned_start=?, planned_end=? WHERE id=?").run(now, f.late, ps, pe, id); } else { id = uuidv7(); this.db.prepare("INSERT INTO attendance_days(id,person_id,work_date,planned_start,planned_end,check_in,status,late_minutes,created_at) VALUES(?,?,?,?,?,?,'present',?,?)").run(id, actor.id, date, ps, pe, now, f.late, now); }
      this.event(actor, id, 'check_in', { after: { at: now, late: f.late } }); this.hub.audit(actor.id, 'attendance.check_in', 'attendance_day', id, { late: f.late }); this.hub.emit('attendance.checked_in', { personId: actor.id, late: f.late }); return this.view(this.day(id));
    });
  }
  /** Check out: worked, early and overtime minutes are saved; overtime waits for a manager. A check-out too long after the check-in is refused (wrong day). */
  checkOut(actor: Person): AttendanceDay {
    this.need(actor, 'attendance.record_own');
    return this.db.tx(() => {
      const d = this.db.prepare('SELECT * FROM attendance_days WHERE person_id=? AND check_in IS NOT NULL AND check_out IS NULL').get(actor.id); if (!d) throw new OpsError('state', 'you are not checked in');
      const now = this.hub.now(); if (Date.parse(now) - Date.parse(String(d.check_in)) > this.rules.maxOpenHours * 3600000) throw new OpsError('invalid', 'this check-in is too old: ask a manager to correct the day');
      const f = this.figures((d.planned_start as string) ?? null, (d.planned_end as string) ?? null, String(d.check_in), now);
      this.db.prepare('UPDATE attendance_days SET check_out=?, early_minutes=?, worked_minutes=?, overtime_minutes=?, overtime_status=? WHERE id=?').run(now, f.early, f.worked, f.over, f.over > 0 ? 'pending' : 'none', String(d.id));
      this.event(actor, String(d.id), 'check_out', { after: { at: now, worked: f.worked, early: f.early, overtime: f.over } }); this.hub.audit(actor.id, 'attendance.check_out', 'attendance_day', String(d.id), { worked: f.worked }); this.hub.emit('attendance.checked_out', { personId: actor.id, overtime: f.over }); return this.view(this.day(String(d.id)));
    });
  }
  private notOwn(actor: Person, personId: string): void { if (personId === actor.id) throw new OpsError('forbidden', 'a manager cannot decide on their own day'); }
  decideOvertime(actor: Person, dayId: string, approve: boolean, note?: string): AttendanceDay {
    this.need(actor, 'attendance.approve'); if (!approve && !note?.trim()) throw new OpsError('invalid', 'a reason is required to reject');
    return this.db.tx(() => { const d = this.day(dayId); this.notOwn(actor, String(d.person_id)); if (d.overtime_status !== 'pending') throw new OpsError('state', 'no overtime is waiting'); const st = approve ? 'approved' : 'rejected';
      this.db.prepare('UPDATE attendance_days SET overtime_status=?, overtime_by=?, overtime_note=? WHERE id=?').run(st, actor.id, note?.trim() || null, dayId); this.event(actor, dayId, 'overtime', { after: st, reason: note?.trim() }); this.hub.audit(actor.id, `attendance.overtime_${st}`, 'attendance_day', dayId, {}); return this.view(this.day(dayId)); });
  }
  /** A manager fixes the times of a day (a forgotten check-out, a wrong day). A reason is required and the old values are kept in the log. */
  correct(actor: Person, dayId: string, p: { checkIn?: string; checkOut?: string | null; reason: string }): AttendanceDay {
    this.need(actor, 'attendance.approve'); if (!p.reason?.trim()) throw new OpsError('invalid', 'a reason is required');
    return this.db.tx(() => {
      const d = this.day(dayId); this.notOwn(actor, String(d.person_id)); const ci = p.checkIn ?? (d.check_in as string | null); const co = p.checkOut === undefined ? (d.check_out as string | null) : p.checkOut; if (!ci) throw new OpsError('invalid', 'a check-in time is required');
      if (Number.isNaN(Date.parse(ci)) || (co && Number.isNaN(Date.parse(co)))) throw new OpsError('invalid', 'bad time'); if (co && Date.parse(co) <= Date.parse(ci)) throw new OpsError('invalid', 'check-out must be after check-in'); if (co && Date.parse(co) - Date.parse(ci) > this.rules.maxOpenHours * 3600000) throw new OpsError('invalid', 'that is too long for one shift: check the date');
      const f = this.figures((d.planned_start as string) ?? null, (d.planned_end as string) ?? null, ci, co); const ot = f.over > 0 ? (d.overtime_status === 'approved' && Number(d.overtime_minutes) === f.over ? 'approved' : 'pending') : 'none';
      this.db.prepare("UPDATE attendance_days SET check_in=?, check_out=?, status='present', late_minutes=?, early_minutes=?, worked_minutes=?, overtime_minutes=?, overtime_status=? WHERE id=?").run(ci, co, f.late, f.early, f.worked, f.over, ot, dayId);
      this.event(actor, dayId, 'correction', { before: { checkIn: d.check_in, checkOut: d.check_out }, after: { checkIn: ci, checkOut: co }, reason: p.reason.trim() }); this.hub.audit(actor.id, 'attendance.corrected', 'attendance_day', dayId, { reason: p.reason.trim() }); return this.view(this.day(dayId));
    });
  }
  requestLeave(actor: Person, i: { date: string; type: 'leave' | 'permission'; reason: string }): LeaveRequest {
    this.need(actor, 'attendance.record_own'); if (!DATE.test(i.date)) throw new OpsError('invalid', 'date must be YYYY-MM-DD'); if (!i.reason?.trim()) throw new OpsError('invalid', 'a reason is required'); if (i.date < this.localDate(Date.parse(this.hub.now()))) throw new OpsError('invalid', 'a request is for today or later');
    return this.db.tx(() => { if (this.db.prepare('SELECT 1 FROM leave_requests WHERE person_id=? AND work_date=? AND type=?').get(actor.id, i.date, i.type)) throw new OpsError('duplicate', 'already requested'); const id = uuidv7();
      this.db.prepare('INSERT INTO leave_requests(id,person_id,work_date,type,reason,created_at) VALUES(?,?,?,?,?,?)').run(id, actor.id, i.date, i.type, i.reason.trim(), this.hub.now()); this.hub.audit(actor.id, 'attendance.leave_requested', 'leave_request', id, { date: i.date, type: i.type }); this.hub.emit('leave.requested', { personId: actor.id, date: i.date }); return this.leave(id); });
  }
  private leave(id: string): LeaveRequest { const r = this.db.prepare('SELECT * FROM leave_requests WHERE id=?').get(id); if (!r) throw new OpsError('not-found', 'leave request'); return { id: String(r.id), personId: String(r.person_id), workDate: String(r.work_date), type: r.type as LeaveRequest['type'], reason: String(r.reason), status: r.status as LeaveRequest['status'], decidedBy: (r.decided_by as string) ?? null, decisionNote: (r.decision_note as string) ?? null }; }
  /** Approving a full-day leave makes that day a leave day (not an absence). */
  decideLeave(actor: Person, id: string, approve: boolean, note?: string): LeaveRequest {
    this.need(actor, 'attendance.approve'); if (!approve && !note?.trim()) throw new OpsError('invalid', 'a reason is required to reject');
    return this.db.tx(() => { const r = this.leave(id); this.notOwn(actor, r.personId); if (r.status !== 'pending') throw new OpsError('state', 'already decided'); this.db.prepare('UPDATE leave_requests SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').run(approve ? 'approved' : 'rejected', actor.id, this.hub.now(), note?.trim() || null, id);
      if (approve && r.type === 'leave') { const d = this.db.prepare('SELECT * FROM attendance_days WHERE person_id=? AND work_date=?').get(r.personId, r.workDate); if (!d) { const did = uuidv7(); this.db.prepare("INSERT INTO attendance_days(id,person_id,work_date,status,created_at) VALUES(?,?,?,'leave',?)").run(did, r.personId, r.workDate, this.hub.now()); this.event(actor, did, 'leave', { reason: r.reason }); } else if (!d.check_in) { this.db.prepare("UPDATE attendance_days SET status='leave' WHERE id=?").run(String(d.id)); this.event(actor, String(d.id), 'leave', { reason: r.reason }); } }
      this.hub.audit(actor.id, `attendance.leave_${approve ? 'approved' : 'rejected'}`, 'leave_request', id, {}); this.hub.emit('leave.decided', { personId: r.personId, approved: approve }); return this.leave(id); });
  }
  pendingLeave(actor: Person): LeaveRequest[] { this.need(actor, 'attendance.approve'); return this.db.prepare("SELECT id FROM leave_requests WHERE status='pending' ORDER BY work_date, created_at").all().map(r => this.leave(String(r.id))); }
  /** After a day ends: people with a scheduled shift and no check-in become absent (or stay on leave). Run by a manager for a past date. */
  markAbsences(actor: Person, date: string, people: string[]): string[] {
    this.need(actor, 'attendance.approve'); if (!DATE.test(date)) throw new OpsError('invalid', 'date must be YYYY-MM-DD'); if (date >= this.localDate(Date.parse(this.hub.now()))) throw new OpsError('invalid', 'the day has not ended');
    return this.db.tx(() => { const out: string[] = []; for (const p of people) { if (this.db.prepare('SELECT 1 FROM attendance_days WHERE person_id=? AND work_date=?').get(p, date)) continue; const sh = this.shiftOn(p, date); if (!sh) continue; const id = uuidv7();
      this.db.prepare("INSERT INTO attendance_days(id,person_id,work_date,planned_start,planned_end,status,created_at) VALUES(?,?,?,?,?,'absent',?)").run(id, p, date, new Date(sh.start).toISOString(), new Date(sh.end).toISOString(), this.hub.now()); this.event(actor, id, 'absent'); this.hub.audit(actor.id, 'attendance.absent', 'attendance_day', id, { personId: p }); out.push(p); } return out; });
  }
  mine(actor: Person, month: string): AttendanceDay[] { this.need(actor, 'attendance.record_own'); return this.db.prepare('SELECT * FROM attendance_days WHERE person_id=? AND work_date LIKE ? ORDER BY work_date').all(actor.id, `${month}-%`).map(r => this.view(r)); }
  /** Month totals per person for managers. Overtime counts only when approved. */
  team(actor: Person, month: string) {
    this.need(actor, 'attendance.approve');
    return this.db.prepare("SELECT person_id, SUM(status='present') present, SUM(status='absent') absent, SUM(status='leave') leave, SUM(late_minutes) late, SUM(early_minutes) early, SUM(worked_minutes) worked, SUM(CASE WHEN overtime_status='approved' THEN overtime_minutes ELSE 0 END) overtime, SUM(overtime_status='pending') pending FROM attendance_days WHERE work_date LIKE ? GROUP BY person_id ORDER BY person_id").all(`${month}-%`)
      .map(r => ({ personId: String(r.person_id), present: Number(r.present), absent: Number(r.absent), leave: Number(r.leave), lateMinutes: Number(r.late), earlyMinutes: Number(r.early), workedMinutes: Number(r.worked), overtimeMinutes: Number(r.overtime), overtimePending: Number(r.pending) }));
  }
  history(actor: Person, dayId: string) { this.need(actor, 'attendance.approve'); return this.db.prepare('SELECT action, before, after, reason, by, at FROM attendance_events WHERE day_id=? ORDER BY seq').all(dayId).map(e => ({ action: String(e.action), before: e.before ? JSON.parse(String(e.before)) : null, after: e.after ? JSON.parse(String(e.after)) : null, reason: (e.reason as string) ?? null, by: String(e.by), at: String(e.at) })); }
}
