import { beforeEach, describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ItemService, MIGRATIONS } from '@o-pharmacy/inventory';
import { POS_MIGRATIONS, ReturnService, SaleService } from '@o-pharmacy/pos';
import { ETA_MIGRATIONS, EtaHttpError, EtaService, FakeEtaTransport, HttpEtaTransport, etaUuid, serializeEta, type EtaConfig } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const sys: Person = { id: 'hub', roles: ['O'], branchIds: 'all' };
const ph: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'no error'; };
let n = 0; const key = () => `ek${++n}`;
const cfg: EtaConfig = { seller: { rin: '123456789', companyTradeName: 'صيدلية الشفاء', branchCode: '0', activityCode: '4772', branchAddress: { country: 'EG', governate: 'Cairo', regionCity: 'Maadi', street: 'Road 9', buildingNumber: '12' } }, deviceSerial: t => `POS-${t}`, portalUrl: 'https://invoicing.eta.gov.eg', unitCode: u => (u === 'علبة' ? 'BOX' : 'EA'), paymentCode: p => (p.card && !p.cash ? 'V' : 'C'), taxes: () => [] };
const clock = { now: new Date('2026-12-01T10:00:00Z') }; beforeEach(() => { clock.now = new Date('2026-12-01T10:00:00Z'); });
const prep = (o: { eta?: boolean; cfg?: Partial<EtaConfig> } = {}) => {
  const hub = Hub.open('b1', ':memory:', () => clock.now, [...MIGRATIONS, ...POS_MIGRATIONS, ...ETA_MIGRATIONS]); const items = new ItemService(hub);
  const bs = new BatchService(hub, items, { today: () => '2026-12-01' } as never); const sales = new SaleService(hub, items, bs, { maxDiscountPct: () => 5 }); const ret = new ReturnService(hub, items, sales);
  const a = items.create(owner, { nameAr: 'باراسيتامول 500', kind: 'drug', units: [{ name: 'حبة', factor: 1 }, { name: 'علبة', factor: 20 }], eta: o.eta === false ? undefined : { type: 'GS1', code: '6221031234569', tax: 'exempt' } });
  bs.receive(owner, { key: key(), itemId: a.id, lot: 'L1', expiry: '2028-03-31', qty: 50, unitName: 'علبة', costMinor: 3000, publicPriceMinor: 5000, pharmacistPriceMinor: 4500 });
  const tr = new FakeEtaTransport(); const eta = new EtaService(hub, sales, ret, items, tr, () => ({ ...cfg, ...o.cfg }));
  const sid = sales.openSession(ph, { key: key(), terminal: 'T1', openingFloatMinor: 0 }).id; const sell = (o2: Record<string, unknown> = {}) => sales.createSale(ph, { key: key(), sessionId: sid, lines: [{ itemId: a.id, qty: 1 }], cashMinor: 5000, ...o2 } as never);
  return { hub, sales, ret, items, eta, tr, a, sid, sell };
};

describe('serialisation and UUID', () => {
  it('property names upper case in quotes, values in quotes as written, arrays name once and before each element, null left out', () => {
    expect(serializeEta({ invoiceNo: '123', amount: 0.0 } as never)).toBe('"INVOICENO""123""AMOUNT""0"'); expect(serializeEta({ a: { b: 'x' }, c: [{ d: 1 }, { d: 2 }], e: null, f: '' } as never)).toBe('"A""B""x""C""C""D""1""C""D""2""F"""');
  });
  it('the UUID is SHA-256 hex of the serialisation with an empty header.uuid, whatever uuid is already there', () => {
    const doc = { header: { receiptNumber: 'S-1', uuid: '' }, x: [1, 2] } as never; const u = etaUuid(doc); expect(u).toMatch(/^[0-9a-f]{64}$/); expect(etaUuid({ header: { receiptNumber: 'S-1', uuid: 'abc' }, x: [1, 2] } as never)).toBe(u); expect(etaUuid({ header: { receiptNumber: 'S-2', uuid: '' }, x: [1, 2] } as never)).not.toBe(u);
  });
});

