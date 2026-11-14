import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import qrcode from 'qrcode-generator';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { GrayImage } from './bitmap';
import { code39Modules, code39Supported } from './code39';
import type { ReceiptLine } from './receipt';
import { barcodeFor } from './barcodes';

/** What goes on one sticker (Sprint 7.12). A price sticker: pharmacy and phone on top, the bars, the item name, then code, expiry and price. A dose sticker: the item, how to take it, the patient, the pharmacy. */
export interface LabelSpec { kind: 'price' | 'dose'; name: string; barcode?: string | null; code?: string | null; pharmacy?: string | null; phone?: string | null; price?: string | null; expiry?: string | null; dose?: string | null; patient?: string | null }

export interface Rasterizer {
  /** Draw a receipt at the printer's dot width (576 = 80 mm paper, 384 = 58 mm). */
  receipt(lines: ReceiptLine[], widthDots: number, o?: { pad?: number }): GrayImage;
  /** Small centred text for labels. */
  text(text: string, o?: { width?: number; height?: number; size?: number }): GrayImage;
  /** One whole sticker (text and bars) at the roll's size in dots (8 dots per mm); `dx`, `dy` nudge it for a printer that prints off-centre. */
  label(spec: LabelSpec, widthDots: number, heightDots: number, o?: { dx?: number; dy?: number }): GrayImage;
}
/** Split text into lines no wider than `max` (by words; a single long word stays whole). */
function wrap(ctx: SKRSContext2D, text: string, max: number): string[] {
  const out: string[] = []; for (const para of text.split('\n')) { let line = ''; for (const w of para.split(/\s+/).filter(Boolean)) { const t = line ? `${line} ${w}` : w; if (line && ctx.measureText(t).width > max) { out.push(line); line = w; } else line = t; } out.push(line); }
  return out;
}
/** The biggest font size from `max` down to `min` at which `text` fits `maxW` in at most `lines` lines. */
function fit(ctx: SKRSContext2D, text: string, maxW: number, maxSize: number, minSize: number, weight: number, lines = 1): { size: number; lines: string[] } {
  for (let sz = maxSize; sz >= minSize; sz--) { ctx.font = `${weight} ${sz}px ${FAMILY}`; const l = wrap(ctx, text, maxW); if (l.length <= lines && l.every(x => ctx.measureText(x).width <= maxW)) return { size: sz, lines: l }; }
  ctx.font = `${weight} ${minSize}px ${FAMILY}`; return { size: minSize, lines: wrap(ctx, text, maxW).slice(0, lines) };
}

