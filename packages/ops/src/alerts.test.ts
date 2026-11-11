import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { AiService, AlertService, AttendanceService, FakeAiProvider, OPS_MIGRATIONS, OpsError, RequestService, TaskService, type ItemState } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as OpsError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `ak${++n}`;
const prep = (provider = new FakeAiProvider('• متابعة العملاء\n• المهام')) => {
  const clock = { t: Date.parse('2026-12-01T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), [...MIGRATIONS, ...POS_MIGRATIONS, ...OPS_MIGRATIONS]);
  const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); const rs = new RequestService(hub, items); const al = new AlertService(hub); const ai = new AiService(hub, provider); const ts = new TaskService(hub); const at = new AttendanceService(hub);
  const c = new CustomerService(hub, new SaleService(hub, items, bs)).create(owner, { name: 'أحمد علي', phone: '01001234567' });
  const ready = () => { const r = rs.createRequest(ph, { key: key(), customerId: c.id, items: [{ itemName: 'فيتامين سي' }] } as never).request; const id = r.items[0]!.id; for (const s of ['ordered', 'awaiting_verification', 'ready_to_notify'] as ItemState[]) rs.move(ph, id, s); return { r, id }; };
  return { hub, clock, rs, al, ai, ts, at, ready, provider };
};

describe('alerts', () => {
  it('scan finds what needs someone, once per thing and person; the inbox is private, readable, never deleted', () => {
    const s = prep(); const a = s.ready(); s.ts.create(mgr, { key: key(), title: 'جرد', assignedTo: 'sk', dueDate: '2026-12-01' }); s.at.setSchedule(mgr, 'ph', [], '2026-11-01'); s.at.checkIn(ph);
    expect(s.al.scan(mgr, ['mg'])).toEqual({}); s.clock.t += 5 * 3600000; // 15:00: customer waiting 5 h, shift open 5 h
    s.clock.t += 24 * 3600000; // next day: task overdue, shift open 29 h
    const made = s.al.scan(mgr, ['mg', 'owner']); expect(made).toEqual({ customer_requests: 1, tasks: 1, attendance: 2 }); expect(s.al.scan(mgr, ['mg', 'owner'])).toEqual({});
    expect(s.al.inbox(ph)).toMatchObject([{ category: 'customer_requests', title: expect.stringContaining('فيتامين سي'), read: false }]); expect(s.al.inbox(keeper)).toMatchObject([{ category: 'tasks' }]); expect(s.al.unread(mgr)).toEqual({ attendance: 1 });
    const one = s.al.inbox(ph)[0]!; expect(code(() => s.al.markRead(keeper, one.id))).toBe('not-found'); s.al.markRead(ph, one.id); expect(s.al.unread(ph)).toEqual({}); expect(s.al.inbox(ph, { unreadOnly: true })).toEqual([]);
    expect(s.al.markAllRead(owner)).toBe(1); expect(a.id).toBeTruthy(); expect(() => s.hub.db.exec('DELETE FROM alerts')).toThrow(); expect(() => s.hub.db.exec("UPDATE alerts SET title='x'")).toThrow();
  });
  it('only a manager runs the scan', () => { const s = prep(); expect(code(() => s.al.scan(ph, []))).toBe('forbidden'); expect(code(() => s.al.scan(cashier, []))).toBe('forbidden'); });
});

describe('AI assistant', () => {
  it('sends only aggregates and item names, records every run, and enforces the daily limit', async () => {
    const s = prep(); s.ready(); s.rs.createShortage(ph, { key: key(), items: [{ itemName: 'أوجمنتين' }] } as never); const r = await s.ai.assist(ph, 'day_summary'); expect(r.text).toContain('متابعة');
    const sent = s.provider.calls[0]!.user; expect(sent).toContain('ready_to_notify'); expect(sent).toContain('أوجمنتين'); expect(sent).not.toContain('أحمد'); expect(sent).not.toContain('0100'); expect(sent).not.toContain('ph');
    await s.ai.assist(ph, 'shortage_insight'); expect(s.ai.runs(ph)).toMatchObject([{ kind: 'shortage_insight', status: 'ok', model: 'fake' }, { kind: 'day_summary' }]);
    await expect(s.ai.assist(cashier, 'day_summary')).rejects.toMatchObject({ code: 'forbidden' }); expect(() => s.hub.db.exec("UPDATE ai_runs SET output='x'")).toThrow();
    const small = new AiService(s.hub, s.provider, { dailyLimit: 2, timeZone: 'Africa/Cairo' }); await expect(small.assist(ph, 'day_summary')).rejects.toMatchObject({ code: 'state' });
  });
  it('a provider failure is recorded and reported, and still counts toward the limit', async () => {
    const s = prep(new FakeAiProvider('x', 'fake', true)); await expect(s.ai.assist(ph, 'day_summary')).rejects.toMatchObject({ code: 'state' }); expect(s.ai.runs(ph)).toMatchObject([{ status: 'failed' }]);
    expect(s.hub.db.prepare('SELECT error FROM ai_runs').get()?.error).toBe('provider down');
  });
});
