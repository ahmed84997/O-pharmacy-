import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { normalizeSearch } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { ItemError, ItemService, MIGRATIONS, gs1Date, gtin14, gtinCheckDigit, isValidGtin, looksLikeGs1, parseGs1, validateEtaCode, type ItemInput } from './index';

const gtin = (body: string) => body + gtinCheckDigit(body);
const G1 = gtin('622123456789'), G2 = gtin('622987654321'), G3 = gtin('622555555555');
const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const pharm: Person = { id: 'ph', roles: ['P'], branchIds: ['b1'] };
const cashier: Person = { id: 'cs', roles: ['C'], branchIds: ['b1'] };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const setup = (cfg: ConstructorParameters<typeof ItemService>[1] = {}) => { const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), MIGRATIONS); return { hub, svc: new ItemService(hub, cfg) }; };
const tab = (o: Partial<ItemInput> = {}): ItemInput => ({ nameAr: 'باراسيتامول 500 مجم أقراص', nameEn: 'Paracetamol 500 mg tablets', kind: 'drug', form: 'tablet', strength: '500mg', activeIngredient: 'paracetamol', units: [{ name: 'حبة', factor: 1 }, { name: 'شريط', factor: 10 }, { name: 'علبة', factor: 20 }], ...o });
const code = (e: unknown) => (e as ItemError).code;
const fails = (f: () => unknown) => { try { f(); } catch (e) { return code(e) ?? (e as Error).message; } return 'no error'; };

describe('GTIN and GS1', () => {
  it('check digits for EAN-8/12/13/14', () => {
    expect(isValidGtin('6291041500213')).toBe(true); expect(isValidGtin('6291041500214')).toBe(false); expect(isValidGtin('96385074')).toBe(true); expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('abc')).toBe(false); expect(isValidGtin('12345')).toBe(false); expect(isValidGtin(gtin14(G1))).toBe(true); expect(gtin14(G1)).toHaveLength(14);
  });
  it('parses a Data Matrix: GTIN, batch, expiry (day 00 = end of month), serial', () => {
    const g = '01' + gtin14(G1) + '17271200' + '10AB12' + '\x1d' + '21XYZ789';
    expect(parseGs1(g)).toEqual({ gtin: gtin14(G1), expiry: '2027-12-31', batch: 'AB12', serial: 'XYZ789' });
    expect(parseGs1(']d2' + '01' + gtin14(G1) + '17270630' + '10B1')).toMatchObject({ expiry: '2027-06-30', batch: 'B1' });
    expect(looksLikeGs1(g)).toBe(true); expect(looksLikeGs1(G1)).toBe(false);
  });
  it('rejects bad codes, bad dates and unknown AIs', () => {
    expect(() => parseGs1('99abc')).toThrow(/unsupported/); expect(() => parseGs1('0161234567890128' + '17271300')).toThrow(); expect(() => parseGs1('01' + '00000000000000')).toThrow();
    expect(() => parseGs1('10ABC')).toThrow(/GTIN/); expect(gs1Date('280200')).toBe('2028-02-29'); expect(() => gs1Date('270231')).toThrow();
  });
  it('ETA codes: GS1 must be a valid GTIN, EGS needs the EG-RIN-code shape', () => {
    expect(validateEtaCode('GS1', G1)).toBeNull(); expect(validateEtaCode('GS1', '123')).not.toBeNull();
    expect(validateEtaCode('EGS', 'EG-123456789-ITEM001')).toBeNull(); expect(validateEtaCode('EGS', 'EG-12-X')).not.toBeNull(); expect(validateEtaCode('EGS', 'ITEM001')).not.toBeNull();
  });
});

describe('Arabic search normalisation', () => {
  it('folds alef, ya, ta marbuta, tashkeel, tatweel, case and digits', () => {
    expect(normalizeSearch('أموكسيسيلّين')).toBe(normalizeSearch('اموكسيسيلين')); expect(normalizeSearch('إبوبروفين')).toBe('ابوبروفين');
    expect(normalizeSearch('كبسولة')).toBe(normalizeSearch('كبسوله')); expect(normalizeSearch('مستشفى')).toBe(normalizeSearch('مستشفي'));
    expect(normalizeSearch('باراسيتامول ٥٠٠')).toBe('باراسيتامول 500'); expect(normalizeSearch('PANADOL  Extra')).toBe('panadol extra');
  });
});

