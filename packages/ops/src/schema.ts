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
  { id: 'ops_0003_handover_tasks', sql: `
CREATE TABLE item_handovers (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, request_item_id TEXT NOT NULL REFERENCES request_items(id), step TEXT NOT NULL CHECK (step IN ('dispatched','delivered','failed','not_collected')), method TEXT CHECK (method IN ('pickup','home')), address TEXT, receiver TEXT, note TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX item_handovers_by_item ON item_handovers(request_item_id, seq);
CREATE TRIGGER item_handovers_no_update BEFORE UPDATE ON item_handovers BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER item_handovers_no_delete BEFORE DELETE ON item_handovers BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE staff_tasks (
  id TEXT PRIMARY KEY, task_no TEXT NOT NULL UNIQUE, req_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL CHECK (length(trim(title)) > 0), body TEXT, assigned_to TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, closed_by TEXT, closed_at TEXT, close_note TEXT
);
CREATE INDEX staff_tasks_by_person ON staff_tasks(assigned_to, status);
CREATE TRIGGER staff_tasks_no_delete BEFORE DELETE ON staff_tasks BEGIN SELECT RAISE(ABORT, 'tasks are never deleted: cancel them'); END;
CREATE TRIGGER staff_tasks_facts BEFORE UPDATE ON staff_tasks WHEN NEW.title <> OLD.title OR NEW.task_no <> OLD.task_no OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at BEGIN SELECT RAISE(ABORT, 'what a task asks never changes: cancel and create another'); END;
CREATE TRIGGER staff_tasks_closed BEFORE UPDATE ON staff_tasks WHEN OLD.status <> 'open' BEGIN SELECT RAISE(ABORT, 'a closed task cannot change'); END;
CREATE TABLE staff_task_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL REFERENCES staff_tasks(id), action TEXT NOT NULL CHECK (action IN ('created','assigned','done','cancelled')), note TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER staff_task_events_no_update BEFORE UPDATE ON staff_task_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER staff_task_events_no_delete BEFORE DELETE ON staff_task_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
  { id: 'ops_0004_attendance', sql: `
CREATE TABLE shift_schedules (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL, weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), start_hm TEXT NOT NULL, end_hm TEXT NOT NULL, effective_from TEXT NOT NULL, set_by TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX shift_schedules_by_person ON shift_schedules(person_id, effective_from);
CREATE TRIGGER shift_schedules_no_update BEFORE UPDATE ON shift_schedules BEGIN SELECT RAISE(ABORT, 'append-only: set a new schedule'); END;
CREATE TRIGGER shift_schedules_no_delete BEFORE DELETE ON shift_schedules BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE attendance_days (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL, work_date TEXT NOT NULL, planned_start TEXT, planned_end TEXT, check_in TEXT, check_out TEXT,
  status TEXT NOT NULL CHECK (status IN ('present','absent','leave')), late_minutes INTEGER NOT NULL DEFAULT 0, early_minutes INTEGER NOT NULL DEFAULT 0, worked_minutes INTEGER NOT NULL DEFAULT 0, overtime_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_status TEXT NOT NULL DEFAULT 'none' CHECK (overtime_status IN ('none','pending','approved','rejected')), overtime_by TEXT, overtime_note TEXT, created_at TEXT NOT NULL, UNIQUE (person_id, work_date)
);
CREATE INDEX attendance_days_by_date ON attendance_days(work_date);
CREATE TRIGGER attendance_days_no_delete BEFORE DELETE ON attendance_days BEGIN SELECT RAISE(ABORT, 'attendance days are never deleted: correct them with a reason'); END;
CREATE TRIGGER attendance_days_facts BEFORE UPDATE ON attendance_days WHEN NEW.person_id <> OLD.person_id OR NEW.work_date <> OLD.work_date BEGIN SELECT RAISE(ABORT, 'whose day and which day never change'); END;
CREATE TABLE attendance_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, day_id TEXT NOT NULL REFERENCES attendance_days(id), action TEXT NOT NULL CHECK (action IN ('check_in','check_out','correction','overtime','absent','leave')), before TEXT, after TEXT, reason TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER attendance_events_no_update BEFORE UPDATE ON attendance_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER attendance_events_no_delete BEFORE DELETE ON attendance_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL, work_date TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('leave','permission')), reason TEXT NOT NULL CHECK (length(trim(reason)) > 0), status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, decision_note TEXT, UNIQUE (person_id, work_date, type)
);
CREATE TRIGGER leave_requests_no_delete BEFORE DELETE ON leave_requests BEGIN SELECT RAISE(ABORT, 'requests are never deleted'); END;
CREATE TRIGGER leave_requests_facts BEFORE UPDATE ON leave_requests WHEN NEW.person_id <> OLD.person_id OR NEW.work_date <> OLD.work_date OR NEW.type <> OLD.type OR NEW.reason <> OLD.reason BEGIN SELECT RAISE(ABORT, 'what was asked never changes'); END;
CREATE TRIGGER leave_requests_decided BEFORE UPDATE ON leave_requests WHEN OLD.status <> 'pending' BEGIN SELECT RAISE(ABORT, 'a decided request cannot change'); END;` },
  { id: 'ops_0005_alerts_ai', sql: `
CREATE TABLE alerts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('customer_requests','orders','attendance','tasks','system')), title TEXT NOT NULL CHECK (length(trim(title)) > 0), body TEXT, ref TEXT,
  dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX alerts_by_person ON alerts(person_id, read_at);
CREATE TRIGGER alerts_no_delete BEFORE DELETE ON alerts BEGIN SELECT RAISE(ABORT, 'alerts are never deleted: mark them read'); END;
CREATE TRIGGER alerts_facts BEFORE UPDATE ON alerts WHEN NEW.person_id <> OLD.person_id OR NEW.category <> OLD.category OR NEW.title <> OLD.title OR IFNULL(NEW.body,'') <> IFNULL(OLD.body,'') OR IFNULL(NEW.dedupe_key,'') <> IFNULL(OLD.dedupe_key,'') OR NEW.created_at <> OLD.created_at BEGIN SELECT RAISE(ABORT, 'an alert only changes by being read'); END;
CREATE TABLE ai_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('day_summary','shortage_insight')), input TEXT NOT NULL, output TEXT, status TEXT NOT NULL CHECK (status IN ('ok','failed')), model TEXT NOT NULL, error TEXT, at TEXT NOT NULL);
CREATE INDEX ai_runs_by_person ON ai_runs(person_id, at);
CREATE TRIGGER ai_runs_no_update BEFORE UPDATE ON ai_runs BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER ai_runs_no_delete BEFORE DELETE ON ai_runs BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
];