describe('queueing receipts', () => {
  it('a sale becomes a v1.2 sale receipt with the lines, discount and totals; the UUID is inside; repeat is safe; chain per terminal', () => {
    const s = prep(); const a = s.sell({ discountBp: 500 }); const q = s.eta.enqueueSale(sys, a.saleNo); expect(q).toMatchObject({ replay: false, receipt: { kind: 'sale', docType: 's', device: 'POS-T1', previousUuid: '', status: 'pending' } }); const doc = JSON.parse((s.hub.db.prepare('SELECT payload FROM eta_receipts').get() as { payload: string }).payload);
    expect(doc.header).toMatchObject({ receiptNumber: a.saleNo, uuid: q.receipt!.uuid, previousUUID: '', currency: 'EGP', dateTimeIssued: '2026-12-01T10:00:00Z' }); expect(doc.documentType).toEqual({ receiptType: 's', typeVersion: '1.2' }); expect(doc.seller).toMatchObject({ rin: '123456789', deviceSerialNumber: 'POS-T1', activityCode: '4772' }); expect(doc.buyer).toEqual({ type: 'P' });
    expect(doc.itemData[0]).toMatchObject({ itemType: 'GS1', itemCode: '6221031234569', unitType: 'BOX', quantity: 1, unitPrice: 50, totalSale: 50, netSale: 47.5, total: 47.5, commercialDiscountData: [{ amount: 2.5, description: 'خصم' }] }); expect(doc).toMatchObject({ totalSales: 50, totalCommercialDiscount: 2.5, netAmount: 47.5, totalAmount: 47.5, paymentMethod: 'C' }); expect(etaUuid(doc)).toBe(q.receipt!.uuid);
    expect(s.eta.enqueueSale(sys, a.saleNo)).toMatchObject({ replay: true }); const b = s.sell(); const q2 = s.eta.enqueueSale(sys, b.saleNo); expect(q2.receipt!.previousUuid).toBe(q.receipt!.uuid);
  });
  it('a card sale uses the card payment code; a sale without an ETA item code cannot be built and is reported by the scan without blocking the others; missing delivery code is a config problem', () => {
    const s = prep(); const c = s.sell({ cashMinor: undefined, payments: [{ method: 'card', amountMinor: 5000, ref: 'A1' }] }); s.eta.enqueueSale(sys, c.saleNo); expect(JSON.parse((s.hub.db.prepare('SELECT payload FROM eta_receipts').get() as { payload: string }).payload).paymentMethod).toBe('V');
    const bad = prep({ eta: false }); const x = bad.sell(); expect(code(() => bad.eta.enqueueSale(sys, x.saleNo))).toBe('item-code'); expect(bad.eta.scan(sys)).toMatchObject({ queued: 0, problems: [{ ref: x.saleNo, kind: 'sale' }] });
    const d = prep(); const dl = d.sell({ cashMinor: 5000, delivery: { name: 'سارة', phone: '01112223334', address: 'عنوان', feeMinor: 1000 } }); expect(code(() => d.eta.enqueueSale(sys, dl.saleNo))).toBe('config');
    const ok = prep({ cfg: { deliveryItem: { internalCode: 'DLV', description: 'خدمة توصيل', itemType: 'EGS', itemCode: 'EG-123456789-DLV', unitType: 'EA' } } }); const dl2 = ok.sell({ cashMinor: 6000, delivery: { name: 'سارة', phone: '01112223334', address: 'عنوان', feeMinor: 1000 } }); ok.eta.enqueueSale(sys, dl2.saleNo); const doc = JSON.parse((ok.hub.db.prepare('SELECT payload FROM eta_receipts').get() as { payload: string }).payload); expect(doc.itemData).toHaveLength(2); expect(doc.totalAmount).toBe(60);
  });
  it('taxes from the configured resolver go on the line and the totals', () => {
    const s = prep({ cfg: { taxes: (_i, net) => [{ taxType: 'T1', subType: 'V009', rate: 14, amount: net * 0.14 / 100 }] } }); const a = s.sell(); s.eta.enqueueSale(sys, a.saleNo); const doc = JSON.parse((s.hub.db.prepare('SELECT payload FROM eta_receipts').get() as { payload: string }).payload);
    expect(doc.itemData[0]).toMatchObject({ netSale: 50, total: 57, taxableItems: [{ taxType: 'T1', amount: 7 }] }); expect(doc).toMatchObject({ totalAmount: 57, taxTotals: [{ taxType: 'T1', amount: 7 }] });
  });
  it('a return and a void become return receipts (type r) that point at the sale receipt; a sale voided before it was queued needs none; scan queues everything in time order', () => {
    const s = prep(); const a = s.sell(); const b = s.sell(); const c = s.sell(); s.sales.voidSale(mgr, c.saleNo, 'typo'); const r = s.ret.returnSale(ph, { key: key(), saleNo: a.saleNo, sessionId: s.sid, lines: [{ lineNo: 1, qty: 10, unitName: 'حبة' }], reasonCode: 'changed_mind', refund: { method: 'cash' } });
    s.eta.enqueueSale(sys, a.saleNo); expect(code(() => s.eta.enqueueReturn(sys, b.saleNo, 'R-000001'))).toBe('not-found'); const rr = s.eta.enqueueReturn(sys, a.saleNo, r.returnNo).receipt; expect(rr).toMatchObject({ kind: 'return', docType: 'r' }); const doc = JSON.parse((s.hub.db.prepare("SELECT payload FROM eta_receipts WHERE kind='return'").get() as { payload: string }).payload);
    expect(doc.documentType.receiptType).toBe('r'); expect(doc.header).toMatchObject({ referenceUUID: s.eta.receiptOf(owner, 'sale', a.saleNo)!.uuid, receiptNumber: r.returnNo, salesIssuedDateTime: '2026-12-01T10:00:00Z' }); expect(doc.itemData[0]).toMatchObject({ quantity: 10, totalSale: 25, unitType: 'EA' });
    expect(s.eta.enqueueSale(sys, c.saleNo)).toEqual({ receipt: null, replay: false }); const sc = s.eta.scan(sys); expect(sc).toEqual({ queued: 1, problems: [] }); expect(s.eta.queue(owner).map(q => q.kind).sort()).toEqual(['return', 'sale', 'sale']);
    const v = prep(); const x = v.sell(); v.eta.enqueueSale(sys, x.saleNo); v.sales.voidSale(mgr, x.saleNo, 'wrong'); const vr = v.eta.enqueueVoid(sys, x.saleNo).receipt!; expect(vr).toMatchObject({ kind: 'void', docType: 'r' }); expect(JSON.parse((v.hub.db.prepare("SELECT payload FROM eta_receipts WHERE kind='void'").get() as { payload: string }).payload).header.receiptNumber).toBe(`V-${x.saleNo}`);
    const p = prep(); const y = p.sell(); expect(code(() => p.eta.enqueueVoid(sys, y.saleNo))).toBe('state');
  });
  it('permissions: the ETA keys; receipts and attempts cannot be edited or deleted', () => {
    const s = prep(); const a = s.sell(); expect(code(() => s.eta.enqueueSale(cashier, a.saleNo))).toBe('forbidden'); expect(code(() => s.eta.alerts(cashier))).toBe('forbidden'); expect(code(() => s.eta.queue(ph))).toBe('forbidden'); s.eta.enqueueSale(mgr, a.saleNo);
    expect(() => s.hub.db.prepare("UPDATE eta_receipts SET payload='{}'").run()).toThrow(); expect(() => s.hub.db.prepare('DELETE FROM eta_receipts').run()).toThrow(); expect(() => s.hub.db.prepare("UPDATE eta_receipts SET uuid=?").run('x'.repeat(64))).toThrow();
  });
});

