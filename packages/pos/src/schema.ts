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
  { id: 'pos_0002_payments_discounts_holds_delivery', sql: `
ALTER TABLE sales ADD COLUMN gross_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN delivery_fee_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN channel TEXT NOT NULL DEFAULT 'counter';
ALTER TABLE sale_lines ADD COLUMN discount_minor INTEGER NOT NULL DEFAULT 0;
CREATE TABLE sale_payments (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), session_id TEXT REFERENCES cashier_sessions(id),
  method TEXT NOT NULL CHECK (method IN ('cash','card','cod')), amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  tendered_minor INTEGER NOT NULL DEFAULT 0, change_minor INTEGER NOT NULL DEFAULT 0, ref TEXT, by TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX sale_payments_by_session ON sale_payments(session_id, method);
CREATE INDEX sale_payments_by_sale ON sale_payments(sale_id);
CREATE TRIGGER sale_payments_no_update BEFORE UPDATE ON sale_payments BEGIN SELECT RAISE(ABORT, 'payments never change'); END;
CREATE TRIGGER sale_payments_no_delete BEFORE DELETE ON sale_payments BEGIN SELECT RAISE(ABORT, 'payments are never deleted'); END;
CREATE TABLE held_bills (
  id TEXT PRIMARY KEY, hold_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES cashier_sessions(id), user_id TEXT NOT NULL,
  lines TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','used','cancelled')), created_at TEXT NOT NULL, closed_at TEXT, closed_reason TEXT, sale_no TEXT
);
CREATE INDEX held_bills_open ON held_bills(session_id, status);
CREATE TRIGGER held_bills_no_delete BEFORE DELETE ON held_bills BEGIN SELECT RAISE(ABORT, 'held bills are never deleted: cancel'); END;
CREATE TRIGGER held_bills_closed BEFORE UPDATE ON held_bills WHEN OLD.status <> 'open' BEGIN SELECT RAISE(ABORT, 'a closed held bill cannot change'); END;
CREATE TRIGGER held_bills_lines_fixed BEFORE UPDATE ON held_bills WHEN NEW.lines <> OLD.lines OR NEW.session_id <> OLD.session_id OR NEW.user_id <> OLD.user_id BEGIN SELECT RAISE(ABORT, 'a held bill keeps its lines'); END;
CREATE TABLE sale_deliveries (
  sale_id TEXT PRIMARY KEY REFERENCES sales(id), name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','out_for_delivery','delivered','failed')), agent TEXT, status_at TEXT NOT NULL, status_by TEXT NOT NULL, failed_reason TEXT
);
CREATE TRIGGER sale_deliveries_no_delete BEFORE DELETE ON sale_deliveries BEGIN SELECT RAISE(ABORT, 'deliveries are never deleted'); END;
CREATE TRIGGER sale_deliveries_final BEFORE UPDATE ON sale_deliveries WHEN OLD.status IN ('delivered','failed') BEGIN SELECT RAISE(ABORT, 'a finished delivery cannot change'); END;
CREATE TRIGGER sale_deliveries_facts BEFORE UPDATE ON sale_deliveries WHEN NEW.sale_id <> OLD.sale_id OR NEW.name <> OLD.name OR NEW.phone <> OLD.phone OR NEW.address <> OLD.address BEGIN SELECT RAISE(ABORT, 'delivery details never change'); END;` },
  { id: 'pos_0003_returns_swaps', sql: `
ALTER TABLE sales ADD COLUMN swap_credit_minor INTEGER NOT NULL DEFAULT 0;
CREATE TABLE sale_returns (
  id TEXT PRIMARY KEY, return_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, sale_id TEXT NOT NULL REFERENCES sales(id), session_id TEXT NOT NULL REFERENCES cashier_sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('return','swap')), reason_code TEXT NOT NULL CHECK (reason_code IN ('wrong_item','changed_mind','damaged','doctor_changed','other')), note TEXT,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0), cash_minor INTEGER NOT NULL DEFAULT 0, card_minor INTEGER NOT NULL DEFAULT 0, credit_minor INTEGER NOT NULL DEFAULT 0, card_ref TEXT,
  swap_sale_no TEXT, by TEXT NOT NULL, at TEXT NOT NULL, CHECK (cash_minor + card_minor + credit_minor = total_minor)
);
CREATE INDEX sale_returns_by_sale ON sale_returns(sale_id);
CREATE INDEX sale_returns_by_session ON sale_returns(session_id);
CREATE TRIGGER sale_returns_no_update BEFORE UPDATE ON sale_returns BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TRIGGER sale_returns_no_delete BEFORE DELETE ON sale_returns BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TABLE sale_return_lines (
  id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES sale_returns(id), sale_line_id TEXT NOT NULL REFERENCES sale_lines(id), item_id TEXT NOT NULL REFERENCES items(id), batch_id TEXT,
  qty_base INTEGER NOT NULL CHECK (qty_base > 0), refund_minor INTEGER NOT NULL CHECK (refund_minor >= 0), store_id TEXT, condition TEXT NOT NULL CHECK (condition IN ('resellable','damaged'))
);
CREATE INDEX sale_return_lines_by_line ON sale_return_lines(sale_line_id);
CREATE TRIGGER sale_return_lines_no_update BEFORE UPDATE ON sale_return_lines BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TRIGGER sale_return_lines_no_delete BEFORE DELETE ON sale_return_lines BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;` },
  { id: 'pos_0004_customers_credit', sql: `
CREATE TABLE customers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK (length(trim(name)) > 0), phone TEXT, kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','company')),
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0), notes TEXT, search_text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE TRIGGER customers_no_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT, 'customers are never deleted: suspend'); END;
CREATE TABLE customer_status_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL REFERENCES customers(id), active INTEGER NOT NULL, reason TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER customer_status_log_no_update BEFORE UPDATE ON customer_status_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER customer_status_log_no_delete BEFORE DELETE ON customer_status_log BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE customer_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL CHECK (kind IN ('opening','sale','payment','return','void')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0), method TEXT CHECK (method IS NULL OR method IN ('cash','card')), ref TEXT, session_id TEXT REFERENCES cashier_sessions(id), note TEXT,
  req_key TEXT UNIQUE, by TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX customer_ledger_by_customer ON customer_ledger(customer_id, seq);
CREATE INDEX customer_ledger_by_session ON customer_ledger(session_id, kind);
CREATE TRIGGER customer_ledger_no_update BEFORE UPDATE ON customer_ledger BEGIN SELECT RAISE(ABORT, 'the customer ledger is append-only: add a correcting entry'); END;
CREATE TRIGGER customer_ledger_no_delete BEFORE DELETE ON customer_ledger BEGIN SELECT RAISE(ABORT, 'the customer ledger is append-only'); END;
ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN credit_minor INTEGER NOT NULL DEFAULT 0;
CREATE INDEX sales_by_customer ON sales(customer_id);` },
  { id: 'pos_0005_closing', sql: `
CREATE TABLE session_reviews (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES cashier_sessions(id), decision TEXT NOT NULL CHECK (decision IN ('accepted','escalated')), note TEXT, flagged INTEGER NOT NULL DEFAULT 0, by TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX session_reviews_by_session ON session_reviews(session_id, seq);
CREATE TRIGGER session_reviews_no_update BEFORE UPDATE ON session_reviews BEGIN SELECT RAISE(ABORT, 'reviews are append-only'); END;
CREATE TRIGGER session_reviews_no_delete BEFORE DELETE ON session_reviews BEGIN SELECT RAISE(ABORT, 'reviews are append-only'); END;
CREATE TABLE day_closings (
  id TEXT PRIMARY KEY, business_date TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, sessions_count INTEGER NOT NULL, totals_json TEXT NOT NULL, note TEXT, closed_by TEXT NOT NULL, closed_at TEXT NOT NULL
);
CREATE TRIGGER day_closings_no_update BEFORE UPDATE ON day_closings BEGIN SELECT RAISE(ABORT, 'a closed day cannot change: corrections go forward'); END;
CREATE TRIGGER day_closings_no_delete BEFORE DELETE ON day_closings BEGIN SELECT RAISE(ABORT, 'a closed day is never deleted'); END;` },
];
