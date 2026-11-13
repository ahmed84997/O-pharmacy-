import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type Person } from '@o-pharmacy/core';
import type { ImportKind, ItemInput, ReasonCode, StoreKind } from '@o-pharmacy/inventory';
import type { App } from './compose';
import { AccessError } from './access';
import { printers, printService } from './printing';

type B = Record<string, unknown>;
const body = (q: FastifyRequest) => (q.body ?? {}) as B;
const param = (q: FastifyRequest, k: string) => String((q.params as B)[k] ?? '');
const qs = (q: FastifyRequest) => (q.query ?? {}) as B;
const key = (b: B) => { const k = String(b.key ?? ''); if (k.length < 8 || k.length > 80) throw new AccessError('invalid', 'a request key is required'); return k; };
const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** Inventory and purchasing (Sprint 7.3): items, units, barcodes, batches, stores, transfers, adjustments, stocktake, suppliers, purchase orders, supplier invoices, returns, price comparison, eStock import. Rules stay in the inventory package. */
export function invRoutes(s: FastifyInstance, app: App): void {
  const me = (q: FastifyRequest): Person => q.person!; const db = app.hub.db;
  const need = (p: Person, k: string) => { if (!can(p, k, app.hub.branchId)) throw new AccessError('forbidden', `missing permission ${k}`); };
  const nameOf = db.prepare('SELECT display_name FROM people WHERE id=?'); const who = (id: string) => String(nameOf.get(id)?.display_name ?? id);
  const itemIn = (b: B): ItemInput => ({ nameAr: String(b.nameAr ?? ''), nameEn: str(b.nameEn), kind: (b.kind as ItemInput['kind']) ?? 'drug', code: str(b.code), form: str(b.form), strength: str(b.strength), activeIngredient: str(b.activeIngredient), manufacturer: str(b.manufacturer), groupId: str(b.groupId), location: str(b.location), reorderLevel: num(b.reorderLevel), listPriceMinor: num(b.listPriceMinor), eta: b.etaCode ? { type: String(b.etaType ?? 'EGS') as 'EGS', code: String(b.etaCode), tax: b.etaTax === 'taxable' ? 'taxable' : 'exempt' } : undefined, units: Array.isArray(b.units) ? (b.units as B[]).map(u => ({ name: String(u.name ?? ''), factor: Number(u.factor) })) : [], barcodes: Array.isArray(b.barcodes) ? (b.barcodes as B[]).filter(x => x.barcode).map(x => ({ barcode: String(x.barcode), unitName: str(x.unitName), kind: x.kind === 'internal' ? 'internal' : x.kind === 'alias' ? 'alias' : 'gtin' })) : [] });

  // ---------- items ----------
  s.get('/api/inv/groups', async (q) => { need(me(q), 'item.view'); return { groups: db.prepare('SELECT id, name FROM item_groups ORDER BY name').all() }; });
  s.post('/api/inv/groups', async (q) => app.items.createGroup(me(q), String(body(q).name ?? '')));
  s.post('/api/inv/items', async (q) => app.items.create(me(q), itemIn(body(q))));
  s.get('/api/inv/search', async (q) => { need(me(q), 'item.view'); return { items: app.items.search(String(qs(q).q ?? ''), { limit: 25 }).map(i => ({ id: i.id, code: i.code, nameAr: i.nameAr, kind: i.kind, status: i.status, units: i.units.map(u => ({ name: u.name, factor: u.factor })), listPriceMinor: i.listPriceMinor })) }; });
  s.get('/api/inv/items/:id', async (q) => {
    const p = me(q); need(p, 'item.view'); const id = param(q, 'id'); const it = app.items.get(id); if (!it) throw new AccessError('not-found', 'item');
    const out: B = { item: it, barcodes: app.items.barcodes(id), statusLog: app.items.statusLog(id).map(l => ({ ...l, byName: who(l.by) })) };
    if (can(p, 'stock.view', app.hub.branchId)) out.byStore = app.stock.byStore(p, id);
    if (can(p, 'stock.batch.view', app.hub.branchId)) out.batches = app.batches.batches(p, id);
    if (can(p, 'supplier_price.view', app.hub.branchId)) out.prices = app.purchasing.priceHistory(p, id);
    return out;
  });
  s.patch('/api/inv/items/:id', async (q) => { const b = body(q); const patch: B = {}; for (const k of ['nameAr', 'nameEn', 'form', 'strength', 'activeIngredient', 'manufacturer', 'groupId', 'location']) if (k in b) patch[k] = str(b[k]) ?? null; if ('reorderLevel' in b) patch.reorderLevel = Number(b.reorderLevel); if ('listPriceMinor' in b) patch.listPriceMinor = b.listPriceMinor === null ? null : Number(b.listPriceMinor); return app.items.update(me(q), param(q, 'id'), patch as never); });
  s.post('/api/inv/items/:id/barcodes', async (q) => { const b = body(q); app.items.addBarcode(me(q), param(q, 'id'), { barcode: String(b.barcode ?? ''), unitName: str(b.unitName), kind: b.kind === 'internal' ? 'internal' : b.kind === 'alias' ? 'alias' : 'gtin' }); return { ok: true }; });
  s.post('/api/inv/items/:id/units', async (q) => { const b = body(q); return app.items.addUnit(me(q), param(q, 'id'), { name: String(b.name ?? ''), factor: Number(b.factor) }); });
  s.post('/api/inv/items/:id/status', async (q) => { const b = body(q); return app.items.setStatus(me(q), param(q, 'id'), String(b.to ?? '') as 'active', String(b.reason ?? '')); });
  s.post('/api/inv/items/:id/restore', async (q) => app.items.restore(me(q), param(q, 'id'), String(body(q).reason ?? '')));
  s.get('/api/inv/inactive', async (q) => ({ items: app.items.inactive(me(q)) }));
  s.get('/api/inv/items/:id/card', async (q) => { const x = qs(q); const c = app.stock.card(me(q), param(q, 'id'), { storeId: str(x.storeId), fromIso: str(x.from), toIso: str(x.to) }); return { ...c, lines: c.lines.map(l => ({ ...l, actorName: who(l.actor) })) }; });
  s.post('/api/inv/batches/:id/status', async (q) => { const b = body(q); app.batches.setStatus(me(q), param(q, 'id'), b.to === 'quarantined' ? 'quarantined' : 'active', String(b.reason ?? '')); return { ok: true }; });
  s.get('/api/inv/expiry', async (q) => ({ rows: app.batches.expiryReport(me(q), Number(qs(q).days ?? 90) || 90) }));
  s.get('/api/inv/low', async (q) => ({ rows: app.stock.lowStock(me(q)) }));
  s.get('/api/inv/valuation', async (q) => app.stock.valuation(me(q)));

  // ---------- stores and transfers ----------
  s.get('/api/inv/stores', async (q) => { need(me(q), 'stock.view'); return { stores: app.stock.stores(true) }; });
  s.post('/api/inv/stores', async (q) => { const b = body(q); return app.stock.createStore(me(q), String(b.name ?? ''), String(b.kind ?? '') as StoreKind); });
  s.post('/api/inv/stores/:id/active', async (q) => { app.stock.setStoreActive(me(q), param(q, 'id'), body(q).active === true); return { ok: true }; });
  s.post('/api/inv/transfers', async (q) => { const b = body(q); return app.stock.transfer(me(q), { key: key(b), itemId: String(b.itemId ?? ''), qtyBase: Number(b.qtyBase), fromStore: String(b.fromStore ?? ''), toStore: String(b.toStore ?? ''), batchId: str(b.batchId), reason: str(b.reason), deviceId: q.deviceId }); });

  // ---------- adjustments and stocktake ----------
  s.get('/api/inv/adjustments', async (q) => { const st = str(qs(q).status); return { adjustments: app.stocktake.adjustments(me(q), st ? { status: st as 'pending' } : {}).map(a => ({ ...a, itemName: String(db.prepare('SELECT name_ar FROM items WHERE id=?').get(a.itemId)?.name_ar ?? ''), byName: who(a.by) })) }; });
  s.post('/api/inv/adjustments', async (q) => { const b = body(q); return app.stocktake.requestAdjustment(me(q), { key: key(b), itemId: String(b.itemId ?? ''), batchId: String(b.batchId ?? ''), storeId: str(b.storeId), qtyBase: Number(b.qtyBase), reasonCode: String(b.reasonCode ?? 'other') as ReasonCode, note: String(b.note ?? '') }); });
  s.post('/api/inv/adjustments/:no/approve', async (q) => app.stocktake.approveAdjustment(me(q), param(q, 'no')));
  s.post('/api/inv/adjustments/:no/reject', async (q) => app.stocktake.rejectAdjustment(me(q), param(q, 'no'), String(body(q).note ?? '')));
  s.get('/api/inv/stocktakes', async (q) => ({ list: app.stocktake.list(me(q)).map(x => ({ ...x, createdByName: who(x.createdBy) })) }));
  s.post('/api/inv/stocktakes', async (q) => { const b = body(q); return app.stocktake.startStocktake(me(q), { key: key(b), storeId: str(b.storeId), itemIds: Array.isArray(b.itemIds) ? (b.itemIds as string[]) : undefined, blind: b.blind !== false, note: str(b.note) }); });
  s.get('/api/inv/stocktakes/:id/lines', async (q) => ({ lines: app.stocktake.lines(me(q), param(q, 'id')) }));
  s.post('/api/inv/stocktakes/:id/count', async (q) => { const b = body(q); app.stocktake.count(me(q), param(q, 'id'), String(b.lineId ?? ''), Number(b.qty)); return { ok: true }; });
  s.post('/api/inv/stocktakes/:id/extra', async (q) => { const b = body(q); return { lineId: app.stocktake.countExtra(me(q), param(q, 'id'), String(b.itemId ?? ''), String(b.batchId ?? ''), Number(b.qty)) }; });
  s.post('/api/inv/stocktakes/:id/submit', async (q) => app.stocktake.submit(me(q), param(q, 'id')));
  s.get('/api/inv/stocktakes/:id/review', async (q) => app.stocktake.review(me(q), param(q, 'id')));
  s.post('/api/inv/stocktakes/:id/apply', async (q) => app.stocktake.apply(me(q), param(q, 'id')));
  s.post('/api/inv/stocktakes/:id/reopen', async (q) => { app.stocktake.reopen(me(q), param(q, 'id'), String(body(q).reason ?? '')); return { ok: true }; });
  s.post('/api/inv/stocktakes/:id/cancel', async (q) => { app.stocktake.cancelStocktake(me(q), param(q, 'id'), String(body(q).reason ?? '')); return { ok: true }; });

  // ---------- suppliers ----------
  s.get('/api/buy/suppliers', async (q) => ({ suppliers: app.purchasing.suppliers(me(q), { q: str(qs(q).q), includeInactive: qs(q).all === '1' }) }));
  s.post('/api/buy/suppliers', async (q) => { const b = body(q); return app.purchasing.createSupplier(me(q), { name: String(b.name ?? ''), phone: str(b.phone), address: str(b.address), taxNo: str(b.taxNo), notes: str(b.notes) }); });
  s.patch('/api/buy/suppliers/:id', async (q) => { const b = body(q); return app.purchasing.updateSupplier(me(q), param(q, 'id'), { name: str(b.name), phone: str(b.phone), address: str(b.address), taxNo: str(b.taxNo), notes: str(b.notes) }); });
  s.post('/api/buy/suppliers/:id/active', async (q) => { const b = body(q); app.purchasing.setSupplierActive(me(q), param(q, 'id'), b.active === true, String(b.reason ?? '')); return { ok: true }; });
  s.get('/api/buy/suppliers/:id/balance', async (q) => { need(me(q), 'supplier.view'); const r = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_minor),0) t FROM purchase_invoices WHERE supplier_id=? AND status='posted'").get(param(q, 'id'))!; return { invoices: Number(r.n), totalMinor: Number(r.t) }; });

  // ---------- purchase orders ----------
  s.get('/api/buy/orders', async (q) => { need(me(q), 'purchase_order.create'); const rows = db.prepare('SELECT o.id, o.po_no, o.status, o.created_at, s.name supplier FROM purchase_orders o JOIN suppliers s ON s.id=o.supplier_id ORDER BY o.rowid DESC LIMIT 200').all(); return { orders: rows.map(r => ({ id: String(r.id), poNo: String(r.po_no), status: String(r.status), supplier: String(r.supplier), createdAt: String(r.created_at) })) }; });
  s.get('/api/buy/orders/:id', async (q) => app.purchasing.orderStatus(me(q), param(q, 'id')));
  s.post('/api/buy/orders', async (q) => { const b = body(q); return app.purchasing.createOrder(me(q), { key: key(b), supplierId: String(b.supplierId ?? ''), note: str(b.note), lines: Array.isArray(b.lines) ? (b.lines as B[]).map(l => ({ itemId: String(l.itemId ?? ''), qty: Number(l.qty), unitName: str(l.unitName) })) : [] }); });
  s.post('/api/buy/orders/:id/send', async (q) => { app.purchasing.sendOrder(me(q), param(q, 'id')); return { ok: true }; });
  s.post('/api/buy/orders/:id/cancel', async (q) => { app.purchasing.cancelOrder(me(q), param(q, 'id'), String(body(q).reason ?? '')); return { ok: true }; });

  // ---------- supplier invoices ----------
  s.get('/api/buy/invoices', async (q) => { const sup = new Map(app.purchasing.suppliers(me(q), { includeInactive: true }).map(x => [x.id, x.name])); return { invoices: app.purchasing.invoices(me(q), { supplierId: str(qs(q).supplierId) }).slice(0, 200).map(i => ({ ...i, supplier: sup.get(i.supplierId) ?? '' })) }; });
  s.get('/api/buy/invoices/:no', async (q) => app.purchasing.invoice(me(q), param(q, 'no')));
  s.post('/api/buy/invoices', async (q) => { const b = body(q); return app.purchasing.postInvoice(me(q), { key: key(b), supplierId: String(b.supplierId ?? ''), supplierRef: str(b.supplierRef), poId: str(b.poId), storeId: str(b.storeId), deviceId: q.deviceId, lines: Array.isArray(b.lines) ? (b.lines as B[]).map(l => ({ itemId: String(l.itemId ?? ''), lot: String(l.lot ?? ''), expiry: String(l.expiry ?? ''), qty: Number(l.qty), unitName: str(l.unitName), bonusQty: num(l.bonusQty), costMinor: Number(l.costMinor), discountBp: num(l.discountBp), taxMinor: num(l.taxMinor), publicPriceMinor: num(l.publicPriceMinor), pharmacistPriceMinor: num(l.pharmacistPriceMinor), priceUnitName: str(l.priceUnitName) })) : [], draftId: str(b.draftId) }); });
  // held (suspended) purchase invoices and what the grid needs to know about an item (Sprint 7.8)
  s.get('/api/buy/drafts', async (q) => ({ drafts: app.purchasing.drafts(me(q)) }));
  s.get('/api/buy/drafts/:id', async (q) => app.purchasing.draft(me(q), param(q, 'id')));
  s.post('/api/buy/drafts', async (q) => { const b = body(q); return app.purchasing.saveDraft(me(q), { key: key(b), id: str(b.id), supplierId: str(b.supplierId), supplierRef: str(b.supplierRef), poId: str(b.poId), note: str(b.note), lines: Array.isArray(b.lines) ? b.lines : [] }); });
  s.post('/api/buy/drafts/:id/cancel', async (q) => { app.purchasing.cancelDraft(me(q), param(q, 'id'), String(body(q).reason ?? '')); return { ok: true }; });
  const lastBuy = db.prepare(`SELECT l.cost_minor, l.discount_bp, b.public_price_minor, u.name price_unit FROM purchase_invoice_lines l JOIN purchase_invoices pi ON pi.id=l.invoice_id JOIN batches b ON b.id=l.batch_id JOIN item_units u ON u.id=b.price_unit_id
    WHERE l.item_id=? AND pi.status='posted' ORDER BY pi.rowid DESC, l.line_no DESC LIMIT 1`);
  const onHand = db.prepare('SELECT COALESCE(SUM(m.qty),0) q FROM movements m JOIN batches b ON b.id=m.batch_id WHERE b.item_id=?');
  const firstBarcode = db.prepare("SELECT barcode FROM item_barcodes WHERE item_id=? ORDER BY CASE kind WHEN 'gtin' THEN 0 WHEN 'internal' THEN 1 ELSE 2 END LIMIT 1");
  s.get('/api/buy/item-hint/:id', async (q) => {
    const p = me(q); need(p, 'purchase_invoice.create'); const it = app.items.get(param(q, 'id')); if (!it) throw new AccessError('not-found', 'item');
    const last = lastBuy.get(it.id);
    return { id: it.id, code: it.code, nameAr: it.nameAr, kind: it.kind, status: it.status, units: it.units.map(u => ({ name: u.name, factor: u.factor })), listPriceMinor: it.listPriceMinor ?? null, stockBase: Number(onHand.get(it.id)!.q), barcode: (firstBarcode.get(it.id)?.barcode as string) ?? null,
      last: last ? { priceUnit: String(last.price_unit), publicPriceMinor: last.public_price_minor == null ? null : Number(last.public_price_minor), costMinor: Number(last.cost_minor), discountBp: Number(last.discount_bp) } : null };
  });
  // shelf labels for the items of an invoice (the first label printer)
  s.post('/api/print/labels', async (q) => {
    const p = me(q); const b = body(q); const lines = Array.isArray(b.lines) ? (b.lines as B[]) : []; if (!lines.length || lines.length > 100) throw new AccessError('invalid', '1 to 100 lines');
    const printer = str(b.printer) ?? printers(app).find(x => x.kind === 'label')?.name; if (!printer) throw new AccessError('state', 'no label printer is set up');
    const svc = printService(app); const out: { itemId: string; ok: boolean; error?: string }[] = [];
    for (const l of lines) { const it = app.items.get(String(l.itemId ?? '')); if (!it) { out.push({ itemId: String(l.itemId ?? ''), ok: false, error: 'not-found' }); continue; }
      const r = await svc.printLabel(p, { printer, name: it.nameAr, priceMinor: num(l.priceMinor), barcode: (firstBarcode.get(it.id)?.barcode as string) ?? null, copies: Math.min(200, Math.max(1, Number(l.copies) || 1)) }); out.push({ itemId: it.id, ok: r.ok, error: r.error }); }
    return { printer, results: out };
  });
  s.post('/api/buy/invoices/:no/void', async (q) => { app.purchasing.voidInvoice(me(q), param(q, 'no'), String(body(q).reason ?? '')); return { ok: true }; });
  s.post('/api/buy/returns', async (q) => { const b = body(q); return app.purchasing.returnToSupplier(me(q), { key: key(b), supplierId: String(b.supplierId ?? ''), invoiceId: str(b.invoiceId), storeId: str(b.storeId), reason: String(b.reason ?? ''), lines: Array.isArray(b.lines) ? (b.lines as B[]).map(l => ({ batchId: String(l.batchId ?? ''), qty: Number(l.qty), unitName: str(l.unitName) })) : [] }); });

  // ---------- import from eStock ----------
  const kindOf = (v: unknown): ImportKind => { if (v === 'items' || v === 'stock' || v === 'suppliers') return v; throw new AccessError('invalid', 'choose what the file holds'); };
  const csvOf = (b: B) => { const c = String(b.csv ?? ''); if (!c.trim()) throw new AccessError('invalid', 'the file is empty'); if (c.length > 15_000_000) throw new AccessError('invalid', 'the file is too big'); return c; };
  s.get('/api/inv/import/template/:kind', async (q) => { need(me(q), 'item.import'); return { csv: app.imports.template(kindOf(param(q, 'kind'))) }; });
  s.post('/api/inv/import/preview', async (q) => { const b = body(q); return app.imports.preview(me(q), kindOf(b.kind), csvOf(b), { mode: b.mode === 'valid_only' ? 'valid_only' : 'all_or_nothing' }); });
  s.post('/api/inv/import/apply', async (q) => { const b = body(q); return app.imports.apply(me(q), kindOf(b.kind), csvOf(b), { mode: b.mode === 'valid_only' ? 'valid_only' : 'all_or_nothing' }); });
  s.get('/api/inv/import/history', async (q) => ({ history: app.imports.history(me(q)) }));
}
