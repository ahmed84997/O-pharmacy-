import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAW_PRINTER_CS } from '@o-pharmacy/print';
import { openApp } from './compose';
import { buildServer } from './server';
import { RELAY_OFFLINE } from './print-relay';

const prep = async () => {
  const app = openApp({ testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const reg = async () => { const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); return { id: r.json().id as string, h: `${r.json().id}.${r.json().secret}` }; };
  const main = await reg();
  const owner = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': main.h }, payload: { pharmacyName: 'ص', displayName: 'المالك', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  const call = async (method: string, url: string, b?: unknown, dev = main.h) => { const x = await f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${owner}` } }); return { status: x.statusCode, body: JSON.parse(x.body || 'null') }; };
  const agent = (dev: string, wait = 2) => f.inject({ method: 'GET', url: `/api/agent/next?wait=${wait}`, headers: { 'x-device': dev } });
  const answer = (dev: string, b: unknown) => f.inject({ method: 'POST', url: '/api/agent/result', payload: b as object, headers: { 'x-device': dev } }).then(r => r.json());
  return { app, f, reg, main, call, agent, answer };
};

describe('printing on the cashier PC through its desktop app (D39)', () => {
  it('hands the bytes to the asking device, returns its answer, and refuses devices that are not connected or not approved', async () => {
    const s = await prep();
    expect((await s.call('POST', '/api/settings/printers', { printers: [{ name: 'كاشير', kind: 'receipt', transport: { type: 'device' } }] })).status).toBe(200);
    expect((await s.call('GET', '/api/print/printers')).body.printers[0]).toMatchObject({ name: 'كاشير', type: 'device' });
    // no app connected from this device yet (a browser): a clear Arabic error, logged as a failed job
    const off = (await s.call('POST', '/api/print/drawer', { printer: 'كاشير', reason: 'فكة' })).body; expect(off).toMatchObject({ ok: false, error: RELAY_OFFLINE });
    // the app waits; the drawer command reaches it; it answers "printed"
    const wait = s.agent(s.main.h, 5); await new Promise(r => setTimeout(r, 50));
    const printing = s.call('POST', '/api/print/drawer', { printer: 'كاشير', reason: 'فكة' });
    const job = (await wait).json(); expect(job.kind).toBe('receipt'); expect(Buffer.from(job.bytes, 'base64').length).toBeGreaterThan(0);
    // another approved device cannot answer this job
    const other = await s.reg(); await s.call('POST', `/api/devices/${other.id}/approve`);
    expect((await s.answer(other.h, { id: job.id, ok: true })).ok).toBe(false);
    expect((await s.answer(s.main.h, { id: job.id, ok: true })).ok).toBe(true);
    expect((await printing).body).toMatchObject({ ok: true, drawer: true });
    // a failure on the PC comes back as the print's error
    const w2 = s.agent(s.main.h, 5); await new Promise(r => setTimeout(r, 50)); const p2 = s.call('POST', '/api/print/drawer', { printer: 'كاشير', reason: 'فكة' });
    const j2 = (await w2).json(); await s.answer(s.main.h, { id: j2.id, ok: false, error: 'الورق خلص' }); expect((await p2).body).toMatchObject({ ok: false, error: 'الورق خلص' });
    // nothing to do: 204 after the wait
    expect((await s.agent(s.main.h, 1)).statusCode).toBe(204);
    // a device waiting for approval, or an unknown one, gets nothing
    const pend = await s.reg(); expect((await s.agent(pend.h, 1)).statusCode).toBe(403); expect((await s.agent('x.y', 1)).statusCode).toBe(401);
    const jobs = (await s.call('GET', '/api/print/jobs')).body.jobs; expect(jobs.map((j: { status: string }) => j.status)).toEqual(['failed', 'sent', 'failed']);
  });

  it('the desktop app prints with the same spooler helper as the Hub', () => {
    const ps = readFileSync(join(__dirname, '..', '..', 'desktop', 'print-raw.ps1'), 'utf8');
    expect(ps.replace(/\r/g, '')).toContain(RAW_PRINTER_CS.trim());
  });
});
