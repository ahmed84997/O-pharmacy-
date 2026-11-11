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
];