const require = createRequire(import.meta.url);
const FAMILY = 'PlexAr, PlexLat'; // the Arabic subset first, the Latin subset as fallback
let registered = false;
function fonts(): void {
  if (registered) return; registered = true; const dir = join(dirname(require.resolve('@fontsource/ibm-plex-sans-arabic/package.json')), 'files');
  for (const f of ['arabic-400-normal', 'arabic-700-normal']) GlobalFonts.registerFromPath(join(dir, `ibm-plex-sans-arabic-${f}.woff`), 'PlexAr');
  for (const f of ['latin-400-normal', 'latin-700-normal']) GlobalFonts.registerFromPath(join(dir, `ibm-plex-sans-arabic-${f}.woff`), 'PlexLat');
}
const NUM = /(-?[\d٠-٩][\d٠-٩.,:/\- ]*[\d٠-٩]|-?[\d٠-٩]|[A-Za-z][A-Za-z0-9.\-]*[A-Za-z0-9])/;
type Seg = { t: string; num: boolean; w: number; tokens?: { t: string; w: number }[] };
/** One line of mixed Arabic and numbers. Skia's bidi puts digit groups in the wrong order inside right-to-left text ("2026-11-10" came out as "10-11-2026"), so numeric runs are measured and placed left-to-right by hand, runs ordered right-to-left. */
function drawRtl(ctx: SKRSContext2D, text: string, x: number, y: number, align: 'right' | 'center' | 'left'): void {
  const segs: Seg[] = text.split(NUM).filter(t => t !== '').map(t => ({ t, num: /^(-?[\d٠-٩.,:/\- ]+|[A-Za-z][A-Za-z0-9.\-]*)$/.test(t), w: 0 }));
  for (const g of segs) { if (g.num) { ctx.direction = 'ltr'; g.tokens = (g.t.match(/[\d٠-٩]+|[^\d٠-٩]/g) ?? []).map(t => ({ t, w: ctx.measureText(t).width })); g.w = g.tokens.reduce((a, k) => a + k.w, 0); } else { ctx.direction = 'rtl'; g.w = ctx.measureText(g.t).width; } }
  const total = segs.reduce((a, g) => a + g.w, 0); let right = align === 'right' ? x : align === 'center' ? x + total / 2 : x + total; ctx.textAlign = 'left';
  for (const g of segs) { right -= g.w; if (g.num) { let px = right; ctx.direction = 'ltr'; for (const k of g.tokens ?? []) { ctx.fillText(k.t, px, y); px += k.w; } } else { ctx.direction = 'rtl'; ctx.fillText(g.t, right, y); } }
}
function toGray(ctx: SKRSContext2D, width: number, height: number): GrayImage {
  const rgba = ctx.getImageData(0, 0, width, height).data; const gray = new Uint8Array(width * height); for (let i = 0; i < gray.length; i++) gray[i] = ((rgba[i * 4]! * 0.3 + rgba[i * 4 + 1]! * 0.59 + rgba[i * 4 + 2]! * 0.11) | 0);
  return { width, height, gray };
}

