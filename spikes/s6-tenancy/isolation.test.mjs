import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const A = randomUUID(), B = randomUUID();
let server, port, dir, admin, pool, ver;

// The ONLY way the app talks to the database: a transaction with SET LOCAL, so context can never outlive the request.
async function withTenant(tid, fn, p = pool) {
  const c = await p.connect();
  try { await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', $1, true)", [tid]); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
const count = async (c, t) => +(await c.query(`SELECT count(*) n FROM ophar.${t}`)).rows[0].n;

const pglog = [];
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 's6-')); chmodSync(dir, 0o777); port = await freePort();
  server = new EmbeddedPostgres({ databaseDir: join(dir, 'data'), user: 'postgres', password: 'pw', port, persistent: false, onLog: (m) => pglog.push(String(m)), onError: (m) => pglog.push('ERR ' + String(m)) });
  try { await server.initialise(); await server.start(); await server.createDatabase('ophar'); }
  catch (e) { console.log('S6-STARTUP-FAILED', e && e.message); console.log(pglog.slice(-25).join('\n')); throw e; }
  admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'ophar' }); await admin.connect();
  await admin.query(readFileSync(join(here, 'schema.sql'), 'utf8'));
  ver = (await admin.query('SHOW server_version')).rows[0].server_version;
  for (const [id, n] of [[A, 'Pharmacy A'], [B, 'Pharmacy B']]) await admin.query('INSERT INTO ophar.tenants VALUES ($1,$2)', [id, n]);
  const ia = randomUUID(), ib = randomUUID();
  globalThis.itemA = ia; globalThis.itemB = ib;
  await admin.query('SET ROLE app_owner');
  await admin.query("SET app.tenant_id = ''");
  for (const [t, i, n, bc] of [[A, ia, 'amoxicillin A', '622111'], [B, ib, 'amoxicillin B', '622222']]) {
    await admin.query('RESET ROLE'); await admin.query('SET ROLE app_owner'); await admin.query(`SELECT set_config('app.tenant_id',$1,false)`, [t]);
    await admin.query('INSERT INTO ophar.items(tenant_id,id,name,barcode) VALUES ($1,$2,$3,$4)', [t, i, n, bc]);
    await admin.query('INSERT INTO ophar.movements VALUES ($1,$2,$3,10)', [t, randomUUID(), i]);
    await admin.query('INSERT INTO ophar.loose_items VALUES ($1,$2,$3)', [t, randomUUID(), 'loose ' + n]);
  }
  await admin.query('RESET ROLE'); await admin.query("RESET app.tenant_id");
  pool = new pg.Pool({ host: '127.0.0.1', port, user: 'app_user', password: 'app_pw', database: 'ophar', max: 1 });
});
after(async () => { await pool?.end(); await admin?.end(); await server?.stop(); rmSync(dir, { recursive: true, force: true }); });
const suCount = async t => +(await admin.query(`SELECT count(*) n FROM ophar.${t}`)).rows[0].n;

