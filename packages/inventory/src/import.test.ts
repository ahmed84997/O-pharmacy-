import { describe, expect, it } from 'vitest';
import type { Person } from '@o-pharmacy/core';
import { Hub } from '@o-pharmacy/hub';
import { BatchService, ImportService, ItemService, MIGRATIONS, PurchasingService, StockService, parseCsv, parsePiasters } from './index';

const owner: Person = { id: 'owner', roles: ['O'], branchIds: 'all' };
const admin: Person = { id: 'ad', roles: ['A'], branchIds: 'all' };
const mgr: Person = { id: 'mg', roles: ['M'], branchIds: ['b1'] };
const setup = () => { const hub = Hub.open('b1', ':memory:', () => new Date('2026-12-01T10:00:00Z'), MIGRATIONS); const items = new ItemService(hub); const bs = new BatchService(hub, items, { today: () => '2026-12-01' }); const st = new StockService(hub, items, bs); const pu = new PurchasingService(hub, items, bs); return { hub, items, bs, st, pu, im: new ImportService(hub, items, bs, st, pu) }; };
const ITEMS = `كود الصنف,اسم الصنف,الشركة المنتجة,الشكل الصيدلي,مجموعة الصنف,الوحدة الصغرى,الوحدة الكبرى,معامل التحويل,باركود,نوع الصنف,سعر البيع
1001,باراسيتامول ٥٠٠ مجم,ايبيكو,اقراص,مسكنات,قرص,علبة,20,6221031234569,دواء,
1002,كريم ترطيب,نيفيا,كريم,تجميل,علبة,,,,غير دواء,"١٢٠٫٥٠"
1003,"اموكسيسيلين ""500""",ميدكو,كبسول,مضادات حيوية,كبسولة,علبة,16,,دواء,`;
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } return 'no error'; };

describe('parsing', () => {
  it('CSV: quotes, doubled quotes, line breaks in quotes, BOM, semicolon and tab delimiters, blank lines', () => {
    expect(parseCsv('﻿a,b\r\n1,"x,y"\r\n\r\n"he said ""hi""","l1\nl2"\n')).toEqual([['a', 'b'], ['1', 'x,y'], ['he said "hi"', 'l1\nl2']]); expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]); expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('money to whole piasters without floating point, Arabic digits, thousands separators; unreadable gives null', () => {
    expect([parsePiasters('45'), parsePiasters('45.5'), parsePiasters('1,234.50'), parsePiasters('١٢٠٫٥٠'), parsePiasters('12,5'), parsePiasters('0.07'), parsePiasters('45 ج.م')]).toEqual([4500, 4550, 123450, 12050, 1250, 7, 4500]);
    expect([parsePiasters(''), parsePiasters('abc'), parsePiasters('1.234'), parsePiasters('-5')]).toEqual([null, null, null, null]);
  });
});

