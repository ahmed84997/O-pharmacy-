import { randomBytes } from 'node:crypto';

/** UUID v7: time-ordered, safe as primary key and for sync across devices (ARD: UUID identities). */
export function uuidv7(nowMs: number = Date.now(), rnd: Uint8Array = randomBytes(10)): string {
  const b = new Uint8Array(16);
  const t = BigInt(nowMs);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b.set(rnd.subarray(0, 10), 6);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
