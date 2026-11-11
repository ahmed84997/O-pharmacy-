import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { AccError } from './accounts';
import type { Entry, LedgerService } from './ledger';

export interface InboxRow { id: string; ref: string; source: 'closing_cash' | 'closing_card'; businessDate: string; amountMinor: number; label: string; status: 'pending' | 'approved' | 'ignored'; entryId: string | null }

/** The waiting list between the till and the ledger (the "from the pharmacy" box of the YK ledger). A closed business day proposes two amounts: the counted cash and the card sales. NOTHING reaches the ledger until the Admin approves a proposal and picks the account and category; each proposal has a stable reference, so it is never proposed or posted twice. Closed days are final, so a proposal never changes. Needs `ledger.post`. */
export class InboxService {
  constructor(private hub: Hub, private ledger: LedgerService) {}
  private get db() { return this.hub.db; }
  private need(a: Person): void { if (!can(a, 'ledger.post', this.hub.branchId)) throw new AccError('forbidden', 'missing permission ledger.post'); }
  private view(r: Record<string, unknown>): InboxRow { return { id: String(r.id), ref: String(r.ref), source: r.source as InboxRow['source'], businessDate: String(r.business_date), amountMinor: Number(r.amount_minor), label: String(r.label), status: r.status as InboxRow['status'], entryId: (r.entry_id as string) ?? null }; }
  /** Read the closed days of the POS and add the proposals that are not there yet. Returns how many were added. */
  feedClosings(actor: Person): number {
    this.need(actor); if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='day_closings'").get()) return 0;
    return this.db.tx(() => { let n = 0; const add = (ref: string, source: string, date: string, amt: number, label: string) => { if (amt <= 0 || this.db.prepare('SELECT 1 FROM ledger_inbox WHERE ref=?').get(ref)) return; this.db.prepare('INSERT INTO ledger_inbox(id,ref,source,business_date,amount_minor,label,created_at) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), ref, source, date, amt, label, this.hub.now()); n++; };
      for (const d of this.db.prepare('SELECT business_date, totals_json FROM day_closings ORDER BY business_date').all()) { const t = JSON.parse(String(d.totals_json)) as { countedCashMinor?: number; cardMinor?: number }; const date = String(d.business_date);
        add(`closing:${date}:cash`, 'closing_cash', date, Number(t.countedCashMinor ?? 0), `نقدية تقفيلة ${date}`); add(`closing:${date}:card`, 'closing_card', date, Number(t.cardMinor ?? 0), `مبيعات فيزا ${date}`); }
      if (n) this.hub.audit(actor.id, 'inbox.fed', 'ledger_inbox', 'closings', { added: n }); return n; });
  }
  list(actor: Person, status: InboxRow['status'] = 'pending'): InboxRow[] { if (!can(actor, 'ledger.view', this.hub.branchId)) throw new AccError('forbidden', 'missing permission ledger.view'); return this.db.prepare('SELECT * FROM ledger_inbox WHERE status=? ORDER BY business_date, ref').all(status).map(r => this.view(r)); }
  /** Approve a proposal: post the entry (money in) on the chosen account and category. */
  approve(actor: Person, id: string, c: { accountId: string; categoryId: string }): { row: InboxRow; entry: Entry } {
    this.need(actor);
    return this.db.tx(() => { const r = this.db.prepare('SELECT * FROM ledger_inbox WHERE id=?').get(id); if (!r) throw new AccError('not-found', 'proposal'); if (r.status !== 'pending') throw new AccError('state', `already ${String(r.status)}`);
      const { entry } = this.ledger.insert(actor, { key: `inbox:${String(r.ref)}`, date: String(r.business_date), accountId: c.accountId, kind: 'in', categoryId: c.categoryId, amountMinor: Number(r.amount_minor), description: String(r.label), sourceRef: String(r.ref) });
      this.db.prepare("UPDATE ledger_inbox SET status='approved', entry_id=?, decided_by=?, decided_at=? WHERE id=?").run(entry.id, actor.id, this.hub.now(), id); this.hub.audit(actor.id, 'inbox.approved', 'ledger_inbox', String(r.ref), { entryNo: entry.entryNo }); return { row: this.view(this.db.prepare('SELECT * FROM ledger_inbox WHERE id=?').get(id)!), entry }; });
  }
  ignore(actor: Person, id: string, reason: string): InboxRow {
    this.need(actor); if (!reason?.trim()) throw new AccError('invalid', 'a reason is required');
    return this.db.tx(() => { const r = this.db.prepare('SELECT * FROM ledger_inbox WHERE id=?').get(id); if (!r) throw new AccError('not-found', 'proposal'); if (r.status !== 'pending') throw new AccError('state', `already ${String(r.status)}`); this.db.prepare("UPDATE ledger_inbox SET status='ignored', note=?, decided_by=?, decided_at=? WHERE id=?").run(reason.trim(), actor.id, this.hub.now(), id); this.hub.audit(actor.id, 'inbox.ignored', 'ledger_inbox', String(r.ref), { reason: reason.trim() }); return this.view(this.db.prepare('SELECT * FROM ledger_inbox WHERE id=?').get(id)!); });
  }
}
