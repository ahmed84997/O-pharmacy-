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
];
