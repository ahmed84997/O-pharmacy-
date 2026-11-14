import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { can, ROLE_NAMES, roleTemplate, type Person, type RoleCode } from '@o-pharmacy/core';
import type { App } from './compose';
import { AccessError } from './access';
import { ribbonFor } from './ribbon';
import { seedTestData } from './seed';
import { posRoutes } from './pos-api';
import { invRoutes } from './inv-api';
import { printRoutes } from './print-api';
import { opsRoutes } from './ops-api';
import { accRoutes } from './acc-api';
import { glanceRoutes } from './glance-api';
import { SystemService } from './system';
import { relayOf } from './printing';

export const VERSION = '0.7.15';
export interface ServerOptions { webDir?: string; staffSecret?: string; logger?: boolean; system?: SystemService }
/** The pharmacy's data fields: request field, setting key, longest length. */
const ORG_FIELDS: [string, string, number][] = [['name', 'pharmacy.name', 80], ['phones', 'pharmacy.phones', 80], ['address', 'pharmacy.address', 160], ['supportPhone', 'pharmacy.support_phone', 40], ['taxRegNo', 'pharmacy.tax_reg_no', 40], ['commercialRegNo', 'pharmacy.commercial_reg_no', 40]];
const STATUS: Record<string, number> = { separation: 403, file: 400, 'duplicate-barcode': 409, 'duplicate-code': 409, 'same-status': 409, insufficient: 409, underpaid: 400, 'no-price': 409, session: 409, 'discount-limit': 403, 'credit-limit': 409, 'day-closed': 409, blocked: 409, 'window-closed': 409, forbidden: 403, 'device-pending': 403, 'device-revoked': 403, 'not-found': 404, 'device-unknown': 401, unauthenticated: 401, 'bad-credentials': 401, locked: 423, inactive: 403, invalid: 400, state: 409, duplicate: 409, 'price-rule': 400, 'reason-required': 400 };
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
declare module 'fastify' { interface FastifyRequest { person?: Person; deviceId?: string } }

