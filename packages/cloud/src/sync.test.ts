import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hub, syncOnce, type RemoteEvent, type Transport } from '@o-pharmacy/hub';
import { bootstrap, buildServer, createBranch, createTenant, migrate, registerDevice, withTenant } from './index';

const MASTER = 'test-master-secret-0123456789abcdef-xyz';
const freePort = () => new Promise<number>(r => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
let server: EmbeddedPostgres, dir: string, admin: pg.Client, pool: pg.Pool, app: ReturnType<typeof buildServer>;
let T1: { tenantId: string; branchId: string }, B2: { branchId: string }, T2: { tenantId: string; branchId: string };
let tok1: string, tok2: string, tokOther: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cloudsync-')); chmodSync(dir, 0o777); const port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: join(dir, 'data'), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start(); await server.createDatabase('ophar');
  admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'ophar' }); await admin.connect();
  await bootstrap(admin, 'app-password-for-tests-only'); await migrate(admin);
  T1 = await createTenant(admin, MASTER, 'Chain One', 'Branch 1'); B2 = await createBranch(admin, T1.tenantId, 'Branch 2'); T2 = await createTenant(admin, MASTER, 'Other Pharmacy', 'Main');
  tok1 = (await registerDevice(admin, T1.tenantId, T1.branchId, 'Hub 1')).token; tok2 = (await registerDevice(admin, T1.tenantId, B2.branchId, 'Hub 2')).token; tokOther = (await registerDevice(admin, T2.tenantId, T2.branchId, 'Hub other')).token;
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'app_user', password: 'app-password-for-tests-only', database: 'ophar', max: 5 }); app = buildServer(pool);
}, 120_000);
afterAll(async () => { await pool?.end(); await admin?.end(); await server?.stop(); rmSync(dir, { recursive: true, force: true }); });

/** Transport that talks to the real Cloud API in-process, with optional fault injection. */
function cloud(token: string, f: { dropBefore?: () => boolean; dropAfter?: () => boolean } = {}): Transport {
  const auth = { authorization: `Bearer ${token}` };
  return {
    push: async events => {
      if (f.dropBefore?.()) throw new Error('lost before reaching cloud');
      const r = await app.inject({ method: 'POST', url: '/v1/ingest', headers: auth, payload: { events } }); if (r.statusCode !== 200) throw new Error('cloud ' + r.statusCode);
      if (f.dropAfter?.()) throw new Error('ack lost'); return r.json().acked;
    },
    pull: async (cursor, limit) => {
      if (f.dropBefore?.()) throw new Error('lost before reaching cloud');
      const r = await app.inject({ method: 'GET', url: `/v1/pull?cursor=${cursor}&limit=${limit}`, headers: auth }); if (r.statusCode !== 200) throw new Error('cloud ' + r.statusCode);
      const j = r.json(); return { events: j.events as RemoteEvent[], cursor: j.cursor };
    },
  };
}
const mv = (key: string, qty = 1, item = 'i1') => ({ key, storeId: 'MAIN', itemId: item, qty, kind: 'purchase', actor: 'u' }) as never;
const inboxCount = (tid: string) => withTenant(pool, tid, async c => Number((await c.query('SELECT count(*) n FROM op.inbox_events')).rows[0].n));

