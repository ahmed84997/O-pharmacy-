import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { MemoryTransport, PRINT_MIGRATIONS, PrintService, SkiaRasterizer, TcpTransport, buildReceipt, code39Modules, dateText, decodeEscpos, ean13Of, ean13check, money, receiptBytes, tspl, zpl, type GrayImage, type PrinterSetup, type Rasterizer } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const code = async (f: () => unknown) => { try { await f(); } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `pk${++n}`;
const white = (w: number, h = 8): GrayImage => ({ width: w, height: h, gray: new Uint8Array(w * h).fill(255) });
class FakeRaster implements Rasterizer { widths: number[] = []; last: unknown[] = []; receipt(lines: never[], w: number) { this.widths.push(w); this.last = lines; return white(w); } text(t: string) { this.last = [t]; return white(64); } }

const prep = (printers: Record<string, Partial<PrinterSetup>> = {}) => {
  const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), [...MIGRATIONS, ...POS_MIGRATIONS, ...PRINT_MIGRATIONS]); const items = new ItemService(hub);
  const bs = new BatchService(hub, items, { today: () => '2026-12-01' } as never); const sales = new SaleService(hub, items, bs, { maxDiscountPct: () => 5 }); const cust = new CustomerService(hub, sales);
  const a = items.create(owner, { nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }] }); bs.receive(owner, { key: key(), itemId: a.id, lot: 'L1', expiry: '2028-03-31', qty: 10, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4500 });
  const sid = sales.openSession(ph, { key: key(), terminal: 'T1', openingFloatMinor: 0 }).id; const c = cust.create(owner, { name: 'أحمد علي', phone: '01001234567' }); cust.setCreditLimit(owner, c.id, 100000, 'ok');
  const tr = new MemoryTransport('usb-1'); const lab = new MemoryTransport('label-1'); const raster = new FakeRaster();
  const setup: Record<string, PrinterSetup> = { counter: { transport: tr, kind: 'receipt', ...printers.counter }, labels: { transport: lab, kind: 'label', ...printers.labels } };
  const svc = new PrintService(hub, sales, raster, setup, () => ({ pharmacy: { name: 'صيدلية الشفاء', branch: 'فرع المعادي', phones: ['0225551234'] }, style: { footer: 'نتمنى لكم الشفاء العاجل' }, nameOf: id => (id === 'ph' ? 'د. منى' : id), customerNameOf: id => (id === c.id ? 'أحمد علي' : null) }));
  const sell = (o: Record<string, unknown> = {}) => sales.createSale(ph, { key: key(), sessionId: sid, lines: [{ itemId: a.id, qty: 1 }], cashMinor: 5000, ...o } as never);
  return { hub, sales, svc, tr, lab, raster, a, c, sid, sell };
};
const texts = (lines: unknown[]) => JSON.stringify(lines);

