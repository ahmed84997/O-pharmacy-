import { createHash } from 'node:crypto';
import type { Client } from 'pg';

/**
 * Cloud schema `op`. Additive migrations only, checksum-guarded, run by the admin connection (never by the app role).
 * Rules proven in spike S6: every business table has tenant_id; unique keys and foreign keys include tenant_id;
 * RLS is ENABLED and FORCED; the app role is not owner, not superuser, not BYPASSRLS.
 */
export interface Migration { id: string; sql: string }

export const MIGRATIONS: Migration[] = [
  { id: '0001_tenancy', sql: `
SET ROLE app_owner;
CREATE FUNCTION op.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE TABLE op.tenants (id uuid PRIMARY KEY, name text NOT NULL, wrapped_key bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE op.branches (tenant_id uuid NOT NULL REFERENCES op.tenants(id), id uuid NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id));
CREATE TABLE op.cloud_devices (
  tenant_id uuid NOT NULL, id uuid NOT NULL, branch_id uuid NOT NULL, name text NOT NULL,
  token_hash text NOT NULL UNIQUE, status text NOT NULL CHECK (status IN ('active','revoked')), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id), FOREIGN KEY (tenant_id, branch_id) REFERENCES op.branches (tenant_id, id));
ALTER TABLE op.tenants ENABLE ROW LEVEL SECURITY; ALTER TABLE op.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tenant ON op.tenants USING (id = op.current_tenant());
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['branches','cloud_devices'] LOOP
    EXECUTE format('ALTER TABLE op.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE op.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON op.%I USING (tenant_id = op.current_tenant()) WITH CHECK (tenant_id = op.current_tenant())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON op.tenants, op.branches, op.cloud_devices TO app_user;
RESET ROLE;
-- Token lookup happens before the tenant is known. A narrow function owned by a dedicated BYPASSRLS role returns only ids.
GRANT SELECT ON op.cloud_devices TO app_auth;
CREATE FUNCTION op.auth_lookup(p_hash text) RETURNS TABLE (tenant_id uuid, branch_id uuid, device_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = op, pg_temp AS
$$ SELECT d.tenant_id, d.branch_id, d.id FROM op.cloud_devices d WHERE d.token_hash = p_hash AND d.status = 'active' $$;
ALTER FUNCTION op.auth_lookup(text) OWNER TO app_auth;
REVOKE ALL ON FUNCTION op.auth_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION op.auth_lookup(text) TO app_user;` },
  { id: '0002_inbox', sql: `
SET ROLE app_owner;
CREATE TABLE op.inbox_events (
  tenant_id uuid NOT NULL, event_id uuid NOT NULL, branch_id uuid NOT NULL, device_id uuid NOT NULL,
  type text NOT NULL, payload jsonb NOT NULL, hub_created_at timestamptz NOT NULL,
  cseq bigint GENERATED ALWAYS AS IDENTITY, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id), FOREIGN KEY (tenant_id, branch_id) REFERENCES op.branches (tenant_id, id));
CREATE INDEX inbox_cursor ON op.inbox_events (tenant_id, cseq);
ALTER TABLE op.inbox_events ENABLE ROW LEVEL SECURITY; ALTER TABLE op.inbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON op.inbox_events USING (tenant_id = op.current_tenant()) WITH CHECK (tenant_id = op.current_tenant());
GRANT SELECT, INSERT ON op.inbox_events TO app_user;
RESET ROLE;` },
];

const sum = (s: string) => createHash('sha256').update(s).digest('hex');

export async function migrate(admin: Client, list: Migration[] = MIGRATIONS): Promise<string[]> {
  await admin.query('CREATE TABLE IF NOT EXISTS op.schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const done: string[] = [];
  for (const m of list) {
    const r = await admin.query('SELECT checksum FROM op.schema_migrations WHERE id=$1', [m.id]);
    if (r.rows[0]) { if (r.rows[0].checksum !== sum(m.sql)) throw new Error(`migration ${m.id} was changed after it was applied`); continue; }
    if (/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(m.sql)) throw new Error(`migration ${m.id} is not additive`);
    try { await admin.query('BEGIN'); await admin.query(m.sql); await admin.query('INSERT INTO op.schema_migrations(id,checksum) VALUES ($1,$2)', [m.id, sum(m.sql)]); await admin.query('COMMIT'); }
    catch (e) { await admin.query('ROLLBACK'); throw e; }
    done.push(m.id);
  }
  return done;
}
