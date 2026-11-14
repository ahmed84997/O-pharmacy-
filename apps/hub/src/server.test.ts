import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openApp } from './compose';
import { buildServer } from './server';
import { RIBBON } from './ribbon';
import { PERMISSION_KEYS } from '@o-pharmacy/core';

const SECRET = 'owner-pass-1';
const prep = (o: { testMode?: boolean; webDir?: string } = {}) => {
  const clock = { t: Date.parse('2026-12-10T10:00:00Z') }; const app = openApp({ clock: () => new Date(clock.t), testMode: o.testMode }); const f = buildServer(app, { webDir: o.webDir, staffSecret: 'staff-pass-1' });
  const call = async (method: string, url: string, o2: { body?: unknown; dev?: string; token?: string } = {}) => { const r = await f.inject({ method: method as 'GET', url, payload: o2.body as object, headers: { ...(o2.dev ? { 'x-device': o2.dev } : {}), ...(o2.token ? { authorization: `Bearer ${o2.token}` } : {}) } }); return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, raw: r }; };
  const device = async (name = 'PC1') => { const r = await call('POST', '/api/devices/register', { body: { name, kind: 'desktop' } }); return `${r.body.id}.${r.body.secret}`; };
  const setup = async () => { const dev = await device(); const r = await call('POST', '/api/setup', { dev, body: { pharmacyName: 'صيدلية التجربة', displayName: 'د. أحمد', username: 'Ahmed', secret: SECRET } }); return { dev, token: r.body.token as string }; };
  return { app, f, clock, call, device, setup };
};

describe('first run, devices and login', () => {
  it('sets up the owner once from a device that becomes approved; later devices wait for approval before anyone logs in on them', async () => {
    const s = prep(); expect((await s.call('GET', '/api/state')).body).toMatchObject({ setUp: false, version: '0.7.15' });
    expect((await s.call('POST', '/api/setup', { body: {} })).status).toBe(401);
    const { dev, token } = await s.setup(); expect(token).toBeTruthy(); expect((await s.call('GET', '/api/state')).body).toMatchObject({ setUp: true, pharmacyName: 'صيدلية التجربة' });
    expect((await s.call('POST', '/api/setup', { dev, body: { pharmacyName: 'x', displayName: 'x', username: 'other', secret: SECRET } })).body.error).toBe('state');
    expect((await s.call('GET', '/api/devices/me', { dev })).body.status).toBe('approved');
    const me = (await s.call('GET', '/api/me', { dev, token })).body; expect(me.person).toMatchObject({ username: 'ahmed', roles: ['O'] }); expect(me.ribbon.map((t: { id: string }) => t.id)).toEqual(RIBBON.map(t => t.id));
    const dev2 = await s.device('PC2'); expect((await s.call('POST', '/api/login', { dev: dev2, body: { username: 'ahmed', secret: SECRET } })).body.error).toBe('device-pending');
    expect((await s.call('GET', '/api/me', { dev: dev2, token })).status).toBe(401); // a session is bound to its device
    const id2 = dev2.split('.')[0]; expect((await s.call('POST', `/api/devices/${id2}/approve`, { dev, token })).status).toBe(200);
    const t2 = (await s.call('POST', '/api/login', { dev: dev2, body: { username: 'AHMED', secret: SECRET } })).body.token; expect(t2).toBeTruthy();
    expect((await s.call('POST', `/api/devices/${dev.split('.')[0]}/revoke`, { dev, token, body: { reason: 'x' } })).body.error).toBe('state');
    expect((await s.call('POST', `/api/devices/${id2}/revoke`, { dev, token, body: { reason: 'جهاز اتسرق' } })).status).toBe(200); expect((await s.call('GET', '/api/me', { dev: dev2, token: t2 })).status).toBe(401);
    expect((await s.call('GET', '/api/me', { dev: `${id2}.wrong`, token: t2 })).status).toBe(401); expect(() => s.app.hub.db.exec('DELETE FROM devices')).toThrow();
  });
  it('locks an account after five wrong passwords and never says which part was wrong', async () => {
    const s = prep(); const { dev } = await s.setup();
    expect((await s.call('POST', '/api/login', { dev, body: { username: 'nobody', secret: 'x' } })).body).toMatchObject({ error: 'bad-credentials', message: 'wrong username or password' });
    for (let i = 0; i < 4; i++) expect((await s.call('POST', '/api/login', { dev, body: { username: 'ahmed', secret: 'bad' } })).body.error).toBe('bad-credentials');
    expect((await s.call('POST', '/api/login', { dev, body: { username: 'ahmed', secret: 'bad' } })).body.error).toBe('locked');
    expect((await s.call('POST', '/api/login', { dev, body: { username: 'ahmed', secret: SECRET } })).body.error).toBe('locked');
    s.clock.t += 16 * 60000; expect((await s.call('POST', '/api/login', { dev, body: { username: 'ahmed', secret: SECRET } })).status).toBe(200);
  });
});

