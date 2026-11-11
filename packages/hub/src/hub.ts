import { AuditLog, GENESIS, uuidv7, type AuditEntry } from '@o-pharmacy/core';
import { DB } from './db';
import { migrate } from './migrations';

export interface MovementCmd {
  /** Idempotency key: a device retry or duplicate delivery returns the stored result and writes nothing. */
  key: string;
  storeId: string; itemId: string; batchId?: string | null; qty: number;
  kind: 'purchase' | 'sale' | 'return' | 'adjust' | 'transfer_out' | 'transfer_in' | 'opening' | 'reversal';
  ref?: string; reason?: string; actor: string; deviceId?: string;
  /** Mirrors config sale.allowNegativeStock; default false. */
  allowNegative?: boolean;
}
export type MovementResult = { ok: true; id: string; replay: boolean } | { ok: false; reason: 'insufficient' | 'already-reversed' | 'not-found' | 'reason-required' };

export interface OutboxRow { seq: number; id: string; type: string; branchId: string; payload: unknown; createdAt: string; attempts: number }

/** One Hub per branch: the single writer. Every business write = ledger row + outbox event + audit entry in ONE transaction. */
export class Hub {
  readonly db: DB;
  private constructor(readonly branchId: string, db: DB, private clock: () => Date) { this.db = db; }
  static open(branchId: string, path = ':memory:', clock: () => Date = () => new Date()): Hub { const db = new DB(path); migrate(db); return new Hub(branchId, db, clock); }
  close(): void { this.db.close(); }
  private now() { return this.clock().toISOString(); }