describe('code 39 and ESC/POS and labels (pure bytes)', () => {
  it('Code 39: every character is 3 wide elements out of 9, start and stop frame the text, unsupported characters are refused', () => {
    const m = code39Modules('S-000123'); expect(m.startsWith('100010111011101')).toBe(true); expect(m.endsWith('100010111011101')).toBe(true); expect(m).toBe(code39Modules('s-000123'));
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%') { const one = code39Modules(ch).slice(16, 31); const runs = one.match(/1+|0+/g)!; expect(runs).toHaveLength(9); expect(runs.filter(r => r.length === 3)).toHaveLength(3); }
    expect(() => code39Modules('عربي')).toThrow();
  });
  it('ESC/POS: init, raster in bands, feed, drawer pulse, cut; black pixels are 1 bits, most significant bit first', () => {
    const img: GrayImage = { width: 16, height: 3, gray: new Uint8Array(48).fill(255) }; img.gray[0] = 0; img.gray[17] = 0; img.gray[47] = 0;
    const d = decodeEscpos(receiptBytes(img, { drawer: true, band: 2 })); expect(d.commands).toEqual(['init', 'raster 2x2', 'raster 2x1', 'feed 4', 'drawer', 'cut']); expect(d.width).toBe(16); expect(d.height).toBe(3);
    expect([...d.bits]).toEqual([0x80, 0x00, 0x40, 0x00, 0x00, 0x01]); expect(decodeEscpos(receiptBytes(img, { cut: false })).commands).toEqual(['init', 'raster 2x3', 'feed 4']);
  });
  it('labels: EAN-13 check digit, only a right 13-digit code gets bars; TSPL and ZPL carry the text picture and the barcode command', () => {
    expect(ean13check('622103123456')).toBe('9'); expect(ean13Of('6221031234569')).toBe('6221031234569'); expect(ean13Of('622103123456')).toBe('6221031234569'); expect(ean13Of('6221031234560')).toBeNull(); expect(ean13Of('12345')).toBeNull(); expect(ean13Of(null)).toBeNull();
    const img = white(64, 4); const t = tspl(img, '6221031234569', { wmm: 40, hmm: 30 }).toString('latin1'); expect(t).toContain('SIZE 40 mm,30 mm'); expect(t).toContain('BARCODE 40,130,"EAN13",60,1,0,2,2,"6221031234569"'); expect(t).toContain('PRINT 1,1');
    expect(tspl(img, null).toString('latin1')).not.toContain('BARCODE'); const z = zpl(img, '6221031234569').toString('ascii'); expect(z).toContain('^BEN'); expect(z).toContain('^FD622103123456^FS'); expect(zpl(img, null).toString('ascii')).not.toContain('^BEN');
    const w = tspl(img, null).subarray(-20); const normal = tspl(img, null, { invert: true }); expect(Buffer.compare(tspl(img, null), normal)).not.toBe(0); expect(w.length).toBe(20);
  });
});

describe('receipt model', () => {
  it('structure of the current receipt, with the discount as its own row and a clear remaining; no phone or address on the counter copy', () => {
    const s = prep(); const sale = s.sell({ lines: [{ itemId: s.a.id, qty: 2 }], discountBp: 500, cashMinor: 2000, delivery: { name: 'سارة', phone: '01112223334', address: '١٢ شارع النصر', feeMinor: 1000 } });
    const v = s.sales.sale(owner, sale.saleNo); const ctx = { pharmacy: { name: 'صيدلية الشفاء', phones: ['0225551234'] }, cashierName: 'د. منى' };
    const counter = texts(buildReceipt(v, ctx)); expect(counter).toContain('الخصم'); expect(counter).toContain('باقي على العميل (عند التسليم)'); expect(counter).toContain('باراسيتامول 500'); expect(counter).not.toContain('01112223334'); expect(counter).not.toContain('النصر'); expect(counter).toContain('"barcode":"S-');
    const del = texts(buildReceipt(v, { ...ctx, copy: 'delivery' })); expect(del).toContain('01112223334'); expect(del).toContain('النصر'); expect(del).toContain('الهاتف');
    const lines = buildReceipt(v, ctx); const i = lines.findIndex(l => 'cols' in l && l.cols[0] === 'الصنف'); expect(lines[i]).toMatchObject({ cols: ['الصنف', 'الوحدة', 'الكمية', 'الإجمالي'] }); expect(lines[i + 1]).toMatchObject({ cols: ['باراسيتامول 500', 'علبة', '2', '100.00'] });
  });
  it('credit sale shows the account amount; a reprint is marked as a copy; Arabic digits are a setting; the date uses "-" and the pharmacy time zone; no middle dots', () => {
    const s = prep(); const sale = s.sell({ customerId: s.c.id, onCredit: true, cashMinor: undefined }); const v = s.sales.sale(owner, sale.saleNo); const ctx = { pharmacy: { name: 'ص' }, cashierName: 'x', customerName: 'أحمد علي' };
    const t = texts(buildReceipt(v, ctx)); expect(t).toContain('آجل على حساب العميل'); expect(t).toContain('العميل: أحمد علي'); expect(t).toContain('بيع آجل'); expect(t).not.toContain('نسخة مكررة');
    expect(texts(buildReceipt(v, { ...ctx, copyNo: 2 }))).toContain('نسخة مكررة رقم 2'); const ar = texts(buildReceipt(v, { ...ctx, style: { digits: 'arabic' } })); expect(ar).toContain('٥٠.٠٠'); expect(ar).not.toMatch(/[·•]/);
    expect(dateText('2026-12-01T10:05:00Z')).toBe('01-12-2026 12:05'); expect(money(123456)).toBe('1234.56');
  });
});