describe('creating items', () => {
  it('creates a drug with units, barcodes, ETA code; writes audit + outbox in the same transaction', () => {
    const { hub, svc } = setup();
    const it = svc.create(owner, tab({ eta: { type: 'GS1', code: G1, tax: 'exempt' }, barcodes: [{ barcode: G1, unitName: 'علبة' }, { barcode: G2, unitName: 'شريط' }, { barcode: 'IN-001', kind: 'internal' }] }));
    expect(it.code).toBe('I-000001'); expect(it.units.map(u => [u.name, u.factor, u.isBase])).toEqual([['حبة', 1, true], ['شريط', 10, false], ['علبة', 20, false]]);
    expect(it.eta).toEqual({ type: 'GS1', code: G1, tax: 'exempt' }); expect(it.listPriceMinor).toBeNull();
    expect(svc.barcodes(it.id).map(b => [b.barcode, b.unitName, b.kind])).toEqual(expect.arrayContaining([[G1, 'علبة', 'gtin'], [G2, 'شريط', 'gtin'], ['IN-001', 'علبة', 'internal']]));
    expect(hub.auditEntries().at(-1)).toMatchObject({ action: 'item.created', actor: 'owner' }); expect(hub.outboxPending().at(-1)).toMatchObject({ type: 'item.created' }); expect(hub.verifyAudit()).toBeNull();
    expect(svc.create(owner, tab({ nameAr: 'ايبوبروفين' })).code).toBe('I-000002');
  });
  it('quantity conversion to base units', () => { const { svc } = setup(); const it = svc.create(owner, tab()); expect(svc.toBase(it, 'علبة', 3)).toBe(60); expect(svc.toBase(it, 'حبة', 7)).toBe(7); expect(fails(() => svc.toBase(it, 'كرتونة', 1))).toBe('invalid'); expect(fails(() => svc.toBase(it, 'علبة', 1.5))).toBe('invalid'); });
  it('unit rules: base first with factor 1, whole larger factors, unique names and factors', () => {
    const { svc } = setup();
    for (const units of [[], [{ name: 'علبة', factor: 10 }], [{ name: 'حبة', factor: 1 }, { name: 'شريط', factor: 1 }], [{ name: 'حبة', factor: 1 }, { name: 'شريط', factor: 2.5 }], [{ name: 'حبة', factor: 1 }, { name: 'حبة', factor: 10 }], [{ name: 'حبة', factor: 1 }, { name: 'a', factor: 10 }, { name: 'b', factor: 10 }]])
      expect(fails(() => svc.create(owner, tab({ units }))), JSON.stringify(units)).toBe('invalid');
  });
  it('drug price is never set on the item (D14); non-drug has a free price (D20) that needs item.price.set', () => {
    const { svc } = setup();
    expect(fails(() => svc.create(owner, tab({ listPriceMinor: 1000 })))).toBe('price-rule');
    const nd = svc.create(owner, { nameAr: 'كريم مرطب', kind: 'non_drug', listPriceMinor: 8550, units: [{ name: 'عبوة', factor: 1 }] }); expect(nd.listPriceMinor).toBe(8550);
    expect(fails(() => svc.create(pharm, { nameAr: 'شامبو', kind: 'non_drug', listPriceMinor: 5000, units: [{ name: 'عبوة', factor: 1 }] }))).toBe('forbidden'); // pharmacist: price.set is optional, off by default
    expect(svc.create(pharm, { nameAr: 'شامبو', kind: 'non_drug', units: [{ name: 'عبوة', factor: 1 }] }).listPriceMinor).toBeNull();
    expect(fails(() => svc.update(owner, nd.id, { listPriceMinor: -5 }))).toBe('invalid');
    expect(svc.update(mgr, nd.id, { listPriceMinor: 9000 }).listPriceMinor).toBe(9000);
    const drug = svc.create(owner, tab()); expect(fails(() => svc.update(owner, drug.id, { listPriceMinor: 100 }))).toBe('price-rule');
  });
  it('database constraints back the same rules (drug price, kind never changes, no deletes)', () => {
    const { hub, svc } = setup(); const grp = svc.createGroup(owner, 'مسكنات'); expect(fails(() => svc.createGroup(owner, 'مسكنات'))).toBe('invalid'); expect(svc.groups()).toHaveLength(1); const d = svc.create(owner, tab({ groupId: grp.id, barcodes: [{ barcode: G1 }] })); svc.setStatus(owner, d.id, 'suspended', 'test'); const nd = svc.create(owner, { nameAr: 'x', kind: 'non_drug', units: [{ name: 'u', factor: 1 }] });
    expect(() => hub.db.exec(`UPDATE items SET list_price_minor=100 WHERE id='${d.id}'`)).toThrow();
    expect(() => hub.db.exec(`UPDATE items SET kind='drug' WHERE id='${nd.id}'`)).toThrow(/kind never changes/);
    for (const sql of ['DELETE FROM items', 'DELETE FROM item_units', 'DELETE FROM item_barcodes', 'DELETE FROM item_status_log', 'DELETE FROM item_groups', "UPDATE item_units SET factor=99", "UPDATE item_status_log SET reason='x'"]) expect(() => hub.db.exec(sql), sql).toThrow();
  });
  it('permissions: cashier cannot create; pharmacist can (D23 matrix)', () => { const { svc } = setup(); expect(fails(() => svc.create(cashier, tab()))).toBe('forbidden'); expect(svc.create(pharm, tab()).status).toBe('active'); });
  it('validation: Arabic name, reorder level, ETA code format and the "ETA required" switch', () => {
    const { svc } = setup({ etaCodeRequired: () => true });
    expect(fails(() => svc.create(owner, tab({ nameAr: ' ' })))).toBe('invalid'); expect(fails(() => svc.create(owner, tab({ reorderLevel: -1 })))).toBe('invalid');
    expect(fails(() => svc.create(owner, tab({ eta: { type: 'GS1', code: '123' } })))).toBe('invalid'); expect(fails(() => svc.create(owner, tab()))).toBe('invalid');
    expect(svc.create(owner, tab({ eta: { type: 'EGS', code: 'EG-123456789-PARA500' } })).eta.type).toBe('EGS');
    expect(svc.create(owner, { nameAr: 'خدمة قياس ضغط', kind: 'service', units: [{ name: 'مرة', factor: 1 }] }).kind).toBe('service');
  });
  it('a failed creation leaves nothing behind (item, units, barcodes, audit, outbox together)', () => {
    const { hub, svc } = setup(); svc.create(owner, tab({ barcodes: [{ barcode: G1 }] }));
    const before = { audit: hub.auditEntries().length, outbox: hub.outboxPending().length, items: svc.search('باراسيتامول').length };
    expect(fails(() => svc.create(owner, tab({ nameAr: 'مكرر', barcodes: [{ barcode: G2 }, { barcode: G1 }] })))).toBe('duplicate-barcode');
    expect({ audit: hub.auditEntries().length, outbox: hub.outboxPending().length, items: svc.search('باراسيتامول').length }).toEqual(before); expect(svc.search('مكرر')).toHaveLength(0); expect(svc.findByBarcode(G2)).toBeNull();
    expect(svc.getByCode('I-000002')).toBeNull();
  });
  it('duplicate codes are refused', () => { const { svc } = setup(); svc.create(owner, tab({ code: 'PARA-1' })); expect(fails(() => svc.create(owner, tab({ code: 'PARA-1', nameAr: 'تاني' })))).toBe('duplicate-code'); });
});