describe('Hub <-> Cloud sync against a real PostgreSQL', () => {
  it('branch 1 pushes, branch 2 pulls it, branch 1 never gets its own events back', async () => {
    const h1 = Hub.open(T1.branchId), h2 = Hub.open(B2.branchId);
    h1.record(mv('a1', 10)); h1.record(mv('a2', 5)); h2.record(mv('b1', 7));
    expect(await syncOnce(h1, cloud(tok1))).toMatchObject({ ok: true, pushed: 2 });
    expect(await syncOnce(h2, cloud(tok2))).toMatchObject({ ok: true, pushed: 1, pulled: 2 });
    expect(h2.remoteEvents().map(e => (e.payload as { qty: number }).qty)).toEqual([10, 5]);
    expect(await syncOnce(h1, cloud(tok1))).toMatchObject({ ok: true, pushed: 0, pulled: 1 });
    expect(h1.remoteEvents().every(e => e.branchId === B2.branchId)).toBe(true);
    expect(h1.syncStatus().pending).toBe(0); expect(h2.verifyAudit()).toBeNull();
  });
  it('another tenant never receives these events', async () => {
    const hx = Hub.open(T2.branchId); await syncOnce(hx, cloud(tokOther)); expect(hx.remoteEvents()).toHaveLength(0);
    hx.record(mv('x1')); await syncOnce(hx, cloud(tokOther)); expect(await inboxCount(T2.tenantId)).toBe(1);
  });
  it('lost acknowledgement: the Hub resends, the Cloud stores once, and it converges', async () => {
    const h = Hub.open(T1.branchId); const before = await inboxCount(T1.tenantId);
    h.record(mv('l1')); h.record(mv('l2'));
    let first = true; const t = cloud(tok1, { dropAfter: () => { const d = first; first = false; return d; } });
    expect(await syncOnce(h, t)).toMatchObject({ ok: false, error: 'ack lost' }); expect(h.outboxPending()).toHaveLength(2); expect(await inboxCount(T1.tenantId)).toBe(before + 2);
    expect(await syncOnce(h, t)).toMatchObject({ ok: true, pushed: 2 }); expect(await inboxCount(T1.tenantId)).toBe(before + 2);
  });
  it('cursor survives a restart of the Hub (file database) and resumes without gaps or repeats', async () => {
    const d2 = mkdtempSync(join(tmpdir(), 'hubfile-')); const f = join(d2, 'h.db');
    try {
      const sender = Hub.open(T1.branchId); for (let i = 0; i < 5; i++) sender.record(mv('r' + i)); await syncOnce(sender, cloud(tok1));
      let h = Hub.open(B2.branchId, f); await syncOnce(h, cloud(tok2), { batch: 3 }); const n1 = h.remoteEvents().length; const c1 = h.remoteCursor(); h.close();
      sender.record(mv('r-late')); await syncOnce(sender, cloud(tok1));
      h = Hub.open(B2.branchId, f); expect(h.remoteCursor()).toBe(c1);
      await syncOnce(h, cloud(tok2)); expect(h.remoteEvents().length).toBe(n1 + 1); expect(new Set(h.remoteEvents().map(e => e.id)).size).toBe(h.remoteEvents().length); h.close();
    } finally { rmSync(d2, { recursive: true, force: true }); }
  });
  it('concurrent pushes from two Hubs never make the cursor skip an event', async () => {
    const h1 = Hub.open(T1.branchId), h2 = Hub.open(B2.branchId), reader = Hub.open(T1.branchId);
    for (let i = 0; i < 30; i++) { h1.record(mv('c1-' + i)); h2.record(mv('c2-' + i)); }
    const readerCloud = cloud(tok1); // reads branch 2's events
    await Promise.all([syncOnce(h1, cloud(tok1), { batch: 7 }), syncOnce(h2, cloud(tok2), { batch: 5 }), syncOnce(reader, readerCloud, { batch: 4 })]);
    await syncOnce(h2, cloud(tok2)); await syncOnce(reader, readerCloud);
    const fromB2 = await withTenant(pool, T1.tenantId, async c => (await c.query('SELECT event_id FROM op.inbox_events WHERE branch_id=$1', [B2.branchId])).rows.map(r => r.event_id as string));
    expect(new Set(reader.remoteEvents().filter(e => e.branchId === B2.branchId).map(e => e.id))).toEqual(new Set(fromB2));
  });
  it('fault storm: random loss before and after delivery still converges exactly', async () => {
    let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const h1 = Hub.open(T1.branchId), h2 = Hub.open(B2.branchId);
    const cloudBefore = await inboxCount(T1.tenantId);
    for (let i = 0; i < 60; i++) { h1.record(mv('s1-' + i, 1, 'storm')); if (i % 2) h2.record(mv('s2-' + i, 1, 'storm')); }
    const flaky = (tok: string) => cloud(tok, { dropBefore: () => rnd() < 0.25, dropAfter: () => rnd() < 0.25 });
    for (let round = 0; round < 200 && (h1.syncStatus().pending || h2.syncStatus().pending); round++) { await syncOnce(h1, flaky(tok1), { batch: 8 }); await syncOnce(h2, flaky(tok2), { batch: 8 }); }
    expect(h1.syncStatus().pending + h2.syncStatus().pending).toBe(0);
    expect(await inboxCount(T1.tenantId)).toBe(cloudBefore + 60 + 30);
    const clean = (tok: string) => cloud(tok); await syncOnce(h1, clean(tok1)); await syncOnce(h2, clean(tok2));
    const storm = (h: Hub, from: string) => h.remoteEvents().filter(e => e.branchId === from && (e.payload as { itemId: string }).itemId === 'storm').length;
    expect(storm(h2, T1.branchId)).toBe(60); expect(storm(h1, B2.branchId)).toBe(30);
  });
});
