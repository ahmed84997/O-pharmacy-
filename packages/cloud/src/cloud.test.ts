import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, bootstrap, buildServer, createTenant, decryptField, encryptField, migrate, newTenantKey, registerDevice, revokeDevice, unwrapTenantKey, withTenant } from './index';

const MASTER = 'test-master-secret-0123456789abcdef-xyz';
const APP_PW = 'app-password-for-tests-only';
const freePort = () => new Promise<number>(r => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
let server: EmbeddedPostgres, dir: string, port: number, admin: pg.Client, pool: pg.Pool;
let A: { tenantId: string; branchId: string }, B: { tenantId: string; branchId: string };
let devA: { deviceId: string; token: string }, devB: { deviceId: string; token: string };
let ver = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cloud-')); chmodSync(dir, 0o777); port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: join(dir, 'data'), user: 'postgres', password: 'pw', port, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start(); await server.createDatabase('ophar');
  admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'ophar' }); await admin.connect();
  await bootstrap(admin, APP_PW); await migrate(admin);
  ver = (await admin.query('SHOW server_version')).rows[0].server_version;
  A = await createTenant(admin, MASTER, 'Pharmacy A', 'Main A'); B = await createTenant(admin, MASTER, 'Pharmacy B', 'Main B');
  devA = await registerDevice(admin, A.tenantId, A.branchId, 'Hub A'); devB = await registerDevice(admin, B.tenantId, B.branchId, 'Hub B');
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'app_user', password: APP_PW, database: 'ophar', max: 2 });
}, 120_000);
afterAll(async () => { await pool?.end(); await admin?.end(); await server?.stop(); rmSync(dir, { recursive: true, force: true }); });

const ev = (branchId: string, id = randomUUID()) => ({ id, type: 'stock.moved', branchId, payload: { qty: 5 }, createdAt: new Date().toISOString() });
const post = (app: ReturnType<typeof buildServer>, token: string | null, events: unknown[]) => app.inject({ method: 'POST', url: '/v1/ingest', headers: token ? { authorization: `Bearer ${token}` } : {}, payload: { events } });
const countAs = (tid: string, table: string) => withTenant(pool, tid, async c => Number((await c.query(`SELECT count(*) n FROM op.${table}`)).rows[0].n));

