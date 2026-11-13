import { describe, expect, it } from 'vitest';
import { openApp } from './compose';
import { buildServer } from './server';

let n = 0; const key = () => `inv-key-${++n}-${Date.now()}`;
const prep = async () => {
  const app = openApp({ clock: () => new Date('2026-12-10T08:00:00Z'), testMode: true }); const f = buildServer(app, { staffSecret: 'staff-pass-1' });
  const call = async (method: string, url: string, o: { body?: unknown; token?: string } = {}) => { const r = await f.inject({ method: method as 'GET', url, payload: o.body as object, headers: { 'x-device': dev, ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) } }); return { status: r.statusCode, body: JSON.parse(r.body || 'null') }; };
  const r = await f.inject({ method: 'POST', url: '/api/devices/register', payload: { name: 'PC', kind: 'desktop' } }); const dev = `${r.json().id}.${r.json().secret}`;
  const owner = (await call('POST', '/api/setup', { body: { pharmacyName: 'ص', displayName: 'م', username: 'ahmed', secret: 'owner-pass-1' } })).body.token as string;
  await call('POST', '/api/test/seed', { token: owner }); const login = async (u: string) => (await call('POST', '/api/login', { body: { username: u, secret: 'staff-pass-1' } })).body.token as string;
  return { app, call, owner, sk: await login('storekeeper'), mgr: await login('manager'), cs: await login('cashier') };
};

