import { createHash } from 'node:crypto';
import { uuidv7 } from './ids';

/** Append-only audit trail with a hash chain: editing or removing any past entry breaks verification. */
export interface AuditEntry {
  id: string; seq: number; at: string; actor: string; action: string; entity: string; entityId: string;
  branchId: string | null; data: unknown; prevHash: string; hash: string;
}
export const GENESIS = '0'.repeat(64);

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const hashOf = (e: Omit<AuditEntry, 'hash'>): string => createHash('sha256').update(canon(e)).digest('hex');

export class AuditLog {
  private list: AuditEntry[] = [];
  /** Read-only view; there is intentionally no update or delete method (No-Delete). */
  get entries(): readonly AuditEntry[] { return this.list; }

  append(a: { actor: string; action: string; entity: string; entityId: string; branchId?: string | null; data?: unknown; at?: Date }): AuditEntry {
    const prev = this.list[this.list.length - 1];
    const base = { id: uuidv7(), seq: (prev?.seq ?? 0) + 1, at: (a.at ?? new Date()).toISOString(), actor: a.actor, action: a.action, entity: a.entity, entityId: a.entityId, branchId: a.branchId ?? null, data: a.data ?? null, prevHash: prev?.hash ?? GENESIS };
    const e: AuditEntry = { ...base, hash: hashOf(base) };
    this.list.push(e);
    return e;
  }
  /** Returns the seq of the first broken entry, or null when intact. */
  static verify(entries: readonly AuditEntry[]): number | null {
    let prev = GENESIS;
    for (const [i, e] of entries.entries()) {
      const { hash, ...rest } = e;
      if (e.seq !== i + 1 || e.prevHash !== prev || hashOf(rest) !== hash) return e.seq;
      prev = hash;
    }
    return null;
  }
  static from(entries: AuditEntry[]): AuditLog { const l = new AuditLog(); l.list = [...entries]; return l; }
}
