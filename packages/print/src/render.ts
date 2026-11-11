import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { GrayImage } from './bitmap';
import { code39Modules, code39Supported } from './code39';
import type { ReceiptLine } from './receipt';

export interface Rasterizer {
  /** Draw a receipt at the printer's dot width (576 = 80 mm paper, 384 = 58 mm). */
  receipt(lines: ReceiptLine[], widthDots: number): GrayImage;
  /** Small centred text for labels. */
  text(text: string, o?: { width?: number; height?: number; size?: number }): GrayImage;
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
  receipt(lines: ReceiptLine[], width: number): GrayImage {
    fonts(); const pad = Math.round(width / 57.6); const probe = createCanvas(width, 4000);
    const run = (ctx: SKRSContext2D, dry: boolean): number => {
      let y = 12;
      for (const l of lines) {
        if ('rule' in l) { if (!dry) { ctx.fillStyle = '#000'; ctx.fillRect(pad, y + 6, width - 2 * pad, 2); } y += 16; continue; }
        if ('barcode' in l) {
          const mods = code39Supported(l.barcode) ? code39Modules(l.barcode) : ''; const mw = Math.max(1, Math.min(3, Math.floor((width - 2 * pad) / Math.max(1, mods.length)))); const h = 70; const x0 = Math.round((width - mods.length * mw) / 2);
          if (!dry) { ctx.fillStyle = '#000'; for (let i = 0; i < mods.length; i++) if (mods[i] === '1') ctx.fillRect(x0 + i * mw, y + 4, mw, h); ctx.font = `20px ${FAMILY}`; ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText(l.barcode, width / 2, y + h + 26); }
          y += h + 36; continue;
        }
        if ('qr' in l) { const s = 150; if (!dry) { ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect((width - s) / 2, y + 4, s, s); ctx.font = `20px ${FAMILY}`; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText('QR', width / 2, y + 4 + s / 2); } y += s + 14; continue; }
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
  text(text: string, o: { width?: number; height?: number; size?: number } = {}): GrayImage {
    fonts(); const { width = 320, height = 90, size = 28 } = o; const cv = createCanvas(width, height); const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000'; ctx.font = `700 ${size}px ${FAMILY}`;
    text.split('\n').forEach((t, i) => drawRtl(ctx, t, width / 2, size + 4 + i * (size + 8), 'center')); return toGray(ctx, width, height);
  }
}