describe('database roles and isolation (spike S6 rules, now in the product schema)', () => {
  it('app role is not superuser, has no BYPASSRLS, owns nothing', async () => {
    const r = (await admin.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='app_user'")).rows[0];
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(Number((await admin.query("SELECT count(*) n FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='app_user'")).rows[0].n)).toBe(0);
    console.log('PostgreSQL ' + ver);
  });
  it('every business table has RLS enabled and forced', async () => {
    const t = (await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='op' AND relkind='r' AND relname <> 'schema_migrations'")).rows;
    expect(t.map(r => r.relname).sort()).toEqual(['branches', 'cloud_devices', 'inbox_events', 'tenants']);
    for (const r of t) { expect(r.relrowsecurity, r.relname).toBe(true); expect(r.relforcerowsecurity, r.relname).toBe(true); }
  });
  it('each tenant sees only its own rows', async () => {
    expect(await countAs(A.tenantId, 'branches')).toBe(1); expect(await countAs(B.tenantId, 'branches')).toBe(1);
    expect(await countAs(A.tenantId, 'tenants')).toBe(1);
    await withTenant(pool, A.tenantId, async c => expect((await c.query('SELECT name FROM op.branches')).rows[0].name).toBe('Main A'));
  });
  it('no tenant context means zero rows, never everything', async () => {
    for (const t of ['tenants', 'branches', 'cloud_devices', 'inbox_events']) expect(Number((await pool.query(`SELECT count(*) n FROM op.${t}`)).rows[0].n), t).toBe(0);
  });
  it('cannot write into another tenant, nor point at another tenant\'s branch', async () => {
    await expect(withTenant(pool, A.tenantId, c => c.query('INSERT INTO op.branches(tenant_id,id,name) VALUES ($1,$2,$3)', [B.tenantId, randomUUID(), 'evil']))).rejects.toThrow(/row-level security/);
    await expect(withTenant(pool, A.tenantId, c => c.query("INSERT INTO op.inbox_events(tenant_id,event_id,branch_id,device_id,type,payload,hub_created_at) VALUES ($1,$2,$3,$4,'x','{}',now())", [A.tenantId, randomUUID(), B.branchId, devA.deviceId]))).rejects.toThrow(/foreign key/);
  });
  it('the app role cannot read device tokens of others, create roles, or touch the migration table', async () => {
    expect(await countAs(A.tenantId, 'cloud_devices')).toBe(1);
    await expect(pool.query('CREATE ROLE sneaky')).rejects.toThrow();
    await expect(pool.query('SELECT * FROM op.schema_migrations')).rejects.toThrow(/permission denied/);
    await expect(pool.query('DROP TABLE op.branches')).rejects.toThrow();
  });
  it('tenant context does not leak between requests on the same connection', async () => {
    await withTenant(pool, A.tenantId, async c => c.query('SELECT 1'));
    expect(Number((await pool.query('SELECT count(*) n FROM op.branches')).rows[0].n)).toBe(0);
  });
});

describe('migrations', () => {
  it('are applied once, checksum-guarded and additive', async () => {
    expect(await migrate(admin)).toEqual([]);
    await expect(migrate(admin, [{ ...MIGRATIONS[0]!, sql: MIGRATIONS[0]!.sql + '\n' }])).rejects.toThrow(/changed/);
    await expect(migrate(admin, [...MIGRATIONS, { id: '9999_bad', sql: 'DROP TABLE op.branches' }])).rejects.toThrow(/additive/);
    for (const m of MIGRATIONS) expect(m.sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
  it('bootstrap refuses a weak app password', async () => { await expect(bootstrap(admin, 'short')).rejects.toThrow(); });
});

describe('per-tenant keys (D25)', () => {
  it('wrap, unwrap, encrypt, decrypt; bound to tenant and field; tamper fails', () => {
    const t1 = randomUUID(), t2 = randomUUID(); const k1 = newTenantKey(MASTER, t1), k2 = newTenantKey(MASTER, t2);
    expect(k1.key.equals(k2.key)).toBe(false);
    const un = unwrapTenantKey(MASTER, t1, k1.wrapped); expect(un.equals(k1.key)).toBe(true);
    expect(() => unwrapTenantKey(MASTER, t2, k1.wrapped)).toThrow();
    expect(() => unwrapTenantKey('another-master-secret-0123456789abcdef', t1, k1.wrapped)).toThrow();
    const blob = encryptField(un, t1, 'customer.name', 'منى أحمد');
    expect(decryptField(un, t1, 'customer.name', blob)).toBe('منى أحمد');
    expect(() => decryptField(un, t2, 'customer.name', blob)).toThrow(); expect(() => decryptField(un, t1, 'customer.phone', blob)).toThrow();
    expect(() => decryptField(k2.key, t1, 'customer.name', blob)).toThrow();
    const bad = Buffer.from(blob); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1; expect(() => decryptField(un, t1, 'customer.name', bad)).toThrow();
    expect(encryptField(un, t1, 'f', 'x').equals(encryptField(un, t1, 'f', 'x'))).toBe(false);
  });
  it('the stored wrapped key unwraps for its own tenant only', async () => {
    const w = await withTenant(pool, A.tenantId, async c => (await c.query('SELECT wrapped_key FROM op.tenants')).rows[0].wrapped_key as Buffer);
    expect(unwrapTenantKey(MASTER, A.tenantId, w).length).toBe(32); expect(() => unwrapTenantKey(MASTER, B.tenantId, w)).toThrow();
  });
  it('master secret must be long enough', () => { expect(() => newTenantKey('short', randomUUID())).toThrow(); });
});

describe('device authentication and ingest (Hub outbox -> Cloud inbox)', () => {
  const app = () => buildServer(pool);
  it('health is open; /v1 needs a valid device token', async () => {
    const s = app(); expect((await s.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await post(s, null, [])).statusCode).toBe(401); expect((await post(s, 'wrong-token', [])).statusCode).toBe(401);
  });
  it('accepts events, is idempotent on retry, and the tenant sees only its own', async () => {
    const s = app(); const e1 = ev(A.branchId), e2 = ev(A.branchId);
    const r1 = await post(s, devA.token, [e1, e2]); expect(r1.statusCode).toBe(200); expect(r1.json().acked).toEqual([e1.id, e2.id]);
    const r2 = await post(s, devA.token, [e1, e2]); expect(r2.json().acked).toEqual([e1.id, e2.id]);
    expect(await countAs(A.tenantId, 'inbox_events')).toBe(2); expect(await countAs(B.tenantId, 'inbox_events')).toBe(0);
    const eb = ev(B.branchId); expect((await post(s, devB.token, [eb])).statusCode).toBe(200); expect(await countAs(B.tenantId, 'inbox_events')).toBe(1); expect(await countAs(A.tenantId, 'inbox_events')).toBe(2);
  });
  it('a device cannot send for another branch, and a duplicate id from another tenant does not collide or leak', async () => {
    const s = app(); expect((await post(s, devA.token, [ev(B.branchId)])).statusCode).toBe(403);
    const shared = randomUUID(); expect((await post(s, devA.token, [ev(A.branchId, shared)])).statusCode).toBe(200); expect((await post(s, devB.token, [ev(B.branchId, shared)])).statusCode).toBe(200);
  });
  it('rejects malformed input (bad id, too many events, extra fields)', async () => {
    const s = app();
    expect((await post(s, devA.token, [{ ...ev(A.branchId), id: 'nope' }])).statusCode).toBe(400);
    expect((await post(s, devA.token, Array.from({ length: 201 }, () => ev(A.branchId)))).statusCode).toBe(400);
    expect((await post(s, devA.token, [{ ...ev(A.branchId), extra: 1 }])).statusCode).toBe(400);
  });
  it('a revoked device is locked out at once', async () => {
    const d = await registerDevice(admin, A.tenantId, A.branchId, 'Old phone'); const s = app();
    expect((await post(s, d.token, [ev(A.branchId)])).statusCode).toBe(200);
    await revokeDevice(admin, A.tenantId, d.deviceId);
    expect((await post(s, d.token, [ev(A.branchId)])).statusCode).toBe(401);
  });
  it('only the token hash is stored', async () => {
    const r = await withTenant(pool, A.tenantId, async c => (await c.query('SELECT token_hash FROM op.cloud_devices')).rows.map(x => x.token_hash));
    expect(r.some((h: string) => h === devA.token)).toBe(false); expect(r.every((h: string) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });
});
