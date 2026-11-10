// Tiny adapter so the same tests run on better-sqlite3 (native addon) and node:sqlite (built in, no addon).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function openDb(path, driver = 'better', sync = 'FULL') {
  let db, kind = driver;
  if (driver === 'node') {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(path);
    d.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=${sync}; PRAGMA busy_timeout=5000;`);
    db = {
      exec: s => d.exec(s),
      run: (s, ...a) => d.prepare(s).run(...a),
      get: (s, ...a) => d.prepare(s).get(...a),
      all: (s, ...a) => d.prepare(s).all(...a),
      close: () => d.close(),
      version: () => d.prepare('select sqlite_version() v').get().v,
    };
  } else {
    const Better = require('better-sqlite3');
    const d = new Better(path);
    d.pragma('journal_mode = WAL'); d.pragma(`synchronous = ${sync}`); d.pragma('busy_timeout = 5000');
    db = {
      exec: s => d.exec(s),
      run: (s, ...a) => d.prepare(s).run(...a),
      get: (s, ...a) => d.prepare(s).get(...a),
      all: (s, ...a) => d.prepare(s).all(...a),
      close: () => d.close(),
      version: () => d.prepare('select sqlite_version() v').get().v,
    };
  }
  db.exec('CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY, item TEXT NOT NULL, qty INTEGER NOT NULL, at INTEGER NOT NULL)');
  db.kind = kind;
  return db;
}
