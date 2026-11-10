// Barcode-label printers speak TSPL (TSC and clones), ZPL (Zebra) or EPL; the model in the pharmacy decides.
import { toBits } from './escpos.mjs';
const crlf = s => s + '\r\n';
export function ean13check(d12) { let s = 0; for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1); return String((10 - (s % 10)) % 10); }

// TSPL: BITMAP mode 0; in TSPL a 0 bit prints black (verify on the real printer: the kit prints a polarity check)
export function tspl(textImg, ean12, { wmm = 40, hmm = 30, invert = false } = {}) {
  const { bpr, data } = toBits(textImg); const b = Buffer.from(data);
  for (let i = 0; i < b.length; i++) b[i] = invert ? b[i] : (~b[i] & 0xff);
  const head = crlf(`SIZE ${wmm} mm,${hmm} mm`) + crlf('GAP 2 mm,0 mm') + crlf('DIRECTION 1') + crlf('CLS') + `BITMAP 0,10,${bpr},${textImg.height},0,`;
  const tail = '\r\n' + crlf(`BARCODE 40,130,"EAN13",60,1,0,2,2,"${ean12 + ean13check(ean12)}"`) + crlf('PRINT 1,1');
  return Buffer.concat([Buffer.from(head, 'ascii'), b, Buffer.from(tail, 'ascii')]);
}
// ZPL: ^GFA with hex data, 1 = black
export function zpl(textImg, ean12) {
  const { bpr, data } = toBits(textImg), hex = Buffer.from(data).toString('hex').toUpperCase();
  return Buffer.from(`^XA^PW320^LL240^FO0,10^GFA,${data.length},${data.length},${bpr},${hex}^FS^FO40,130^BEN,60,Y,N^FD${ean12}^FS^XZ\r\n`, 'ascii');
}
