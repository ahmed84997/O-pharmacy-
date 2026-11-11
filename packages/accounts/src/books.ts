import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { AccError, isDate } from './accounts';

export type CoaType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface CoaAccount { id: string; code: string; name: string; type: CoaType; parentId: string | null; active: boolean; balanceMinor: number }
export interface JournalLineInput { coaId: string; debitMinor?: number; creditMinor?: number }
export interface JournalEntry { id: string; journalNo: string; date: string; memo: string; sourceRef: string | null; reversesId: string | null; reversedBy: string | null; lines: { lineNo: number; coaId: string; code: string; name: string; debitMinor: number; creditMinor: number }[] }
/** A simple starting chart for a pharmacy; every pharmacy adds, renames and switches off as it likes. */
export const DEFAULT_CHART: { code: string; name: string; type: CoaType }[] = [
  { code: '1100', name: 'النقدية', type: 'asset' }, { code: '1200', name: 'البنوك والمحافظ', type: 'asset' }, { code: '1300', name: 'المخزون', type: 'asset' }, { code: '1400', name: 'مدينون (العملاء)', type: 'asset' },
  { code: '2100', name: 'دائنون (الموردون)', type: 'liability' }, { code: '3100', name: 'رأس المال والأرصدة الافتتاحية', type: 'equity' },
  { code: '4100', name: 'إيرادات المبيعات', type: 'income' }, { code: '4200', name: 'إيرادات أخرى', type: 'income' },
  { code: '5100', name: 'تكلفة المشتريات', type: 'expense' }, { code: '5200', name: 'مصروفات تشغيل', type: 'expense' }, { code: '5300', name: 'رواتب وأجور', type: 'expense' },
];
const DEBIT_NORMAL: CoaType[] = ['asset', 'expense'];

