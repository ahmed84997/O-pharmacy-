// Render a receipt (Arabic, right-to-left) to a 1-bit bitmap with real text shaping (Skia + HarfBuzz via @napi-rs/canvas).
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const fdir = join(dirname(require.resolve('@fontsource/ibm-plex-sans-arabic/package.json')), 'files');
const FAMILY = 'PlexAr, PlexLat'; // Arabic subset first, Latin subset as fallback (same-style faces under one name would replace each other)
let registered = false;
function fonts() {
  if (registered) return; registered = true;
  for (const f of ['arabic-400-normal', 'arabic-700-normal']) GlobalFonts.registerFromPath(join(fdir, `ibm-plex-sans-arabic-${f}.woff`), 'PlexAr');
  for (const f of ['latin-400-normal', 'latin-700-normal']) GlobalFonts.registerFromPath(join(fdir, `ibm-plex-sans-arabic-${f}.woff`), 'PlexLat');
}
// Numbers, dates and phones must stay left-to-right inside right-to-left text: wrap them in a bidi isolate (U+2066 ... U+2069)
export const ltr = s => s; // Skia ignores bidi isolates, so numbers are laid out by drawRtl() below instead
export const toAr = s => String(s).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]); // Arabic-Indic digits (YK owner rule; switchable later)

// Draw one line of mixed Arabic text and numbers/dates. Skia's bidi puts digit groups in the wrong order inside RTL text
// ("2026-11-10" came out as "10-11-2026"), so numeric runs are measured and placed left-to-right by hand, runs ordered right-to-left.
const NUM = /([\d٠-٩][\d٠-٩.,:\/\- ]*[\d٠-٩]|[\d٠-٩])/;
function drawRtl(ctx, text, x, y, align) {
  const segs = String(text).split(NUM).filter(t => t !== '').map(t => ({ t, num: NUM.test(t) && /^[\d٠-٩.,:\/\- ]+$/.test(t) }));
  // Arabic-Indic digit groups separated by "-" ":" "." are reordered by bidi even in an LTR run, so a numeric run is drawn token by token.
  for (const g of segs) {
    if (g.num) { g.tokens = g.t.match(/[\d٠-٩]+|[^\d٠-٩]/g).map(t => { ctx.direction = 'ltr'; return { t, w: ctx.measureText(t).width }; }); g.w = g.tokens.reduce((a, k) => a + k.w, 0); }
    else { ctx.direction = 'rtl'; g.w = ctx.measureText(g.t).width; }
  }
  const total = segs.reduce((a, g) => a + g.w, 0);
  let right = align === 'right' ? x : align === 'center' ? x + total / 2 : x + total;
  ctx.textAlign = 'left';
  for (const g of segs) {
    right -= g.w;
    if (g.num) { let px = right; ctx.direction = 'ltr'; for (const k of g.tokens) { ctx.fillText(k.t, px, y); px += k.w; } }
    else { ctx.direction = 'rtl'; ctx.fillText(g.t, right, y); }
  }
}
export function receiptLines(r, arabicDigits = true) {
  const n0 = arabicDigits ? toAr : String, n = v => ltr(n0(v));
  const money = v => n((v / 100).toFixed(2));
  const L = [];
  L.push({ t: r.pharmacy, size: 34, bold: true, align: 'center' });
  L.push({ t: r.branch, size: 24, align: 'center' });
  L.push({ t: r.phone ? 'ت: ' + n(r.phone) : '', size: 22, align: 'center' });
  L.push({ rule: true });
  L.push({ cols: [`فاتورة رقم ${n(r.no)}`, n(r.date)], size: 22 });
  L.push({ cols: [`الكاشير: ${r.cashier}`, `النوع: ${r.type}`], size: 22 });
  L.push({ rule: true });
  L.push({ cols: ['الصنف', 'الكمية', 'القيمة'], size: 22, bold: true, widths: [0.58, 0.14, 0.28] });
  for (const it of r.items) {
    L.push({ cols: [it.name, n(it.qty), money(it.qty * it.price)], size: 24, widths: [0.58, 0.14, 0.28] });
    if (it.expiry) L.push({ t: `صلاحية ${n(it.expiry)}`, size: 18, align: 'right' });
  }
  L.push({ rule: true });
  const total = r.items.reduce((s, i) => s + i.qty * i.price, 0);
  if (r.discount) L.push({ cols: ['خصم', money(r.discount)], size: 24 });
  L.push({ cols: ['الصافي', money(total - (r.discount || 0))], size: 32, bold: true });
  L.push({ cols: ['المدفوع', money(r.paid)], size: 22 });
  L.push({ cols: ['الباقي', money(r.paid - (total - (r.discount || 0)))], size: 22 });
  L.push({ rule: true });
  L.push({ qr: true });
  L.push({ t: 'نتمنى لكم دوام الصحة', size: 24, align: 'center' });
  L.push({ t: 'لا يُسترد الدواء إلا بالفاتورة وفي خلال ٧ أيام', size: 18, align: 'center' });
  return L;
}

