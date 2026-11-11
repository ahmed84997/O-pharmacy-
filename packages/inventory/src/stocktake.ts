import { approvalAllowed, can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';

export type TakeErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'insufficient' | 'separation';
export class TakeError extends Error { constructor(public code: TakeErrorCode, m: string, public detail?: unknown) { super(m); } }
export type ReasonCode = 'damaged' | 'lost' | 'found' | 'expired' | 'count_error' | 'other';
const REASONS: ReasonCode[] = ['damaged', 'lost', 'found', 'expired', 'count_error', 'other'];
export interface Adjustment { id: string; adjNo: string; itemId: string; batchId: string; storeId: string; qtyBase: number; reasonCode: ReasonCode; note: string; status: 'pending' | 'approved' | 'rejected'; by: string; at: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; flagged: boolean; valueMinor: number | null }
export interface TakeLine { id: string; itemId: string; itemName: string; batchId: string; lot: string | null; expiry: string | null; systemQty: number | null; countedQty: number | null; variance: number | null }
export interface ApprovalRules { separationOfDuties: () => boolean; activeApprovers: () => number }

/** Adjustments (تسوية) and stocktakes (جرد). Both end in ledger movements of kind 'adjust'; both are approved by someone other than the maker (matrix rule 4). */
export class StocktakeService {
  constructor(private hub: Hub, private rules: ApprovalRules = { separationOfDuties: () => true, activeApprovers: () => 2 }) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new TakeError('forbidden', `missing permission ${perm}`); }
  private next(k: string, prefix: string): string {
    const n = Number(this.db.prepare('SELECT v FROM inv_counters WHERE k=?').get(k)?.v ?? 0) + 1;
    this.db.prepare('INSERT INTO inv_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`;
  }
  private sod(maker: string, approver: Person): boolean {
    const r = approvalAllowed(maker, approver.id, { separationOfDuties: this.rules.separationOfDuties(), activeApprovers: this.rules.activeApprovers() });
    if (!r.ok) throw new TakeError('separation', 'someone other than the maker must approve this'); return r.flagged;
  }
  private bal(itemId: string, batchId: string, storeId: string): number { return this.hub.balance(itemId, { storeId, batchId }); }
  private toAdj(r: Record<string, unknown>, cost: boolean): Adjustment {
    let value: number | null = null;
    if (cost) { const b = this.db.prepare('SELECT b.cost_minor c, u.factor f FROM batches b JOIN item_units u ON u.id=b.price_unit_id WHERE b.id=?').get(String(r.batch_id)); if (b) value = Math.round(Number(r.qty_base) * Number(b.c) / Number(b.f)); }
    return { id: String(r.id), adjNo: String(r.adj_no), itemId: String(r.item_id), batchId: String(r.batch_id), storeId: String(r.store_id), qtyBase: Number(r.qty_base), reasonCode: r.reason_code as ReasonCode, note: String(r.note), status: r.status as Adjustment['status'], by: String(r.by), at: String(r.at), decidedBy: (r.decided_by as string) ?? null, decidedAt: (r.decided_at as string) ?? null, decisionNote: (r.decision_note as string) ?? null, flagged: Number(r.flagged) === 1, valueMinor: value };
  }

  // ---------- adjustments ----------
  /** A request only; the stock changes when someone else approves. Repeating the same key returns the same request. */
  requestAdjustment(actor: Person, a: { key: string; itemId: string; batchId: string; storeId?: string; qtyBase: number; reasonCode: ReasonCode; note: string }): Adjustment {
    this.need(actor, 'stock.adjust'); const storeId = a.storeId ?? 'MAIN';
    if (!Number.isInteger(a.qtyBase) || a.qtyBase === 0) throw new TakeError('invalid', 'quantity must be a non-zero whole number (base units)');
    if (!REASONS.includes(a.reasonCode)) throw new TakeError('invalid', 'bad reason code'); if (!a.note?.trim()) throw new TakeError('invalid', 'a note is required');
    const st = this.db.prepare('SELECT 1 FROM stores WHERE id=? AND active=1').get(storeId); if (!st) throw new TakeError('invalid', `unknown or inactive store ${storeId}`);
    const b = this.db.prepare('SELECT item_id FROM batches WHERE id=?').get(a.batchId); if (!b || String(b.item_id) !== a.itemId) throw new TakeError('not-found', 'batch does not belong to this item');
    const cost = can(actor, 'stock.cost.view', this.hub.branchId);
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT * FROM adjustments WHERE req_key=?').get(a.key); if (prior) return this.toAdj(prior, cost);
      if (a.qtyBase < 0 && this.bal(a.itemId, a.batchId, storeId) + a.qtyBase < 0) throw new TakeError('insufficient', 'the store holds less than that', { onHand: this.bal(a.itemId, a.batchId, storeId) });
      const id = uuidv7(), no = this.next('adjustment', 'A');
      this.db.prepare('INSERT INTO adjustments(id,adj_no,req_key,item_id,batch_id,store_id,qty_base,reason_code,note,by,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, no, a.key, a.itemId, a.batchId, storeId, a.qtyBase, a.reasonCode, a.note.trim(), actor.id, this.hub.now());
      this.hub.audit(actor.id, 'adjustment.requested', 'adjustment', no, { itemId: a.itemId, batchId: a.batchId, storeId, qtyBase: a.qtyBase, reason: a.reasonCode }); this.hub.emit('adjustment.requested', { adjNo: no, itemId: a.itemId, qtyBase: a.qtyBase });
      return this.toAdj(this.db.prepare('SELECT * FROM adjustments WHERE id=?').get(id)!, cost);
    });
  }
  approveAdjustment(actor: Person, adjNo: string): Adjustment {
    this.need(actor, 'stock.adjust.approve'); const cost = can(actor, 'stock.cost.view', this.hub.branchId);
    return this.db.tx(() => {
      const r = this.db.prepare('SELECT * FROM adjustments WHERE adj_no=?').get(adjNo); if (!r) throw new TakeError('not-found', adjNo); if (r.status !== 'pending') throw new TakeError('state', `already ${String(r.status)}`);
      const flagged = this.sod(String(r.by), actor);
      const m = this.hub.record({ key: `ADJ:${String(r.id)}`, storeId: String(r.store_id), itemId: String(r.item_id), batchId: String(r.batch_id), qty: Number(r.qty_base), kind: 'adjust', ref: adjNo, reason: `${String(r.reason_code)}: ${String(r.note)}`, actor: actor.id });
      if (!m.ok) throw new TakeError('insufficient', 'stock changed since the request: the store holds less than that');
      this.db.prepare("UPDATE adjustments SET status='approved', decided_by=?, decided_at=?, flagged=? WHERE id=?").run(actor.id, this.hub.now(), flagged ? 1 : 0, String(r.id));
      this.hub.audit(actor.id, 'adjustment.approved', 'adjustment', adjNo, { flagged }); this.hub.emit('adjustment.approved', { adjNo, itemId: String(r.item_id), qtyBase: Number(r.qty_base) });
      return this.toAdj(this.db.prepare('SELECT * FROM adjustments WHERE id=?').get(String(r.id))!, cost);
    });
  }
  rejectAdjustment(actor: Person, adjNo: string, note: string): Adjustment {
    this.need(actor, 'stock.adjust.approve'); if (!note?.trim()) throw new TakeError('invalid', 'a reason is required'); const cost = can(actor, 'stock.cost.view', this.hub.branchId);
    return this.db.tx(() => {
      const r = this.db.prepare('SELECT * FROM adjustments WHERE adj_no=?').get(adjNo); if (!r) throw new TakeError('not-found', adjNo); if (r.status !== 'pending') throw new TakeError('state', `already ${String(r.status)}`);
      this.db.prepare("UPDATE adjustments SET status='rejected', decided_by=?, decided_at=?, decision_note=? WHERE id=?").run(actor.id, this.hub.now(), note.trim(), String(r.id));
      this.hub.audit(actor.id, 'adjustment.rejected', 'adjustment', adjNo, { note: note.trim() });
      return this.toAdj(this.db.prepare('SELECT * FROM adjustments WHERE id=?').get(String(r.id))!, cost);
    });
  }
  adjustments(actor: Person, o: { status?: Adjustment['status']; itemId?: string } = {}): Adjustment[] {
    this.need(actor, 'stock.adjust'); const cost = can(actor, 'stock.cost.view', this.hub.branchId); const w: string[] = []; const a: unknown[] = [];
    if (o.status) { w.push('status=?'); a.push(o.status); } if (o.itemId) { w.push('item_id=?'); a.push(o.itemId); }
    return this.db.prepare(`SELECT * FROM adjustments ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY rowid`).all(...a).map(r => this.toAdj(r, cost));
  }

  // ---------- stocktake ----------
  /** Opens a count of one store (all items, or the listed ones). Takes a snapshot of the batches held; one open stocktake per store. */
  startStocktake(actor: Person, s: { key: string; storeId?: string; itemIds?: string[]; blind?: boolean; note?: string }): { id: string; stNo: string; lines: number; replay: boolean } {
    this.need(actor, 'stocktake.count'); const storeId = s.storeId ?? 'MAIN';
    if (!this.db.prepare('SELECT 1 FROM stores WHERE id=? AND active=1').get(storeId)) throw new TakeError('invalid', `unknown or inactive store ${storeId}`);
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT id, st_no FROM stocktakes WHERE req_key=?').get(s.key);
      if (prior) return { id: String(prior.id), stNo: String(prior.st_no), lines: Number(this.db.prepare('SELECT COUNT(*) c FROM stocktake_lines WHERE stocktake_id=?').get(String(prior.id))!.c), replay: true };
      if (this.db.prepare("SELECT 1 FROM stocktakes WHERE store_id=? AND status IN ('open','submitted')").get(storeId)) throw new TakeError('state', 'this store already has an unfinished stocktake');
      const rows = this.db.prepare('SELECT item_id, batch_id, SUM(qty) q FROM movements WHERE branch_id=? AND store_id=? AND batch_id IS NOT NULL GROUP BY item_id, batch_id HAVING SUM(qty) <> 0').all(this.hub.branchId, storeId).filter(r => !s.itemIds || s.itemIds.includes(String(r.item_id)));
      const id = uuidv7(), no = this.next('stocktake', 'ST');
      this.db.prepare('INSERT INTO stocktakes(id,st_no,req_key,store_id,blind,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, no, s.key, storeId, s.blind === false ? 0 : 1, s.note ?? null, actor.id, this.hub.now());
      const ins = this.db.prepare('INSERT INTO stocktake_lines(id,stocktake_id,item_id,batch_id,snap_qty) VALUES(?,?,?,?,?)');
      for (const r of rows) ins.run(uuidv7(), id, String(r.item_id), String(r.batch_id), Number(r.q));
      this.hub.audit(actor.id, 'stocktake.started', 'stocktake', no, { storeId, lines: rows.length, blind: s.blind !== false }); this.hub.emit('stocktake.started', { stNo: no, storeId, lines: rows.length });
      return { id, stNo: no, lines: rows.length, replay: false };
    });
  }
  private take(id: string) { const t = this.db.prepare('SELECT * FROM stocktakes WHERE id=?').get(id); if (!t) throw new TakeError('not-found', id); return t; }
  /** A blind count hides the system quantity from counters; only those who may approve see it. */
  lines(actor: Person, id: string): TakeLine[] {
    this.need(actor, 'stocktake.count'); const t = this.take(id); const showSys = Number(t.blind) === 0 || can(actor, 'stocktake.approve', this.hub.branchId); const lot = can(actor, 'stock.batch.view', this.hub.branchId);
    return this.db.prepare('SELECT l.*, i.name_ar, b.lot, b.expiry FROM stocktake_lines l JOIN items i ON i.id=l.item_id JOIN batches b ON b.id=l.batch_id WHERE l.stocktake_id=? ORDER BY i.name_ar, b.expiry, l.rowid').all(id).map(r => {
      const counted = r.counted_qty === null ? null : Number(r.counted_qty); const sys = r.sys_at_count === null ? Number(r.snap_qty) : Number(r.sys_at_count);
      return { id: String(r.id), itemId: String(r.item_id), itemName: String(r.name_ar), batchId: String(r.batch_id), lot: lot ? String(r.lot) : null, expiry: lot ? String(r.expiry) : null, systemQty: showSys ? sys : null, countedQty: counted, variance: showSys && counted !== null ? counted - sys : null };
    });
  }
  /** Records what was physically counted (base units). Remembers what the system held at that moment, so sales during the count do not distort the variance. */
  count(actor: Person, id: string, lineId: string, qty: number): void {
    this.need(actor, 'stocktake.count'); if (!Number.isInteger(qty) || qty < 0) throw new TakeError('invalid', 'count must be a whole number, zero or more');
    this.db.tx(() => {
      const t = this.take(id); if (t.status !== 'open') throw new TakeError('state', 'the stocktake is not open for counting');
      const l = this.db.prepare('SELECT * FROM stocktake_lines WHERE id=? AND stocktake_id=?').get(lineId, id); if (!l) throw new TakeError('not-found', lineId);
      const sys = this.bal(String(l.item_id), String(l.batch_id), String(t.store_id));
      this.db.prepare('UPDATE stocktake_lines SET counted_qty=?, sys_at_count=?, counted_by=?, counted_at=? WHERE id=?').run(qty, sys, actor.id, this.hub.now(), lineId);
      this.hub.audit(actor.id, 'stocktake.counted', 'stocktake', String(t.st_no), { lineId, qty, system: sys });
    });
  }
  /** Stock found on the shelf that the snapshot did not list (a batch with no balance here). */
  countExtra(actor: Person, id: string, itemId: string, batchId: string, qty: number): string {
    this.need(actor, 'stocktake.count'); if (!Number.isInteger(qty) || qty < 0) throw new TakeError('invalid', 'count must be a whole number, zero or more');
    return this.db.tx(() => {
      const t = this.take(id); if (t.status !== 'open') throw new TakeError('state', 'the stocktake is not open for counting');
      const b = this.db.prepare('SELECT item_id FROM batches WHERE id=?').get(batchId); if (!b || String(b.item_id) !== itemId) throw new TakeError('not-found', 'batch does not belong to this item');
      let l = this.db.prepare('SELECT id FROM stocktake_lines WHERE stocktake_id=? AND item_id=? AND batch_id=?').get(id, itemId, batchId); let lineId = l ? String(l.id) : '';
      if (!l) { lineId = uuidv7(); this.db.prepare('INSERT INTO stocktake_lines(id,stocktake_id,item_id,batch_id,snap_qty) VALUES(?,?,?,?,0)').run(lineId, id, itemId, batchId); }
      this.count(actor, id, lineId, qty); return lineId;
    });
  }
  submit(actor: Person, id: string): { uncounted: number } {
    this.need(actor, 'stocktake.count');
    return this.db.tx(() => {
      const t = this.take(id); if (t.status !== 'open') throw new TakeError('state', 'the stocktake is not open');
      const un = Number(this.db.prepare('SELECT COUNT(*) c FROM stocktake_lines WHERE stocktake_id=? AND counted_qty IS NULL').get(id)!.c);
      this.db.prepare("UPDATE stocktakes SET status='submitted', submitted_by=?, submitted_at=? WHERE id=?").run(actor.id, this.hub.now(), id);
      this.hub.audit(actor.id, 'stocktake.submitted', 'stocktake', String(t.st_no), { uncounted: un }); return { uncounted: un };
    });
  }
  /** What approval will change: shortages and overages per line, value at cost for those who may see cost, and the lines nobody counted (left untouched). */
  review(actor: Person, id: string) {
    this.need(actor, 'stocktake.approve'); const cost = can(actor, 'stock.cost.view', this.hub.branchId); const t = this.take(id);
    const lines = this.db.prepare('SELECT l.*, i.name_ar, b.lot, b.cost_minor c, u.factor f FROM stocktake_lines l JOIN items i ON i.id=l.item_id JOIN batches b ON b.id=l.batch_id JOIN item_units u ON u.id=b.price_unit_id WHERE l.stocktake_id=? ORDER BY i.name_ar, l.rowid').all(id);
    const diffs = lines.filter(l => l.counted_qty !== null && Number(l.counted_qty) !== Number(l.sys_at_count)).map(l => { const v = Number(l.counted_qty) - Number(l.sys_at_count); return { lineId: String(l.id), itemName: String(l.name_ar), lot: String(l.lot), variance: v, valueMinor: cost ? Math.round(v * Number(l.c) / Number(l.f)) : null }; });
    return { stNo: String(t.st_no), status: String(t.status), diffs, uncounted: lines.filter(l => l.counted_qty === null).length, shortageUnits: diffs.filter(d => d.variance < 0).reduce((s, d) => s - d.variance, 0), overageUnits: diffs.filter(d => d.variance > 0).reduce((s, d) => s + d.variance, 0), netValueMinor: cost ? diffs.reduce((s, d) => s + (d.valueMinor ?? 0), 0) : null };
  }
  /** Approves the count: one ledger adjustment per differing line, all or nothing. Uncounted lines are left untouched. */
  apply(actor: Person, id: string): { adjusted: number; skipped: number } {
    this.need(actor, 'stocktake.apply');
    return this.db.tx(() => {
      const t = this.take(id); if (t.status !== 'submitted') throw new TakeError('state', 'only a submitted stocktake can be applied');
      const flagged = this.sod(String(t.submitted_by), actor); let adjusted = 0, skipped = 0;
      for (const l of this.db.prepare('SELECT * FROM stocktake_lines WHERE stocktake_id=? ORDER BY rowid').all(id)) {
        if (l.counted_qty === null) { skipped++; continue; }
        const v = Number(l.counted_qty) - Number(l.sys_at_count); this.db.prepare('UPDATE stocktake_lines SET applied_qty=? WHERE id=?').run(v, String(l.id)); if (v === 0) continue;
        const m = this.hub.record({ key: `ST:${id}:${String(l.id)}`, storeId: String(t.store_id), itemId: String(l.item_id), batchId: String(l.batch_id), qty: v, kind: 'adjust', ref: String(t.st_no), reason: 'stocktake', actor: actor.id });
        if (!m.ok) throw new TakeError('insufficient', 'stock changed after counting: recount this line', { lineId: String(l.id) });
        adjusted++;
      }
      this.db.prepare("UPDATE stocktakes SET status='applied', decided_by=?, decided_at=?, flagged=? WHERE id=?").run(actor.id, this.hub.now(), flagged ? 1 : 0, id);
      this.hub.audit(actor.id, 'stocktake.applied', 'stocktake', String(t.st_no), { adjusted, skipped, flagged }); this.hub.emit('stocktake.applied', { stNo: String(t.st_no), storeId: String(t.store_id), adjusted });
      return { adjusted, skipped };
    });
  }
  /** Sends a submitted count back for recounting (the counts stay). */
  reopen(actor: Person, id: string, reason: string): void {
    this.need(actor, 'stocktake.approve'); if (!reason?.trim()) throw new TakeError('invalid', 'a reason is required');
    this.db.tx(() => { const t = this.take(id); if (t.status !== 'submitted') throw new TakeError('state', 'only a submitted stocktake can be sent back'); this.db.prepare("UPDATE stocktakes SET status='open', submitted_by=NULL, submitted_at=NULL WHERE id=?").run(id); this.hub.audit(actor.id, 'stocktake.reopened', 'stocktake', String(t.st_no), { reason: reason.trim() }); });
  }
  cancelStocktake(actor: Person, id: string, reason: string): void {
    this.need(actor, 'stocktake.count'); if (!reason?.trim()) throw new TakeError('invalid', 'a reason is required');
    this.db.tx(() => {
      const t = this.take(id); if (t.status !== 'open' && t.status !== 'submitted') throw new TakeError('state', 'a closed stocktake cannot be cancelled');
      if (String(t.created_by) !== actor.id && !can(actor, 'stocktake.approve', this.hub.branchId)) throw new TakeError('forbidden', 'only its starter or an approver may cancel');
      this.db.prepare("UPDATE stocktakes SET status='cancelled', cancel_reason=?, decided_by=?, decided_at=? WHERE id=?").run(reason.trim(), actor.id, this.hub.now(), id);
      this.hub.audit(actor.id, 'stocktake.cancelled', 'stocktake', String(t.st_no), { reason: reason.trim() });
    });
  }
  list(actor: Person, status?: string): { id: string; stNo: string; storeId: string; status: string; createdBy: string; createdAt: string }[] {
    this.need(actor, 'stocktake.count');
    return this.db.prepare(`SELECT id, st_no, store_id, status, created_by, created_at FROM stocktakes ${status ? 'WHERE status=?' : ''} ORDER BY rowid DESC`).all(...(status ? [status] : [])).map(r => ({ id: String(r.id), stNo: String(r.st_no), storeId: String(r.store_id), status: String(r.status), createdBy: String(r.created_by), createdAt: String(r.created_at) }));
  }
}
