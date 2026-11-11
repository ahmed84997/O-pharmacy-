import type { Migration } from '@o-pharmacy/hub';

/** POS tables. They plug into the Hub after the inventory migrations: `Hub.open(branch, path, clock, [...MIGRATIONS, ...POS_MIGRATIONS])`. */
export const POS_MIGRATIONS: Migration[] = [
  { id: 'pos_0001_sales', sql: `
CREATE TABLE pos_counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE cashier_sessions (
  id TEXT PRIMARY KEY, session_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE,
  terminal TEXT NOT NULL CHECK (length(trim(terminal)) > 0), user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_float_minor INTEGER NOT NULL CHECK (opening_float_minor >= 0), opened_at TEXT NOT NULL,
  closed_at TEXT, closed_by TEXT, counted_cash_minor INTEGER, expected_cash_minor INTEGER, diff_minor INTEGER, close_note TEXT
);
CREATE UNIQUE INDEX cashier_sessions_one_open_terminal ON cashier_sessions(terminal) WHERE status = 'open';
CREATE UNIQUE INDEX cashier_sessions_one_open_user ON cashier_sessions(user_id) WHERE status = 'open';
CREATE TRIGGER cashier_sessions_no_delete BEFORE DELETE ON cashier_sessions BEGIN SELECT RAISE(ABORT, 'sessions are never deleted'); END;
CREATE TRIGGER cashier_sessions_closed BEFORE UPDATE ON cashier_sessions WHEN OLD.status = 'closed' BEGIN SELECT RAISE(ABORT, 'a closed session cannot change'); END;
CREATE TRIGGER cashier_sessions_facts BEFORE UPDATE ON cashier_sessions WHEN NEW.opening_float_minor <> OLD.opening_float_minor OR NEW.user_id <> OLD.user_id OR NEW.terminal <> OLD.terminal OR NEW.opened_at <> OLD.opened_at BEGIN SELECT RAISE(ABORT, 'session facts never change'); END;
CREATE TABLE sales (
  id TEXT PRIMARY KEY, sale_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES cashier_sessions(id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0), tendered_minor INTEGER NOT NULL CHECK (tendered_minor >= 0), change_minor INTEGER NOT NULL CHECK (change_minor >= 0),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, void_by TEXT, void_at TEXT, void_reason TEXT
);
CREATE INDEX sales_by_session ON sales(session_id);
CREATE INDEX sales_by_user ON sales(created_by, created_at);
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales BEGIN SELECT RAISE(ABORT, 'sales are never deleted: void'); END;
CREATE TRIGGER sales_void_final BEFORE UPDATE ON sales WHEN OLD.status = 'void' BEGIN SELECT RAISE(ABORT, 'a void sale cannot change'); END;
CREATE TRIGGER sales_facts BEFORE UPDATE ON sales WHEN NEW.total_minor <> OLD.total_minor OR NEW.session_id <> OLD.session_id OR NEW.created_by <> OLD.created_by OR NEW.tendered_minor <> OLD.tendered_minor BEGIN SELECT RAISE(ABORT, 'sale facts never change: void and re-enter'); END;
CREATE TABLE sale_lines (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), line_no INTEGER NOT NULL, pick_no INTEGER NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id), batch_id TEXT, req_qty INTEGER NOT NULL CHECK (req_qty > 0), req_unit TEXT NOT NULL,
  qty_base INTEGER NOT NULL CHECK (qty_base > 0), price_unit_factor INTEGER NOT NULL CHECK (price_unit_factor >= 1), unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0), cost_amount_minor INTEGER NOT NULL DEFAULT 0, movement_id TEXT,
  UNIQUE (sale_id, line_no, pick_no)
);
CREATE INDEX sale_lines_by_item ON sale_lines(item_id);
CREATE TRIGGER sale_lines_no_update BEFORE UPDATE ON sale_lines BEGIN SELECT RAISE(ABORT, 'sale lines never change'); END;
CREATE TRIGGER sale_lines_no_delete BEFORE DELETE ON sale_lines BEGIN SELECT RAISE(ABORT, 'sale lines are never deleted'); END;` },
];
