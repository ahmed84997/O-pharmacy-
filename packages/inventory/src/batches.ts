import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { type Item, type ItemService, type Unit } from './items';

/** Money rule: prices and costs are whole piasters per PRICE UNIT (usually the retail pack). A line amount rounds half up to a piaster, once per batch pick. */
export const amountFor = (qtyBase: number, pricePerUnitMinor: number, unitFactor: number): number => Math.floor((qtyBase * pricePerUnitMinor * 2 + unitFactor) / (unitFactor * 2));

export interface Batch {
  id: string; itemId: string; lot: string; expiry: string; priceUnit: { id: string; name: string; factor: number };
  costMinor: number | null; publicPriceMinor: number | null; pharmacistPriceMinor: number | null;
  status: 'active' | 'quarantined'; receivedAt: string; receivedBy: string; sourceRef: string | null;
}
export interface ReceiveInput {
  /** Idempotency key for the stock movement (for example `PI-0007:3` = invoice 7, line 3): a repeated delivery adds nothing. */
  key: string; itemId: string; lot: string; expiry: string; qty: number; unitName?: string;
  costMinor: number; publicPriceMinor?: number; pharmacistPriceMinor?: number; priceUnitName?: string;
  storeId?: string; sourceRef?: string; deviceId?: string;
}
export interface Pick { batchId: string; lot: string; expiry: string; qtyBase: number; unitPriceMinor: number | null; priceUnitFactor: number; amountMinor: number }
export interface Allocation { picks: Pick[]; missingBase: number; totalMinor: number }
export type BatchErrorCode = 'forbidden' | 'invalid' | 'expired' | 'price-conflict' | 'not-found' | 'reason-required' | 'same-status' | 'blocked';
export class BatchError extends Error { constructor(public code: BatchErrorCode, m: string, public detail?: unknown) { super(m); } }

/** "12/27", "12/2027", "2027-12" -> last day of that month (GS1 and printed-pack rule); "2027-12-31" stays. */
export function parseExpiry(v: string): string {
  const t = v.trim(); let y: number, m: number, d: number | null = null; let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { y = +r[1]!; m = +r[2]!; d = +r[3]!; }
  else if ((r = /^(\d{4})-(\d{1,2})$/.exec(t))) { y = +r[1]!; m = +r[2]!; }
  else if ((r = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(t))) { m = +r[1]!; y = r[2]!.length === 2 ? 2000 + +r[2]! : +r[2]!; }
  else throw new BatchError('invalid', `unreadable expiry ${v}`);
  if (m < 1 || m > 12) throw new BatchError('invalid', 'bad month');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); const day = d ?? last; if (day < 1 || day > last) throw new BatchError('invalid', 'bad day');
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

export class BatchService {
  constructor(private hub: Hub, private items: ItemService, private o: { today?: () => string; warningDays?: () => number } = {}) {}
  private get db() { return this.hub.db; }
  today(): string { return this.o.today?.() ?? cairoDay(new Date(this.hub.now())); }
  private need(actor: Person, perm: string): void { if (!can(actor, perm, this.hub.branchId)) throw new BatchError('forbidden', `missing permission ${perm}`); }

