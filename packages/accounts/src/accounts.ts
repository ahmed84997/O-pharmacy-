import { can, normalizeSearch, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';

export type AccErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'duplicate' | 'insufficient';
export class AccError extends Error { constructor(public code: AccErrorCode, m: string, public detail?: unknown) { super(m); } }
export type AccountKind = 'cash' | 'wallet' | 'bank' | 'custody' | 'other';
export type EntryKind = 'in' | 'out' | 'transfer';
export interface MoneyAccount { id: string; name: string; kind: AccountKind; openingMinor: number; openingDate: string; active: boolean; balanceMinor: number }
export interface Category { id: string; name: string; kind: EntryKind; active: boolean }
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (d: string): boolean => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
/** Kinds that cannot be spent below zero (a drawer, a wallet or the custody cannot hold less than nothing; a bank may overdraw). */
export const NO_OVERDRAFT: AccountKind[] = ['cash', 'wallet', 'custody'];
/** Starting categories, added on request (`seedDefaults`); every pharmacy renames, adds and switches off as it likes. */
export const DEFAULT_CATEGORIES: { name: string; kind: EntryKind }[] = [
  { name: 'تقفيلة نقدية', kind: 'in' }, { name: 'مبيعات فيزا', kind: 'in' }, { name: 'وارد آخر', kind: 'in' },
  { name: 'طلبية مورد', kind: 'out' }, { name: 'مصروفات أخرى', kind: 'out' }, { name: 'تحويل بين الحسابات', kind: 'transfer' },
];

/** The pharmacy's money accounts (cash box, wallets, banks, custody...) and the ledger categories. Nothing is hardcoded: the Admin adds, renames and switches accounts off. An account that holds money cannot be switched off; one with entries is never deleted. Needs `ledger.post` to change, `ledger.view` to read. */
export class AccountService {
  constructor(private hub: Hub) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new AccError('forbidden', `missing permission ${perm}`); }
  private row(id: string) { const r = this.db.prepare('SELECT * FROM money_accounts WHERE id=?').get(id); if (!r) throw new AccError('not-found', `account ${id}`); return r; }
  /** Posted balance of an account: opening, plus money in, minus money out, with transfers counted on both sides. `before` leaves out that date and later (for statements). */
  balanceOf(id: string, before?: string): number {
    const a = this.row(id); const d = before ?? '9999-12-31';
    const r = this.db.prepare("SELECT COALESCE(SUM(CASE WHEN account_id=? AND kind='in' THEN amount_minor WHEN account_id=? AND kind IN ('out','transfer') THEN -amount_minor WHEN to_account_id=? THEN amount_minor ELSE 0 END),0) t FROM ledger_entries WHERE status='posted' AND entry_date<? AND (account_id=? OR to_account_id=?)").get(id, id, id, d, id, id);
    return (before !== undefined && before < String(a.opening_date) ? 0 : Number(a.opening_minor)) + Number(r?.t ?? 0);
  }
  private view(r: Record<string, unknown>): MoneyAccount { return { id: String(r.id), name: String(r.name), kind: r.kind as AccountKind, openingMinor: Number(r.opening_minor), openingDate: String(r.opening_date), active: r.active === 1, balanceMinor: this.balanceOf(String(r.id)) }; }
  createAccount(actor: Person, i: { name: string; kind: AccountKind; openingMinor?: number; openingDate?: string }): MoneyAccount {
    this.need(actor, 'ledger.post'); const name = i.name?.trim(); if (!name) throw new AccError('invalid', 'a name is required'); if (!['cash', 'wallet', 'bank', 'custody', 'other'].includes(i.kind)) throw new AccError('invalid', 'bad kind');
    const open = i.openingMinor ?? 0; if (!Number.isInteger(open) || open < 0) throw new AccError('invalid', 'opening balance must be whole piasters, not negative'); const date = i.openingDate ?? this.hub.now().slice(0, 10); if (!isDate(date)) throw new AccError('invalid', 'bad date');
    return this.db.tx(() => {
      if (this.db.prepare('SELECT 1 FROM money_accounts WHERE name_key=?').get(normalizeSearch(name))) throw new AccError('duplicate', 'an account with this name exists'); const id = uuidv7(); const sort = Number(this.db.prepare('SELECT COALESCE(MAX(sort),0)+10 s FROM money_accounts').get()?.s);
      this.db.prepare('INSERT INTO money_accounts(id,name,name_key,kind,opening_minor,opening_date,sort,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, normalizeSearch(name), i.kind, open, date, sort, actor.id, this.hub.now());
      this.hub.audit(actor.id, 'account.created', 'money_account', id, { name, kind: i.kind, openingMinor: open }); this.hub.emit('account.created', { id }); return this.view(this.row(id));
    });
  }
  rename(actor: Person, id: string, name: string): MoneyAccount {
    this.need(actor, 'ledger.post'); const n = name?.trim(); if (!n) throw new AccError('invalid', 'a name is required');
    return this.db.tx(() => { const r = this.row(id); const dup = this.db.prepare('SELECT id FROM money_accounts WHERE name_key=?').get(normalizeSearch(n)); if (dup && dup.id !== id) throw new AccError('duplicate', 'an account with this name exists'); this.db.prepare('UPDATE money_accounts SET name=?, name_key=? WHERE id=?').run(n, normalizeSearch(n), id); this.hub.audit(actor.id, 'account.renamed', 'money_account', id, { from: String(r.name), to: n }); return this.view(this.row(id)); });
  }
  /** Switch an account off (a reason is required, and its balance must be zero) or back on. Its entries and statements stay. */
  setActive(actor: Person, id: string, active: boolean, reason?: string): MoneyAccount {
    this.need(actor, 'ledger.post'); if (!active && !reason?.trim()) throw new AccError('invalid', 'a reason is required');
    return this.db.tx(() => { this.row(id); if (!active) { if (this.balanceOf(id) !== 0) throw new AccError('state', 'the account still holds money: move it first'); if (this.db.prepare("SELECT 1 FROM cheques WHERE account_id=? AND status='pending'").get(id)) throw new AccError('state', 'pending cheques use this account'); }
      this.db.prepare('UPDATE money_accounts SET active=?, deactivated_reason=? WHERE id=?').run(active ? 1 : 0, active ? null : reason!.trim(), id); this.hub.audit(actor.id, active ? 'account.activated' : 'account.deactivated', 'money_account', id, { reason: reason?.trim() ?? null }); return this.view(this.row(id)); });
  }
  list(actor: Person, o: { includeInactive?: boolean } = {}): MoneyAccount[] { this.need(actor, 'ledger.view'); return this.db.prepare('SELECT * FROM money_accounts WHERE (? = 1 OR active = 1) ORDER BY sort, name').all(o.includeInactive ? 1 : 0).map(r => this.view(r)); }
  get(actor: Person, id: string): MoneyAccount { this.need(actor, 'ledger.view'); return this.view(this.row(id)); }
  /** Total of all active accounts. */
  total(actor: Person): number { return this.list(actor).reduce((s, a) => s + a.balanceMinor, 0); }
  createCategory(actor: Person, i: { name: string; kind: EntryKind }): Category {
    this.need(actor, 'ledger.post'); const name = i.name?.trim(); if (!name) throw new AccError('invalid', 'a name is required'); if (!['in', 'out', 'transfer'].includes(i.kind)) throw new AccError('invalid', 'bad kind');
    return this.db.tx(() => { if (this.db.prepare('SELECT 1 FROM ledger_categories WHERE name_key=?').get(normalizeSearch(name))) throw new AccError('duplicate', 'a category with this name exists'); const id = uuidv7(); const sort = Number(this.db.prepare('SELECT COALESCE(MAX(sort),0)+10 s FROM ledger_categories').get()?.s);
      this.db.prepare('INSERT INTO ledger_categories(id,name,name_key,kind,sort) VALUES(?,?,?,?,?)').run(id, name, normalizeSearch(name), i.kind, sort); this.hub.audit(actor.id, 'category.created', 'ledger_category', id, { name, kind: i.kind }); return { id, name, kind: i.kind, active: true }; });
  }
  renameCategory(actor: Person, id: string, name: string): void {
    this.need(actor, 'ledger.post'); const n = name?.trim(); if (!n) throw new AccError('invalid', 'a name is required');
    this.db.tx(() => { if (!this.db.prepare('SELECT 1 FROM ledger_categories WHERE id=?').get(id)) throw new AccError('not-found', 'category'); const dup = this.db.prepare('SELECT id FROM ledger_categories WHERE name_key=?').get(normalizeSearch(n)); if (dup && dup.id !== id) throw new AccError('duplicate', 'a category with this name exists'); this.db.prepare('UPDATE ledger_categories SET name=?, name_key=? WHERE id=?').run(n, normalizeSearch(n), id); this.hub.audit(actor.id, 'category.renamed', 'ledger_category', id, { to: n }); });
  }
  setCategoryActive(actor: Person, id: string, active: boolean): void { this.need(actor, 'ledger.post'); this.db.tx(() => { if (!this.db.prepare('SELECT 1 FROM ledger_categories WHERE id=?').get(id)) throw new AccError('not-found', 'category'); this.db.prepare('UPDATE ledger_categories SET active=? WHERE id=?').run(active ? 1 : 0, id); this.hub.audit(actor.id, 'category.active', 'ledger_category', id, { active }); }); }
  categories(actor: Person, o: { includeInactive?: boolean; kind?: EntryKind } = {}): Category[] { this.need(actor, 'ledger.view'); return this.db.prepare('SELECT * FROM ledger_categories WHERE (? = 1 OR active = 1) AND (? IS NULL OR kind = ?) ORDER BY sort, name').all(o.includeInactive ? 1 : 0, o.kind ?? null, o.kind ?? null).map(r => ({ id: String(r.id), name: String(r.name), kind: r.kind as EntryKind, active: r.active === 1 })); }
  /** Add the starting categories that are not there yet (by name). */
  seedDefaults(actor: Person): number { let n = 0; for (const c of DEFAULT_CATEGORIES) { try { this.createCategory(actor, c); n++; } catch (e) { if (!(e instanceof AccError) || e.code !== 'duplicate') throw e; } } return n; }
}
