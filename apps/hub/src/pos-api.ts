import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type Person } from '@o-pharmacy/core';
import type { PaymentInput, SaleLineInput } from '@o-pharmacy/pos';
import type { App } from './compose';
import { AccessError } from './access';
import { mergeReceiptStyle, printers, printService, receiptPng, receiptStyle, savePrinters } from './printing';
import { autoShortage } from './auto-shortage';

type B = Record<string, unknown>;
const body = (q: FastifyRequest) => (q.body ?? {}) as B;
const param = (q: FastifyRequest, k: string) => String((q.params as B)[k] ?? '');
const int = (v: unknown, what: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new AccessError('invalid', `${what} must be whole piasters`); return n; };
const key = (b: B) => { const k = String(b.key ?? ''); if (k.length < 8 || k.length > 80) throw new AccessError('invalid', 'a request key is required'); return k; };

/** The cashier part of the API (Sprint 7.2): sessions, item lookup and price preview, sales, held bills, returns and swaps, deliveries, drawer closing, printing. Every rule stays in the POS and print packages. */
export function posRoutes(s: FastifyInstance, app: App): void {
  const me = (q: FastifyRequest): Person => q.person!; const db = app.hub.db;
  /** A cashier may always print or see the receipt of a sale they made themselves (the catalogue keeps sale.view_own optional for cashiers). The person stays the same, so the print log names them. */
  const forOwnSale = (p: Person, saleNo: string): Person => { if (can(p, 'sale.view_own', app.hub.branchId) || can(p, 'sale.view_all', app.hub.branchId)) return p; const r = db.prepare('SELECT created_by FROM sales WHERE sale_no=?').get(saleNo); return r && String(r.created_by) === p.id && can(p, 'sale.create', app.hub.branchId) ? { ...p, grants: [...(p.grants ?? []), 'sale.view_own'] } : p; }; const today = () => app.sales.businessDate(app.hub.now());
  const terminalOf = (q: FastifyRequest) => String(db.prepare('SELECT name FROM devices WHERE id=?').get(q.deviceId!)?.name ?? 'terminal');
  const lines = (v: unknown): SaleLineInput[] => { if (!Array.isArray(v) || !v.length || v.length > 200) throw new AccessError('invalid', 'the invoice has no lines'); return v.map(x => { const l = x as B; return { itemId: String(l.itemId ?? ''), qty: Number(l.qty), unitName: l.unitName ? String(l.unitName) : undefined, batchId: l.batchId ? String(l.batchId) : undefined, priceKind: l.priceKind === 'pharmacist' ? 'pharmacist' : undefined, discountBp: l.discountBp === undefined ? undefined : Number(l.discountBp) }; }); };
  const payments = (v: unknown): PaymentInput[] | undefined => Array.isArray(v) ? v.map(x => { const p = x as B; return p.method === 'card' ? { method: 'card', amountMinor: int(p.amountMinor, 'amount'), ref: String(p.ref ?? '') } : { method: 'cash', amountMinor: int(p.amountMinor, 'amount') }; }) : undefined;

  // ---------- session ----------
  s.get('/api/pos/session', async (q) => { const p = me(q); const open = app.sales.openSessionOf(p.id); return { session: open, terminal: terminalOf(q), today: today() }; });
  s.post('/api/pos/session/open', async (q) => { const b = body(q); return app.sales.openSession(me(q), { key: key(b), terminal: terminalOf(q), openingFloatMinor: int(b.openingFloatMinor, 'opening float') }); });
  s.post('/api/pos/session/:id/close', async (q) => { const b = body(q); const sess = app.sales.session(param(q, 'id')); if (String(sess.user_id) !== me(q).id) throw new AccessError('forbidden', 'only the cashier closes their own session'); return app.sales.closeSession(me(q), param(q, 'id'), { countedCashMinor: int(b.countedCashMinor, 'counted cash'), note: b.note ? String(b.note) : undefined }); });

  // ---------- items at the till ----------
  /** A scanned barcode or typed code: the item, the unit the barcode belongs to, and what can be sold. */
  s.get('/api/pos/lookup', async (q) => {
    const p = me(q); if (!can(p, 'item.view', app.hub.branchId)) throw new AccessError('forbidden', 'missing permission item.view'); const code = String((q.query as B).code ?? '').trim(); if (!code) throw new AccessError('invalid', 'empty code');
    const bc = db.prepare('SELECT b.item_id, u.name unit FROM item_barcodes b JOIN item_units u ON u.id=b.unit_id WHERE b.barcode=? AND b.active=1').get(code); const it = bc ? app.items.get(String(bc.item_id)) : app.items.getByCode(code);
    if (!it) return { item: null }; return { item: tillItem(app, it.id), unitName: bc ? String(bc.unit) : null };
  });
  s.get('/api/pos/items/:id', async (q) => { if (!can(me(q), 'item.view', app.hub.branchId)) throw new AccessError('forbidden', 'missing permission item.view'); if (!app.items.get(param(q, 'id'))) throw new AccessError('not-found', 'item'); return { item: tillItem(app, param(q, 'id')) }; });
  s.get('/api/pos/search', async (q) => { const p = me(q); if (!can(p, 'item.view', app.hub.branchId)) throw new AccessError('forbidden', 'missing permission item.view'); return { items: app.items.search(String((q.query as B).q ?? ''), { limit: 20 }).filter(i => i.status === 'active').map(i => tillItem(app, i.id)) }; });
  /** Price preview from the same FEFO allocation the sale will use (nearest expiry first, each batch at its own price). Writes nothing. */
  s.post('/api/pos/quote', async (q) => {
    const p = me(q); if (!can(p, 'sale.create', app.hub.branchId)) throw new AccessError('forbidden', 'missing permission sale.create');
    return { lines: lines(body(q).lines).map(l => { const it = app.items.get(l.itemId); if (!it) return { itemId: l.itemId, error: 'not-found' }; const u = it.units.find(x => x.name === (l.unitName ?? it.units[0]!.name)); if (!u || !Number.isInteger(l.qty) || l.qty <= 0) return { itemId: l.itemId, error: 'invalid' };
      try { const a = app.batches.allocate(l.itemId, l.qty * u.factor, { priceKind: l.priceKind, forceBatchId: l.batchId }); return { itemId: l.itemId, amountMinor: a.totalMinor, missingBase: a.missingBase, picks: a.picks.map(k => ({ lot: k.lot, expiry: k.expiry, qtyBase: k.qtyBase, amountMinor: k.amountMinor })), noPrice: a.picks.some(k => k.unitPriceMinor === null) }; } catch (e) { return { itemId: l.itemId, error: (e as { code?: string }).code ?? 'invalid' }; } }) };
  });

  // ---------- sales ----------
  s.post('/api/pos/sales', async (q) => { const b = body(q); const dl = b.delivery as B | undefined; const ls = lines(b.lines);
    const sold = app.sales.createSale(me(q), { key: key(b), sessionId: String(b.sessionId ?? ''), lines: ls, cashMinor: b.cashMinor === undefined ? undefined : int(b.cashMinor, 'cash'), payments: payments(b.payments), discountBp: b.discountBp === undefined ? undefined : Number(b.discountBp), customerId: b.customerId ? String(b.customerId) : undefined, onCredit: b.onCredit === true, fromHold: b.fromHold ? String(b.fromHold) : undefined, deviceId: q.deviceId,
      delivery: dl ? { name: String(dl.name ?? ''), phone: String(dl.phone ?? ''), address: String(dl.address ?? ''), feeMinor: dl.feeMinor === undefined ? undefined : int(dl.feeMinor, 'delivery fee'), note: dl.note ? String(dl.note) : undefined } : undefined });
    if (!(sold as { replay?: boolean }).replay) autoShortage(app, me(q), ls.map(l => l.itemId)); return sold; });
  s.get('/api/pos/sales', async (q) => { const qs = q.query as B; const p0 = me(q); const p = can(p0, 'sale.view_own', app.hub.branchId) || can(p0, 'sale.view_all', app.hub.branchId) || !can(p0, 'sale.create', app.hub.branchId) ? p0 : { ...p0, grants: [...(p0.grants ?? []), 'sale.view_own'] }; const list = app.sales.sales(p, { sessionId: qs.sessionId ? String(qs.sessionId) : undefined, status: qs.status === 'void' ? 'void' : qs.status === 'posted' ? 'posted' : undefined }).slice(0, 200); const name = db.prepare('SELECT display_name FROM people WHERE id=?'); return { sales: list.map(x => ({ ...x, createdByName: String(name.get(x.createdBy)?.display_name ?? '') })) }; });
  s.get('/api/pos/sales/:no', async (q) => { const p = forOwnSale(me(q), param(q, 'no')); return { sale: app.sales.sale(p, param(q, 'no')), returns: app.returns.returnsOf(p, param(q, 'no')) }; });
  s.post('/api/pos/sales/:no/void', async (q) => { app.sales.voidSale(me(q), param(q, 'no'), String(body(q).reason ?? '')); return { ok: true }; });

  // ---------- held bills ----------
  s.get('/api/pos/holds', async (q) => ({ holds: app.sales.heldBills(me(q), { status: 'open' }) }));
  s.post('/api/pos/holds', async (q) => { const b = body(q); return app.sales.holdBill(me(q), { key: key(b), sessionId: String(b.sessionId ?? ''), lines: lines(b.lines), note: b.note ? String(b.note) : undefined }); });
  s.post('/api/pos/holds/:id/resume', async (q) => app.sales.resumeBill(me(q), param(q, 'id')));
  s.post('/api/pos/holds/:id/cancel', async (q) => { app.sales.cancelHold(me(q), param(q, 'id'), String(body(q).reason ?? '')); return { ok: true }; });

  // ---------- returns and swaps ----------
  s.post('/api/pos/returns', async (q) => { const b = body(q); const r = b.refund as B | undefined;
    return app.returns.returnSale(me(q), { key: key(b), saleNo: String(b.saleNo ?? ''), sessionId: String(b.sessionId ?? ''), lines: (b.lines as B[] ?? []).map(l => ({ lineNo: Number(l.lineNo), qty: Number(l.qty), unitName: l.unitName ? String(l.unitName) : undefined })), reasonCode: String(b.reasonCode ?? 'other') as 'other', note: b.note ? String(b.note) : undefined, condition: b.condition === 'damaged' ? 'damaged' : 'resellable', refund: r?.method === 'card' ? { method: 'card', ref: String(r.ref ?? '') } : r?.method === 'account' ? { method: 'account' } : { method: 'cash' } }); });
  s.post('/api/pos/swaps', async (q) => { const b = body(q);
    return app.returns.swap(me(q), { key: key(b), saleNo: String(b.saleNo ?? ''), sessionId: String(b.sessionId ?? ''), lines: (b.lines as B[] ?? []).map(l => ({ lineNo: Number(l.lineNo), qty: Number(l.qty), unitName: l.unitName ? String(l.unitName) : undefined })), reasonCode: String(b.reasonCode ?? 'other') as 'other', note: b.note ? String(b.note) : undefined, condition: b.condition === 'damaged' ? 'damaged' : 'resellable', newLines: lines(b.newLines), cashMinor: b.cashMinor === undefined ? undefined : int(b.cashMinor, 'cash'), payments: payments(b.payments) }); });

  // ---------- deliveries ----------
  s.get('/api/pos/deliveries', async (q) => { const st = String((q.query as B).status ?? ''); return { deliveries: app.sales.deliveries(me(q), ['pending', 'out_for_delivery', 'delivered', 'failed'].includes(st) ? { status: st as 'pending' } : {}) }; });
  s.post('/api/pos/deliveries/:no/status', async (q) => { const b = body(q); app.sales.setDeliveryStatus(me(q), param(q, 'no'), b.status === 'failed' ? 'failed' : 'out_for_delivery', { agent: b.agent ? String(b.agent) : undefined, reason: b.reason ? String(b.reason) : undefined }); return { ok: true }; });
  s.post('/api/pos/deliveries/:no/collect', async (q) => app.sales.collectDelivery(me(q), param(q, 'no'), { cashMinor: int(body(q).cashMinor, 'cash') }));

  // ---------- drawer closing ----------
  s.get('/api/pos/sessions', async (q) => {
    const p = me(q); const date = String((q.query as B).date ?? today()); const reviewer = can(p, 'drawer.close.review', app.hub.branchId); const name = db.prepare('SELECT display_name FROM people WHERE id=?');
    const rows = db.prepare('SELECT * FROM cashier_sessions ORDER BY rowid DESC LIMIT 300').all().filter(r => reviewer ? app.sales.businessDate(String(r.opened_at)) === date || r.status === 'open' : String(r.user_id) === p.id).slice(0, 60);
    return { date, reviewer, sessions: rows.map(r => ({ id: String(r.id), sessionNo: String(r.session_no), terminal: String(r.terminal), userId: String(r.user_id), userName: String(name.get(r.user_id)?.display_name ?? ''), status: String(r.status), openedAt: String(r.opened_at), closedAt: (r.closed_at as string) ?? null, diffMinor: reviewer && r.diff_minor !== null ? Number(r.diff_minor) : null })) };
  });
  s.get('/api/pos/sessions/:id/report', async (q) => ({ report: app.closing.report(me(q), param(q, 'id')) }));
  s.post('/api/pos/sessions/:id/review', async (q) => { const b = body(q); return app.closing.reviewSession(me(q), { sessionId: param(q, 'id'), decision: b.decision === 'escalated' ? 'escalated' : 'accepted', note: b.note ? String(b.note) : undefined }); });
  s.get('/api/pos/day', async (q) => { const date = String((q.query as B).date ?? today()); const closed = db.prepare('SELECT business_date FROM day_closings WHERE business_date=?').get(date); return { date, closed: !!closed, blockers: closed ? null : app.closing.blockers(me(q), date), days: app.closing.days(me(q), 30) }; });
  s.post('/api/pos/day/close', async (q) => { const b = body(q); return app.closing.closeDay(me(q), { key: key(b), date: String(b.date ?? ''), note: b.note ? String(b.note) : undefined }); });

  // ---------- printing ----------
  s.get('/api/print/printers', async () => ({ printers: printers(app).map(p => ({ name: p.name, kind: p.kind, paperWidthMm: p.paperWidthMm, type: p.transport.type })), style: receiptStyle(app) }));
  s.get('/api/settings/printers', async (q) => { if (!can(me(q), 'settings.branch', app.hub.branchId)) throw new AccessError('forbidden', 'missing permission settings.branch'); return { printers: printers(app), style: receiptStyle(app), phones: app.access.setting('pharmacy.phones') ?? '' }; });
  s.post('/api/settings/printers', async (q) => { const p = me(q); if (!can(p, 'settings.branch', app.hub.branchId)) throw new AccessError('forbidden', 'missing permission settings.branch'); const b = body(q); const list = savePrinters(app, p, b.printers);
    if (b.style && typeof b.style === 'object') app.access.setSetting('receipt.style', JSON.stringify(mergeReceiptStyle(receiptStyle(app), b.style as B)), p.id); // only the keys sent change
    if (typeof b.phones === 'string') app.access.setSetting('pharmacy.phones', b.phones.slice(0, 100), p.id); return { printers: list }; });
  s.post('/api/print/receipt', async (q) => { const b = body(q); return printService(app, q.deviceId).printReceipt(forOwnSale(me(q), String(b.saleNo ?? '')), { saleNo: String(b.saleNo ?? ''), printer: String(b.printer ?? ''), copy: b.copy === 'delivery' ? 'delivery' : 'counter', reason: b.reason ? String(b.reason) : undefined }); });
  s.post('/api/print/session-report', async (q) => { const b = body(q); return printService(app, q.deviceId).printSessionReport(me(q), { sessionId: String(b.sessionId ?? ''), printer: String(b.printer ?? ''), reason: b.reason ? String(b.reason) : undefined }); });
  s.post('/api/print/drawer', async (q) => { const b = body(q); return printService(app, q.deviceId).openDrawer(me(q), { printer: String(b.printer ?? ''), reason: String(b.reason ?? '') }); });
  s.get('/api/print/preview/:no', async (q, rep) => { const w = (q.query as B).w === '58' ? 58 : 80; rep.header('Content-Type', 'image/png'); return rep.send(receiptPng(app, forOwnSale(me(q), param(q, 'no')), param(q, 'no'), w)); });
  s.get('/api/print/jobs', async (q) => ({ jobs: printService(app, q.deviceId).jobs(me(q), { limit: 100 }) }));
}