describe('items import', () => {
  it('Arabic eStock headers map to fields; groups are created; Arabic digits and decimal comma work; refs to eStock codes are kept', () => {
    const s = setup(); const r = s.im.apply(owner, 'items', ITEMS); expect(r).toMatchObject({ importNo: 'IMP-000001', rows: 3, created: 3, failed: 0, applied: true, replay: false });
    const p = s.items.getByCode('1001')!; expect(p).toMatchObject({ nameAr: 'باراسيتامول ٥٠٠ مجم', kind: 'drug', manufacturer: 'ايبيكو', form: 'اقراص' }); expect(p.units.map(u => [u.name, u.factor])).toEqual([['قرص', 1], ['علبة', 20]]); expect(s.items.groups().map(g => g.name).sort()).toEqual(['تجميل', 'مسكنات', 'مضادات حيوية'].sort());
    expect(s.items.getByCode('1002')).toMatchObject({ kind: 'non_drug', listPriceMinor: 12050 }); expect(s.items.getByCode('1003')!.nameAr).toBe('اموكسيسيلين "500"'); expect(s.im.itemByCode('1001')).toBe(p.id); expect(s.items.search('باراسيتامول').length).toBe(1);
    expect(s.hub.auditEntries().some(a => a.action === 'import.applied')).toBe(true); expect(s.hub.verifyAudit()).toBeNull();
  });
  it('dry run writes nothing; the same file twice is the same import; existing items are skipped (or refused on request)', () => {
    const s = setup(); const pre = s.im.preview(owner, 'items', ITEMS); expect(pre).toMatchObject({ created: 3, applied: false, importNo: null }); expect(s.items.getByCode('1001')).toBeNull(); expect(s.im.history(owner)).toEqual([]); expect(s.items.groups()).toEqual([]);
    s.im.apply(owner, 'items', ITEMS); expect(s.im.apply(owner, 'items', ITEMS)).toMatchObject({ replay: true, importNo: 'IMP-000001', created: 3 }); expect(s.im.history(owner)).toHaveLength(1);
    const more = ITEMS + '\n1004,دواء جديد,,,,قرص,,,,دواء,'; const r2 = s.im.apply(owner, 'items', more); expect(r2).toMatchObject({ created: 1, skipped: 3, importNo: 'IMP-000002' }); expect(s.im.preview(owner, 'items', ITEMS + '\n1005,x,,,,قرص,,,,دواء,', { onExisting: 'error' }).errors).toHaveLength(3);
  });
  it('row problems are reported with the line number; all-or-nothing writes nothing, valid-only writes the good rows', () => {
    const s = setup(); const bad = `code,name_ar,kind,unit_base,unit_big,factor,barcode,list_price\nA1,جيد,drug,قرص,,,,\nA2,,drug,قرص,,,,\nA3,نوع غلط,weird,قرص,,,,\nA4,معامل,drug,قرص,علبة,1,,\nA5,باركود غلط,drug,قرص,,,12345678,\nA6,سعر,non_drug,قطعة,,,,abc\nA1,مكرر,drug,قرص,,,,`;
    const r = s.im.apply(owner, 'items', bad); expect(r).toMatchObject({ applied: false, created: 0, failed: 6 }); expect(r.errors.map(e => e.line)).toEqual([3, 4, 5, 6, 7, 8]); expect(s.items.getByCode('A1')).toBeNull(); expect(s.im.history(owner)).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/Arabic name/); expect(r.errors[2]!.message).toMatch(/factor/); expect(r.errors[3]!.message).toMatch(/GTIN|barcode/i); expect(r.errors[5]!.message).toMatch(/repeated/);
    const v = s.im.apply(owner, 'items', bad, { mode: 'valid_only' }); expect(v).toMatchObject({ applied: true, created: 1, failed: 6, importNo: 'IMP-000001' }); expect(s.items.getByCode('A1')).not.toBeNull(); expect(s.items.getByCode('A3')).toBeNull();
  });
  it('a drug price in the file is ignored with a warning (D14); defaults for kind and unit; bad file shapes and permissions', () => {
    const s = setup(); const r = s.im.apply(owner, 'items', 'name_ar,list_price\nدواء,50\nمنتج,75.5', { defaultKind: 'drug', defaultUnitName: 'علبة' }); expect(r.created).toBe(2); expect(r.warnings.some(w => /D14/.test(w.message))).toBe(true); expect(s.items.search('دواء')[0]!.listPriceMinor).toBeNull();
    expect(code(() => s.im.apply(owner, 'items', 'foo,bar\n1,2'))).toBe('file'); expect(code(() => s.im.apply(owner, 'items', 'name_ar'))).toBe('file'); expect(code(() => s.im.apply(mgr, 'items', ITEMS))).toBe('forbidden'); expect(code(() => s.im.preview(mgr, 'items', ITEMS))).toBe('forbidden');
    expect(s.im.template('stock')).toContain('expiry'); expect(s.im.apply(admin, 'items', 'name_ar,kind,unit_base\nأ,drug,قرص').created).toBe(1);
  });
  it('unknown columns are ignored with a warning', () => { const s = setup(); const r = s.im.apply(owner, 'items', 'name_ar,kind,unit_base,سعر غريب\nأ,drug,قرص,5'); expect(r.created).toBe(1); expect(r.warnings[0]).toMatchObject({ line: 1 }); });
});