  private toBatch(r: Record<string, unknown>, showCost: boolean): Batch {
    const u = this.db.prepare('SELECT id, name, factor FROM item_units WHERE id=?').get(r.price_unit_id)!;
    return { id: String(r.id), itemId: String(r.item_id), lot: String(r.lot), expiry: String(r.expiry), priceUnit: { id: String(u.id), name: String(u.name), factor: Number(u.factor) },
      costMinor: showCost ? Number(r.cost_minor) : null, publicPriceMinor: r.public_price_minor === null ? null : Number(r.public_price_minor), pharmacistPriceMinor: r.pharmacist_price_minor === null ? null : Number(r.pharmacist_price_minor),
      status: r.status as Batch['status'], receivedAt: String(r.received_at), receivedBy: String(r.received_by), sourceRef: (r.source_ref as string | null) ?? null };
  }
  /** Cost is hidden unless the person may see cost (matrix rule 1: hidden from Pharmacist, Cashier, Employee by default). */
  batches(actor: Person, itemId: string): (Batch & { qtyBase: number; expired: boolean })[] {
    this.need(actor, 'stock.batch.view'); const cost = can(actor, 'stock.cost.view', this.hub.branchId); const today = this.today(); const bal = this.balances(itemId);
    return this.db.prepare('SELECT * FROM batches WHERE item_id=? ORDER BY expiry, received_at, id').all(itemId).map(r => ({ ...this.toBatch(r, cost), qtyBase: bal.get(String(r.id)) ?? 0, expired: String(r.expiry) < today }));
  }
  /** Stock per batch comes straight from the ledger: there is no second copy that could disagree. */
  balances(itemId: string, o: { storeId?: string; sellableOnly?: boolean } = {}): Map<string, number> {
    const m = new Map<string, number>(); const a: unknown[] = [this.hub.branchId, itemId];
    let sql = 'SELECT m.batch_id, SUM(m.qty) q FROM movements m' + (o.sellableOnly ? ' JOIN stores s ON s.id = m.store_id AND s.sellable = 1 AND s.active = 1' : '') + ' WHERE m.branch_id=? AND m.item_id=? AND m.batch_id IS NOT NULL';
    if (o.storeId) { sql += ' AND m.store_id=?'; a.push(o.storeId); }
    for (const r of this.db.prepare(sql + ' GROUP BY m.batch_id').all(...a)) m.set(String(r.batch_id), Number(r.q));
    return m;
  }