// returns { width, height, gray: Uint8Array } (0 = black, 255 = white)
export function renderReceipt(r, { width = 576, arabicDigits = true } = {}) {
  fonts();
  const lines = receiptLines(r, arabicDigits), pad = 10;
  const probe = createCanvas(width, 4000), c = probe.getContext('2d');
  let y = 12;
  const draw = (ctx, dry) => {
    y = 12;
    for (const l of lines) {
      if (l.rule) { if (!dry) { ctx.fillStyle = '#000'; ctx.fillRect(pad, y + 6, width - 2 * pad, 2); } y += 16; continue; }
      if (l.qr) { const s = 150; if (!dry) { ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect((width - s) / 2, y + 4, s, s); ctx.font = `20px ${FAMILY}`; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.direction = 'ltr'; ctx.fillText('QR - ETA', width / 2, y + s / 2 + 8); } y += s + 14; continue; }
      const size = l.size ?? 24; ctx.font = `${l.bold ? 700 : 400} ${size}px ${FAMILY}`; ctx.fillStyle = '#000'; ctx.direction = 'rtl';
      const lh = Math.round(size * 1.45);
      if (l.cols) {
        const w = (l.widths ?? (l.cols.length === 2 ? [0.6, 0.4] : [0.5, 0.25, 0.25])).map(x => x * (width - 2 * pad));
        let right = width - pad;
        l.cols.forEach((t, i) => { if (!dry) { if (i === 0) drawRtl(ctx, t, right, y + size, 'right'); else drawRtl(ctx, t, right - w[i], y + size, 'left'); } right -= w[i]; });
      } else if (!dry) {
        drawRtl(ctx, l.t, l.align === 'center' ? width / 2 : l.align === 'left' ? pad : width - pad, y + size, l.align === 'center' ? 'center' : l.align === 'left' ? 'left' : 'right');
      }
      y += lh;
    }
  };
  draw(c, true);
  const height = Math.ceil(y + 20);
  const cv = createCanvas(width, height), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  draw(ctx, false);
  const rgba = ctx.getImageData(0, 0, width, height).data, gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.59 + rgba[i * 4 + 2] * 0.11) | 0;
  return { width, height, gray, png: () => cv.toBuffer('image/png') };
}

// Small label text (name + price) for the barcode printer
export function renderText(text, { width = 320, height = 90, size = 28 } = {}) {
  fonts();
  const cv = createCanvas(width, height), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#000';
  ctx.font = `700 ${size}px ${FAMILY}`; ctx.direction = 'rtl'; ctx.textAlign = 'center';
  text.split('\n').forEach((t, i) => ctx.fillText(t, width / 2, size + 4 + i * (size + 8)));
  const rgba = ctx.getImageData(0, 0, width, height).data, gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.59 + rgba[i * 4 + 2] * 0.11) | 0;
  return { width, height, gray, png: () => cv.toBuffer('image/png') };
}
