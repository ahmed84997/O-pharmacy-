import type { Migration } from '@o-pharmacy/hub';
export const ETA_MIGRATIONS: Migration[] = [
  { id: 'eta_0001_receipts', sql: `
CREATE TABLE eta_receipts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('sale','return','void')), ref TEXT NOT NULL, doc_type TEXT NOT NULL CHECK (doc_type IN ('s','r')), device TEXT NOT NULL,
  uuid TEXT NOT NULL UNIQUE CHECK (length(uuid) = 64), previous_uuid TEXT NOT NULL, reference_uuid TEXT, old_uuid TEXT, payload TEXT NOT NULL, issued_at TEXT NOT NULL, deadline_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired','replaced')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT,
  submission_uuid TEXT, long_id TEXT, settled_at TEXT, reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX eta_receipts_ref ON eta_receipts(kind, ref) WHERE status <> 'replaced';
CREATE INDEX eta_receipts_due ON eta_receipts(status, next_attempt_at);
CREATE INDEX eta_receipts_device ON eta_receipts(device, seq);
CREATE TRIGGER eta_receipts_no_delete BEFORE DELETE ON eta_receipts BEGIN SELECT RAISE(ABORT, 'ETA receipts are never deleted'); END;
CREATE TRIGGER eta_receipts_facts BEFORE UPDATE ON eta_receipts WHEN NEW.uuid <> OLD.uuid OR NEW.payload <> OLD.payload OR NEW.previous_uuid <> OLD.previous_uuid OR NEW.kind <> OLD.kind OR NEW.ref <> OLD.ref OR NEW.issued_at <> OLD.issued_at OR NEW.device <> OLD.device BEGIN SELECT RAISE(ABORT, 'an ETA receipt never changes: issue a corrected one'); END;
CREATE TRIGGER eta_receipts_final BEFORE UPDATE ON eta_receipts WHEN OLD.status IN ('accepted','replaced') BEGIN SELECT RAISE(ABORT, 'an accepted or replaced ETA receipt is final'); END;
CREATE TABLE eta_attempts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, receipt_id TEXT NOT NULL REFERENCES eta_receipts(id), at TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('accepted','rejected','error')), http_status INTEGER, detail TEXT
);
CREATE TRIGGER eta_attempts_no_update BEFORE UPDATE ON eta_attempts BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER eta_attempts_no_delete BEFORE DELETE ON eta_attempts BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
];
