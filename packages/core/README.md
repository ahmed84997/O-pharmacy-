# @o-pharmacy/core (Phase 2, Sprint 2.1)

Shared foundation used by Hub, Cloud and devices. No I/O, no framework: pure TypeScript, tested on Windows, macOS and Linux (`core.yml`).

- `ids.ts` - UUID v7 identities (time-ordered, sync-safe).
- `config.ts` - configuration engine: one schema is the single key source (type, default, allowed scopes, range); layers default < tenant < branch < device; every change reported for audit. Adding a key = add to `CONFIG_SCHEMA` + an additive data migration for existing tenants.
- `audit.ts` - append-only hash-chained audit trail; `AuditLog.verify` finds the first tampered entry. No update or delete API.
- `lifecycle.ts` - No-Delete transitions (active / void / archived) with who, when, why; history is kept on restore.

- `permissions.ts` - permission catalogue (135 keys, one per action) and 9 role templates from the permission matrix; a person holds several roles (union, D23) plus per-person grants and denials; `can(person, key, branch)` with branch scope (Owner all, others own branch, D15); separation of duties with the one-person relaxation. No delete permission exists.
- `identity.ts` - scrypt secret hashing, user directory (login, lockout after repeated failures, deactivate-never-delete).
- `devices.ts` - device registry: pending until approved, revoke is final, branch bound, full log.

- `licence.ts` - Ed25519-signed licences (edition, branch limit, features, expiry, grace days); states valid / grace / read-only / invalid; `entitlements()` for screens and APIs. Policy: never lock out mid-day; after grace, read-only and data stays exportable.
- `update.ts` - signed update manifest, version compare (never downgrade), staged rollout (stable bucket per device), business-hours rule, forced minimum version, artifact SHA-256 check, rollback rule.

Next sprints: (2.2 done) 2.2 identity, roles, permissions, devices; 2.3 Hub ledger and outbox; 2.4 Cloud (Postgres RLS); 2.5 sync; 2.6 installer and auto-update.
