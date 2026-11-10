// Thin database wrapper over node:sqlite (built into Node, no native addon: avoids the node-gyp failure seen on Windows CI).
import { DatabaseSync } from 'node:sqlite';

export interface Stmt { run(...a: any[]): unknown; get(...a: any[]): any; all(...a: any[]): any[] }
export class DB {
  private d: DatabaseSync;
  private depth = 0;
  constructor(path: string) { this.d = new DatabaseSync(path); }
  exec(sql: string) { this.d.exec(sql); }
  prepare(sql: string): Stmt { return this.d.prepare(sql) as unknown as Stmt; }
  // All-or-nothing block; throwing rolls back (used to simulate a crash mid-write).
  transaction<T>(fn: () => T): () => T {
    return () => {
      if (this.depth++ > 0) { try { return fn(); } finally { this.depth--; } }
      this.d.exec('BEGIN IMMEDIATE');
      try { const r = fn(); this.d.exec('COMMIT'); return r; }
      catch (e) { this.d.exec('ROLLBACK'); throw e; }
      finally { this.depth--; }
    };
  }
}

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
  const d = new DB(path);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  d.exec(SCHEMA);
  return d;
}

export const RANK: Record<string, number> = { requested: 1, accepted: 2, dispatched: 3, received: 4 };
