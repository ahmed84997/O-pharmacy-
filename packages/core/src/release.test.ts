import { generateKeyPairSync, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareVersions, decideUpdate, entitlements, rolloutBucket, shouldRollback, signLicence, signManifest, verifyArtifactBytes, verifyLicence, verifyManifest, type Artifact, type UpdateManifest } from './index';

const keys = () => generateKeyPairSync('ed25519'); const K = keys(), OTHER = keys();
const pem = K.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const T0 = new Date('2026-12-01T10:00:00Z');
const lic = (o: Partial<Parameters<typeof signLicence>[1]> = {}) => signLicence(K.privateKey, { tenantId: 't1', edition: 'chain', maxBranches: 3, features: ['transfers'], issuedAt: '2026-11-01T00:00:00Z', expiresAt: '2027-11-01T00:00:00Z', graceDays: 14, ...o });
const at = (iso: string) => new Date(iso);

describe('licence', () => {
  it('valid, then expiring warning, then grace, then read-only', () => {
    const t = lic({ expiresAt: '2026-12-31T00:00:00Z' });
    expect(verifyLicence(t, pem, { now: T0 }).state).toBe('valid'); expect(entitlements(verifyLicence(t, pem, { now: T0 }), { branches: 1 }).warning).toBeNull();
    const soon = verifyLicence(t, pem, { now: at('2026-12-25T00:00:00Z') }); expect(soon.state).toBe('valid'); expect(entitlements(soon, { branches: 1 }).warning).toBe('licence-expiring');
    const grace = verifyLicence(t, pem, { now: at('2027-01-05T00:00:00Z') }); expect(grace.state).toBe('grace'); expect(entitlements(grace, { branches: 1 })).toMatchObject({ canSell: true, canAddBranch: false, warning: 'licence-expired-grace' });
    const ro = verifyLicence(t, pem, { now: at('2027-02-01T00:00:00Z') }); expect(ro.state).toBe('read-only'); expect(entitlements(ro, { branches: 1 })).toMatchObject({ canSell: false, canRead: true, warning: 'licence-read-only' });
  });
  it('rejects tampering, wrong key, wrong tenant, garbage and not-yet-valid', () => {
    const t = lic(); const [b, s] = t.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url').toString()), maxBranches: 99 })).toString('base64url');
    expect(verifyLicence(`${forged}.${s}`, pem)).toMatchObject({ state: 'invalid', reason: 'bad-signature' });
    expect(verifyLicence(t, OTHER.publicKey.export({ type: 'spki', format: 'pem' }) as string)).toMatchObject({ reason: 'bad-signature' });
    expect(verifyLicence(t, pem, { now: T0, tenantId: 'other' })).toMatchObject({ reason: 'wrong-tenant' });
    for (const g of ['', 'abc', 'a.b.c', '.']) expect(verifyLicence(g, pem).state).toBe('invalid');
    expect(verifyLicence(lic({ issuedAt: '2027-06-01T00:00:00Z' }), pem, { now: T0 })).toMatchObject({ reason: 'not-yet-valid' });
    expect(verifyLicence(t, 'not a key', { now: T0 }).state).toBe('invalid');
  });
  it('edition rules: single has one branch; chain features need the chain edition and the feature flag', () => {
    expect(() => lic({ edition: 'single', maxBranches: 2 })).toThrow(); expect(() => lic({ maxBranches: 0 })).toThrow();
    const chain = entitlements(verifyLicence(lic(), pem, { now: T0 }), { branches: 2 });
    expect(chain.canAddBranch).toBe(true); expect(chain.hasFeature('transfers')).toBe(true); expect(chain.hasFeature('central_purchase')).toBe(false);
    expect(entitlements(verifyLicence(lic(), pem, { now: T0 }), { branches: 3 }).canAddBranch).toBe(false);
    const single = entitlements(verifyLicence(lic({ edition: 'single', maxBranches: 1, features: ['transfers', 'reports'] }), pem, { now: T0 }), { branches: 1 });
    expect(single.hasFeature('transfers')).toBe(false); expect(single.hasFeature('reports')).toBe(true); expect(single.canAddBranch).toBe(false);
  });
  it('an invalid licence reads nothing and sells nothing', () => { const e = entitlements({ state: 'invalid', reason: 'bad-format' }, { branches: 0 }); expect(e).toMatchObject({ canSell: false, canRead: false }); });
});

