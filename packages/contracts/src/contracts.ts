import { can, normalizeSearch, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';

export type CtrErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'duplicate';
export class CtrError extends Error { constructor(public code: CtrErrorCode, m: string, public detail?: unknown) { super(m); } }
export type PayerType = 'insurance' | 'corporate';
export type ContractStatus = 'active' | 'suspended' | 'ended';
export interface Terms { coveragePercent: number; maxClaimMinor: number | null; approvalAboveMinor: number | null; claimDays: number; effectiveFrom: string }
export interface Contract { id: string; code: string; name: string; payerType: PayerType; customerId: string | null; validFrom: string; validTo: string | null; status: ContractStatus; notes: string | null; terms: Terms | null }
export interface Member { id: string; contractId: string; memberNo: string; name: string; phone: string | null; active: boolean }
export const isDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

/** Contract customers: an insurer or a company whose members get their medicines covered at a percentage, the rest paid by the member (the copay). Terms are versioned by date (a change never rewrites the past), members can be switched off but never deleted, items can be excluded from cover, and an ended contract is final. Needs `contract.manage` to change, `contract.view` to read. */
export class ContractService {
  constructor(private hub: Hub) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new CtrError('forbidden', `missing permission ${perm}`); }
  private next(k: string, prefix: string): string { const n = Number(this.db.prepare('SELECT v FROM ctr_counters WHERE k=?').get(k)?.v ?? 0) + 1; this.db.prepare('INSERT INTO ctr_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`; }
  /** The terms in force on a date. */
  termsAt(contractId: string, date: string): Terms | null { const t = this.db.prepare('SELECT * FROM contract_terms WHERE contract_id=? AND effective_from<=? ORDER BY effective_from DESC, seq DESC').get(contractId, date); return t ? { coveragePercent: Number(t.coverage_percent), maxClaimMinor: t.max_claim_minor === null ? null : Number(t.max_claim_minor), approvalAboveMinor: t.approval_above_minor === null ? null : Number(t.approval_above_minor), claimDays: Number(t.claim_days), effectiveFrom: String(t.effective_from) } : null; }
  private view(r: Record<string, unknown>): Contract { return { id: String(r.id), code: String(r.code), name: String(r.name), payerType: r.payer_type as PayerType, customerId: (r.customer_id as string) ?? null, validFrom: String(r.valid_from), validTo: (r.valid_to as string) ?? null, status: r.status as ContractStatus, notes: (r.notes as string) ?? null, terms: this.termsAt(String(r.id), this.hub.now().slice(0, 10)) }; }
  private row(id: string) { const r = this.db.prepare('SELECT * FROM contracts WHERE id=? OR code=?').get(id, id); if (!r) throw new CtrError('not-found', `contract ${id}`); return r; }
  private checkTerms(t: { coveragePercent: number; maxClaimMinor?: number | null; approvalAboveMinor?: number | null; claimDays: number }): void { if (!Number.isInteger(t.coveragePercent) || t.coveragePercent < 0 || t.coveragePercent > 100) throw new CtrError('invalid', 'coverage is a whole percent from 0 to 100'); for (const v of [t.maxClaimMinor, t.approvalAboveMinor]) if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) throw new CtrError('invalid', 'amounts are whole piasters'); if (t.maxClaimMinor === 0) throw new CtrError('invalid', 'a claim cap of zero covers nothing: use coverage 0'); if (!Number.isInteger(t.claimDays) || t.claimDays < 1 || t.claimDays > 365) throw new CtrError('invalid', 'claim days must be 1 to 365'); }
  create(actor: Person, i: { name: string; payerType: PayerType; customerId?: string; validFrom: string; validTo?: string; notes?: string; terms: { coveragePercent: number; maxClaimMinor?: number; approvalAboveMinor?: number; claimDays?: number } }): Contract {
    this.need(actor, 'contract.manage'); const name = i.name?.trim(); if (!name) throw new CtrError('invalid', 'a name is required'); if (!['insurance', 'corporate'].includes(i.payerType)) throw new CtrError('invalid', 'bad payer type'); if (!isDate(i.validFrom) || (i.validTo && (!isDate(i.validTo) || i.validTo < i.validFrom))) throw new CtrError('invalid', 'bad dates');
    const terms = { ...i.terms, claimDays: i.terms.claimDays ?? 45 }; this.checkTerms(terms);
    return this.db.tx(() => { if (this.db.prepare('SELECT 1 FROM contracts WHERE name_key=?').get(normalizeSearch(name))) throw new CtrError('duplicate', 'a contract with this name exists'); const id = uuidv7(); const code = this.next('contract', 'CT');
      this.db.prepare('INSERT INTO contracts(id,code,name,name_key,payer_type,customer_id,valid_from,valid_to,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, code, name, normalizeSearch(name), i.payerType, i.customerId ?? null, i.validFrom, i.validTo ?? null, i.notes?.trim() || null, actor.id, this.hub.now());
      this.db.prepare('INSERT INTO contract_terms(id,contract_id,coverage_percent,max_claim_minor,approval_above_minor,claim_days,effective_from,set_by,at) VALUES(?,?,?,?,?,?,?,?,?)').run(uuidv7(), id, terms.coveragePercent, terms.maxClaimMinor ?? null, terms.approvalAboveMinor ?? null, terms.claimDays, i.validFrom, actor.id, this.hub.now()); this.hub.audit(actor.id, 'contract.created', 'contract', code, { payerType: i.payerType }); return this.view(this.row(id)); });
  }
  /** New terms from a date (the old terms stay for claims made before it). */
  setTerms(actor: Person, id: string, t: { coveragePercent: number; maxClaimMinor?: number | null; approvalAboveMinor?: number | null; claimDays: number; effectiveFrom: string }): Contract {
    this.need(actor, 'contract.manage'); this.checkTerms(t); if (!isDate(t.effectiveFrom)) throw new CtrError('invalid', 'bad date');
    return this.db.tx(() => { const c = this.row(id); if (c.status === 'ended') throw new CtrError('state', 'the contract has ended'); if (t.effectiveFrom < String(c.valid_from)) throw new CtrError('invalid', 'terms cannot start before the contract'); this.db.prepare('INSERT INTO contract_terms(id,contract_id,coverage_percent,max_claim_minor,approval_above_minor,claim_days,effective_from,set_by,at) VALUES(?,?,?,?,?,?,?,?,?)').run(uuidv7(), String(c.id), t.coveragePercent, t.maxClaimMinor ?? null, t.approvalAboveMinor ?? null, t.claimDays, t.effectiveFrom, actor.id, this.hub.now()); this.hub.audit(actor.id, 'contract.terms_set', 'contract', String(c.code), { effectiveFrom: t.effectiveFrom, coveragePercent: t.coveragePercent }); return this.view(this.row(String(c.id))); });
  }
  /** Suspend, resume or end a contract. A reason is required to suspend or end; ending is final. */
  setStatus(actor: Person, id: string, status: ContractStatus, reason?: string): Contract {
    this.need(actor, 'contract.manage'); if (status !== 'active' && !reason?.trim()) throw new CtrError('invalid', 'a reason is required');
    return this.db.tx(() => { const c = this.row(id); if (c.status === 'ended') throw new CtrError('state', 'the contract has ended'); if (c.status === status) throw new CtrError('state', `already ${status}`); this.db.prepare('UPDATE contracts SET status=?, valid_to=CASE WHEN ?=\'ended\' THEN ? ELSE valid_to END WHERE id=?').run(status, status, this.hub.now().slice(0, 10), String(c.id)); this.hub.audit(actor.id, `contract.${status}`, 'contract', String(c.code), { reason: reason?.trim() ?? null }); return this.view(this.row(String(c.id))); });
  }
  get(actor: Person, id: string): Contract { this.need(actor, 'contract.view'); return this.view(this.row(id)); }
  list(actor: Person, o: { status?: ContractStatus } = {}): Contract[] { this.need(actor, 'contract.view'); return this.db.prepare('SELECT * FROM contracts WHERE (? IS NULL OR status=?) ORDER BY code').all(o.status ?? null, o.status ?? null).map(r => this.view(r)); }
  addMember(actor: Person, contractId: string, m: { memberNo: string; name: string; phone?: string }): Member {
    this.need(actor, 'contract.manage'); if (!m.memberNo?.trim() || !m.name?.trim()) throw new CtrError('invalid', 'member number and name are required');
    return this.db.tx(() => { const c = this.row(contractId); if (c.status === 'ended') throw new CtrError('state', 'the contract has ended'); if (this.db.prepare('SELECT 1 FROM contract_members WHERE contract_id=? AND member_no=?').get(String(c.id), m.memberNo.trim())) throw new CtrError('duplicate', 'this member number exists'); const id = uuidv7();
      this.db.prepare('INSERT INTO contract_members(id,contract_id,member_no,name,phone,created_at) VALUES(?,?,?,?,?,?)').run(id, String(c.id), m.memberNo.trim(), m.name.trim(), m.phone?.trim() || null, this.hub.now()); this.hub.audit(actor.id, 'contract.member_added', 'contract', String(c.code), { memberNo: m.memberNo.trim() }); return this.member(id); });
  }
  private member(id: string): Member { const r = this.db.prepare('SELECT * FROM contract_members WHERE id=?').get(id); if (!r) throw new CtrError('not-found', 'member'); return { id: String(r.id), contractId: String(r.contract_id), memberNo: String(r.member_no), name: String(r.name), phone: (r.phone as string) ?? null, active: r.active === 1 }; }
  setMemberActive(actor: Person, memberId: string, active: boolean): Member { this.need(actor, 'contract.manage'); return this.db.tx(() => { this.member(memberId); this.db.prepare('UPDATE contract_members SET active=? WHERE id=?').run(active ? 1 : 0, memberId); this.hub.audit(actor.id, 'contract.member_active', 'contract_member', memberId, { active }); return this.member(memberId); }); }
  findMember(actor: Person, contractId: string, memberNo: string): Member | null { this.need(actor, 'contract.view'); const r = this.db.prepare('SELECT id FROM contract_members WHERE contract_id=? AND member_no=?').get(String(this.row(contractId).id), memberNo.trim()); return r ? this.member(String(r.id)) : null; }
  members(actor: Person, contractId: string): Member[] { this.need(actor, 'contract.view'); return this.db.prepare('SELECT id FROM contract_members WHERE contract_id=? ORDER BY member_no').all(String(this.row(contractId).id)).map(r => this.member(String(r.id))); }
  /** Exclude an item (by its reference) from cover, or put it back. */
  setExclusion(actor: Person, contractId: string, itemRef: string, excluded: boolean, itemName?: string): void {
    this.need(actor, 'contract.manage'); if (!itemRef?.trim()) throw new CtrError('invalid', 'an item is required');
    this.db.tx(() => { const c = this.row(contractId); this.db.prepare('INSERT INTO contract_exclusions(contract_id,item_ref,item_name,active) VALUES(?,?,?,?) ON CONFLICT(contract_id,item_ref) DO UPDATE SET active=excluded.active').run(String(c.id), itemRef.trim(), itemName?.trim() || null, excluded ? 1 : 0); this.hub.audit(actor.id, 'contract.exclusion', 'contract', String(c.code), { itemRef: itemRef.trim(), excluded }); });
  }
  exclusions(actor: Person, contractId: string): string[] { this.need(actor, 'contract.view'); return this.db.prepare('SELECT item_ref FROM contract_exclusions WHERE contract_id=? AND active=1 ORDER BY item_ref').all(String(this.row(contractId).id)).map(r => String(r.item_ref)); }
}