describe('barcodes and scanning', () => {
  it('a barcode belongs to exactly one item; inactive barcodes stop matching but stay reserved', () => {
    const { svc } = setup(); const a = svc.create(owner, tab({ barcodes: [{ barcode: G1, unitName: 'علبة' }] })); const b = svc.create(owner, tab({ nameAr: 'تاني' }));
    expect(fails(() => svc.addBarcode(owner, b.id, { barcode: G1 }))).toBe('duplicate-barcode');
    expect(svc.findByBarcode(G1)).toMatchObject({ item: { id: a.id }, unit: { name: 'علبة', factor: 20 } });
    svc.setBarcodeActive(owner, G1, false); expect(svc.findByBarcode(G1)).toBeNull(); expect(fails(() => svc.addBarcode(owner, b.id, { barcode: G1 }))).toBe('duplicate-barcode');
    svc.setBarcodeActive(owner, G1, true); expect(svc.findByBarcode(G1)?.item.id).toBe(a.id);
  });
  it('GTIN barcodes are check-digit validated; spaces refused; cashier cannot manage barcodes', () => {
    const { svc } = setup(); const a = svc.create(owner, tab());
    expect(fails(() => svc.addBarcode(owner, a.id, { barcode: '6221234567890', kind: 'gtin' }))).toBe('invalid'); expect(fails(() => svc.addBarcode(owner, a.id, { barcode: 'A B' }))).toBe('invalid');
    expect(fails(() => svc.addBarcode(cashier, a.id, { barcode: G3 }))).toBe('forbidden'); svc.addBarcode(pharm, a.id, { barcode: G3, unitName: 'شريط' }); expect(svc.findByBarcode(G3)?.unit.name).toBe('شريط');
  });
  it('scanning a Data Matrix finds the item by GTIN (any zero padding) and returns batch, expiry, serial', () => {
    const { svc } = setup(); const a = svc.create(owner, tab({ barcodes: [{ barcode: G1, unitName: 'علبة' }] }));
    const r = svc.findByBarcode('01' + gtin14(G1) + '17271200' + '10LOT77' + '\x1d' + '21S1'); expect(r?.item.id).toBe(a.id); expect(r?.gs1).toMatchObject({ batch: 'LOT77', expiry: '2027-12-31', serial: 'S1' });
    expect(svc.findByBarcode('01' + gtin14(G2) + '17271200')).toBeNull(); expect(svc.findByBarcode('0199abc')).toBeNull();
    const a14 = svc.create(owner, tab({ nameAr: 'ب', barcodes: [{ barcode: gtin14(G3), unitName: 'علبة', kind: 'gtin' }] })); expect(svc.findByBarcode('01' + gtin14(G3) + '17271200')?.item.id).toBe(a14.id);
  });
  it('a unit added later keeps old units unchanged', () => {
    const { svc } = setup(); const a = svc.create(owner, tab()); const b = svc.addUnit(owner, a.id, { name: 'كرتونة', factor: 240 });
    expect(b.units.map(u => u.factor)).toEqual([1, 10, 20, 240]); expect(fails(() => svc.addUnit(owner, a.id, { name: 'علبة', factor: 99 }))).toBe('invalid'); expect(fails(() => svc.addUnit(owner, a.id, { name: 'z', factor: 20 }))).toBe('invalid');
  });
});

