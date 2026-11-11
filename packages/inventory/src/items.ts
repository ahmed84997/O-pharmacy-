import { can, normalizeSearch, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { gtin14, isValidGtin, looksLikeGs1, parseGs1, validateEtaCode, type EtaCodeType, type Gs1Data } from './codes';

export type ItemKind = 'drug' | 'non_drug' | 'service';
export type ItemStatus = 'active' | 'suspended' | 'archived';
export interface UnitInput { name: string; factor: number; sellable?: boolean; purchasable?: boolean }
export interface BarcodeInput { barcode: string; unitName?: string; kind?: 'gtin' | 'internal' | 'alias' }
export interface ItemInput {
  nameAr: string; nameEn?: string; kind: ItemKind; code?: string;
  form?: string; strength?: string; activeIngredient?: string; manufacturer?: string; groupId?: string; location?: string;
  reorderLevel?: number;
  /** Non-drug and service only (D20). Drug prices are fixed by the state and arrive per batch on the purchase invoice (D14). */
  listPriceMinor?: number;
  eta?: { type: EtaCodeType; code: string; tax?: 'taxable' | 'exempt' };
  /** Base unit first (factor 1, e.g. tablet), then larger ones (strip 10, box 30). */
  units: UnitInput[]; barcodes?: BarcodeInput[];
}
export type ItemPatch = Partial<Omit<ItemInput, 'kind' | 'units' | 'barcodes' | 'code' | 'eta' | 'listPriceMinor'>> & { eta?: ItemInput['eta'] | null; listPriceMinor?: number | null };
export interface Unit { id: string; itemId: string; name: string; factor: number; isBase: boolean; sellable: boolean; purchasable: boolean }
export interface Item {
  id: string; code: string; nameAr: string; nameEn: string | null; kind: ItemKind; form: string | null; strength: string | null; activeIngredient: string | null; manufacturer: string | null;
  groupId: string | null; location: string | null; reorderLevel: number; listPriceMinor: number | null; eta: { type: EtaCodeType; code: string; tax: 'taxable' | 'exempt' } | { type: null; code: null; tax: 'taxable' | 'exempt' };
  status: ItemStatus; createdAt: string; updatedAt: string; units: Unit[];
}
export type ItemErrorCode = 'forbidden' | 'invalid' | 'duplicate-barcode' | 'duplicate-code' | 'not-found' | 'reason-required' | 'same-status' | 'price-rule';
export class ItemError extends Error { constructor(public code: ItemErrorCode, m: string, public detail?: unknown) { super(m); } }

type Row = Record<string, unknown>;
const bool = (v: unknown) => Number(v) === 1;

export class ItemService {
  constructor(private hub: Hub, private cfg: { etaCodeRequired?: () => boolean } = {}) {}
  private get db() { return this.hub.db; }
  private need(actor: Person, perm: string): void { if (!can(actor, perm, this.hub.branchId)) throw new ItemError('forbidden', `missing permission ${perm}`); }

  // ---------- reads ----------
  private unitsOf(itemId: string): Unit[] {
    return this.db.prepare('SELECT * FROM item_units WHERE item_id=? ORDER BY factor').all(itemId).map(r => ({ id: String(r.id), itemId, name: String(r.name), factor: Number(r.factor), isBase: bool(r.is_base), sellable: bool(r.sellable), purchasable: bool(r.purchasable) }));
  }
  private toItem(r: Row): Item {
    const type = (r.eta_code_type as EtaCodeType | null) ?? null; const tax = r.eta_tax as 'taxable' | 'exempt';
    return { id: String(r.id), code: String(r.code), nameAr: String(r.name_ar), nameEn: (r.name_en as string | null) ?? null, kind: r.kind as ItemKind, form: (r.form as string | null) ?? null, strength: (r.strength as string | null) ?? null,
      activeIngredient: (r.active_ingredient as string | null) ?? null, manufacturer: (r.manufacturer as string | null) ?? null, groupId: (r.group_id as string | null) ?? null, location: (r.location as string | null) ?? null,
      reorderLevel: Number(r.reorder_level), listPriceMinor: r.list_price_minor === null ? null : Number(r.list_price_minor),
      eta: type ? { type, code: String(r.eta_code), tax } : { type: null, code: null, tax }, status: r.status as ItemStatus, createdAt: String(r.created_at), updatedAt: String(r.updated_at), units: this.unitsOf(String(r.id)) };
  }
  get(id: string): Item | null { const r = this.db.prepare('SELECT * FROM items WHERE id=?').get(id); return r ? this.toItem(r) : null; }
  getByCode(code: string): Item | null { const r = this.db.prepare('SELECT * FROM items WHERE code=?').get(code); return r ? this.toItem(r) : null; }
  barcodes(itemId: string): { barcode: string; unitName: string; kind: string; active: boolean }[] {
    return this.db.prepare('SELECT b.barcode, u.name unit, b.kind, b.active FROM item_barcodes b JOIN item_units u ON u.id=b.unit_id WHERE b.item_id=? ORDER BY b.created_at, b.barcode').all(itemId).map(r => ({ barcode: String(r.barcode), unitName: String(r.unit), kind: String(r.kind), active: bool(r.active) }));
  }
  statusLog(itemId: string): { from: string; to: string; by: string; at: string; reason: string }[] {
    return this.db.prepare('SELECT * FROM item_status_log WHERE item_id=? ORDER BY seq').all(itemId).map(r => ({ from: String(r.from_status), to: String(r.to_status), by: String(r.by), at: String(r.at), reason: String(r.reason) }));
  }

  /** Name, code, barcode and ingredient search; Arabic variants and digits are normalised. Archived items are hidden unless asked for. */
  search(q: string, o: { limit?: number; status?: ItemStatus[]; kind?: ItemKind } = {}): Item[] {
    const n = normalizeSearch(q); if (!n) return [];
    const st = o.status ?? ['active', 'suspended']; const args: unknown[] = [`%${n}%`, `${q.trim()}%`, `${n}%`];
    let sql = `SELECT DISTINCT i.* FROM items i LEFT JOIN item_barcodes b ON b.item_id = i.id AND b.active = 1 WHERE (i.search_text LIKE ? OR b.barcode LIKE ? OR i.code LIKE ?) AND i.status IN (${st.map(() => '?').join(',')})`; args.push(...st);
    if (o.kind) { sql += ' AND i.kind = ?'; args.push(o.kind); }
    sql += ' ORDER BY (i.search_text LIKE ?) DESC, i.name_ar LIMIT ?'; args.push(`${n}%`, o.limit ?? 25);
    return this.db.prepare(sql).all(...args).map(r => this.toItem(r));
  }

  /** What the cashier scan returns: the item, the unit that barcode stands for, and (for a Data Matrix) batch, expiry and serial. Inactive barcodes do not match. */
  findByBarcode(scan: string): { item: Item; unit: Unit; gs1?: Gs1Data } | null {
    let code = scan.trim(); let gs1: Gs1Data | undefined;
    if (looksLikeGs1(code)) { try { gs1 = parseGs1(code); code = gs1.gtin; } catch { return null; } }
    const candidates = gs1 ? [...new Set([gs1.gtin, gtin14(gs1.gtin), gs1.gtin.replace(/^0+/, '')])] : [code];
    for (const c of candidates) {
      const r = this.db.prepare('SELECT item_id, unit_id FROM item_barcodes WHERE barcode=? AND active=1').get(c) ?? (c.length === 14 ? this.db.prepare('SELECT item_id, unit_id FROM item_barcodes WHERE barcode=? AND active=1').get(c.slice(1)) : undefined);
      if (r) { const item = this.get(String(r.item_id))!; const unit = item.units.find(u => u.id === r.unit_id)!; return gs1 ? { item, unit, gs1 } : { item, unit }; }
    }
    return null;
  }

  /** Same active ingredient, strength and form, other items (the cashier's "alternatives"). */
  alternatives(itemId: string): Item[] {
    const it = this.get(itemId); if (!it?.activeIngredient) return [];
    return this.db.prepare("SELECT * FROM items WHERE id <> ? AND status = 'active' AND active_ingredient = ? AND IFNULL(strength,'') = IFNULL(?, '') AND IFNULL(form,'') = IFNULL(?, '') ORDER BY name_ar").all(itemId, it.activeIngredient, it.strength, it.form).map(r => this.toItem(r));
  }

  /** Groups are a simple list (never deleted). */
  createGroup(actor: Person, name: string): { id: string; name: string } {
    this.need(actor, 'item.update'); const n = name.trim(); if (!n) throw new ItemError('invalid', 'group name is required');
    const id = uuidv7();
    try { this.db.tx(() => { this.db.prepare('INSERT INTO item_groups(id,name,created_at) VALUES(?,?,?)').run(id, n, this.hub.now()); this.hub.audit(actor.id, 'item_group.created', 'item_group', id, { name: n }); this.hub.emit('item_group.created', { id, name: n }); }); }
    catch (e) { if (e instanceof Error && /UNIQUE/.test(e.message)) throw new ItemError('invalid', 'group already exists'); throw e; }
    return { id, name: n };
  }
  groups(): { id: string; name: string }[] { return this.db.prepare('SELECT id, name FROM item_groups ORDER BY name').all().map(r => ({ id: String(r.id), name: String(r.name) })); }

  /** Quantity in a unit to base units (the ledger always counts in base units). */
  toBase(item: Item, unitName: string, qty: number): number {
    const u = item.units.find(x => x.name === unitName); if (!u) throw new ItemError('invalid', `unknown unit ${unitName}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new ItemError('invalid', 'quantity must be a positive whole number'); return qty * u.factor;
  }

  // ---------- writes ----------
  private nextCode(): string {
    return this.db.tx(() => {
      const r = this.db.prepare("SELECT v FROM inv_counters WHERE k='item'").get(); const n = Number(r?.v ?? 0) + 1;
      this.db.prepare("INSERT INTO inv_counters(k,v) VALUES('item',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(n);
      return `I-${String(n).padStart(6, '0')}`;
    });
  }
  private searchText(i: { nameAr: string; nameEn?: string | null; activeIngredient?: string | null; manufacturer?: string | null; code: string; strength?: string | null }): string {
    return normalizeSearch([i.nameAr, i.nameEn, i.activeIngredient, i.strength, i.manufacturer, i.code].filter(Boolean).join(' '));
  }
  private checkEta(eta: ItemInput['eta'] | null | undefined): void {
    if (!eta) return; const e = validateEtaCode(eta.type, eta.code); if (e) throw new ItemError('invalid', e);
  }
  private checkPrice(kind: ItemKind, price: number | null | undefined, actor: Person): void {
    if (price === undefined || price === null) return;
    if (kind === 'drug') throw new ItemError('price-rule', 'a drug price is fixed by the state and comes with each purchase batch; it cannot be set on the item');
    if (!Number.isInteger(price) || price < 0) throw new ItemError('invalid', 'price must be a whole number of piasters');
    this.need(actor, 'item.price.set');
  }

  create(actor: Person, input: ItemInput): Item {
    this.need(actor, 'item.create');
    if (!input.nameAr?.trim()) throw new ItemError('invalid', 'Arabic name is required');
    if (input.reorderLevel !== undefined && (!Number.isInteger(input.reorderLevel) || input.reorderLevel < 0)) throw new ItemError('invalid', 'reorder level must be a whole number');
    this.checkPrice(input.kind, input.listPriceMinor, actor); this.checkEta(input.eta);
    if (this.cfg.etaCodeRequired?.() && !input.eta && input.kind !== 'service') throw new ItemError('invalid', 'ETA item code is required');
    const units = input.units ?? []; const base = units[0];
    if (!base || base.factor !== 1) throw new ItemError('invalid', 'the first unit must be the base unit with factor 1');
    if (units.some((u, i) => i > 0 && (!Number.isInteger(u.factor) || u.factor <= 1))) throw new ItemError('invalid', 'larger units need a whole factor above 1');
    if (new Set(units.map(u => u.name.trim())).size !== units.length || new Set(units.map(u => u.factor)).size !== units.length || units.some(u => !u.name.trim())) throw new ItemError('invalid', 'unit names and factors must be unique');
    const id = uuidv7(); const code = input.code?.trim() || this.nextCode(); const now = this.hub.now();
    try {
      return this.db.tx(() => {
        this.db.prepare('INSERT INTO items(id,code,name_ar,name_en,kind,form,strength,active_ingredient,manufacturer,group_id,location,reorder_level,list_price_minor,eta_code_type,eta_code,eta_tax,search_text,created_at,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, code, input.nameAr.trim(), input.nameEn?.trim() ?? null, input.kind, input.form ?? null, input.strength ?? null, input.activeIngredient ?? null, input.manufacturer ?? null, input.groupId ?? null, input.location ?? null, input.reorderLevel ?? 0, input.listPriceMinor ?? null, input.eta?.type ?? null, input.eta?.code ?? null, input.eta?.tax ?? 'taxable',
            this.searchText({ ...input, nameAr: input.nameAr.trim(), code }), now, actor.id, now);
        for (const [i, u] of units.entries()) this.db.prepare('INSERT INTO item_units(id,item_id,name,factor,is_base,sellable,purchasable) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), id, u.name.trim(), u.factor, i === 0 ? 1 : 0, u.sellable === false ? 0 : 1, u.purchasable === false ? 0 : 1);
        for (const b of input.barcodes ?? []) this.insertBarcode(actor.id, id, b);
        const item = this.get(id)!;
        this.hub.audit(actor.id, 'item.created', 'item', id, { code, kind: input.kind }); this.hub.emit('item.created', { item });
        return item;
      });
    } catch (e) { throw this.mapDb(e); }
  }

  update(actor: Person, id: string, patch: ItemPatch): Item {
    this.need(actor, 'item.update'); const cur = this.get(id); if (!cur) throw new ItemError('not-found', id);
    if (patch.listPriceMinor !== undefined) this.checkPrice(cur.kind, patch.listPriceMinor ?? undefined, actor);
    if (patch.listPriceMinor === null && cur.kind === 'drug') { /* clearing is a no-op for drugs */ }
    if (patch.eta !== undefined) this.checkEta(patch.eta);
    if (patch.nameAr !== undefined && !patch.nameAr.trim()) throw new ItemError('invalid', 'Arabic name is required');
    const m = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== 'eta' && k !== 'listPriceMinor')) } as Item & ItemPatch;
    const eta = patch.eta === undefined ? cur.eta : patch.eta ? { type: patch.eta.type, code: patch.eta.code, tax: patch.eta.tax ?? cur.eta.tax } : { type: null, code: null, tax: cur.eta.tax };
    const price = patch.listPriceMinor === undefined ? cur.listPriceMinor : patch.listPriceMinor;
    return this.db.tx(() => {
      this.db.prepare('UPDATE items SET name_ar=?,name_en=?,form=?,strength=?,active_ingredient=?,manufacturer=?,group_id=?,location=?,reorder_level=?,list_price_minor=?,eta_code_type=?,eta_code=?,eta_tax=?,search_text=?,updated_at=? WHERE id=?')
        .run(m.nameAr.trim(), m.nameEn ?? null, m.form ?? null, m.strength ?? null, m.activeIngredient ?? null, m.manufacturer ?? null, m.groupId ?? null, m.location ?? null, m.reorderLevel, price, eta.type, eta.code, eta.tax, this.searchText({ ...m, code: cur.code }), this.hub.now(), id);
      const item = this.get(id)!;
      const changed = Object.keys(patch).sort();
      this.hub.audit(actor.id, 'item.updated', 'item', id, { fields: changed, before: { price: cur.listPriceMinor, name: cur.nameAr }, after: { price: item.listPriceMinor, name: item.nameAr } }); this.hub.emit('item.updated', { item, fields: changed });
      return item;
    });
  }

  private insertBarcode(by: string, itemId: string, b: BarcodeInput): void {
    const code = b.barcode.trim(); const kind = b.kind ?? (/^\d{8}$|^\d{12,14}$/.test(code) ? 'gtin' : 'internal');
    if (!code || /\s/.test(code)) throw new ItemError('invalid', 'barcode cannot be empty or contain spaces');
    if (kind === 'gtin' && !isValidGtin(code)) throw new ItemError('invalid', `${code} is not a valid GTIN (check digit)`);
    const units = this.unitsOf(itemId); const unit = b.unitName ? units.find(u => u.name === b.unitName) : units[units.length - 1];
    if (!unit) throw new ItemError('invalid', `unknown unit ${b.unitName}`);
    const owner = this.db.prepare('SELECT item_id FROM item_barcodes WHERE barcode=?').get(code);
    if (owner) throw new ItemError('duplicate-barcode', `barcode ${code} already belongs to another item`, { itemId: owner.item_id });
    this.db.prepare('INSERT INTO item_barcodes(barcode,item_id,unit_id,kind,active,created_by,created_at) VALUES(?,?,?,?,1,?,?)').run(code, itemId, unit.id, kind, by, this.hub.now());
  }
  addBarcode(actor: Person, itemId: string, b: BarcodeInput): void {
    this.need(actor, 'item.barcode_alias.manage'); if (!this.get(itemId)) throw new ItemError('not-found', itemId);
    try { this.db.tx(() => { this.insertBarcode(actor.id, itemId, b); this.hub.audit(actor.id, 'item.barcode_added', 'item', itemId, { barcode: b.barcode.trim() }); this.hub.emit('item.barcode_added', { itemId, barcode: b.barcode.trim(), unitName: b.unitName ?? null }); }); } catch (e) { throw this.mapDb(e); }
  }
  /** Barcodes are never deleted: switching off keeps the history and the barcode stays reserved for its item. */
  setBarcodeActive(actor: Person, barcode: string, active: boolean): void {
    this.need(actor, 'item.barcode_alias.manage'); const r = this.db.prepare('SELECT item_id FROM item_barcodes WHERE barcode=?').get(barcode); if (!r) throw new ItemError('not-found', barcode);
    this.db.tx(() => { this.db.prepare('UPDATE item_barcodes SET active=? WHERE barcode=?').run(active ? 1 : 0, barcode); this.hub.audit(actor.id, 'item.barcode_active', 'item', String(r.item_id), { barcode, active }); this.hub.emit('item.barcode_active', { itemId: String(r.item_id), barcode, active }); });
  }
  /** A new larger unit (for example a box of 3 strips) can be added later; existing units never change. */
  addUnit(actor: Person, itemId: string, u: UnitInput): Item {
    this.need(actor, 'item.update'); const it = this.get(itemId); if (!it) throw new ItemError('not-found', itemId);
    if (!u.name.trim() || !Number.isInteger(u.factor) || u.factor <= 1) throw new ItemError('invalid', 'a new unit needs a name and a whole factor above 1');
    try { return this.db.tx(() => { this.db.prepare('INSERT INTO item_units(id,item_id,name,factor,is_base,sellable,purchasable) VALUES(?,?,?,?,0,?,?)').run(uuidv7(), itemId, u.name.trim(), u.factor, u.sellable === false ? 0 : 1, u.purchasable === false ? 0 : 1);
      const item = this.get(itemId)!; this.hub.audit(actor.id, 'item.unit_added', 'item', itemId, { unit: u.name, factor: u.factor }); this.hub.emit('item.unit_added', { itemId, unit: u.name, factor: u.factor }); return item; }); } catch (e) { throw this.mapDb(e); }
  }

  /** Suspend (cannot be sold or bought, still visible) / archive (hidden from staff, visible to management) / reactivate. Always with a reason (D13). */
  setStatus(actor: Person, itemId: string, to: ItemStatus, reason: string): Item {
    this.need(actor, to === 'archived' ? 'item.archive' : 'item.suspend'); const it = this.get(itemId); if (!it) throw new ItemError('not-found', itemId);
    if (!reason.trim()) throw new ItemError('reason-required', 'a reason is required'); if (it.status === to) throw new ItemError('same-status', `already ${to}`);
    return this.db.tx(() => {
      this.db.prepare('UPDATE items SET status=?, updated_at=? WHERE id=?').run(to, this.hub.now(), itemId);
      this.db.prepare('INSERT INTO item_status_log(item_id,from_status,to_status,by,at,reason) VALUES(?,?,?,?,?,?)').run(itemId, it.status, to, actor.id, this.hub.now(), reason.trim());
      this.hub.audit(actor.id, 'item.status_changed', 'item', itemId, { from: it.status, to, reason: reason.trim() }); this.hub.emit('item.status_changed', { itemId, from: it.status, to, reason: reason.trim() });
      return this.get(itemId)!;
    });
  }
  /** Management view of removed and suspended items (D13 "deleted items"). */
  inactive(actor: Person): Item[] { this.need(actor, 'deleted_items.view'); return this.db.prepare("SELECT * FROM items WHERE status <> 'active' ORDER BY updated_at DESC").all().map(r => this.toItem(r)); }
  restore(actor: Person, itemId: string, reason: string): Item { this.need(actor, 'deleted_items.restore'); const it = this.get(itemId); if (!it) throw new ItemError('not-found', itemId); if (it.status === 'active') throw new ItemError('same-status', 'already active');
    return this.setStatusUnchecked(actor, itemId, 'active', reason); }
  private setStatusUnchecked(actor: Person, itemId: string, to: ItemStatus, reason: string): Item {
    if (!reason.trim()) throw new ItemError('reason-required', 'a reason is required'); const it = this.get(itemId)!;
    return this.db.tx(() => { this.db.prepare('UPDATE items SET status=?, updated_at=? WHERE id=?').run(to, this.hub.now(), itemId); this.db.prepare('INSERT INTO item_status_log(item_id,from_status,to_status,by,at,reason) VALUES(?,?,?,?,?,?)').run(itemId, it.status, to, actor.id, this.hub.now(), reason.trim());
      this.hub.audit(actor.id, 'item.status_changed', 'item', itemId, { from: it.status, to, reason: reason.trim() }); this.hub.emit('item.status_changed', { itemId, from: it.status, to, reason: reason.trim() }); return this.get(itemId)!; });
  }

  private mapDb(e: unknown): unknown {
    if (e instanceof ItemError) return e; const m = e instanceof Error ? e.message : '';
    if (/UNIQUE constraint failed: items\.code/.test(m)) return new ItemError('duplicate-code', 'item code already used');
    if (/UNIQUE constraint failed: item_units/.test(m)) return new ItemError('invalid', 'unit name or factor already exists for this item');
    if (/CHECK constraint failed/.test(m)) return new ItemError('invalid', 'a value breaks an item rule');
    return e;
  }
}