/** The Hub's local API: every screen talks only to this. A request passes three gates: a known device (id + secret), an approved device, and a live session for an active person; then each action checks its own permission in the module. */
export function buildServer(app: App, o: ServerOptions = {}): FastifyInstance {
  const sys = o.system ?? new SystemService(app);
  const f = Fastify({ logger: o.logger ?? false, bodyLimit: 1_000_000 });
  f.addHook('onSend', async (_q, rep) => { rep.header('X-Content-Type-Options', 'nosniff'); rep.header('X-Frame-Options', 'DENY'); rep.header('Referrer-Policy', 'no-referrer'); rep.header('Cache-Control', 'no-store'); });
  f.setErrorHandler((e: Error & { code?: string; statusCode?: number }, _q, rep) => {
    const code = typeof e.code === 'string' && STATUS[e.code] ? e.code : null;
    if (code) return rep.status(STATUS[code]!).send({ error: code, message: e.message });
    if (e.statusCode && e.statusCode < 500) return rep.status(e.statusCode).send({ error: 'invalid', message: e.message });
    f.log.error(e); return rep.status(500).send({ error: 'server', message: 'unexpected error' });
  });
  const deviceOf = (q: FastifyRequest): string => { const h = String(q.headers['x-device'] ?? ''); const i = h.indexOf('.'); if (i < 1) throw new AccessError('device-unknown', 'unknown device'); const id = h.slice(0, i); app.access.device(id, h.slice(i + 1)); return id; };
  const auth = async (q: FastifyRequest) => { const d = deviceOf(q); const t = String(q.headers.authorization ?? '').replace(/^Bearer /, ''); if (!t) throw new AccessError('unauthenticated', 'please log in'); q.person = app.access.session(t, d); q.deviceId = d; };
  const me = (q: FastifyRequest) => q.person!;
  const need = (p: Person, key: string) => { if (!can(p, key, app.hub.branchId)) throw new AccessError('forbidden', `missing permission ${key}`); };
  type B = Record<string, unknown>;

  // ---------- open ----------
  f.get('/api/state', async () => ({ setUp: app.access.isSetUp(), pharmacyName: app.access.setting('pharmacy.name'), supportPhone: app.access.setting('pharmacy.support_phone'), branchId: app.hub.branchId, version: VERSION, testMode: app.testMode, readOnly: sys.readOnly() }));
  f.post('/api/devices/register', async (q) => { const b = (q.body ?? {}) as B; const pending = Number(app.hub.db.prepare("SELECT COUNT(*) n FROM devices WHERE status='pending'").get()!.n); if (pending >= 50) throw new AccessError('state', 'too many devices waiting for approval'); return app.access.registerDevice({ name: String(b.name ?? ''), kind: String(b.kind ?? 'browser'), userAgent: String(q.headers['user-agent'] ?? '') }); });
  f.get('/api/devices/me', async (q) => { const h = String(q.headers['x-device'] ?? ''); const i = h.indexOf('.'); if (i < 1) throw new AccessError('device-unknown', 'unknown device'); const d = app.access.device(h.slice(0, i), h.slice(i + 1)); return { id: d.id, name: d.name, status: d.status }; });
  f.post('/api/setup', async (q) => { const d = deviceOf(q); const b = (q.body ?? {}) as B; const p = app.access.setup(d, { pharmacyName: String(b.pharmacyName ?? ''), displayName: String(b.displayName ?? ''), username: String(b.username ?? ''), secret: String(b.secret ?? '') }); const s = app.access.login(d, p.username, String(b.secret)); return { token: s.token }; });
  f.post('/api/login', async (q) => { const d = deviceOf(q); const b = (q.body ?? {}) as B; const s = app.access.login(d, String(b.username ?? ''), String(b.secret ?? '')); return { token: s.token, mustChangeSecret: s.mustChangeSecret }; });

  // ---------- the desktop app's print agent (D39): an approved device, no session (it prints while nobody is logged in too) ----------
  const agentDevice = (q: FastifyRequest): string => { const h = String(q.headers['x-device'] ?? ''); const i = h.indexOf('.'); if (i < 1) throw new AccessError('device-unknown', 'unknown device'); const d = app.access.device(h.slice(0, i), h.slice(i + 1)); if (d.status !== 'approved') throw new AccessError('device-pending', 'device not approved'); return d.id; };
  f.get('/api/agent/next', async (q, rep) => { const d = agentDevice(q); const wait = Math.min(Math.max(Number((q.query as B).wait ?? 25) || 25, 1), 30) * 1000; const j = await relayOf(app).next(d, wait); if (!j) return rep.status(204).send(); return j; });
  f.post('/api/agent/result', async (q) => { const d = agentDevice(q); const b = (q.body ?? {}) as B; return { ok: relayOf(app).result(d, String(b.id ?? ''), b.ok === true, b.error === undefined ? undefined : String(b.error)) }; });

  // ---------- signed in ----------
  f.register(async (s) => {
    s.addHook('preHandler', auth);
    /** Read-only when a required licence is missing or expired past grace: reading and exporting keep working; activation, logout and changing one's password stay open. */
    s.addHook('preHandler', async (q) => { if (q.method !== 'GET' && sys.readOnly() && !/^\/api\/(system\/licence|logout|me\/secret|reports\/[^/]+\/(run|export))/.test(q.url)) throw new AccessError('state', 'the licence has ended: the program is read-only until it is renewed'); });
    s.get('/api/system/info', async (q) => { const p = me(q); const l = sys.licence(); const admin = can(p, 'settings.security', app.hub.branchId); return { version: VERSION, branchId: app.hub.branchId, testMode: app.testMode, tenantId: admin ? sys.tenantId() : null, licence: { state: l.state, configured: l.configured, required: l.required, reason: l.reason ?? null, edition: l.payload?.edition ?? null, expiresAt: l.payload?.expiresAt ?? null, daysLeft: l.daysLeft ?? null }, addresses: sys.addresses(), backups: admin ? sys.backups().slice(0, 30) : [], lastBackup: app.access.setting('backup.last'), db: admin ? sys.dbSize() : null }; });
    s.post('/api/system/backup', async (q) => { need(me(q), 'settings.security'); const r = sys.backup('manual', me(q).id); return { name: r.file.split(/[\\/]/).pop(), bytes: r.bytes }; });
    s.get('/api/system/backup-schedule', async (q) => { need(me(q), 'settings.security'); return { schedule: sys.schedule(), backupDir: sys.backupDir }; });
    s.post('/api/system/backup-schedule', async (q) => ({ schedule: sys.setSchedule(me(q), (q.body ?? {}) as B) }));
    s.post('/api/system/licence', async (q) => sys.activate(me(q), String(((q.body ?? {}) as B).token ?? '')));
    s.post('/api/logout', async (q) => { app.access.logout(String(q.headers.authorization ?? '').replace(/^Bearer /, '')); return { ok: true }; });
    s.get('/api/me', async (q) => { const p = me(q); const v = app.access.view1(p.id); const perms = new Set(app.access.permissions(p.id)); return { person: { id: v.id, username: v.username, displayName: v.displayName, roles: v.roles, roleNames: v.roles.map(r => ROLE_NAMES[r]), mustChangeSecret: v.mustChangeSecret }, permissions: [...perms], ribbon: ribbonFor(perms), pharmacyName: app.access.setting('pharmacy.name'), branchId: app.hub.branchId, version: VERSION, testMode: app.testMode }; });
    s.post('/api/me/secret', async (q) => { const b = (q.body ?? {}) as B; app.access.changeOwnSecret(me(q).id, String(b.current ?? ''), String(b.next ?? '')); return { ok: true }; });
    // people
    s.get('/api/people', async (q) => ({ people: app.access.list(me(q)), roles: Object.entries(ROLE_NAMES).map(([code, name]) => ({ code, name, optional: roleTemplate(code as RoleCode).optional })) }));
    s.post('/api/people', async (q) => { const b = (q.body ?? {}) as B; return app.access.create(me(q), { username: String(b.username ?? ''), displayName: String(b.displayName ?? ''), secret: String(b.secret ?? ''), roles: b.roles as RoleCode[], grants: b.grants as string[] | undefined, denies: b.denies as string[] | undefined }); });
    s.patch('/api/people/:id', async (q) => { const b = (q.body ?? {}) as B; return app.access.update(me(q), (q.params as B).id as string, { displayName: b.displayName as string | undefined, roles: b.roles as RoleCode[] | undefined, grants: b.grants as string[] | undefined, denies: b.denies as string[] | undefined }); });
    s.post('/api/people/:id/secret', async (q) => { app.access.resetSecret(me(q), (q.params as B).id as string, String(((q.body ?? {}) as B).secret ?? '')); return { ok: true }; });
    s.post('/api/people/:id/active', async (q) => { const b = (q.body ?? {}) as B; return app.access.setActive(me(q), (q.params as B).id as string, b.active === true, String(b.reason ?? '')); });
    s.get('/api/people/:id/history', async (q) => ({ history: app.access.history(me(q), (q.params as B).id as string) }));
    // devices
    s.get('/api/devices', async (q) => ({ devices: app.access.devices(me(q)), current: q.deviceId }));
    s.post('/api/devices/:id/approve', async (q) => { app.access.approveDevice(me(q), (q.params as B).id as string); return { ok: true }; });
    s.post('/api/devices/:id/revoke', async (q) => { if ((q.params as B).id === q.deviceId) throw new AccessError('state', 'you cannot revoke the device you are using'); app.access.revokeDevice(me(q), (q.params as B).id as string, String(((q.body ?? {}) as B).reason ?? '')); return { ok: true }; });
    // settings
    /** The pharmacy's own data (Sprint 7.11 "بيانات المؤسسة"): shown on receipts, labels and the login screen. Each field is optional except the name. */
    s.get('/api/settings/pharmacy', async (q) => { need(me(q), 'settings.branch'); return Object.fromEntries(ORG_FIELDS.map(([f, k]) => [f, app.access.setting(k) ?? ''])); });
    s.post('/api/settings/pharmacy', async (q) => {
      need(me(q), 'settings.branch'); const b = (q.body ?? {}) as B; const name = String(b.name ?? '').trim(); if (!name) throw new AccessError('invalid', 'the pharmacy name is required');
      const changed: Record<string, string> = {};
      const next = ORG_FIELDS.filter(([f]) => f === 'name' || b[f] !== undefined).map(([f, k, max]) => { const v = f === 'name' ? name : String(b[f] ?? '').trim(); if (v.length > max) throw new AccessError('invalid', `${f} is too long`); return [f, k, v] as const; });
      for (const [f, k, v] of next) if (v !== (app.access.setting(k) ?? '')) { app.access.setSetting(k, v, me(q).id); changed[f] = v; }
      if (Object.keys(changed).length) app.hub.audit(me(q).id, 'settings.pharmacy', 'settings', 'pharmacy', changed); return { ok: true };
    });
    // items (read-only in 7.1)
    s.get('/api/items', async (q) => {
      const p = me(q); need(p, 'item.view'); const qs = q.query as B; const list = app.items.search(String(qs.q ?? ''), { limit: Math.min(Math.max(Number(qs.limit ?? 50) || 50, 1), 200) });
      const showStock = can(p, 'stock.view', app.hub.branchId); const sum = showStock && list.length ? app.stock.summary(p, list.map(i => i.id)) : new Map(); const today = app.batches.today();
      const price = app.hub.db.prepare("SELECT b.public_price_minor p, u.name u FROM batches b JOIN item_units u ON u.id=b.price_unit_id WHERE b.item_id=? AND b.status='active' AND b.expiry>=? AND (SELECT COALESCE(SUM(qty),0) FROM movements m WHERE m.batch_id=b.id) > 0 ORDER BY b.expiry LIMIT 1");
      return { items: list.map(i => { const pr = i.kind === 'drug' ? price.get(i.id, today) : undefined; const st = sum.get(i.id); return { id: i.id, code: i.code, nameAr: i.nameAr, kind: i.kind, status: i.status, units: i.units.map(u => ({ name: u.name, factor: u.factor })), priceMinor: i.kind === 'drug' ? (pr ? Number(pr.p) : null) : i.listPriceMinor, priceUnit: i.kind === 'drug' ? (pr ? String(pr.u) : null) : i.units[0]?.name ?? null, stock: st ? { total: st.total, sellable: st.sellable } : null }; }), showStock };
    });
    s.get('/api/dashboard', async (q) => {
      const p = me(q); const db = app.hub.db; const n = (sql: string, ...a: unknown[]) => Number(db.prepare(sql).get(...a)!.n);
      const out: B = { pharmacyName: app.access.setting('pharmacy.name') };
      if (can(p, 'item.view', app.hub.branchId)) out.items = n("SELECT COUNT(*) n FROM items WHERE status='active'");
      if (can(p, 'expiry.alerts.view', app.hub.branchId) || can(p, 'stock.view', app.hub.branchId)) { const lim = new Date(Date.parse(`${app.batches.today()}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10); out.nearExpiry = n("SELECT COUNT(*) n FROM batches b WHERE b.status='active' AND b.expiry<=? AND (SELECT COALESCE(SUM(qty),0) FROM movements m WHERE m.batch_id=b.id) > 0", lim); }
      if (can(p, 'user.view', app.hub.branchId)) out.people = n('SELECT COUNT(*) n FROM people WHERE active=1');
      if (can(p, 'device.approve', app.hub.branchId)) out.pendingDevices = n("SELECT COUNT(*) n FROM devices WHERE status='pending'");
      if (can(p, 'supplier.view', app.hub.branchId)) out.suppliers = n('SELECT COUNT(*) n FROM suppliers WHERE active=1');
      if (can(p, 'customer.view', app.hub.branchId)) out.customers = n('SELECT COUNT(*) n FROM customers');
      out.empty = n('SELECT COUNT(*) n FROM items') === 0; out.testMode = app.testMode; return out;
    });
    posRoutes(s, app);
    invRoutes(s, app);
    printRoutes(s, app);
    opsRoutes(s, app);
    accRoutes(s, app);
    glanceRoutes(s, app);
    // test server only
    s.post('/api/test/seed', async (q) => { if (!app.testMode) throw new AccessError('not-found', 'not available'); const p = me(q); if (!p.roles.includes('O')) throw new AccessError('forbidden', 'owner only'); return seedTestData(app, p, { staffSecret: o.staffSecret }); });
  });

  // ---------- the screens (built web app) ----------
  if (o.webDir) {
    const root = normalize(o.webDir);
    const send = async (rep: FastifyReply, file: string) => { const body = await readFile(file); rep.header('Content-Type', MIME[extname(file)] ?? 'application/octet-stream'); if (file.includes(`${sep}assets${sep}`)) rep.header('Cache-Control', 'public, max-age=31536000, immutable'); return rep.send(body); };
    f.get('/*', async (q, rep) => {
      const url = decodeURIComponent((q.url.split('?')[0] ?? '/')); if (url.startsWith('/api/')) return rep.status(404).send({ error: 'not-found', message: 'no such endpoint' });
      const file = normalize(join(root, url)); if (file.startsWith(root + sep)) { try { if ((await stat(file)).isFile()) return send(rep, file); } catch { /* fall through to the app */ } }
      return send(rep, join(root, 'index.html'));
    });
  }
  return f;
}
