import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub, Migration } from '@o-pharmacy/hub';
import type { ClosingService, SaleService } from '@o-pharmacy/pos';
import { receiptBytes, drawerBytes } from './escpos';
import { ean13Of, tspl, tsplImage, zpl, zplImage } from './label';
import { buildReceipt, buildSessionReport, type PharmacyInfo, type ReceiptStyle } from './receipt';
import type { LabelSpec, Rasterizer } from './render';
import type { ReceiptLine } from './receipt';
import type { PrintTransport } from './transport';

export const PRINT_MIGRATIONS: Migration[] = [
  { id: 'print_0001_jobs', sql: `
CREATE TABLE print_jobs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('receipt','drawer','label')), ref TEXT, copy_kind TEXT, copy_no INTEGER,
  printer TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('sent','failed')), error TEXT, drawer INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, reason TEXT, by TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX print_jobs_by_ref ON print_jobs(kind, ref);
CREATE TRIGGER print_jobs_no_update BEFORE UPDATE ON print_jobs BEGIN SELECT RAISE(ABORT, 'the print log is append-only'); END;
CREATE TRIGGER print_jobs_no_delete BEFORE DELETE ON print_jobs BEGIN SELECT RAISE(ABORT, 'the print log is append-only'); END;` },
];

export class PrintError extends Error { constructor(public code: 'forbidden' | 'invalid' | 'not-found', message: string) { super(message); } }
export interface PrinterSetup { transport: PrintTransport; kind: 'receipt' | 'label'; paperWidthMm?: 58 | 80; /** Open the drawer with the receipt of a sale that took cash (default on). */ drawerOnCash?: boolean; labelLanguage?: 'tspl' | 'zpl'; labelMm?: [number, number]; labelInvert?: boolean; /** Sprint 7.12 roll settings */ gapMm?: number; density?: number; speed?: number; offsetX?: number; offsetY?: number; /** receipt side margin in mm (a printer that cuts the right edge) */ sideMarginMm?: number }
export interface PrintEnv { /** items whose name the pharmacy keeps off the receipt (item card, Sprint 7.9) */ hideName?(itemId: string): boolean; pharmacy: PharmacyInfo; style?: ReceiptStyle; nameOf(userId: string): string; customerNameOf?(customerId: string): string | null; /** The ETA QR text of a sale (from the ETA queue), if the pharmacy issues e-receipts. */ qrTextOf?(saleNo: string): string | null }
export interface PrintResult { ok: boolean; jobId: string; copyNo?: number; drawer?: boolean; error?: string; bytes: number }

