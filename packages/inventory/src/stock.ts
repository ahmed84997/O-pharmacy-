import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { BatchService, amountFor } from './batches';
import type { ItemService } from './items';

export type StoreKind = 'main' | 'sales_floor' | 'warehouse' | 'returns' | 'expired' | 'quarantine';
export interface Store { id: string; name: string; kind: StoreKind; sellable: boolean; active: boolean }
export type StockErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'insufficient' | 'not-empty' | 'blocked';
export class StockError extends Error { constructor(public code: StockErrorCode, m: string, public detail?: unknown) { super(m); } }
export interface CardLine { at: string; kind: string; ref: string | null; reason: string | null; actor: string; storeId: string; lot: string | null; qty: number; balance: number }

/** Where a store kind may sell from: the returns, expired and quarantine stores hold stock that must never reach a customer. */
const SELLABLE: Record<StoreKind, boolean> = { main: true, sales_floor: true, warehouse: true, returns: false, expired: false, quarantine: false };

/** Stores (مخازن) and the read models over the ledger: balances, stock card, valuation, low stock, and transfers between stores. */
export class StockService {
  constructor(private hub: Hub, private items: ItemService, private batches: BatchService) {}
  private get db() { return this.hub.db; }
  private need(actor: Person, perm: string): void { if (!can(actor, perm, this.hub.branchId)) throw new StockError('forbidden', `missing permission ${perm}`); }
  private toStore = (r: Record<string, unknown>): Store => ({ id: String(r.id), name: String(r.name), kind: r.kind as StoreKind, sellable: Number(r.sellable) === 1, active: Number(r.active) === 1 });

  // ---------- stores ----------
  stores(includeInactive = false): Store[] { return this.db.prepare(`SELECT * FROM stores ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY (id = 'MAIN') DESC, name`).all().map(this.toStore); }
  createStore(actor: Person, name: string, kind: StoreKind): Store {
    this.need(actor, 'settings.branch'); const n = name.trim(); if (!n) throw new StockError('invalid', 'store name is required'); if (!(kind in SELLABLE) || kind === 'main') throw new StockError('invalid', 'bad store kind');
    const id = uuidv7();
    try { this.db.tx(() => { this.db.prepare('INSERT INTO stores(id,name,kind,sellable,active,created_at) VALUES(?,?,?,?,1,?)').run(id, n, kind, SELLABLE[kind] ? 1 : 0, this.hub.now()); this.hub.audit(actor.id, 'store.created', 'store', id, { name: n, kind }); this.hub.emit('store.created', { id, name: n, kind }); }); }
    catch (e) { if (e instanceof Error && /UNIQUE/.test(e.message)) throw new StockError('invalid', 'a store with this name exists'); throw e; }
    return this.toStore(this.db.prepare('SELECT * FROM stores WHERE id=?').get(id)!);
  }
  /** Stores are never deleted. A store can be switched off only when it holds no stock; the main store never. */
  setStoreActive(actor: Person, storeId: string, active: boolean): void {
    this.need(actor, 'settings.branch'); const st = this.db.prepare('SELECT * FROM stores WHERE id=?').get(storeId); if (!st) throw new StockError('not-found', storeId);
    if (storeId === 'MAIN' && !active) throw new StockError('blocked', 'the main store cannot be switched off');
    if (!active && Number(this.db.prepare('SELECT COUNT(*) c FROM (SELECT item_id, batch_id FROM movements WHERE branch_id=? AND store_id=? GROUP BY item_id, batch_id HAVING SUM(qty) <> 0)').get(this.hub.branchId, storeId)!.c) > 0) throw new StockError('not-empty', 'move the stock out first');
    this.db.tx(() => { this.db.prepare('UPDATE stores SET active=? WHERE id=?').run(active ? 1 : 0, storeId); this.hub.audit(actor.id, 'store.active', 'store', storeId, { active }); this.hub.emit('store.active', { id: storeId, active }); });
  }