/** An item as the till needs it: units, the price of the batch that sells first, and how much can be sold. */
function tillItem(app: App, id: string) {
  const it = app.items.get(id)!; const sellable = [...app.batches.balances(id, { sellableOnly: true }).values()].reduce((a, b) => a + b, 0); const today = app.batches.today();
  const b = it.kind === 'drug' ? app.hub.db.prepare("SELECT b.public_price_minor p, b.pharmacist_price_minor ph, u.name u, b.expiry e FROM batches b JOIN item_units u ON u.id=b.price_unit_id WHERE b.item_id=? AND b.status='active' AND b.expiry>=? AND (SELECT COALESCE(SUM(qty),0) FROM movements m WHERE m.batch_id=b.id) > 0 ORDER BY b.expiry LIMIT 1").get(id, today) : undefined;
  return { id, code: it.code, nameAr: it.nameAr, kind: it.kind, units: it.units.filter(u => u.sellable).map(u => ({ name: u.name, factor: u.factor })), sellableBase: sellable, priceMinor: it.kind === 'drug' ? (b ? Number(b.p) : null) : it.listPriceMinor, priceUnit: it.kind === 'drug' ? (b ? String(b.u) : null) : it.units[it.units.length - 1]?.name ?? null, nearestExpiry: b ? String(b.e) : null };
}
