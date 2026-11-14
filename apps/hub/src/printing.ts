import { createCanvas } from '@napi-rs/canvas';
import { buildReceipt, FileTransport, MemoryTransport, PrintService, SkiaRasterizer, TcpTransport, WindowsSpoolerTransport, type LabelSpec, type PharmacyInfo, type PrinterSetup, type PrintEnv, type ReceiptStyle, type SaleView } from '@o-pharmacy/print';
import type { GrayImage } from '@o-pharmacy/print';
import type { Person } from '@o-pharmacy/core';
import type { App } from './compose';
import { AccessError } from './access';
import { PrintRelay, RelayTransport } from './print-relay';

/** A printer as the pharmacy sets it up (settings screen). `windows` = a printer installed in Windows (raw ESC/POS through the spooler), `tcp` = a network printer (port 9100), `preview` = no printer: the receipt is only shown on screen (test server). `device` = the Windows printer of the PC that asks for the print (each cashier on its own printer, chosen in its desktop app, D39). */
export interface PrinterConfig { name: string; kind: 'receipt' | 'label'; paperWidthMm?: 58 | 80; drawerOnCash?: boolean; /** label rolls (Sprint 7.12) */ labelMm?: [number, number]; gapMm?: number; density?: number; speed?: number; offsetX?: number; offsetY?: number; language?: 'tspl' | 'zpl'; invert?: boolean; /** receipt side margin, mm */ sideMarginMm?: number; transport: { type: 'windows'; printer: string } | { type: 'tcp'; host: string; port?: number } | { type: 'file'; path: string } | { type: 'preview' } | { type: 'device' } }
const raster = new SkiaRasterizer();

