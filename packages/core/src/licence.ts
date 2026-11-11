import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

/**
 * Licences (D11: one codebase, the edition is a licence). A licence is a signed statement: base64url(payload).base64url(Ed25519 signature).
 * Our platform signs; every Hub and the Cloud verify with the public key. Nothing in a licence is secret.
 * Policy: a pharmacy is never locked out in the middle of a working day. After expiry there is a grace period (everything works, a warning shows),
 * then READ-ONLY (sales stop, but data stays visible and exportable - the owner's data is always theirs, No-Delete).
 */
export type Edition = 'single' | 'chain';
export interface LicencePayload { v: 1; tenantId: string; edition: Edition; maxBranches: number; features: string[]; issuedAt: string; expiresAt: string; graceDays: number }
export type LicenceState = 'valid' | 'grace' | 'read-only' | 'invalid';
export interface LicenceStatus { state: LicenceState; reason?: 'bad-format' | 'bad-signature' | 'wrong-tenant' | 'not-yet-valid'; payload?: LicencePayload; daysLeft?: number }

const b64 = (b: Buffer) => b.toString('base64url');
const DAY = 86_400_000;

export function signLicence(privateKey: KeyObject, p: Omit<LicencePayload, 'v'>): string {
  if (p.edition === 'single' && p.maxBranches !== 1) throw new Error('single edition has exactly one branch');
  if (p.maxBranches < 1 || !Number.isInteger(p.maxBranches)) throw new Error('maxBranches must be a positive integer');
  const body = Buffer.from(JSON.stringify({ v: 1, ...p }));
  return `${b64(body)}.${b64(sign(null, body, privateKey))}`;
}

export function verifyLicence(token: string, publicKeyPem: string | KeyObject, o: { now?: Date; tenantId?: string } = {}): LicenceStatus {
  const [bodyB64, sigB64, extra] = token.split('.');
  if (!bodyB64 || !sigB64 || extra !== undefined) return { state: 'invalid', reason: 'bad-format' };
  const body = Buffer.from(bodyB64, 'base64url'), sig = Buffer.from(sigB64, 'base64url');
  let ok = false; try { ok = verify(null, body, typeof publicKeyPem === 'string' ? createPublicKey(publicKeyPem) : publicKeyPem, sig); } catch { /* malformed key or signature */ }
  if (!ok) return { state: 'invalid', reason: 'bad-signature' };
  let p: LicencePayload; try { p = JSON.parse(body.toString()) as LicencePayload; } catch { return { state: 'invalid', reason: 'bad-format' }; }
  if (p.v !== 1 || !p.tenantId || !p.expiresAt || !p.issuedAt) return { state: 'invalid', reason: 'bad-format' };
  if (o.tenantId && p.tenantId !== o.tenantId) return { state: 'invalid', reason: 'wrong-tenant' };
  const now = (o.now ?? new Date()).getTime(), start = Date.parse(p.issuedAt), end = Date.parse(p.expiresAt);
  if (now < start - DAY) return { state: 'invalid', reason: 'not-yet-valid', payload: p }; // one day of clock tolerance
  const daysLeft = Math.ceil((end - now) / DAY);
  if (now <= end) return { state: 'valid', payload: p, daysLeft };
  if (now <= end + p.graceDays * DAY) return { state: 'grace', payload: p, daysLeft };
  return { state: 'read-only', payload: p, daysLeft };
}

/** What the current licence allows, asked by screens and APIs. Chain-only features need the chain edition. */
export const CHAIN_ONLY_FEATURES = ['transfers', 'central_purchase', 'consolidated_reports', 'central_warehouse'] as const;
export function entitlements(s: LicenceStatus, usage: { branches: number }) {
  const p = s.payload; const live = s.state === 'valid' || s.state === 'grace';
  return {
    canSell: live,
    canRead: s.state !== 'invalid',
    canAddBranch: s.state === 'valid' && !!p && usage.branches < p.maxBranches,
    hasFeature: (f: string) => live && !!p && (CHAIN_ONLY_FEATURES as readonly string[]).includes(f) ? p.edition === 'chain' && p.features.includes(f) : live && !!p && p.features.includes(f),
    warning: s.state === 'grace' ? 'licence-expired-grace' : s.state === 'valid' && (s.daysLeft ?? 99) <= 14 ? 'licence-expiring' : s.state === 'read-only' ? 'licence-read-only' : null,
  };
}
