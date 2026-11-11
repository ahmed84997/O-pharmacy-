/** GTIN (GS1) check digit and GS1 Data Matrix parsing (compliance: capture GTIN, batch, expiry, serial from the pack's code). */
export function gtinCheckDigit(body: string): number {
  let sum = 0; for (let i = body.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(body[i]) * w;
  return (10 - (sum % 10)) % 10;
}
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length) || /^0+$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.slice(-1));
}
/** Same GTIN regardless of how many leading zeros the scanner added (EAN-13 vs GTIN-14). */
export const gtin14 = (code: string): string => code.padStart(14, '0');

export interface Gs1Data { gtin: string; batch?: string; expiry?: string; serial?: string }
const GS = '\x1d';
const FIXED: Record<string, number> = { '01': 14, '11': 6, '15': 6, '17': 6 };
const VAR_MAX: Record<string, number> = { '10': 20, '21': 20 };

/** Parse a GS1 element string (AI 01 GTIN, 10 batch, 17 expiry YYMMDD, 21 serial; 11 and 15 are read and ignored). Throws on anything unknown. */
export function parseGs1(raw: string): Gs1Data {
  let s = raw.replace(/^\](d2|C1|Q3)/i, ''); let i = 0; const out: Partial<Gs1Data> = {};
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const ai = s.slice(i, i + 2); i += 2;
    if (ai in FIXED) {
      const v = s.slice(i, i + FIXED[ai]!); if (v.length !== FIXED[ai] || !/^\d+$/.test(v)) throw new Error(`bad value for AI ${ai}`); i += FIXED[ai]!;
      if (ai === '01') out.gtin = v; else if (ai === '17') out.expiry = gs1Date(v);
    } else if (ai in VAR_MAX) {
      let end = s.indexOf(GS, i); if (end < 0) end = s.length; const v = s.slice(i, end);
      if (!v || v.length > VAR_MAX[ai]!) throw new Error(`bad value for AI ${ai}`); i = end;
      if (ai === '10') out.batch = v; else out.serial = v;
    } else throw new Error(`unsupported AI ${ai}`);
  }
  if (!out.gtin) throw new Error('no GTIN in code');
  if (!isValidGtin(out.gtin)) throw new Error('bad GTIN check digit');
  return out as Gs1Data;
}
/** YYMMDD to ISO date; day 00 means the last day of the month (GS1 rule); years are 20YY. */
export function gs1Date(v: string): string {
  const yy = Number(v.slice(0, 2)), mm = Number(v.slice(2, 4)); let dd = Number(v.slice(4, 6));
  if (mm < 1 || mm > 12) throw new Error('bad month');
  const last = new Date(Date.UTC(2000 + yy, mm, 0)).getUTCDate(); if (dd === 0) dd = last; if (dd > last) throw new Error('bad day');
  return `${2000 + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
export const looksLikeGs1 = (scan: string): boolean => /^(\](d2|C1|Q3))?01\d{14}/.test(scan);

/** ETA item codes: GS1 (a valid GTIN) or EGS (EG-<9 digit taxpayer number>-<internal code>). EGS shape per vendor summaries; confirm against ETA's technical guide before launch. */
export type EtaCodeType = 'GS1' | 'EGS';
export function validateEtaCode(type: EtaCodeType, code: string): string | null {
  if (type === 'GS1') return isValidGtin(code) ? null : 'GS1 code must be a valid GTIN';
  return /^EG-\d{9}-[A-Za-z0-9_.-]{1,40}$/.test(code) ? null : 'EGS code must look like EG-123456789-ITEM001';
}
