import { createCanvas } from '@napi-rs/canvas';
import { buildReceipt, FileTransport, MemoryTransport, PrintService, SkiaRasterizer, TcpTransport, WindowsSpoolerTransport, type PrinterSetup, type PrintEnv, type ReceiptStyle } from '@o-pharmacy/print';
import type { GrayImage } from '@o-pharmacy/print';
import type { Person } from '@o-pharmacy/core';
import type { App } from './compose';
import { AccessError } from './access';
import { PrintRelay, RelayTransport } from './print-relay';

/** A printer as the pharmacy sets it up (settings screen). `windows` = a printer installed in Windows (raw ESC/POS through the spooler), `tcp` = a network printer (port 9100), `preview` = no printer: the receipt is only shown on screen (test server). `device` = the Windows printer of the PC that asks for the print (each cashier on its own printer, chosen in its desktop app, D39). */
export interface PrinterConfig { name: string; kind: 'receipt' | 'label'; paperWidthMm?: 58 | 80; drawerOnCash?: boolean; transport: { type: 'windows'; printer: string } | { type: 'tcp'; host: string; port?: number } | { type: 'file'; path: string } | { type: 'preview' } | { type: 'device' } }
const raster = new SkiaRasterizer();

export function printers(app: App): PrinterConfig[] { try { return JSON.parse(app.access.setting('printers') ?? '[]') as PrinterConfig[]; } catch { return []; } }
export function receiptStyle(app: App): ReceiptStyle { try { return { reserveQr: false, ...(JSON.parse(app.access.setting('receipt.style') ?? '{}') as ReceiptStyle) }; } catch { return {}; } }
export function savePrinters(app: App, actor: Person, list: unknown): PrinterConfig[] {
  if (!Array.isArray(list) || list.length > 10) throw new AccessError('invalid', 'up to 10 printers');
  const names = new Set<string>(); const out = list.map((x): PrinterConfig => {
    const p = x as PrinterConfig; const name = String(p?.name ?? '').trim(); if (!name || names.has(name)) throw new AccessError('invalid', 'each printer needs a unique name'); names.add(name);
    if (p.kind !== 'receipt' && p.kind !== 'label') throw new AccessError('invalid', 'printer kind must be receipt or label'); const t = p.transport as PrinterConfig['transport'];
    if (t?.type === 'windows' && String(t.printer ?? '').trim()) return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: p.drawerOnCash !== false, transport: { type: 'windows', printer: String(t.printer).trim() } };
    if (t?.type === 'tcp' && /^[A-Za-z0-9.-]+$/.test(String(t.host ?? ''))) return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: p.drawerOnCash !== false, transport: { type: 'tcp', host: String(t.host), port: Number(t.port) || 9100 } };
    if (t?.type === 'device') return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: p.drawerOnCash !== false, transport: { type: 'device' } };
    if (t?.type === 'preview') return { name, kind: p.kind, paperWidthMm: p.paperWidthMm === 58 ? 58 : 80, drawerOnCash: false, transport: { type: 'preview' } };
    throw new AccessError('invalid', 'choose how the printer is connected');
  });
  app.access.setSetting('printers', JSON.stringify(out), actor.id); app.hub.audit(actor.id, 'settings.printers', 'settings', 'printers', { count: out.length }); return out;
}
const relays = new WeakMap<App, PrintRelay>();
/** The one relay of this Hub: device printers wait on it. */
export function relayOf(app: App): PrintRelay { let r = relays.get(app); if (!r) { r = new PrintRelay(); relays.set(app, r); } return r; }
function setup(app: App, c: PrinterConfig, device?: string): PrinterSetup {
  const t = c.transport; const transport = t.type === 'device' ? new RelayTransport(c.name, relayOf(app), device, c.kind) : t.type === 'windows' ? new WindowsSpoolerTransport(c.name, t.printer) : t.type === 'tcp' ? new TcpTransport(c.name, t.host, t.port ?? 9100) : t.type === 'file' ? new FileTransport(c.name, t.path) : new MemoryTransport(c.name);
  return { transport, kind: c.kind, paperWidthMm: c.paperWidthMm ?? 80, drawerOnCash: c.drawerOnCash ?? true };
}
function env(app: App): PrintEnv {
  const db = app.hub.db; const hidden = db.prepare('SELECT hide_on_receipt h FROM items WHERE id=?'); return { hideName: id => Number(hidden.get(id)?.h ?? 0) === 1, pharmacy: { name: app.access.setting('pharmacy.name') ?? 'O Pharmacy', branch: app.hub.branchId, phones: (app.access.setting('pharmacy.phones') ?? '').split(',').map(s => s.trim()).filter(Boolean) }, style: receiptStyle(app),
    nameOf: id => String(db.prepare('SELECT display_name FROM people WHERE id=?').get(id)?.display_name ?? id), customerNameOf: id => (db.prepare('SELECT name FROM customers WHERE id=?').get(id)?.name as string) ?? null };
}
/** A print service with the printers as configured right now. `device` = the PC asking (for "device" printers). */
export function printService(app: App, device?: string): PrintService { const map: Record<string, PrinterSetup> = {}; for (const c of printers(app)) map[c.name] = setup(app, c, device); return new PrintService(app.hub, app.sales, raster, map, () => env(app), app.closing); }

/** The receipt as a picture (PNG), exactly as it would print: for the screen and the test server. Nothing is logged: it is not a print. */
export function receiptPng(app: App, actor: Person, saleNo: string, widthMm: 58 | 80 = 80): Buffer {
  const s0 = app.sales.sale(actor, saleNo); const e = env(app); const sale = { ...s0, lines: s0.lines.map(l => (e.hideName?.(l.itemId) ? { ...l, itemName: 'صنف' } : l)) };
  const img = raster.receipt(buildReceipt(sale, { pharmacy: e.pharmacy, style: e.style, cashierName: e.nameOf(sale.createdBy), customerName: sale.customerId ? e.customerNameOf?.(sale.customerId) ?? null : null, copy: 'counter', copyNo: 1, qrText: null }), widthMm === 58 ? 384 : 576);
  return png(img);
}
export function png(img: GrayImage): Buffer {
  const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); const d = ctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.gray.length; i++) { const v = img.gray[i]!; d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  ctx.putImageData(d, 0, 0); return c.toBuffer('image/png');
}