describe('items, stock and stocktake', () => {
  it('creates a drug item with box and strip, receives it on a supplier invoice, shows its card, batches and price comparison', async () => {
    const s = await prep(); const O = { token: s.owner };
    const it = (await s.call('POST', '/api/inv/items', { ...O, body: { nameAr: 'دواء جديد 50 مجم', kind: 'drug', units: [{ name: 'قرص', factor: 1 }, { name: 'شريط', factor: 10 }, { name: 'علبة', factor: 30 }], barcodes: [{ barcode: '6221000000010', unitName: 'علبة' }] } })).body; expect(it.units).toHaveLength(3);
    expect((await s.call('POST', '/api/inv/items', { ...O, body: { nameAr: 'غلط', kind: 'drug', units: [{ name: 'قرص', factor: 1 }], listPriceMinor: 500 } })).body.error).toBe('price-rule');
    expect((await s.call('POST', '/api/inv/items', { token: s.cs, body: { nameAr: 'x', kind: 'non_drug', units: [{ name: 'قطعة', factor: 1 }] } })).status).toBe(403);
    const sup = (await s.call('GET', '/api/buy/suppliers', O)).body.suppliers[0];
    const inv = (await s.call('POST', '/api/buy/invoices', { ...O, body: { key: key(), supplierId: sup.id, supplierRef: 'F-1', lines: [{ itemId: it.id, lot: 'A1', expiry: '2028-05', qty: 10, unitName: 'علبة', bonusQty: 2, costMinor: 4000, publicPriceMinor: 5000, priceUnitName: 'علبة' }] } })).body; expect(inv.piNo).toBeTruthy();
    expect((await s.call('POST', '/api/buy/invoices', { ...O, body: { key: key(), supplierId: sup.id, supplierRef: 'F-1', lines: [{ itemId: it.id, lot: 'A2', expiry: '2028-05', qty: 1, unitName: 'علبة', costMinor: 4000, publicPriceMinor: 5000, priceUnitName: 'علبة' }] } })).status).toBe(409);
    const card = (await s.call('GET', `/api/inv/items/${it.id}`, O)).body; expect(card.batches[0]).toMatchObject({ lot: 'A1', expiry: '2028-05-31', qtyBase: 360 }); expect(card.prices[0].supplierName).toBe(sup.name); expect(card.byStore[0].qtyBase).toBe(360);
    const k = (await s.call('GET', `/api/inv/items/${it.id}/card`, O)).body; expect(k.closing).toBe(360); expect(k.lines[0].actorName).toBe('م');
    expect((await s.call('GET', `/api/inv/items/${it.id}`, { token: s.cs })).body.batches?.[0]?.costMinor ?? null).toBeNull();
    // transfer to a new back store, then adjust and stocktake
    const st = (await s.call('POST', '/api/inv/stores', { ...O, body: { name: 'المخزن الخلفي', kind: 'warehouse' } })).body; const tr = (await s.call('POST', '/api/inv/transfers', { token: s.mgr, body: { key: key(), itemId: it.id, qtyBase: 60, fromStore: 'MAIN', toStore: st.id } })).body; expect(tr).toBeTruthy();
    const adj = (await s.call('POST', '/api/inv/adjustments', { token: s.sk, body: { key: key(), itemId: it.id, batchId: card.batches[0].id, qtyBase: -5, reasonCode: 'damaged', note: 'وقعت' } })).body; expect(adj.status).toBe('pending');
    expect((await s.call('POST', `/api/inv/adjustments/${adj.adjNo}/approve`, { token: s.sk })).status).toBe(403);
    expect((await s.call('POST', `/api/inv/adjustments/${adj.adjNo}/approve`, { token: s.mgr })).body.status).toBe('approved');
    const take = (await s.call('POST', '/api/inv/stocktakes', { token: s.mgr, body: { key: key(), storeId: st.id } })).body; const lines = (await s.call('GET', `/api/inv/stocktakes/${take.id}/lines`, { token: s.sk })).body.lines; expect(lines[0].systemQty).toBeNull();
    await s.call('POST', `/api/inv/stocktakes/${take.id}/count`, { token: s.sk, body: { lineId: lines[0].id, qty: 58 } }); await s.call('POST', `/api/inv/stocktakes/${take.id}/submit`, { token: s.sk });
    const rv = (await s.call('GET', `/api/inv/stocktakes/${take.id}/review`, { token: s.mgr })).body; expect(JSON.stringify(rv)).toContain('-2');
    expect((await s.call('POST', `/api/inv/stocktakes/${take.id}/apply`, { token: s.mgr })).body.adjusted).toBe(1);
    expect((await s.call('GET', `/api/inv/items/${it.id}`, O)).body.byStore.reduce((t: number, x: { qtyBase: number }) => t + x.qtyBase, 0)).toBe(360 - 5 - 2);
    expect((await s.call('GET', '/api/inv/expiry?days=60', O)).body.rows.length).toBeGreaterThan(0); expect((await s.call('GET', '/api/inv/valuation', O)).body.totalMinor).toBeGreaterThan(0);
  });
  it('suspends and restores an item with a reason, orders from a supplier, returns stock to the supplier, and imports suppliers from a CSV with a dry run first', async () => {
    const s = await prep(); const O = { token: s.owner }; const it = s.app.items.search('ايبوبروفين', { limit: 1 })[0]!;
    expect((await s.call('POST', `/api/inv/items/${it.id}/status`, { ...O, body: { to: 'suspended', reason: '' } })).status).toBe(400);
    expect((await s.call('POST', `/api/inv/items/${it.id}/status`, { ...O, body: { to: 'suspended', reason: 'سحب من السوق' } })).body.status).toBe('suspended');
    expect((await s.call('GET', '/api/inv/inactive', O)).body.items.map((x: { id: string }) => x.id)).toContain(it.id);
    expect((await s.call('POST', `/api/inv/items/${it.id}/restore`, { ...O, body: { reason: 'رجع' } })).body.status).toBe('active');
    const sup = (await s.call('POST', '/api/buy/suppliers', { ...O, body: { name: 'مورد جديد', phone: '0100' } })).body; const po = (await s.call('POST', '/api/buy/orders', { ...O, body: { key: key(), supplierId: sup.id, lines: [{ itemId: it.id, qty: 5, unitName: 'علبة' }] } })).body;
    await s.call('POST', `/api/buy/orders/${po.id}/send`, O); expect((await s.call('GET', '/api/buy/orders', O)).body.orders[0]).toMatchObject({ poNo: po.poNo, status: 'sent', supplier: 'مورد جديد' });
    const b = (await s.call('GET', `/api/inv/items/${it.id}`, O)).body.batches.find((x: { qtyBase: number }) => x.qtyBase > 0); const anySup = (await s.call('GET', '/api/buy/suppliers', O)).body.suppliers[0];
    const ret = (await s.call('POST', '/api/buy/returns', { ...O, body: { key: key(), supplierId: anySup.id, reason: 'قرب الانتهاء', lines: [{ batchId: b.id, qty: 1 }] } })).body; expect(ret.prNo).toBeTruthy();
    const csv = 'code,name,phone\nS-900,مورد مستورد,0123\n,بدون كود,\n';
    const pv = (await s.call('POST', '/api/inv/import/preview', { ...O, body: { kind: 'suppliers', csv } })).body; expect(pv.applied).toBe(false); const before = (await s.call('GET', '/api/buy/suppliers', O)).body.suppliers.length;
    expect((await s.call('GET', '/api/buy/suppliers', O)).body.suppliers.length).toBe(before);
    const ap = (await s.call('POST', '/api/inv/import/apply', { ...O, body: { kind: 'suppliers', csv, mode: 'valid_only' } })).body; expect(ap.created).toBeGreaterThan(0); expect((await s.call('GET', '/api/inv/import/history', O)).body.history).toHaveLength(1);
    expect((await s.call('POST', '/api/inv/import/apply', { token: s.cs, body: { kind: 'suppliers', csv } })).status).toBe(403);
  });
});

