import { createHash } from 'node:crypto';
import { can, normalizeSearch, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { BatchError, parseExpiry, type BatchService } from './batches';
import { ItemError, type ItemInput, type ItemService } from './items';
import type { PurchasingService } from './purchasing';
import type { StockService } from './stock';

export type ImportErrorCode = 'forbidden' | 'invalid' | 'file';
export class ImportError extends Error { constructor(public code: ImportErrorCode, m: string) { super(m); } }
export type ImportKind = 'items' | 'stock' | 'suppliers';
export type ImportMode = 'all_or_nothing' | 'valid_only';
export interface RowIssue { line: number; message: string }
export interface ImportReport { importNo: string | null; kind: ImportKind; rows: number; created: number; skipped: number; failed: number; errors: RowIssue[]; warnings: RowIssue[]; replay: boolean; applied: boolean }

/** Column names a file may use for each field (canonical English plus the Arabic headers eStock prints). The first row of the file is the header. */
const ALIASES: Record<ImportKind, Record<string, string[]>> = {
  items: {
    code: ['code', 'كود الصنف', 'كود', 'الكود'], name_ar: ['name_ar', 'name', 'اسم الصنف', 'الاسم', 'اسم'], name_en: ['name_en', 'الاسم الانجليزي', 'الاسم الإنجليزي'],
    kind: ['kind', 'type', 'نوع الصنف', 'النوع'], form: ['form', 'الشكل الصيدلي', 'الشكل'], strength: ['strength', 'التركيز', 'الجرعة', 'الجرعات الدوائية'], ingredient: ['ingredient', 'المادة الفعالة', 'المادة الفعاله'],
    manufacturer: ['manufacturer', 'الشركة المنتجة', 'الشركة'], group: ['group', 'مجموعة الصنف', 'المجموعة'], location: ['location', 'مكان الصنف', 'المكان'], reorder_level: ['reorder_level', 'حد الطلب'],
    list_price: ['list_price', 'سعر البيع', 'السعر'], eta_code: ['eta_code', 'كود الضرائب', 'كود الصنف الضريبي'], eta_type: ['eta_type'], tax: ['tax', 'الضريبة'],
    unit_base: ['unit_base', 'الوحدة الصغرى', 'الوحدة الصغري', 'الوحدة'], unit_big: ['unit_big', 'الوحدة الكبرى', 'الوحدة الكبري'], factor: ['factor', 'معامل التحويل', 'المعامل'], barcode: ['barcode', 'الباركود', 'باركود'], barcode_unit: ['barcode_unit'],
  },
  stock: {
    item: ['item', 'code', 'item_code', 'كود الصنف', 'كود', 'barcode', 'الباركود'], item_name: ['item_name', 'name', 'اسم الصنف', 'الاسم'], lot: ['lot', 'batch', 'رقم التشغيلة', 'التشغيلة', 'الباتش'], expiry: ['expiry', 'exp', 'تاريخ الصلاحية', 'الصلاحية', 'تنتهي'],
    qty: ['qty', 'quantity', 'الكمية', 'الرصيد', 'عدد'], unit: ['unit', 'الوحدة'], cost: ['cost', 'التكلفة', 'سعر الشراء'], public_price: ['public_price', 'سعر الجمهور', 'سعر البيع', 'السعر'], pharmacist_price: ['pharmacist_price', 'سعر الصيدلي'], store: ['store', 'المخزن'],
  },
  suppliers: { name: ['name', 'اسم المورد', 'المورد', 'الاسم'], code: ['code', 'كود المورد', 'كود'], phone: ['phone', 'التليفون', 'الهاتف', 'تليفون', 'موبايل'], address: ['address', 'العنوان'], tax_no: ['tax_no', 'الرقم الضريبي'], notes: ['notes', 'ملاحظات'] },
};
const REQUIRED: Record<ImportKind, string[]> = { items: ['name_ar'], stock: ['item', 'lot', 'expiry', 'qty', 'cost'], suppliers: ['name'] };
export const TEMPLATES: Record<ImportKind, string> = {
  items: 'code,name_ar,name_en,kind,form,strength,ingredient,manufacturer,group,location,reorder_level,list_price,eta_code,unit_base,unit_big,factor,barcode',
  stock: 'item,lot,expiry,qty,unit,cost,public_price,pharmacist_price,store',
  suppliers: 'code,name,phone,address,tax_no,notes',
};

const DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٫': '.', '٬': ',' };
const ascii = (s: string) => s.replace(/[٠-٩۰-۹٫٬]/g, c => DIGITS[c] ?? c);

/** RFC 4180 CSV: quoted fields, doubled quotes, line breaks inside quotes, BOM; the delimiter (comma, semicolon or tab) is detected from the header line. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, ''); const head = t.split(/\r?\n/, 1)[0] ?? ''; const count = (c: string) => head.split(c).length - 1;
  const d = count('\t') > 0 && count('\t') >= count(',') && count('\t') >= count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], f = '', q = false, any = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; any = true; } else if (c === d) { row.push(f); f = ''; any = true; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (any || row.some(x => x.trim())) rows.push(row); row = []; f = ''; any = false; } else { f += c; any = true; }
  }
  if (any || f || row.length) { row.push(f); if (row.some(x => x.trim())) rows.push(row); }
  return rows;
}
/** "45", "45.5", "1,234.50", Arabic digits: whole piasters, no floating point. Null when unreadable or more than 2 decimals. */
export function parsePiasters(raw: string): number | null {
  let s = ascii(raw).replace(/\s|ج\.?م\.?|EGP/gi, ''); if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s); if (!m) return null; return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}
