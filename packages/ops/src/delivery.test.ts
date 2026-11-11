import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { DeliveryService, OPS_MIGRATIONS, OpsError, RequestService, TaskService, type ItemState } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as OpsError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `dk${++n}`;
const prep = () => {
  const clock = { t: Date.parse('2026-12-01T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), [...MIGRATIONS, ...POS_MIGRATIONS, ...OPS_MIGRATIONS]);
  const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); const rs = new RequestService(hub, items); const ds = new DeliveryService(hub, rs); const ts = new TaskService(hub);
  const c = new CustomerService(hub, new SaleService(hub, items, bs)).create(owner, { name: 'أحمد علي', phone: '01001234567' });
  const toNotified = () => { const r = rs.createRequest(ph, { key: key(), customerId: c.id, items: [{ itemName: 'فيتامين سي' }] } as never).request; const id = r.items[0]!.id; for (const s of ['ordered', 'awaiting_verification', 'ready_to_notify', 'notified'] as ItemState[]) rs.move(ph, id, s); return { r, id }; };
  return { hub, clock, rs, ds, ts, toNotified };
};
const st = (s: ReturnType<typeof prep>, id: string) => s.rs.get(owner, id).items[0]!.status;

describe('delivery and pickup', () => {
  it('counter pickup: delivered needs the receiver; home delivery needs an address, can fail and be retried', () => {
    const s = prep(); const a = s.toNotified();
    expect(code(() => s.ds.deliver(ph, a.id, { receiver: ' ' }))).toBe('invalid'); s.ds.deliver(ph, a.id, { receiver: 'أحمد علي' }); expect(st(s, a.r.id)).toBe('delivered'); expect(s.ds.history(ph, a.id)).toMatchObject([{ step: 'delivered', method: 'pickup', receiver: 'أحمد علي' }]);
    const b = s.toNotified(); expect(code(() => s.ds.dispatch(ph, b.id, { address: '' }))).toBe('invalid'); s.ds.dispatch(ph, b.id, { address: '12 شارع النيل' }); expect(st(s, b.r.id)).toBe('out_for_delivery');
    expect(s.ds.board(ph).outForDelivery).toHaveLength(1); expect(code(() => s.ds.failDelivery(ph, b.id, ''))).toBe('invalid'); s.ds.failDelivery(ph, b.id, 'مفيش حد في البيت'); expect(st(s, b.r.id)).toBe('notified');
    s.ds.dispatch(ph, b.id, { address: '12 شارع النيل' }); s.ds.deliver(ph, b.id, { receiver: 'الجار' }); expect(s.ds.history(ph, b.id).map(h => [h.step, h.method])).toEqual([['dispatched', 'home'], ['failed', null], ['dispatched', 'home'], ['delivered', 'home']]);
    expect(() => s.hub.db.exec('DELETE FROM item_handovers')).toThrow();
  });
  it('not collected after a wait, listed once it is old; reopening is for managers with a reason; a shortage is never handed over', () => {
    const s = prep(); const a = s.toNotified(); expect(s.ds.board(ph).waitingTooLong).toEqual([]); s.clock.t += 8 * 86400000; expect(s.ds.board(ph).waitingTooLong).toMatchObject([{ itemName: 'فيتامين سي' }]);
    expect(code(() => s.ds.markNotCollected(ph, a.id, ''))).toBe('invalid'); s.ds.markNotCollected(ph, a.id, 'العميل مردش'); expect(st(s, a.r.id)).toBe('not_collected');
    expect(code(() => s.ds.reopen(ph, a.id, 'x'))).toBe('forbidden'); expect(code(() => s.ds.reopen(mgr, a.id, ''))).toBe('invalid'); s.ds.reopen(mgr, a.id, 'العميل رجع'); expect(st(s, a.r.id)).toBe('notified');
    const sh = s.rs.createShortage(ph, { key: key(), items: [{ itemName: 'ناقص' }] } as never).request; expect(code(() => s.ds.deliver(ph, sh.items[0]!.id, { receiver: 'x' }))).toBe('invalid');
    expect(code(() => s.ds.deliver(keeper, a.id, { receiver: 'x' }))).toBe('forbidden');
  });
});

describe('staff tasks', () => {
  it('a manager creates and reassigns, the assignee sees and completes, a closed task never changes', () => {
    const s = prep(); const k = key(); const t = s.ts.create(mgr, { key: k, title: 'جرد رف التلاجة', assignedTo: 'ph', dueDate: '2026-12-02' });
    expect(t).toMatchObject({ taskNo: 'T-000001', status: 'open', assignedTo: 'ph' }); expect(s.ts.create(mgr, { key: k, title: 'جرد رف التلاجة', assignedTo: 'ph' }).id).toBe(t.id);
    expect(code(() => s.ts.create(ph, { key: key(), title: 'x', assignedTo: 'ph' }))).toBe('forbidden'); expect(code(() => s.ts.create(mgr, { key: key(), title: ' ', assignedTo: 'ph' }))).toBe('invalid'); expect(code(() => s.ts.create(mgr, { key: key(), title: 'x', assignedTo: 'ph', dueDate: '2/12' }))).toBe('invalid');
    expect(s.ts.mine(ph)).toHaveLength(1); expect(s.ts.mine(keeper)).toHaveLength(0); expect(code(() => s.ts.complete(keeper, t.id))).toBe('forbidden');
    s.ts.assign(mgr, t.id, 'sk'); expect(s.ts.mine(keeper)).toHaveLength(1); s.clock.t += 3 * 86400000; expect(s.ts.list(mgr)[0]).toMatchObject({ overdue: true });
    expect(s.ts.complete(keeper, t.id, 'تم').status).toBe('done'); expect(code(() => s.ts.complete(keeper, t.id))).toBe('state'); expect(code(() => s.ts.cancel(mgr, t.id, 'x'))).toBe('state'); expect(s.ts.list(mgr)[0]).toMatchObject({ overdue: false });
    expect(s.ts.history(mgr, t.id).map(e => e.action)).toEqual(['created', 'assigned', 'done']); expect(() => s.hub.db.exec("UPDATE staff_tasks SET title='y'")).toThrow(); expect(() => s.hub.db.exec('DELETE FROM staff_tasks')).toThrow();
  });
  it('cancel needs a reason and a manager', () => {
    const s = prep(); const t = s.ts.create(mgr, { key: key(), title: 'اتصل بالمورد', assignedTo: 'ph' }); expect(code(() => s.ts.cancel(mgr, t.id, ' '))).toBe('invalid'); expect(code(() => s.ts.cancel(ph, t.id, 'x'))).toBe('forbidden');
    expect(s.ts.cancel(mgr, t.id, 'اتلغى')).toMatchObject({ status: 'cancelled', closeNote: 'اتلغى' }); expect(s.ts.mine(ph)).toEqual([]);
  });
});
