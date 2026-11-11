import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@o-pharmacy/core';
import { describe, expect, it } from 'vitest';
import { DB, Hub, MIGRATIONS, migrate } from './index';

const mv = (key: string, qty: number, extra: Record<string, unknown> = {}) => ({ key, storeId: 'MAIN', itemId: 'i1', qty, kind: qty > 0 ? 'purchase' : 'sale', actor: 'u1', ...extra }) as never;

describe('ledger', () => {
  it('records movements and keeps balances per item, store and batch', () => {
    const h = Hub.open('b1');
    h.record(mv('k1', 100, { batchId: 'A' })); h.record(mv('k2', 50, { batchId: 'B' })); h.record(mv('k3', -30, { batchId: 'A' }));
    expect(h.balance('i1')).toBe(120); expect(h.balance('i1', { batchId: 'A' })).toBe(70); expect(h.balance('i1', { batchId: 'B' })).toBe(50);
    expect(h.balance('i1', { storeId: 'OTHER' })).toBe(0);
  });
  it('refuses to sell below zero (per batch) unless allowed', () => {
    const h = Hub.open('b1'); h.record(mv('k1', 5, { batchId: 'A' }));
    expect(h.record(mv('k2', -6, { batchId: 'A' }))).toEqual({ ok: false, reason: 'insufficient' });
    expect(h.balance('i1')).toBe(5);
    expect(h.record(mv('k3', -6, { batchId: 'A', allowNegative: true })).ok).toBe(true); expect(h.balance('i1')).toBe(-1);
  });
  it('is idempotent: a retry with the same key writes nothing more', () => {
    const h = Hub.open('b1'); const a = h.record(mv('same', 10)); const b = h.record(mv('same', 10));
    expect(a).toMatchObject({ ok: true, replay: false }); expect(b).toMatchObject({ ok: true, replay: true });
    expect(h.movementCount()).toBe(1); expect(h.outboxPending()).toHaveLength(1); expect(h.auditEntries()).toHaveLength(1);
  });
  it('reverse: compensating movement, original kept, only once, reason needed', () => {
    const h = Hub.open('b1'); const m = h.record(mv('k1', 10)) as { id: string };
    expect(h.reverse('r0', m.id, 'u2', ' ')).toEqual({ ok: false, reason: 'reason-required' });
    expect(h.reverse('r1', m.id, 'u2', 'wrong item').ok).toBe(true);
    expect(h.balance('i1')).toBe(0); expect(h.movementCount()).toBe(2);
    expect(h.reverse('r2', m.id, 'u2', 'again')).toEqual({ ok: false, reason: 'already-reversed' });
    expect(h.reverse('r3', 'nope', 'u2', 'x')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('No-Delete is enforced by the database itself', () => {
  it('rejects UPDATE and DELETE on ledger, audit and outbox', () => {
    const h = Hub.open('b1'); h.record(mv('k1', 10));
    for (const sql of ["UPDATE movements SET qty=999", 'DELETE FROM movements', "UPDATE audit SET actor='x'", 'DELETE FROM audit', 'DELETE FROM outbox', "UPDATE outbox SET payload='{}'"]) expect(() => h.db.exec(sql), sql).toThrow();
    expect(h.balance('i1')).toBe(10);
  });
});

describe('outbox', () => {
  it('event is written with the movement, in order, and acknowledged once', () => {
    const h = Hub.open('b1'); h.record(mv('k1', 10)); h.record(mv('k2', -3));
    const p = h.outboxPending(); expect(p.map(r => r.type)).toEqual(['stock.moved', 'stock.moved']); expect(p[0]!.seq).toBeLessThan(p[1]!.seq);
    expect(p[1]!.payload).toMatchObject({ qty: -3, itemId: 'i1' });
    h.outboxFailed([p[0]!.id]); expect(h.outboxPending()[0]!.attempts).toBe(1);
    h.outboxAck([p[0]!.id, p[0]!.id]); expect(h.outboxPending()).toHaveLength(1);
    h.outboxAck([p[1]!.id]); expect(h.outboxPending()).toHaveLength(0);
  });
});

describe('audit', () => {
  it('every write is chained and verifies; tampering below the triggers is detected', () => {
    const h = Hub.open('b1'); h.record(mv('k1', 10)); h.record(mv('k2', -3));
    expect(h.auditEntries().map(e => e.seq)).toEqual([1, 2]); expect(h.verifyAudit()).toBeNull();
    const tampered = h.auditEntries().map(e => ({ ...e })); tampered[0]!.actor = 'evil';
    expect(AuditLog.verify(tampered)).toBe(1); expect(AuditLog.verify(h.auditEntries())).toBeNull();
  });
});

describe('atomicity (one transaction: movement + outbox + audit)', () => {
  it('a failure after the ledger insert leaves no partial rows', () => {
    const h = Hub.open('b1'); h.record(mv('k1', 10));
    const orig = h.db.prepare.bind(h.db);
    (h.db as unknown as { prepare: unknown }).prepare = (sql: string) => { if (sql.startsWith('INSERT INTO audit')) throw new Error('simulated crash'); return orig(sql); };
    expect(() => h.record(mv('k2', -3))).toThrow('simulated crash');
    (h.db as unknown as { prepare: unknown }).prepare = orig;
    expect(h.balance('i1')).toBe(10); expect(h.movementCount()).toBe(1); expect(h.outboxPending()).toHaveLength(1); expect(h.auditEntries()).toHaveLength(1);
    expect(h.record(mv('k2', -3)).ok).toBe(true); expect(h.verifyAudit()).toBeNull();
  });
});

describe('durability on disk', () => {
  it('survives close and reopen with chain, outbox and idempotency intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ophub-')); const f = join(dir, 'hub.db');
    try {
      let h = Hub.open('b1', f); h.record(mv('k1', 10)); h.record(mv('k2', -4)); h.close();
      h = Hub.open('b1', f);
      expect(h.balance('i1')).toBe(6); expect(h.outboxPending()).toHaveLength(2); expect(h.verifyAudit()).toBeNull();
      expect(h.record(mv('k1', 10))).toMatchObject({ ok: true, replay: true }); expect(h.balance('i1')).toBe(6);
      h.record(mv('k3', 1)); expect(h.verifyAudit()).toBeNull(); expect(h.auditEntries()).toHaveLength(3);
      h.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('migrations are additive and checksum-guarded', () => {
  it('apply once, in order; changing an applied one is refused; destructive ones are refused', () => {
    const db = new DB(':memory:');
    expect(migrate(db)).toEqual(MIGRATIONS.map(m => m.id)); expect(migrate(db)).toEqual([]);
    expect(() => migrate(db, [{ ...MIGRATIONS[0]!, sql: MIGRATIONS[0]!.sql + ' ' }])).toThrow(/changed/);
    expect(() => migrate(db, [{ id: '9999_bad', sql: 'DROP TABLE movements' }])).toThrow(/additive/);
    expect(() => migrate(db, [{ id: '9998_bad', sql: 'DELETE FROM movements' }])).toThrow(/additive/);
    expect(migrate(db, [...MIGRATIONS, { id: '0004_new_col', sql: 'ALTER TABLE outbox ADD COLUMN note TEXT' }])).toEqual(['0004_new_col']);
  });
  it('no shipped migration drops or deletes', () => { for (const m of MIGRATIONS) expect(m.sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bDELETE\s+FROM\b/i); });
});
