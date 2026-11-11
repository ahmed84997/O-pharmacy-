import type { Migration } from '@o-pharmacy/hub';
import { ITEM_STATES } from './states';
const states = ITEM_STATES.map(s => `'${s}'`).join(',');
export const OPS_MIGRATIONS: Migration[] = [
  { id: 'ops_0001_requests', sql: `
CREATE TABLE ops_counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
CREATE TABLE requests (
  id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('customer_request','shortage')), customer_id TEXT REFERENCES customers(id), owner_id TEXT NOT NULL, notes TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK ((kind = 'customer_request' AND customer_id IS NOT NULL) OR (kind = 'shortage' AND customer_id IS NULL))
);
CREATE INDEX requests_by_customer ON requests(customer_id);
CREATE INDEX requests_by_owner ON requests(owner_id);
CREATE TRIGGER requests_no_delete BEFORE DELETE ON requests BEGIN SELECT RAISE(ABORT, 'requests are never deleted: cancel their items'); END;
CREATE TABLE request_items (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), line_no INTEGER NOT NULL, item_id TEXT REFERENCES items(id), item_name TEXT NOT NULL CHECK (length(trim(item_name)) > 0), qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  status TEXT NOT NULL DEFAULT 'pending_purchase' CHECK (status IN (${states})), assigned_to TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (request_id, line_no)
);
CREATE INDEX request_items_by_status ON request_items(status);
CREATE INDEX request_items_by_item ON request_items(item_id);
CREATE TRIGGER request_items_no_delete BEFORE DELETE ON request_items BEGIN SELECT RAISE(ABORT, 'request items are never deleted: cancel them'); END;
CREATE TRIGGER request_items_facts BEFORE UPDATE ON request_items WHEN NEW.request_id <> OLD.request_id OR NEW.line_no <> OLD.line_no OR NEW.item_name <> OLD.item_name OR NEW.qty <> OLD.qty OR IFNULL(NEW.item_id,'') <> IFNULL(OLD.item_id,'') BEGIN SELECT RAISE(ABORT, 'what was asked for never changes: cancel and add another'); END;
CREATE TABLE request_item_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_item_id TEXT NOT NULL REFERENCES request_items(id), from_status TEXT, to_status TEXT NOT NULL, reason TEXT, data TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX request_item_events_by_item ON request_item_events(request_item_id, seq);
CREATE TRIGGER request_item_events_no_update BEFORE UPDATE ON request_item_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER request_item_events_no_delete BEFORE DELETE ON request_item_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE request_comments (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL REFERENCES requests(id), request_item_id TEXT REFERENCES request_items(id), body TEXT NOT NULL CHECK (length(trim(body)) > 0), by TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX request_comments_by_request ON request_comments(request_id, seq);
CREATE TRIGGER request_comments_no_update BEFORE UPDATE ON request_comments BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER request_comments_no_delete BEFORE DELETE ON request_comments BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
  { id: 'ops_0002_orders_notifications', sql: `
CREATE TABLE request_item_orders (id TEXT PRIMARY KEY, request_item_id TEXT NOT NULL REFERENCES request_items(id), po_id TEXT NOT NULL REFERENCES purchase_orders(id), by TEXT NOT NULL, at TEXT NOT NULL, UNIQUE (request_item_id, po_id));
CREATE INDEX request_item_orders_by_po ON request_item_orders(po_id);
CREATE TRIGGER request_item_orders_no_update BEFORE UPDATE ON request_item_orders BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER request_item_orders_no_delete BEFORE DELETE ON request_item_orders BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE order_stages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, po_id TEXT NOT NULL REFERENCES purchase_orders(id), stage TEXT NOT NULL CHECK (stage IN ('ordered','received','counted','entered','labelled','shelved')), by TEXT NOT NULL, at TEXT NOT NULL, minutes_since_prev INTEGER, note TEXT, UNIQUE (po_id, stage));
CREATE TRIGGER order_stages_no_update BEFORE UPDATE ON order_stages BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER order_stages_no_delete BEFORE DELETE ON order_stages BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE count_results (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, po_id TEXT NOT NULL REFERENCES purchase_orders(id), request_item_id TEXT NOT NULL REFERENCES request_items(id), result TEXT NOT NULL CHECK (result IN ('arrived','missing','damaged')), note TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER count_results_no_update BEFORE UPDATE ON count_results BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER count_results_no_delete BEFORE DELETE ON count_results BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE notifications (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_item_id TEXT NOT NULL REFERENCES request_items(id), customer_id TEXT REFERENCES customers(id), channel TEXT NOT NULL CHECK (channel IN ('phone','whatsapp','sms','in_person')), template TEXT NOT NULL, body TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX notifications_by_item ON notifications(request_item_id);
CREATE TRIGGER notifications_no_update BEFORE UPDATE ON notifications BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER notifications_no_delete BEFORE DELETE ON notifications BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
];
