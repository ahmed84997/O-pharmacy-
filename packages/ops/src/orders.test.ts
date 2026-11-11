import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS, PurchasingService } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { NotificationService, OPS_MIGRATIONS, OpsError, OrderStageService, RequestService } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const keeper: Person = { id: 'sk', roles: ['S'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as OpsError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `ok${++n}`;
const prep = () => {
  const clock = { t: Date.parse('2026-12-01T10:00:00Z') };
  const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), [...MIGRATIONS, ...POS_MIGRATIONS, ...OPS_MIGRATIONS]);
  const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); const pu = new PurchasingService(hub, items, bs);
  const rs = new RequestService(hub, items); const os = new OrderStageService(hub, rs); const ns = new NotificationService(hub, rs);
  const a = items.create(owner, { nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }] }); const c = new CustomerService(hub, new SaleService(hub, items, bs)).create(owner, { name: 'أحمد علي', phone: '01001234567' });
  const sup = pu.createSupplier(mgr, { name: 'المتحدة' });
  const po = () => { const o = pu.createOrder(ph, { key: key(), supplierId: sup.id, lines: [{ itemId: a.id, qty: 5, unitName: 'حبة' }] } as never); pu.sendOrder(ph, o.id); return o; };
  const cust = () => rs.createRequest(ph, { key: key(), customerId: c.id, items: [{ itemId: a.id, qty: 2 }, { itemName: 'فيتامين سي' }] } as never).request;
  const short = () => rs.createShortage(ph, { key: key(), items: [{ itemId: a.id }] } as never).request;
  return { hub, clock, rs, os, ns, pu, a, sup, po, cust, short };
};
const status = (s: ReturnType<typeof prep>, id: string) => s.rs.get(owner, id).items.map(i => i.status);

