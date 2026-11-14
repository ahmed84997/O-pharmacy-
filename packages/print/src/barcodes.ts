/** Barcodes drawn as part of the label picture (Sprint 7.12): EAN-13 for international codes, Code 128 for the pharmacy's own codes.
 *  Drawing the bars into the same picture as the text means they can never be cropped or misplaced by the printer. 1 = bar module, 0 = space. */
import { ean13check } from './label';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 modules (95) for a 13-digit code with a right check digit; null otherwise. */
export function ean13Modules(code: string): string | null {
  if (!/^\d{13}$/.test(code) || code[12] !== ean13check(code.slice(0, 12))) return null;
  const d = code.split('').map(Number); const par = PARITY[d[0]!]!; let m = '101';
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L : G)[d[i]!]!;
  m += '01010'; for (let i = 7; i <= 12; i++) m += R[d[i]!]!; return m + '101';
}

/* Code 128 bar/space widths for values 0..106 (106 = stop, 13 modules with its final bar). */
const W = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');
const widths = (v: number) => { let s = ''; let bar = true; for (const c of W[v]!) { s += (bar ? '1' : '0').repeat(Number(c)); bar = !bar; } return s; };

/** Code 128 modules for printable ASCII (set B), switching to set C for runs of 4 or more digits (shorter bars for long numbers). null for anything else. */
export function code128Modules(text: string): string | null {
  if (!text || !/^[\x20-\x7e]+$/.test(text) || text.length > 40) return null;
  const vals: number[] = []; let set: 'B' | 'C' | null = null; let i = 0;
  const digitsAt = (k: number) => { let n = 0; while (k + n < text.length && /\d/.test(text[k + n]!)) n++; return n; };
  while (i < text.length) {
    const run = digitsAt(i);
    if (run >= 4) {
      const take = run % 2 === 0 ? run : run - 1; // an odd run leaves its last digit for set B
      if (set !== 'C') { vals.push(set === null ? 105 : 99); set = 'C'; }
      for (let k = 0; k < take; k += 2) vals.push(Number(text.slice(i + k, i + k + 2)));
      i += take; continue;
    }
    if (set !== 'B') { vals.push(set === null ? 104 : 100); set = 'B'; }
    vals.push(text.charCodeAt(i) - 32); i++;
  }
  let sum = vals[0]!; for (let k = 1; k < vals.length; k++) sum += vals[k]! * k;
  vals.push(sum % 103, 106);
  return vals.map(widths).join('');
}

/** The best barcode for a code: EAN-13 when it is a valid 13-digit (or 12-digit, check added) international code, Code 128 otherwise. */
export function barcodeFor(code: string | null | undefined): { kind: 'ean13' | 'code128'; text: string; modules: string } | null {
  const c = (code ?? '').trim(); if (!c) return null;
  const e = /^\d{12}$/.test(c) ? c + ean13check(c) : c; const em = /^\d{13}$/.test(e) ? ean13Modules(e) : null;
  if (em) return { kind: 'ean13', text: e, modules: em };
  const m = code128Modules(c); return m ? { kind: 'code128', text: c, modules: m } : null;
}