  /** Receive stock into a batch (the purchase invoice of Sprint 3.5 calls this per line). Creates the batch, or adds to the same lot and expiry when prices match. */
  receive(actor: Person, i: ReceiveInput): { batch: Batch; created: boolean; replay: boolean; warnings: string[] } {
    this.need(actor, 'purchase_invoice.create');
    const item = this.items.get(i.itemId); if (!item) throw new BatchError('not-found', i.itemId);
    if (item.kind === 'service') throw new BatchError('invalid', 'a service holds no stock');
    if (item.status !== 'active') throw new BatchError('blocked', `item is ${item.status}`);
    const expiry = parseExpiry(i.expiry); if (expiry < this.today()) throw new BatchError('expired', 'this batch is already expired and cannot be received');
    const lot = i.lot.trim(); if (!lot) throw new BatchError('invalid', 'lot number is required');
    const unit = this.unit(item, i.unitName); const qtyBase = this.toBase(i.qty, unit);
    const pu = this.unit(item, i.priceUnitName ?? item.units[item.units.length - 1]!.name);
    for (const [n, v] of [['cost', i.costMinor], ['public price', i.publicPriceMinor], ['pharmacist price', i.pharmacistPriceMinor]] as const) if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new BatchError('invalid', `${n} must be whole piasters`);
    const store = this.db.prepare('SELECT active FROM stores WHERE id=?').get(i.storeId ?? 'MAIN'); if (!store || Number(store.active) !== 1) throw new BatchError('invalid', 'unknown or inactive store');
    const warnings: string[] = [];
    if (item.kind === 'drug') {
      if (!i.publicPriceMinor) throw new BatchError('invalid', 'a drug batch needs the state public price (D14)');
      if (i.pharmacistPriceMinor !== undefined && i.pharmacistPriceMinor > i.publicPriceMinor) throw new BatchError('invalid', 'pharmacist price cannot exceed the public price');
      if (i.costMinor > (i.pharmacistPriceMinor ?? i.publicPriceMinor)) warnings.push('cost-above-price');
    } else if (i.publicPriceMinor !== undefined || i.pharmacistPriceMinor !== undefined) throw new BatchError('invalid', 'non-drug prices are set on the item, not on the batch (D20)');
    const warnDays = this.o.warningDays?.() ?? 90; const left = daysBetween(this.today(), expiry); if (left <= warnDays) warnings.push(`near-expiry:${left}`);

    return this.db.tx(() => {
      const exist = this.db.prepare('SELECT * FROM batches WHERE item_id=? AND lot=? AND expiry=?').get(i.itemId, lot, expiry);
      let id: string, created = false;
      if (exist) {
        const same = Number(exist.cost_minor) === i.costMinor && (exist.public_price_minor ?? null) === (i.publicPriceMinor ?? null) && (exist.pharmacist_price_minor ?? null) === (i.pharmacistPriceMinor ?? null) && exist.price_unit_id === pu.id;
        if (!same) throw new BatchError('price-conflict', 'this lot and expiry already exist with other prices; management must resolve it', { batchId: exist.id });
        id = String(exist.id);
      } else {
        id = uuidv7(); created = true;
        try {
          this.db.prepare('INSERT INTO batches(id,item_id,lot,expiry,price_unit_id,cost_minor,public_price_minor,pharmacist_price_minor,received_at,received_by,source_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(id, i.itemId, lot, expiry, pu.id, i.costMinor, i.publicPriceMinor ?? null, i.pharmacistPriceMinor ?? null, this.hub.now(), actor.id, i.sourceRef ?? null);
        } catch (e) { if (e instanceof Error && /CHECK constraint/.test(e.message)) throw new BatchError('invalid', 'a batch value breaks a rule'); throw e; }
      }
      const r = this.hub.record({ key: i.key, storeId: i.storeId ?? 'MAIN', itemId: i.itemId, batchId: id, qty: qtyBase, kind: 'purchase', ref: i.sourceRef, actor: actor.id, deviceId: i.deviceId });
      if (!r.ok) throw new BatchError('invalid', 'stock movement refused');
      if (created) { this.hub.audit(actor.id, 'batch.created', 'batch', id, { itemId: i.itemId, lot, expiry, costMinor: i.costMinor, publicPriceMinor: i.publicPriceMinor ?? null }); this.hub.emit('batch.created', { batchId: id, itemId: i.itemId, lot, expiry, priceUnit: pu.name, publicPriceMinor: i.publicPriceMinor ?? null, pharmacistPriceMinor: i.pharmacistPriceMinor ?? null }); }
      const b = this.toBatch(this.db.prepare('SELECT * FROM batches WHERE id=?').get(id)!, can(actor, 'stock.cost.view', this.hub.branchId));
      return { batch: b, created, replay: r.replay, warnings };
    });
  }
  private unit(item: Item, name?: string): Unit { const u = name ? item.units.find(x => x.name === name) : item.units[item.units.length - 1]; if (!u) throw new BatchError('invalid', `unknown unit ${name}`); return u; }
  private toBase(q: number, u: Unit): number { if (!Number.isInteger(q) || q <= 0) throw new BatchError('invalid', 'quantity must be a positive whole number'); return q * u.factor; }

  /**
   * Only stock in SELLABLE, active stores counts (not the returns, expired or quarantine stores); `storeId` narrows to one store.
   * FEFO (D21): nearest expiry first; expired and quarantined batches are never used; each pick keeps ITS OWN price (D14), so old and new
   * prices can sell side by side. `forceBatchId` lets a pharmacist pick a specific batch (still never an expired or quarantined one).
   * Drug price = the batch public price (cash) or pharmacist price when asked; non-drug = the item's free price.
   */
  allocate(itemId: string, qtyBase: number, o: { forceBatchId?: string; priceKind?: 'public' | 'pharmacist'; storeId?: string } = {}): Allocation {
    const item = this.items.get(itemId); if (!item) throw new BatchError('not-found', itemId);
    if (!Number.isInteger(qtyBase) || qtyBase <= 0) throw new BatchError('invalid', 'quantity must be a positive whole number');
    if (item.status !== 'active') throw new BatchError('blocked', `item is ${item.status}`);
    const bal = this.balances(itemId, { sellableOnly: true, storeId: o.storeId }); const today = this.today();
    let rows = this.db.prepare("SELECT * FROM batches WHERE item_id=? AND status='active' AND expiry >= ? ORDER BY expiry, received_at, id").all(itemId, today).filter(r => (bal.get(String(r.id)) ?? 0) > 0);
    if (o.forceBatchId) { rows = rows.filter(r => r.id === o.forceBatchId); if (!rows.length) throw new BatchError('blocked', 'that batch is expired, on hold or has no stock'); }
    let need = qtyBase; const picks: Pick[] = [];
    for (const r of rows) {
      if (need <= 0) break; const take = Math.min(need, bal.get(String(r.id))!); const pu = this.db.prepare('SELECT factor FROM item_units WHERE id=?').get(r.price_unit_id)!;
      let price: number | null; let factor = Number(pu.factor);
      if (item.kind === 'drug') price = o.priceKind === 'pharmacist' && r.pharmacist_price_minor !== null ? Number(r.pharmacist_price_minor) : Number(r.public_price_minor);
      else { price = item.listPriceMinor; factor = item.units[item.units.length - 1]!.factor; } // a non-drug price is per its largest (retail) unit
      picks.push({ batchId: String(r.id), lot: String(r.lot), expiry: String(r.expiry), qtyBase: take, unitPriceMinor: price, priceUnitFactor: factor, amountMinor: price === null ? 0 : amountFor(take, price, factor) });
      need -= take;
    }
    return { picks, missingBase: Math.max(0, need), totalMinor: picks.reduce((s, p) => s + p.amountMinor, 0) };
  }

  /** Near-expiry and expired stock (batches with stock only), nearest first. Value at cost only for those who may see cost. */
  expiryReport(actor: Person, withinDays?: number): { batchId: string; itemId: string; itemName: string; lot: string; expiry: string; daysLeft: number; qtyBase: number; valueMinor: number | null }[] {
    this.need(actor, 'expiry.alerts.view'); const cost = can(actor, 'stock.cost.view', this.hub.branchId); const today = this.today(); const days = withinDays ?? this.o.warningDays?.() ?? 90;
    const limit = new Date(Date.parse(today + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
    const out = [];
    for (const r of this.db.prepare(`SELECT b.*, i.name_ar, u.factor FROM batches b JOIN items i ON i.id=b.item_id JOIN item_units u ON u.id=b.price_unit_id WHERE b.expiry <= ? ORDER BY b.expiry, i.name_ar`).all(limit)) {
      const q = this.balances(String(r.item_id)).get(String(r.id)) ?? 0; if (q <= 0) continue;
      out.push({ batchId: String(r.id), itemId: String(r.item_id), itemName: String(r.name_ar), lot: String(r.lot), expiry: String(r.expiry), daysLeft: daysBetween(today, String(r.expiry)), qtyBase: q, valueMinor: cost ? amountFor(q, Number(r.cost_minor), Number(r.factor)) : null });
    }
    return out;
  }

  /** Recall or quality hold (Phase 10 builds the full recall process on this): a quarantined batch is never sold; reason and log are required. */
  setStatus(actor: Person, batchId: string, to: 'active' | 'quarantined', reason: string): void {
    this.need(actor, 'recall.manage'); const b = this.db.prepare('SELECT * FROM batches WHERE id=?').get(batchId); if (!b) throw new BatchError('not-found', batchId);
    if (!reason.trim()) throw new BatchError('reason-required', 'a reason is required'); if (b.status === to) throw new BatchError('same-status', `already ${to}`);
    this.db.tx(() => {
      this.db.prepare('UPDATE batches SET status=? WHERE id=?').run(to, batchId);
      this.db.prepare('INSERT INTO batch_status_log(batch_id,from_status,to_status,by,at,reason) VALUES(?,?,?,?,?,?)').run(batchId, b.status, to, actor.id, this.hub.now(), reason.trim());
      this.hub.audit(actor.id, 'batch.status_changed', 'batch', batchId, { from: b.status, to, reason: reason.trim() }); this.hub.emit('batch.status_changed', { batchId, itemId: String(b.item_id), from: b.status, to, reason: reason.trim() });
    });
  }
  statusLog(batchId: string): { from: string; to: string; by: string; at: string; reason: string }[] {
    return this.db.prepare('SELECT * FROM batch_status_log WHERE batch_id=? ORDER BY seq').all(batchId).map(r => ({ from: String(r.from_status), to: String(r.to_status), by: String(r.by), at: String(r.at), reason: String(r.reason) }));
  }
}
