import type { Migration } from '@o-pharmacy/hub';
export const CONTRACT_MIGRATIONS: Migration[] = [
  { id: 'ctr_0001_contracts_claims', sql: `
CREATE TABLE ctr_counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE contracts (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK (length(trim(name)) > 0), name_key TEXT NOT NULL UNIQUE, payer_type TEXT NOT NULL CHECK (payer_type IN ('insurance','corporate')), customer_id TEXT,
  valid_from TEXT NOT NULL, valid_to TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','ended')), notes TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts BEGIN SELECT RAISE(ABORT, 'contracts are never deleted: end them'); END;
CREATE TRIGGER contracts_facts BEFORE UPDATE ON contracts WHEN NEW.code <> OLD.code OR NEW.payer_type <> OLD.payer_type OR NEW.valid_from <> OLD.valid_from OR OLD.status = 'ended' BEGIN SELECT RAISE(ABORT, 'code, type and start never change, and an ended contract is final'); END;
CREATE TABLE contract_terms (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, contract_id TEXT NOT NULL REFERENCES contracts(id), coverage_percent INTEGER NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100), max_claim_minor INTEGER CHECK (max_claim_minor IS NULL OR max_claim_minor > 0), approval_above_minor INTEGER CHECK (approval_above_minor IS NULL OR approval_above_minor >= 0), claim_days INTEGER NOT NULL CHECK (claim_days BETWEEN 1 AND 365), effective_from TEXT NOT NULL, set_by TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX contract_terms_by_contract ON contract_terms(contract_id, effective_from);
CREATE TRIGGER contract_terms_no_update BEFORE UPDATE ON contract_terms BEGIN SELECT RAISE(ABORT, 'append-only: set new terms'); END;
CREATE TRIGGER contract_terms_no_delete BEFORE DELETE ON contract_terms BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE contract_members (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id), member_no TEXT NOT NULL CHECK (length(trim(member_no)) > 0), name TEXT NOT NULL CHECK (length(trim(name)) > 0), phone TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE (contract_id, member_no));
CREATE TRIGGER contract_members_no_delete BEFORE DELETE ON contract_members BEGIN SELECT RAISE(ABORT, 'members are never deleted: switch them off'); END;
CREATE TRIGGER contract_members_facts BEFORE UPDATE ON contract_members WHEN NEW.contract_id <> OLD.contract_id OR NEW.member_no <> OLD.member_no BEGIN SELECT RAISE(ABORT, 'member number never changes'); END;
CREATE TABLE contract_exclusions (contract_id TEXT NOT NULL REFERENCES contracts(id), item_ref TEXT NOT NULL, item_name TEXT, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (contract_id, item_ref));
CREATE TRIGGER contract_exclusions_no_delete BEFORE DELETE ON contract_exclusions BEGIN SELECT RAISE(ABORT, 'exclusions are never deleted: switch them off'); END;
CREATE TABLE claims (
  id TEXT PRIMARY KEY, claim_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, contract_id TEXT NOT NULL REFERENCES contracts(id), member_id TEXT NOT NULL REFERENCES contract_members(id), service_date TEXT NOT NULL, sale_ref TEXT, rx_ref TEXT,
  coverage_percent INTEGER NOT NULL, total_minor INTEGER NOT NULL CHECK (total_minor > 0), covered_minor INTEGER NOT NULL CHECK (covered_minor >= 0), copay_minor INTEGER NOT NULL CHECK (copay_minor >= 0), accepted_minor INTEGER, reject_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','batched','paid','partial','rejected','cancelled')), batch_id TEXT, approved_by TEXT, approved_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX claims_by_contract ON claims(contract_id, status);
CREATE TRIGGER claims_no_delete BEFORE DELETE ON claims BEGIN SELECT RAISE(ABORT, 'claims are never deleted: cancel them'); END;
CREATE TRIGGER claims_facts BEFORE UPDATE ON claims WHEN NEW.contract_id <> OLD.contract_id OR NEW.member_id <> OLD.member_id OR NEW.service_date <> OLD.service_date OR NEW.total_minor <> OLD.total_minor OR NEW.covered_minor <> OLD.covered_minor OR NEW.copay_minor <> OLD.copay_minor OR NEW.coverage_percent <> OLD.coverage_percent OR NEW.claim_no <> OLD.claim_no BEGIN SELECT RAISE(ABORT, 'what was claimed never changes: cancel and claim again'); END;
CREATE TABLE claim_lines (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES claims(id), line_no INTEGER NOT NULL, item_ref TEXT NOT NULL, item_name TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0), unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor > 0), line_total_minor INTEGER NOT NULL, covered_minor INTEGER NOT NULL, excluded INTEGER NOT NULL DEFAULT 0, UNIQUE (claim_id, line_no));
CREATE TRIGGER claim_lines_no_update BEFORE UPDATE ON claim_lines BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER claim_lines_no_delete BEFORE DELETE ON claim_lines BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE claim_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, claim_id TEXT NOT NULL REFERENCES claims(id), from_status TEXT, to_status TEXT NOT NULL, reason TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER claim_events_no_update BEFORE UPDATE ON claim_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER claim_events_no_delete BEFORE DELETE ON claim_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE claim_batches (id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, contract_id TEXT NOT NULL REFERENCES contracts(id), claims_count INTEGER NOT NULL, claimed_minor INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reconciled')), submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL, due_date TEXT NOT NULL, received_minor INTEGER, payment_ref TEXT, reconciled_by TEXT, reconciled_at TEXT);
CREATE TRIGGER claim_batches_no_delete BEFORE DELETE ON claim_batches BEGIN SELECT RAISE(ABORT, 'batches are never deleted'); END;
CREATE TRIGGER claim_batches_facts BEFORE UPDATE ON claim_batches WHEN NEW.contract_id <> OLD.contract_id OR NEW.claims_count <> OLD.claims_count OR NEW.claimed_minor <> OLD.claimed_minor OR NEW.batch_no <> OLD.batch_no OR OLD.status = 'reconciled' BEGIN SELECT RAISE(ABORT, 'a batch is reconciled once and never changes'); END;` },
];
