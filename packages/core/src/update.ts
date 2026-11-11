import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

/**
 * Auto-update logic (shell independent). The update server publishes a SIGNED manifest; the Hub verifies the signature, picks the artifact for its
 * platform, checks the SHA-256 of the downloaded file, installs outside business hours, and rolls back if the new version does not start healthy.
 */
export interface Artifact { platform: 'win32' | 'darwin' | 'linux'; arch: 'x64' | 'arm64'; url: string; sha256: string; size: number }
export interface UpdateManifest { v: 1; version: string; channel: 'stable' | 'beta'; minSupportedVersion: string; publishedAt: string; rolloutPercent: number; notes: string; artifacts: Artifact[] }

const b64 = (b: Buffer) => b.toString('base64url');
export const signManifest = (priv: KeyObject, m: UpdateManifest): string => { const body = Buffer.from(JSON.stringify(m)); return `${b64(body)}.${b64(sign(null, body, priv))}`; };
export function verifyManifest(token: string, publicKeyPem: string | KeyObject): UpdateManifest | null {
  const [a, s, x] = token.split('.'); if (!a || !s || x !== undefined) return null;
  const body = Buffer.from(a, 'base64url');
  try { if (!verify(null, body, typeof publicKeyPem === 'string' ? createPublicKey(publicKeyPem) : publicKeyPem, Buffer.from(s, 'base64url'))) return null; } catch { return null; }
  try { const m = JSON.parse(body.toString()) as UpdateManifest; return m.v === 1 && parseVersion(m.version) && parseVersion(m.minSupportedVersion) && Array.isArray(m.artifacts) ? m : null; } catch { return null; }
}

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b); if (!x || !y) throw new Error(`bad version ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** Stable bucket 0-99 per device and version: the same device always gets the same answer, and rollout grows by raising the percentage. */
export const rolloutBucket = (deviceId: string, version: string): number => createHash('sha256').update(`${deviceId}|${version}`).digest().readUInt16BE(0) % 100;

export type UpdateDecision =
  | { action: 'none'; reason: 'up-to-date' | 'older-than-installed' | 'other-channel' | 'no-artifact' | 'not-in-rollout' }
  | { action: 'install-later'; artifact: Artifact; reason: 'business-hours' }
  | { action: 'install'; artifact: Artifact; forced: boolean };

export function decideUpdate(m: UpdateManifest, d: { current: string; platform: Artifact['platform']; arch: Artifact['arch']; channel: UpdateManifest['channel']; deviceId: string; businessHours: boolean }): UpdateDecision {
  if (m.channel !== d.channel) return { action: 'none', reason: 'other-channel' };
  const cmp = compareVersions(m.version, d.current);
  if (cmp < 0) return { action: 'none', reason: 'older-than-installed' }; // never downgrade through the update channel
  if (cmp === 0) return { action: 'none', reason: 'up-to-date' };
  const artifact = m.artifacts.find(a => a.platform === d.platform && a.arch === d.arch);
  if (!artifact) return { action: 'none', reason: 'no-artifact' };
  const forced = compareVersions(d.current, m.minSupportedVersion) < 0; // below the minimum: must update, rollout does not apply
  if (!forced && rolloutBucket(d.deviceId, m.version) >= m.rolloutPercent) return { action: 'none', reason: 'not-in-rollout' };
  if (d.businessHours && !forced) return { action: 'install-later', artifact, reason: 'business-hours' };
  return { action: 'install', artifact, forced };
}

export const verifyArtifactBytes = (bytes: Uint8Array, a: Artifact): boolean => bytes.byteLength === a.size && createHash('sha256').update(bytes).digest('hex') === a.sha256.toLowerCase();

/** After installing, the new version must report healthy within `maxFailedStarts` start attempts, else go back to the previous version. */
export function shouldRollback(h: { failedStarts: number; healthy: boolean }, maxFailedStarts = 2): boolean { return !h.healthy && h.failedStarts >= maxFailedStarts; }
