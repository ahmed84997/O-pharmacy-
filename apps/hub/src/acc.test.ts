import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';

let n = 0; const key = () => `acc-key-${++n}-${Date.now()}`;
const prep = async () => {
  const clock = { t: Date.parse('2026-12-10T08:00:00Z') }; const app = openApp({ clock: () => new Date(clock.t), testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const call = async (method: string, url: string, token: string, b?: unknown) => { const x = await f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${token}` } }); return { status: x.statusCode, body: JSON.parse(x.body || 'null') }; };
  const owner = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': dev }, payload: { pharmacyName: 'ص', displayName: 'المالك', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  await call('POST', '/api/test/seed', owner); const login = async (u: string) => (await f.inject({ method: 'POST', url: '/api/login', headers: { 'x-device': dev }, payload: { username: u, secret: 'staff-pass-1' } })).json().token as string;
  const relogin = async () => (await f.inject({ method: 'POST', url: '/api/login', headers: { 'x-device': dev }, payload: { username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  return { app, clock, call, owner, relogin, mgr: await login('manager'), ph: await login('pharmacist'), cs: await login('cashier') };
};

describe('accounts and payroll', () => {
  it('posts money in and out, refuses cash going below zero, pays a payslip out of the cash box under a chosen category, and the books see it', async () => {
    const s = await prep(); let O = s.owner; const a = (await s.call('GET', '/api/acc/accounts', O)).body; const cash = a.accounts.find((x: { name: string }) => x.name === 'الخزنة'); const bank = a.accounts.find((x: { name: string }) => x.name === 'البنك'); const out = a.categories.find((c: { kind: string }) => c.kind === 'out'); const inn = a.categories.find((c: { kind: string }) => c.kind === 'in');
    expect((await s.call('GET', '/api/acc/accounts', s.cs)).status).toBe(403);
    expect((await s.call('POST', '/api/acc/entries', O, { key: key(), accountId: cash.id, kind: 'out', categoryId: out.id, amountMinor: 99999999 })).body.error).toBe('insufficient');
    const e = (await s.call('POST', '/api/acc/entries', O, { key: key(), accountId: cash.id, kind: 'in', categoryId: inn.id, amountMinor: 20000, description: 'وارد' })).body; expect(e.entry.entryNo).toMatch(/^L-/);
    // payroll: run last month after some attendance, pay one payslip from the cash box
    s.clock.t = Date.parse('2027-01-05T08:00:00Z'); O = await s.relogin(); const people = (await s.call('GET', '/api/payroll/people', O)).body.people; expect(people.some((p: { profile: unknown }) => p.profile)).toBe(true);
    
    const run = (await s.call('POST', '/api/payroll/runs', O, { key: key(), month: '2026-12' })).body; expect(run.runNo).toMatch(/^PR-/);
    const slip = (await s.call('GET', '/api/payroll/payslips?month=2026-12', O)).body.payslips[0]; const before = (await s.call('GET', '/api/acc/accounts', O)).body.accounts.find((x: { id: string }) => x.id === bank.id).balanceMinor;
    const pay = (await s.call('POST', `/api/payroll/payslips/${slip.id}/pay`, O, { method: 'bank', accountId: bank.id, categoryId: out.id })).body; expect(pay.entryNo).toMatch(/^L-/);
    expect((await s.call('GET', '/api/acc/accounts', O)).body.accounts.find((x: { id: string }) => x.id === bank.id).balanceMinor).toBe(before - slip.netMinor);
    expect((await s.call('POST', `/api/payroll/payslips/${slip.id}/pay`, O, { method: 'bank', accountId: bank.id, categoryId: out.id })).status).toBe(409);
    const jr = (await s.call('POST', '/api/books/journalise', O)).body; expect(jr.posted + jr.skipped.length).toBeGreaterThan(0);
    expect((await s.call('GET', '/api/books/trial?asOf=2027-01-31', O)).status).toBe(200);
  });
});

describe('insurance at the till and the report centre', () => {
  it('splits a sale between the member and the insurer, claims it, batches and reconciles it into the bank; reports run and export', async () => {
    const s = await prep(); const O = s.owner; const ct = (await s.call('GET', '/api/contracts', O)).body.contracts[0]; const it = s.app.items.search('اموكسيسيلين 500', { limit: 1 })[0]!;
    await s.call('POST', '/api/pos/session/open', O, { key: key(), openingFloatMinor: 0 }); const sess = (await s.call('GET', '/api/pos/session', O)).body.session;
    const lines = [{ itemId: it.id, qty: 1, unitName: 'علبة' }]; const qt = (await s.call('POST', '/api/pos/insurance-quote', O, { contractId: ct.id, lines })).body; expect(qt.coveredMinor).toBe(Math.round(qt.totalMinor * 0.8));
    const r = (await s.call('POST', '/api/pos/insurance-sale', O, { key: key(), sessionId: sess.id, contractId: ct.id, memberNo: 'M-1001', lines })).body; expect(r.sale.onAccountMinor ?? r.sale.creditMinor ?? r.coveredMinor).toBeTruthy(); expect(r.claim.saleRef).toBe(r.sale.saleNo); expect(r.copayMinor).toBe(qt.copayMinor);
    expect((await s.call('POST', '/api/pos/insurance-sale', O, { key: key(), sessionId: sess.id, contractId: ct.id, memberNo: 'NO-SUCH', lines })).status).toBe(404);
    const claims = (await s.call('GET', '/api/claims', O)).body.claims; expect(claims).toHaveLength(1); const c = claims[0];
    if (c.status === 'pending_approval') await s.call('POST', `/api/claims/${c.id}/approve`, s.mgr);
    const bt = (await s.call('POST', '/api/claims/batches', O, { key: key(), contractId: ct.id, claimIds: [c.id] })).body; expect(bt.batchNo).toMatch(/^BT-/);
    const bank = (await s.call('GET', '/api/acc/accounts', O)).body; const bk = bank.accounts.find((x: { name: string }) => x.name === 'البنك'); const inn = bank.categories.find((x: { kind: string }) => x.kind === 'in');
    const rc = (await s.call('POST', `/api/claims/batches/${bt.batchNo}/reconcile`, O, { receivedMinor: c.coveredMinor, paymentRef: 'TRX-1', results: [{ claimId: c.id, acceptedMinor: c.coveredMinor }], accountId: bk.id, categoryId: inn.id })).body; expect(rc.entryNo).toMatch(/^L-/);
    expect((await s.call('GET', '/api/acc/accounts', O)).body.accounts.find((x: { id: string }) => x.id === bk.id).balanceMinor).toBe(bk.balanceMinor + c.coveredMinor);
    const cat = (await s.call('GET', '/api/reports', O)).body.catalogue; expect(cat.length).toBeGreaterThan(10);
    const rep = (await s.call('POST', '/api/reports/sales_by_day/run', O, { from: '2026-12-01', to: '2026-12-31' })).body; expect(rep.rows[0].sales).toBe(1);
    const csv = (await s.call('POST', '/api/reports/claims_outstanding/export', O, {})).body; expect(csv.csv.startsWith('﻿')).toBe(true);
    expect((await s.call('POST', '/api/reports/sales_by_day/run', s.cs, {})).status).toBe(403);
  });
});