describe('people and the Ribbon', () => {
  it('creates staff with roles, forces a new password on first login, shows each person only their part of the Ribbon, and keeps an owner', async () => {
    const s = prep(); const { dev, token } = await s.setup();
    const cs = (await s.call('POST', '/api/people', { dev, token, body: { username: 'cashier1', displayName: 'كاشير', secret: 'temp-123', roles: ['C'] } })).body; expect(cs).toMatchObject({ roles: ['C'], mustChangeSecret: true });
    expect((await s.call('POST', '/api/people', { dev, token, body: { username: 'cashier1', displayName: 'x', secret: 'temp-123', roles: ['C'] } })).body.error).toBe('duplicate');
    for (const bad of [{ username: 'ab' }, { roles: [] }, { roles: ['Z'] }, { secret: '123' }, { grants: ['no.such'] }]) expect((await s.call('POST', '/api/people', { dev, token, body: { username: 'newone', displayName: 'x', secret: 'temp-123', roles: ['P'], ...bad } })).body.error).toBe('invalid');
    const l = (await s.call('POST', '/api/login', { dev, body: { username: 'cashier1', secret: 'temp-123' } })).body; expect(l.mustChangeSecret).toBe(true);
    const cme = (await s.call('GET', '/api/me', { dev, token: l.token })).body; const tabs = cme.ribbon.map((t: { id: string }) => t.id); expect(tabs).toContain('sales'); expect(tabs).not.toContain('adm'); expect(tabs).not.toContain('hr');
    expect((await s.call('GET', '/api/people', { dev, token: l.token })).status).toBe(403);
    expect((await s.call('POST', '/api/me/secret', { dev, token: l.token, body: { current: 'wrong', next: 'new-pass-9' } })).body.error).toBe('bad-credentials');
    expect((await s.call('POST', '/api/me/secret', { dev, token: l.token, body: { current: 'temp-123', next: 'new-pass-9' } })).status).toBe(200); expect((await s.call('GET', '/api/me', { dev, token: l.token })).body.person.mustChangeSecret).toBe(false);
    // a manager manages staff but cannot create or touch an owner
    const mg = (await s.call('POST', '/api/people', { dev, token, body: { username: 'manager1', displayName: 'مدير', secret: 'temp-123', roles: ['M'] } })).body; const mt = (await s.call('POST', '/api/login', { dev, body: { username: 'manager1', secret: 'temp-123' } })).body.token;
    expect((await s.call('POST', '/api/people', { dev, token: mt, body: { username: 'boss2', displayName: 'x', secret: 'temp-123', roles: ['O'] } })).status).toBe(403);
    const owner = (await s.call('GET', '/api/people', { dev, token })).body.people.find((p: { username: string }) => p.username === 'ahmed');
    expect((await s.call('POST', `/api/people/${owner.id}/active`, { dev, token: mt, body: { active: false, reason: 'x' } })).status).toBe(403);
    expect((await s.call('POST', `/api/people/${owner.id}/active`, { dev, token, body: { active: false, reason: 'x' } })).body.error).toBe('state');
    expect((await s.call('PATCH', `/api/people/${owner.id}`, { dev, token, body: { roles: ['M'] } })).body.error).toBe('state');
    // deactivating ends the person's sessions; nothing is deleted
    expect((await s.call('POST', `/api/people/${cs.id}/active`, { dev, token, body: { active: false, reason: 'ترك العمل' } })).body.active).toBe(false); expect((await s.call('GET', '/api/me', { dev, token: l.token })).status).toBe(401);
    expect((await s.call('POST', '/api/login', { dev, body: { username: 'cashier1', secret: 'new-pass-9' } })).body.error).toBe('inactive');
    expect((await s.call('GET', `/api/people/${cs.id}/history`, { dev, token })).body.history.map((h: { action: string }) => h.action)).toEqual(['created', 'secret_changed', 'deactivated']);
    expect(() => s.app.hub.db.exec('DELETE FROM people')).toThrow(); expect(mg.roles).toEqual(['M']);
  });
  it('every Ribbon command names real permission keys', () => { for (const t of RIBBON) for (const g of t.groups) for (const c of g.items) for (const k of c.perms) expect(PERMISSION_KEYS).toContain(k); });
});

