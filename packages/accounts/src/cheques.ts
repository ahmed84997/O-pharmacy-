import { StateMachine, StateMachineError, can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { AccError, isDate } from './accounts';
import type { LedgerService } from './ledger';

export type ChequeStatus = 'pending' | 'cleared' | 'bounced' | 'cancelled';
export type ChequeDirection = 'received' | 'issued';
export const CHEQUE_MACHINE = new StateMachine<ChequeStatus>({ pending: ['cleared', 'bounced', 'cancelled'], bounced: ['cancelled'], cleared: [], cancelled: [] });
export interface Cheque { id: string; ref: string; direction: ChequeDirection; chequeNo: string; bankName: string | null; party: string; amountMinor: number; dueDate: string; accountId: string; status: ChequeStatus; entryId: string | null; note: string | null }

/** Cheques the pharmacy received (from customers, insurers) or issued (to suppliers). A cheque waits as pending; when it clears, the money moves in the ledger in the same transaction (received: money in, issued: money out); a bounced or cancelled cheque moves nothing, and a reason is always kept. What is written on a cheque never changes. Needs `bank_cheque.manage`. */
export class ChequeService {
  constructor(private hub: Hub, private ledger: LedgerService, private categoryFor: (direction: ChequeDirection) => string) {}
  private get db() { return this.hub.db; }
  private need(a: Person): void { if (!can(a, 'bank_cheque.manage', this.hub.branchId)) throw new AccError('forbidden', 'missing permission bank_cheque.manage'); }
  private view(r: Record<string, unknown>): Cheque { return { id: String(r.id), ref: String(r.cheque_ref), direction: r.direction as ChequeDirection, chequeNo: String(r.cheque_no), bankName: (r.bank_name as string) ?? null, party: String(r.party), amountMinor: Number(r.amount_minor), dueDate: String(r.due_date), accountId: String(r.account_id), status: r.status as ChequeStatus, entryId: (r.entry_id as string) ?? null, note: (r.note as string) ?? null }; }
  private row(id: string) { const r = this.db.prepare('SELECT * FROM cheques WHERE id=? OR cheque_ref=?').get(id, id); if (!r) throw new AccError('not-found', `cheque ${id}`); return r; }
  private step(actor: Person, c: Record<string, unknown>, to: ChequeStatus, reason?: string): void {
    try { CHEQUE_MACHINE.assert(c.status as ChequeStatus, to); } catch (e) { if (e instanceof StateMachineError) throw new AccError('state', e.message); throw e; }
    this.db.prepare('UPDATE cheques SET status=? WHERE id=?').run(to, String(c.id)); this.db.prepare('INSERT INTO cheque_events(id,cheque_id,from_status,to_status,reason,by,at) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), String(c.id), String(c.status), to, reason ?? null, actor.id, this.hub.now());
    this.hub.audit(actor.id, `cheque.${to}`, 'cheque', String(c.cheque_ref), { reason: reason ?? null }); this.hub.emit('cheque.moved', { ref: String(c.cheque_ref), to });
  }
  register(actor: Person, i: { key: string; direction: ChequeDirection; chequeNo: string; bankName?: string; party: string; amountMinor: number; dueDate: string; accountId: string; note?: string }): Cheque {
    this.need(actor); if (!i.chequeNo?.trim() || !i.party?.trim()) throw new AccError('invalid', 'cheque number and party are required'); if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) throw new AccError('invalid', 'amount must be whole piasters above zero'); if (!isDate(i.dueDate)) throw new AccError('invalid', 'bad due date'); if (!['received', 'issued'].includes(i.direction)) throw new AccError('invalid', 'bad direction');
    return this.db.tx(() => {
      const old = this.db.prepare('SELECT * FROM cheques WHERE req_key=?').get(i.key); if (old) return this.view(old);
      const a = this.db.prepare('SELECT active FROM money_accounts WHERE id=?').get(i.accountId); if (!a) throw new AccError('not-found', 'account'); if (a.active !== 1) throw new AccError('state', 'the account is switched off');
      if (this.db.prepare("SELECT 1 FROM cheques WHERE direction=? AND cheque_no=? AND IFNULL(bank_name,'')=? AND status<>'cancelled'").get(i.direction, i.chequeNo.trim(), i.bankName?.trim() ?? '')) throw new AccError('duplicate', 'this cheque is already registered');
      const n = Number(this.db.prepare("SELECT v FROM acc_counters WHERE k='cheque'").get()?.v ?? 0) + 1; this.db.prepare("INSERT INTO acc_counters(k,v) VALUES('cheque',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(n); const id = uuidv7(); const ref = `CHQ-${String(n).padStart(6, '0')}`;
      this.db.prepare('INSERT INTO cheques(id,cheque_ref,req_key,direction,cheque_no,bank_name,party,amount_minor,due_date,account_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, ref, i.key, i.direction, i.chequeNo.trim(), i.bankName?.trim() || null, i.party.trim(), i.amountMinor, i.dueDate, i.accountId, i.note?.trim() || null, actor.id, this.hub.now());
      this.db.prepare('INSERT INTO cheque_events(id,cheque_id,from_status,to_status,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), id, null, 'pending', actor.id, this.hub.now()); this.hub.audit(actor.id, 'cheque.registered', 'cheque', ref, { direction: i.direction, amountMinor: i.amountMinor }); return this.view(this.row(id));
    });
  }
  /** The bank paid it (or it paid): the money moves in the ledger on `date` (default today). */
  clear(actor: Person, id: string, date?: string): Cheque {
    this.need(actor);
    return this.db.tx(() => {
      const c = this.row(id); const d = date ?? this.hub.now().slice(0, 10); this.step(actor, c, 'cleared');
      const { entry } = this.ledger.insert(actor, { key: `cheque:${String(c.id)}`, date: d, accountId: String(c.account_id), kind: c.direction === 'received' ? 'in' : 'out', categoryId: this.categoryFor(c.direction as ChequeDirection), amountMinor: Number(c.amount_minor), party: String(c.party), description: `شيك ${String(c.cheque_no)}`, refNo: String(c.cheque_no), sourceRef: `cheque:${String(c.id)}` });
      this.db.prepare('UPDATE cheques SET entry_id=? WHERE id=?').run(entry.id, String(c.id)); return this.view(this.row(String(c.id)));
    });
  }
  bounce(actor: Person, id: string, reason: string): Cheque { this.need(actor); if (!reason?.trim()) throw new AccError('invalid', 'a reason is required'); return this.db.tx(() => { const c = this.row(id); this.step(actor, c, 'bounced', reason.trim()); return this.view(this.row(String(c.id))); }); }
  cancel(actor: Person, id: string, reason: string): Cheque { this.need(actor); if (!reason?.trim()) throw new AccError('invalid', 'a reason is required'); return this.db.tx(() => { const c = this.row(id); this.step(actor, c, 'cancelled', reason.trim()); return this.view(this.row(String(c.id))); }); }
  list(actor: Person, f: { status?: ChequeStatus; direction?: ChequeDirection } = {}): Cheque[] { this.need(actor); return this.db.prepare('SELECT * FROM cheques WHERE (? IS NULL OR status=?) AND (? IS NULL OR direction=?) ORDER BY due_date, cheque_ref').all(f.status ?? null, f.status ?? null, f.direction ?? null, f.direction ?? null).map(r => this.view(r)); }
  /** Pending cheques due within `days` (default 7) or already late, with what is coming in and going out. */
  due(actor: Person, days = 7) {
    this.need(actor); const limit = new Date(Date.parse(this.hub.now()) + days * 86400000).toISOString().slice(0, 10); const today = this.hub.now().slice(0, 10);
    const rows = this.db.prepare("SELECT * FROM cheques WHERE status='pending' AND due_date<=? ORDER BY due_date, cheque_ref").all(limit).map(r => ({ ...this.view(r), late: String(r.due_date) < today }));
    return { cheques: rows, comingInMinor: rows.filter(r => r.direction === 'received').reduce((s, r) => s + r.amountMinor, 0), goingOutMinor: rows.filter(r => r.direction === 'issued').reduce((s, r) => s + r.amountMinor, 0) };
  }
  history(actor: Person, id: string) { this.need(actor); return this.db.prepare('SELECT from_status, to_status, reason, by, at FROM cheque_events WHERE cheque_id=? ORDER BY seq').all(String(this.row(id).id)).map(e => ({ from: (e.from_status as string) ?? null, to: String(e.to_status), reason: (e.reason as string) ?? null, by: String(e.by), at: String(e.at) })); }
}
