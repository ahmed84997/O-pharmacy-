// Thin wrapper over node:sqlite (built into Node: no native addon, proven on Windows/macOS/Linux in spike S1).
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
// loaded at runtime so bundlers/test runners that do not know the experimental built-in leave it alone
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSyncT };

export interface Stmt { run(...a: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }; get(...a: unknown[]): Record<string, unknown> | undefined; all(...a: unknown[]): Record<string, unknown>[] }

export class DB {
  private d: DatabaseSyncT; private depth = 0;
  constructor(path: string) { this.d = new DatabaseSync(path); this.d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;'); }
  exec(sql: string): void { this.d.exec(sql); }
  prepare(sql: string): Stmt { return this.d.prepare(sql) as unknown as Stmt; }
  /** All-or-nothing; nested calls join the outer transaction. A throw rolls everything back (movement, outbox and audit together). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.d.exec('BEGIN IMMEDIATE'); this.depth++;
    try { const r = fn(); this.d.exec('COMMIT'); return r; }
    catch (e) { this.d.exec('ROLLBACK'); throw e; }
    finally { this.depth--; }
  }
  close(): void { this.d.close(); }
}
