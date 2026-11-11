import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signLicence } from '@o-pharmacy/core';
import { openApp } from './compose';
import { buildServer } from './server';
import { SystemService } from './system';

const keys = () => { const k = generateKeyPairSync('ed25519'); return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'pem' }).toString() }; };
const prep = async (o: { requireLicence?: boolean; pub?: string | null } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-')); const clock = { t: Date.parse('2026-12-10T08:00:00Z') }; const app = openApp({ dbPath: join(dir, 'o-pharmacy.db'), clock: () => new Date(clock.t) });
  const system = new SystemService(app, { dataDir: dir, requireLicence: o.requireLicence, licencePublicKey: o.pub ?? null }); const f = buildServer(app, { system });
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const token = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': dev }, payload: { pharmacyName: 'ص', displayName: 'م', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  const call = async (method: string, url: string, b?: unknown) => { const x = await f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${token}` } }); return { status: x.statusCode, body: JSON.parse(x.body || 'null') }; };
  return { app, dir, clock, system, call };
};

describe('backups and the licence', () => {
  it('makes a consistent backup on request and once a day, and lists them', async () => {
    const s = await prep(); const b = (await s.call('POST', '/api/system/backup')).body; expect(b.name).toMatch(/^o-pharmacy-\d{8}-\d{6}-manual\.db$/); expect(b.bytes).toBeGreaterThan(10000);
    expect(existsSync(join(s.dir, 'backups', b.name))).toBe(true); s.system.backup('daily'); expect((await s.call('GET', '/api/system/info')).body.backups).toHaveLength(2);
  });
  it('without a required licence everything works; with one, a missing or expired licence makes the program read-only but readable; a valid one for this pharmacy unlocks it', async () => {
    const free = await prep(); expect((await free.call('GET', '/api/system/info')).body.licence).toMatchObject({ state: 'valid', required: false });
    const k = keys(); const s = await prep({ requireLicence: true, pub: k.pub }); const info = (await s.call('GET', '/api/system/info')).body; expect(info.licence.state).toBe('invalid');
    expect((await s.call('POST', '/api/inv/items', { nameAr: 'x', kind: 'non_drug', units: [{ name: 'قطعة', factor: 1 }] })).body.message).toMatch(/read-only/); expect((await s.call('GET', '/api/people')).status).toBe(200);
    const other = signLicence(k.priv, { tenantId: 'someone-else', edition: 'single', maxBranches: 1, features: [], issuedAt: '2026-12-01T00:00:00Z', expiresAt: '2027-12-01T00:00:00Z', graceDays: 14 });
    expect((await s.call('POST', '/api/system/licence', { token: other })).body.message).toMatch(/wrong-tenant/);
    const good = signLicence(k.priv, { tenantId: info.tenantId, edition: 'single', maxBranches: 1, features: [], issuedAt: '2026-12-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', graceDays: 7 });
    expect((await s.call('POST', '/api/system/licence', { token: good })).body.state).toBe('valid'); expect((await s.call('POST', '/api/inv/items', { nameAr: 'صنف', kind: 'non_drug', units: [{ name: 'قطعة', factor: 1 }] })).status).toBe(200);
    s.clock.t = Date.parse('2027-01-05T08:00:00Z'); expect(s.system.licence().state).toBe('grace'); expect((await s.call('GET', '/api/state')).body.readOnly).toBe(false);
    s.clock.t = Date.parse('2027-01-20T08:00:00Z'); expect((await s.call('GET', '/api/state')).body.readOnly).toBe(true);
  });
});