describe('search and alternatives', () => {
  it('finds by Arabic with variants, English, ingredient, code, partial barcode; hides archived', () => {
    const { svc } = setup(); const a = svc.create(owner, tab({ barcodes: [{ barcode: G1 }] }));
    svc.create(owner, { nameAr: 'أموكسيسيلين 500 كبسولة', nameEn: 'Amoxicillin', kind: 'drug', activeIngredient: 'amoxicillin', units: [{ name: 'كبسولة', factor: 1 }] });
    expect(svc.search('اموكسيسيلين').map(i => i.nameAr)).toEqual(['أموكسيسيلين 500 كبسولة']); expect(svc.search('PARACETAMOL')[0]!.id).toBe(a.id); expect(svc.search('باراسيتامول ٥٠٠')[0]!.id).toBe(a.id);
    expect(svc.search(G1.slice(0, 7))[0]!.id).toBe(a.id); expect(svc.search('I-000001')[0]!.id).toBe(a.id); expect(svc.search('   ')).toEqual([]); expect(svc.search('zzzz')).toEqual([]);
    svc.setStatus(owner, a.id, 'archived', 'discontinued'); expect(svc.search('باراسيتامول')).toHaveLength(0); expect(svc.search('باراسيتامول', { status: ['archived'] })).toHaveLength(1);
  });
  it('alternatives share ingredient, strength and form', () => {
    const { svc } = setup(); const a = svc.create(owner, tab()); const b = svc.create(owner, tab({ nameAr: 'بنادول 500', nameEn: 'Panadol 500' })); svc.create(owner, tab({ nameAr: 'بنادول 1000', strength: '1000mg' })); svc.create(owner, tab({ nameAr: 'بنادول شراب', form: 'syrup' }));
    expect(svc.alternatives(a.id).map(i => i.id)).toEqual([b.id]); expect(svc.alternatives(svc.create(owner, { nameAr: 'كريم', kind: 'non_drug', units: [{ name: 'u', factor: 1 }] }).id)).toEqual([]);
  });
});

