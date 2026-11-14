import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { ClosingService, CustomerService, POS_MIGRATIONS, SaleService } from '@o-pharmacy/pos';
import { MemoryTransport, PRINT_MIGRATIONS, PrintService, SkiaRasterizer, TcpTransport, buildReceipt, code39Modules, dateText, decodeEscpos, ean13Of, ean13check, money, receiptBytes, tspl, zpl, barcodeFor, code128Modules, ean13Modules, expiryText, toBits, type GrayImage, type LabelSpec, type PrinterSetup, type Rasterizer } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const code = async (f: () => unknown) => { try { await f(); } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `pk${++n}`;
const white = (w: number, h = 8): GrayImage => ({ width: w, height: h, gray: new Uint8Array(w * h).fill(255) });
class FakeRaster implements Rasterizer { widths: number[] = []; last: unknown[] = []; labels: { spec: LabelSpec; w: number; h: number; o?: unknown }[] = []; receipt(lines: never[], w: number) { this.widths.push(w); this.last = lines; return white(w); } text(t: string) { this.last = [t]; return white(64); } label(spec: LabelSpec, w: number, h: number, o?: unknown) { this.labels.push({ spec, w, h, o }); return white(w, h); } }

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
    const v = s.sales.sale(owner, sale.saleNo); const ctx = { pharmacy: { name: 'صيدلية الشفاء', phones: ['0225551234'] }, cashierName: 'د. منى', style: { template: 'compact' as const } };
    const counter = texts(buildReceipt(v, ctx)); expect(counter).toContain('الخصم'); expect(counter).toContain('باقي على العميل (عند التسليم)'); expect(counter).toContain('باراسيتامول 500'); expect(counter).not.toContain('01112223334'); expect(counter).not.toContain('النصر'); expect(counter).toContain('"barcode":"S-');
    const del = texts(buildReceipt(v, { ...ctx, copy: 'delivery' })); expect(del).toContain('01112223334'); expect(del).toContain('النصر'); expect(del).toContain('الهاتف');
    const lines = buildReceipt(v, ctx); const i = lines.findIndex(l => 'cols' in l && l.cols[0] === 'الصنف'); expect(lines[i]).toMatchObject({ cols: ['الصنف', 'الوحدة', 'الكمية', 'الإجمالي'] }); expect(lines[i + 1]).toMatchObject({ cols: ['باراسيتامول 500', 'علبة', '2', '100.00'] });
  });
  it('credit sale shows the account amount; a reprint is marked as a copy; Arabic digits are a setting; the date uses "-" and the pharmacy time zone; no middle dots', () => {
    const s = prep(); const sale = s.sell({ customerId: s.c.id, onCredit: true, cashMinor: undefined }); const v = s.sales.sale(owner, sale.saleNo); const ctx = { pharmacy: { name: 'ص' }, cashierName: 'x', customerName: 'أحمد علي', style: { template: 'compact' as const } };
    const t = texts(buildReceipt(v, ctx)); expect(t).toContain('آجل على حساب العميل'); expect(t).toContain('العميل: أحمد علي'); expect(t).toContain('بيع آجل'); expect(t).not.toContain('نسخة مكررة');
    expect(texts(buildReceipt(v, { ...ctx, copyNo: 2 }))).toContain('نسخة مكررة رقم 2'); const ar = texts(buildReceipt(v, { ...ctx, style: { template: 'compact', digits: 'arabic' } })); expect(ar).toContain('٥٠.٠٠'); expect(ar).not.toMatch(/[·•]/);
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

describe('drawer closing report', () => {
  it('the reviewer copy has expected, counted and difference; the cashier copy is blind; a reprint is a marked copy with a reason', async () => {
    const s = prep(); const closing = new ClosingService(s.hub, s.sales); const svc = new PrintService(s.hub, s.sales, s.raster, { counter: { transport: s.tr, kind: 'receipt' } }, () => ({ pharmacy: { name: 'صيدلية الشفاء' }, nameOf: id => id }), closing);
    s.sell(); s.sales.closeSession(ph, s.sid, { countedCashMinor: 4000, note: 'short' }); const rev = await svc.printSessionReport(mgr, { sessionId: s.sid, printer: 'counter' }); expect(rev).toMatchObject({ ok: true, copyNo: 1, drawer: false }); const t = texts(s.raster.last); expect(t).toContain('المتوقع في الدرج'); expect(t).toContain('عجز'); expect(t).toContain('تقرير قفل الدرج');
    const mine = await svc.printSessionReport(ph, { sessionId: s.sid, printer: 'counter', reason: 'cashier copy' }); expect(mine.copyNo).toBe(2); expect(texts(s.raster.last)).not.toContain('المتوقع'); expect(texts(s.raster.last)).toContain('نسخة مكررة رقم 2');
    expect(await code(() => svc.printSessionReport(mgr, { sessionId: s.sid, printer: 'counter' }))).toBe('invalid'); expect(await code(() => s.svc.printSessionReport(mgr, { sessionId: s.sid, printer: 'counter' }))).toBe('invalid'); expect(decodeEscpos(s.tr.sent[0]!).commands).not.toContain('drawer');
  });
});

describe('ETA QR on the receipt', () => {
  it('the receipt carries the QR text from the ETA queue; the picture is a real QR with more black than the placeholder', async () => {
    const s = prep(); const sale = s.sell(); const url = 'https://invoicing.eta.gov.eg/receipts/search/' + 'a'.repeat(64) + '/share/2026-12-01T10:00:00Z#Total:50.000,IssuerRIN:123456789';
    const svc = new PrintService(s.hub, s.sales, s.raster, { counter: { transport: s.tr, kind: 'receipt' } }, () => ({ pharmacy: { name: 'ص' }, nameOf: id => id, qrTextOf: no => (no === sale.saleNo ? url : null) })); await svc.printReceipt(ph, { saleNo: sale.saleNo, printer: 'counter' }); expect(s.raster.last).toContainEqual({ qr: true, text: url });
    const lines = [{ t: 'x', size: 24 }, { qr: true as const, text: url }]; const r = new SkiaRasterizer(); const img = r.receipt(lines, 576); const holder = r.receipt([{ t: 'x', size: 24 }, { qr: true as const }], 576); expect(img.gray.filter(v => v < 128).length).toBeGreaterThan(holder.gray.filter(v => v < 128).length); expect(img.height).toBeGreaterThan(200);
    const none = prep(); const s2 = none.sell(); await none.svc.printReceipt(ph, { saleNo: s2.saleNo, printer: 'counter' }); expect(JSON.stringify(none.raster.last)).not.toContain('"qr"');
  });
});

describe('Sprint 7.12: the receipt as a table, stickers drawn whole, slips', () => {
  it('the table receipt: line above, name, phones, registrations; customer, number, seller; bordered items; totals in boxes; no branch code or made-up lot; expiry as MM/YYYY', () => {
    const s = prep(); const sale = s.sell({ customerId: s.c.id, lines: [{ itemId: s.a.id, qty: 2 }], discountBp: 500, cashMinor: 20000 }); const v = s.sales.sale(owner, sale.saleNo);
    const L = buildReceipt(v, { pharmacy: { name: 'صيدلية د. ياسمين', phones: ['01515319449', '39785150'], taxRegNo: '123-456', branch: 'B1' }, cashierName: 'د. منى', customerName: 'أحمد علي', style: { header: 'الصحة خير من الرزق', footer: 'نتمنى لكم الشفاء العاجل', showExpiry: true, showBatch: true } });
    const t = texts(L); expect(L[0]).toMatchObject({ t: 'الصحة خير من الرزق' }); expect(L[1]).toMatchObject({ t: 'صيدلية د. ياسمين', bold: true }); expect(t).toContain('ت/ 01515319449 - 39785150'); expect(t).toContain('س.ض 123-456'); expect(t).not.toContain('B1');
    expect(t).toContain('اسم العميل / أحمد علي'); expect(t).toContain(`رقم الفاتورة : ${sale.saleNo}`); expect(t).toContain('البائع / د. منى');
    const table = L.find(l => 'table' in l) as { table: { head: string[]; rows: string[][] } }; expect(table.table.head).toEqual(['اسم الصنف', 'الوحدة', 'الكمية', 'اجمالي السعر']); expect(table.table.rows[0]![0]).toContain('باراسيتامول 500'); expect(table.table.rows[0]![0]).toContain('صلاحية 03/2028'); expect(table.table.rows[0]![0]).toContain('تشغيلة L1');
    const boxes = (L.find(l => 'boxes' in l) as { boxes: { label: string; value: string }[] }).boxes; expect(boxes.map(b => b.label)).toEqual(['عدد القطع', 'الاجمالي', 'الخصم', 'المطلوب', 'مدفوع نقدًا', 'الباقي للعميل']); expect(boxes[0]!.value).toBe('2'); expect(boxes[3]!.value).toBe('95.00');
    expect(t).toContain('تاريخ الفاتورة'); expect(t).toContain('"barcode"'); expect(t).toContain('نتمنى لكم الشفاء العاجل'); expect(t).not.toMatch(/[·•]/);
    // the customer and seller lines are settings
    const t2 = texts(buildReceipt(v, { pharmacy: { name: 'ص' }, cashierName: 'د. منى', customerName: 'أحمد علي', style: { printCustomer: false, printSeller: false } })); expect(t2).not.toContain('اسم العميل'); expect(t2).not.toContain('البائع');
    expect(expiryText('2027-01-31')).toBe('01/2027'); expect(expiryText('9999-12-31')).toBe('');
  });
  it('a lot the program made (PI-...) is never printed; copies print in one job and only the first opens the drawer; the side margin is a setting', async () => {
    const s = prep(); const v = s.sales.sale(owner, s.sell().saleNo); const fake = { ...v, lines: v.lines.map(l => ({ ...l, lot: 'PI-000014-1' })) };
    expect(texts(buildReceipt(fake as never, { pharmacy: { name: 'ص' }, cashierName: 'x', style: { showBatch: true } }))).not.toContain('PI-000014-1');
    const s2 = prep(); const svc = new PrintService(s2.hub, s2.sales, s2.raster, { counter: { transport: s2.tr, kind: 'receipt', sideMarginMm: 4 } }, () => ({ pharmacy: { name: 'ص' }, style: { copies: 2 }, nameOf: x => x }));
    const r = await svc.printReceipt(ph, { saleNo: s2.sell().saleNo, printer: 'counter' }); expect(r).toMatchObject({ ok: true, drawer: true });
    const bytes = s2.tr.sent[0]!; const cmds = [] as string[]; let i = 0; while (i < bytes.length) { const part = bytes.subarray(i); const d = (() => { try { return decodeEscpos(part); } catch { return null; } })(); if (d) { cmds.push(...d.commands); break; } i++; }
    expect(cmds.filter(c => c === 'cut')).toHaveLength(2); expect(cmds.filter(c => c === 'drawer')).toHaveLength(1);
  });
  it('barcodes: EAN-13 for a valid international code, Code 128 for the pharmacy codes; both are real symbols', () => {
    expect(barcodeFor('6221031234569')).toMatchObject({ kind: 'ean13' }); expect(barcodeFor('622103123456')).toMatchObject({ kind: 'ean13', text: '6221031234569' }); expect(barcodeFor('26824')).toMatchObject({ kind: 'code128' }); expect(barcodeFor('ب')).toBeNull(); expect(barcodeFor('')).toBeNull();
    const e = ean13Modules('6221031234569')!; expect(e).toHaveLength(95); expect(e.startsWith('101') && e.endsWith('101') && e.slice(45, 50) === '01010').toBe(true); expect(ean13Modules('6221031234560')).toBeNull();
    const c = code128Modules('ABC-12')!; expect(c.length % 11).toBe(2); expect(c.endsWith('1100011101011')).toBe(true); // every symbol is 11 modules, the stop is 13
    expect(code128Modules('123456')!.length).toBeLessThan(code128Modules('ABCDEF')!.length); // digits pack two per symbol
  });
  it('price and dose stickers: the whole sticker is one picture at the roll size with the nudge, printed N times; TSPL and ZPL; limits', async () => {
    const s = prep({ labels: { labelMm: [38, 25], gapMm: 3, density: 10, speed: 3, offsetX: 8, offsetY: -4 } });
    const spec: LabelSpec = { kind: 'price', name: 'بانادول اكسترا', barcode: '6221031234569', code: '26824', pharmacy: 'صيدلية د. ياسمين', phone: '01515319449', price: '4.00 ج', expiry: '10/27' };
    const r = await s.svc.printLabels(ph, { printer: 'labels', items: [{ spec, copies: 3 }, { spec: { kind: 'dose', name: 'اوجمنتين', dose: 'قرص كل 12 ساعة بعد الأكل' }, copies: 1 }] });
    expect(r.map(x => x.ok)).toEqual([true, true]); expect(s.raster.labels[0]).toMatchObject({ w: 304, h: 200, o: { dx: 8, dy: -4 } });
    const job = s.lab.sent[0]!.toString('latin1'); expect(job).toContain('SIZE 38 mm,25 mm'); expect(job).toContain('GAP 3 mm,0 mm'); expect(job).toContain('DENSITY 10'); expect(job).toContain('SPEED 3'); expect(job).toContain('BITMAP 0,0,38,200,0,'); expect(job).toContain('PRINT 3,1'); expect(job).not.toContain('BARCODE');
    const z = prep({ labels: { labelLanguage: 'zpl' } }); await z.svc.printLabels(ph, { printer: 'labels', items: [{ spec, copies: 2 }] }); const zj = z.lab.sent[0]!.toString('ascii'); expect(zj).toContain('^PW320'); expect(zj).toContain('^PQ2');
    expect(await code(() => s.svc.printLabels(ph, { printer: 'labels', items: [{ spec, copies: 0 }] }))).toBe('invalid'); expect(await code(() => s.svc.printLabels(ph, { printer: 'labels', items: [] }))).toBe('invalid'); expect(await code(() => s.svc.printLabels(ph, { printer: 'counter', items: [{ spec }] }))).toBe('invalid');
  });
  it('Skia draws a real sticker: bars in the middle, text above and below, inside the roll', () => {
    const img = new SkiaRasterizer().label({ kind: 'price', name: 'بانادول اكسترا 24 قرص', barcode: '6221031234569', code: '26824', pharmacy: 'صيدلية د. ياسمين', phone: '01515319449', price: '4.00 ج', expiry: '10/27' }, 320, 240);
    expect(img.width).toBe(320); expect(img.height).toBe(240); const black = (y0: number, y1: number) => { let n2 = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 320; x++) if (img.gray[y * 320 + x]! < 128) n2++; return n2; };
    expect(black(0, 40)).toBeGreaterThan(80); expect(black(60, 140)).toBeGreaterThan(3000); expect(black(200, 240)).toBeGreaterThan(80);
    const dose = new SkiaRasterizer().label({ kind: 'dose', name: 'اوجمنتين 1 جم', dose: 'قرص كل 12 ساعة بعد الأكل', patient: 'منى', pharmacy: 'صيدلية', phone: '0100' }, 320, 240); expect(toBits(dose).data.some(b => b !== 0)).toBe(true);
    const rc = new SkiaRasterizer().receipt([{ table: { widths: [0.5, 0.5], head: ['أ', 'ب'], rows: [['اسم طويل جدا جدا جدا جدا جدا جدا جدا جدا جدا جدا', '1']] } }, { boxes: [{ label: 'المطلوب', value: '10.00', bold: true }] }], 576); expect(rc.height).toBeGreaterThan(120);
  });
  it('a free slip goes to the receipt printer and is logged', async () => {
    const s = prep(); const r = await s.svc.printSlip(ph, { printer: 'counter', lines: [{ t: 'اوجمنتين', bold: true }], ref: 'dose', kind: 'dose' }); expect(r.ok).toBe(true); expect(decodeEscpos(s.tr.sent[0]!).commands).not.toContain('drawer');
    expect(await code(() => s.svc.printSlip(ph, { printer: 'labels', lines: [], ref: 'x', kind: 'dose' }))).toBe('invalid');
  });
});