describe('submitting', () => {
  it('drain sends due receipts in order in one batch; accepted ones keep ETA\'s long id and are final; the log has every attempt', async () => {
    const s = prep(); const a = s.sell(); const b = s.sell(); s.eta.enqueueSale(sys, a.saleNo); s.eta.enqueueSale(sys, b.saleNo); const r = await s.eta.drain(sys); expect(r).toMatchObject({ sent: 2, accepted: 2, rejected: 0 }); expect(s.tr.batches[0]!.map(d => (d.header as { receiptNumber: string }).receiptNumber)).toEqual([a.saleNo, b.saleNo]);
    const q = s.eta.receiptOf(owner, 'sale', a.saleNo)!; expect(q).toMatchObject({ status: 'accepted', attempts: 1, submissionUuid: 'SUB1' }); expect(q.longId).toMatch(/^LONG-/); expect(s.eta.attempts(owner, q.id)).toMatchObject([{ outcome: 'accepted', httpStatus: 202 }]); expect(() => s.hub.db.prepare("UPDATE eta_receipts SET status='pending'").run()).toThrow(); expect(await s.eta.drain(sys)).toMatchObject({ sent: 0 });
  });
  it('a dead line keeps receipts pending and backs off 1, 2, 4 minutes; ETA\'s Retry-After wins; it works again when the line is back', async () => {
    const s = prep(); const a = s.sell(); s.eta.enqueueSale(sys, a.saleNo); s.tr.failWith = new EtaHttpError(0, 'Network', 'offline'); expect(await s.eta.drain(sys)).toMatchObject({ sent: 1, accepted: 0, error: 'Network: offline' }); let q = s.eta.receiptOf(owner, 'sale', a.saleNo)!; expect(q).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Network: offline' }); expect(q.nextAttemptAt).toBe('2026-12-01T10:01:00.000Z');
    expect(await s.eta.drain(sys)).toMatchObject({ sent: 0 }); clock.now = new Date('2026-12-01T10:02:00Z'); await s.eta.drain(sys); q = s.eta.receiptOf(owner, 'sale', a.saleNo)!; expect(q.attempts).toBe(2); expect(q.nextAttemptAt).toBe('2026-12-01T10:04:00.000Z');
    clock.now = new Date('2026-12-01T10:05:00Z'); s.tr.failWith = new EtaHttpError(422, 'DuplicateSubmission', 'same payload', 90); await s.eta.drain(sys); expect(s.eta.receiptOf(owner, 'sale', a.saleNo)!.nextAttemptAt).toBe('2026-12-01T10:06:30.000Z');
    s.tr.failWith = undefined; clock.now = new Date('2026-12-01T10:07:00Z'); expect(await s.eta.drain(sys)).toMatchObject({ accepted: 1 }); expect(s.eta.attempts(owner, s.eta.receiptOf(owner, 'sale', a.saleNo)!.id).map(x => x.outcome)).toEqual(['error', 'error', 'error', 'accepted']); clock.now = new Date('2026-12-01T10:00:00Z');
  });
  it('alerts: warning under 6 hours, critical under 1 hour, expired after 24 hours (no more automatic sending), rejected stays on the list', async () => {
    const s = prep(); const a = s.sell(); s.eta.enqueueSale(sys, a.saleNo); expect(s.eta.alerts(owner)).toEqual([]); clock.now = new Date('2026-12-02T05:00:00Z'); expect(s.eta.alerts(owner)).toMatchObject([{ level: 'warning', minutesLeft: 300 }]); clock.now = new Date('2026-12-02T09:30:00Z'); expect(s.eta.alerts(owner)).toMatchObject([{ level: 'critical', minutesLeft: 30 }]);
    clock.now = new Date('2026-12-02T10:01:00Z'); expect(await s.eta.drain(sys)).toMatchObject({ sent: 0, expired: 1 }); expect(s.eta.receiptOf(owner, 'sale', a.saleNo)).toMatchObject({ status: 'expired' }); expect(s.eta.alerts(owner)).toMatchObject([{ level: 'expired' }]); clock.now = new Date('2026-12-01T10:00:00Z');
  });
});