const wholeNumber = (raw: string): number | null => { const s = ascii(raw).trim().replace(/\.0+$/, ''); return /^\d+$/.test(s) ? Number(s) : null; };

/** Data import: files exported from eStock (or any CSV with the same headers) become items, opening stock and suppliers. Dry run first; every import is recorded and can be repeated safely (same file = same result). */
export class ImportService {
  constructor(private hub: Hub, private items: ItemService, private batches: BatchService, private stock: StockService, private buying: PurchasingService) {}
  private get db() { return this.hub.db; }
  private need(a: Person): void { if (!can(a, 'item.import', this.hub.branchId)) throw new ImportError('forbidden', 'missing permission item.import'); }
  template(kind: ImportKind): string { return TEMPLATES[kind]; }

  /** Maps the header row to canonical fields; returns rows as objects with their file line number. */
  private read(kind: ImportKind, csv: string): { rows: { line: number; v: Record<string, string> }[]; unknown: string[] } {
    const all = parseCsv(csv); if (all.length < 2) throw new ImportError('file', 'the file needs a header row and at least one data row');
    const al = ALIASES[kind]; const idx: Record<string, number> = {}; const unknown: string[] = [];
    all[0]!.forEach((h, i) => { const n = ascii(h).trim().toLowerCase().replace(/\s+/g, ' '); const f = Object.keys(al).find(k => al[k]!.some(a => a.toLowerCase() === n)); if (f && !(f in idx)) idx[f] = i; else if (n) unknown.push(h.trim()); });
    const miss = REQUIRED[kind].filter(k => !(k in idx)); if (miss.length) throw new ImportError('file', `missing column(s): ${miss.join(', ')}`);
    return { rows: all.slice(1).map((r, i) => ({ line: i + 2, v: Object.fromEntries(Object.entries(idx).map(([k, c]) => [k, (r[c] ?? '').trim()])) })), unknown };
  }
  private hash(kind: ImportKind, csv: string): string { return createHash('sha256').update(kind + '\n' + csv).digest('hex'); }

  /** Dry run: what an import would do, row by row. Writes nothing. */
  preview(actor: Person, kind: ImportKind, csv: string, o: ImportOptions = {}): ImportReport { this.need(actor); return this.db.tx(() => { const r = this.run(actor, kind, csv, { ...o, mode: o.mode ?? 'valid_only' }, true); return r; }); }
  /** Applies the file. `all_or_nothing` (default) writes nothing if any row is bad; `valid_only` writes the good rows and reports the rest. */
  apply(actor: Person, kind: ImportKind, csv: string, o: ImportOptions = {}): ImportReport { this.need(actor); return this.db.tx(() => this.run(actor, kind, csv, { ...o, mode: o.mode ?? 'all_or_nothing' }, false)); }
  history(actor: Person) { this.need(actor); return this.db.prepare('SELECT import_no, kind, source, mode, rows_total, created, skipped, failed, by, at FROM imports ORDER BY rowid DESC').all().map(r => ({ importNo: String(r.import_no), kind: String(r.kind), source: String(r.source), mode: String(r.mode), rows: Number(r.rows_total), created: Number(r.created), skipped: Number(r.skipped), failed: Number(r.failed), by: String(r.by), at: String(r.at) })); }
  /** eStock item code -> our item id (after an items import), so later files can refer to eStock codes. */
  itemByCode(code: string, source = 'estock'): string | null { const r = this.db.prepare("SELECT entity_id FROM import_refs WHERE source=? AND entity='item' AND source_code=?").get(source, code); return r ? String(r.entity_id) : null; }

