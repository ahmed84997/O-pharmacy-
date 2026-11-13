import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type Person } from '@o-pharmacy/core';
import type { AccountKind, ChequeDirection, ChequeStatus, CoaType, EntryKind } from '@o-pharmacy/accounts';
import type { AdjustmentKind } from '@o-pharmacy/hr';
import type { ClaimStatus, ContractStatus, PayerType } from '@o-pharmacy/contracts';
import type { App } from './compose';
import { AccessError } from './access';
import { autoShortage } from './auto-shortage';

type B = Record<string, unknown>;
const body = (q: FastifyRequest) => (q.body ?? {}) as B;
const param = (q: FastifyRequest, k: string) => String((q.params as B)[k] ?? '');
const qs = (q: FastifyRequest) => (q.query ?? {}) as B;
const key = (b: B) => { const k = String(b.key ?? ''); if (k.length < 8 || k.length > 80) throw new AccessError('invalid', 'a request key is required'); return k; };
const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
const reason = (b: B) => String(b.reason ?? '');
const optNum = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** Accounts, payroll, contracts and insurance, and the report centre (Sprint 7.5), plus the wiring that was deferred: paying a payslip posts the money out of the chosen account, money received for an insurance batch posts it in, and a sale at the till can be split between the insurer and the member. */
export function accRoutes(s: FastifyInstance, app: App): void {
  const me = (q: FastifyRequest): Person => q.person!; const db = app.hub.db; const today = () => app.sales.businessDate(app.hub.now());
  const need = (p: Person, k: string) => { if (!can(p, k, app.hub.branchId)) throw new AccessError('forbidden', `missing permission ${k}`); };
  const nameOf = db.prepare('SELECT display_name FROM people WHERE id=?'); const who = (id: string | null) => (id ? String(nameOf.get(id)?.display_name ?? id) : null);

  // ---------- money accounts and categories ----------
  s.get('/api/acc/accounts', async (q) => ({ accounts: app.money.list(me(q), { includeInactive: qs(q).all === '1' }), categories: app.money.categories(me(q), { includeInactive: qs(q).all === '1' }) }));
  s.post('/api/acc/setup', async (q) => { const p = me(q); need(p, 'ledger.post'); return db.tx(() => ({ categories: app.money.seedDefaults(p), chart: app.books.seedChart(p) })); });
  s.post('/api/acc/accounts', async (q) => { const b = body(q); return app.money.createAccount(me(q), { name: String(b.name ?? ''), kind: String(b.kind ?? 'cash') as AccountKind, openingMinor: optNum(b.openingMinor), openingDate: str(b.openingDate) }); });
  s.post('/api/acc/accounts/:id/rename', async (q) => app.money.rename(me(q), param(q, 'id'), String(body(q).name ?? '')));
  s.post('/api/acc/accounts/:id/active', async (q) => { const b = body(q); return app.money.setActive(me(q), param(q, 'id'), b.active === true, str(b.reason)); });
  s.post('/api/acc/categories', async (q) => { const b = body(q); return app.money.createCategory(me(q), { name: String(b.name ?? ''), kind: String(b.kind ?? 'out') as EntryKind }); });
  s.post('/api/acc/categories/:id/rename', async (q) => { app.money.renameCategory(me(q), param(q, 'id'), String(body(q).name ?? '')); return { ok: true }; });
  s.post('/api/acc/categories/:id/active', async (q) => { app.money.setCategoryActive(me(q), param(q, 'id'), body(q).active === true); return { ok: true }; });

  // ---------- ledger ----------
  s.get('/api/acc/entries', async (q) => { const x = qs(q); return { entries: app.ledger.list(me(q), { accountId: str(x.accountId), from: str(x.from), to: str(x.to), includeVoid: x.void === '1', limit: 300 }).map(e => ({ ...e, createdByName: who((e as unknown as { createdBy: string }).createdBy) })) }; });
  s.post('/api/acc/entries', async (q) => { const b = body(q); return app.ledger.post(me(q), { key: key(b), date: String(b.date ?? today()), accountId: String(b.accountId ?? ''), kind: String(b.kind ?? 'out') as EntryKind, toAccountId: str(b.toAccountId), categoryId: String(b.categoryId ?? ''), amountMinor: Number(b.amountMinor), party: str(b.party), description: str(b.description), refNo: str(b.refNo) }); });
  s.post('/api/acc/entries/:id/void', async (q) => app.ledger.void(me(q), param(q, 'id'), reason(body(q))));
  s.get('/api/acc/statement/:id', async (q) => { const x = qs(q); return app.ledger.statement(me(q), param(q, 'id'), String(x.from ?? `${today().slice(0, 7)}-01`), String(x.to ?? today())); });

  // ---------- day closings waiting for approval ----------
  s.get('/api/acc/inbox', async (q) => { const p = me(q); if (can(p, 'ledger.post', app.hub.branchId)) app.inbox.feedClosings(p); return { rows: app.inbox.list(p, (str(qs(q).status) as 'pending') ?? 'pending') }; });
  s.post('/api/acc/inbox/:id/approve', async (q) => { const b = body(q); return app.inbox.approve(me(q), param(q, 'id'), { accountId: String(b.accountId ?? ''), categoryId: String(b.categoryId ?? '') }); });
  s.post('/api/acc/inbox/:id/ignore', async (q) => app.inbox.ignore(me(q), param(q, 'id'), reason(body(q))));

  // ---------- cheques ----------
  s.get('/api/acc/cheques', async (q) => { const x = qs(q); return { cheques: app.cheques.list(me(q), { status: str(x.status) as ChequeStatus | undefined, direction: str(x.direction) as ChequeDirection | undefined }), due: app.cheques.due(me(q), 7) }; });
  s.post('/api/acc/cheques', async (q) => { const b = body(q); return app.cheques.register(me(q), { key: key(b), direction: b.direction === 'issued' ? 'issued' : 'received', chequeNo: String(b.chequeNo ?? ''), bankName: str(b.bankName), party: String(b.party ?? ''), amountMinor: Number(b.amountMinor), dueDate: String(b.dueDate ?? ''), accountId: String(b.accountId ?? ''), note: str(b.note) }); });
  s.post('/api/acc/cheques/:id/clear', async (q) => app.cheques.clear(me(q), param(q, 'id'), str(body(q).date)));
  s.post('/api/acc/cheques/:id/bounce', async (q) => app.cheques.bounce(me(q), param(q, 'id'), reason(body(q))));
  s.post('/api/acc/cheques/:id/cancel', async (q) => app.cheques.cancel(me(q), param(q, 'id'), reason(body(q))));

  // ---------- the books ----------
  s.get('/api/books/chart', async (q) => ({ accounts: app.books.accounts(me(q), { includeInactive: qs(q).all === '1' }), mappings: db.prepare('SELECT kind, ref_id refId, coa_id coaId FROM account_mappings').all() }));
  s.post('/api/books/chart', async (q) => { const b = body(q); return app.books.createAccount(me(q), { code: String(b.code ?? ''), name: String(b.name ?? ''), type: String(b.type ?? 'expense') as CoaType, parentId: str(b.parentId) }); });
  s.post('/api/books/map', async (q) => { const b = body(q); app.books.map(me(q), (['money', 'category', 'opening'].includes(String(b.kind)) ? b.kind : 'money') as 'money', String(b.refId ?? ''), String(b.coaId ?? '')); return { ok: true }; });
  s.post('/api/books/journalise', async (q) => app.books.journaliseLedger(me(q)));
  s.get('/api/books/journal', async (q) => { const x = qs(q); return { entries: app.books.journal(me(q), { from: str(x.from), to: str(x.to), limit: 200 }) }; });
  s.post('/api/books/journal', async (q) => { const b = body(q); return app.books.post(me(q), { key: key(b), date: String(b.date ?? today()), memo: String(b.memo ?? ''), lines: Array.isArray(b.lines) ? (b.lines as B[]).map(l => ({ coaId: String(l.coaId ?? ''), debitMinor: optNum(l.debitMinor), creditMinor: optNum(l.creditMinor) })) : [] }); });
  s.post('/api/books/journal/:id/reverse', async (q) => app.books.reverse(me(q), param(q, 'id'), reason(body(q))));
  s.get('/api/books/trial', async (q) => app.books.trialBalance(me(q), String(qs(q).asOf ?? today())));
  s.get('/api/books/income', async (q) => { const x = qs(q); return app.books.incomeStatement(me(q), String(x.from ?? `${today().slice(0, 7)}-01`), String(x.to ?? today())); });
  s.get('/api/books/balance', async (q) => app.books.balanceSheet(me(q), String(qs(q).asOf ?? today())));
  s.get('/api/books/periods', async (q) => ({ periods: app.books.periods(me(q)) }));
  s.post('/api/books/periods/:month/close', async (q) => { app.books.closePeriod(me(q), param(q, 'month')); return { ok: true }; });
  s.post('/api/books/periods/:month/reopen', async (q) => { app.books.reopenPeriod(me(q), param(q, 'month'), reason(body(q))); return { ok: true }; });

  // ---------- payroll (Admin level) ----------
  s.get('/api/payroll/people', async (q) => { const p = me(q); need(p, 'salary.view'); return { people: db.prepare('SELECT id, display_name FROM people WHERE active=1 ORDER BY display_name').all().map(r => ({ id: String(r.id), name: String(r.display_name), profile: app.payroll.profile(p, String(r.id)) })) }; });
  s.post('/api/payroll/profiles', async (q) => { const b = body(q); app.payroll.setProfile(me(q), { personId: String(b.personId ?? ''), baseSalaryMinor: Number(b.baseSalaryMinor), hoursPerDay: Number(b.hoursPerDay), cycleStartDay: optNum(b.cycleStartDay), effectiveFrom: String(b.effectiveFrom ?? today()), reason: str(b.reason) }); return { ok: true }; });
  s.get('/api/payroll/adjustments/:personId', async (q) => ({ adjustments: app.payroll.adjustments(me(q), param(q, 'personId')) }));
  s.post('/api/payroll/adjustments', async (q) => { const b = body(q); return app.payroll.addAdjustment(me(q), { key: key(b), personId: String(b.personId ?? ''), kind: String(b.kind ?? 'bonus') as AdjustmentKind, amountMinor: Number(b.amountMinor), date: String(b.date ?? today()), reason: reason(b) }); });
  s.post('/api/payroll/adjustments/:id/void', async (q) => { app.payroll.voidAdjustment(me(q), param(q, 'id'), reason(body(q))); return { ok: true }; });
  /** Only people who had a pay profile in that month (someone hired later does not block the month). */
  const paidPeople = (month: string) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AccessError('invalid', 'month must be YYYY-MM'); return db.prepare('SELECT DISTINCT person_id FROM pay_profiles WHERE effective_from<=?').all(`${month}-28`).map(r => String(r.person_id)); };
  s.get('/api/payroll/preview', async (q) => { const m = String(qs(q).month ?? ''); const ids = paidPeople(m); return { slips: ids.length ? app.payroll.preview(me(q), m, ids).map(x => ({ ...x, name: who(x.personId) })) : [] }; });
  s.post('/api/payroll/runs', async (q) => { const b = body(q); const m = String(b.month ?? ''); const ids = paidPeople(m); if (!ids.length) throw new AccessError('invalid', 'nobody had a salary set in that month'); return app.payroll.run(me(q), { key: key(b), month: m, personIds: ids }); });
  s.post('/api/payroll/runs/:no/void', async (q) => { app.payroll.voidRun(me(q), param(q, 'no'), reason(body(q))); return { ok: true }; });
  s.get('/api/payroll/payslips', async (q) => ({ payslips: app.payroll.payslips(me(q), { month: str(qs(q).month) }).map(x => ({ ...x, name: who(x.personId) })) }));
  /** Paying a payslip records the payment and, when a money account is chosen, takes the net out of it under the chosen category (once: the entry is keyed by the payslip). */
  s.post('/api/payroll/payslips/:id/pay', async (q) => {
    const p = me(q); const b = body(q); const id = param(q, 'id'); const method = b.method === 'bank' ? 'bank' : b.method === 'wallet' ? 'wallet' : 'cash';
    return db.tx(() => { const slip = app.payroll.payslips(p, {}).find(x => x.id === id); if (!slip) throw new AccessError('not-found', 'payslip'); app.payroll.markPaid(p, id, method, str(b.note));
      if (b.accountId) { need(p, 'ledger.post'); const e = app.ledger.insert(p, { key: `payslip:${id}`, date: today(), accountId: String(b.accountId), kind: 'out', categoryId: String(b.categoryId ?? ''), amountMinor: slip.netMinor, party: who(slip.personId) ?? undefined, description: `مرتب ${slip.periodStart} - ${slip.periodEnd}`, sourceRef: `payslip:${id}` }); return { ok: true, entryNo: e.entry.entryNo }; }
      return { ok: true, entryNo: null }; });
  });

  // ---------- contracts and insurance ----------
  s.get('/api/contracts', async (q) => ({ contracts: app.contracts.list(me(q), { status: str(qs(q).status) as ContractStatus | undefined }) }));
  s.get('/api/contracts/:id', async (q) => ({ contract: app.contracts.get(me(q), param(q, 'id')), members: app.contracts.members(me(q), param(q, 'id')), exclusions: app.contracts.exclusions(me(q), param(q, 'id')) }));
  s.post('/api/contracts', async (q) => { const b = body(q); const t = (b.terms ?? {}) as B; return app.contracts.create(me(q), { name: String(b.name ?? ''), payerType: (b.payerType === 'corporate' ? 'corporate' : 'insurance') as PayerType, customerId: str(b.customerId), validFrom: String(b.validFrom ?? today()), validTo: str(b.validTo), notes: str(b.notes), terms: { coveragePercent: Number(t.coveragePercent), maxClaimMinor: optNum(t.maxClaimMinor), approvalAboveMinor: optNum(t.approvalAboveMinor), claimDays: optNum(t.claimDays) } }); });
  s.post('/api/contracts/:id/terms', async (q) => { const b = body(q); return app.contracts.setTerms(me(q), param(q, 'id'), { coveragePercent: Number(b.coveragePercent), maxClaimMinor: b.maxClaimMinor === null ? null : optNum(b.maxClaimMinor), approvalAboveMinor: b.approvalAboveMinor === null ? null : optNum(b.approvalAboveMinor), claimDays: Number(b.claimDays ?? 30), effectiveFrom: String(b.effectiveFrom ?? today()) }); });
  s.post('/api/contracts/:id/status', async (q) => { const b = body(q); return app.contracts.setStatus(me(q), param(q, 'id'), String(b.status ?? 'active') as ContractStatus, str(b.reason)); });
  s.post('/api/contracts/:id/members', async (q) => { const b = body(q); return app.contracts.addMember(me(q), param(q, 'id'), { memberNo: String(b.memberNo ?? ''), name: String(b.name ?? ''), phone: str(b.phone) }); });
  s.post('/api/contracts/members/:id/active', async (q) => app.contracts.setMemberActive(me(q), param(q, 'id'), body(q).active === true));
  s.post('/api/contracts/:id/exclusions', async (q) => { const b = body(q); app.contracts.setExclusion(me(q), param(q, 'id'), String(b.itemRef ?? ''), b.excluded !== false, str(b.itemName)); return { ok: true }; });
  s.get('/api/claims', async (q) => { const x = qs(q); return { claims: app.claims.list(me(q), { contractId: str(x.contractId), status: str(x.status) as ClaimStatus | undefined }), batches: db.prepare('SELECT batch_no, contract_id, claims_count, claimed_minor, status, submitted_at, due_date, received_minor FROM claim_batches ORDER BY rowid DESC LIMIT 100').all() }; });
  s.get('/api/claims/:id/history', async (q) => ({ history: app.claims.history(me(q), param(q, 'id')).map(h => ({ ...h, byName: who((h as { by: string }).by) })) }));
  s.post('/api/claims/:id/approve', async (q) => app.claims.approve(me(q), param(q, 'id')));
  s.post('/api/claims/:id/cancel', async (q) => app.claims.cancel(me(q), param(q, 'id'), reason(body(q))));
  s.post('/api/claims/batches', async (q) => { const b = body(q); return app.claims.submitBatch(me(q), { key: key(b), contractId: String(b.contractId ?? ''), claimIds: Array.isArray(b.claimIds) ? (b.claimIds as string[]) : [] }); });
  /** Reconciling a batch records what the payer accepted; when a money account is chosen, the money received goes into it (once, keyed by the batch). */
  s.post('/api/claims/batches/:no/reconcile', async (q) => {
    const p = me(q); const b = body(q); const no = param(q, 'no');
    return db.tx(() => { const r = app.claims.reconcile(p, no, { receivedMinor: Number(b.receivedMinor), paymentRef: str(b.paymentRef), results: Array.isArray(b.results) ? (b.results as B[]).map(x => ({ claimId: String(x.claimId ?? ''), acceptedMinor: Number(x.acceptedMinor), reason: str(x.reason) })) : [] });
      if (b.accountId && r.receivedMinor > 0) { need(p, 'ledger.post'); const e = app.ledger.insert(p, { key: `claim_batch:${r.batchNo}`, date: today(), accountId: String(b.accountId), kind: 'in', categoryId: String(b.categoryId ?? ''), amountMinor: r.receivedMinor, party: 'تأمين', description: `تحصيل دفعة مطالبات ${r.batchNo}`, refNo: str(b.paymentRef), sourceRef: `claim_batch:${r.batchNo}` }); return { ...r, entryNo: e.entry.entryNo }; }
      return { ...r, entryNo: null }; });
  });
  s.get('/api/claims/outstanding', async (q) => ({ outstanding: app.claims.outstanding(me(q)) }));

  /** Insurance at the till: the member pays the copay now, the covered part goes on the contract's customer account (a credit sale), and a claim is created for the sale, all in one transaction. */
  s.post('/api/pos/insurance-quote', async (q) => { const b = body(q); const lines = claimLines(app, b.lines); return app.claims.quote(me(q), String(b.contractId ?? ''), today(), lines.map(l => l.claim)); });
  s.post('/api/pos/insurance-sale', async (q) => {
    const p = me(q); const b = body(q); const k = key(b); const contract = app.contracts.get(p, String(b.contractId ?? '')); if (!contract.customerId) throw new AccessError('invalid', 'link the contract to a customer account first'); if (contract.status !== 'active') throw new AccessError('state', 'the contract is not active');
    const lines = claimLines(app, b.lines);
    const done = db.tx(() => { const quote = app.claims.quote(p, contract.id, today(), lines.map(l => l.claim)); const cash = b.cashMinor === undefined ? quote.copayMinor : Number(b.cashMinor);
      const sale = app.sales.createSale(p, { key: `${k}:sale`, sessionId: String(b.sessionId ?? ''), lines: lines.map(l => l.sale), customerId: contract.customerId!, onCredit: true, cashMinor: cash, deviceId: q.deviceId });
      if (sale.totalMinor !== quote.totalMinor) throw new AccessError('state', 'the prices changed while selling: try again');
      const claim = app.claims.create(p, { key: `${k}:claim`, contractId: contract.id, memberNo: String(b.memberNo ?? ''), serviceDate: today(), saleRef: sale.saleNo, rxRef: str(b.rxRef), lines: lines.map(l => l.claim) });
      return { sale, claim: claim.claim, coveredMinor: quote.coveredMinor, copayMinor: quote.copayMinor }; });
    autoShortage(app, p, lines.map(l => l.sale.itemId)); return done;
  });

  // ---------- report centre ----------
  s.get('/api/reports', async (q) => ({ catalogue: app.reports.catalogue(me(q)), views: app.reports.views(me(q)) }));
  s.post('/api/reports/:key/run', async (q) => app.reports.run(me(q), param(q, 'key'), body(q)));
  s.post('/api/reports/:key/export', async (q) => app.reports.export(me(q), param(q, 'key'), body(q)));
  s.post('/api/reports/views', async (q) => { const b = body(q); return { id: app.reports.saveView(me(q), { reportKey: String(b.reportKey ?? ''), name: String(b.name ?? ''), params: (b.params ?? {}) as B, shared: b.shared === true }) }; });
  s.post('/api/reports/views/:id/run', async (q) => app.reports.runView(me(q), param(q, 'id')));
  s.post('/api/reports/views/:id/archive', async (q) => { app.reports.archiveView(me(q), param(q, 'id')); return { ok: true }; });
}

/** Sale lines priced by the same FEFO allocation the sale uses, and the matching claim lines (one per sale line, at its total; the item code is the reference for exclusions). */
function claimLines(app: App, raw: unknown) {
  if (!Array.isArray(raw) || !raw.length) throw new AccessError('invalid', 'the invoice has no lines');
  return (raw as B[]).map(l => { const it = app.items.get(String(l.itemId ?? '')); if (!it) throw new AccessError('not-found', 'item'); const unit = it.units.find(u => u.name === (str(l.unitName) ?? it.units[0]!.name)); const qty = Number(l.qty); if (!unit || !Number.isInteger(qty) || qty <= 0) throw new AccessError('invalid', 'bad quantity');
    const a = app.batches.allocate(it.id, qty * unit.factor); if (a.missingBase > 0) throw Object.assign(new Error('not enough stock'), { code: 'insufficient' }); if (a.totalMinor <= 0) throw Object.assign(new Error('no price'), { code: 'no-price' });
    return { sale: { itemId: it.id, qty, unitName: unit.name }, claim: { itemRef: it.code, itemName: `${it.nameAr} × ${qty} ${unit.name}`, qty: 1, unitPriceMinor: a.totalMinor } }; });
}