describe('purchase invoice screen helpers (Sprint 7.8)', () => {
  it('holds and restores an invoice, tells the grid about an item, posts with discount and tax, and prints shelf labels on the label printer', async () => {
    const s = await prep(); const O = { token: s.sk }; const sup = (await s.call('GET', '/api/buy/suppliers', O)).body.suppliers[0]; const it = (await s.call('GET', '/api/inv/search?q=' + encodeURIComponent('اموكسيسيلين'), O)).body.items[0];
    const hint = (await s.call('GET', `/api/buy/item-hint/${it.id}`, O)).body; expect(hint.units.length).toBeGreaterThan(0); expect(hint.stockBase).toBeGreaterThan(0); expect(hint.last).toMatchObject({ discountBp: 0 }); expect(hint.last.publicPriceMinor).toBeGreaterThan(0);
    expect((await s.call('GET', `/api/buy/item-hint/${it.id}`, { token: s.cs })).status).toBe(403);
    const d = (await s.call('POST', '/api/buy/drafts', { ...O, body: { key: key(), supplierId: sup.id, supplierRef: 'H-9', lines: [{ itemId: it.id, qty: '2' }] } })).body; expect(d.draftNo).toMatch(/^PH-/);
    expect((await s.call('GET', '/api/buy/drafts', O)).body.drafts.map((x: { id: string }) => x.id)).toContain(d.id); expect((await s.call('GET', `/api/buy/drafts/${d.id}`, O)).body.lines).toEqual([{ itemId: it.id, qty: '2' }]);
    const unit = hint.units[hint.units.length - 1].name;
    const inv = (await s.call('POST', '/api/buy/invoices', { ...O, body: { key: key(), supplierId: sup.id, supplierRef: 'H-9', draftId: d.id, lines: [{ itemId: it.id, lot: '', expiry: '2028-05', qty: 2, unitName: unit, costMinor: 4000, discountBp: 2000, taxMinor: 560, publicPriceMinor: 5000, priceUnitName: unit }] } })).body;
    expect(inv.totalMinor).toBe(8560); const back = (await s.call('GET', `/api/buy/invoices/${inv.piNo}`, O)).body; expect(back).toMatchObject({ taxTotalMinor: 560 }); expect(back.lines[0]).toMatchObject({ discountBp: 2000, taxMinor: 560, lot: `${inv.piNo}-1` });
    expect((await s.call('GET', `/api/buy/drafts/${d.id}`, O)).body.status).toBe('used');
    expect((await s.call('POST', '/api/print/labels', { ...O, body: { lines: [{ itemId: it.id, copies: 2 }] } })).body.error).toBe('state');
    await s.call('POST', '/api/settings/printers', { token: s.owner, body: { printers: [{ name: 'استيكر', kind: 'label', transport: { type: 'preview' } }] } });
    const lab = (await s.call('POST', '/api/print/labels', { ...O, body: { lines: [{ itemId: it.id, copies: 2, priceMinor: 5000 }] } })).body; expect(lab).toMatchObject({ printer: 'استيكر', results: [{ itemId: it.id, ok: true }] });
  });
});

