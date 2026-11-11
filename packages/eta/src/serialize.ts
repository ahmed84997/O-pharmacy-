import { createHash } from 'node:crypto';

type Json = string | number | boolean | null | undefined | Json[] | { [k: string]: Json };
/** ETA's normalisation (https://sdk.invoicing.eta.gov.eg/document-serialization-approach/): property names in upper case and double quotes, every simple value as written and in double quotes, objects flattened with no braces, an array's name once before it and again before each element. Null and undefined fields are left out. */
export function serializeEta(v: Json, name = ''): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(x => `"${name.toUpperCase()}"` + serializeEta(x, name)).join('');
  if (typeof v === 'object') return Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => `"${k.toUpperCase()}"` + serializeEta(x, k)).join('');
  return `"${String(v)}"`;
}
/** The receipt UUID: SHA-256 of the normalised receipt with an empty `header.uuid`, as 64 hex characters (receipt issuance FAQ, "How to generate receipt UUID"). */
export function etaUuid(receipt: { header: Record<string, Json> } & Record<string, Json>): string {
  const withEmpty = { ...receipt, header: { ...receipt.header, uuid: '' } }; return createHash('sha256').update(serializeEta(withEmpty), 'utf8').digest('hex');
}