describe('opening stock import', () => {
  const prep = () => { const s = setup(); s.im.apply(owner, 'items', ITEMS); return s; };
  const STOCK = `كود الصنف,رقم التشغيلة,تاريخ الصلاحية,الكمية,الوحدة,التكلفة,سعر الجمهور
1001,L1,06/2028,10,علبة,30,45.5
1001,L2,2027-03-15,5,علبة,30,45.5
1002,X,12/2029,7,علبة,50,
1003,OLD,01/2026,3,علبة,20,35`;
  it('creates batches and opening movements; expired lots go to an expired store; eStock codes find the items', () => {
    const s = prep(); const r = s.im.apply(owner, 'stock', STOCK); expect(r).toMatchObject({ created: 4, failed: 0, applied: true }); expect(r.warnings.some(w => /expired/.test(w.message))).toBe(true);
    const p = s.items.getByCode('1001')!; expect(s.st.onHand(p.id)).toBe(300); expect(s.st.onHand(p.id, { sellableOnly: true })).toBe(300); expect(s.bs.batches(owner, p.id).map(b => [b.lot, b.expiry, b.costMinor, b.publicPriceMinor])).toEqual([['L2', '2027-03-15', 3000, 4550], ['L1', '2028-06-30', 3000, 4550]]);
    const o = s.items.getByCode('1003')!; expect(s.st.onHand(o.id)).toBe(48); expect(s.st.onHand(o.id, { sellableOnly: true })).toBe(0); expect(s.st.stores().some(x => x.kind === 'expired')).toBe(true); expect(s.bs.allocate(o.id, 1).picks).toEqual([]);
    expect(s.st.card(owner, p.id).lines[0]).toMatchObject({ kind: 'opening', qty: 200 }); expect(s.hub.verifyAudit()).toBeNull(); expect(s.im.apply(owner, 'stock', STOCK)).toMatchObject({ replay: true, created: 4 }); expect(s.st.onHand(p.id)).toBe(300);
  });
  it('rows: missing state price for a drug, unknown item, bad expiry, bad quantity, no unit, price conflict; zero quantity skipped; all-or-nothing', () => {
    const s = prep(); const bad = `item,lot,expiry,qty,cost,public_price,unit\n1001,A,06/2028,1,30,,علبة\n9999,A,06/2028,1,30,40,علبة\n1001,B,13/2028,1,30,40,علبة\n1001,C,06/2028,x,30,40,علبة\n1001,D,06/2028,1,30,40,\n1001,E,06/2028,0,30,40,علبة\n1001,F,06/2028,1,30,40,علبة\n1001,F,06/2028,1,31,40,علبة`;
    const r = s.im.preview(owner, 'stock', bad); expect(r.errors.map(e => e.line)).toEqual([2, 3, 4, 5, 6, 9]); expect(r.skipped).toBe(1); expect(r.created).toBe(1); expect(r.errors[0]!.message).toMatch(/D14/); expect(r.errors[1]!.message).toMatch(/not found/);
    expect(s.im.apply(owner, 'stock', bad)).toMatchObject({ applied: false, created: 0 }); expect(s.st.onHand(s.items.getByCode('1001')!.id)).toBe(0); const v = s.im.apply(owner, 'stock', bad, { mode: 'valid_only' }); expect(v).toMatchObject({ applied: true, created: 1, failed: 6 }); expect(s.st.onHand(s.items.getByCode('1001')!.id)).toBe(20);
  });
  it('default unit option, price unit, matching by barcode or by exact name, store column', () => {
    const s = prep(); const w = s.st.createStore(owner, 'خلفي', 'warehouse'); const r = s.im.apply(owner, 'stock', `item,item_name,lot,expiry,qty,cost,public_price,store\n6221031234569,,A,2029-01-31,2,30,45,\n,كريم ترطيب,B,2029-01-31,3,10,,خلفي`, { defaultUnit: 'base' });
    expect(r).toMatchObject({ created: 2, failed: 0 }); expect(s.st.onHand(s.items.getByCode('1001')!.id)).toBe(2); expect(s.st.onHand(s.items.getByCode('1002')!.id, { storeId: w.id })).toBe(3);
    expect(s.im.preview(owner, 'stock', 'item,lot,expiry,qty,cost,public_price\n1001,Z,2029-01-31,1,30,45').errors[0]!.message).toMatch(/unit/);
  });
  it('stock import needs item.import (not purchase rights) and refuses a non-open store', () => { const s = prep(); expect(code(() => s.im.apply(mgr, 'stock', STOCK))).toBe('forbidden'); expect(s.im.preview(owner, 'stock', 'item,lot,expiry,qty,cost,public_price,unit,store\n1001,A,2029-01-31,1,30,45,علبة,nope').errors[0]!.message).toMatch(/unknown store/); });
});

describe('suppliers import and scale', () => {
  it('suppliers: created, existing skipped, duplicates in the file refused', () => {
    const s = setup(); const f = 'اسم المورد,التليفون,العنوان\nالمتحدة,0100,القاهرة\nالدلتا,,\nالمتحدة,1,x'; const r = s.im.apply(owner, 'suppliers', f, { mode: 'valid_only' }); expect(r).toMatchObject({ created: 2, failed: 1 }); expect(s.pu.suppliers(owner).map(x => x.name)).toEqual(['الدلتا', 'المتحدة']);
    expect(s.im.apply(owner, 'suppliers', 'name\nالمتحدة\nجديد')).toMatchObject({ created: 1, skipped: 1 });
  });
  it('3,000 items then 3,000 batches import in a reasonable time', () => {
    const s = setup(); const rows = Array.from({ length: 3000 }, (_, i) => `${5000 + i},صنف ${i},drug,قرص,علبة,10`); const t0 = performance.now(); const r = s.im.apply(owner, 'items', 'code,name_ar,kind,unit_base,unit_big,factor\n' + rows.join('\n')); const itemsMs = performance.now() - t0;
    const t1 = performance.now(); const st = s.im.apply(owner, 'stock', 'item,lot,expiry,qty,unit,cost,public_price\n' + Array.from({ length: 3000 }, (_, i) => `${5000 + i},L${i},2029-01-31,5,علبة,30,45`).join('\n')); const stockMs = performance.now() - t1;
    console.log(`import 3000 items ${itemsMs.toFixed(0)} ms, 3000 batches ${stockMs.toFixed(0)} ms`); expect(r.created).toBe(3000); expect(st.created).toBe(3000); expect(itemsMs).toBeLessThan(20000); expect(stockMs).toBeLessThan(20000);
  });
});