describe('No-Delete: suspend, archive, restore', () => {
  it('needs a reason, logs who/when/why, hides from staff screens, visible to management, restore keeps history', () => {
    const { hub, svc } = setup(); const a = svc.create(owner, tab());
    expect(fails(() => svc.setStatus(owner, a.id, 'suspended', ' '))).toBe('reason-required'); expect(fails(() => svc.setStatus(cashier, a.id, 'suspended', 'x'))).toBe('forbidden');
    expect(fails(() => svc.setStatus(pharm, a.id, 'suspended', 'x'))).toBe('forbidden'); // suspend and archive are optional for the pharmacist (off by default)
    expect(svc.setStatus(mgr, a.id, 'suspended', 'recalled batch').status).toBe('suspended'); expect(fails(() => svc.setStatus(mgr, a.id, 'suspended', 'again'))).toBe('same-status');
    svc.setStatus(mgr, a.id, 'archived', 'discontinued'); expect(fails(() => svc.inactive(pharm))).toBe('forbidden'); expect(svc.inactive(mgr).map(i => i.id)).toEqual([a.id]);
    expect(fails(() => svc.restore(mgr, a.id, 'x'))).toBe('forbidden'); expect(svc.restore(owner, a.id, 'back in stock list').status).toBe('active');
    expect(svc.statusLog(a.id).map(l => [l.from, l.to, l.by])).toEqual([['active', 'suspended', 'mg'], ['suspended', 'archived', 'mg'], ['archived', 'active', 'owner']]);
    expect(hub.auditEntries().filter(e => e.action === 'item.status_changed')).toHaveLength(3); expect(hub.verifyAudit()).toBeNull();
  });
});

describe('update', () => {
  it('updates fields, refreshes search text, audits changes, and clears or replaces the ETA code', () => {
    const { hub, svc } = setup(); const a = svc.create(owner, tab());
    const u = svc.update(mgr, a.id, { nameAr: 'بانادول ٥٠٠', manufacturer: 'GSK', reorderLevel: 12, eta: { type: 'EGS', code: 'EG-123456789-PAN500', tax: 'exempt' } });
    expect(u).toMatchObject({ nameAr: 'بانادول ٥٠٠', manufacturer: 'GSK', reorderLevel: 12, eta: { type: 'EGS', tax: 'exempt' } }); expect(svc.search('بانادول 500')[0]!.id).toBe(a.id); expect(svc.search('gsk')[0]!.id).toBe(a.id);
    expect(svc.update(mgr, a.id, { eta: null }).eta).toMatchObject({ type: null, code: null, tax: 'exempt' });
    expect(hub.auditEntries().at(-1)).toMatchObject({ action: 'item.updated', actor: 'mg' }); expect(fails(() => svc.update(cashier, a.id, { reorderLevel: 1 }))).toBe('forbidden'); expect(fails(() => svc.update(owner, 'nope', {}))).toBe('not-found');
    expect(fails(() => svc.update(owner, a.id, { nameAr: ' ' }))).toBe('invalid'); expect(fails(() => svc.update(owner, a.id, { eta: { type: 'GS1', code: '1' } }))).toBe('invalid');
  });
});

describe('scale: 25,000 items', () => {
  it('search by name and barcode stays fast', () => {
    const { hub, svc } = setup(); const t0 = Date.now();
    hub.db.tx(() => { for (let i = 0; i < 25000; i++) { const id = 'x' + i; hub.db.prepare("INSERT INTO items(id,code,name_ar,kind,search_text,created_at,created_by,updated_at) VALUES(?,?,?,'drug',?,'t','u','t')").run(id, 'C' + i, 'صنف ' + i, normalizeSearch('صنف ' + i)); hub.db.prepare('INSERT INTO item_units(id,item_id,name,factor,is_base) VALUES(?,?,?,1,1)').run('u' + i, id, 'حبة'); hub.db.prepare("INSERT INTO item_barcodes(barcode,item_id,unit_id,kind,created_by,created_at) VALUES(?,?,?,'internal','u','t')").run('B' + i, id, 'u' + i); } });
    const seed = Date.now() - t0; const t1 = performance.now(); for (let i = 0; i < 50; i++) { svc.search('صنف 2' + i); svc.findByBarcode('B' + (i * 400)); } const per = (performance.now() - t1) / 100;
    console.log(`25k items: seed ${seed} ms, avg lookup ${per.toFixed(2)} ms`); expect(per).toBeLessThan(40);
  });
});