  private run(actor: Person, kind: ImportKind, csv: string, o: Required<Pick<ImportOptions, 'mode'>> & ImportOptions, dry: boolean): ImportReport {
    const source = o.source ?? 'estock'; const hash = this.hash(kind, csv); const prior = this.db.prepare('SELECT * FROM imports WHERE kind=? AND file_hash=?').get(kind, hash);
    if (prior && !dry) { const rep = JSON.parse(String(prior.report)) as { errors: RowIssue[]; warnings: RowIssue[] }; return { importNo: String(prior.import_no), kind, rows: Number(prior.rows_total), created: Number(prior.created), skipped: Number(prior.skipped), failed: Number(prior.failed), errors: rep.errors, warnings: rep.warnings, replay: true, applied: true }; }
    const { rows, unknown } = this.read(kind, csv); const errors: RowIssue[] = [], warnings: RowIssue[] = unknown.map(u => ({ line: 1, message: `column ignored: ${u}` }));
    let created = 0, skipped = 0; const seen = new Set<string>(); const ctx = { expiredStore: null as string | null, stores: new Map<string, string>() };
    const savepoint = (fn: () => 'created' | 'skipped'): 'created' | 'skipped' | { error: string } => {
      this.db.exec('SAVEPOINT row');
      try { const r = fn(); this.db.exec('RELEASE row'); return r; }
      catch (e) { this.db.exec('ROLLBACK TO row'); this.db.exec('RELEASE row'); return { error: e instanceof Error ? e.message : String(e) }; }
    };
    this.db.exec('SAVEPOINT whole'); // a dry run, or an all-or-nothing import with a bad row, rolls everything back to here
    const no = dry ? null : this.nextNo(); const importId = uuidv7();
    const pendingRefs: { entity: 'item' | 'supplier'; code: string; id: string }[] = [];
    for (const r of rows) {
      const res = savepoint(() => { switch (kind) { case 'items': return this.itemRow(actor, r.v, o, source, seen, pendingRefs, warnings, r.line); case 'stock': return this.stockRow(actor, r.v, o, `${no ?? 'DRY'}:${r.line}`, ctx, warnings, r.line); default: return this.supplierRow(actor, r.v, seen, pendingRefs); } });
      if (typeof res === 'string') { if (res === 'created') created++; else skipped++; } else errors.push({ line: r.line, message: res.error });
    }
    const failed = errors.length; const bad = o.mode === 'all_or_nothing' && failed > 0;
    if (dry || bad) { this.db.exec('ROLLBACK TO whole'); this.db.exec('RELEASE whole'); return { importNo: null, kind, rows: rows.length, created: bad ? 0 : created, skipped, failed, errors, warnings, replay: false, applied: false }; }
    this.db.prepare('INSERT INTO imports(id,import_no,kind,source,file_hash,mode,rows_total,created,skipped,failed,report,by,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(importId, no, kind, source, hash, o.mode, rows.length, created, skipped, failed, JSON.stringify({ errors: errors.slice(0, 500), warnings: warnings.slice(0, 500) }), actor.id, this.hub.now());
    for (const p of pendingRefs) this.db.prepare('INSERT OR IGNORE INTO import_refs(source,entity,source_code,entity_id,import_id) VALUES(?,?,?,?,?)').run(source, p.entity, p.code, p.id, importId);
    this.hub.audit(actor.id, 'import.applied', 'import', no!, { kind, source, rows: rows.length, created, skipped, failed, mode: o.mode }); this.hub.emit('import.applied', { importNo: no, kind, created, skipped, failed });
    this.db.exec('RELEASE whole');
    return { importNo: no, kind, rows: rows.length, created, skipped, failed, errors, warnings, replay: false, applied: true };
  }
  private nextNo(): string { const n = Number(this.db.prepare("SELECT v FROM inv_counters WHERE k='import'").get()?.v ?? 0) + 1; this.db.prepare("INSERT INTO inv_counters(k,v) VALUES('import',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(n); return `IMP-${String(n).padStart(6, '0')}`; }

  private itemRow(actor: Person, v: Record<string, string>, o: ImportOptions, source: string, seen: Set<string>, refs: { entity: 'item' | 'supplier'; code: string; id: string }[], warn: RowIssue[], line: number): 'created' | 'skipped' {
    const nameAr = v.name_ar!; if (!nameAr) throw new Error('Arabic name is empty');
    const code = v.code ? ascii(v.code).trim() : ''; const key = code || normalizeSearch(nameAr); if (seen.has(key)) throw new Error(`repeated in this file (${code || nameAr})`); seen.add(key);
    if (code && (this.itemByCode(code, source) || this.items.getByCode(code))) { if (o.onExisting === 'error') throw new Error(`item ${code} already exists`); return 'skipped'; }
    const kindRaw = (v.kind ?? '').trim().toLowerCase(); const kind = kindRaw ? ({ drug: 'drug', دواء: 'drug', ادوية: 'drug', أدوية: 'drug', non_drug: 'non_drug', 'غير دواء': 'non_drug', 'غير ادوية': 'non_drug', 'غير أدوية': 'non_drug', مستلزمات: 'non_drug', service: 'service', خدمة: 'service', خدمات: 'service' } as Record<string, ItemInput['kind']>)[kindRaw] : o.defaultKind; if (!kind) throw new Error(kindRaw ? `unknown kind "${v.kind}"` : 'kind is empty (add a kind column or choose a default)');
    const baseName = v.unit_base || o.defaultUnitName; if (!baseName) throw new Error('base unit name is empty');
    const units: ItemInput['units'] = [{ name: baseName, factor: 1 }];
    if (v.unit_big) { const f = wholeNumber(v.factor ?? ''); if (f === null || f < 2) throw new Error('conversion factor must be a whole number of 2 or more'); units.push({ name: v.unit_big, factor: f }); }
    const input: ItemInput = { nameAr, kind, code: code || undefined, units };
    for (const [k, f] of [['name_en', 'nameEn'], ['form', 'form'], ['strength', 'strength'], ['ingredient', 'activeIngredient'], ['manufacturer', 'manufacturer'], ['location', 'location']] as const) if (v[k]) (input as unknown as Record<string, unknown>)[f] = v[k];
    if (v.reorder_level) { const n = wholeNumber(v.reorder_level); if (n === null) throw new Error('reorder level must be a whole number'); input.reorderLevel = n; }
    if (v.list_price) { const p = parsePiasters(v.list_price); if (p === null) throw new Error(`unreadable price "${v.list_price}"`); if (kind === 'drug') warn.push({ line, message: 'drug price ignored: the state price comes per batch (D14)' }); else input.listPriceMinor = p; }
    if (v.eta_code) { const t = (v.eta_type || (/^\d{8}$|^\d{12,14}$/.test(v.eta_code) ? 'GS1' : 'EGS')).toUpperCase(); if (t !== 'GS1' && t !== 'EGS') throw new Error(`unknown ETA code type ${v.eta_type}`); input.eta = { type: t, code: v.eta_code, tax: v.tax && /exempt|معف/i.test(v.tax) ? 'exempt' : 'taxable' }; }
    if (v.group) { const g = this.items.groups().find(x => normalizeSearch(x.name) === normalizeSearch(v.group!)) ?? this.items.createGroup(actor, v.group); input.groupId = g.id; }
    if (v.barcode) input.barcodes = [{ barcode: ascii(v.barcode).trim(), unitName: v.barcode_unit || undefined }];
    let item; try { item = this.items.create(actor, input); } catch (e) { if (e instanceof ItemError) throw new Error(e.message); throw e; }
    if (code) refs.push({ entity: 'item', code, id: item.id }); return 'created';
  }
  private findItem(ref: string, name: string, source: string): string {
    const r = ascii(ref).trim(); const hit = (r && (this.itemByCode(r, source) ?? this.items.getByCode(r)?.id)) || (r ? (this.db.prepare('SELECT item_id FROM item_barcodes WHERE barcode=?').get(r)?.item_id as string | undefined) : undefined);
    if (hit) return String(hit); const n = normalizeSearch(name || r); if (n) { const m = this.db.prepare("SELECT id FROM items WHERE search_text LIKE ? AND name_ar = ?").all(`%${n}%`, name || r); if (m.length === 1) return String(m[0]!.id); if (m.length > 1) throw new Error(`more than one item is named "${name || r}": use the item code`); }
    throw new Error(`item "${ref || name}" not found: import the items first`);
  }
  private stockRow(actor: Person, v: Record<string, string>, o: ImportOptions, tag: string, ctx: { expiredStore: string | null; stores: Map<string, string> }, warn: RowIssue[], line: number): 'created' | 'skipped' {
    const itemId = this.findItem(v.item!, v.item_name ?? '', o.source ?? 'estock'); const item = this.items.get(itemId)!; if (item.kind === 'service') throw new Error('a service holds no stock');
    const qty = wholeNumber(v.qty!); if (qty === null || qty === 0) { if (qty === 0) return 'skipped'; throw new Error(`quantity "${v.qty}" must be a whole number`); }
    const unitName = v.unit || (o.defaultUnit === 'base' ? item.units[0]!.name : o.defaultUnit === 'largest' ? item.units[item.units.length - 1]!.name : ''); if (!unitName) throw new Error('unit is empty (add a unit column or choose a default unit)');
    const cost = parsePiasters(v.cost!); if (cost === null) throw new Error(`unreadable cost "${v.cost}"`);
    const pub = v.public_price ? parsePiasters(v.public_price) : undefined; const ph = v.pharmacist_price ? parsePiasters(v.pharmacist_price) : undefined; if (pub === null || ph === null) throw new Error('unreadable price');
    if (item.kind === 'drug' && !pub) throw new Error('a drug batch needs the state public price (D14)');
    let expiry: string; try { expiry = parseExpiry(ascii(v.expiry!).replace(/\./g, '/').replace(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/, '$3-$2-$1')); } catch (e) { throw new Error(e instanceof BatchError ? e.message : 'unreadable expiry'); }
    let storeId = 'MAIN'; if (v.store) { const s = this.stock.stores().find(x => x.name === v.store || x.id === v.store); if (!s) throw new Error(`unknown store "${v.store}"`); storeId = s.id; }
    if (expiry < this.batches.today()) { if (!ctx.expiredStore) { const ex = this.stock.stores(true).find(x => x.kind === 'expired') ?? this.stock.createStore(actor, 'منتهي الصلاحية (مستورد)', 'expired'); ctx.expiredStore = ex.id; } storeId = ctx.expiredStore; warn.push({ line, message: 'expired lot: placed in the expired store, never sold' }); }
    try { this.batches.receive(actor, { key: `IMPORT:${tag}`, itemId, lot: v.lot!, expiry, qty, unitName, costMinor: cost, publicPriceMinor: pub ?? undefined, pharmacistPriceMinor: ph ?? undefined, priceUnitName: o.priceUnit === 'base' ? item.units[0]!.name : undefined, storeId, opening: true, sourceRef: 'import' }); } catch (e) { if (e instanceof BatchError) throw new Error(e.message); throw e; }
    return 'created';
  }
  private supplierRow(actor: Person, v: Record<string, string>, seen: Set<string>, refs: { entity: 'item' | 'supplier'; code: string; id: string }[]): 'created' | 'skipped' {
    const name = v.name!; if (!name) throw new Error('supplier name is empty'); const k = normalizeSearch(name); if (seen.has(k)) throw new Error(`repeated in this file (${name})`); seen.add(k);
    if (this.db.prepare('SELECT 1 FROM suppliers WHERE name=?').get(name)) return 'skipped';
    const s = this.buying.createSupplier(actor, { name, phone: v.phone || undefined, address: v.address || undefined, taxNo: v.tax_no || undefined, notes: v.notes || undefined }); if (v.code) refs.push({ entity: 'supplier', code: v.code, id: s.id }); return 'created';
  }
}
export interface ImportOptions { mode?: ImportMode; source?: string; onExisting?: 'skip' | 'error'; defaultKind?: ItemInput['kind']; defaultUnitName?: string; defaultUnit?: 'base' | 'largest'; priceUnit?: 'largest' | 'base' }