describe('print service', () => {
  it('the original opens the drawer for a cash sale; a card sale does not; a reprint needs a reason, is marked as copy 2 and never opens the drawer; the log keeps all of it', async () => {
    const s = prep(); const cash = s.sell(); const r1 = await s.svc.printReceipt(ph, { saleNo: cash.saleNo, printer: 'counter' }); expect(r1).toMatchObject({ ok: true, copyNo: 1, drawer: true }); expect(decodeEscpos(s.tr.sent[0]!).commands).toContain('drawer');
    expect(await code(() => s.svc.printReceipt(ph, { saleNo: cash.saleNo, printer: 'counter' }))).toBe('invalid'); const r2 = await s.svc.printReceipt(ph, { saleNo: cash.saleNo, printer: 'counter', reason: 'customer lost it' }); expect(r2).toMatchObject({ ok: true, copyNo: 2, drawer: false }); expect(decodeEscpos(s.tr.sent[1]!).commands).not.toContain('drawer'); expect(texts(s.raster.last)).toContain('نسخة مكررة رقم 2');
    const card = s.sell({ cashMinor: undefined, payments: [{ method: 'card', amountMinor: 5000, ref: 'A1' }] }); expect((await s.svc.printReceipt(ph, { saleNo: card.saleNo, printer: 'counter' })).drawer).toBe(false);
    const log = s.svc.jobs(mgr, { ref: cash.saleNo }); expect(log.map(j => [j.copyNo, j.status, j.drawer, j.reason])).toEqual([[2, 'sent', false, 'customer lost it'], [1, 'sent', true, null]]); expect(() => s.hub.db.prepare('UPDATE print_jobs SET status=?').run('x')).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM print_jobs').run()).toThrow();
  });
  it('a printer that fails is logged, the sale stays, nothing throws, and the retry is still the original with the drawer', async () => {
    const s = prep(); const sale = s.sell(); s.tr.failWith = 'printer offline'; const bad = await s.svc.printReceipt(ph, { saleNo: sale.saleNo, printer: 'counter' }); expect(bad).toMatchObject({ ok: false, error: 'printer offline' }); expect(s.sales.sale(owner, sale.saleNo).status).toBe('posted');
    expect(s.svc.jobs(mgr, { failedOnly: true })).toHaveLength(1); s.tr.failWith = undefined; expect(await s.svc.printReceipt(ph, { saleNo: sale.saleNo, printer: 'counter' })).toMatchObject({ ok: true, copyNo: 1, drawer: true });
  });
  it('the delivery copy is separate from the counter copy and needs a delivery; paper width picks the dot width; a label printer is not a receipt printer; unknown printer', async () => {
    const s = prep({ counter: { paperWidthMm: 58 } }); const plain = s.sell(); expect(await code(() => s.svc.printReceipt(ph, { saleNo: plain.saleNo, printer: 'counter', copy: 'delivery' }))).toBe('invalid');
    const d = s.sell({ cashMinor: undefined, delivery: { name: 'سارة', phone: '01112223334', address: 'عنوان', feeMinor: 0 } }); await s.svc.printReceipt(ph, { saleNo: d.saleNo, printer: 'counter' }); const dc = await s.svc.printReceipt(ph, { saleNo: d.saleNo, printer: 'counter', copy: 'delivery' }); expect(dc).toMatchObject({ ok: true, copyNo: 1 }); expect(s.raster.widths).toEqual([384, 384]);
    expect(await code(() => s.svc.printReceipt(ph, { saleNo: d.saleNo, printer: 'labels' }))).toBe('invalid'); expect(await code(() => s.svc.printReceipt(ph, { saleNo: d.saleNo, printer: 'nope' }))).toBe('not-found');
  });
  it('who may print: your own sale only (without sale.view_all); drawer without a sale needs management and a reason; the log is for reviewers', async () => {
    const s = prep(); const sale = s.sell(); const other: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] }; expect(await code(() => s.svc.printReceipt(other, { saleNo: sale.saleNo, printer: 'counter' }))).toBe('forbidden');
    expect(await code(() => s.svc.openDrawer(ph, { printer: 'counter', reason: 'change' }))).toBe('forbidden'); expect(await code(() => s.svc.openDrawer(mgr, { printer: 'counter', reason: ' ' }))).toBe('invalid');
    expect(await s.svc.openDrawer(mgr, { printer: 'counter', reason: 'give change' })).toMatchObject({ ok: true, drawer: true }); expect(decodeEscpos(s.tr.sent[0]!).commands).toEqual(['init', 'drawer']); expect(await code(() => s.svc.jobs(other))).toBe('forbidden');
  });
  it('labels: copies, language per printer, barcode only when valid; limits', async () => {
    const s = prep(); expect(await s.svc.printLabel(ph, { printer: 'labels', name: 'باراسيتامول', priceMinor: 5000, barcode: '6221031234569', copies: 3 })).toMatchObject({ ok: true, copyNo: 3 }); const sent = s.lab.sent[0]!.toString('latin1'); expect(sent.match(/PRINT 1,1/g)).toHaveLength(3); expect(sent).toContain('"EAN13"');
    const z = prep({ labels: { labelLanguage: 'zpl' } }); await z.svc.printLabel(ph, { printer: 'labels', name: 'x', barcode: '123' }); expect(z.lab.sent[0]!.toString('ascii')).toContain('^XA'); expect(z.lab.sent[0]!.toString('ascii')).not.toContain('^BEN');
    expect(await code(() => s.svc.printLabel(ph, { printer: 'labels', name: 'x', copies: 0 }))).toBe('invalid'); expect(await code(() => s.svc.printLabel(ph, { printer: 'labels', name: ' ' }))).toBe('invalid'); expect(await code(() => s.svc.printLabel(ph, { printer: 'counter', name: 'x' }))).toBe('invalid');
  });
});