export function printers(app: App): PrinterConfig[] { try { return JSON.parse(app.access.setting('printers') ?? '[]') as PrinterConfig[]; } catch { return []; } }
export function receiptStyle(app: App): ReceiptStyle { try { return { reserveQr: false, ...(JSON.parse(app.access.setting('receipt.style') ?? '{}') as ReceiptStyle) }; } catch { return {}; } }
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
const intIn = (v: unknown, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
/** The receipt settings ("إعدادات طباعة فاتورة البيع", Sprint 7.12): only known keys, each checked; keys left out keep their value. */
export function mergeReceiptStyle(cur: ReceiptStyle, b: Record<string, unknown>): ReceiptStyle {
  const o: ReceiptStyle = { ...cur };
  if (b.header !== undefined) o.header = clip(b.header, 200); if (b.footer !== undefined) o.footer = clip(b.footer, 300); if (b.returnPolicy !== undefined) o.returnPolicy = clip(b.returnPolicy, 300);
  for (const k of ['showExpiry', 'showBatch', 'showUnitPrice', 'printCustomer', 'printSeller', 'askBeforePrint'] as const) if (b[k] !== undefined) o[k] = b[k] === true;
  if (b.template !== undefined) o.template = b.template === 'compact' ? 'compact' : 'table'; if (b.paper !== undefined) o.paper = b.paper === 'a4' ? 'a4' : 'receipt';
  if (b.copies !== undefined) o.copies = intIn(b.copies, 1, 5, 1); if (b.minPrintMinor !== undefined) o.minPrintMinor = intIn(b.minPrintMinor, 0, 100_000_00, 0); if (b.sideMarginMm !== undefined) o.sideMarginMm = intIn(b.sideMarginMm, 0, 8, 1);
  if (b.digits !== undefined) o.digits = b.digits === 'arabic' ? 'arabic' : 'western';
  return o;
}
/** The sticker settings ("إعدادات طباعة الباركود"): what prints on a price sticker by default (the print screen can change it per print). */
/** A4 sticker sheets as eStock lists them: columns × rows. */
export const A4_LAYOUTS = ['6x24', '5x20', '6x19', '7x12', '6x17', '5x13', '4x10', '3x8'] as const;
export interface LabelStyle { showPharmacy: boolean; pharmacyName: string; showPhone: boolean; phone: string; showPrice: boolean; showExpiry: boolean; /** لا يوجد / حراري / A4 */ mode: 'none' | 'thermal' | 'a4'; a4Layout: string }
export function labelStyle(app: App): LabelStyle {
  let v: Partial<LabelStyle> = {}; try { v = JSON.parse(app.access.setting('label.style') ?? '{}') as Partial<LabelStyle>; } catch { /* defaults */ }
  return { showPharmacy: v.showPharmacy !== false, pharmacyName: v.pharmacyName ?? '', showPhone: v.showPhone !== false, phone: v.phone ?? '', showPrice: v.showPrice !== false, showExpiry: v.showExpiry !== false, mode: v.mode === 'none' || v.mode === 'a4' ? v.mode : 'thermal', a4Layout: (A4_LAYOUTS as readonly string[]).includes(v.a4Layout ?? '') ? v.a4Layout! : '5x20' };
}
export function saveLabelStyle(app: App, actor: Person, b: Record<string, unknown>): LabelStyle {
  const cur = labelStyle(app); const o: LabelStyle = { ...cur };
  for (const k of ['showPharmacy', 'showPhone', 'showPrice', 'showExpiry'] as const) if (b[k] !== undefined) o[k] = b[k] === true;
  if (b.pharmacyName !== undefined) o.pharmacyName = clip(b.pharmacyName, 60); if (b.phone !== undefined) o.phone = clip(b.phone, 40);
  if (b.mode !== undefined) o.mode = b.mode === 'none' || b.mode === 'a4' ? b.mode : 'thermal'; if (b.a4Layout !== undefined) { if (!(A4_LAYOUTS as readonly string[]).includes(String(b.a4Layout))) throw new AccessError('invalid', 'unknown A4 sheet'); o.a4Layout = String(b.a4Layout); }
  app.access.setSetting('label.style', JSON.stringify(o), actor.id); app.hub.audit(actor.id, 'settings.label_style', 'settings', 'label.style', o); return o;
}
/** The pharmacy as it prints (from "بيانات المؤسسة"): phones may be written with commas or " - ". */
export function pharmacyInfo(app: App): PharmacyInfo {
  const g = (k: string) => app.access.setting(k) ?? ''; const phones = g('pharmacy.phones').split(/\s*[,،]\s*|\s+-\s+/).map(x => x.trim()).filter(Boolean);
  return { name: g('pharmacy.name') || 'O Pharmacy', phones, address: g('pharmacy.address') || undefined, taxRegNo: g('pharmacy.tax_reg_no') || undefined, commercialRegNo: g('pharmacy.commercial_reg_no') || undefined };
}
export function savePrinters(app: App, actor: Person, list: unknown): PrinterConfig[] {
  if (!Array.isArray(list) || list.length > 10) throw new AccessError('invalid', 'up to 10 printers');
  const names = new Set<string>(); const out = list.map((x): PrinterConfig => {
    const p = x as PrinterConfig; const name = String(p?.name ?? '').trim(); if (!name || names.has(name)) throw new AccessError('invalid', 'each printer needs a unique name'); names.add(name);
    if (p.kind !== 'receipt' && p.kind !== 'label') throw new AccessError('invalid', 'printer kind must be receipt or label'); const t = p.transport as PrinterConfig['transport']; const ex = extras(p);
    if (t?.type === 'windows' && String(t.printer ?? '').trim()) return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: p.drawerOnCash !== false, ...ex, transport: { type: 'windows', printer: String(t.printer).trim() } };
    if (t?.type === 'tcp' && /^[A-Za-z0-9.-]+$/.test(String(t.host ?? ''))) return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: p.drawerOnCash !== false, ...ex, transport: { type: 'tcp', host: String(t.host), port: Number(t.port) || 9100 } };
    if (t?.type === 'device') return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: p.drawerOnCash !== false, ...ex, transport: { type: 'device' } };
    if (t?.type === 'preview') return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: false, ...ex, transport: { type: 'preview' } };
    throw new AccessError('invalid', 'choose how the printer is connected');
  });
  app.access.setSetting('printers', JSON.stringify(out), actor.id); app.hub.audit(actor.id, 'settings.printers', 'settings', 'printers', { count: out.length }); return out;
}
/** the label roll and margin fields of a printer, checked */
function extras(p: PrinterConfig): Partial<PrinterConfig> {
  const o: Partial<PrinterConfig> = {};
  if (p.kind === 'label') {
    const lm = Array.isArray(p.labelMm) ? p.labelMm : [40, 30]; o.labelMm = [intIn(lm[0], 20, 110, 40), intIn(lm[1], 10, 150, 30)];
    o.gapMm = intIn(p.gapMm, 0, 10, 2); o.density = intIn(p.density, 0, 15, 8); o.speed = intIn(p.speed, 1, 6, 4); o.offsetX = intIn(p.offsetX, -80, 80, 0); o.offsetY = intIn(p.offsetY, -80, 80, 0);
    o.language = p.language === 'zpl' ? 'zpl' : 'tspl'; o.invert = p.invert === true;
  } else if (p.sideMarginMm !== undefined) o.sideMarginMm = intIn(p.sideMarginMm, 0, 8, 1);
  return o;
}
const relays = new WeakMap<App, PrintRelay>();
/** The one relay of this Hub: device printers wait on it. */
export function relayOf(app: App): PrintRelay { let r = relays.get(app); if (!r) { r = new PrintRelay(); relays.set(app, r); } return r; }
function setup(app: App, c: PrinterConfig, device?: string): PrinterSetup {
  const t = c.transport; const transport = t.type === 'device' ? new RelayTransport(c.name, relayOf(app), device, c.kind) : t.type === 'windows' ? new WindowsSpoolerTransport(c.name, t.printer) : t.type === 'tcp' ? new TcpTransport(c.name, t.host, t.port ?? 9100) : t.type === 'file' ? new FileTransport(c.name, t.path) : new MemoryTransport(c.name);
  return { transport, kind: c.kind, paperWidthMm: c.paperWidthMm ?? 80, drawerOnCash: c.drawerOnCash ?? true, labelMm: c.labelMm, gapMm: c.gapMm, density: c.density, speed: c.speed, offsetX: c.offsetX, offsetY: c.offsetY, labelLanguage: c.language, labelInvert: c.invert, sideMarginMm: c.sideMarginMm };
}
function env(app: App): PrintEnv {
  const db = app.hub.db; const hidden = db.prepare('SELECT hide_on_receipt h FROM items WHERE id=?'); return { hideName: id => Number(hidden.get(id)?.h ?? 0) === 1, pharmacy: pharmacyInfo(app), style: receiptStyle(app),
    nameOf: id => String(db.prepare('SELECT display_name FROM people WHERE id=?').get(id)?.display_name ?? id), customerNameOf: id => (db.prepare('SELECT name FROM customers WHERE id=?').get(id)?.name as string) ?? null };
}
/** A print service with the printers as configured right now. `device` = the PC asking (for "device" printers). */
export function printService(app: App, device?: string): PrintService { const map: Record<string, PrinterSetup> = {}; for (const c of printers(app)) map[c.name] = setup(app, c, device); return new PrintService(app.hub, app.sales, raster, map, () => env(app), app.closing); }