test('0. the app role is not a superuser, has no BYPASSRLS, and owns nothing', async () => {
  const r = (await admin.query("SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname='app_user'")).rows[0];
  assert.deepEqual(r, { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  const own = await admin.query("SELECT count(*) n FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='app_user'");
  assert.equal(+own.rows[0].n, 0);
  console.log('PostgreSQL ' + ver);
});
test('1. each tenant sees only its own rows', async () => {
  await withTenant(A, async c => { assert.equal(await count(c, 'items'), 1); assert.equal(await count(c, 'movements'), 1); assert.equal((await c.query('SELECT name FROM ophar.items')).rows[0].name, 'amoxicillin A'); assert.equal(await count(c, 'tenants'), 1); });
  await withTenant(B, async c => assert.equal((await c.query('SELECT name FROM ophar.items')).rows[0].name, 'amoxicillin B'));
});
test('2. no tenant context means zero rows and no writes', async () => {
  const c = await pool.connect();
  try {
    assert.equal(await count(c, 'items'), 0);
    await assert.rejects(() => c.query("INSERT INTO ophar.items(tenant_id,id,name) VALUES ($1,$2,'x')", [A, randomUUID()]), /row-level security/);
    await c.query("SELECT set_config('app.tenant_id','not-a-uuid',false)").catch(() => {});
  } finally { await c.query('RESET app.tenant_id'); c.release(); }
});
test('3. cross-tenant UPDATE and DELETE touch nothing', async () => {
  await withTenant(A, async c => {
    assert.equal((await c.query("UPDATE ophar.items SET name='hacked' WHERE tenant_id=$1", [B])).rowCount, 0);
    assert.equal((await c.query('DELETE FROM ophar.items WHERE tenant_id=$1', [B])).rowCount, 0);
    assert.equal((await c.query("UPDATE ophar.items SET name='hacked' WHERE name LIKE '%B'")).rowCount, 0);
  });
  assert.equal((await admin.query("SELECT name FROM ophar.items WHERE tenant_id=$1", [B])).rows[0].name, 'amoxicillin B');
});
test('4. INSERT or UPDATE that moves a row into another tenant is rejected (WITH CHECK)', async () => {
  await withTenant(A, async c => {
    await c.query('SAVEPOINT s1');
    await assert.rejects(() => c.query("INSERT INTO ophar.items(tenant_id,id,name) VALUES ($1,$2,'planted')", [B, randomUUID()]), /row-level security/);
    await c.query('ROLLBACK TO s1');
    await assert.rejects(() => c.query('UPDATE ophar.items SET tenant_id=$1', [B]), /row-level security/);
  });
});
test('5. composite foreign key stops a row in tenant B pointing at tenant A\'s item; a single-column key would not', async () => {
  await withTenant(B, async c => {
    await c.query('SAVEPOINT s'); await assert.rejects(() => c.query('INSERT INTO ophar.movements VALUES ($1,$2,$3,1)', [B, randomUUID(), globalThis.itemA]), /foreign key/); await c.query('ROLLBACK TO s');
    await c.query('INSERT INTO ophar.bad_movements VALUES ($1,$2,$3)', [B, randomUUID(), globalThis.itemA]); // negative control: this mistake is accepted
  });
});
test('6. unique keys include tenant_id: another pharmacy can reuse a barcode and learns nothing', async () => {
  await withTenant(B, async c => { await c.query("INSERT INTO ophar.items(tenant_id,id,name,barcode) VALUES ($1,$2,'same code','622111')", [B, randomUUID()]); assert.equal(await count(c, 'items'), 2); });
});
test('7. a pooled connection never carries one request\'s tenant into the next (SET LOCAL); session-level SET would leak', async () => {
  await withTenant(A, async c => assert.equal(await count(c, 'items'), 1));
  const c1 = await pool.connect(); try { assert.equal(await count(c1, 'items'), 0); } finally { c1.release(); }     // next request, same connection (pool max 1): nothing
  const c2 = await pool.connect(); try { await c2.query("SELECT set_config('app.tenant_id',$1,false)", [A]); } finally { c2.release(); }   // the mistake: session-level setting
  const c3 = await pool.connect(); try { assert.ok(await count(c3, 'items') >= 1, 'negative control: the leak is real'); await c3.query('RESET app.tenant_id'); } finally { c3.release(); }
});
test('8. FORCE row level security stops the table owner and owner-run views from leaking; a non-forced table leaks through a view', async () => {
  await admin.query('SET ROLE app_owner');
  assert.equal(await suCount('items'), 0);                  // even the owner sees nothing without context
  await admin.query('RESET ROLE');
  await withTenant(A, async c => {
    assert.equal(await count(c, 'loose_items_view'), 2);     // negative control: no FORCE + view = both tenants' rows
    assert.equal(await count(c, 'loose_items'), 1);          // direct table access is still filtered
  });
});
test('9. the app role cannot switch RLS off or rewrite policies', async () => {
  const c = await pool.connect();
  try {
    await assert.rejects(() => c.query('ALTER TABLE ophar.items DISABLE ROW LEVEL SECURITY'), /must be owner/);
    await assert.rejects(() => c.query('DROP POLICY tenant_isolation ON ophar.items'), /must be owner/);
    await assert.rejects(() => c.query('SET ROLE app_owner'), /permission denied/);
  } finally { c.release(); }
});

// ---- per-tenant encryption keys (application layer): a database-level leak still gives only ciphertext ----
const MASTER = randomBytes(32);
const tenantKey = t => Buffer.from(hkdfSync('sha256', MASTER, Buffer.from(t), Buffer.from('o-pharmacy customers v1'), 32));
const enc = (t, text) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', tenantKey(t), iv); c.setAAD(Buffer.from(t)); const x = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), x]); };
const dec = (t, buf) => { const d = createDecipheriv('aes-256-gcm', tenantKey(t), buf.subarray(0, 12)); d.setAAD(Buffer.from(t)); d.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'); };
test('10. per-tenant keys: round trip works; another tenant\'s key cannot read it; a ciphertext copied across tenants will not decrypt', async () => {
  const id = randomUUID();
  await withTenant(A, c => c.query('INSERT INTO ophar.customers VALUES ($1,$2,$3)', [A, id, enc(A, 'محمد - 01000000000')]));
  const stolen = (await admin.query('SELECT name_enc FROM ophar.customers WHERE id=$1', [id])).rows[0].name_enc;   // what a database-level leak would reveal
  assert.equal(dec(A, stolen), 'محمد - 01000000000');
  assert.throws(() => dec(B, stolen));
  assert.ok(!stolen.toString('utf8').includes('محمد'));
  await withTenant(B, c => c.query('INSERT INTO ophar.customers VALUES ($1,$2,$3)', [B, randomUUID(), stolen]));   // copy A's ciphertext into B's row
  const copied = (await admin.query('SELECT name_enc FROM ophar.customers WHERE tenant_id=$1', [B])).rows[0].name_enc;
  assert.throws(() => dec(B, copied));
});

// ---- the honest limit, and the stronger tier ----
test('11. KNOWN LIMIT: with a settable context, an attacker who can run arbitrary SQL can pick another tenant', async () => {
  await withTenant(A, async c => {                         // pretend an SQL injection gave the attacker this session
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [B]);
    assert.equal((await c.query('SELECT name FROM ophar.items ORDER BY name')).rows[0].name.endsWith('B'), true);
  });
});
test('12. STRONGER TIER (dedicated login per tenant): the database itself decides the tenant from the login, so injected SQL cannot change it', async () => {
  await admin.query(`CREATE ROLE tenant_a LOGIN PASSWORD 'ta' NOSUPERUSER NOBYPASSRLS; CREATE ROLE tenant_b LOGIN PASSWORD 'tb' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`SET ROLE app_owner; CREATE TABLE ophar.role_tenant (rolname name PRIMARY KEY, tenant_id uuid NOT NULL); RESET ROLE;`);
  await admin.query(`INSERT INTO ophar.role_tenant VALUES ('tenant_a', '${A}'), ('tenant_b', '${B}')`);
  await admin.query(`SET ROLE app_owner;
    CREATE FUNCTION ophar.login_tenant() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ophar AS $f$ SELECT tenant_id FROM ophar.role_tenant WHERE rolname = session_user $f$;
    CREATE TABLE ophar.strong_items (tenant_id uuid NOT NULL, id uuid PRIMARY KEY, name text);
    ALTER TABLE ophar.strong_items ENABLE ROW LEVEL SECURITY; ALTER TABLE ophar.strong_items FORCE ROW LEVEL SECURITY;
    CREATE POLICY by_login ON ophar.strong_items USING (tenant_id = ophar.login_tenant()) WITH CHECK (tenant_id = ophar.login_tenant());
    REVOKE ALL ON ophar.role_tenant FROM PUBLIC; REVOKE ALL ON FUNCTION ophar.login_tenant() FROM PUBLIC;
    RESET ROLE;`);
  await admin.query(`GRANT USAGE ON SCHEMA ophar TO tenant_a, tenant_b; GRANT SELECT,INSERT,UPDATE,DELETE ON ophar.strong_items TO tenant_a, tenant_b; GRANT EXECUTE ON FUNCTION ophar.login_tenant() TO tenant_a, tenant_b`);
  const mk = (u, p) => new pg.Pool({ host: '127.0.0.1', port, user: u, password: p, database: 'ophar', max: 1 });
  const pa = mk('tenant_a', 'ta'), pb = mk('tenant_b', 'tb');
  try {
    await pa.query("INSERT INTO ophar.strong_items VALUES ($1,$2,'a-secret')", [A, randomUUID()]);
    await pb.query("INSERT INTO ophar.strong_items VALUES ($1,$2,'b-secret')", [B, randomUUID()]);
    await pa.query("SELECT set_config('app.tenant_id', $1, false)", [B]);       // the injection that beat test 11
    assert.deepEqual((await pa.query('SELECT name FROM ophar.strong_items')).rows, [{ name: 'a-secret' }]);
    await assert.rejects(() => pa.query("INSERT INTO ophar.strong_items VALUES ($1,$2,'x')", [B, randomUUID()]), /row-level security/);
    await assert.rejects(() => pa.query('SELECT * FROM ophar.role_tenant'), /permission denied/);
    await assert.rejects(() => pa.query("SET SESSION AUTHORIZATION tenant_b"), /permission denied/);
  } finally { await pa.end(); await pb.end(); }
});
