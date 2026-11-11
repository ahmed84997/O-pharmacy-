import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { OpsError } from './requests';

const LEAD = ['O', 'A', 'M'];
export interface StaffTask { id: string; taskNo: string; title: string; body: string | null; assignedTo: string; dueDate: string | null; status: 'open' | 'done' | 'cancelled'; createdBy: string; createdAt: string; closedBy: string | null; closedAt: string | null; closeNote: string | null }

/** Tasks a manager gives to a person ("count the fridge shelf", "call the supplier"). Managers (`staff_tasks.manage`) create, reassign and cancel (with a reason); the assignee (`staff_tasks.my`) sees their own and marks them done. A task is never deleted and a closed one never changes. */
export class TaskService {
  constructor(private hub: Hub) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  private row(id: string) { const r = this.db.prepare('SELECT * FROM staff_tasks WHERE id=? OR task_no=?').get(id, id); if (!r) throw new OpsError('not-found', `task ${id}`); return r; }
  private view(r: Record<string, unknown>): StaffTask { return { id: String(r.id), taskNo: String(r.task_no), title: String(r.title), body: (r.body as string) ?? null, assignedTo: String(r.assigned_to), dueDate: (r.due_date as string) ?? null, status: r.status as StaffTask['status'], createdBy: String(r.created_by), createdAt: String(r.created_at), closedBy: (r.closed_by as string) ?? null, closedAt: (r.closed_at as string) ?? null, closeNote: (r.close_note as string) ?? null }; }
  private event(actor: Person, id: string, action: string, note?: string): void { this.db.prepare('INSERT INTO staff_task_events(id,task_id,action,note,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), id, action, note ?? null, actor.id, this.hub.now()); }
  create(actor: Person, i: { key: string; title: string; body?: string; assignedTo: string; dueDate?: string }): StaffTask {
    this.need(actor, 'staff_tasks.manage'); if (!i.title?.trim()) throw new OpsError('invalid', 'a title is required'); if (!i.assignedTo) throw new OpsError('invalid', 'who is it for?'); if (i.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(i.dueDate)) throw new OpsError('invalid', 'due date must be YYYY-MM-DD');
    return this.db.tx(() => {
      const old = this.db.prepare('SELECT * FROM staff_tasks WHERE req_key=?').get(i.key); if (old) return this.view(old);
      const n = Number(this.db.prepare("SELECT v FROM ops_counters WHERE k='task'").get()?.v ?? 0) + 1; this.db.prepare("INSERT INTO ops_counters(k,v) VALUES('task',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(n);
      const id = uuidv7(); const no = `T-${String(n).padStart(6, '0')}`;
      this.db.prepare('INSERT INTO staff_tasks(id,task_no,req_key,title,body,assigned_to,due_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, no, i.key, i.title.trim(), i.body?.trim() || null, i.assignedTo, i.dueDate ?? null, actor.id, this.hub.now());
      this.event(actor, id, 'created'); this.hub.audit(actor.id, 'task.created', 'staff_task', no, { assignedTo: i.assignedTo }); this.hub.emit('task.created', { taskNo: no, assignedTo: i.assignedTo }); return this.view(this.row(id));
    });
  }
  assign(actor: Person, id: string, to: string): StaffTask {
    this.need(actor, 'staff_tasks.manage'); if (!to) throw new OpsError('invalid', 'who is it for?');
    return this.db.tx(() => { const r = this.row(id); if (r.status !== 'open') throw new OpsError('state', 'the task is closed'); this.db.prepare('UPDATE staff_tasks SET assigned_to=? WHERE id=?').run(to, String(r.id)); this.event(actor, String(r.id), 'assigned', to); this.hub.audit(actor.id, 'task.assigned', 'staff_task', String(r.task_no), { to }); return this.view(this.row(String(r.id))); });
  }
  /** The assignee (or a manager) marks it done. */
  complete(actor: Person, id: string, note?: string): StaffTask {
    this.need(actor, 'staff_tasks.my');
    return this.db.tx(() => { const r = this.row(id); if (r.status !== 'open') throw new OpsError('state', 'the task is closed'); if (r.assigned_to !== actor.id && !actor.roles.some(x => LEAD.includes(x))) throw new OpsError('forbidden', 'this task is not yours');
      this.db.prepare("UPDATE staff_tasks SET status='done', closed_by=?, closed_at=?, close_note=? WHERE id=?").run(actor.id, this.hub.now(), note?.trim() || null, String(r.id)); this.event(actor, String(r.id), 'done', note?.trim()); this.hub.audit(actor.id, 'task.done', 'staff_task', String(r.task_no), {}); this.hub.emit('task.done', { taskNo: String(r.task_no) }); return this.view(this.row(String(r.id))); });
  }
  cancel(actor: Person, id: string, reason: string): StaffTask {
    this.need(actor, 'staff_tasks.manage'); if (!reason?.trim()) throw new OpsError('invalid', 'a reason is required');
    return this.db.tx(() => { const r = this.row(id); if (r.status !== 'open') throw new OpsError('state', 'the task is closed'); this.db.prepare("UPDATE staff_tasks SET status='cancelled', closed_by=?, closed_at=?, close_note=? WHERE id=?").run(actor.id, this.hub.now(), reason.trim(), String(r.id)); this.event(actor, String(r.id), 'cancelled', reason.trim()); this.hub.audit(actor.id, 'task.cancelled', 'staff_task', String(r.task_no), { reason: reason.trim() }); return this.view(this.row(String(r.id))); });
  }
  /** My open tasks, soonest due first. */
  mine(actor: Person): StaffTask[] { this.need(actor, 'staff_tasks.my'); return this.db.prepare("SELECT * FROM staff_tasks WHERE assigned_to=? AND status='open' ORDER BY due_date IS NULL, due_date, created_at").all(actor.id).map(r => this.view(r)); }
  /** Everyone's tasks for managers, optionally one person or status; overdue ones are flagged against `today`. */
  list(actor: Person, f: { assignedTo?: string; status?: string } = {}): (StaffTask & { overdue: boolean })[] {
    this.need(actor, 'staff_tasks.manage'); const today = this.hub.now().slice(0, 10);
    return this.db.prepare('SELECT * FROM staff_tasks WHERE (? IS NULL OR assigned_to=?) AND (? IS NULL OR status=?) ORDER BY created_at DESC, id DESC').all(f.assignedTo ?? null, f.assignedTo ?? null, f.status ?? null, f.status ?? null).map(r => ({ ...this.view(r), overdue: r.status === 'open' && !!r.due_date && String(r.due_date) < today }));
  }
  history(actor: Person, id: string) { this.need(actor, 'staff_tasks.manage'); return this.db.prepare('SELECT action, note, by, at FROM staff_task_events WHERE task_id=? ORDER BY seq').all(String(this.row(id).id)).map(e => ({ action: String(e.action), note: (e.note as string) ?? null, by: String(e.by), at: String(e.at) })); }
}