describe('rejected and expired receipts', () => {
  it('a rejection shows the reason; after the fix a corrected receipt takes the same place in the chain with a new UUID and referenceOldUUID; later receipts are untouched', async () => {
    const s = prep(); const a = s.sell(); const b = s.sell(); s.eta.enqueueSale(sys, a.saleNo); const qb = s.eta.enqueueSale(sys, b.saleNo).receipt!; s.tr.rejectNumbers.add(a.saleNo); expect(await s.eta.drain(sys)).toMatchObject({ accepted: 1, rejected: 1 });
    const bad = s.eta.receiptOf(owner, 'sale', a.saleNo)!; expect(bad).toMatchObject({ status: 'rejected', lastError: 'invalid item code (itemData[0].itemCode)' }); expect(s.eta.alerts(owner)).toMatchObject([{ level: 'rejected', ref: a.saleNo }]); expect(code(() => s.eta.resubmit(ph, bad.id, 'fixed'))).toBe('forbidden'); expect(code(() => s.eta.resubmit(sys, bad.id, ' '))).toBe('invalid');
    s.tr.rejectNumbers.clear(); const fixed = s.eta.resubmit(sys, bad.id, 'item code corrected'); expect(fixed).toMatchObject({ status: 'pending', previousUuid: bad.previousUuid, oldUuid: bad.uuid }); expect(fixed.uuid).not.toBe(bad.uuid); expect(JSON.parse((s.hub.db.prepare('SELECT payload FROM eta_receipts WHERE id=?').get(fixed.id) as { payload: string }).payload).header.referenceOldUUID).toBe(bad.uuid);
    expect(s.eta.receiptOf(owner, 'sale', a.saleNo)!.id).toBe(fixed.id); expect(s.eta.queue(owner, { status: 'replaced' })).toHaveLength(1); expect(s.eta.receiptOf(owner, 'sale', b.saleNo)!.uuid).toBe(qb.uuid); const c = s.sell(); expect(s.eta.enqueueSale(sys, c.saleNo).receipt!.previousUuid).toBe(qb.uuid); expect(await s.eta.drain(sys)).toMatchObject({ accepted: 2 });
    expect(code(() => s.eta.resubmit(sys, fixed.id, 'again'))).toBe('state');
  });
  it('an expired receipt needs the late-submit permission and is allowed up to 96 hours from issue', async () => {
    const s = prep(); const a = s.sell(); s.eta.enqueueSale(sys, a.saleNo); clock.now = new Date('2026-12-02T11:00:00Z'); await s.eta.drain(sys); const ex = s.eta.receiptOf(owner, 'sale', a.saleNo)!; expect(ex.status).toBe('expired');
    const noLate: Person = { id: 'x', roles: ['O'], denies: ['compliance.eta.late_submit'], branchIds: 'all' }; expect(code(() => s.eta.resubmit(noLate, ex.id, 'internet was down'))).toBe('forbidden'); const re = s.eta.resubmit(sys, ex.id, 'internet was down'); expect(re).toMatchObject({ status: 'pending', oldUuid: ex.uuid });
    expect(await s.eta.drain(sys)).toMatchObject({ accepted: 1 }); clock.now = new Date('2026-12-01T10:00:00Z'); const t = prep(); const b = t.sell(); t.eta.enqueueSale(sys, b.saleNo); clock.now = new Date('2026-12-02T11:00:00Z'); await t.eta.drain(sys); clock.now = new Date('2026-12-05T10:01:00Z'); expect(code(() => t.eta.resubmit(sys, t.eta.receiptOf(owner, 'sale', b.saleNo)!.id, 'late'))).toBe('window-closed'); clock.now = new Date('2026-12-01T10:00:00Z');
  });
});