describe('item card (Sprint 7.9)', () => {
  it('creates an item with the full card, picks unit names and places, and a "general shortage" item goes to the notebook when a sale empties it', async () => {
    const s = await prep(); const O = { token: s.owner };
    expect((await s.call('GET', '/api/inv/unit-names', O)).body.units.map((u: { name: string }) => u.name)).toEqual(expect.arrayContaining(['قرص', 'علبة']));
    expect((await s.call('POST', '/api/inv/unit-names', { token: s.cs, body: { name: 'z' } })).status).toBe(403);
    await s.call('POST', '/api/inv/locations', { ...O, body: { name: 'رف B2' } });
    const it = (await s.call('POST', '/api/inv/items', { ...O, body: { nameAr: 'كمامة طبية', nameEn: 'Face mask', kind: 'non_drug', listPriceMinor: 2500, units: [{ name: 'قطعة', factor: 1 }, { name: 'علبة', factor: 50 }], barcodes: [{ barcode: '6221234567891', unitName: 'علبة' }, { barcode: 'MASK-1', unitName: 'قطعة', kind: 'internal' }],
      card: { description: 'ثلاث طبقات', defaultCostMinor: 1800, defaultDiscountBp: 1000, taxBp: 1400, hasExpiry: false, printLabel: true, autoShortage: true, hideOnReceipt: true } } })).body;
    expect(it.card).toMatchObject({ description: 'ثلاث طبقات', taxBp: 1400, hasExpiry: false, autoShortage: true, hideOnReceipt: true });
    expect((await s.call('POST', '/api/inv/locations/assign', { ...O, body: { itemIds: [it.id], location: 'رف B2' } })).body.items).toBe(1);
    expect((await s.call('GET', '/api/inv/by-location?location=' + encodeURIComponent('رف B2'), O)).body.items.map((x: { id: string }) => x.id)).toEqual([it.id]);
    expect((await s.call('PATCH', `/api/inv/items/${it.id}`, { ...O, body: { card: { taxBp: 0 } } })).body.card.taxBp).toBe(0);
    const hint = (await s.call('GET', `/api/buy/item-hint/${it.id}`, { token: s.sk })).body; expect(hint.card).toMatchObject({ hasExpiry: false, defaultDiscountBp: 1000 });
    const sup = (await s.call('GET', '/api/buy/suppliers', O)).body.suppliers[0];
    await s.call('POST', '/api/buy/invoices', { token: s.sk, body: { key: key(), supplierId: sup.id, lines: [{ itemId: it.id, lot: '', expiry: '', qty: 2, unitName: 'قطعة', costMinor: 30 }] } });
    const ses = (await s.call('POST', '/api/pos/session/open', { token: s.mgr, body: { key: key(), openingFloatMinor: 0 } })).body;
    const sale = (await s.call('POST', '/api/pos/sales', { token: s.mgr, body: { key: key(), sessionId: ses.id, lines: [{ itemId: it.id, qty: 2, unitName: 'قطعة' }], cashMinor: 100 } })).body; expect(sale.saleNo).toBeTruthy();
    const short = (await s.call('GET', '/api/requests?kind=shortage', O)).body.requests; expect(short.some((r: { items: { itemName: string }[] }) => r.items.some(i => i.itemName === 'كمامة طبية'))).toBe(true);
    const { receiptPng } = await import('./printing'); expect(receiptPng(s.app, { id: 'x', roles: ['O'], branchIds: 'all' }, sale.saleNo).length).toBeGreaterThan(1000);
  });
});
