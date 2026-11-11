# @o-pharmacy/hub (Phase 2, Sprint 2.3)

The Branch Hub core: one writer per branch, works offline. SQLite through built-in `node:sqlite` (WAL, synchronous FULL; proven in spike S1).

- **Migrations** - additive only, applied once in order, checksum-guarded (editing an applied one is refused; DROP/DELETE refused).
- **Ledger** - `movements` is append-only (database triggers reject UPDATE and DELETE). Keyed by branch, store, item, batch. Mistakes are cancelled with `reverse()`: a compensating movement pointing at the original, once only, reason required. Sales cannot go below zero (per batch) unless allowed.
- **Idempotency** - every command carries a key; a retry or duplicate delivery returns the stored result and writes nothing.
- **Outbox** - the event is written in the same transaction as the movement; the sync engine (Sprint 2.5) reads `outboxPending()` and calls `outboxAck()` after the Cloud acknowledges. Rows are never deleted.
- **Audit** - persisted hash chain (core `AuditLog`); `verifyAudit()` reports the first broken entry.
- **Atomicity** - movement + outbox + audit commit together or not at all (tested with a simulated crash).

Uses `@o-pharmacy/core` through a path alias (no publishing step yet). Next: 2.4 Cloud (Postgres RLS), 2.5 sync Hub to Cloud and devices.
