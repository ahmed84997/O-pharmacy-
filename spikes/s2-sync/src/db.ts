import Database from 'better-sqlite3';
export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY, branch TEXT NOT NULL, store TEXT NOT NULL, item TEXT NOT NULL,
  qty INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT, origin TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, transfer TEXT NOT NULL,
  from_branch TEXT NOT NULL, to_branch TEXT NOT NULL, item TEXT NOT NULL, qty INTEGER NOT NULL,
  origin TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0, cseq INTEGER);
CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export function open(path = ':memory:'): DB {
  const d = new Database(path);
  d.pragma('journal_mode = WAL');
  d.pragma('synchronous = FULL');
  d.exec(SCHEMA);
  return d;
}

export const RANK: Record<string, number> = { requested: 1, accepted: 2, dispatched: 3, received: 4 };
