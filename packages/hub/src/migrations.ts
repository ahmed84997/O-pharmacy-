import { createHash } from 'node:crypto';
import type { DB } from './db';

/**
 * Additive migrations only (ARD): new tables, new columns, new indexes. Applied once, in order, checksum-guarded:
 * editing an applied migration is refused. Never DROP or DELETE data.
 */
export interface Migration { id: string; sql: string }

export const MIGRATIONS: Migration[] = [
  { id: '0001_ledger', sql: `
CREATE TABLE movements (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  batch_id TEXT,
  qty INTEGER NOT NULL CHECK (qty <> 0),
  kind TEXT NOT NULL,
  ref TEXT,
  reason TEXT,
  actor TEXT NOT NULL,
  device_id TEXT,
  reverses TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX movements_balance ON movements(branch_id, store_id, item_id, batch_id);
CREATE UNIQUE INDEX movements_reverses ON movements(reverses) WHERE reverses IS NOT NULL;
CREATE TRIGGER movements_no_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER movements_no_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TABLE idempotency (key TEXT PRIMARY KEY, result TEXT NOT NULL, created_at TEXT NOT NULL);` },
  { id: '0002_outbox', sql: `
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox(seq) WHERE sent_at IS NULL;
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'outbox is never deleted'); END;
CREATE TRIGGER outbox_immutable_body BEFORE UPDATE ON outbox
  WHEN NEW.id <> OLD.id OR NEW.type <> OLD.type OR NEW.branch_id <> OLD.branch_id OR NEW.payload <> OLD.payload OR NEW.created_at <> OLD.created_at
  BEGIN SELECT RAISE(ABORT, 'outbox body is immutable'); END;` },
  { id: '0003_audit', sql: `
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  branch_id TEXT,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;` },
  { id: '0004_remote_events', sql: `
CREATE TABLE remote_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  hub_created_at TEXT NOT NULL,
  cloud_seq INTEGER NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TRIGGER remote_no_update BEFORE UPDATE ON remote_events BEGIN SELECT RAISE(ABORT, 'remote events are append-only'); END;
CREATE TRIGGER remote_no_delete BEFORE DELETE ON remote_events BEGIN SELECT RAISE(ABORT, 'remote events are append-only'); END;
CREATE TABLE sync_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);` },
  { id: '0005_movements_by_item', sql: `CREATE INDEX movements_by_item ON movements(branch_id, item_id, batch_id, store_id);` },
];

const sum = (s: string) => createHash('sha256').update(s).digest('hex');

export function migrate(db: DB, list: Migration[] = MIGRATIONS): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied: string[] = [];
  for (const m of list) {
    const row = db.prepare('SELECT checksum FROM schema_migrations WHERE id=?').get(m.id) as { checksum: string } | undefined;
    if (row) { if (row.checksum !== sum(m.sql)) throw new Error(`migration ${m.id} was changed after it was applied`); continue; }
    if (/\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(m.sql)) throw new Error(`migration ${m.id} is not additive`);
    db.tx(() => { db.exec(m.sql); db.prepare('INSERT INTO schema_migrations(id,checksum,applied_at) VALUES(?,?,?)').run(m.id, sum(m.sql), new Date().toISOString()); });
    applied.push(m.id);
  }
  return applied;
}
