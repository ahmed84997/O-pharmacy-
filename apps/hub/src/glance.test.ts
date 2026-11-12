import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';

let n = 0; const key = () => `glance-key-${++n}-${Date.now()}`;
const prep = async () => {
  const clock = { t: Date.parse('2026-12-10T07:00:00Z') }; const app = openApp({ clock: () => new Date(clock.t), testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const call = async (method: string, url: string, token: string, b?: unknown) => { const x = await f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${token}` } }); return { status: x.statusCode, body: JSON.parse(x.body || 'null') }; };
  const owner = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': dev }, payload: { pharmacyName: 'ص', displayName: 'المالك', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  await call('POST', '/api/test/seed', owner); const login = async (u: string) => (await f.inject({ method: 'POST', url: '/api/login', headers: { 'x-device': dev }, payload: { username: u, secret: 'staff-pass-1' } })).json().token as string;
  return { app, call, owner, cs: await login('cashier'), acc: await login('accountant') };
};

describe('side bar counts and the alert strip (Sprint 7.7)', () => {
  it('counts and lists near expiry, shortages and ready requests for those who may see them, and keeps its settings', async () => {
    const s = await prep();
    await s.call('POST', '/api/requests', s.owner, { key: key(), kind: 'shortage', items: [{ itemName: 'كونكور 5 مجم', qty: 3 }] });
    const g = (await s.call('GET', '/api/glance', s.owner)).body;
    expect(g.counts.shortages).toBe(1); expect(g.counts.nearExpiry).toBeGreaterThan(0); expect(g.settings).toMatchObject({ enabled: true, expiryMonths: 3 });
    expect(g.ticker.find((e: { kind: string }) => e.kind === 'shortage')).toMatchObject({ name: 'كونكور 5 مجم', qty: 3 });
    const ex = g.ticker.find((e: { kind: string }) => e.kind === 'expiry'); expect(ex.expiry).toMatch(/^\d{4}-\d{2}$/); expect(ex.qty).toBeGreaterThan(0);
    // the accountant does not work the shortage notebook or customer requests: no count, no strip entries for them
    const a = (await s.call('GET', '/api/glance', s.acc)).body; expect(a.counts.shortages).toBeUndefined(); expect(a.counts.ready).toBeUndefined(); expect(a.ticker.some((e: { kind: string }) => e.kind === 'shortage')).toBe(false);
    expect((await s.call('GET', '/api/glance', s.cs)).body.counts.held).toBe(0);
    // settings: only with settings.branch, validated, and the strip can be turned off
    expect((await s.call('POST', '/api/settings/ticker', s.cs, { enabled: false })).status).toBe(403);
    expect((await s.call('POST', '/api/settings/ticker', s.owner, { expiryMonths: 0 })).body.error).toBe('invalid');
    expect((await s.call('POST', '/api/settings/ticker', s.owner, { expiryMonths: 6, showLowStock: false })).body).toMatchObject({ enabled: true, expiryMonths: 6, showLowStock: false });
    expect((await s.call('GET', '/api/glance', s.owner)).body.ticker.some((e: { kind: string }) => e.kind === 'low')).toBe(false);
    await s.call('POST', '/api/settings/ticker', s.owner, { enabled: false });
    const off = (await s.call('GET', '/api/glance', s.owner)).body; expect(off.ticker).toEqual([]); expect(off.counts.shortages).toBe(1);
  });
});
