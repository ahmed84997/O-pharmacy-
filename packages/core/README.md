# @o-pharmacy/core (Phase 2, Sprint 2.1)

Shared foundation used by Hub, Cloud and devices. No I/O, no framework: pure TypeScript, tested on Windows, macOS and Linux (`core.yml`).

- `ids.ts` - UUID v7 identities (time-ordered, sync-safe).
- `config.ts` - configuration engine: one schema is the single key source (type, default, allowed scopes, range); layers default < tenant < branch < device; every change reported for audit. Adding a key = add to `CONFIG_SCHEMA` + an additive data migration for existing tenants.
- `audit.ts` - append-only hash-chained audit trail; `AuditLog.verify` finds the first tampered entry. No update or delete API.
- `lifecycle.ts` - No-Delete transitions (active / void / archived) with who, when, why; history is kept on restore.

Next sprints: 2.2 identity, roles, permissions, devices; 2.3 Hub ledger and outbox; 2.4 Cloud (Postgres RLS); 2.5 sync; 2.6 installer and auto-update.
