import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { BatchService } from '@o-pharmacy/inventory';
import { ITEM_MACHINE, ITEM_STATES, OPS_MIGRATIONS, OpsError, RequestService, deriveStatus, type ItemState } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const ph2: Person = { id: 'ph2', roles: ['P'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as OpsError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `rk${++n}`;
const prep = () => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS, ...OPS_MIGRATIONS]); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' } as never); const sales = new SaleService(hub, items, bs); const cust = new CustomerService(hub, sales);
  const a = items.create(owner, { nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }] }); const c = cust.create(owner, { name: 'أحمد علي', phone: '01001234567' }); const rs = new RequestService(hub, items);
  const req = (o: Record<string, unknown> = {}) => rs.createRequest(ph, { key: key(), customerId: c.id, items: [{ itemId: a.id, qty: 2 }, { itemName: 'فيتامين سي' }], ...o } as never).request;
  return { hub, rs, a, c, req, items };
};
const st = (s: ReturnType<typeof prep>, id: string) => s.rs.get(owner, id).items.map(i => i.status);

describe('the item machine', () => {
  it('13 states; no ordered to pending_purchase; terminals have no way out except the reviewed corrections; the header status is derived from the items', () => {
    expect(ITEM_STATES).toHaveLength(13); expect(ITEM_MACHINE.can('ordered', 'pending_purchase')).toBe(false); expect(ITEM_MACHINE.next('cancelled')).toEqual([]); expect(ITEM_MACHINE.next('stocked')).toEqual([]); expect(ITEM_MACHINE.next('delivered')).toEqual(['notified']); expect(ITEM_MACHINE.next('closed_unavailable')).toEqual(['unavailable']); expect(ITEM_MACHINE.can('out_for_delivery', 'notified')).toBe(true);
    const d = (...s: ItemState[]) => deriveStatus(s); expect(d('pending_purchase', 'delivered')).toBe('partially_fulfilled'); expect(d('delivered', 'stocked')).toBe('completed'); expect(d('cancelled', 'cancelled')).toBe('closed'); expect(d('delivered', 'not_collected')).toBe('mixed_closed'); expect(d('delivered', 'cancelled')).toBe('completed'); expect(d('not_collected', 'closed_unavailable')).toBe('closed'); expect(d('ordered')).toBe('open'); expect(d()).toBe('open');
  });
});

describe('creating requests and shortages', () => {
  it('a customer request gets CR-, a shortage NQ-; items start at pending_purchase; names come from the catalogue or are typed; the same key is the same request', () => {
    const s = prep(); const r = s.rs.createRequest(ph, { key: 'k1', customerId: s.c.id, notes: ' جاى بكره ', items: [{ itemId: s.a.id, qty: 2 }, { itemName: 'فيتامين سي' }] }); expect(r.replay).toBe(false); expect(r.request).toMatchObject({ ref: 'CR-000001', kind: 'customer_request', customerName: 'أحمد علي', ownerId: 'ph', notes: 'جاى بكره', status: 'open' }); expect(r.request.items.map(i => [i.itemName, i.qty, i.status])).toEqual([['باراسيتامول 500', 2, 'pending_purchase'], ['فيتامين سي', 1, 'pending_purchase']]);
    expect(s.rs.createRequest(ph, { key: 'k1', customerId: s.c.id, items: [{ itemName: 'x' }] })).toMatchObject({ replay: true, request: { ref: 'CR-000001' } }); const sh = s.rs.createShortage(keeper, { key: key(), items: [{ itemId: s.a.id }] }).request; expect(sh).toMatchObject({ ref: 'NQ-000001', kind: 'shortage', customerId: null });
    expect(s.rs.createShortage(keeper, { key: key(), items: [{ itemName: 'y' }] }).request.ref).toBe('NQ-000002'); expect(s.req().ref).toBe('CR-000002');
  });
  it('rules: customer, items, quantity, permissions; only a manager gives a request to someone else', () => {
    const s = prep(); const mk = (o: Record<string, unknown>) => () => s.rs.createRequest(ph, { key: key(), customerId: s.c.id, items: [{ itemName: 'x' }], ...o } as never);
    expect(code(mk({ customerId: 'nope' }))).toBe('not-found'); expect(code(mk({ customerId: undefined }))).toBe('invalid'); expect(code(mk({ items: [] }))).toBe('invalid'); expect(code(mk({ items: [{ itemName: ' ' }] }))).toBe('invalid'); expect(code(mk({ items: [{ itemName: 'x', qty: 0 }] }))).toBe('invalid'); expect(code(mk({ items: [{ itemId: 'zz' }] }))).toBe('not-found');
    expect(code(() => s.rs.createRequest(keeper, { key: key(), customerId: s.c.id, items: [{ itemName: 'x' }] }))).toBe('forbidden'); expect(code(mk({ ownerId: 'ph2' }))).toBe('forbidden'); expect(s.rs.createRequest(mgr, { key: key(), customerId: s.c.id, ownerId: 'ph2', items: [{ itemName: 'x' }] }).request.ownerId).toBe('ph2');
  });
  it('add an item later; update notes; the owner changes only by a manager; what was asked for never changes; nothing is deleted', () => {
    const s = prep(); const r = s.req(); expect(s.rs.addItem(ph, r.id, { itemName: 'كريم' }).items).toHaveLength(3); expect(s.rs.updateRequest(ph, r.id, { notes: 'غيرت الرقم' }).notes).toBe('غيرت الرقم'); expect(code(() => s.rs.updateRequest(ph, r.id, { ownerId: 'ph2' }))).toBe('forbidden'); expect(s.rs.updateRequest(mgr, r.id, { ownerId: 'ph2' }).ownerId).toBe('ph2');
    expect(() => s.hub.db.prepare("UPDATE request_items SET qty=9").run()).toThrow(); expect(() => s.hub.db.prepare("UPDATE request_items SET item_name='z'").run()).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM request_items').run()).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM requests').run()).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM request_item_events').run()).toThrow();
  });
});