  // ---------- balances ----------
  onHand(itemId: string, o: { storeId?: string; sellableOnly?: boolean } = {}): number {
    const a: unknown[] = [this.hub.branchId, itemId]; let sql = 'SELECT COALESCE(SUM(m.qty),0) q FROM movements m' + (o.sellableOnly ? ' JOIN stores s ON s.id = m.store_id AND s.sellable = 1 AND s.active = 1' : '') + ' WHERE m.branch_id=? AND m.item_id=?';
    if (o.storeId) { sql += ' AND m.store_id=?'; a.push(o.storeId); } return Number(this.db.prepare(sql).get(...a)!.q);
  }
  /** Per store, for the item card. Quantities in base units. */
  byStore(actor: Person, itemId: string): { storeId: string; storeName: string; qtyBase: number }[] {
    this.need(actor, 'stock.view');
    return this.db.prepare('SELECT m.store_id id, COALESCE(s.name, m.store_id) name, SUM(m.qty) q FROM movements m LEFT JOIN stores s ON s.id = m.store_id WHERE m.branch_id=? AND m.item_id=? GROUP BY m.store_id HAVING SUM(m.qty) <> 0 ORDER BY name').all(this.hub.branchId, itemId).map(r => ({ storeId: String(r.id), storeName: String(r.name), qtyBase: Number(r.q) }));
  }
  /** One query for the whole item list screen: total, sellable and expired-or-held quantities per item (searching 25,000 items stays instant). */
  summary(actor: Person, itemIds?: string[]): Map<string, { total: number; sellable: number }> {
    this.need(actor, 'stock.view'); const today = this.batches.today();
    const rows = this.db.prepare(`SELECT m.item_id id, SUM(m.qty) total,
        SUM(CASE WHEN s.id IS NOT NULL AND b.status = 'active' AND b.expiry >= ? THEN m.qty ELSE 0 END) sellable
      FROM movements m LEFT JOIN stores s ON s.id = m.store_id AND s.sellable = 1 AND s.active = 1 LEFT JOIN batches b ON b.id = m.batch_id
      WHERE m.branch_id = ? GROUP BY m.item_id`).all(today, this.hub.branchId);
    const want = itemIds ? new Set(itemIds) : null; const out = new Map<string, { total: number; sellable: number }>();
    for (const r of rows) if (!want || want.has(String(r.id))) out.set(String(r.id), { total: Number(r.total), sellable: Number(r.sellable) });
    return out;
  }

  /** Stock card (كارت الصنف): every movement with a running balance. `fromIso` sets the opening balance. Lot numbers need stock.batch.view. */
  card(actor: Person, itemId: string, o: { storeId?: string; fromIso?: string; toIso?: string } = {}): { opening: number; lines: CardLine[]; closing: number } {
    this.need(actor, 'stock.view'); const lots = can(actor, 'stock.batch.view', this.hub.branchId);
    const a: unknown[] = [this.hub.branchId, itemId]; let where = 'm.branch_id=? AND m.item_id=?'; if (o.storeId) { where += ' AND m.store_id=?'; a.push(o.storeId); }
    let opening = 0; if (o.fromIso) opening = Number(this.db.prepare(`SELECT COALESCE(SUM(m.qty),0) q FROM movements m WHERE ${where} AND m.created_at < ?`).get(...a, o.fromIso)!.q);
    let range = ''; const ra: unknown[] = []; if (o.fromIso) { range += ' AND m.created_at >= ?'; ra.push(o.fromIso); } if (o.toIso) { range += ' AND m.created_at <= ?'; ra.push(o.toIso); }
    let bal = opening;
    const lines = this.db.prepare(`SELECT m.*, b.lot FROM movements m LEFT JOIN batches b ON b.id = m.batch_id WHERE ${where}${range} ORDER BY m.seq`).all(...a, ...ra).map(r => { bal += Number(r.qty); return { at: String(r.created_at), kind: String(r.kind), ref: (r.ref as string | null) ?? null, reason: (r.reason as string | null) ?? null, actor: String(r.actor), storeId: String(r.store_id), lot: lots ? ((r.lot as string | null) ?? null) : null, qty: Number(r.qty), balance: bal }; });
    return { opening, lines, closing: bal };
  }

  /** Stock value at cost (needs stock.cost.view), per item, with the expired part shown apart. Cost per batch comes from the batch, never from a guess. */
  valuation(actor: Person): { items: { itemId: string; name: string; qtyBase: number; valueMinor: number; expiredValueMinor: number }[]; totalMinor: number; expiredMinor: number } {
    this.need(actor, 'stock.cost.view'); const today = this.batches.today(); const per = new Map<string, { name: string; qty: number; v: number; ev: number }>();
    for (const r of this.db.prepare(`SELECT b.id, b.item_id, b.expiry, b.cost_minor, u.factor, i.name_ar, SUM(m.qty) q FROM movements m JOIN batches b ON b.id = m.batch_id JOIN item_units u ON u.id = b.price_unit_id JOIN items i ON i.id = b.item_id WHERE m.branch_id = ? GROUP BY b.id HAVING SUM(m.qty) > 0`).all(this.hub.branchId)) {
      const v = amountFor(Number(r.q), Number(r.cost_minor), Number(r.factor)); const k = String(r.item_id); const e = per.get(k) ?? { name: String(r.name_ar), qty: 0, v: 0, ev: 0 };
      e.qty += Number(r.q); e.v += v; if (String(r.expiry) < today) e.ev += v; per.set(k, e);
    }
    const items = [...per.entries()].map(([itemId, e]) => ({ itemId, name: e.name, qtyBase: e.qty, valueMinor: e.v, expiredValueMinor: e.ev })).sort((a, b) => b.valueMinor - a.valueMinor);
    return { items, totalMinor: items.reduce((s, x) => s + x.valueMinor, 0), expiredMinor: items.reduce((s, x) => s + x.expiredValueMinor, 0) };
  }

