import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { newTenantKey } from './keys';

export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

/** Platform administration (onboarding), run with the admin connection under SET ROLE app_owner + tenant context; never exposed to tenants. */
export async function createTenant(admin: Client, master: string, name: string, branchName: string): Promise<{ tenantId: string; branchId: string }> {
  const tenantId = randomUUID(), branchId = randomUUID(); const { wrapped } = newTenantKey(master, tenantId);
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE app_owner'); await admin.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await admin.query('INSERT INTO op.tenants(id,name,wrapped_key) VALUES ($1,$2,$3)', [tenantId, name, wrapped]);
    await admin.query('INSERT INTO op.branches(tenant_id,id,name) VALUES ($1,$2,$3)', [tenantId, branchId, branchName]);
    await admin.query('COMMIT');
  } catch (e) { await admin.query('ROLLBACK'); throw e; }
  return { tenantId, branchId };
}

/** Returns the plaintext token ONCE; only its hash is stored. */
export async function registerDevice(admin: Client, tenantId: string, branchId: string, name: string): Promise<{ deviceId: string; token: string }> {
  const deviceId = randomUUID(); const token = randomBytes(32).toString('base64url');
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE app_owner'); await admin.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await admin.query("INSERT INTO op.cloud_devices(tenant_id,id,branch_id,name,token_hash,status) VALUES ($1,$2,$3,$4,$5,'active')", [tenantId, deviceId, branchId, name, hashToken(token)]);
    await admin.query('COMMIT');
  } catch (e) { await admin.query('ROLLBACK'); throw e; }
  return { deviceId, token };
}

export async function revokeDevice(admin: Client, tenantId: string, deviceId: string): Promise<void> {
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE app_owner'); await admin.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await admin.query("UPDATE op.cloud_devices SET status='revoked' WHERE tenant_id=$1 AND id=$2", [tenantId, deviceId]);
    await admin.query('COMMIT');
  } catch (e) { await admin.query('ROLLBACK'); throw e; }
}

export async function createBranch(admin: Client, tenantId: string, name: string): Promise<{ branchId: string }> {
  const branchId = randomUUID();
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE app_owner'); await admin.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await admin.query('INSERT INTO op.branches(tenant_id,id,name) VALUES ($1,$2,$3)', [tenantId, branchId, name]);
    await admin.query('COMMIT');
  } catch (e) { await admin.query('ROLLBACK'); throw e; }
  return { branchId };
}