describe('cancelling and unavailable', () => {
  it('cancel needs customer_request.cancel and a reason; a cancelled item is final; cancelling a whole request skips finished items; the header turns closed', () => {
    const s = prep(); const r = s.req(); const [a, b] = r.items; expect(code(() => s.rs.cancelItem(ph, a!.id, ' '))).toBe('invalid'); expect(code(() => s.rs.cancelItem(keeper, a!.id, 'x'))).toBe('forbidden'); s.rs.cancelItem(ph, a!.id, 'customer changed his mind'); expect(st(s, r.id)).toEqual(['cancelled', 'pending_purchase']); expect(code(() => s.rs.cancelItem(ph, a!.id, 'again'))).toBe('state'); expect(s.rs.get(owner, r.id).status).toBe('open');
    s.rs.move(ph, b!.id, 'ordered'); expect(s.rs.cancelRequest(mgr, r.id, 'customer left').status).toBe('closed'); expect(code(() => s.rs.cancelRequest(mgr, r.id, 'again'))).toBe('state'); expect(st(s, r.id)).toEqual(['cancelled', 'cancelled']);
  });
  it('unavailable from the supplier: back to be ordered when it turns up; closing a customer item needs the customer told; a manager reopens a closed one; every step keeps who and why', () => {
    const s = prep(); const r = s.req(); const it = r.items[0]!.id; s.rs.markUnavailable(ph, it, 'company says out of production'); expect(code(() => s.rs.markUnavailable(ph, it, 'again'))).toBe('state'); s.rs.markAvailable(ph, it, 'supplier has it again'); expect(st(s, r.id)[0]).toBe('pending_purchase'); expect(code(() => s.rs.markAvailable(ph, it, 'x'))).toBe('state');
    s.rs.markUnavailable(ph, it, 'out again'); expect(code(() => s.rs.closeUnavailable(ph, it, { customerInformed: false, reason: 'closing' }))).toBe('invalid'); s.rs.closeUnavailable(ph, it, { customerInformed: true, reason: 'told him by phone' }); expect(st(s, r.id)[0]).toBe('closed_unavailable');
    expect(code(() => s.rs.reopenUnavailable(ph, it, 'x'))).toBe('forbidden'); s.rs.reopenUnavailable(mgr, it, 'he wants to wait'); expect(st(s, r.id)[0]).toBe('unavailable'); const sh = s.rs.createShortage(keeper, { key: key(), items: [{ itemName: 'z' }] }).request; s.rs.markUnavailable(keeper, sh.items[0]!.id, 'x'); s.rs.closeUnavailable(keeper, sh.items[0]!.id, { customerInformed: false, reason: 'nobody waiting' });
    expect(s.rs.timeline(owner, r.id).filter(e => e.type === 'event' && e.itemName === 'باراسيتامول 500').map(e => [e.from, e.to, e.reason, e.by])).toEqual([[null, 'pending_purchase', null, 'ph'], ['pending_purchase', 'unavailable', 'company says out of production', 'ph'], ['unavailable', 'pending_purchase', 'supplier has it again', 'ph'], ['pending_purchase', 'unavailable', 'out again', 'ph'], ['unavailable', 'closed_unavailable', 'told him by phone', 'ph'], ['closed_unavailable', 'unavailable', 'he wants to wait', 'mg']]);
  });
  it('the shared machine refuses anything not declared; undoing needs a reason', () => {
    const s = prep(); const r = s.req(); const it = r.items[0]!.id; expect(code(() => s.rs.move(ph, it, 'delivered'))).toBe('state'); expect(code(() => s.rs.move(ph, it, 'pending_purchase'))).toBe('state'); s.rs.move(ph, it, 'ordered'); expect(code(() => s.rs.move(ph, it, 'pending_purchase'))).toBe('state'); s.rs.move(ph, it, 'awaiting_verification'); expect(code(() => s.rs.move(ph, it, 'ordered'))).toBe('invalid'); expect(s.rs.move(ph, it, 'ordered', { reason: 'wrong delivery' }).status).toBe('ordered');
  });
});

