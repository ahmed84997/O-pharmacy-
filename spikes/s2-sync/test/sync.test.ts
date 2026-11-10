import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from '../src/hub.js';
import { Cloud } from '../src/cloud.js';
import { Net, prng } from '../src/net.js';
import { Device } from '../src/device.js';

const ITEM = 'amoxicillin-500';

test('1. branch sells while the internet is down; everything reaches the cloud afterwards', async () => {
  const cloud = new Cloud(), net = new Net(); const hub = new Hub('A');
  hub.purchase('p1', ITEM, 100);
  net.up = false;
  for (let i = 0; i < 30; i++) assert.equal(hub.sell('s' + i, ITEM, 2).ok, true);
  await assert.rejects(() => hub.sync(cloud, net));
  assert.equal(hub.balance(ITEM), 40);
  assert.equal(cloud.balance('A', ITEM), 0);            // cloud knows nothing yet
  net.up = true;
  while (hub.unsynced()) await hub.sync(cloud, net);
  assert.equal(cloud.balance('A', ITEM), 40);
  assert.equal(cloud.movementCount(), hub.movementCount());
});

test('2. ack lost after the cloud applied the batch: retry does not double count', async () => {
  const cloud = new Cloud(), net = new Net(prng(7)); const hub = new Hub('A');
  hub.purchase('p1', ITEM, 50); hub.sell('s1', ITEM, 5);
  net.dropAck = 1;
  await assert.rejects(() => hub.sync(cloud, net));
  assert.equal(cloud.balance('A', ITEM), 45);            // applied, but Hub does not know
  assert.equal(hub.unsynced(), 2);
  net.dropAck = 0; net.dup = 1;                          // retry, and even delivered twice
  await hub.sync(cloud, net);
  assert.equal(cloud.balance('A', ITEM), 45);
  assert.equal(cloud.movementCount(), 2);
  assert.equal(hub.unsynced(), 0);
});

test('3. Hub crash in the middle of a sale rolls back; the device retry creates exactly one movement', () => {
  const hub = new Hub('A'); hub.purchase('p1', ITEM, 10);
  assert.throws(() => hub.sell('s1', ITEM, 3, true), /simulated crash/);
  assert.equal(hub.balance(ITEM), 10);                   // nothing half-written
  assert.equal(hub.sell('s1', ITEM, 3).ok, true);
  assert.equal(hub.sell('s1', ITEM, 3).ok, true);        // repeat of the same key
  assert.equal(hub.balance(ITEM), 7);
});

test('4. device cannot reach the Hub: it queues, then replays in order; LAN duplicates are ignored', () => {
  const hub = new Hub('A'); hub.purchase('p1', ITEM, 100);
  const d = new Device('till-2', hub, prng(3)); d.lanUp = false; d.lanDup = 1;
  for (let i = 0; i < 20; i++) d.submit({ key: 'd' + i, run: h => h.sell('d' + i, ITEM, 1) });
  assert.equal(d.queue.length, 20); assert.equal(hub.balance(ITEM), 100);
  d.lanUp = true; d.flush();
  assert.equal(d.queue.length, 0); assert.equal(hub.balance(ITEM), 80);
});

test('5. two tills sell the last unit at the same time: the Hub lets exactly one win', () => {
  const hub = new Hub('A'); hub.purchase('p1', ITEM, 1);
  const a = new Device('t1', hub), b = new Device('t2', hub);
  a.submit({ key: 'x', run: h => h.sell('x', ITEM, 1) });
  b.submit({ key: 'y', run: h => h.sell('y', ITEM, 1) });
  const ok = [a.results.get('x')!.ok, b.results.get('y')!.ok];
  assert.deepEqual(ok.sort(), [false, true]);
  assert.equal(hub.balance(ITEM), 0);
});

async function heal(hubs: Hub[], cloud: Cloud, net: Net) {
  net.up = true; net.dropAck = 0; net.dup = 0;
  for (let round = 0; round < 12; round++) {
    for (const h of hubs) {
      await h.sync(cloud, net);
      for (const t of h.pendingToDispatch()) h.acceptAndDispatch(t);
      for (const t of h.pendingToReceive()) h.receive(t);
    }
  }
  for (const h of hubs) await h.sync(cloud, net);
}