describe('QR text and the HTTP transport', () => {
  it('the QR links to the receipt in the portal with total and registration number; none before the receipt exists', () => {
    const s = prep(); const a = s.sell(); expect(s.eta.qrText(a.saleNo)).toBeNull(); const q = s.eta.enqueueSale(sys, a.saleNo).receipt!; expect(s.eta.qrText(a.saleNo)).toBe(`https://invoicing.eta.gov.eg/receipts/search/${q.uuid}/share/2026-12-01T10:00:00Z#Total:50.000,IssuerRIN:123456789`);
  });
  it('POST /api/v1/receiptsubmissions: 202 with accepted and rejected documents; errors carry ETA\'s code and Retry-After; a dead connection is status 0', async () => {
    const calls: { url: string; init: RequestInit }[] = []; const fx = (res: () => Response | Promise<Response>) => (async (url: string, init: RequestInit) => { calls.push({ url, init }); return res(); }) as unknown as typeof fetch;
    const ok = new HttpEtaTransport('https://eta.example/', async () => ({ Authorization: 'Bearer t' }), undefined, fx(() => new Response(JSON.stringify({ submissionUUID: 'S1', acceptedDocuments: [{ uuid: 'u1', longId: 'L1', receiptNumber: 'S-1' }], rejectedDocuments: [{ uuid: 'u2', receiptNumber: 'S-2', error: { message: 'bad', propertyPath: 'x' } }] }), { status: 202 })));
    expect(await ok.submit([{ a: 1 }])).toEqual({ submissionUuid: 'S1', accepted: [{ uuid: 'u1', longId: 'L1', receiptNumber: 'S-1' }], rejected: [{ uuid: 'u2', receiptNumber: 'S-2', error: { message: 'bad', propertyPath: 'x' } }] }); expect(calls[0]!.url).toBe('https://eta.example/api/v1/receiptsubmissions'); expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ receipts: [{ a: 1 }] }); expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    const dup = new HttpEtaTransport('https://eta.example', async () => ({}), undefined, fx(() => new Response(JSON.stringify({ error: { code: 'DuplicateSubmission', message: 'again later' } }), { status: 422, headers: { 'Retry-After': '30' } }))); await expect(dup.submit([{}])).rejects.toMatchObject({ status: 422, code: 'DuplicateSubmission', retryAfterSec: 30 });
    const dead = new HttpEtaTransport('https://eta.example', async () => ({}), undefined, fx(() => { throw new Error('ECONNREFUSED'); })); await expect(dead.submit([{}])).rejects.toMatchObject({ status: 0, code: 'Network' });
    const signed = new HttpEtaTransport('https://eta.example', async () => ({}), async () => [{ signatureType: 'I', value: 'sig' }], fx(() => new Response('{}', { status: 202 }))); await signed.submit([{}]); expect(JSON.parse(String(calls[calls.length - 1]!.init.body)).signatures).toEqual([{ signatureType: 'I', value: 'sig' }]);
  });
});
