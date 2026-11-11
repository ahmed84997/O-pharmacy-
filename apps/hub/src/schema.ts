import type { Migration } from '@o-pharmacy/hub';

/** Tables owned by the Hub application: settings, people (logins, roles), sessions and devices. Additive only; nothing is deleted (deactivate, end, revoke). */
export const APP_MIGRATIONS: Migration[] = [
  { id: 'app_0001_people_devices', sql: `
CREATE TABLE app_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL);
CREATE TRIGGER app_settings_no_delete BEFORE DELETE ON app_settings BEGIN SELECT RAISE(ABORT, 'settings are never deleted'); END;
CREATE TABLE people (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0), secret_hash TEXT NOT NULL,
  roles_json TEXT NOT NULL, grants_json TEXT NOT NULL DEFAULT '[]', denies_json TEXT NOT NULL DEFAULT '[]', all_branches INTEGER NOT NULL DEFAULT 0 CHECK (all_branches IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, must_change_secret INTEGER NOT NULL DEFAULT 0 CHECK (must_change_secret IN (0,1)),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER people_no_delete BEFORE DELETE ON people BEGIN SELECT RAISE(ABORT, 'people are never deleted: deactivate them'); END;
CREATE TRIGGER people_facts BEFORE UPDATE ON people WHEN NEW.username_key <> OLD.username_key OR NEW.created_at <> OLD.created_at BEGIN SELECT RAISE(ABORT, 'a username never changes'); END;
CREATE TABLE people_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL REFERENCES people(id), action TEXT NOT NULL, data TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER people_events_no_update BEFORE UPDATE ON people_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER people_events_no_delete BEFORE DELETE ON people_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE devices (
  id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL CHECK (length(trim(name)) > 0), kind TEXT NOT NULL CHECK (kind IN ('desktop','browser','pos','phone','tablet')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked')), user_agent TEXT, created_at TEXT NOT NULL, last_seen_at TEXT
);
CREATE TRIGGER devices_no_delete BEFORE DELETE ON devices BEGIN SELECT RAISE(ABORT, 'devices are never deleted: revoke them'); END;
CREATE TRIGGER devices_revoked BEFORE UPDATE ON devices WHEN OLD.status = 'revoked' AND NEW.status <> 'revoked' BEGIN SELECT RAISE(ABORT, 'a revoked device stays revoked: register again'); END;
CREATE TABLE device_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL REFERENCES devices(id), to_status TEXT NOT NULL, reason TEXT, by TEXT NOT NULL, at TEXT NOT NULL);
CREATE TRIGGER device_events_no_update BEFORE UPDATE ON device_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER device_events_no_delete BEFORE DELETE ON device_events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, person_id TEXT NOT NULL REFERENCES people(id), device_id TEXT NOT NULL REFERENCES devices(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT
);
CREATE INDEX sessions_by_person ON sessions(person_id);
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions are never deleted: end them'); END;` },
];
