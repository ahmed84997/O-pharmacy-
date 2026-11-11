import { describe, expect, it } from 'vitest';
import { Hub, backoffMs, syncOnce, type RemoteEvent, type Transport } from './index';

const mv = (key: string, qty = 1) => ({ key, storeId: 'MAIN', itemId: 'i1', qty, kind: 'purchase', actor: 'u' }) as never;
const fake = (o: Partial<Transport> = {}): Transport => ({ push: async e => e.map(x => x.id), pull: async c => ({ events: [], cursor: c }), ...o });

describe('syncOnce', () => {
  it('pushes oldest first in batches and empties the outbox', async () => {
    const h = Hub.open('b1'); for (let i = 0; i < 7; i++) h.record(mv('k' + i));
    const expected = h.outboxPending().map(r => r.id);
    const sizes: number[] = []; const order: string[] = [];
    const r = await syncOnce(h, fake({ push: async e => { sizes.push(e.length); order.push(...e.map(x => x.id)); return e.map(x => x.id); } }), { batch: 3 });
    expect(r).toMatchObject({ ok: true, pushed: 7 }); expect(sizes).toEqual([3, 3, 1]); expect(h.outboxPending()).toHaveLength(0);
    expect(order).toEqual(expected); // outbox order (seq) is creation order
    expect(h.syncStatus()).toMatchObject({ pending: 0 }); expect(h.syncStatus().lastSuccessAt).not.toBeNull();
  });
  it('offline: nothing is lost, attempts counted, local work continues, later catches up', async () => {
    const h = Hub.open('b1'); h.record(mv('k1'));
    const down: Transport = fake({ push: async () => { throw new Error('network down'); } });
    expect(await syncOnce(h, down)).toMatchObject({ ok: false, error: 'network down' });
    expect(h.outboxPending()[0]!.attempts).toBe(1);
    h.record(mv('k2')); expect(h.balance('i1')).toBe(2); expect(h.syncStatus().pending).toBe(2); expect(h.syncStatus().lastSuccessAt).toBeNull();
    expect(await syncOnce(h, fake())).toMatchObject({ ok: true, pushed: 2 }); expect(h.syncStatus().pending).toBe(0);
  });
  it('partial acknowledgement keeps the rest for the next round', async () => {
    const h = Hub.open('b1'); h.record(mv('a')); h.record(mv('b')); h.record(mv('c'));
    const r = await syncOnce(h, fake({ push: async e => [e[0]!.id] }));
    expect(r).toMatchObject({ ok: false, pushed: 1, error: 'partial acknowledgement' }); expect(h.outboxPending()).toHaveLength(2);
  });
  it('ignores acknowledgements for ids it did not send', async () => {
    const h = Hub.open('b1'); h.record(mv('a'));
    await syncOnce(h, fake({ push: async () => ['not-mine'] })); expect(h.outboxPending()).toHaveLength(1);
  });
  it('pull stores events and cursor together, pages, skips own events, and is idempotent', async () => {
    const h = Hub.open('b1'); const mk = (n: number, br = 'b2'): RemoteEvent => ({ id: `e${n}`, type: 'stock.moved', branchId: br, payload: { n }, createdAt: new Date().toISOString(), cseq: n });
    const all = [mk(1), mk(2), mk(3), mk(4, 'b1'), mk(5)];
    const t = fake({ pull: async (c, l) => { const ev = all.filter(e => e.cseq > c).slice(0, l); return { events: ev, cursor: ev.length ? ev[ev.length - 1]!.cseq : c }; } });
    expect(await syncOnce(h, t, { batch: 2 })).toMatchObject({ ok: true, pulled: 4 });
    expect(h.remoteEvents().map(e => e.id)).toEqual(['e1', 'e2', 'e3', 'e5']); expect(h.remoteCursor()).toBe(5);
    expect(await syncOnce(h, t)).toMatchObject({ pulled: 0 }); expect(h.applyRemote([mk(1)], 1)).toBe(0);
  });
  it('a failed pull does not move the cursor', async () => {
    const h = Hub.open('b1'); let n = 0;
    const t = fake({ pull: async () => { if (n++ === 0) return { events: [{ id: 'x', type: 't', branchId: 'b2', payload: {}, createdAt: new Date().toISOString(), cseq: 3 }], cursor: 3 }; throw new Error('boom'); }, });
    const r = await syncOnce(h, t, { batch: 1 }); expect(r.ok).toBe(false); expect(h.remoteCursor()).toBe(3); expect(h.remoteEvents()).toHaveLength(1);
  });
  it('remote events are append-only too', () => {
    const h = Hub.open('b1'); h.applyRemote([{ id: 'x', type: 't', branchId: 'b2', payload: {}, createdAt: new Date().toISOString(), cseq: 1 }], 1);
    expect(() => h.db.exec('DELETE FROM remote_events')).toThrow(); expect(() => h.db.exec("UPDATE remote_events SET type='z'")).toThrow();
  });
});

describe('backoff', () => {
  it('grows, is capped, and jitters within half to full', () => {
    expect(backoffMs(1, 1000, 60000, () => 1)).toBe(1000); expect(backoffMs(1, 1000, 60000, () => 0)).toBe(500);
    expect(backoffMs(4, 1000, 60000, () => 1)).toBe(8000); expect(backoffMs(30, 1000, 60000, () => 1)).toBe(60000); expect(backoffMs(0, 1000, 60000, () => 1)).toBe(1000);
  });
});