describe('update manifest', () => {
  const bytes = new TextEncoder().encode('installer-bytes'); const sha = createHash('sha256').update(bytes).digest('hex');
  const art = (platform: Artifact['platform'] = 'win32'): Artifact => ({ platform, arch: 'x64', url: 'https://updates.example/o-pharmacy-1.2.0.exe', sha256: sha, size: bytes.byteLength });
  const man = (o: Partial<UpdateManifest> = {}): UpdateManifest => ({ v: 1, version: '1.2.0', channel: 'stable', minSupportedVersion: '1.0.0', publishedAt: '2026-12-01T00:00:00Z', rolloutPercent: 100, notes: 'x', artifacts: [art('win32'), art('darwin')], ...o });
  const dev = { current: '1.1.0', platform: 'win32' as const, arch: 'x64' as const, channel: 'stable' as const, deviceId: 'dev-1', businessHours: false };

  it('signature must verify; tampered or foreign manifests are refused', () => {
    const t = signManifest(K.privateKey, man()); expect(verifyManifest(t, pem)?.version).toBe('1.2.0');
    const [b, s] = t.split('.') as [string, string]; const evil = Buffer.from(JSON.stringify({ ...man(), artifacts: [{ ...art(), url: 'https://evil.example/x.exe' }] })).toString('base64url');
    expect(verifyManifest(`${evil}.${s}`, pem)).toBeNull(); expect(verifyManifest(t, OTHER.publicKey.export({ type: 'spki', format: 'pem' }) as string)).toBeNull();
    expect(verifyManifest(`${b}`, pem)).toBeNull(); expect(verifyManifest(signManifest(K.privateKey, man({ version: '1.x' })), pem)).toBeNull();
  });
  it('versions compare numerically, bad ones throw', () => { expect(compareVersions('1.10.0', '1.9.9')).toBe(1); expect(compareVersions('1.2.3', '1.2.3')).toBe(0); expect(compareVersions('0.9.0', '1.0.0')).toBe(-1); expect(() => compareVersions('1.2', '1.2.3')).toThrow(); });
  it('decisions: update, up-to-date, never downgrade, other channel, missing platform', () => {
    expect(decideUpdate(man(), dev)).toMatchObject({ action: 'install', forced: false });
    expect(decideUpdate(man(), { ...dev, current: '1.2.0' })).toEqual({ action: 'none', reason: 'up-to-date' });
    expect(decideUpdate(man(), { ...dev, current: '1.3.0' })).toEqual({ action: 'none', reason: 'older-than-installed' });
    expect(decideUpdate(man({ channel: 'beta' }), dev)).toEqual({ action: 'none', reason: 'other-channel' });
    expect(decideUpdate(man(), { ...dev, platform: 'linux' })).toEqual({ action: 'none', reason: 'no-artifact' });
  });
  it('installs outside business hours; forced updates ignore rollout and business hours', () => {
    expect(decideUpdate(man(), { ...dev, businessHours: true })).toMatchObject({ action: 'install-later', reason: 'business-hours' });
    const m = man({ rolloutPercent: 0, minSupportedVersion: '1.1.5' });
    expect(decideUpdate(m, { ...dev, businessHours: true })).toMatchObject({ action: 'install', forced: true });
    expect(decideUpdate(man({ rolloutPercent: 0 }), dev)).toEqual({ action: 'none', reason: 'not-in-rollout' });
  });
  it('staged rollout is stable per device and roughly proportional', () => {
    expect(rolloutBucket('d1', '1.2.0')).toBe(rolloutBucket('d1', '1.2.0'));
    let n = 0; for (let i = 0; i < 2000; i++) if (rolloutBucket('dev' + i, '1.2.0') < 20) n++; expect(n).toBeGreaterThan(300); expect(n).toBeLessThan(500);
    const small = new Set<number>(); for (let i = 0; i < 500; i++) if (rolloutBucket('x' + i, '1.2.0') < 10) small.add(i);
    for (const i of small) expect(rolloutBucket('x' + i, '1.2.0') < 50).toBe(true); // raising the percentage never removes a device
  });
  it('downloaded file must match size and SHA-256', () => {
    expect(verifyArtifactBytes(bytes, art())).toBe(true); expect(verifyArtifactBytes(new TextEncoder().encode('installer-byteZ'), art())).toBe(false); expect(verifyArtifactBytes(bytes, { ...art(), size: 3 })).toBe(false);
  });
  it('rollback only after repeated failed starts', () => { expect(shouldRollback({ failedStarts: 1, healthy: false })).toBe(false); expect(shouldRollback({ failedStarts: 2, healthy: false })).toBe(true); expect(shouldRollback({ failedStarts: 5, healthy: true })).toBe(false); });
});