test('6. two branches offline, one transfer A -> B through the cloud; totals match', async () => {
  const cloud = new Cloud(), net = new Net(prng(11));
  const A = new Hub('A'), B = new Hub('B');
  A.purchase('pa', ITEM, 100); B.purchase('pb', ITEM, 10);
  net.up = false;
  for (let i = 0; i < 20; i++) { A.sell('sa' + i, ITEM, 1); B.sell('sb' + i, ITEM, 1); } // B oversells attempt: only 10 succeed
  assert.equal(B.balance(ITEM), 0);
  B.requestTransfer('T1', 'A', ITEM, 30);
  await heal([A, B], cloud, net);
  assert.equal(cloud.transferStatus('T1'), 'received');
  assert.equal(A.balance(ITEM), 100 - 20 - 30);
  assert.equal(B.balance(ITEM), 30);
  assert.equal(cloud.balance('A', ITEM), A.balance(ITEM));
  assert.equal(cloud.balance('B', ITEM), B.balance(ITEM));
  assert.deepEqual(cloud.transitSums(), { 'TRANSIT:T1': 0 });
  assert.equal(cloud.totalAllStores(ITEM), 110 - 20 - 10);   // purchases - successful sales
});

test('7. events arriving out of order at the cloud still project to the right status', () => {
  const cloud = new Cloud();
  const ev = (kind: string) => ({ id: kind + '1', kind, transfer: 'T9', from_branch: 'A', to_branch: 'B', item: ITEM, qty: 1, origin: 'A' });
  cloud.push({ movements: [], events: [ev('received')] });
  cloud.push({ movements: [], events: [ev('requested'), ev('dispatched')] });
  assert.equal(cloud.transferStatus('T9'), 'received');
});

// Randomised fault storm: random sales, purchases, transfers, link flaps, lost acks, duplicates, Hub crashes.
for (const seed of Array.from({ length: 150 }, (_, i) => i + 1)) {
  test(`8. fuzz seed ${seed}: invariants hold after healing`, async () => {
    const r = prng(seed), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const cloud = new Cloud(), net = new Net(prng(seed * 7919)); net.dropAck = 0.2; net.dup = 0.2;
    const names = ['A', 'B', 'C'], items = ['i1', 'i2'];
    const hubs = names.map(n => new Hub(n));
    let supply: Record<string, number> = { i1: 0, i2: 0 }, tCount = 0, k = 0;
    for (let step = 0; step < 250; step++) {
      const h = pick(hubs), item = pick(items), x = r();
      if (x < 0.15) { const q = 1 + Math.floor(r() * 20); h.purchase('p' + k++, item, q); supply[item] += q; }
      else if (x < 0.5) { const q = 1 + Math.floor(r() * 5); const key = 's' + k++; const res = h.sell(key, item, q); if (res.ok) supply[item] -= q; }
      else if (x < 0.55) { const key = 's' + k++; try { h.sell(key, item, 1, true); } catch { /* rolled back */ } }
      else if (x < 0.65) { const from = pick(names.filter(n => n !== h.branch)); h.requestTransfer('T' + tCount++, from, item, 1 + Math.floor(r() * 10)); }
      else if (x < 0.75) { for (const t of h.pendingToDispatch()) h.acceptAndDispatch(t); }
      else if (x < 0.82) { for (const t of h.pendingToReceive()) h.receive(t); }
      else if (x < 0.87) { net.up = !net.up; }
      else { try { await h.sync(cloud, net); } catch { /* offline or lost ack */ } }
      for (const hh of hubs) for (const it of items) assert.ok(hh.balance(it) >= 0, 'negative stock at ' + hh.branch);
    }
    // Hub-side supply was tracked using original keys: sales rejected by a crash never counted.
    await heal(hubs, cloud, net);
    for (const h of hubs) for (const it of items) assert.equal(cloud.balance(h.branch, it), h.balance(it), `balance ${h.branch}/${it}`);
    for (const it of items) {
      const hubTotal = hubs.reduce((s, h) => s + (h.db.prepare('SELECT COALESCE(SUM(qty),0) q FROM movements WHERE item=?').get(it) as any).q, 0);
      assert.equal(cloud.totalAllStores(it), hubTotal, 'cloud total == sum of hubs ' + it);
      assert.equal(hubTotal, supply[it], 'conservation: purchases - sales ' + it);
    }
    assert.equal(cloud.movementCount(), hubs.reduce((s, h) => s + h.movementCount(), 0));
    for (const [store, q] of Object.entries(cloud.transitSums())) {
      const tid = store.split(':')[1];
      if (cloud.transferStatus(tid) === 'received') assert.equal(q, 0, 'transit empty after receive ' + tid);
    }
    for (const h of hubs) assert.equal(h.unsynced(), 0);
    if (process.env.STATS) { const st = (cloud.db.prepare("SELECT COUNT(DISTINCT transfer) c FROM events WHERE kind='received'").get() as any).c; console.log(`STATS seed=${seed} movements=${cloud.movementCount()} transfers_requested=${tCount} received=${st}`); }
  });
}
