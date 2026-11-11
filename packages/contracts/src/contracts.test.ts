import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { CONTRACT_MIGRATIONS, ClaimService, ContractService, CtrError } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const ph: Person = { id: 'ph', roles: ['P'], grants: ['insurance_claim.submit'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as CtrError).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `tk${++n}`;
const prep = () => {
  const clock = { t: Date.parse('2026-12-10T10:00:00Z') }; const hub = Hub.open('b1', ':memory:', () => new Date(clock.t), CONTRACT_MIGRATIONS); const cs = new ContractService(hub); const cl = new ClaimService(hub, cs);
  const ct = cs.create(owner, { name: 'شركة التأمين الأولى', payerType: 'insurance', validFrom: '2026-01-01', terms: { coveragePercent: 80, maxClaimMinor: 100000, approvalAboveMinor: 50000, claimDays: 45 } }); cs.addMember(owner, ct.id, { memberNo: 'M-100', name: 'أحمد علي' }); cs.setExclusion(owner, ct.id, 'cosmetic', true, 'كريم تجميل');
  const small = (date = '2026-12-05') => cl.create(ph, { key: key(), contractId: ct.id, memberNo: 'M-100', serviceDate: date, saleRef: 'S-000001', lines: [{ itemRef: 'a', itemName: 'دواء أ', qty: 2, unitPriceMinor: 5000 }, { itemRef: 'cosmetic', itemName: 'كريم', qty: 1, unitPriceMinor: 3000 }] }).claim;
  const big = (by: Person = mgr) => cl.create(by, { key: key(), contractId: ct.id, memberNo: 'M-100', serviceDate: '2026-12-06', lines: [{ itemRef: 'b', itemName: 'دواء غالي', qty: 1, unitPriceMinor: 200000 }] }).claim;
  return { hub, clock, cs, cl, ct, small, big };
};

describe('contracts', () => {
  it('terms are versioned by date, members and exclusions are switched not deleted, an ended contract is final', () => {
    const s = prep(); expect(s.ct).toMatchObject({ code: 'CT-000001', status: 'active', terms: { coveragePercent: 80, claimDays: 45 } }); expect(code(() => s.cs.create(owner, { name: 'شركة التأمين الأولى', payerType: 'insurance', validFrom: '2026-01-01', terms: { coveragePercent: 10 } }))).toBe('duplicate');
    for (const bad of [{ coveragePercent: 101 }, { coveragePercent: 50.5 }, { coveragePercent: 50, maxClaimMinor: 0 }, { coveragePercent: 50, claimDays: 0 }, { coveragePercent: 50, approvalAboveMinor: 1.5 }]) expect(code(() => s.cs.create(owner, { name: 'x', payerType: 'corporate', validFrom: '2026-01-01', terms: bad }))).toBe('invalid');
    expect(code(() => s.cs.create(ph, { name: 'y', payerType: 'corporate', validFrom: '2026-01-01', terms: { coveragePercent: 10 } }))).toBe('forbidden'); expect(code(() => s.cs.list(cashier))).toBe('no error'); expect(code(() => s.cs.create(cashier, { name: 'z', payerType: 'corporate', validFrom: '2026-01-01', terms: { coveragePercent: 10 } }))).toBe('forbidden');
    s.cs.setTerms(owner, s.ct.id, { coveragePercent: 50, claimDays: 30, effectiveFrom: '2026-12-08' }); expect(s.cs.termsAt(s.ct.id, '2026-12-07')?.coveragePercent).toBe(80); expect(s.cs.termsAt(s.ct.id, '2026-12-09')).toMatchObject({ coveragePercent: 50, maxClaimMinor: null }); expect(code(() => s.cs.setTerms(owner, s.ct.id, { coveragePercent: 50, claimDays: 30, effectiveFrom: '2025-01-01' }))).toBe('invalid');
    expect(code(() => s.cs.addMember(owner, s.ct.id, { memberNo: 'M-100', name: 'x' }))).toBe('duplicate'); const m = s.cs.findMember(owner, s.ct.id, 'M-100')!; expect(s.cs.setMemberActive(owner, m.id, false).active).toBe(false); expect(s.cs.exclusions(owner, s.ct.id)).toEqual(['cosmetic']); s.cs.setExclusion(owner, s.ct.id, 'cosmetic', false); expect(s.cs.exclusions(owner, s.ct.id)).toEqual([]);
    expect(code(() => s.cs.setStatus(owner, s.ct.id, 'suspended'))).toBe('invalid'); s.cs.setStatus(owner, s.ct.id, 'suspended', 'تأخر السداد'); s.cs.setStatus(owner, s.ct.id, 'active'); s.cs.setStatus(owner, s.ct.id, 'ended', 'انتهى العقد'); expect(code(() => s.cs.setStatus(owner, s.ct.id, 'active'))).toBe('state'); expect(code(() => s.cs.addMember(owner, s.ct.id, { memberNo: 'M-2', name: 'x' }))).toBe('state');
    expect(() => s.hub.db.exec('DELETE FROM contracts')).toThrow(); expect(() => s.hub.db.exec('UPDATE contract_terms SET coverage_percent=1')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM contract_members')).toThrow();
  });
});

describe('claims', () => {
  it('splits a basket by the terms on the service date: excluded items are not covered, the cap applies, the split is saved and never changes', () => {
    const s = prep(); const c = s.small(); expect(c).toMatchObject({ claimNo: 'CL-000001', totalMinor: 13000, coveredMinor: 8000, copayMinor: 5000, coveragePercent: 80, status: 'approved' }); s.cs.setTerms(owner, s.ct.id, { coveragePercent: 50, claimDays: 45, effectiveFrom: '2026-12-08' });
    expect(s.small('2026-12-07')).toMatchObject({ coveredMinor: 8000 }); const later = s.small('2026-12-09'); expect(later).toMatchObject({ coveredMinor: 5000, coveragePercent: 50 }); const q = s.cl.quote(ph, s.ct.id, '2026-12-05', [{ itemRef: 'x', itemName: 'x', qty: 1, unitPriceMinor: 200000 }]); expect(q).toMatchObject({ coveredMinor: 100000, copayMinor: 100000, capped: true, needsApproval: true });
    expect(() => s.hub.db.exec('UPDATE claims SET covered_minor=1')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM claims')).toThrow(); expect(() => s.hub.db.exec('UPDATE claim_lines SET covered_minor=1')).toThrow();
  });
  it('refuses bad claims; replays by key; a big claim waits for someone other than its creator', () => {
    const s = prep(); const base = { contractId: s.ct.id, memberNo: 'M-100', serviceDate: '2026-12-05', lines: [{ itemRef: 'a', itemName: 'أ', qty: 1, unitPriceMinor: 1000 }] };
    expect(code(() => s.cl.create(ph, { ...base, key: key(), memberNo: 'nobody' }))).toBe('not-found'); expect(code(() => s.cl.create(ph, { ...base, key: key(), serviceDate: '2025-12-05' }))).toBe('invalid'); expect(code(() => s.cl.create(ph, { ...base, key: key(), serviceDate: '2027-01-01' }))).toBe('invalid');
    expect(code(() => s.cl.create(ph, { ...base, key: key(), lines: [{ itemRef: 'a', itemName: 'أ', qty: 1.5, unitPriceMinor: 1000 }] }))).toBe('invalid'); expect(code(() => s.cl.create(ph, { ...base, key: key(), lines: [] }))).toBe('invalid'); expect(code(() => s.cl.create(cashier, { ...base, key: key() }))).toBe('forbidden');
    const k = key(); const a = s.cl.create(ph, { ...base, key: k }); expect(s.cl.create(ph, { ...base, key: k }).replay).toBe(true); expect(a.claim.id).toBeTruthy(); const m = s.cs.findMember(owner, s.ct.id, 'M-100')!; s.cs.setMemberActive(owner, m.id, false); expect(code(() => s.cl.create(ph, { ...base, key: key() }))).toBe('state'); s.cs.setMemberActive(owner, m.id, true);
    const b = s.big(); expect(b).toMatchObject({ status: 'pending_approval', coveredMinor: 100000 }); expect(code(() => s.cl.approve(mgr, b.id))).toBe('forbidden'); expect(code(() => s.cl.approve(ph, b.id))).toBe('forbidden'); expect(s.cl.approve(owner, b.id).status).toBe('approved'); expect(code(() => s.cl.approve(owner, b.id))).toBe('state');
    expect(code(() => s.cl.cancel(ph, b.id, ' '))).toBe('invalid'); expect(s.cl.cancel(ph, b.id, 'العضو لغى').status).toBe('cancelled'); expect(s.cl.history(ph, b.id).map(h => h.to)).toEqual(['pending_approval', 'approved', 'cancelled']); s.cs.setStatus(owner, s.ct.id, 'suspended', 'x'); expect(code(() => s.cl.create(ph, { ...base, key: key() }))).toBe('state');
  });
});

describe('batches and reconciliation', () => {
  it('sends approved claims as one batch, reconciles claim by claim (paid, partial, rejected), lets a rejected claim go again, and tracks what is owed', () => {
    const s = prep(); const c1 = s.small(); const c2 = s.big(); s.cl.approve(owner, c2.id); const c3 = s.small('2026-12-04'); expect(s.cl.outstanding(owner)).toMatchObject([{ contractCode: 'CT-000001', readyToSendMinor: 116000, sentMinor: 0 }]);
    expect(code(() => s.cl.submitBatch(ph, { key: key(), contractId: s.ct.id, claimIds: [] }))).toBe('invalid'); expect(code(() => s.cl.submitBatch(ph, { key: key(), contractId: s.ct.id, claimIds: [c1.id, c1.id] }))).toBe('invalid'); const bk = key(); const b = s.cl.submitBatch(ph, { key: bk, contractId: s.ct.id, claimIds: [c1.id, c2.id, c3.id] });
    expect(b).toMatchObject({ batchNo: 'BT-000001', claims: 3, claimedMinor: 116000, dueDate: '2027-01-24', replay: false }); expect(s.cl.submitBatch(ph, { key: bk, contractId: s.ct.id, claimIds: [c1.id, c2.id, c3.id] }).replay).toBe(true); expect(code(() => s.cl.submitBatch(ph, { key: key(), contractId: s.ct.id, claimIds: [c1.id] }))).toBe('state');
    expect(s.cl.outstanding(owner)[0]).toMatchObject({ sentMinor: 116000, aging: { d0_30: 116000 }, overdueBatches: [] });
    const res = (a: number, b2: number, c: number) => [{ claimId: c1.id, acceptedMinor: a }, { claimId: c2.id, acceptedMinor: b2, reason: b2 < 100000 ? 'خارج التغطية' : undefined }, { claimId: c3.id, acceptedMinor: c, reason: c < 8000 ? 'مرفوض' : undefined }];
    expect(code(() => s.cl.reconcile(ph, b.batchNo, { receivedMinor: 1, results: [] }))).toBe('forbidden'); expect(code(() => s.cl.reconcile(owner, b.batchNo, { receivedMinor: 90000, results: [{ claimId: c1.id, acceptedMinor: 8000 }] }))).toBe('invalid'); // every claim needs a result
    expect(code(() => s.cl.reconcile(owner, b.batchNo, { receivedMinor: 999, results: res(8000, 90000, 0) }))).toBe('invalid'); // received must equal accepted
    expect(code(() => s.cl.reconcile(owner, b.batchNo, { receivedMinor: 98000, results: [{ claimId: c1.id, acceptedMinor: 8000 }, { claimId: c2.id, acceptedMinor: 90000 }, { claimId: c3.id, acceptedMinor: 0, reason: 'x' }] }))).toBe('invalid'); // partial without reason
    expect(code(() => s.cl.reconcile(owner, b.batchNo, { receivedMinor: 98000, results: [{ claimId: c1.id, acceptedMinor: 9000 }, { claimId: c2.id, acceptedMinor: 89000, reason: 'r' }, { claimId: c3.id, acceptedMinor: 0, reason: 'x' }] }))).toBe('invalid'); // more than covered
    const r = s.cl.reconcile(owner, b.batchNo, { receivedMinor: 98000, paymentRef: 'TRF-9', results: res(8000, 90000, 0) }); expect(r).toMatchObject({ paid: 1, partial: 1, rejected: 1, writtenOffMinor: 10000 }); expect(s.cl.list(owner, { status: 'rejected' }).map(c => c.id)).toEqual([c3.id]); expect(s.cl.get(owner, c2.id)).toMatchObject({ status: 'partial', acceptedMinor: 90000, rejectReason: 'خارج التغطية' });
    expect(code(() => s.cl.reconcile(owner, b.batchNo, { receivedMinor: 0, results: [] }))).toBe('state'); expect(code(() => s.cl.cancel(ph, c1.id, 'x'))).toBe('state'); expect(s.cl.outstanding(owner)).toEqual([]);
    const again = s.cl.submitBatch(ph, { key: key(), contractId: s.ct.id, claimIds: [c3.id] }); expect(again.batchNo).toBe('BT-000002'); s.clock.t += 50 * 86400000; expect(s.cl.outstanding(owner)[0]).toMatchObject({ sentMinor: 8000, aging: { d31_60: 8000 }, overdueBatches: ['BT-000002'] });
    expect(s.cl.reconcile(owner, again.batchNo, { receivedMinor: 8000, results: [{ claimId: c3.id, acceptedMinor: 8000 }] })).toMatchObject({ paid: 1 }); expect(s.cl.history(ph, c3.id).map(h => h.to)).toEqual(['approved', 'batched', 'rejected', 'batched', 'paid']); expect(() => s.hub.db.exec('UPDATE claim_batches SET claimed_minor=1')).toThrow(); expect(() => s.hub.db.exec('DELETE FROM claim_events')).toThrow();
  });
});