/** The books: a chart of accounts, a journal where every entry balances (debits = credits), the three statements (trial balance, income statement, balance sheet) and period closing. Journal entries never change and are never deleted: a mistake is reversed. The ledger of Sprint 6.1 feeds the journal through the mappings (`journaliseLedger`). Money accounts and categories are mapped to chart accounts by the Admin. Needs `ledger.post` to write, `statements.view` to read statements, `period.close` / `period.reopen` for periods. */
export class BooksService {
  constructor(private hub: Hub) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new AccError('forbidden', `missing permission ${perm}`); }
  private next(k: string, prefix: string): string { const n = Number(this.db.prepare('SELECT v FROM acc_counters WHERE k=?').get(k)?.v ?? 0) + 1; this.db.prepare('INSERT INTO acc_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`; }
  private coa(id: string) { const r = this.db.prepare('SELECT * FROM coa_accounts WHERE id=? OR code=?').get(id, id); if (!r) throw new AccError('not-found', `chart account ${id}`); return r; }
  private sums(id: string, upTo?: string) { const r = this.db.prepare('SELECT COALESCE(SUM(l.debit_minor),0) d, COALESCE(SUM(l.credit_minor),0) c FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.coa_id=? AND e.entry_date<=?').get(id, upTo ?? '9999-12-31'); return { d: Number(r?.d), c: Number(r?.c) }; }
  private balance(id: string, type: CoaType, upTo?: string): number { const s = this.sums(id, upTo); return DEBIT_NORMAL.includes(type) ? s.d - s.c : s.c - s.d; }
  private view(r: Record<string, unknown>): CoaAccount { return { id: String(r.id), code: String(r.code), name: String(r.name), type: r.type as CoaType, parentId: (r.parent_id as string) ?? null, active: r.active === 1, balanceMinor: this.balance(String(r.id), r.type as CoaType) }; }
  private periodOpen(date: string): void { if (this.db.prepare("SELECT 1 FROM fin_periods WHERE month=? AND status='closed'").get(date.slice(0, 7))) throw new AccError('state', `the period ${date.slice(0, 7)} is closed`); }

  // ---- chart of accounts
  createAccount(actor: Person, i: { code: string; name: string; type: CoaType; parentId?: string }): CoaAccount {
    this.need(actor, 'ledger.post'); if (!i.code?.trim() || !i.name?.trim()) throw new AccError('invalid', 'code and name are required'); if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(i.type)) throw new AccError('invalid', 'bad type');
    return this.db.tx(() => { if (this.db.prepare('SELECT 1 FROM coa_accounts WHERE code=?').get(i.code.trim())) throw new AccError('duplicate', 'this code exists'); if (i.parentId && this.coa(i.parentId).type !== i.type) throw new AccError('invalid', 'a child has the type of its parent'); const id = uuidv7();
      this.db.prepare('INSERT INTO coa_accounts(id,code,name,type,parent_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id, i.code.trim(), i.name.trim(), i.type, i.parentId ? String(this.coa(i.parentId).id) : null, actor.id, this.hub.now()); this.hub.audit(actor.id, 'coa.created', 'coa_account', i.code.trim(), { type: i.type }); return this.view(this.coa(id)); });
  }
  seedChart(actor: Person): number { let n = 0; for (const a of DEFAULT_CHART) { try { this.createAccount(actor, a); n++; } catch (e) { if (!(e instanceof AccError) || e.code !== 'duplicate') throw e; } } return n; }
  renameAccount(actor: Person, id: string, name: string): void { this.need(actor, 'ledger.post'); if (!name?.trim()) throw new AccError('invalid', 'a name is required'); this.db.tx(() => { const r = this.coa(id); this.db.prepare('UPDATE coa_accounts SET name=? WHERE id=?').run(name.trim(), String(r.id)); this.hub.audit(actor.id, 'coa.renamed', 'coa_account', String(r.code), { to: name.trim() }); }); }
  setAccountActive(actor: Person, id: string, active: boolean): void { this.need(actor, 'ledger.post'); this.db.tx(() => { const r = this.coa(id); if (!active && this.balance(String(r.id), r.type as CoaType) !== 0) throw new AccError('state', 'the account still has a balance'); this.db.prepare('UPDATE coa_accounts SET active=? WHERE id=?').run(active ? 1 : 0, String(r.id)); this.hub.audit(actor.id, 'coa.active', 'coa_account', String(r.code), { active }); }); }
  accounts(actor: Person, o: { includeInactive?: boolean } = {}): CoaAccount[] { this.need(actor, 'ledger.view'); return this.db.prepare('SELECT * FROM coa_accounts WHERE (? = 1 OR active = 1) ORDER BY code').all(o.includeInactive ? 1 : 0).map(r => this.view(r)); }
  /** Link a money account, a ledger category (or the opening-balance equity) to a chart account. A money account maps to an asset; an in-category to income (or anything); the mapping can be changed later. */
  map(actor: Person, kind: 'money' | 'category' | 'opening', refId: string, coaId: string): void {
    this.need(actor, 'ledger.post');
    this.db.tx(() => { const c = this.coa(coaId); if (c.active !== 1) throw new AccError('state', 'the chart account is switched off'); if (kind === 'money') { if (!this.db.prepare('SELECT 1 FROM money_accounts WHERE id=?').get(refId)) throw new AccError('not-found', 'money account'); if (c.type !== 'asset') throw new AccError('invalid', 'a money account maps to an asset'); } else if (kind === 'category') { if (!this.db.prepare('SELECT 1 FROM ledger_categories WHERE id=?').get(refId)) throw new AccError('not-found', 'category'); } else if (refId !== 'equity') throw new AccError('invalid', "the opening mapping is 'equity'");
      this.db.prepare('INSERT INTO account_mappings(kind,ref_id,coa_id) VALUES(?,?,?) ON CONFLICT(kind,ref_id) DO UPDATE SET coa_id=excluded.coa_id').run(kind, refId, String(c.id)); this.hub.audit(actor.id, 'coa.mapped', 'account_mapping', `${kind}:${refId}`, { coa: String(c.code) }); });
  }

  // ---- journal
  private entry(id: string): JournalEntry { const e = this.db.prepare('SELECT * FROM journal_entries WHERE id=?').get(id); if (!e) throw new AccError('not-found', `journal entry ${id}`); const lines = this.db.prepare('SELECT l.*, c.code, c.name FROM journal_lines l JOIN coa_accounts c ON c.id=l.coa_id WHERE l.entry_id=? ORDER BY l.line_no').all(id).map(l => ({ lineNo: Number(l.line_no), coaId: String(l.coa_id), code: String(l.code), name: String(l.name), debitMinor: Number(l.debit_minor), creditMinor: Number(l.credit_minor) }));
    return { id: String(e.id), journalNo: String(e.journal_no), date: String(e.entry_date), memo: String(e.memo), sourceRef: (e.source_ref as string) ?? null, reversesId: (e.reverses_id as string) ?? null, reversedBy: (e.reversed_by as string) ?? null, lines }; }
  /** Must run inside a transaction. @internal */
  private write(actor: Person, i: { key: string; date: string; memo: string; lines: JournalLineInput[]; sourceRef?: string; reversesId?: string; reason?: string }): { entry: JournalEntry; replay: boolean } {
    const old = this.db.prepare('SELECT id FROM journal_entries WHERE req_key=?').get(i.key); if (old) return { entry: this.entry(String(old.id)), replay: true };
    if (!isDate(i.date)) throw new AccError('invalid', 'bad date'); if (!i.memo?.trim()) throw new AccError('invalid', 'a memo is required'); if (i.lines.length < 2) throw new AccError('invalid', 'an entry needs at least two lines'); this.periodOpen(i.date);
    let d = 0, c = 0; const lines = i.lines.map(l => { const dm = l.debitMinor ?? 0, cm = l.creditMinor ?? 0; if (!Number.isInteger(dm) || !Number.isInteger(cm) || dm < 0 || cm < 0 || (dm > 0) === (cm > 0)) throw new AccError('invalid', 'each line has either a debit or a credit, in whole piasters'); const a = this.coa(l.coaId); if (a.active !== 1) throw new AccError('state', `${String(a.code)} is switched off`); d += dm; c += cm; return { coa: String(a.id), dm, cm }; });
    if (d !== c) throw new AccError('invalid', `the entry does not balance: debit ${d}, credit ${c}`); const id = uuidv7(); const no = this.next('journal', 'J');
    this.db.prepare('INSERT INTO journal_entries(id,journal_no,req_key,entry_date,memo,source_ref,reverses_id,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, no, i.key, i.date, i.memo.trim(), i.sourceRef ?? null, i.reversesId ?? null, i.reason ?? null, actor.id, this.hub.now());
    lines.forEach((l, k) => this.db.prepare('INSERT INTO journal_lines(id,entry_id,line_no,coa_id,debit_minor,credit_minor) VALUES(?,?,?,?,?,?)').run(uuidv7(), id, k + 1, l.coa, l.dm, l.cm)); this.hub.audit(actor.id, 'journal.posted', 'journal_entry', no, { totalMinor: d }); this.hub.emit('journal.posted', { journalNo: no, totalMinor: d }); return { entry: this.entry(id), replay: false };
  }
  post(actor: Person, i: { key: string; date: string; memo: string; lines: JournalLineInput[] }): { entry: JournalEntry; replay: boolean } { this.need(actor, 'ledger.post'); return this.db.tx(() => this.write(actor, i)); }
  /** Cancel an entry by posting its mirror image (a reason is required). The original stays and shows what reversed it. */
  reverse(actor: Person, id: string, reason: string, date?: string): JournalEntry {
    this.need(actor, 'ledger.post'); if (!reason?.trim()) throw new AccError('invalid', 'a reason is required');
    return this.db.tx(() => { const e = this.entry(id); if (e.reversedBy) throw new AccError('state', 'already reversed'); if (e.reversesId) throw new AccError('state', 'a reversal cannot be reversed: post a new entry'); const r = this.write(actor, { key: `reverse:${e.id}`, date: date ?? this.hub.now().slice(0, 10), memo: `عكس ${e.journalNo}: ${reason.trim()}`, lines: e.lines.map(l => ({ coaId: l.coaId, debitMinor: l.creditMinor, creditMinor: l.debitMinor })), reversesId: e.id, reason: reason.trim() });
      this.db.prepare('UPDATE journal_entries SET reversed_by=? WHERE id=?').run(r.entry.id, e.id); return r.entry; });
  }
  journal(actor: Person, f: { from?: string; to?: string; limit?: number } = {}): JournalEntry[] { this.need(actor, 'ledger.view'); return this.db.prepare('SELECT id FROM journal_entries WHERE (? IS NULL OR entry_date>=?) AND (? IS NULL OR entry_date<=?) ORDER BY entry_date DESC, rowid DESC LIMIT ?').all(f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, Math.min(f.limit ?? 100, 500)).map(r => this.entry(String(r.id))); }
  getEntry(actor: Person, id: string): JournalEntry { this.need(actor, 'ledger.view'); return this.entry(id); }

  /** Turn the money ledger into journal entries using the mappings: in = money account debit, category credit; out = category debit, money credit; transfer = destination debit, source credit; opening balances = money debit, opening equity credit. A voided entry that was journalised is reversed. Anything unmapped or in a closed period is reported and left for later. */
  journaliseLedger(actor: Person): { posted: number; reversed: number; skipped: { ref: string; why: string }[] } {
    this.need(actor, 'ledger.post'); const skipped: { ref: string; why: string }[] = []; let posted = 0, reversed = 0;
    const m = (kind: string, ref: string) => (this.db.prepare('SELECT coa_id FROM account_mappings WHERE kind=? AND ref_id=?').get(kind, ref)?.coa_id as string | undefined);
    return this.db.tx(() => {
      for (const a of this.db.prepare('SELECT id, name, opening_minor, opening_date FROM money_accounts WHERE opening_minor>0').all()) { const ref = `opening:${String(a.id)}`; if (this.db.prepare('SELECT 1 FROM journal_entries WHERE source_ref=?').get(ref)) continue; const mc = m('money', String(a.id)), eq = m('opening', 'equity'); if (!mc || !eq) { skipped.push({ ref, why: 'unmapped' }); continue; }
        try { this.write(actor, { key: ref, date: String(a.opening_date), memo: `رصيد افتتاحي ${String(a.name)}`, lines: [{ coaId: mc, debitMinor: Number(a.opening_minor) }, { coaId: eq, creditMinor: Number(a.opening_minor) }], sourceRef: ref }); posted++; } catch (e) { if (e instanceof AccError && e.code === 'state') skipped.push({ ref, why: 'closed' }); else throw e; } }
      for (const e of this.db.prepare("SELECT * FROM ledger_entries WHERE status='posted' ORDER BY entry_date, rowid").all()) { const ref = `ledger:${String(e.id)}`; if (this.db.prepare('SELECT 1 FROM journal_entries WHERE source_ref=?').get(ref)) continue; const mc = m('money', String(e.account_id)); const cc = m('category', String(e.category_id)); const to = e.to_account_id ? m('money', String(e.to_account_id)) : undefined; const amt = Number(e.amount_minor);
        const lines: JournalLineInput[] | null = e.kind === 'in' && mc && cc ? [{ coaId: mc, debitMinor: amt }, { coaId: cc, creditMinor: amt }] : e.kind === 'out' && mc && cc ? [{ coaId: cc, debitMinor: amt }, { coaId: mc, creditMinor: amt }] : e.kind === 'transfer' && mc && to ? [{ coaId: to, debitMinor: amt }, { coaId: mc, creditMinor: amt }] : null;
        if (!lines) { skipped.push({ ref: String(e.entry_no), why: 'unmapped' }); continue; }
        try { this.write(actor, { key: ref, date: String(e.entry_date), memo: `${String(e.entry_no)} ${String(e.description ?? '')}`.trim(), lines, sourceRef: ref }); posted++; } catch (er) { if (er instanceof AccError && er.code === 'state') skipped.push({ ref: String(e.entry_no), why: 'closed' }); else throw er; } }
      for (const e of this.db.prepare("SELECT l.id, l.entry_no, j.id jid FROM ledger_entries l JOIN journal_entries j ON j.source_ref='ledger:'||l.id WHERE l.status='void' AND j.reversed_by IS NULL").all()) { try { const r = this.write(actor, { key: `reverse:${String(e.jid)}`, date: this.hub.now().slice(0, 10), memo: `عكس ${String(e.entry_no)} (ملغاة)`, lines: this.entry(String(e.jid)).lines.map(l => ({ coaId: l.coaId, debitMinor: l.creditMinor, creditMinor: l.debitMinor })), reversesId: String(e.jid), reason: 'ledger entry voided' }); this.db.prepare('UPDATE journal_entries SET reversed_by=? WHERE id=?').run(r.entry.id, String(e.jid)); reversed++; } catch (er) { if (er instanceof AccError && er.code === 'state') skipped.push({ ref: String(e.entry_no), why: 'closed' }); else throw er; } }
      this.hub.audit(actor.id, 'journal.journalised', 'journal', 'ledger', { posted, reversed, skipped: skipped.length }); return { posted, reversed, skipped };
    });
  }

  // ---- statements (`statements.view`)
  trialBalance(actor: Person, asOf: string) {
    this.need(actor, 'statements.view'); if (!isDate(asOf)) throw new AccError('invalid', 'bad date');
    const rows = this.db.prepare('SELECT * FROM coa_accounts ORDER BY code').all().map(a => { const s = this.sums(String(a.id), asOf); return { code: String(a.code), name: String(a.name), type: a.type as CoaType, debitMinor: Math.max(0, s.d - s.c), creditMinor: Math.max(0, s.c - s.d) }; }).filter(r => r.debitMinor || r.creditMinor);
    const d = rows.reduce((t, r) => t + r.debitMinor, 0), c = rows.reduce((t, r) => t + r.creditMinor, 0); return { asOf, rows, totalDebitMinor: d, totalCreditMinor: c, balanced: d === c };
  }
  incomeStatement(actor: Person, from: string, to: string) {
    this.need(actor, 'statements.view'); if (!isDate(from) || !isDate(to) || from > to) throw new AccError('invalid', 'bad period');
    const pick = (type: CoaType) => this.db.prepare('SELECT * FROM coa_accounts WHERE type=? ORDER BY code').all(type).map(a => { const r = this.db.prepare('SELECT COALESCE(SUM(l.debit_minor),0) d, COALESCE(SUM(l.credit_minor),0) c FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.coa_id=? AND e.entry_date>=? AND e.entry_date<=?').get(String(a.id), from, to); const v = type === 'income' ? Number(r?.c) - Number(r?.d) : Number(r?.d) - Number(r?.c); return { code: String(a.code), name: String(a.name), amountMinor: v }; }).filter(r => r.amountMinor !== 0);
    const income = pick('income'), expenses = pick('expense'); const ti = income.reduce((t, r) => t + r.amountMinor, 0), te = expenses.reduce((t, r) => t + r.amountMinor, 0); return { from, to, income, expenses, totalIncomeMinor: ti, totalExpensesMinor: te, netMinor: ti - te };
  }
  /** Assets = liabilities + equity, where equity includes the profit up to the date that has not been closed into equity. */
  balanceSheet(actor: Person, asOf: string) {
    this.need(actor, 'statements.view'); if (!isDate(asOf)) throw new AccError('invalid', 'bad date'); const side = (type: CoaType) => this.db.prepare('SELECT * FROM coa_accounts WHERE type=? ORDER BY code').all(type).map(a => ({ code: String(a.code), name: String(a.name), amountMinor: this.balance(String(a.id), type, asOf) })).filter(r => r.amountMinor !== 0);
    const assets = side('asset'), liabilities = side('liability'), equity = side('equity'); const profit = this.incomeStatement(actor, '0000-01-01', asOf).netMinor; const ta = assets.reduce((t, r) => t + r.amountMinor, 0), tl = liabilities.reduce((t, r) => t + r.amountMinor, 0), te = equity.reduce((t, r) => t + r.amountMinor, 0) + profit;
    return { asOf, assets, liabilities, equity, retainedProfitMinor: profit, totalAssetsMinor: ta, totalLiabilitiesMinor: tl, totalEquityMinor: te, balanced: ta === tl + te };
  }

  // ---- periods
  periods(actor: Person) { this.need(actor, 'ledger.view'); return this.db.prepare('SELECT month, status, changed_by, changed_at FROM fin_periods ORDER BY month').all().map(p => ({ month: String(p.month), status: String(p.status), changedBy: String(p.changed_by), changedAt: String(p.changed_at) })); }
  /** Close a month: nothing can be posted, voided or journalised into it. Refused while ledger entries of that month are not yet in the journal, and for a month that has not ended. */
  closePeriod(actor: Person, month: string): void {
    this.need(actor, 'period.close'); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AccError('invalid', 'month must be YYYY-MM');
    this.db.tx(() => { if (month >= this.hub.now().slice(0, 7)) throw new AccError('state', 'the month has not ended'); if (this.db.prepare("SELECT 1 FROM fin_periods WHERE month=? AND status='closed'").get(month)) throw new AccError('state', 'already closed');
      const pend = this.db.prepare("SELECT COUNT(*) n FROM ledger_entries l WHERE l.status='posted' AND substr(l.entry_date,1,7)=? AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_ref='ledger:'||l.id)").get(month); if (Number(pend?.n) > 0) throw new AccError('state', `${Number(pend?.n)} ledger entries of ${month} are not in the journal yet`);
      this.db.prepare("INSERT INTO fin_periods(month,status,changed_by,changed_at) VALUES(?,'closed',?,?) ON CONFLICT(month) DO UPDATE SET status='closed', changed_by=excluded.changed_by, changed_at=excluded.changed_at").run(month, actor.id, this.hub.now()); this.db.prepare("INSERT INTO period_events(id,month,action,by,at) VALUES(?,?,'closed',?,?)").run(uuidv7(), month, actor.id, this.hub.now()); this.hub.audit(actor.id, 'period.closed', 'period', month, {}); this.hub.emit('period.closed', { month }); });
  }
  reopenPeriod(actor: Person, month: string, reason: string): void {
    this.need(actor, 'period.reopen'); if (!reason?.trim()) throw new AccError('invalid', 'a reason is required');
    this.db.tx(() => { if (!this.db.prepare("SELECT 1 FROM fin_periods WHERE month=? AND status='closed'").get(month)) throw new AccError('state', 'the period is not closed'); this.db.prepare("UPDATE fin_periods SET status='open', changed_by=?, changed_at=? WHERE month=?").run(actor.id, this.hub.now(), month); this.db.prepare("INSERT INTO period_events(id,month,action,reason,by,at) VALUES(?,?,'reopened',?,?,?)").run(uuidv7(), month, reason.trim(), actor.id, this.hub.now()); this.hub.audit(actor.id, 'period.reopened', 'period', month, { reason: reason.trim() }); });
  }
}
