import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';
import { SystemService } from './system';

let n = 0; const key = () => `p712-key-${++n}-${Date.now()}`;
const prep = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'o712-')); const app = openApp({ testMode: true, clock: () => new Date('2026-12-10T08:00:00Z') }); const system = new SystemService(app, { dataDir: dir }); const f = buildServer(app, { system, staffSecret: 'staff-pass-1' });
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const raw = (method: string, url: string, token: string, b?: unknown) => f.inject({ method: method as 'GET', url, payload: b as object, headers: { 'x-device': dev, authorization: `Bearer ${token}` } });
  const call = async (method: string, url: string, token: string, b?: unknown) => { const x = await raw(method, url, token, b); return { status: x.statusCode, body: x.headers['content-type']?.toString().startsWith('application/json') ? JSON.parse(x.body || 'null') : x.body, type: String(x.headers['content-type'] ?? '') }; };
  const O = (await f.inject({ method: 'POST', url: '/api/setup', headers: { 'x-device': dev }, payload: { pharmacyName: 'صيدلية د. ياسمين', displayName: 'المالك', username: 'ahmed', secret: 'owner-pass-1' } })).json().token as string;
  await call('POST', '/api/test/seed', O);
  const cs = (await f.inject({ method: 'POST', url: '/api/login', headers: { 'x-device': dev }, payload: { username: 'cashier', secret: 'staff-pass-1' } })).json().token as string;
  await call('POST', '/api/settings/pharmacy', O, { name: 'صيدلية د. ياسمين', phones: '01515319449 - 39785150' });
  await call('POST', '/api/settings/printers', O, { printers: [{ name: 'كاشير', kind: 'receipt', transport: { type: 'preview' } }, { name: 'ستيكر', kind: 'label', labelMm: [38, 25], gapMm: 3, density: 12, offsetX: 8, transport: { type: 'preview' } }] });
  return { app, f, call, O, cs, dir, system };
};

