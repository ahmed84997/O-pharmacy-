import type { Migration } from '@o-pharmacy/hub';
export const ACCOUNT_KINDS = ['cash', 'wallet', 'bank', 'custody', 'other'] as const;
export const ACCOUNTS_MIGRATIONS: Migration[] = [
  { id: 'acc_0001_accounts_ledger', sql: `
CREATE TABLE acc_counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE money_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0), name_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('cash','wallet','bank','custody','other')),
  opening_minor INTEGER NOT NULL DEFAULT 0, opening_date TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1, deactivated_reason TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER money_accounts_no_delete BEFORE DELETE ON money_accounts BEGIN SELECT RAISE(ABORT, 'accounts are never deleted: deactivate them'); END;
CREATE TRIGGER money_accounts_facts BEFORE UPDATE ON money_accounts WHEN NEW.kind <> OLD.kind OR NEW.opening_minor <> OLD.opening_minor OR NEW.opening_date <> OLD.opening_date BEGIN SELECT RAISE(ABORT, 'kind and opening balance never change: post an entry'); END;
CREATE TABLE ledger_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(trim(name)) > 0), name_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('in','out','transfer')), sort INTEGER NOT NULL DEFAULT 100, active INTEGER NOT NULL DEFAULT 1);
CREATE TRIGGER ledger_categories_no_delete BEFORE DELETE ON ledger_categories BEGIN SELECT RAISE(ABORT, 'categories are never deleted: deactivate them'); END;
CREATE TRIGGER ledger_categories_facts BEFORE UPDATE ON ledger_categories WHEN NEW.kind <> OLD.kind BEGIN SELECT RAISE(ABORT, 'the kind of a category never changes'); END;
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY, entry_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, entry_date TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES money_accounts(id), kind TEXT NOT NULL CHECK (kind IN ('in','out','transfer')),
  to_account_id TEXT REFERENCES money_accounts(id), category_id TEXT NOT NULL REFERENCES ledger_categories(id), amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), party TEXT, description TEXT, ref_no TEXT, source_ref TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, void_by TEXT, void_at TEXT, void_reason TEXT,
  CHECK ((kind = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id) OR (kind <> 'transfer' AND to_account_id IS NULL))
);
CREATE INDEX ledger_entries_by_account ON ledger_entries(account_id, entry_date);
CREATE INDEX ledger_entries_by_to ON ledger_entries(to_account_id, entry_date);
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'entries are never deleted: void them'); END;
CREATE TRIGGER ledger_entries_facts BEFORE UPDATE ON ledger_entries WHEN NEW.entry_date <> OLD.entry_date OR NEW.account_id <> OLD.account_id OR NEW.kind <> OLD.kind OR IFNULL(NEW.to_account_id,'') <> IFNULL(OLD.to_account_id,'') OR NEW.category_id <> OLD.category_id OR NEW.amount_minor <> OLD.amount_minor OR NEW.created_at <> OLD.created_at BEGIN SELECT RAISE(ABORT, 'an entry never changes: void it and post another'); END;
CREATE TRIGGER ledger_entries_voided BEFORE UPDATE ON ledger_entries WHEN OLD.status = 'void' BEGIN SELECT RAISE(ABORT, 'a void entry cannot change'); END;
CREATE TABLE cheques (
  id TEXT PRIMARY KEY, cheque_ref TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, direction TEXT NOT NULL CHECK (direction IN ('received','issued')), cheque_no TEXT NOT NULL, bank_name TEXT, party TEXT NOT NULL CHECK (length(trim(party)) > 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), due_date TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES money_accounts(id), status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','bounced','cancelled')), entry_id TEXT REFERENCES ledger_entries(id), note TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX cheques_by_due ON cheques(status, due_date);
CREATE TRIGGER cheques_no_delete BEFORE DELETE ON cheques BEGIN SELECT RAISE(ABORT, 'cheques are never deleted: cancel them'); END;
CREATE TRIGGER cheques_facts BEFORE UPDATE ON cheques WHEN NEW.direction <> OLD.direction OR NEW.cheque_no <> OLD.cheque_no OR NEW.amount_minor <> OLD.amount_minor OR NEW.party <> OLD.party OR NEW.account_id <> OLD.account_id OR NEW.due_date <> OLD.due_date BEGIN SELECT RAISE(ABORT, 'what is written on a cheque never changes: cancel and register another'); END;
CREATE TABLE cheque_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, cheque_id TEXT NOT NULL REFERENCES cheques(id), from_status TEXT, to_status TEXT NOT NULL, reason TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER cheque_events_no_update BEFORE UPDATE ON cheque_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER cheque_events_no_delete BEFORE DELETE ON cheque_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE ledger_inbox (
  id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, source TEXT NOT NULL CHECK (source IN ('closing_cash','closing_card')), business_date TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','ignored')), entry_id TEXT REFERENCES ledger_entries(id), decided_by TEXT, decided_at TEXT, note TEXT, created_at TEXT NOT NULL
);
CREATE TRIGGER ledger_inbox_no_delete BEFORE DELETE ON ledger_inbox BEGIN SELECT RAISE(ABORT, 'inbox rows are never deleted: ignore them'); END;
CREATE TRIGGER ledger_inbox_facts BEFORE UPDATE ON ledger_inbox WHEN NEW.ref <> OLD.ref OR NEW.amount_minor <> OLD.amount_minor OR NEW.business_date <> OLD.business_date OR OLD.status <> 'pending' BEGIN SELECT RAISE(ABORT, 'a proposal never changes and is decided once'); END;` },
];
