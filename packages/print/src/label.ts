import { toBits, type GrayImage } from './bitmap';
/** EAN-13 check digit for the first 12 digits. */
export function ean13check(d12: string): string { if (!/^\d{12}$/.test(d12)) throw new Error('ean13: need 12 digits'); let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1); return String((10 - (s % 10)) % 10); }
/** A 13-digit barcode with a right check digit, or the 12 digits to build one from; anything else returns null (no barcode on the label). */
export function ean13Of(code: string | null | undefined): string | null { const c = (code ?? '').trim(); if (/^\d{13}$/.test(c)) return c.slice(12) === ean13check(c.slice(0, 12)) ? c : null; if (/^\d{12}$/.test(c)) return c + ean13check(c); return null; }
const crlf = (s: string) => s + '\r\n';
export interface LabelOptions { wmm?: number; hmm?: number; invert?: boolean }
/** TSPL (TSC and clones). In TSPL BITMAP mode 0 a 0 bit prints black; `invert` flips it for a printer that behaves the other way (the printer kit prints both). The bars are drawn by the printer itself. */
export function tspl(textImg: GrayImage, ean: string | null, o: LabelOptions = {}): Buffer {
  const { wmm = 40, hmm = 30, invert = false } = o; const { bpr, data } = toBits(textImg); const b = Buffer.from(data); for (let i = 0; i < b.length; i++) b[i] = invert ? b[i]! : (~b[i]! & 0xff);
  const head = crlf(`SIZE ${wmm} mm,${hmm} mm`) + crlf('GAP 2 mm,0 mm') + crlf('DIRECTION 1') + crlf('CLS') + `BITMAP 0,10,${bpr},${textImg.height},0,`;
  const tail = '\r\n' + (ean ? crlf(`BARCODE 40,130,"EAN13",60,1,0,2,2,"${ean}"`) : '') + crlf('PRINT 1,1');
  return Buffer.concat([Buffer.from(head, 'ascii'), b, Buffer.from(tail, 'ascii')]);
}
/** ZPL (Zebra): the text as ^GFA hex, 1 = black. */
export function zpl(textImg: GrayImage, ean: string | null): Buffer {
  const { bpr, data } = toBits(textImg); const hex = Buffer.from(data).toString('hex').toUpperCase();
  return Buffer.from(`^XA^PW320^LL240^FO0,10^GFA,${data.length},${data.length},${bpr},${hex}^FS${ean ? `^FO40,130^BEN,60,Y,N^FD${ean.slice(0, 12)}^FS` : ''}^XZ\r\n`, 'ascii');
}

/** The printer settings of a label roll (Sprint 7.12, "إعدادات طباعة الباركود"): size, gap, darkness, speed, a nudge for printers that print off-centre. */
export interface LabelRoll { wmm: number; hmm: number; gapMm?: number; density?: number; speed?: number; invert?: boolean }
/** TSPL job for one whole-label picture (text and bars together), printed `copies` times. */
export function tsplImage(img: GrayImage, roll: LabelRoll, copies = 1): Buffer {
  const { bpr, data } = toBits(img); const b = Buffer.from(data); for (let i = 0; i < b.length; i++) b[i] = roll.invert ? b[i]! : (~b[i]! & 0xff);
  const head = crlf(`SIZE ${roll.wmm} mm,${roll.hmm} mm`) + crlf(`GAP ${roll.gapMm ?? 2} mm,0 mm`) + crlf('DIRECTION 1') + crlf('REFERENCE 0,0') + crlf(`DENSITY ${Math.min(15, Math.max(0, Math.round(roll.density ?? 8)))}`) + crlf(`SPEED ${Math.min(6, Math.max(1, Math.round(roll.speed ?? 4)))}`) + crlf('CLS') + `BITMAP 0,0,${bpr},${img.height},0,`;
  return Buffer.concat([Buffer.from(head, 'ascii'), b, Buffer.from('\r\n' + crlf(`PRINT ${Math.max(1, Math.round(copies))},1`), 'ascii')]);
}
/** ZPL job for one whole-label picture, printed `copies` times. */
export function zplImage(img: GrayImage, roll: LabelRoll, copies = 1): Buffer {
  const { bpr, data } = toBits(img); const hex = Buffer.from(data).toString('hex').toUpperCase();
  return Buffer.from(`^XA^PW${img.width}^LL${img.height}^MD${Math.round(((roll.density ?? 8) - 8) * 30 / 8)}^FO0,0^GFA,${data.length},${data.length},${bpr},${hex}^FS^PQ${Math.max(1, Math.round(copies))}^XZ\r\n`, 'ascii');
}