describe('Sprint 7.12 printing', () => {
  it('prints stickers for many items with their quantities, with what the print dialog chose; the item comes with its expiries and barcode', async () => {
    const s = await prep(); const a = s.app.items.search('اموكسيسيلين 500', { limit: 1 })[0]!; const b = s.app.items.search('باراسيتامول', { limit: 1 })[0]!;
    const li = (await s.call('GET', `/api/print/label-item/${a.id}`, s.O)).body.item; expect(li).toMatchObject({ id: a.id, code: a.code }); expect(li.batches.length).toBeGreaterThan(0); expect(li.batches[0].expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(li.stock).toBeGreaterThan(0);
    const r = (await s.call('POST', '/api/print/labels', s.O, { lines: [{ itemId: a.id, copies: 3 }, { itemId: b.id, copies: 2, priceMinor: 1250, expiry: '2027-10-31' }], show: { phone: false } })).body;
    expect(r.printer).toBe('ستيكر'); expect(r.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, true]); expect(r.stickers).toBe(5);
    expect((await s.call('POST', '/api/print/labels', s.O, { lines: [] })).body.error).toBe('invalid');
    expect((await s.call('POST', '/api/print/label-test', s.O, {})).body).toMatchObject({ ok: true, printer: 'ستيكر' }); expect((await s.call('POST', '/api/print/label-test', s.cs, {})).status).toBe(403);
    // the printer settings of the roll are kept and checked
    const pr = (await s.call('GET', '/api/settings/printers', s.O)).body.printers.find((p: { name: string }) => p.name === 'ستيكر'); expect(pr).toMatchObject({ labelMm: [38, 25], gapMm: 3, density: 12, offsetX: 8, speed: 4, language: 'tspl' });
  });

  it('keeps the sticker and receipt settings (only the keys sent change), previews them as pictures, and keeps them from the cashier', async () => {
    const s = await prep();
    expect((await s.call('POST', '/api/settings/label-style', s.O, { showPhone: false, pharmacyName: 'صيدلية د/ ياسمين خالد' })).body.style).toMatchObject({ showPhone: false, showPharmacy: true, pharmacyName: 'صيدلية د/ ياسمين خالد', showPrice: true });
    expect((await s.call('POST', '/api/settings/label-style', s.cs, { showPhone: true })).status).toBe(403);
    await s.call('POST', '/api/settings/receipt-style', s.O, { header: 'الصحة خير من الرزق', copies: 2, minPrintMinor: 200, askBeforePrint: true, printSeller: false, template: 'table' });
    await s.call('POST', '/api/settings/receipt-style', s.O, { footer: 'نتمنى لكم الشفاء العاجل', copies: 9 });
    const st = (await s.call('GET', '/api/settings/receipt-style', s.O)).body.style; expect(st).toMatchObject({ header: 'الصحة خير من الرزق', footer: 'نتمنى لكم الشفاء العاجل', copies: 5, minPrintMinor: 200, askBeforePrint: true, printSeller: false, template: 'table' });
    // the printers screen saving its few style keys does not wipe the others
    await s.call('POST', '/api/settings/printers', s.O, { printers: [{ name: 'كاشير', kind: 'receipt', transport: { type: 'preview' } }], style: { showExpiry: true } });
    expect((await s.call('GET', '/api/settings/receipt-style', s.O)).body.style).toMatchObject({ copies: 5, header: 'الصحة خير من الرزق', showExpiry: true });
    const png = await s.call('POST', '/api/print/receipt-sample', s.O, { style: { template: 'compact' } }); expect(png.status).toBe(200); expect(png.type).toBe('image/png');
    const lp = await s.call('POST', '/api/print/label-preview', s.O, { mm: [50, 30] }); expect(lp.type).toBe('image/png');
    expect((await s.call('POST', '/api/print/receipt-sample', s.cs, {})).status).toBe(403);
  });

  it('the dose goes on stickers when there is a label printer, otherwise on one slip on the receipt printer', async () => {
    const s = await prep(); const a = s.app.items.search('اموكسيسيلين 500', { limit: 1 })[0]!;
    const lab = (await s.call('POST', '/api/print/dose', s.O, { patient: 'منى', lines: [{ itemId: a.id, dose: 'كبسولة كل 8 ساعات' }, { itemId: a.id, dose: '' }] })).body; expect(lab.mode).toBe('label'); expect(lab.results.map((x: { ok: boolean }) => x.ok)).toEqual([true, false]);
    await s.call('POST', '/api/settings/printers', s.O, { printers: [{ name: 'كاشير', kind: 'receipt', transport: { type: 'preview' } }] });
    const slip = (await s.call('POST', '/api/print/dose', s.O, { lines: [{ itemId: a.id, dose: 'كبسولة كل 8 ساعات' }] })).body; expect(slip).toMatchObject({ mode: 'slip', printer: 'كاشير' }); expect(slip.results[0].ok).toBe(true);
  });

  it('periodic backups: the hour, how many to keep, and a second folder that gets every copy; bad values are refused', async () => {
    const s = await prep(); const second = join(mkdtempSync(join(tmpdir(), 'o712usb-')), 'O-Pharmacy-backups');
    expect((await s.call('POST', '/api/system/backup-schedule', s.O, { hour: 5, keep: 7, copyDir: second })).body.schedule).toMatchObject({ hour: 5, keep: 7, copyDir: second });
    const b = (await s.call('POST', '/api/system/backup', s.O)).body; expect(existsSync(join(second, b.name))).toBe(true);
    expect((await s.call('GET', '/api/system/backup-schedule', s.O)).body.schedule.lastCopy).toMatchObject({ ok: true });
    expect((await s.call('POST', '/api/system/backup-schedule', s.O, { hour: 24 })).body.error).toBe('invalid'); expect((await s.call('POST', '/api/system/backup-schedule', s.O, { copyDir: 'backups' })).body.error).toBe('invalid');
    expect((await s.call('POST', '/api/system/backup-schedule', s.cs, { hour: 4 })).status).toBe(403);
    // 10:00 in Cairo is after 05:00 and there has been no daily copy: the hourly check makes one, in both folders
    s.app.access.setSetting('backup.last', '2026-12-08T08:00:00.000Z', 'test'); s.system.tick(); expect(readdirSync(second).some(f => f.endsWith('-daily.db'))).toBe(true);
  });

  it('the contract paper invoice: the claim of an insurance sale with the member, the contract and the lines', async () => {
    const s = await prep(); const ct = (await s.call('GET', '/api/contracts', s.O)).body.contracts[0]; const it = s.app.items.search('اموكسيسيلين 500', { limit: 1 })[0]!;
    await s.call('POST', '/api/pos/session/open', s.O, { key: key(), openingFloatMinor: 0 }); const sess = (await s.call('GET', '/api/pos/session', s.O)).body.session;
    const r = (await s.call('POST', '/api/pos/insurance-sale', s.O, { key: key(), sessionId: sess.id, contractId: ct.id, memberNo: 'M-1001', lines: [{ itemId: it.id, qty: 1, unitName: 'علبة' }] })).body;
    const p = (await s.call('GET', `/api/claims/paper?ref=${encodeURIComponent(r.sale.saleNo)}`, s.O)).body;
    expect(p.claim).toMatchObject({ saleRef: r.sale.saleNo, coveragePercent: 80 }); expect(p.member.memberNo).toBe('M-1001'); expect(p.contract.name).toBeTruthy(); expect(p.lines).toHaveLength(1); expect(p.pharmacy.name).toBe('صيدلية د. ياسمين'); expect(p.pharmacy.phones).toEqual(['01515319449', '39785150']);
    expect((await s.call('GET', '/api/claims/paper?ref=NOPE', s.O)).status).toBe(404);
  });
  it('sizes: the barcode is off, on a thermal roll, or on A4 sheets (columns × rows); the sale invoice is a receipt or A4, and an A4 print is counted like a receipt', async () => {
    const s = await prep();
    expect((await s.call('POST', '/api/settings/label-style', s.O, { mode: 'a4', a4Layout: '6x24' })).body.style).toMatchObject({ mode: 'a4', a4Layout: '6x24' });
    expect((await s.call('POST', '/api/settings/label-style', s.O, { a4Layout: '9x9' })).body.error).toBe('invalid');
    const ls = (await s.call('GET', '/api/settings/label-style', s.O)).body; expect(ls.layouts).toEqual(expect.arrayContaining(['6x24', '5x20', '6x19', '7x12', '6x17']));
    expect((await s.call('POST', '/api/print/label-preview', s.O, { mm: [33.6, 12], dpmm: 12 })).type).toBe('image/png');
    expect((await s.call('POST', '/api/settings/receipt-style', s.O, { paper: 'a4' })).body.style.paper).toBe('a4');
    await s.call('POST', '/api/pos/session/open', s.O, { key: key(), openingFloatMinor: 0 }); const sess = (await s.call('GET', '/api/pos/session', s.O)).body.session; const it = s.app.items.search('اموكسيسيلين 500', { limit: 1 })[0]!;
    const sale = (await s.call('POST', '/api/pos/sales', s.O, { key: key(), sessionId: sess.id, lines: [{ itemId: it.id, qty: 1, unitName: 'علبة' }], cashMinor: 100000 })).body;
    const a = (await s.call('POST', '/api/print/receipt-a4', s.O, { saleNo: sale.saleNo })).body; expect(a).toMatchObject({ ok: true, copyNo: 1, seller: 'المالك' }); expect(a.sale.saleNo).toBe(sale.saleNo); expect(a.pharmacy.name).toBe('صيدلية د. ياسمين');
    expect((await s.call('POST', '/api/print/receipt-a4', s.O, { saleNo: sale.saleNo })).body.error).toBe('invalid');
    expect((await s.call('POST', '/api/print/receipt-a4', s.O, { saleNo: sale.saleNo, reason: 'العميل طلب نسخة' })).body.copyNo).toBe(2);
    // a receipt after the A4 prints is a copy too
    expect((await s.call('POST', '/api/print/receipt', s.O, { saleNo: sale.saleNo, printer: 'كاشير' })).body.error).toBe('invalid');
  });
});