describe('work, comments and reading', () => {
  it('claim: one person at a time, managers assign and release; finished items cannot be claimed', () => {
    const s = prep(); const r = s.req(); const it = r.items[0]!.id; s.rs.claim(ph, it); expect(code(() => s.rs.claim(ph2, it))).toBe('state'); expect(s.rs.claim(ph, it).assignedTo).toBe('ph'); expect(code(() => s.rs.release(ph2, it))).toBe('forbidden'); expect(code(() => s.rs.assign(ph, it, 'ph2'))).toBe('forbidden'); expect(s.rs.assign(mgr, it, 'ph2').assignedTo).toBe('ph2'); expect(s.rs.release(mgr, it).assignedTo).toBeNull(); expect(code(() => s.rs.release(ph, it))).toBe('state');
    s.rs.cancelItem(ph, it, 'x'); expect(code(() => s.rs.claim(ph2, it))).toBe('state');
  });
  it('comments are append-only and show in the timeline in order; my work lists open items I hold or own', () => {
    const s = prep(); const r = s.req(); s.rs.comment(ph, { requestId: r.id, body: 'اتصلت بيه' }); s.rs.comment(mgr, { requestId: r.id, itemId: r.items[1]!.id, body: 'الشركة هترد بكره' }); expect(code(() => s.rs.comment(ph, { requestId: r.id, body: ' ' }))).toBe('invalid'); expect(code(() => s.rs.comment(ph, { requestId: r.id, itemId: 'zz', body: 'x' }))).toBe('not-found'); expect(code(() => s.rs.comment(keeper, { requestId: r.id, body: 'x' }))).toBe('forbidden');
    const t = s.rs.timeline(owner, r.id); expect(t.filter(e => e.type === 'comment').map(e => [e.body, e.itemName, e.by])).toEqual([['اتصلت بيه', null, 'ph'], ['الشركة هترد بكره', 'فيتامين سي', 'mg']]); expect(() => s.hub.db.prepare("UPDATE request_comments SET body='x'").run()).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM request_comments').run()).toThrow();
    expect(s.rs.myWork(ph)).toHaveLength(2); s.rs.assign(mgr, r.items[0]!.id, 'ph2'); expect(s.rs.myWork(ph).map(w => w.item.itemName)).toEqual(['فيتامين سي']); expect(s.rs.myWork(ph2).map(w => [w.requestRef, w.customerName])).toEqual([['CR-000001', 'أحمد علي']]); expect(s.rs.myWork(keeper)).toEqual([]);
  });
  it('list and search by kind, derived status, owner, customer, reference, item name or customer name; shortages are for those who may see shortages', () => {
    const s = prep(); const r1 = s.req(); const r2 = s.req({ items: [{ itemName: 'كحول طبى' }] }); s.rs.createShortage(keeper, { key: key(), items: [{ itemName: 'سرنجة' }] }); s.rs.cancelRequest(ph, r2.id, 'x');
    expect(s.rs.list(owner).map(r => r.ref)).toEqual(['NQ-000001', 'CR-000002', 'CR-000001']); expect(s.rs.list(owner, { kind: 'shortage' }).map(r => r.ref)).toEqual(['NQ-000001']); expect(s.rs.list(owner, { status: 'closed' }).map(r => r.ref)).toEqual(['CR-000002']); expect(s.rs.list(owner, { status: 'open', kind: 'customer_request' }).map(r => r.ref)).toEqual(['CR-000001']);
    expect(s.rs.list(owner, { q: 'كحول' }).map(r => r.ref)).toEqual(['CR-000002']); expect(s.rs.list(owner, { q: 'CR-000001' })).toHaveLength(1); expect(s.rs.list(owner, { q: 'أحمد' }).map(r => r.ref)).toEqual(['CR-000002', 'CR-000001']); expect(s.rs.list(owner, { customerId: s.c.id })).toHaveLength(2); expect(s.rs.list(owner, { ownerId: 'nobody' })).toEqual([]);
    expect(r1.ref).toBe('CR-000001'); const nobody: Person = { id: 'n', roles: ['E'], branchIds: ['b1'], denies: ['shortage.view'] }; expect(s.rs.list(nobody, { kind: 'shortage' })).toEqual([]); expect(code(() => s.rs.get(keeper, 'CR-000001'))).toBe('forbidden');
  });
});
