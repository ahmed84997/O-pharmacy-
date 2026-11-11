import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { AccError, AccountService, NO_OVERDRAFT, isDate, type AccountKind, type EntryKind } from './accounts';

export interface EntryInput { key: string; date: string; accountId: string; kind: EntryKind; toAccountId?: string; categoryId: string; amountMinor: number; party?: string; description?: string; refNo?: string; sourceRef?: string }
export interface Entry { id: string; entryNo: string; date: string; accountId: string; kind: EntryKind; toAccountId: string | null; categoryId: string; categoryName: string; amountMinor: number; party: string | null; description: string | null; refNo: string | null; sourceRef: string | null; status: 'posted' | 'void'; createdBy: string; voidReason: string | null }
export interface StatementLine { date: string; entryNo: string; description: string; inMinor: number; outMinor: number; balanceMinor: number }

/** The money ledger: money in, money out, and transfers between accounts. Amounts are whole piasters. An entry never changes and is never deleted: a mistake is voided with a reason and posted again. A cash box, wallet or custody cannot go below zero. Needs `ledger.post` to post or void, `ledger.view` to read. */
export class LedgerService {
  constructor(private hub: Hub, private accounts: AccountService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new AccError('forbidden', `missing permission ${perm}`); }
  private next(k: string, prefix: string): string { const n = Number(this.db.prepare('SELECT v FROM acc_counters WHERE k=?').get(k)?.v ?? 0) + 1; this.db.prepare('INSERT INTO acc_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`; }
  private view(r: Record<string, unknown>): Entry { return { id: String(r.id), entryNo: String(r.entry_no), date: String(r.entry_date), accountId: String(r.account_id), kind: r.kind as EntryKind, toAccountId: (r.to_account_id as string) ?? null, categoryId: String(r.category_id), categoryName: String(r.category_name ?? ''), amountMinor: Number(r.amount_minor), party: (r.party as string) ?? null, description: (r.description as string) ?? null, refNo: (r.ref_no as string) ?? null, sourceRef: (r.source_ref as string) ?? null, status: r.status as Entry['status'], createdBy: String(r.created_by), voidReason: (r.void_reason as string) ?? null }; }
  private byId(id: string): Entry { const r = this.db.prepare('SELECT e.*, c.name category_name FROM ledger_entries e JOIN ledger_categories c ON c.id=e.category_id WHERE e.id=?').get(id); if (!r) throw new AccError('not-found', `entry ${id}`); return this.view(r); }
  /** The one place an entry is written (also used by cheques and the inbox, which check their own permission). Must run inside a transaction. @internal */
  insert(actor: Person, i: EntryInput): { entry: Entry; replay: boolean } {
    const old = this.db.prepare('SELECT id FROM ledger_entries WHERE req_key=?').get(i.key); if (old) return { entry: this.byId(String(old.id)), replay: true };
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) throw new AccError('invalid', 'amount must be whole piasters above zero'); if (!isDate(i.date)) throw new AccError('invalid', 'bad date');
    const tomorrow = new Date(Date.parse(this.hub.now()) + 86400000).toISOString().slice(0, 10); if (i.date > tomorrow) throw new AccError('invalid', 'the date is in the future');
    const acc = this.db.prepare('SELECT * FROM money_accounts WHERE id=?').get(i.accountId); if (!acc) throw new AccError('not-found', 'account'); if (acc.active !== 1) throw new AccError('state', 'the account is switched off'); if (i.date < String(acc.opening_date)) throw new AccError('invalid', 'the date is before the account opened');
    const cat = this.db.prepare('SELECT * FROM ledger_categories WHERE id=?').get(i.categoryId); if (!cat) throw new AccError('not-found', 'category'); if (cat.active !== 1) throw new AccError('state', 'the category is switched off'); if (cat.kind !== i.kind) throw new AccError('invalid', `this category is for ${String(cat.kind)} entries`);
    if (i.kind === 'transfer') { if (!i.toAccountId || i.toAccountId === i.accountId) throw new AccError('invalid', 'a transfer needs a different destination account'); const to = this.db.prepare('SELECT * FROM money_accounts WHERE id=?').get(i.toAccountId); if (!to) throw new AccError('not-found', 'destination account'); if (to.active !== 1) throw new AccError('state', 'the destination account is switched off'); if (i.date < String(to.opening_date)) throw new AccError('invalid', 'the date is before the destination account opened'); }
    else if (i.toAccountId) throw new AccError('invalid', 'only a transfer has a destination');
    if (i.kind !== 'in' && NO_OVERDRAFT.includes(acc.kind as AccountKind) && this.accounts.balanceOf(i.accountId) - i.amountMinor < 0) throw new AccError('insufficient', `not enough money in ${String(acc.name)}`);
    const id = uuidv7(); const no = this.next('entry', 'L');
    this.db.prepare('INSERT INTO ledger_entries(id,entry_no,req_key,entry_date,account_id,kind,to_account_id,category_id,amount_minor,party,description,ref_no,source_ref,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, no, i.key, i.date, i.accountId, i.kind, i.toAccountId ?? null, i.categoryId, i.amountMinor, i.party?.trim() || null, i.description?.trim() || null, i.refNo?.trim() || null, i.sourceRef ?? null, actor.id, this.hub.now());
    this.hub.audit(actor.id, `ledger.${i.kind}`, 'ledger_entry', no, { amountMinor: i.amountMinor, accountId: i.accountId }); this.hub.emit('ledger.posted', { entryNo: no, kind: i.kind, amountMinor: i.amountMinor }); return { entry: this.byId(id), replay: false };
  }
  post(actor: Person, i: EntryInput): { entry: Entry; replay: boolean } { this.need(actor, 'ledger.post'); return this.db.tx(() => this.insert(actor, i)); }
  /** Cancel an entry with a reason. Money that was moved by it goes back; an entry made by a cheque is cancelled through the cheque. */
  void(actor: Person, id: string, reason: string): Entry {
    this.need(actor, 'ledger.post'); if (!reason?.trim()) throw new AccError('invalid', 'a reason is required');
    return this.db.tx(() => {
      const e = this.byId(id); if (e.status === 'void') throw new AccError('state', 'already void'); if (e.sourceRef?.startsWith('cheque:')) throw new AccError('state', 'this entry came from a cheque: cancel it there');
      // voiding must not leave a cash-type account below zero (money in that was already spent)
      this.db.prepare("UPDATE ledger_entries SET status='void', void_by=?, void_at=?, void_reason=? WHERE id=?").run(actor.id, this.hub.now(), reason.trim(), id);
      for (const a of [e.accountId, e.toAccountId]) { if (!a) continue; const r = this.db.prepare('SELECT kind FROM money_accounts WHERE id=?').get(a); if (NO_OVERDRAFT.includes(r?.kind as AccountKind) && this.accounts.balanceOf(a) < 0) throw new AccError('insufficient', 'voiding this would leave an account below zero'); }
      this.hub.audit(actor.id, 'ledger.void', 'ledger_entry', e.entryNo, { reason: reason.trim() }); this.hub.emit('ledger.voided', { entryNo: e.entryNo }); return this.byId(id);
    });
  }
  /** Same as `void` but for the cheque flow (which holds `bank_cheque.manage`). @internal */
  voidInternal(actor: Person, id: string, reason: string): void { this.db.prepare("UPDATE ledger_entries SET status='void', void_by=?, void_at=?, void_reason=? WHERE id=? AND status='posted'").run(actor.id, this.hub.now(), reason, id); }
  get(actor: Person, id: string): Entry { this.need(actor, 'ledger.view'); return this.byId(id); }
  list(actor: Person, f: { accountId?: string; from?: string; to?: string; kind?: EntryKind; includeVoid?: boolean; limit?: number } = {}): Entry[] {
    this.need(actor, 'ledger.view');
    return this.db.prepare("SELECT e.*, c.name category_name FROM ledger_entries e JOIN ledger_categories c ON c.id=e.category_id WHERE (? IS NULL OR e.account_id=? OR e.to_account_id=?) AND (? IS NULL OR e.entry_date>=?) AND (? IS NULL OR e.entry_date<=?) AND (? IS NULL OR e.kind=?) AND (? = 1 OR e.status='posted') ORDER BY e.entry_date DESC, e.rowid DESC LIMIT ?")
      .all(f.accountId ?? null, f.accountId ?? null, f.accountId ?? null, f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, f.kind ?? null, f.kind ?? null, f.includeVoid ? 1 : 0, Math.min(f.limit ?? 100, 500)).map(r => this.view(r));
  }
  /** One account over a period: opening, each posted line with a running balance, closing. */
  statement(actor: Person, accountId: string, from: string, to: string) {
    this.need(actor, 'ledger.view'); if (!isDate(from) || !isDate(to) || from > to) throw new AccError('invalid', 'bad period'); const acc = this.accounts.get(actor, accountId); const opening = this.accounts.balanceOf(accountId, from); let bal = opening;
    const rows = this.db.prepare("SELECT e.*, c.name category_name FROM ledger_entries e JOIN ledger_categories c ON c.id=e.category_id WHERE e.status='posted' AND (e.account_id=? OR e.to_account_id=?) AND e.entry_date>=? AND e.entry_date<=? ORDER BY e.entry_date, e.rowid").all(accountId, accountId, from, to);
    const lines: StatementLine[] = rows.map(r => { const e = this.view(r); const credit = e.kind === 'in' || e.toAccountId === accountId; const amt = e.amountMinor; bal += credit ? amt : -amt; return { date: e.date, entryNo: e.entryNo, description: [e.categoryName, e.party, e.description].filter(Boolean).join(' - '), inMinor: credit ? amt : 0, outMinor: credit ? 0 : amt, balanceMinor: bal }; });
    return { account: acc.name, from, to, openingMinor: opening, lines, closingMinor: bal, totalInMinor: lines.reduce((s, l) => s + l.inMinor, 0), totalOutMinor: lines.reduce((s, l) => s + l.outMinor, 0) };
  }
}
