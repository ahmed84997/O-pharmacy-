import type { Pool, PoolClient } from 'pg';

/** The ONLY way service code touches business tables: a transaction with SET LOCAL context, so tenant context can never outlive the request (S6). */
export async function withTenant<T>(pool: Pool, tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('bad tenant id');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const r = await fn(c); await c.query('COMMIT'); return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