/** Skia (with HarfBuzz shaping) through @napi-rs/canvas; IBM Plex Sans Arabic. */
export class SkiaRasterizer implements Rasterizer {
  receipt(lines: ReceiptLine[], width: number, o: { pad?: number } = {}): GrayImage {
    fonts(); const pad = o.pad ?? Math.round(width / 57.6); const probe = createCanvas(width, 4000);
    const run = (ctx: SKRSContext2D, dry: boolean): number => {
      let y = 12;
      for (const l of lines) {
        if ('rule' in l) { if (!dry) { ctx.fillStyle = '#000'; ctx.fillRect(pad, y + 6, width - 2 * pad, 2); } y += 16; continue; }
        if ('table' in l) {
          const tb = l.table; const size = tb.size ?? 22; const lh = Math.round(size * 1.35); const cp = 6; const tw = width - 2 * pad; const ws = tb.widths.map(x => x * tw);
          const rows = [...(tb.head ? [{ cells: tb.head, head: true }] : []), ...tb.rows.map(r => ({ cells: r, head: false }))];
          for (const r of rows) {
            ctx.font = `${r.head ? 700 : 400} ${size}px ${FAMILY}`; ctx.direction = 'rtl';
            const cellLines = r.cells.map((c, i) => wrap(ctx, c ?? '', Math.max(10, (ws[i] ?? 0) - 2 * cp)));
            const h = Math.max(...cellLines.map(x => x.length)) * lh + 2 * cp;
            if (!dry) {
              let right = width - pad; ctx.fillStyle = '#000';
              cellLines.forEach((cl, i) => { const w = ws[i] ?? 0; ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.strokeRect(right - w, y, w, h);
                cl.forEach((t, k) => { const ty = y + cp + k * lh + size; if (i === 0) drawRtl(ctx, t, right - cp, ty, 'right'); else drawRtl(ctx, t, right - w / 2, ty, 'center'); }); right -= w; });
            }
            y += h;
          }
          y += 8; continue;
        }
        if ('boxes' in l) {
          const tw = width - 2 * pad; const wl = Math.round(tw * 0.55); const wv = tw - wl; const gap = 4;
          for (const bx of l.boxes) {
            const size = bx.size ?? (bx.bold ? 28 : 22); const h = Math.round(size * 1.35) + 12;
            if (!dry) { ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; const r = width - pad; ctx.strokeRect(r - wl, y, wl, h); ctx.strokeRect(r - wl - wv, y, wv, h);
              ctx.font = `${bx.bold ? 700 : 400} ${Math.min(size, 24)}px ${FAMILY}`; drawRtl(ctx, bx.label, r - wl / 2, y + 6 + Math.round(size * 1.05), 'center');
              ctx.font = `${bx.bold ? 700 : 400} ${size}px ${FAMILY}`; drawRtl(ctx, bx.value, r - wl - wv / 2, y + 6 + Math.round(size * 1.05), 'center'); }
            y += h + gap;
          }
          y += 6; continue;
        }
        if ('barcode' in l) {
          const mods = code39Supported(l.barcode) ? code39Modules(l.barcode) : ''; const mw = Math.max(1, Math.min(3, Math.floor((width - 2 * pad) / Math.max(1, mods.length)))); const h = 70; const x0 = Math.round((width - mods.length * mw) / 2);
          if (!dry) { ctx.fillStyle = '#000'; for (let i = 0; i < mods.length; i++) if (mods[i] === '1') ctx.fillRect(x0 + i * mw, y + 4, mw, h); ctx.font = `20px ${FAMILY}`; ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText(l.barcode, width / 2, y + h + 26); }
          y += h + 36; continue;
        }
        if ('qr' in l) {
          if (l.text) { const q = qrcode(0, 'M'); q.addData(l.text, 'Byte'); q.make(); const c = q.getModuleCount(); const mod = Math.max(2, Math.floor(Math.min(width - 2 * pad, 300) / c)); const x0 = Math.round((width - c * mod) / 2);
            if (!dry) { ctx.fillStyle = '#000'; for (let r = 0; r < c; r++) for (let k = 0; k < c; k++) if (q.isDark(r, k)) ctx.fillRect(x0 + k * mod, y + 8 + r * mod, mod, mod); } y += c * mod + 20; continue; }
          const s = 150; if (!dry) { ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect((width - s) / 2, y + 4, s, s); ctx.font = `20px ${FAMILY}`; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText('QR', width / 2, y + 4 + s / 2); } y += s + 14; continue;
        }
        const size = l.size ?? 24; ctx.font = `${l.bold ? 700 : 400} ${size}px ${FAMILY}`; ctx.fillStyle = '#000'; ctx.direction = 'rtl'; const lh = Math.round(size * 1.45);
        if ('cols' in l) {
          const w = (l.widths ?? (l.cols.length === 2 ? [0.6, 0.4] : [0.5, 0.25, 0.25])).map(x => x * (width - 2 * pad)); let right = width - pad;
          l.cols.forEach((t, i) => { if (!dry) { if (i === 0) drawRtl(ctx, t, right, y + size, 'right'); else drawRtl(ctx, t, right - (w[i] ?? 0), y + size, 'left'); } right -= w[i] ?? 0; });
        } else if (!dry) drawRtl(ctx, l.t, l.align === 'center' ? width / 2 : l.align === 'left' ? pad : width - pad, y + size, l.align ?? 'right');
        y += lh;
      }
      return y;
    };
    const height = Math.ceil(run(probe.getContext('2d'), true) + 20); const cv = createCanvas(width, height); const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); run(ctx, false); return toGray(ctx, width, height);
  }
  label(spec: LabelSpec, W: number, H: number, o: { dx?: number; dy?: number } = {}): GrayImage {
    fonts(); const cv = createCanvas(W, H); const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000';
    ctx.translate(Math.round(o.dx ?? 0), Math.round(o.dy ?? 0)); const pad = Math.max(6, Math.round(W * 0.03)); const iw = W - 2 * pad; let y = Math.max(4, Math.round(H * 0.03));
    const line = (text: string, maxSize: number, minSize: number, weight: number, align: 'right' | 'center' | 'left', x: number, maxW: number, lines = 1) => {
      const f = fit(ctx, text, maxW, maxSize, minSize, weight, lines); ctx.font = `${weight} ${f.size}px ${FAMILY}`;
      for (const t of f.lines) { y += Math.round(f.size * 1.1); drawRtl(ctx, t, x, y, align); y += Math.round(f.size * 0.18); }
    };
    const pair = (right: string, left: string, size: number, weight = 700) => {
      const s0 = Math.max(12, Math.round(size)); ctx.font = `${weight} ${s0}px ${FAMILY}`; const half = iw / 2 - 4;
      const fr = right ? fit(ctx, right, left ? half : iw, s0, 12, weight) : null; const fl = left ? fit(ctx, left, right ? half : iw, s0, 12, weight) : null; const sz = Math.min(fr?.size ?? 99, fl?.size ?? 99);
      y += sz; ctx.font = `${weight} ${sz}px ${FAMILY}`; if (right) drawRtl(ctx, fr!.lines[0]!, left ? W - pad : W / 2, y, left ? 'right' : 'center'); if (left) drawRtl(ctx, fl!.lines[0]!, right ? pad : W / 2, y, right ? 'left' : 'center'); y += Math.round(sz * 0.3);
    };
    if (spec.kind === 'price') {
      if (spec.pharmacy || spec.phone) pair(spec.pharmacy ?? '', spec.phone ?? '', H * 0.11);
      const bc = barcodeFor(spec.barcode ?? spec.code ?? null); const bottomH = Math.round(H * 0.15); const nameH = Math.round(H * 0.24);
      if (bc) {
        const quiet = 8; const mw = Math.max(1, Math.min(3, Math.floor((iw - 2 * quiet) / bc.modules.length))); const bw = bc.modules.length * mw; const x0 = Math.round((W - bw) / 2);
        const bh = Math.max(24, H - y - nameH - bottomH - 10); for (let i = 0; i < bc.modules.length; i++) if (bc.modules[i] === '1') ctx.fillRect(x0 + i * mw, y + 2, mw, bh);
        y += bh + 4;
      }
      line(spec.name, Math.round(H * 0.11), 12, 700, 'center', W / 2, iw, 2);
      const yb = H - Math.round(H * 0.04); const sz = Math.max(12, Math.round(H * 0.105)); ctx.font = `700 ${sz}px ${FAMILY}`;
      if (spec.price) drawRtl(ctx, spec.price, W - pad, yb, 'right');
      if (spec.expiry) drawRtl(ctx, spec.expiry, W / 2, yb, 'center');
      ctx.font = `400 ${Math.max(12, sz - 2)}px ${FAMILY}`; if (spec.code) drawRtl(ctx, spec.code, pad, yb, 'left');
    } else {
      line(spec.name, Math.round(H * 0.12), 12, 700, 'center', W / 2, iw, 2);
      ctx.fillRect(pad, y, iw, 2); y += 4;
      if (spec.dose) line(spec.dose, Math.round(H * 0.16), 14, 700, 'center', W / 2, iw, 3);
      if (spec.patient) line(spec.patient, Math.round(H * 0.09), 12, 400, 'center', W / 2, iw, 1);
      const foot = [spec.pharmacy, spec.phone].filter(Boolean).join(' - ');
      if (foot) { const f = fit(ctx, foot, iw, Math.round(H * 0.085), 11, 400); ctx.font = `400 ${f.size}px ${FAMILY}`; drawRtl(ctx, f.lines[0]!, W / 2, H - Math.round(H * 0.05), 'center'); }
    }
    return toGray(ctx, W, H);
  }
  text(text: string, o: { width?: number; height?: number; size?: number } = {}): GrayImage {
    fonts(); const { width = 320, height = 90, size = 28 } = o; const cv = createCanvas(width, height); const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000'; ctx.font = `700 ${size}px ${FAMILY}`;
    text.split('\n').forEach((t, i) => drawRtl(ctx, t, width / 2, size + 4 + i * (size + 8), 'center')); return toGray(ctx, width, height);
  }
}