describe('test data, items and screens', () => {
  it('loads test data through the real services on the test server only, once; items show price and stock', async () => {
    const off = prep(); const o1 = await off.setup(); expect((await off.call('POST', '/api/test/seed', { dev: o1.dev, token: o1.token })).status).toBe(404);
    const s = prep({ testMode: true }); const { dev, token } = await s.setup(); expect((await s.call('GET', '/api/dashboard', { dev, token })).body).toMatchObject({ empty: true, items: 0 });
    const r = (await s.call('POST', '/api/test/seed', { dev, token })).body; expect(r.items).toBeGreaterThan(150); expect(r.invoices).toBeGreaterThan(5); expect(r.staff).toBe(5); expect(r.customers).toBe(25);
    expect((await s.call('POST', '/api/test/seed', { dev, token })).status).toBe(500);
    const it = (await s.call('GET', '/api/items?q=باراسيتامول&limit=5', { dev, token })).body; expect(it.items.length).toBeGreaterThan(0); expect(it.items[0].priceMinor).toBeGreaterThan(0); expect(it.items[0].stock.sellable).toBeGreaterThan(0);
    const d = (await s.call('GET', '/api/dashboard', { dev, token })).body; expect(d.items).toBe(r.items); expect(d.suppliers).toBe(6); expect(d.people).toBe(6);
    const ct = (await s.call('POST', '/api/login', { dev, body: { username: 'cashier', secret: 'staff-pass-1' } })).body.token; expect((await s.call('POST', '/api/test/seed', { dev, token: ct })).status).toBe(403);
    expect(s.app.hub.verifyAudit()).toBeNull();
  });
  it('serves the built screens with the app as fallback, never files outside the folder, and unknown API paths as 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-')); writeFileSync(join(dir, 'index.html'), '<!doctype html><title>O</title>'); mkdirSync(join(dir, 'assets')); writeFileSync(join(dir, 'assets', 'a.js'), 'x');
    const s = prep({ webDir: dir }); const a = await s.f.inject({ url: '/assets/a.js' }); expect(a.headers['content-type']).toContain('javascript'); expect(a.headers['x-frame-options']).toBe('DENY');
    expect((await s.f.inject({ url: '/people' })).body).toContain('<title>O</title>'); expect((await s.f.inject({ url: '/..%2f..%2fetc%2fpasswd' })).body).toContain('<title>O</title>'); expect((await s.f.inject({ url: '/api/nope' })).statusCode).toBe(404);
  });
});
