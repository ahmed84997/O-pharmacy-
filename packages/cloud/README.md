# @o-pharmacy/cloud (Phase 2, Sprint 2.4)

Cloud core on PostgreSQL + Fastify (ADR-0001). Multi-tenant in one database, isolation by Row-Level Security (spike S6 rules).

- `bootstrap.ts` - one-time roles and schema by the DB admin: `app_owner` (owns objects, no login), `app_user` (the only service login: not superuser, no BYPASSRLS), `app_auth` (narrow, used by the token lookup). The app password is passed in, never written in code.
- `migrations.ts` - additive, checksum-guarded, run by the admin connection. Every table: `tenant_id`, composite keys and foreign keys, RLS enabled AND forced.
- `tenant.ts` - `withTenant`: the only way service code touches business tables (transaction + SET LOCAL). No context = zero rows.
- `keys.ts` - per-tenant data keys (D25): AES-256-GCM, wrapped by a key derived from the platform master secret; fields bound to tenant and field name.
- `admin.ts` - onboarding: create tenant and branch, register or revoke a device (token shown once, only its hash stored).
- `server.ts` - `GET /health`, `POST /v1/ingest`: device bearer token resolves tenant, branch and device; Hub outbox events are stored idempotently by event id (the Hub can retry safely and acknowledges what comes back in `acked`).

Tests run on a real PostgreSQL (embedded). Next: 2.5 sync between Hub, Cloud and devices (pull side, cursors, conflict rules), then 2.6 installer, auto-update, licences.
