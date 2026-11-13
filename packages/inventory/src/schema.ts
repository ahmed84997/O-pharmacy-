import type { Migration } from '@o-pharmacy/hub';

/** Tables owned by the inventory module. Additive only; No-Delete is enforced by triggers (no row is ever deleted; units never change factor). */
export const MIGRATIONS: Migration[] = [
  { id: 'inv_0001_items', sql: `
CREATE TABLE item_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE inv_counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('drug','non_drug','service')),
  form TEXT, strength TEXT, active_ingredient TEXT, manufacturer TEXT,
  group_id TEXT REFERENCES item_groups(id),
  location TEXT,
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  list_price_minor INTEGER CHECK (list_price_minor IS NULL OR list_price_minor >= 0),
  eta_code_type TEXT CHECK (eta_code_type IN ('GS1','EGS')),
  eta_code TEXT,
  eta_tax TEXT NOT NULL DEFAULT 'taxable' CHECK (eta_tax IN ('taxable','exempt')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  search_text TEXT NOT NULL,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (kind <> 'drug' OR list_price_minor IS NULL),
  CHECK ((eta_code IS NULL) = (eta_code_type IS NULL))
);
CREATE INDEX items_status ON items(status);
CREATE INDEX items_ingredient ON items(active_ingredient);
CREATE TABLE item_units (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  factor INTEGER NOT NULL CHECK (factor >= 1),
  is_base INTEGER NOT NULL CHECK (is_base IN (0,1)),
  sellable INTEGER NOT NULL DEFAULT 1,
  purchasable INTEGER NOT NULL DEFAULT 1,
  UNIQUE (item_id, name),
  UNIQUE (item_id, factor),
  CHECK (is_base = 0 OR factor = 1),
  CHECK (is_base = 1 OR factor > 1)
);
CREATE UNIQUE INDEX item_units_one_base ON item_units(item_id) WHERE is_base = 1;
CREATE TABLE item_barcodes (
  barcode TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  unit_id TEXT NOT NULL REFERENCES item_units(id),
  kind TEXT NOT NULL CHECK (kind IN ('gtin','internal','alias')),
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX item_barcodes_item ON item_barcodes(item_id);
CREATE TABLE item_status_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES items(id),
  from_status TEXT NOT NULL, to_status TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL CHECK (length(trim(reason)) > 0)
);
CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT, 'items are never deleted: suspend or archive'); END;
CREATE TRIGGER item_units_no_delete BEFORE DELETE ON item_units BEGIN SELECT RAISE(ABORT, 'units are never deleted'); END;
CREATE TRIGGER item_units_factor_locked BEFORE UPDATE OF factor, is_base, item_id ON item_units BEGIN SELECT RAISE(ABORT, 'a unit factor never changes: add a new unit'); END;
CREATE TRIGGER item_barcodes_no_delete BEFORE DELETE ON item_barcodes BEGIN SELECT RAISE(ABORT, 'barcodes are never deleted: deactivate'); END;
CREATE TRIGGER item_barcodes_binding_locked BEFORE UPDATE OF barcode, item_id, unit_id ON item_barcodes BEGIN SELECT RAISE(ABORT, 'a barcode keeps its item and unit'); END;
CREATE TRIGGER items_kind_locked BEFORE UPDATE OF kind ON items WHEN NEW.kind <> OLD.kind BEGIN SELECT RAISE(ABORT, 'item kind never changes: archive and create a new item'); END;
CREATE TRIGGER item_status_log_no_update BEFORE UPDATE ON item_status_log BEGIN SELECT RAISE(ABORT, 'status log is append-only'); END;
CREATE TRIGGER item_status_log_no_delete BEFORE DELETE ON item_status_log BEGIN SELECT RAISE(ABORT, 'status log is append-only'); END;
CREATE TRIGGER item_groups_no_delete BEFORE DELETE ON item_groups BEGIN SELECT RAISE(ABORT, 'groups are never deleted'); END;` },
  { id: 'inv_0002_batches', sql: `
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  lot TEXT NOT NULL CHECK (length(trim(lot)) > 0),
  expiry TEXT NOT NULL CHECK (expiry GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  price_unit_id TEXT NOT NULL REFERENCES item_units(id),
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0),
  public_price_minor INTEGER CHECK (public_price_minor IS NULL OR public_price_minor > 0),
  pharmacist_price_minor INTEGER CHECK (pharmacist_price_minor IS NULL OR pharmacist_price_minor > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined')),
  received_at TEXT NOT NULL, received_by TEXT NOT NULL, source_ref TEXT,
  UNIQUE (item_id, lot, expiry),
  CHECK (pharmacist_price_minor IS NULL OR public_price_minor IS NOT NULL AND pharmacist_price_minor <= public_price_minor)
);
CREATE INDEX batches_item_expiry ON batches(item_id, expiry);
CREATE TABLE batch_status_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  from_status TEXT NOT NULL, to_status TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL CHECK (length(trim(reason)) > 0)
);
-- a drug batch must carry the state price (D14); services hold no stock
CREATE TRIGGER batches_drug_price BEFORE INSERT ON batches
  WHEN (SELECT kind FROM items WHERE id = NEW.item_id) = 'drug' AND NEW.public_price_minor IS NULL
  BEGIN SELECT RAISE(ABORT, 'a drug batch needs the state public price'); END;
CREATE TRIGGER batches_no_service BEFORE INSERT ON batches
  WHEN (SELECT kind FROM items WHERE id = NEW.item_id) = 'service'
  BEGIN SELECT RAISE(ABORT, 'a service has no batches'); END;
-- what was sold must stay explainable: prices, lot and expiry never change; a mistake is a new batch plus a stock adjustment
CREATE TRIGGER batches_facts_locked BEFORE UPDATE OF item_id, lot, expiry, price_unit_id, cost_minor, public_price_minor, pharmacist_price_minor ON batches
  BEGIN SELECT RAISE(ABORT, 'batch facts never change: receive a new batch'); END;
CREATE TRIGGER batches_no_delete BEFORE DELETE ON batches BEGIN SELECT RAISE(ABORT, 'batches are never deleted'); END;
CREATE TRIGGER batch_status_log_no_update BEFORE UPDATE ON batch_status_log BEGIN SELECT RAISE(ABORT, 'batch status log is append-only'); END;
CREATE TRIGGER batch_status_log_no_delete BEFORE DELETE ON batch_status_log BEGIN SELECT RAISE(ABORT, 'batch status log is append-only'); END;` },
  { id: 'inv_0003_stores', sql: `
CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('main','sales_floor','warehouse','returns','expired','quarantine')),
  sellable INTEGER NOT NULL CHECK (sellable IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
INSERT INTO stores(id, name, kind, sellable, active, created_at) VALUES ('MAIN', 'المخزن الرئيسي', 'main', 1, 1, '2026-11-11T00:00:00.000Z');
CREATE TRIGGER stores_no_delete BEFORE DELETE ON stores BEGIN SELECT RAISE(ABORT, 'stores are never deleted: deactivate'); END;
CREATE TRIGGER stores_kind_locked BEFORE UPDATE OF kind, sellable ON stores BEGIN SELECT RAISE(ABORT, 'a store keeps its kind: create another store'); END;
CREATE TABLE store_transfers (
  id TEXT PRIMARY KEY,
  transfer_no TEXT NOT NULL,
  req_key TEXT NOT NULL,
  from_store TEXT NOT NULL REFERENCES stores(id),
  to_store TEXT NOT NULL REFERENCES stores(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0),
  reason TEXT, by TEXT NOT NULL, at TEXT NOT NULL,
  CHECK (from_store <> to_store)
);
CREATE INDEX store_transfers_no ON store_transfers(transfer_no);
CREATE INDEX store_transfers_key ON store_transfers(req_key);
CREATE TRIGGER store_transfers_no_update BEFORE UPDATE ON store_transfers BEGIN SELECT RAISE(ABORT, 'transfers are append-only'); END;
CREATE TRIGGER store_transfers_no_delete BEFORE DELETE ON store_transfers BEGIN SELECT RAISE(ABORT, 'transfers are append-only'); END;` },
  { id: 'inv_0004_stocktake', sql: `
CREATE TABLE adjustments (
  id TEXT PRIMARY KEY,
  adj_no TEXT NOT NULL UNIQUE,
  req_key TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL REFERENCES items(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  qty_base INTEGER NOT NULL CHECK (qty_base <> 0),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('damaged','lost','found','expired','count_error','other')),
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  by TEXT NOT NULL, at TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, decision_note TEXT,
  flagged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX adjustments_status ON adjustments(status, at);
CREATE TRIGGER adjustments_no_delete BEFORE DELETE ON adjustments BEGIN SELECT RAISE(ABORT, 'adjustments are never deleted: reject or reverse'); END;
CREATE TRIGGER adjustments_decided BEFORE UPDATE ON adjustments WHEN OLD.status <> 'pending' BEGIN SELECT RAISE(ABORT, 'a decided adjustment cannot change'); END;
CREATE TRIGGER adjustments_facts BEFORE UPDATE ON adjustments WHEN NEW.qty_base <> OLD.qty_base OR NEW.item_id <> OLD.item_id OR NEW.batch_id <> OLD.batch_id OR NEW.store_id <> OLD.store_id OR NEW.by <> OLD.by BEGIN SELECT RAISE(ABORT, 'adjustment facts never change'); END;
CREATE TABLE stocktakes (
  id TEXT PRIMARY KEY,
  st_no TEXT NOT NULL UNIQUE,
  req_key TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','applied','cancelled')),
  blind INTEGER NOT NULL DEFAULT 1 CHECK (blind IN (0,1)),
  note TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  submitted_by TEXT, submitted_at TEXT, decided_by TEXT, decided_at TEXT, cancel_reason TEXT, flagged INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER stocktakes_no_delete BEFORE DELETE ON stocktakes BEGIN SELECT RAISE(ABORT, 'stocktakes are never deleted: cancel'); END;
CREATE TRIGGER stocktakes_closed BEFORE UPDATE ON stocktakes WHEN OLD.status IN ('applied','cancelled') BEGIN SELECT RAISE(ABORT, 'a closed stocktake cannot change'); END;
CREATE TABLE stocktake_lines (
  id TEXT PRIMARY KEY,
  stocktake_id TEXT NOT NULL REFERENCES stocktakes(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  snap_qty INTEGER NOT NULL,
  counted_qty INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
  sys_at_count INTEGER, counted_by TEXT, counted_at TEXT, applied_qty INTEGER,
  UNIQUE (stocktake_id, item_id, batch_id)
);
CREATE TRIGGER stocktake_lines_no_delete BEFORE DELETE ON stocktake_lines BEGIN SELECT RAISE(ABORT, 'stocktake lines are never deleted'); END;
CREATE TRIGGER stocktake_lines_closed BEFORE UPDATE ON stocktake_lines WHEN (SELECT status FROM stocktakes WHERE id = OLD.stocktake_id) IN ('applied','cancelled') BEGIN SELECT RAISE(ABORT, 'a closed stocktake cannot change'); END;` },
  { id: 'inv_0005_purchasing', sql: `
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  phone TEXT, address TEXT, tax_no TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TRIGGER suppliers_no_delete BEFORE DELETE ON suppliers BEGIN SELECT RAISE(ABORT, 'suppliers are never deleted: deactivate'); END;
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY, po_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partly_received','received','cancelled')),
  note TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, cancel_reason TEXT
);
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON purchase_orders BEGIN SELECT RAISE(ABORT, 'orders are never deleted: cancel'); END;
CREATE TRIGGER purchase_orders_cancelled BEFORE UPDATE ON purchase_orders WHEN OLD.status = 'cancelled' BEGIN SELECT RAISE(ABORT, 'a cancelled order cannot change'); END;
CREATE TABLE purchase_order_lines (
  id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id), item_id TEXT NOT NULL REFERENCES items(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0), UNIQUE (po_id, item_id)
);
CREATE TRIGGER purchase_order_lines_no_update BEFORE UPDATE ON purchase_order_lines BEGIN SELECT RAISE(ABORT, 'order lines are fixed: cancel and create a new order'); END;
CREATE TRIGGER purchase_order_lines_no_delete BEFORE DELETE ON purchase_order_lines BEGIN SELECT RAISE(ABORT, 'order lines are never deleted'); END;
CREATE TABLE purchase_invoices (
  id TEXT PRIMARY KEY, pi_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id), supplier_ref TEXT, po_id TEXT REFERENCES purchase_orders(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, void_by TEXT, void_at TEXT, void_reason TEXT, flagged INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX purchase_invoices_supplier_ref ON purchase_invoices(supplier_id, supplier_ref) WHERE supplier_ref IS NOT NULL;
CREATE TRIGGER purchase_invoices_no_delete BEFORE DELETE ON purchase_invoices BEGIN SELECT RAISE(ABORT, 'invoices are never deleted: void'); END;
CREATE TRIGGER purchase_invoices_voided BEFORE UPDATE ON purchase_invoices WHEN OLD.status = 'void' BEGIN SELECT RAISE(ABORT, 'a void invoice cannot change'); END;
CREATE TRIGGER purchase_invoices_facts BEFORE UPDATE ON purchase_invoices WHEN NEW.total_minor <> OLD.total_minor OR NEW.supplier_id <> OLD.supplier_id OR NEW.store_id <> OLD.store_id BEGIN SELECT RAISE(ABORT, 'invoice facts never change: void and re-enter'); END;
CREATE TABLE purchase_invoice_lines (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id), line_no INTEGER NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id), batch_id TEXT NOT NULL REFERENCES batches(id), movement_id TEXT NOT NULL,
  paid_base INTEGER NOT NULL CHECK (paid_base > 0), bonus_base INTEGER NOT NULL DEFAULT 0 CHECK (bonus_base >= 0),
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0), eff_cost_minor INTEGER NOT NULL CHECK (eff_cost_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0), UNIQUE (invoice_id, line_no)
);
CREATE INDEX purchase_invoice_lines_item ON purchase_invoice_lines(item_id);
CREATE TRIGGER purchase_invoice_lines_no_update BEFORE UPDATE ON purchase_invoice_lines BEGIN SELECT RAISE(ABORT, 'invoice lines never change'); END;
CREATE TRIGGER purchase_invoice_lines_no_delete BEFORE DELETE ON purchase_invoice_lines BEGIN SELECT RAISE(ABORT, 'invoice lines are never deleted'); END;
CREATE TABLE purchase_returns (
  id TEXT PRIMARY KEY, pr_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id), invoice_id TEXT REFERENCES purchase_invoices(id), store_id TEXT NOT NULL REFERENCES stores(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0), total_minor INTEGER NOT NULL CHECK (total_minor >= 0), by TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TRIGGER purchase_returns_no_update BEFORE UPDATE ON purchase_returns BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TRIGGER purchase_returns_no_delete BEFORE DELETE ON purchase_returns BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TABLE purchase_return_lines (
  id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES purchase_returns(id), item_id TEXT NOT NULL REFERENCES items(id), batch_id TEXT NOT NULL REFERENCES batches(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0), value_minor INTEGER NOT NULL CHECK (value_minor >= 0)
);
CREATE TRIGGER purchase_return_lines_no_update BEFORE UPDATE ON purchase_return_lines BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;
CREATE TRIGGER purchase_return_lines_no_delete BEFORE DELETE ON purchase_return_lines BEGIN SELECT RAISE(ABORT, 'returns are append-only'); END;` },
  { id: 'inv_0006_import', sql: `
CREATE TABLE imports (
  id TEXT PRIMARY KEY, import_no TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('items','stock','suppliers')),
  source TEXT NOT NULL, file_hash TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('all_or_nothing','valid_only')),
  rows_total INTEGER NOT NULL, created INTEGER NOT NULL, skipped INTEGER NOT NULL, failed INTEGER NOT NULL,
  report TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, UNIQUE (kind, file_hash)
);
CREATE TRIGGER imports_no_update BEFORE UPDATE ON imports BEGIN SELECT RAISE(ABORT, 'import records are append-only'); END;
CREATE TRIGGER imports_no_delete BEFORE DELETE ON imports BEGIN SELECT RAISE(ABORT, 'import records are append-only'); END;
CREATE TABLE import_refs (
  source TEXT NOT NULL, entity TEXT NOT NULL CHECK (entity IN ('item','supplier')), source_code TEXT NOT NULL, entity_id TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES imports(id),
  PRIMARY KEY (source, entity, source_code)
);
CREATE INDEX import_refs_entity ON import_refs(entity_id);
CREATE TRIGGER import_refs_no_update BEFORE UPDATE ON import_refs BEGIN SELECT RAISE(ABORT, 'import references are append-only'); END;
CREATE TRIGGER import_refs_no_delete BEFORE DELETE ON import_refs BEGIN SELECT RAISE(ABORT, 'import references are append-only'); END;` },
  { id: 'inv_0007_purchase_drafts', sql: `
ALTER TABLE purchase_invoice_lines ADD COLUMN discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000);
ALTER TABLE purchase_invoice_lines ADD COLUMN tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0);
ALTER TABLE purchase_invoices ADD COLUMN tax_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_total_minor >= 0);
ALTER TABLE purchase_invoices ADD COLUMN draft_id TEXT;
CREATE TABLE purchase_drafts (
  id TEXT PRIMARY KEY, draft_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, supplier_id TEXT REFERENCES suppliers(id), supplier_ref TEXT, po_id TEXT REFERENCES purchase_orders(id),
  lines TEXT NOT NULL, line_count INTEGER NOT NULL DEFAULT 0, note TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','used','cancelled')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, closed_by TEXT, closed_at TEXT, closed_reason TEXT, pi_no TEXT
);
CREATE INDEX purchase_drafts_open ON purchase_drafts(status);
CREATE TRIGGER purchase_drafts_no_delete BEFORE DELETE ON purchase_drafts BEGIN SELECT RAISE(ABORT, 'held invoices are never deleted: cancel with a reason'); END;
CREATE TRIGGER purchase_drafts_closed BEFORE UPDATE ON purchase_drafts WHEN OLD.status <> 'open' BEGIN SELECT RAISE(ABORT, 'a used or cancelled held invoice never changes'); END;` },
];