  /** Items at or below their reorder level (sellable stock only), biggest shortfall first. Feeds the shortage notebook. */
  lowStock(actor: Person): { itemId: string; name: string; onHand: number; reorderLevel: number; shortfall: number }[] {
    this.need(actor, 'stock.view'); const sum = this.summary(actor);
    return this.db.prepare("SELECT id, name_ar, reorder_level FROM items WHERE status = 'active' AND kind <> 'service' AND reorder_level > 0").all()
      .map(r => { const have = sum.get(String(r.id))?.sellable ?? 0; return { itemId: String(r.id), name: String(r.name_ar), onHand: have, reorderLevel: Number(r.reorder_level), shortfall: Number(r.reorder_level) - have }; })
      .filter(x => x.shortfall >= 0).sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name, 'ar'));
  }

  // ---------- transfer between internal stores ----------
  /**
   * Moves stock between two stores of THIS branch. Without a batch it takes nearest expiry first from the source store (expired stock may be moved
   * to an "expired" store, so for transfers expired batches are allowed). All-or-nothing: if the source cannot cover the quantity, nothing moves.
   * Each batch moved = one out and one in movement + one transfer row; repeating the same key changes nothing.
   */
  transfer(actor: Person, t: { key: string; itemId: string; qtyBase: number; fromStore: string; toStore: string; batchId?: string; reason?: string; deviceId?: string }): { transferNo: string; moved: { batchId: string; qtyBase: number }[]; replay: boolean } {
    this.need(actor, 'store.transfer.internal');
    if (t.fromStore === t.toStore) throw new StockError('invalid', 'source and destination are the same store');
    if (!Number.isInteger(t.qtyBase) || t.qtyBase <= 0) throw new StockError('invalid', 'quantity must be a positive whole number');
    for (const s of [t.fromStore, t.toStore]) { const r = this.db.prepare('SELECT active FROM stores WHERE id=?').get(s); if (!r || Number(r.active) !== 1) throw new StockError('invalid', `unknown or inactive store ${s}`); }
    const item = this.items.get(t.itemId); if (!item) throw new StockError('not-found', t.itemId); if (item.kind === 'service') throw new StockError('invalid', 'a service holds no stock');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT transfer_no, batch_id, qty_base FROM store_transfers WHERE req_key=? ORDER BY rowid').all(t.key);
      if (prior.length) return { transferNo: String(prior[0]!.transfer_no), moved: prior.map(r => ({ batchId: String(r.batch_id), qtyBase: Number(r.qty_base) })), replay: true };
      const bal = this.batches.balances(t.itemId, { storeId: t.fromStore });
      let order = this.db.prepare('SELECT id FROM batches WHERE item_id=? ORDER BY expiry, received_at, rowid').all(t.itemId).map(r => String(r.id)).filter(id => (bal.get(id) ?? 0) > 0);
      if (t.batchId) order = order.filter(id => id === t.batchId);
      let need = t.qtyBase; const picks: { batchId: string; q: number }[] = [];
      for (const id of order) { if (need <= 0) break; const q = Math.min(need, bal.get(id)!); picks.push({ batchId: id, q }); need -= q; }
      if (need > 0) throw new StockError('insufficient', 'the source store does not hold that quantity', { missingBase: need });
      const no = this.nextTransferNo(); const moved: { batchId: string; qtyBase: number }[] = [];
      for (const [i, p] of picks.entries()) {
        const out = this.hub.record({ key: `${t.key}:${i}:out`, storeId: t.fromStore, itemId: t.itemId, batchId: p.batchId, qty: -p.q, kind: 'transfer_out', ref: `T:${t.key}:${no}`, reason: t.reason, actor: actor.id, deviceId: t.deviceId });
        const inn = this.hub.record({ key: `${t.key}:${i}:in`, storeId: t.toStore, itemId: t.itemId, batchId: p.batchId, qty: p.q, kind: 'transfer_in', ref: `T:${t.key}:${no}`, reason: t.reason, actor: actor.id, deviceId: t.deviceId });
        if (!out.ok || !inn.ok) throw new StockError('insufficient', 'stock changed during the transfer');
        this.db.prepare('INSERT INTO store_transfers(id,transfer_no,req_key,from_store,to_store,item_id,batch_id,qty_base,reason,by,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(uuidv7(), no, t.key, t.fromStore, t.toStore, t.itemId, p.batchId, p.q, t.reason ?? null, actor.id, this.hub.now());
        moved.push({ batchId: p.batchId, qtyBase: p.q });
      }
      this.hub.audit(actor.id, 'store.transfer', 'store_transfer', no, { itemId: t.itemId, from: t.fromStore, to: t.toStore, qtyBase: t.qtyBase, reason: t.reason ?? null }); this.hub.emit('store.transferred', { transferNo: no, itemId: t.itemId, from: t.fromStore, to: t.toStore, moved });
      return { transferNo: no, moved, replay: false };
    });
  }
  private nextTransferNo(): string {
    const r = this.db.prepare("SELECT v FROM inv_counters WHERE k='transfer'").get(); const n = Number(r?.v ?? 0) + 1;
    this.db.prepare("INSERT INTO inv_counters(k,v) VALUES('transfer',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(n); return `T-${String(n).padStart(6, '0')}`;
  }
}