describe('order stages', () => {
  it('links items, stamps each stage once and in order with minutes since the previous one', () => {
    const s = prep(); const o = s.po(); const r = s.cust(); const [i1, i2] = r.items;
    s.os.link(ph, i1!.id, o.id); s.os.link(ph, i2!.id, o.id); expect(status(s, r.id)).toEqual(['ordered', 'ordered']);
    expect(code(() => s.os.link(ph, i1!.id, o.id))).toBe('duplicate');
    expect(code(() => s.os.receive(keeper, o.id))).toBe('state'); // ordered stage first
    s.os.markOrdered(ph, o.id); s.clock.t += 90 * 60000; const st = s.os.receive(keeper, o.id);
    expect(st.map(x => [x.stage, x.minutesSincePrev])).toEqual([['ordered', null], ['received', 90]]); expect(status(s, r.id)).toEqual(['awaiting_verification', 'awaiting_verification']);
    expect(code(() => s.os.receive(keeper, o.id))).toBe('state'); expect(code(() => s.os.link(ph, s.cust().items[0]!.id, o.id))).toBe('state');
    expect(code(() => s.os.markLabelled(keeper, o.id))).toBe('state'); expect(s.os.open(mgr)).toEqual([{ poNo: expect.any(String), waitingFor: 'counted', sinceMinutes: 0 }]);
    expect(() => s.hub.db.exec('UPDATE order_stages SET by=1')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM order_stages')).toThrow();
  });
  it('counting: arrived goes to the customer or to stock, missing or damaged goes back to be bought with a reason', () => {
    const s = prep(); const o = s.po(); const r = s.cust(); const sh = s.short(); const ids = [r.items[0]!.id, r.items[1]!.id, sh.items[0]!.id];
    for (const i of ids) s.os.link(ph, i, o.id); s.os.markOrdered(ph, o.id); s.os.receive(keeper, o.id);
    expect(code(() => s.os.count(keeper, o.id, [{ requestItemId: ids[0]!, result: 'arrived' }]))).toBe('invalid'); // every item needs a result
    expect(code(() => s.os.count(keeper, o.id, [{ requestItemId: ids[0]!, result: 'arrived' }, { requestItemId: ids[1]!, result: 'damaged' }, { requestItemId: ids[2]!, result: 'arrived' }]))).toBe('invalid'); // note
    expect(code(() => s.os.count(cashier, o.id, []))).toBe('forbidden');
    s.os.count(keeper, o.id, [{ requestItemId: ids[0]!, result: 'arrived' }, { requestItemId: ids[1]!, result: 'damaged', note: 'علبة مكسورة' }, { requestItemId: ids[2]!, result: 'arrived' }]);
    expect(status(s, r.id)).toEqual(['ready_to_notify', 'pending_purchase']); expect(status(s, sh.id)).toEqual(['stocked']);
    expect(s.rs.timeline(owner, r.id).some(e => e.reason === 'damaged: علبة مكسورة')).toBe(true); expect(s.hub.db.prepare('SELECT COUNT(*) c FROM count_results').get()?.c).toBe(3);
    expect(code(() => s.os.count(keeper, o.id, []))).toBe('state'); // counted only once
  });
  it('entered needs a posted invoice on the order; then labelled and shelved finish the list', () => {
    const s = prep(); const o = s.po(); const r = s.cust(); s.os.link(ph, r.items[0]!.id, o.id); s.os.markOrdered(ph, o.id); s.os.receive(keeper, o.id); s.os.count(keeper, o.id, [{ requestItemId: r.items[0]!.id, result: 'arrived' }]);
    expect(code(() => s.os.markEntered(keeper, o.id))).toBe('state');
    const inv = s.pu.postInvoice(keeper, { key: key(), supplierId: s.sup.id, poId: o.id, lines: [{ itemId: s.a.id, lot: 'L1', expiry: '2027-06-30', qty: 5, unitName: 'حبة', costMinor: 100, publicPriceMinor: 150, pharmacistPriceMinor: 140 }] } as never);
    s.clock.t += 5 * 60000; s.os.markEntered(keeper, o.id); s.os.markLabelled(keeper, o.id); const all = s.os.markShelved(keeper, o.id);
    expect(all.map(x => x.stage)).toEqual(['ordered', 'received', 'counted', 'entered', 'labelled', 'shelved']); expect(inv.id).toBeTruthy(); expect(s.os.open(mgr)).toEqual([]);
  });
});

describe('notifications', () => {
  it('lists customer items to tell, records who told them and how, and never for a shortage', () => {
    const s = prep(); const o = s.po(); const r = s.cust(); const sh = s.short(); const ids = [r.items[0]!.id, sh.items[0]!.id];
    for (const i of ids) s.os.link(ph, i, o.id); s.os.markOrdered(ph, o.id); s.os.receive(keeper, o.id); s.os.count(keeper, o.id, ids.map(requestItemId => ({ requestItemId, result: 'arrived' as const })));
    const q = s.ns.toNotify(ph); expect(q).toHaveLength(1); expect(q[0]).toMatchObject({ customerName: 'أحمد علي', phone: '01001234567', itemName: 'باراسيتامول 500' }); expect(q[0]!.message).toContain('أحمد علي');
    expect(code(() => s.ns.toNotify(cashier))).toBe('no error'); expect(code(() => s.ns.notify(ph, sh.items[0]!.id, 'phone'))).toBe('invalid');
    const sent = s.ns.notify(ph, ids[0]!, 'whatsapp'); expect(sent.body).toContain('جاهز للاستلام'); expect(status(s, r.id)[0]).toBe('notified');
    expect(s.ns.toNotify(ph)).toEqual([]); expect(s.ns.history(ph, ids[0]!)).toMatchObject([{ channel: 'whatsapp', by: 'ph' }]); expect(code(() => s.ns.notify(ph, ids[0]!, 'phone'))).toBe('state');
    expect(() => s.hub.db.exec('DELETE FROM notifications')).toThrow();
  });
});