  // ---- audit (persisted hash chain) ----
  private audit(actor: string, action: string, entity: string, entityId: string, data: unknown): AuditEntry {
    const last = this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 1').get();
    const log = AuditLog.from(last ? [rowToAudit(last)] : []);
    // AuditLog.from with one entry continues numbering and chain from it
    const e = log.append({ actor, action, entity, entityId, branchId: this.branchId, data, at: this.clock() });
    this.db.prepare('INSERT INTO audit(seq,id,at,actor,action,entity,entity_id,branch_id,data,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(e.seq, e.id, e.at, e.actor, e.action, e.entity, e.entityId, e.branchId, JSON.stringify(e.data), e.prevHash, e.hash);
    return e;
  }
  auditEntries(): AuditEntry[] { return this.db.prepare('SELECT * FROM audit ORDER BY seq').all().map(rowToAudit); }
  /** null when intact, else the seq of the first broken entry. */
  verifyAudit(): number | null {
    const all = this.auditEntries();
    // the chain starts at genesis for seq 1
    if (all[0] && all[0].prevHash !== GENESIS) return 1;
    return AuditLog.verify(all);
  }

  // ---- outbox ----
  private emit(type: string, payload: unknown): void {
    this.db.prepare('INSERT INTO outbox(id,type,branch_id,payload,created_at) VALUES(?,?,?,?,?)').run(uuidv7(), type, this.branchId, JSON.stringify(payload), this.now());
  }
  outboxPending(limit = 50): OutboxRow[] {
    return this.db.prepare('SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY seq LIMIT ?').all(limit).map(r => ({ seq: Number(r.seq), id: String(r.id), type: String(r.type), branchId: String(r.branch_id), payload: JSON.parse(String(r.payload)), createdAt: String(r.created_at), attempts: Number(r.attempts) }));
  }
  /** Called after the Cloud acknowledged; safe to repeat. */
  outboxAck(ids: string[]): void {
    this.db.tx(() => { for (const id of ids) this.db.prepare('UPDATE outbox SET sent_at=? WHERE id=? AND sent_at IS NULL').run(this.now(), id); });
  }
  outboxFailed(ids: string[]): void {
    this.db.tx(() => { for (const id of ids) this.db.prepare('UPDATE outbox SET attempts=attempts+1 WHERE id=? AND sent_at IS NULL').run(id); });
  }

  // ---- ledger ----
  balance(itemId: string, o: { storeId?: string; batchId?: string | null } = {}): number {
    let sql = 'SELECT COALESCE(SUM(qty),0) q FROM movements WHERE branch_id=? AND item_id=?'; const a: unknown[] = [this.branchId, itemId];
    if (o.storeId) { sql += ' AND store_id=?'; a.push(o.storeId); }
    if (o.batchId) { sql += ' AND batch_id=?'; a.push(o.batchId); }
    return Number(this.db.prepare(sql).get(...a)!.q);
  }
  movementCount(): number { return Number(this.db.prepare('SELECT COUNT(*) c FROM movements').get()!.c); }

  private once(key: string, fn: () => MovementResult): MovementResult {
    return this.db.tx(() => {
      const r = this.db.prepare('SELECT result FROM idempotency WHERE key=?').get(key);
      if (r) { const prev = JSON.parse(String(r.result)) as MovementResult; return prev.ok ? { ...prev, replay: true } : prev; }
      const res = fn();
      this.db.prepare('INSERT INTO idempotency(key,result,created_at) VALUES(?,?,?)').run(key, JSON.stringify(res), this.now());
      return res;
    });
  }

  record(c: MovementCmd): MovementResult {
    return this.once(c.key, () => {
      if (!Number.isInteger(c.qty) || c.qty === 0) throw new Error('qty must be a non-zero integer (base units)');
      if (c.qty < 0 && !c.allowNegative && this.balance(c.itemId, { storeId: c.storeId, batchId: c.batchId ?? null }) + c.qty < 0) return { ok: false, reason: 'insufficient' };
      return this.insert(c, null);
    });
  }
  private insert(c: Omit<MovementCmd, 'key' | 'allowNegative'>, reverses: string | null): MovementResult {
    const id = uuidv7();
    this.db.prepare('INSERT INTO movements(id,branch_id,store_id,item_id,batch_id,qty,kind,ref,reason,actor,device_id,reverses,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, this.branchId, c.storeId, c.itemId, c.batchId ?? null, c.qty, c.kind, c.ref ?? null, c.reason ?? null, c.actor, c.deviceId ?? null, reverses, this.now());
    this.emit('stock.moved', { movementId: id, storeId: c.storeId, itemId: c.itemId, batchId: c.batchId ?? null, qty: c.qty, kind: c.kind, ref: c.ref ?? null, reverses });
    this.audit(c.actor, reverses ? 'stock.reversed' : `stock.${c.kind}`, 'movement', id, { qty: c.qty, itemId: c.itemId, reason: c.reason ?? null });
    return { ok: true, id, replay: false };
  }
  /** No-Delete: a mistake is cancelled by a compensating movement that points at the original; the original stays. Once only. */
  reverse(key: string, movementId: string, actor: string, reason: string): MovementResult {
    return this.once(key, () => {
      if (!reason.trim()) return { ok: false, reason: 'reason-required' };
      const m = this.db.prepare('SELECT * FROM movements WHERE id=?').get(movementId);
      if (!m) return { ok: false, reason: 'not-found' };
      if (this.db.prepare('SELECT 1 FROM movements WHERE reverses=?').get(movementId)) return { ok: false, reason: 'already-reversed' };
      return this.insert({ storeId: String(m.store_id), itemId: String(m.item_id), batchId: (m.batch_id as string | null) ?? null, qty: -Number(m.qty), kind: 'reversal', ref: movementId, reason: reason.trim(), actor }, movementId);
    });
  }
}

function rowToAudit(r: Record<string, unknown>): AuditEntry {
  return { id: String(r.id), seq: Number(r.seq), at: String(r.at), actor: String(r.actor), action: String(r.action), entity: String(r.entity), entityId: String(r.entity_id), branchId: (r.branch_id as string | null) ?? null, data: JSON.parse(String(r.data)), prevHash: String(r.prev_hash), hash: String(r.hash) };
}
