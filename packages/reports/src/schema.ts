import type { Migration } from '@o-pharmacy/hub';
export const REPORT_MIGRATIONS: Migration[] = [
  { id: 'rep_0001_views_runs', sql: `
CREATE TABLE saved_views (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, report_key TEXT NOT NULL, name TEXT NOT NULL CHECK (length(trim(name)) > 0), params_json TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0,1)), archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)), created_at TEXT NOT NULL);
CREATE INDEX saved_views_by_person ON saved_views(person_id, report_key);
CREATE TRIGGER saved_views_no_delete BEFORE DELETE ON saved_views BEGIN SELECT RAISE(ABORT, 'views are never deleted: archive them'); END;
CREATE TRIGGER saved_views_facts BEFORE UPDATE ON saved_views WHEN NEW.person_id <> OLD.person_id OR NEW.report_key <> OLD.report_key OR NEW.name <> OLD.name OR NEW.params_json <> OLD.params_json BEGIN SELECT RAISE(ABORT, 'a view never changes: archive it and save another'); END;
CREATE TABLE report_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL, report_key TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('run','export')), params_json TEXT NOT NULL, rows_count INTEGER NOT NULL, at TEXT NOT NULL);
CREATE INDEX report_runs_by_person ON report_runs(person_id, seq);
CREATE TRIGGER report_runs_no_update BEFORE UPDATE ON report_runs BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER report_runs_no_delete BEFORE DELETE ON report_runs BEGIN SELECT RAISE(ABORT, 'append-only'); END;` },
];
