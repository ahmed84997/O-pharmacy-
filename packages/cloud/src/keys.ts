import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Per-tenant data keys (D25). A random 256-bit data key per tenant is wrapped by a key derived from the platform master secret
 * (AES-256-GCM, tenant id as associated data) and stored in op.tenants.wrapped_key. Fields are encrypted with the tenant key,
 * bound to tenant and field name, so a value copied to another tenant or field fails to decrypt.
 */
const seal = (key: Buffer, plain: Buffer, aad: string): Buffer => {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
};
const open = (key: Buffer, blob: Buffer, aad: string): Buffer => {
  if (blob[0] !== 1) throw new Error('unknown key format');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(1, 13)); d.setAAD(Buffer.from(aad)); d.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]);
};
const kek = (master: string): Buffer => {
  if (master.length < 32) throw new Error('master secret must be 32+ characters');
  return Buffer.from(hkdfSync('sha256', Buffer.from(master), createHash('sha256').update('op-kek-v1').digest(), 'tenant-key-wrap', 32));
};

export const newTenantKey = (master: string, tenantId: string): { key: Buffer; wrapped: Buffer } => { const key = randomBytes(32); return { key, wrapped: seal(kek(master), key, `tenant:${tenantId}`) }; };
export const unwrapTenantKey = (master: string, tenantId: string, wrapped: Buffer): Buffer => open(kek(master), wrapped, `tenant:${tenantId}`);
export const encryptField = (key: Buffer, tenantId: string, field: string, value: string): Buffer => seal(key, Buffer.from(value, 'utf8'), `${tenantId}:${field}`);
export const decryptField = (key: Buffer, tenantId: string, field: string, blob: Buffer): string => open(key, blob, `${tenantId}:${field}`).toString('utf8');