/** Printing is separate from selling: a sale is complete before anything prints, and a printer that is off never undoes a sale. A failed print is logged and can be repeated (it is still the original, with the drawer). A reprint is marked as a copy and needs a reason. */
export class PrintService {
  constructor(private hub: Hub, private sales: SaleService, private raster: Rasterizer, private printers: Record<string, PrinterSetup>, private env: () => PrintEnv, private closing?: ClosingService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new PrintError('forbidden', `missing permission ${perm}`); }
  private printer(name: string, kind: PrinterSetup['kind']): PrinterSetup { const p = this.printers[name]; if (!p) throw new PrintError('not-found', `printer ${name}`); if (p.kind !== kind) throw new PrintError('invalid', `printer ${name} is not a ${kind} printer`); return p; }
  private log(actor: Person, j: { kind: 'receipt' | 'drawer' | 'label'; ref?: string; copyKind?: string; copyNo?: number; printer: string; ok: boolean; error?: string; drawer?: boolean; bytes: number; reason?: string }): string {
    const id = uuidv7(); this.db.tx(() => { this.db.prepare('INSERT INTO print_jobs(id,kind,ref,copy_kind,copy_no,printer,status,error,drawer,bytes,reason,by,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, j.kind, j.ref ?? null, j.copyKind ?? null, j.copyNo ?? null, j.printer, j.ok ? 'sent' : 'failed', j.error ?? null, j.drawer ? 1 : 0, j.bytes, j.reason ?? null, actor.id, this.hub.now()); this.hub.audit(actor.id, `print.${j.kind}.${j.ok ? 'sent' : 'failed'}`, 'print_job', id, { ref: j.ref ?? null, printer: j.printer, copyNo: j.copyNo ?? null, reason: j.reason ?? null }); }); return id;
  }
  private async deliver(p: PrinterSetup, bytes: Buffer): Promise<string | null> { try { await p.transport.send(bytes); return null; } catch (e) { return (e as Error).message || 'print failed'; } }

  /** Print a sale's receipt. The first print of a copy kind is the original (and opens the drawer for a cash sale); later prints are marked as copies and need a reason. */
  async printReceipt(actor: Person, r: { saleNo: string; printer: string; copy?: 'counter' | 'delivery'; reason?: string }): Promise<PrintResult> {
    const p = this.printer(r.printer, 'receipt'); const sale = this.sales.sale(actor, r.saleNo); const copy = r.copy ?? 'counter';
    if (copy === 'delivery' && !sale.delivery) throw new PrintError('invalid', 'this sale has no delivery');
    const done = Number(this.db.prepare(`SELECT COUNT(*) c FROM print_jobs WHERE kind='receipt' AND status='sent' AND ref=? AND copy_kind IN (?${copy === 'counter' ? ",'a4'" : ''})`).get(r.saleNo, copy)!.c); const copyNo = done + 1;
    if (copyNo > 1 && !r.reason?.trim()) throw new PrintError('invalid', 'a reprint needs a reason');
    const env = this.env(); const shown = env.hideName ? { ...sale, lines: sale.lines.map(l => (env.hideName!(l.itemId) ? { ...l, itemName: 'صنف' } : l)) } : sale; const lines = buildReceipt(shown, { pharmacy: env.pharmacy, style: env.style, cashierName: env.nameOf(sale.createdBy), customerName: sale.customerId ? env.customerNameOf?.(sale.customerId) ?? null : null, copy, copyNo, qrText: env.qrTextOf?.(r.saleNo) ?? null });
    const img = this.raster.receipt(lines, (p.paperWidthMm ?? 80) === 58 ? 384 : 576, { pad: this.pad(p, env.style?.sideMarginMm) }); const cash = sale.payments.some(x => x.method === 'cash' && x.amountMinor > 0);
    const drawer = copyNo === 1 && copy === 'counter' && (p.drawerOnCash ?? true) && cash && sale.status === 'posted'; const n = copyNo === 1 ? Math.min(5, Math.max(1, Math.round(env.style?.copies ?? 1))) : 1; const bytes = Buffer.concat([receiptBytes(img, { drawer }), ...Array.from({ length: n - 1 }, () => receiptBytes(img, { drawer: false }))]); const error = await this.deliver(p, bytes);
    const jobId = this.log(actor, { kind: 'receipt', ref: r.saleNo, copyKind: copy, copyNo, printer: r.printer, ok: !error, error: error ?? undefined, drawer, bytes: bytes.length, reason: r.reason?.trim() });
    return error ? { ok: false, jobId, error, bytes: bytes.length } : { ok: true, jobId, copyNo, drawer, bytes: bytes.length };
  }
  /** A sale invoice printed on A4 by the screen (the Windows print dialog, Sprint 7.12): counted and logged like a receipt, so a second print is a marked copy with a reason. Nothing is sent to a printer from here. */
  recordA4(actor: Person, r: { saleNo: string; reason?: string }): PrintResult {
    const sale = this.sales.sale(actor, r.saleNo); const done = Number(this.db.prepare("SELECT COUNT(*) c FROM print_jobs WHERE kind='receipt' AND status='sent' AND ref=? AND copy_kind IN ('counter','a4')").get(r.saleNo)!.c); const copyNo = done + 1;
    if (copyNo > 1 && !r.reason?.trim()) throw new PrintError('invalid', 'a reprint needs a reason');
    const jobId = this.log(actor, { kind: 'receipt', ref: sale.saleNo, copyKind: 'a4', copyNo, printer: 'A4', ok: true, bytes: 0, reason: r.reason?.trim() }); return { ok: true, jobId, copyNo, bytes: 0 };
  }
  /** Print the drawer-closing report of a session (needs the closing service). The first print is the original; later ones are copies and need a reason. */
  async printSessionReport(actor: Person, r: { sessionId: string; printer: string; reason?: string }): Promise<PrintResult> {
    if (!this.closing) throw new PrintError('invalid', 'closing reports are not set up'); const p = this.printer(r.printer, 'receipt'); const rep = this.closing.report(actor, r.sessionId);
    const done = Number(this.db.prepare("SELECT COUNT(*) c FROM print_jobs WHERE kind='receipt' AND status='sent' AND ref=? AND copy_kind='report'").get(rep.sessionNo)!.c); const copyNo = done + 1; if (copyNo > 1 && !r.reason?.trim()) throw new PrintError('invalid', 'a reprint needs a reason');
    const env = this.env(); const img = this.raster.receipt(buildSessionReport(rep, { pharmacy: env.pharmacy, style: env.style, cashierName: env.nameOf(rep.userId), copyNo }), (p.paperWidthMm ?? 80) === 58 ? 384 : 576, { pad: this.pad(p, env.style?.sideMarginMm) }); const bytes = receiptBytes(img, { drawer: false }); const error = await this.deliver(p, bytes);
    const jobId = this.log(actor, { kind: 'receipt', ref: rep.sessionNo, copyKind: 'report', copyNo, printer: r.printer, ok: !error, error: error ?? undefined, bytes: bytes.length, reason: r.reason?.trim() });
    return error ? { ok: false, jobId, error, bytes: bytes.length } : { ok: true, jobId, copyNo, drawer: false, bytes: bytes.length };
  }
  /** Open the drawer with no sale: management only (`sale.void`), reason required, always logged. */
  async openDrawer(actor: Person, r: { printer: string; reason: string }): Promise<PrintResult> {
    this.need(actor, 'sale.void'); if (!r.reason?.trim()) throw new PrintError('invalid', 'a reason is required'); const p = this.printer(r.printer, 'receipt'); const bytes = drawerBytes(); const error = await this.deliver(p, bytes);
    const jobId = this.log(actor, { kind: 'drawer', printer: r.printer, ok: !error, error: error ?? undefined, drawer: true, bytes: bytes.length, reason: r.reason.trim() }); return error ? { ok: false, jobId, error, bytes: bytes.length } : { ok: true, jobId, drawer: true, bytes: bytes.length };
  }
  /** A shelf label: name and price as a picture, the barcode drawn by the printer (EAN-13 only; anything else prints without bars). */
  async printLabel(actor: Person, r: { printer: string; name: string; priceMinor?: number; barcode?: string | null; copies?: number }): Promise<PrintResult> {
    this.need(actor, 'item.view'); const p = this.printer(r.printer, 'label'); const copies = r.copies ?? 1; if (!Number.isInteger(copies) || copies < 1 || copies > 200) throw new PrintError('invalid', 'copies must be 1 to 200'); if (!r.name?.trim()) throw new PrintError('invalid', 'label needs a name');
    const [w, h] = p.labelMm ?? [40, 30]; const img = this.raster.text(`${r.name.trim()}${r.priceMinor === undefined ? '' : `\n${(r.priceMinor / 100).toFixed(2)}`}`, { width: Math.floor(w * 8 / 8) * 8, height: 90 }); const ean = ean13Of(r.barcode);
    const one = (p.labelLanguage ?? 'tspl') === 'zpl' ? zpl(img, ean) : tspl(img, ean, { wmm: w, hmm: h, invert: p.labelInvert }); const bytes = Buffer.concat(Array.from({ length: copies }, () => one)); const error = await this.deliver(p, bytes);
    const jobId = this.log(actor, { kind: 'label', ref: r.barcode ?? r.name.trim(), copyNo: copies, printer: r.printer, ok: !error, error: error ?? undefined, bytes: bytes.length }); return error ? { ok: false, jobId, error, bytes: bytes.length } : { ok: true, jobId, copyNo: copies, bytes: bytes.length };
  }
  private pad(p: PrinterSetup, mm?: number): number { const v = mm ?? p.sideMarginMm; return v === undefined ? ((p.paperWidthMm ?? 80) === 58 ? 7 : 10) : Math.round(Math.min(8, Math.max(0, v)) * 8); }
  /** Stickers drawn whole (text and bars in one picture) at the roll's size (Sprint 7.12): price stickers and dose stickers. One job per sticker, printed `copies` times. */
  async printLabels(actor: Person, r: { printer: string; items: { spec: LabelSpec; copies?: number; ref?: string }[] }): Promise<PrintResult[]> {
    this.need(actor, 'item.view'); const p = this.printer(r.printer, 'label'); if (!r.items.length || r.items.length > 100) throw new PrintError('invalid', '1 to 100 stickers');
    const [wmm, hmm] = p.labelMm ?? [40, 30]; const W = Math.round(wmm * 8); const H = Math.round(hmm * 8); const out: PrintResult[] = [];
    for (const it of r.items) {
      const copies = it.copies ?? 1; if (!Number.isInteger(copies) || copies < 1 || copies > 500) throw new PrintError('invalid', 'copies must be 1 to 500'); if (!it.spec.name?.trim()) throw new PrintError('invalid', 'a sticker needs a name');
      const img = this.raster.label(it.spec, W, H, { dx: p.offsetX, dy: p.offsetY }); const roll = { wmm, hmm, gapMm: p.gapMm, density: p.density, speed: p.speed, invert: p.labelInvert };
      const bytes = (p.labelLanguage ?? 'tspl') === 'zpl' ? zplImage(img, roll, copies) : tsplImage(img, roll, copies); const error = await this.deliver(p, bytes);
      const jobId = this.log(actor, { kind: 'label', ref: it.ref ?? it.spec.barcode ?? it.spec.name.trim().slice(0, 60), copyKind: it.spec.kind, copyNo: copies, printer: r.printer, ok: !error, error: error ?? undefined, bytes: bytes.length });
      out.push(error ? { ok: false, jobId, error, bytes: bytes.length } : { ok: true, jobId, copyNo: copies, bytes: bytes.length });
    }
    return out;
  }
  /** A free slip on the receipt printer (the dose slip when there is no label printer). */
  async printSlip(actor: Person, r: { printer: string; lines: ReceiptLine[]; ref: string; kind: string }): Promise<PrintResult> {
    this.need(actor, 'item.view'); const p = this.printer(r.printer, 'receipt'); const env = this.env();
    const img = this.raster.receipt(r.lines, (p.paperWidthMm ?? 80) === 58 ? 384 : 576, { pad: this.pad(p, env.style?.sideMarginMm) }); const bytes = receiptBytes(img, { drawer: false }); const error = await this.deliver(p, bytes);
    const jobId = this.log(actor, { kind: 'receipt', ref: r.ref, copyKind: r.kind, copyNo: 1, printer: r.printer, ok: !error, error: error ?? undefined, bytes: bytes.length });
    return error ? { ok: false, jobId, error, bytes: bytes.length } : { ok: true, jobId, copyNo: 1, bytes: bytes.length };
  }
  /** The print log, newest first (reviewers). */
  jobs(actor: Person, o: { ref?: string; failedOnly?: boolean; limit?: number } = {}) {
    this.need(actor, 'sale.view_all'); const w: string[] = []; const a: unknown[] = []; if (o.ref) { w.push('ref=?'); a.push(o.ref); } if (o.failedOnly) w.push("status='failed'");
    return this.db.prepare(`SELECT * FROM print_jobs ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`).all(...a, o.limit ?? 100).map(r => ({ kind: String(r.kind), ref: (r.ref as string) ?? null, copyKind: (r.copy_kind as string) ?? null, copyNo: r.copy_no === null ? null : Number(r.copy_no), printer: String(r.printer), status: String(r.status), error: (r.error as string) ?? null, drawer: Number(r.drawer) === 1, by: String(r.by), at: String(r.at), reason: (r.reason as string) ?? null }));
  }
}