describe('real rendering and network transport', () => {
  it('Skia draws an Arabic receipt at 80 mm and 58 mm with real marks, and the bytes decode back to the same size', () => {
    const s = prep(); const sale = s.sell({ discountBp: 500 }); const lines = buildReceipt(s.sales.sale(owner, sale.saleNo), { pharmacy: { name: 'صيدلية الشفاء', branch: 'فرع المعادي', phones: ['0225551234'] }, cashierName: 'د. منى', style: { footer: 'نتمنى لكم الشفاء العاجل', returnPolicy: 'الاستبدال خلال ١٤ يومًا بالفاتورة الأصلية', showExpiry: true, reserveQr: true } });
    const r = new SkiaRasterizer(); for (const w of [576, 384]) { const img = r.receipt(lines, w); expect(img.width).toBe(w); expect(img.height).toBeGreaterThan(300); const dark = img.gray.filter(v => v < 128).length; expect(dark).toBeGreaterThan(2000); expect(dark).toBeLessThan(img.gray.length / 3); const d = decodeEscpos(receiptBytes(img)); expect(d.width).toBe(Math.ceil(w / 8) * 8); expect(d.height).toBe(img.height); }
    const t = r.text('باراسيتامول\n50.00'); expect(t.gray.some(v => v < 128)).toBe(true);
  });
  it('the TCP transport sends the exact bytes to port 9100 style printers and reports a refused connection', async () => {
    const got: Buffer[] = []; const srv = createServer(c => { c.on('data', d => got.push(d)); }); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r)); const port = (srv.address() as { port: number }).port;
    await new TcpTransport('net', '127.0.0.1', port).send(Buffer.from([1, 2, 3, 4])); await new Promise(r => setTimeout(r, 50)); expect(Buffer.concat(got)).toEqual(Buffer.from([1, 2, 3, 4])); await new Promise<void>(r => srv.close(() => r()));
    await expect(new TcpTransport('net', '127.0.0.1', port, 500).send(Buffer.from([1]))).rejects.toThrow();
  });
});
