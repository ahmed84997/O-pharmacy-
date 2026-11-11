import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';

let n = 0; const key = () => `test-key-${++n}-${Date.now()}`;
const prep = async () => {
  const clock = { t: Date.parse('2026-12-10T08:00:00Z') }; const app = openApp({ clock: () => new Date(clock.t), testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const call = async (method: string, url: string, o: { body?: unknown; dev?: string; token?: string } = {}) => { const r = await f.inject({ method: method as 'GET', url, payload: o.body as object, headers: { ...(o.dev ? { 'x-device': o.dev } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } }); return { status: r.statusCode, body: r.headers['content-type']?.toString().includes('json') ? JSON.parse(r.body) : r.rawPayload, headers: r.headers }; };
  const reg = async (name: string) => { const r = await call('POST', '/api/devices/register', { body: { name, kind: 'desktop' } }); return `${r.body.id}.${r.body.secret}`; };
  const dev = await reg('كاشير 1'); const owner = (await call('POST', '/api/setup', { dev, body: { pharmacyName: 'صيدلية التجربة', displayName: 'د. أحمد', username: 'ahmed', secret: 'owner-pass-1' } })).body.token as string;
  await call('POST', '/api/test/seed', { dev, token: owner });
  const login = async (u: string, d = dev) => (await call('POST', '/api/login', { dev: d, body: { username: u, secret: 'staff-pass-1' } })).body.token as string;
  const dev2 = await reg('كاشير 2'); await call('POST', `/api/devices/${dev2.split('.')[0]}/approve`, { dev, token: owner });
  const cashier = await login('cashier', dev2); const manager = await login('manager');
  const para = app.items.search('باراسيتامول 500', { limit: 1 })[0]!; const bc = app.items.barcodes(para.id)[0]!.barcode;
  return { app, f, clock, call, dev, dev2, owner, cashier, manager, para, bc };
};

describe('the till', () => {
  it('opens a session on this terminal, finds an item by barcode, previews the FEFO price, sells for cash, prints and previews the receipt', async () => {
    const s = await prep(); const C = { dev: s.dev2, token: s.cashier };
    expect((await s.call('GET', '/api/pos/session', C)).body).toMatchObject({ session: null, terminal: 'كاشير 2' });
    expect((await s.call('POST', '/api/pos/session/open', { ...C, body: { key: 'short', openingFloatMinor: 10000 } })).body.error).toBe('invalid');
    const k = key(); const op = (await s.call('POST', '/api/pos/session/open', { ...C, body: { key: k, openingFloatMinor: 10000 } })).body; expect(op.sessionNo).toBeTruthy(); expect((await s.call('POST', '/api/pos/session/open', { ...C, body: { key: k, openingFloatMinor: 10000 } })).body.replay).toBe(true);
    const lk = (await s.call('GET', `/api/pos/lookup?code=${s.bc}`, C)).body; expect(lk.item.id).toBe(s.para.id); expect(lk.unitName).toBe('علبة'); expect(lk.item.priceMinor).toBeGreaterThan(0); expect((await s.call('GET', '/api/pos/lookup?code=0000', C)).body.item).toBeNull();
    const q = (await s.call('POST', '/api/pos/quote', { ...C, body: { lines: [{ itemId: s.para.id, qty: 2, unitName: 'علبة' }] } })).body.lines[0]; expect(q.amountMinor).toBe(2 * lk.item.priceMinor); expect(q.missingBase).toBe(0);
    const sale = (await s.call('POST', '/api/pos/sales', { ...C, body: { key: key(), sessionId: op.id, lines: [{ itemId: s.para.id, qty: 2, unitName: 'علبة' }], cashMinor: q.amountMinor + 500 } })).body; expect(sale).toMatchObject({ totalMinor: q.amountMinor, changeMinor: 500 });
    expect((await s.call('POST', '/api/pos/sales', { ...C, body: { key: key(), sessionId: op.id, lines: [{ itemId: s.para.id, qty: 1, unitName: 'علبة' }], cashMinor: 1 } })).body.error).toBe('underpaid');
    expect((await s.call('POST', '/api/pos/sales', { ...C, body: { key: key(), sessionId: op.id, lines: [{ itemId: s.para.id, qty: 99999, unitName: 'علبة' }], cashMinor: 1 } })).status).toBe(409);
    const png = await s.call('GET', `/api/print/preview/${sale.saleNo}`, C); expect(png.headers['content-type']).toBe('image/png'); expect((png.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    expect((await s.call('POST', '/api/print/receipt', { ...C, body: { saleNo: sale.saleNo, printer: 'none' } })).body.error).toBe('not-found');
    expect((await s.call('POST', '/api/settings/printers', { ...C, body: { printers: [] } })).status).toBe(403);
    expect((await s.call('POST', '/api/settings/printers', { dev: s.dev, token: s.owner, body: { printers: [{ name: 'x', kind: 'receipt', transport: { type: 'file', path: '/etc/x' } }] } })).body.error).toBe('invalid');
    expect((await s.call('POST', '/api/settings/printers', { dev: s.dev, token: s.owner, body: { printers: [{ name: 'الكاشير', kind: 'receipt', transport: { type: 'preview' } }], style: { footer: 'شكرا لزيارتكم' }, phones: '0123' } })).status).toBe(200);
    const pr = (await s.call('POST', '/api/print/receipt', { ...C, body: { saleNo: sale.saleNo, printer: 'الكاشير' } })).body; expect(pr).toMatchObject({ ok: true, copyNo: 1 });
    expect((await s.call('POST', '/api/print/receipt', { ...C, body: { saleNo: sale.saleNo, printer: 'الكاشير' } })).body.error).toBe('invalid'); // a reprint needs a reason
    expect((await s.call('POST', '/api/print/receipt', { ...C, body: { saleNo: sale.saleNo, printer: 'الكاشير', reason: 'العميل طلب نسخة' } })).body.copyNo).toBe(2);
    const det = (await s.call('GET', `/api/pos/sales/${sale.saleNo}`, C)).body; expect(det.sale.lines.length).toBeGreaterThan(0); expect((await s.call('GET', '/api/pos/sales', C)).body.sales[0]).toMatchObject({ saleNo: sale.saleNo, createdByName: 'كاشير (تجريبي)' });
  });
  it('holds and resumes a bill, returns part of a sale to the drawer, voids by management only, and closes the session blind', async () => {
    const s = await prep(); const C = { dev: s.dev2, token: s.cashier }; const M = { dev: s.dev, token: s.manager };
    const op = (await s.call('POST', '/api/pos/session/open', { ...C, body: { key: key(), openingFloatMinor: 10000 } })).body; const L = [{ itemId: s.para.id, qty: 3, unitName: 'علبة' }];
    const h = (await s.call('POST', '/api/pos/holds', { ...C, body: { key: key(), sessionId: op.id, lines: L, note: 'هيرجع' } })).body; expect((await s.call('GET', '/api/pos/holds', C)).body.holds).toHaveLength(1);
    const rs = (await s.call('POST', `/api/pos/holds/${h.id}/resume`, C)).body; expect(rs.lines[0].qty).toBe(3);
    const q = (await s.call('POST', '/api/pos/quote', { ...C, body: { lines: L } })).body.lines[0].amountMinor; const sale = (await s.call('POST', '/api/pos/sales', { ...C, body: { key: key(), sessionId: op.id, lines: L, cashMinor: q, fromHold: h.id } })).body;
    expect((await s.call('GET', '/api/pos/holds', C)).body.holds).toHaveLength(0);
    const cid = (await s.call('GET', '/api/people', { dev: s.dev, token: s.owner })).body.people.find((p: { username: string }) => p.username === 'cashier').id; expect((await s.call('POST', '/api/pos/returns', { ...C, body: { key: key(), saleNo: sale.saleNo, sessionId: op.id, lines: [{ lineNo: 1, qty: 1, unitName: 'علبة' }], reasonCode: 'changed_mind' } })).status).toBe(403);
    await s.call('PATCH', `/api/people/${cid}`, { dev: s.dev, token: s.owner, body: { grants: ['sale.return'] } });
    const retR = (await s.call('POST', '/api/pos/returns', { ...C, body: { key: key(), saleNo: sale.saleNo, sessionId: op.id, lines: [{ lineNo: 1, qty: 1, unitName: 'علبة' }], reasonCode: 'changed_mind', refund: { method: 'cash' } } })); const ret = retR.body; expect(ret.cashMinor).toBe(q / 3);
    const s2 = (await s.call('POST', '/api/pos/sales', { ...C, body: { key: key(), sessionId: op.id, lines: [{ itemId: s.para.id, qty: 1, unitName: 'علبة' }], cashMinor: q } })).body;
    expect((await s.call('POST', `/api/pos/sales/${s2.saleNo}/void`, { ...C, body: { reason: 'غلط' } })).status).toBe(403);
    expect((await s.call('POST', `/api/pos/sales/${s2.saleNo}/void`, { ...M, body: { reason: 'سطر غلط' } })).status).toBe(200);
    // the manager cannot close the cashier's session; the cashier counts blind
    expect((await s.call('POST', `/api/pos/session/${op.id}/close`, { ...M, body: { countedCashMinor: 0 } })).status).toBe(403);
    const cl = (await s.call('POST', `/api/pos/session/${op.id}/close`, { ...C, body: { countedCashMinor: 10000 + q - q / 3 - 100, note: 'ناقص جنيه' } })).body; expect(cl.closed).toBe(true); expect(cl.diffMinor).toBeUndefined();
    const mine = (await s.call('GET', `/api/pos/sessions/${op.id}/report`, C)).body.report; expect(mine.drawer).toBeUndefined(); expect(mine.returns.count).toBe(1);
    const rv = (await s.call('GET', `/api/pos/sessions/${op.id}/report`, M)).body.report; expect(rv.drawer.diffMinor).toBe(-100);
    const day = (await s.call('GET', '/api/pos/day', M)).body; expect(day.blockers.unreviewed).toEqual([rv.sessionNo]);
    expect((await s.call('POST', '/api/pos/day/close', { ...M, body: { key: key(), date: day.date } })).body.error).toBe('state');
    expect((await s.call('POST', `/api/pos/sessions/${op.id}/review`, { ...M, body: { decision: 'accepted' } })).body.error).toBe('invalid');
    await s.call('POST', `/api/pos/sessions/${op.id}/review`, { ...M, body: { decision: 'accepted', note: 'اتصرف في فكة' } });
    const closed = (await s.call('POST', '/api/pos/day/close', { ...M, body: { key: key(), date: day.date } })).body; expect(closed.totals.salesCount).toBe(1); expect(closed.totals.returnsMinor).toBe(q / 3);
    expect((await s.call('GET', '/api/pos/sessions', M)).body.sessions[0]).toMatchObject({ userName: 'كاشير (تجريبي)', status: 'closed', diffMinor: -100 });
    expect(s.app.hub.verifyAudit()).toBeNull();
  });
});
