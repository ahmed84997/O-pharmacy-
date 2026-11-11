import type { Client } from 'pg';

/**
 * One-time, run by the database administrator (never by the app). The app password comes from the caller (environment/secret store);
 * nothing secret is written in code. Roles: app_owner owns objects and cannot log in; app_user is the only login the service uses
 * (no superuser, no BYPASSRLS); app_auth is a narrow role used only by the token-lookup function.
 */
export async function bootstrap(admin: Client, appPassword: string): Promise<void> {
  if (appPassword.length < 12) throw new Error('app role password must be 12+ characters');
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_owner') THEN CREATE ROLE app_owner NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_auth') THEN CREATE ROLE app_auth NOLOGIN BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF;
  END $$;`);
  await admin.query(`ALTER ROLE app_user PASSWORD ${lit(appPassword)}`);
  await admin.query('CREATE SCHEMA IF NOT EXISTS op AUTHORIZATION app_owner');
  await admin.query('GRANT USAGE ON SCHEMA op TO app_user, app_auth');
}
