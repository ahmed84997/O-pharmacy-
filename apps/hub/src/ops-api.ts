import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type Person } from '@o-pharmacy/core';
import type { AlertCategory, CountResult, ItemState, NotifyChannel, ShiftInput } from '@o-pharmacy/ops';
import type { App } from './compose';
import { AccessError } from './access';

type B = Record<string, unknown>;
const body = (q: FastifyRequest) => (q.body ?? {}) as B;
const param = (q: FastifyRequest, k: string) => String((q.params as B)[k] ?? '');
const qs = (q: FastifyRequest) => (q.query ?? {}) as B;
const key = (b: B) => { const k = String(b.key ?? ''); if (k.length < 8 || k.length > 80) throw new AccessError('invalid', 'a request key is required'); return k; };
const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
const reason = (b: B) => String(b.reason ?? '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Customers and operations (Sprint 7.4): customers, credit and payments, customer requests and shortages on the shared item lifecycle, order stages, notifications, handovers and home delivery, staff tasks, attendance and leave, the alert centre. Rules stay in the POS and ops packages. */
export function opsRoutes(s: FastifyInstance, app: App): void {
  const me = (q: FastifyRequest): Person => q.person!; const db = app.hub.db; const lead = (p: Person) => p.roles.some(r => r === 'O' || r === 'A' || r === 'M');
  const nameOf = db.prepare('SELECT display_name FROM people WHERE id=?'); const who = (id: string | null) => (id ? String(nameOf.get(id)?.display_name ?? id) : null);
  const month = (v: unknown) => { const m = String(v ?? app.hub.now().slice(0, 7)); if (!MONTH.test(m)) throw new AccessError('invalid', 'month must be YYYY-MM'); return m; };

  // ---------- people (names for assigning work) ----------
  s.get('/api/people/brief', async () => ({ people: db.prepare('SELECT id, display_name, roles_json FROM people WHERE active=1 ORDER BY display_name').all().map(r => ({ id: String(r.id), displayName: String(r.display_name), roles: JSON.parse(String(r.roles_json)) })) }));

  // ---------- customers ----------
  s.get('/api/customers', async (q) => { const x = qs(q); const p = me(q); const list = x.owing === '1' ? app.customers.owing(p).map(o => ({ id: o.customerId, code: o.code, name: o.name, phone: o.phone, balanceMinor: o.balanceMinor, creditLimitMinor: o.creditLimitMinor, active: true })) : app.customers.search(p, String(x.q ?? ''), { includeInactive: x.all === '1', limit: 100 }); return { customers: list }; });
  s.get('/api/customers/:id', async (q) => ({ customer: app.customers.get(me(q), param(q, 'id')) }));
  s.post('/api/customers', async (q) => { const b = body(q); return app.customers.create(me(q), { name: String(b.name ?? ''), phone: str(b.phone), kind: b.kind === 'company' ? 'company' : 'person', notes: str(b.notes) }); });
  s.patch('/api/customers/:id', async (q) => { const b = body(q); return app.customers.update(me(q), param(q, 'id'), { name: str(b.name), phone: str(b.phone), notes: str(b.notes) }); });
  s.post('/api/customers/:id/limit', async (q) => { const b = body(q); return app.customers.setCreditLimit(me(q), param(q, 'id'), Number(b.limitMinor), reason(b)); });
  s.post('/api/customers/:id/active', async (q) => { const b = body(q); app.customers.setActive(me(q), param(q, 'id'), b.active === true, reason(b)); return { ok: true }; });
  s.post('/api/customers/:id/opening', async (q) => { const b = body(q); app.customers.openingBalance(me(q), param(q, 'id'), Number(b.amountMinor), String(b.note ?? '')); return { ok: true }; });
  s.post('/api/customers/:id/payments', async (q) => { const b = body(q); const sess = app.sales.openSessionOf(me(q).id); if (!sess) throw new AccessError('state', 'open a cashier session first: the money goes into your drawer'); return app.customers.receivePayment(me(q), { key: key(b), customerId: param(q, 'id'), sessionId: sess.id, amountMinor: Number(b.amountMinor), method: b.method === 'card' ? 'card' : 'cash', ref: str(b.ref), note: str(b.note) }); });
  s.get('/api/customers/:id/statement', async (q) => { const x = qs(q); return app.customers.statement(me(q), param(q, 'id'), { fromIso: str(x.from), toIso: str(x.to) }); });

  // ---------- customer requests and shortages ----------
  const reqView = (v: ReturnType<App['requests']['get']>) => ({ ...v, ownerName: who(v.ownerId), createdByName: who(v.createdBy), items: v.items.map(i => ({ ...i, assignedName: who(i.assignedTo) })) });
  s.get('/api/requests', async (q) => { const x = qs(q); return { requests: app.requests.list(me(q), { kind: x.kind === 'shortage' ? 'shortage' : x.kind === 'customer_request' ? 'customer_request' : undefined, status: str(x.status) as never, q: str(x.q), limit: 200 }).map(reqView) }; });
  s.get('/api/requests/mine', async (q) => ({ work: app.requests.myWork(me(q)) }));
  s.get('/api/requests/:ref', async (q) => ({ request: reqView(app.requests.get(me(q), param(q, 'ref'))), timeline: app.requests.timeline(me(q), param(q, 'ref')).map(t => ({ ...t, byName: who(t.by) })) }));
  const itemsOf = (b: B) => (Array.isArray(b.items) ? (b.items as B[]).map(i => ({ itemId: str(i.itemId), itemName: str(i.itemName), qty: i.qty === undefined ? undefined : Number(i.qty) })) : []);
  s.post('/api/requests', async (q) => { const b = body(q); const p = me(q); const r = b.kind === 'shortage' ? app.requests.createShortage(p, { key: key(b), notes: str(b.notes), ownerId: str(b.ownerId), items: itemsOf(b) }) : app.requests.createRequest(p, { key: key(b), customerId: String(b.customerId ?? ''), notes: str(b.notes), ownerId: str(b.ownerId), items: itemsOf(b) }); return { ...(r as unknown as { request: B }).request, replay: (r as unknown as { replay?: boolean }).replay ?? false }; });
  s.post('/api/requests/:id/items', async (q) => app.requests.addItem(me(q), param(q, 'id'), itemsOf({ items: [body(q)] })[0]!));
  s.post('/api/requests/:id/comments', async (q) => { const b = body(q); app.requests.comment(me(q), { requestId: param(q, 'id'), itemId: str(b.itemId), body: String(b.body ?? '') }); return { ok: true }; });
  s.post('/api/requests/:id/cancel', async (q) => app.requests.cancelRequest(me(q), param(q, 'id'), reason(body(q))));
  /** One door for every item action, so the screen offers only what the lifecycle allows. */
  s.post('/api/request-items/:id/:action', async (q) => {
    const p = me(q); const id = param(q, 'id'); const b = body(q); const r = app.requests;
    switch (param(q, 'action')) {
      case 'move': return r.move(p, id, String(b.to ?? '') as ItemState, { reason: str(b.reason) });
      case 'cancel': return r.cancelItem(p, id, reason(b));
      case 'unavailable': return r.markUnavailable(p, id, reason(b));
      case 'available': return r.markAvailable(p, id, reason(b));
      case 'close-unavailable': return r.closeUnavailable(p, id, { customerInformed: b.customerInformed === true, reason: reason(b) });
      case 'reopen-unavailable': return r.reopenUnavailable(p, id, reason(b));
      case 'claim': return r.claim(p, id);
      case 'release': return r.release(p, id);
      case 'assign': return r.assign(p, id, String(b.userId ?? ''));
      case 'notify': return app.notifications.notify(p, id, (['phone', 'whatsapp', 'sms', 'in_person'].includes(String(b.channel)) ? b.channel : 'phone') as NotifyChannel['channel']);
      case 'dispatch': app.handovers.dispatch(p, id, { address: String(b.address ?? ''), note: str(b.note) }); return { ok: true };
      case 'deliver': app.handovers.deliver(p, id, { receiver: String(b.receiver ?? ''), note: str(b.note) }); return { ok: true };
      case 'fail': app.handovers.failDelivery(p, id, reason(b)); return { ok: true };
      case 'not-collected': app.handovers.markNotCollected(p, id, reason(b)); return { ok: true };
      case 'reopen': app.handovers.reopen(p, id, reason(b)); return { ok: true };
      case 'link-po': app.stages.link(p, id, String(b.poId ?? '')); return { ok: true };
      default: throw new AccessError('not-found', 'no such action');
    }
  });
  s.get('/api/request-items/:id/history', async (q) => ({ notifications: can(me(q), 'notification.view', app.hub.branchId) ? app.notifications.history(me(q), param(q, 'id')) : [], handovers: app.handovers.history(me(q), param(q, 'id')) }));
  s.get('/api/notify/todo', async (q) => ({ todo: app.notifications.toNotify(me(q)) }));
  s.get('/api/handovers/board', async (q) => app.handovers.board(me(q), 7));

  // ---------- order stages ----------
  s.get('/api/stages/open', async (q) => ({ open: app.stages.open(me(q)) }));
  s.get('/api/stages/:po', async (q) => ({ stages: app.stages.stages(me(q), param(q, 'po')).map(x => ({ ...x, byName: who(x.by) })) }));
  s.post('/api/stages/:po/:stage', async (q) => {
    const p = me(q); const po = param(q, 'po'); const b = body(q); const st = app.stages;
    switch (param(q, 'stage')) { case 'ordered': return st.markOrdered(p, po, str(b.note)); case 'received': return st.receive(p, po, str(b.note)); case 'counted': return st.count(p, po, Array.isArray(b.results) ? (b.results as B[]).map(r => ({ requestItemId: String(r.requestItemId ?? ''), result: String(r.result ?? 'arrived') as CountResult, note: str(r.note) })) : []); case 'entered': return st.markEntered(p, po); case 'labelled': return st.markLabelled(p, po); case 'shelved': return st.markShelved(p, po); default: throw new AccessError('not-found', 'no such stage'); }
  });
  s.get('/api/stages/:po/items', async (q) => { need(me(q), 'purchase_order.create'); const po = db.prepare('SELECT id FROM purchase_orders WHERE id=? OR po_no=?').get(param(q, 'po'), param(q, 'po')); if (!po) throw new AccessError('not-found', 'purchase order'); return { items: db.prepare('SELECT i.id, i.item_name, i.qty, i.status, r.ref FROM request_item_orders o JOIN request_items i ON i.id=o.request_item_id JOIN requests r ON r.id=i.request_id WHERE o.po_id=?').all(String(po.id)).map(r => ({ id: String(r.id), itemName: String(r.item_name), qty: Number(r.qty), status: String(r.status), ref: String(r.ref) })) }; });
  const need = (p: Person, k: string) => { if (!can(p, k, app.hub.branchId)) throw new AccessError('forbidden', `missing permission ${k}`); };

  // ---------- tasks ----------
  s.get('/api/tasks', async (q) => { const p = me(q); const list = can(p, 'staff_tasks.manage', app.hub.branchId) && qs(q).all === '1' ? app.tasks.list(p, { status: str(qs(q).status) }) : app.tasks.mine(p).map(t => ({ ...t, overdue: !!t.dueDate && t.dueDate < app.hub.now().slice(0, 10) })); return { tasks: list.map(t => ({ ...t, assignedName: who(t.assignedTo), createdByName: who(t.createdBy) })) }; });
  s.post('/api/tasks', async (q) => { const b = body(q); return app.tasks.create(me(q), { key: key(b), title: String(b.title ?? ''), body: str(b.body), assignedTo: String(b.assignedTo ?? ''), dueDate: str(b.dueDate) }); });
  s.post('/api/tasks/:id/assign', async (q) => app.tasks.assign(me(q), param(q, 'id'), String(body(q).to ?? '')));
  s.post('/api/tasks/:id/complete', async (q) => app.tasks.complete(me(q), param(q, 'id'), str(body(q).note)));
  s.post('/api/tasks/:id/cancel', async (q) => app.tasks.cancel(me(q), param(q, 'id'), reason(body(q))));

  // ---------- attendance ----------
  s.get('/api/attendance/mine', async (q) => ({ days: app.attendance.mine(me(q), month(qs(q).month)), today: app.attendance.localDate(Date.parse(app.hub.now())) }));
  s.post('/api/attendance/check-in', async (q) => app.attendance.checkIn(me(q)));
  s.post('/api/attendance/check-out', async (q) => app.attendance.checkOut(me(q)));
  s.get('/api/attendance/team', async (q) => { const m = month(qs(q).month); const p = me(q); return { team: app.attendance.team(p, m).map(t => ({ ...t, name: who(t.personId) })), leave: app.attendance.pendingLeave(p).map(l => ({ ...l, name: who(l.personId) })), overtime: db.prepare("SELECT id, person_id, work_date, overtime_minutes FROM attendance_days WHERE overtime_status='pending' ORDER BY work_date").all().map(r => ({ id: String(r.id), name: who(String(r.person_id)), workDate: String(r.work_date), minutes: Number(r.overtime_minutes) })), days: db.prepare('SELECT * FROM attendance_days WHERE work_date LIKE ? ORDER BY work_date DESC, person_id LIMIT 400').all(`${m}-%`).map(r => ({ id: String(r.id), name: who(String(r.person_id)), workDate: String(r.work_date), checkIn: (r.check_in as string) ?? null, checkOut: (r.check_out as string) ?? null, status: String(r.status), lateMinutes: Number(r.late_minutes), workedMinutes: Number(r.worked_minutes) })) }; });
  s.post('/api/attendance/leave', async (q) => { const b = body(q); return app.attendance.requestLeave(me(q), { date: String(b.date ?? ''), type: b.type === 'permission' ? 'permission' : 'leave', reason: reason(b) }); });
  s.post('/api/attendance/leave/:id/decide', async (q) => { const b = body(q); return app.attendance.decideLeave(me(q), param(q, 'id'), b.approve === true, str(b.note)); });
  s.post('/api/attendance/days/:id/overtime', async (q) => { const b = body(q); return app.attendance.decideOvertime(me(q), param(q, 'id'), b.approve === true, str(b.note)); });
  s.post('/api/attendance/days/:id/correct', async (q) => { const b = body(q); return app.attendance.correct(me(q), param(q, 'id'), { checkIn: str(b.checkIn), checkOut: b.checkOut === null ? null : str(b.checkOut), reason: reason(b) }); });
  s.post('/api/attendance/schedule', async (q) => { const b = body(q); app.attendance.setSchedule(me(q), String(b.personId ?? ''), Array.isArray(b.shifts) ? (b.shifts as ShiftInput[]) : [], String(b.effectiveFrom ?? '')); return { ok: true }; });
  s.post('/api/attendance/absences', async (q) => { const b = body(q); return { marked: app.attendance.markAbsences(me(q), String(b.date ?? ''), Array.isArray(b.people) ? (b.people as string[]) : []) }; });

  // ---------- alert centre ----------
  s.get('/api/alerts', async (q) => {
    const p = me(q); if (lead(p) && can(p, 'notification.send', app.hub.branchId)) { const managers = db.prepare("SELECT id FROM people WHERE active=1 AND (roles_json LIKE '%\"O\"%' OR roles_json LIKE '%\"A\"%' OR roles_json LIKE '%\"M\"%')").all().map(r => String(r.id)); app.alerts.scan(p, managers); }
    const x = qs(q); return { alerts: app.alerts.inbox(p, { category: str(x.category) as AlertCategory | undefined, unreadOnly: x.unread === '1', limit: 100 }), unread: app.alerts.unread(p) };
  });
  s.post('/api/alerts/:id/read', async (q) => { app.alerts.markRead(me(q), param(q, 'id')); return { ok: true }; });
  s.post('/api/alerts/read-all', async (q) => ({ marked: app.alerts.markAllRead(me(q), str(body(q).category) as AlertCategory | undefined) }));
}
