import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';

let n = 0; const key = () => `ops-key-${++n}-${Date.now()}`;
const prep = async () => {
  const clock = { t: Date.parse('2026-12-10T07:00:00Z') }; const app = openApp({ clock: () => new Date(clock.t), testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const call = async (method: string, url: string, token: string, b?: unknown) => { const x = await f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${token}` } }); return { status: x.statusCode, body: JSON.parse(x.body || 'null') }; };
  const owner = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': dev }, payload: { pharmacyName: 'ص', displayName: 'المالك', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  await call('POST', '/api/test/seed', owner); const login = async (u: string) => (await f.inject({ method: 'POST', url: '/api/login', headers: { 'x-device': dev }, payload: { username: u, secret: 'staff-pass-1' } })).json().token as string;
  return { app, clock, call, owner, ph: await login('pharmacist'), mgr: await login('manager'), cs: await login('cashier'), sk: await login('storekeeper') };
};

describe('customers', () => {
  it('adds a customer, sets a credit limit with a reason, takes a payment into the open drawer and shows the statement', async () => {
    const s = await prep(); const c = (await s.call('POST', '/api/customers', s.ph, { name: 'سامي فتحي', phone: '01001234567' })).body; expect(c.code).toBeTruthy();
    expect((await s.call('POST', `/api/customers/${c.id}/limit`, s.ph, { limitMinor: 100000, reason: 'x' })).status).toBe(403);
    expect((await s.call('POST', `/api/customers/${c.id}/limit`, s.mgr, { limitMinor: 100000, reason: 'عميل قديم' })).body.creditLimitMinor).toBe(100000);
    await s.call('POST', `/api/customers/${c.id}/opening`, s.owner, { amountMinor: 30000, note: 'رصيد من eStock' });
    expect((await s.call('POST', `/api/customers/${c.id}/payments`, s.mgr, { key: key(), amountMinor: 10000 })).body.error).toBe('state');
    await s.call('POST', '/api/pos/session/open', s.mgr, { key: key(), openingFloatMinor: 0 });
    expect((await s.call('POST', `/api/customers/${c.id}/payments`, s.mgr, { key: key(), amountMinor: 10000 })).body.balanceMinor).toBe(20000);
    const st = (await s.call('GET', `/api/customers/${c.id}/statement`, s.mgr)).body; expect(st.closing).toBe(20000); expect(st.lines).toHaveLength(2);
    expect((await s.call('GET', '/api/customers?owing=1', s.mgr)).body.customers.map((x: { id: string }) => x.id)).toContain(c.id);
  });
});

describe('requests, stages, tasks, attendance, alerts', () => {
  it('runs a customer request from order to delivery, a shortage, a task, a day of attendance and the alert centre', async () => {
    const s = await prep(); const c = (await s.call('POST', '/api/customers', s.ph, { name: 'منى علي', phone: '01112345678' })).body;
    const rq = (await s.call('POST', '/api/requests', s.ph, { key: key(), customerId: c.id, items: [{ itemName: 'دواء ناقص 10 مجم', qty: 2 }] })).body; expect(rq.ref).toMatch(/^CR-/);
    const item = rq.items[0]; const step = async (to: string, reason?: string) => (await s.call('POST', `/api/request-items/${item.id}/move`, s.ph, { to, reason })).body;
    expect((await step('ordered')).status).toBe('ordered'); expect((await step('awaiting_verification')).status).toBe('awaiting_verification');
    expect((await step('ready_to_notify')).status).toBe('ready_to_notify');
    expect((await s.call('GET', '/api/notify/todo', s.ph)).body.todo[0].message).toContain('منى علي');
    const nt = (await s.call('POST', `/api/request-items/${item.id}/notify`, s.ph, { channel: 'whatsapp' })).body; expect(nt.body).toContain('O Pharmacy');
    await s.call('POST', `/api/request-items/${item.id}/dispatch`, s.ph, { address: 'شارع النيل' }); await s.call('POST', `/api/request-items/${item.id}/deliver`, s.ph, { receiver: 'منى' });
    const view = (await s.call('GET', `/api/requests/${rq.ref}`, s.ph)).body; expect(view.request.status).toBe('completed'); expect(view.timeline.length).toBeGreaterThan(4);
    const sh = (await s.call('POST', '/api/requests', s.cs, { key: key(), kind: 'shortage', items: [{ itemName: 'شاش', qty: 5 }] })).body; expect(sh.ref).toMatch(/^NQ-/);
    expect((await s.call('GET', '/api/requests?kind=shortage', s.mgr)).body.requests).toHaveLength(1);
    const people = (await s.call('GET', '/api/people/brief', s.mgr)).body.people; const skId = people.find((p: { roles: string[] }) => p.roles.includes('S')).id;
    const t = (await s.call('POST', '/api/tasks', s.mgr, { key: key(), title: 'رتّب رف الفيتامينات', assignedTo: skId, dueDate: '2026-12-09' })).body; expect(t.taskNo).toMatch(/^T-/);
    expect((await s.call('GET', '/api/tasks', s.sk)).body.tasks[0]).toMatchObject({ title: 'رتّب رف الفيتامينات', overdue: true });
    expect((await s.call('POST', `/api/tasks/${t.id}/complete`, s.sk, { note: 'تم' })).body.status).toBe('done');
    const cin = (await s.call('POST', '/api/attendance/check-in', s.cs)).body; expect(cin.checkIn).toBeTruthy(); s.clock.t += 9 * 3600000; const out = (await s.call('POST', '/api/attendance/check-out', s.cs)).body; expect(out.workedMinutes).toBe(540);
    expect((await s.call('GET', '/api/attendance/mine?month=2026-12', s.cs)).body.days).toHaveLength(1); expect((await s.call('GET', '/api/attendance/team?month=2026-12', s.cs)).status).toBe(403);
    const team = (await s.call('GET', '/api/attendance/team?month=2026-12', s.mgr)).body; expect(team.days[0].name).toBe('كاشير (تجريبي)');
    await s.call('POST', '/api/attendance/leave', s.cs, { date: '2026-12-20', type: 'leave', reason: 'ظرف عائلي' });
    const al = (await s.call('GET', '/api/alerts', s.mgr)).body; expect(al.alerts.length).toBeGreaterThan(0); expect(al.unread.attendance).toBeGreaterThan(0);
    expect((await s.call('POST', '/api/alerts/read-all', s.mgr, {})).body.marked).toBeGreaterThan(0);
  });
});