/** The receipt as a picture (PNG), exactly as it would print: for the screen and the test server. Nothing is logged: it is not a print. */
export function receiptPng(app: App, actor: Person, saleNo: string, widthMm: 58 | 80 = 80): Buffer {
  const s0 = app.sales.sale(actor, saleNo); const e = env(app); const sale = { ...s0, lines: s0.lines.map(l => (e.hideName?.(l.itemId) ? { ...l, itemName: 'صنف' } : l)) };
  const img = raster.receipt(buildReceipt(sale, { pharmacy: e.pharmacy, style: e.style, cashierName: e.nameOf(sale.createdBy), customerName: sale.customerId ? e.customerNameOf?.(sale.customerId) ?? null : null, copy: 'counter', copyNo: 1, qrText: null }), widthMm === 58 ? 384 : 576, { pad: Math.round((e.style?.sideMarginMm ?? 1.25) * 8) });
  return png(img);
}
export function png(img: GrayImage): Buffer {
  const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); const d = ctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.gray.length; i++) { const v = img.gray[i]!; d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  ctx.putImageData(d, 0, 0); return c.toBuffer('image/png');
}

/** A made-up sale for the settings screen's live preview: nothing is read from or written to the books. */
export function receiptSamplePng(app: App, style: ReceiptStyle, widthMm: 58 | 80 = 80): Buffer {
  const line = (lineNo: number, itemName: string, reqUnit: string, reqQty: number, amountMinor: number, expiry: string, lot: string | null) => ({ lineNo, itemId: `sample-${lineNo}`, itemName, reqUnit, reqQty, amountMinor, unitPriceMinor: Math.round(amountMinor / reqQty), expiry, lot });
  const lines = [line(1, 'بيرو 20 مجم 14 اقراص', 'شريط', 1, 2100, '2027-10-31', 'B2231'), line(2, 'زيروفلام ريتارد 60 مجم 20 قرص', 'شريط', 1, 1300, '2027-03-31', null), line(3, 'افيكونيل 5 مجم 60 قرص', 'علبة', 0.25, 1700, '2028-01-31', 'PI-000014-1')];
  const gross = lines.reduce((a, l) => a + l.amountMinor, 0);
  const sale = { saleNo: 'S-034781', createdAt: app.hub.now(), status: 'posted', delivery: null, onAccountMinor: 0, customerId: 'sample', createdBy: 'sample', lines, payments: [{ method: 'cash', amountMinor: 10000 }], grossMinor: gross, discountMinor: 0, deliveryFeeMinor: 0, swapCreditMinor: 0, totalMinor: gross, changeMinor: 10000 - gross, returnedMinor: 0 } as unknown as SaleView;
  const img = raster.receipt(buildReceipt(sale, { pharmacy: pharmacyInfo(app), style, cashierName: 'د. منى', customerName: 'أحمد حبيب', copy: 'counter', copyNo: 1, qrText: null }), widthMm === 58 ? 384 : 576, { pad: Math.round((style.sideMarginMm ?? 1.25) * 8) });
  return png(img);
}
/** One sticker as a picture (the settings screen's preview and the print screen's look). */
export function labelPng(spec: LabelSpec, mm: [number, number], dpmm = 8): Buffer { return png(raster.label(spec, Math.round(mm[0] * dpmm), Math.round(mm[1] * dpmm))); }
