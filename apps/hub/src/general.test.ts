import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';

const prep = async () => {
  const app = openApp({ testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const call = async (method: string, url: string, token: string, b?: unknown) => { const x = await f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${token}` } }); return { status: x.statusCode, body: JSON.parse(x.body || 'null') }; };
  const owner = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': dev }, payload: { pharmacyName: 'صيدلية تجربة', displayName: 'المالك', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  await call('POST', '/api/test/seed', owner);
  const cs = (await f.inject({ method: 'POST', url: '/api/login', headers: { 'x-device': dev }, payload: { username: 'cashier', secret: 'staff-pass-1' } })).json().token as string;
  return { f, call, owner, cs };
};

describe('General data (Sprint 7.11)', () => {
  it('keeps the pharmacy data, shows the support phone before login, and only to those with settings', async () => {
    const s = await prep();
    expect((await s.call('POST', '/api/settings/pharmacy', s.owner, { name: 'صيدلية د. أحمد', phones: '01515319449 - 39785150', address: 'أجا', supportPhone: '01000000000', taxRegNo: '123-456-789' })).body).toEqual({ ok: true });
    expect((await s.call('GET', '/api/settings/pharmacy', s.owner)).body).toEqual({ name: 'صيدلية د. أحمد', phones: '01515319449 - 39785150', address: 'أجا', supportPhone: '01000000000', taxRegNo: '123-456-789', commercialRegNo: '' });
    // a field left out keeps its value; the name stays required
    await s.call('POST', '/api/settings/pharmacy', s.owner, { name: 'صيدلية د. أحمد', commercialRegNo: '55' });
    expect((await s.call('GET', '/api/settings/pharmacy', s.owner)).body).toMatchObject({ address: 'أجا', commercialRegNo: '55' });
    expect((await s.call('POST', '/api/settings/pharmacy', s.owner, { name: ' ' })).body.error).toBe('invalid');
    expect((await s.call('POST', '/api/settings/pharmacy', s.owner, { name: 'x', address: 'a'.repeat(200) })).body.error).toBe('invalid');
    expect((await s.call('GET', '/api/settings/pharmacy', s.cs)).status).toBe(403);
    const st = (await s.f.inject({ method: 'GET', url: '/api/state' })).json(); expect(st).toMatchObject({ pharmacyName: 'صيدلية د. أحمد', supportPhone: '01000000000' });
  });

  it('puts the General data tab first for the owner, with the database size in About', async () => {
    const s = await prep();
    const me = (await s.call('GET', '/api/me', s.owner)).body; expect(me.ribbon[0].id).toBe('gen');
    const cmds = me.ribbon[0].groups.flatMap((g: { items: { id: string }[] }) => g.items.map(c => c.id)); expect(cmds).toEqual(['org', 'opsettings', 'rcptset', 'labelset', 'barcodes', 'drawer', 'contractpaper', 'backup', 'backupauto', 'dbsize']);
    const info = (await s.call('GET', '/api/system/info', s.owner)).body; expect(info.db.bytes).toBeGreaterThan(0); expect(info.db.freeBytes).toBeGreaterThanOrEqual(0);
    expect((await s.call('GET', '/api/system/info', s.cs)).body.db).toBeNull();
  });
  it('the strip of tabs is a pharmacy setting: on by default, the owner can turn it off, the cashier cannot', async () => {
    const s = await prep();
    expect((await s.call('GET', '/api/me', s.owner)).body.ui).toEqual({ tabs: true });
    expect((await s.call('POST', '/api/settings/ui', s.owner, { tabs: false })).body.ui).toEqual({ tabs: false });
    expect((await s.call('GET', '/api/me', s.cs)).body.ui).toEqual({ tabs: false });
    expect((await s.call('POST', '/api/settings/ui', s.cs, { tabs: true })).status).toBe(403); expect((await s.call('POST', '/api/settings/ui', s.owner, { tabs: 'x' })).body.error).toBe('invalid');
  });
});
