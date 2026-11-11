import { StateMachineError, can, normalizeSearch, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import type { ItemService } from '@o-pharmacy/inventory';
import { ITEM_MACHINE, deriveStatus, isBackward, isFinal, type DerivedStatus, type ItemState } from './states';

export type OpsErrorCode = 'forbidden' | 'invalid' | 'not-found' | 'state' | 'duplicate';
export class OpsError extends Error { constructor(public code: OpsErrorCode, m: string, public detail?: unknown) { super(m); } }
export type RequestKind = 'customer_request' | 'shortage';
export interface RequestItemInput { itemId?: string; itemName?: string; qty?: number }
export interface RequestItem { id: string; lineNo: number; itemId: string | null; itemName: string; qty: number; status: ItemState; assignedTo: string | null }
export interface RequestView { id: string; ref: string; kind: RequestKind; customerId: string | null; customerName: string | null; ownerId: string; notes: string | null; createdBy: string; createdAt: string; status: DerivedStatus; items: RequestItem[] }
export interface TimelineEntry { at: string; type: 'event' | 'comment'; itemName: string | null; from?: string | null; to?: string; reason?: string | null; body?: string; by: string }
const LEAD = ['O', 'A', 'M'];

/** Customer requests (a customer is waiting and must be told) and shortages (out of stock, nobody waiting) share one item lifecycle. The header status is derived, never stored. Every change is one transaction: row, event, audit, outbox. Nothing is deleted: an item is cancelled with a reason. */
export class RequestService {
  constructor(private hub: Hub, private items: ItemService) {}
  private get db() { return this.hub.db; }
  private isLead(a: Person): boolean { return a.roles.some(r => LEAD.includes(r)); }
  private writePerm(kind: RequestKind): string { return kind === 'shortage' ? 'shortage.record' : 'customer_request.update'; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  private canRead(a: Person, kind: RequestKind): boolean { return kind === 'shortage' ? can(a, 'shortage.view', this.hub.branchId) : ['customer_request.create', 'customer_request.update', 'customer_request.cancel'].some(p => can(a, p, this.hub.branchId)); }
  private next(k: string, prefix: string): string { const n = Number(this.db.prepare('SELECT v FROM ops_counters WHERE k=?').get(k)?.v ?? 0) + 1; this.db.prepare('INSERT INTO ops_counters(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, n); return `${prefix}-${String(n).padStart(6, '0')}`; }
  private reqRow(idOrRef: string) { const r = this.db.prepare('SELECT * FROM requests WHERE id=? OR ref=?').get(idOrRef, idOrRef); if (!r) throw new OpsError('not-found', `request ${idOrRef}`); return r; }
  private itemRow(id: string) { const r = this.db.prepare('SELECT i.*, r.kind, r.ref, r.owner_id FROM request_items i JOIN requests r ON r.id = i.request_id WHERE i.id=?').get(id); if (!r) throw new OpsError('not-found', `request item ${id}`); return r; }
  private view(r: Record<string, unknown>): RequestView {
    const items = this.db.prepare('SELECT * FROM request_items WHERE request_id=? ORDER BY line_no').all(String(r.id)).map(i => ({ id: String(i.id), lineNo: Number(i.line_no), itemId: (i.item_id as string) ?? null, itemName: String(i.item_name), qty: Number(i.qty), status: i.status as ItemState, assignedTo: (i.assigned_to as string) ?? null }));
    const cu = r.customer_id ? this.db.prepare('SELECT name FROM customers WHERE id=?').get(String(r.customer_id)) : undefined;
    return { id: String(r.id), ref: String(r.ref), kind: r.kind as RequestKind, customerId: (r.customer_id as string) ?? null, customerName: cu ? String(cu.name) : null, ownerId: String(r.owner_id), notes: (r.notes as string) ?? null, createdBy: String(r.created_by), createdAt: String(r.created_at), status: deriveStatus(items.map(i => i.status)), items };
  }
  private addLine(requestId: string, lineNo: number, it: RequestItemInput, by: string): void {
    const qty = it.qty ?? 1; if (!Number.isInteger(qty) || qty < 1) throw new OpsError('invalid', 'quantity must be a whole number, at least 1'); let name = it.itemName?.trim() ?? '';
    if (it.itemId) { const m = this.items.get(it.itemId); if (!m) throw new OpsError('not-found', `item ${it.itemId}`); if (!name) name = m.nameAr; } if (!name) throw new OpsError('invalid', 'an item needs a name or a catalogue item');
    const id = uuidv7(), now = this.hub.now(); this.db.prepare('INSERT INTO request_items(id,request_id,line_no,item_id,item_name,qty,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, requestId, lineNo, it.itemId ?? null, name, qty, now, now);
    this.db.prepare('INSERT INTO request_item_events(id,request_item_id,from_status,to_status,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), id, null, 'pending_purchase', by, now);
  }
  private open(actor: Person, kind: RequestKind, r: { key: string; customerId?: string; notes?: string; ownerId?: string; items: RequestItemInput[] }): { request: RequestView; replay: boolean } {
    if (!r.items?.length) throw new OpsError('invalid', 'at least one item is required'); if (r.ownerId && r.ownerId !== actor.id && !this.isLead(actor)) throw new OpsError('forbidden', 'only a manager may give a request to someone else');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT * FROM requests WHERE req_key=?').get(r.key); if (prior) return { request: this.view(prior), replay: true };
      if (kind === 'customer_request') { if (!r.customerId) throw new OpsError('invalid', 'a customer request needs a customer'); if (!this.db.prepare('SELECT 1 FROM customers WHERE id=?').get(r.customerId)) throw new OpsError('not-found', 'customer'); }
      const id = uuidv7(), ref = this.next(kind, kind === 'shortage' ? 'NQ' : 'CR'), now = this.hub.now();
      this.db.prepare('INSERT INTO requests(id,ref,req_key,kind,customer_id,owner_id,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, ref, r.key, kind, kind === 'customer_request' ? r.customerId! : null, r.ownerId ?? actor.id, r.notes?.trim() || null, actor.id, now);
      r.items.forEach((it, i) => this.addLine(id, i + 1, it, actor.id)); this.hub.audit(actor.id, `request.${kind}.created`, 'request', ref, { items: r.items.length }); this.hub.emit('request.created', { ref, kind, items: r.items.length });
      return { request: this.view(this.reqRow(id)), replay: false };
    });
  }
  /** A customer is waiting (`customer_request.create`). Starts every item at `pending_purchase`. */
  createRequest(actor: Person, r: { key: string; customerId: string; notes?: string; ownerId?: string; items: RequestItemInput[] }) { this.need(actor, 'customer_request.create'); return this.open(actor, 'customer_request', r); }
  /** Out of stock, nobody waiting (`shortage.record`): its own NQ reference, closes at `stocked` once the stock arrives. */
  createShortage(actor: Person, r: { key: string; notes?: string; ownerId?: string; items: RequestItemInput[] }) { this.need(actor, 'shortage.record'); return this.open(actor, 'shortage', r); }
  addItem(actor: Person, requestId: string, it: RequestItemInput): RequestView {
    const r = this.reqRow(requestId); this.need(actor, this.writePerm(r.kind as RequestKind));
    return this.db.tx(() => { const n = Number(this.db.prepare('SELECT COALESCE(MAX(line_no),0) m FROM request_items WHERE request_id=?').get(String(r.id))!.m) + 1; this.addLine(String(r.id), n, it, actor.id); this.hub.audit(actor.id, 'request.item.added', 'request', String(r.ref), { lineNo: n }); this.hub.emit('request.updated', { ref: String(r.ref) }); return this.view(r); });
  }
  updateRequest(actor: Person, requestId: string, p: { notes?: string; ownerId?: string }): RequestView {
    const r = this.reqRow(requestId); this.need(actor, this.writePerm(r.kind as RequestKind)); if (p.ownerId && p.ownerId !== r.owner_id && !this.isLead(actor)) throw new OpsError('forbidden', 'only a manager may change the owner');
    return this.db.tx(() => { this.db.prepare('UPDATE requests SET notes=?, owner_id=? WHERE id=?').run(p.notes === undefined ? r.notes ?? null : p.notes.trim() || null, p.ownerId ?? r.owner_id, String(r.id)); this.hub.audit(actor.id, 'request.updated', 'request', String(r.ref), { fields: Object.keys(p) }); this.hub.emit('request.updated', { ref: String(r.ref) }); return this.view(this.reqRow(String(r.id))); });
  }

  /** The one place an item changes state: checks the shared machine, a reason for any undo or reopen, then writes the item, the event, the audit entry and the outbox message together. Used by the flows of the later sprints (orders, verification, delivery) that decide who may do which edge. @internal */
  move(actor: Person, itemId: string, to: ItemState, o: { reason?: string; data?: Record<string, unknown> } = {}): RequestItem {
    return this.db.tx(() => {
      const r = this.itemRow(itemId); const from = r.status as ItemState; try { ITEM_MACHINE.assert(from, to); } catch (e) { if (e instanceof StateMachineError) throw new OpsError('state', e.message, { from, to }); throw e; }
      const reason = o.reason?.trim(); if ((isBackward(from, to) || to === 'cancelled') && !reason) throw new OpsError('invalid', 'a reason is required'); const now = this.hub.now();
      this.db.prepare('UPDATE request_items SET status=?, updated_at=? WHERE id=?').run(to, now, itemId); this.db.prepare('INSERT INTO request_item_events(id,request_item_id,from_status,to_status,reason,data,by,at) VALUES(?,?,?,?,?,?,?,?)').run(uuidv7(), itemId, from, to, reason ?? null, o.data ? JSON.stringify(o.data) : null, actor.id, now);
      this.hub.audit(actor.id, `request.item.${to}`, 'request_item', itemId, { ref: String(r.ref), from, reason: reason ?? null }); this.hub.emit('request.item.moved', { ref: String(r.ref), kind: String(r.kind), itemName: String(r.item_name), from, to });
      const x = this.itemRow(itemId); return { id: String(x.id), lineNo: Number(x.line_no), itemId: (x.item_id as string) ?? null, itemName: String(x.item_name), qty: Number(x.qty), status: x.status as ItemState, assignedTo: (x.assigned_to as string) ?? null };
    });
  }
  private guarded(actor: Person, itemId: string): ReturnType<RequestService['itemRow']> { const r = this.itemRow(itemId); this.need(actor, this.writePerm(r.kind as RequestKind)); return r; }
  /** Cancel one item (never deleted; the reason stays). `customer_request.cancel` for a customer request. */
  cancelItem(actor: Person, itemId: string, reason: string): RequestItem { const r = this.itemRow(itemId); this.need(actor, r.kind === 'shortage' ? 'shortage.record' : 'customer_request.cancel'); return this.move(actor, itemId, 'cancelled', { reason }); }
  /** Cancel every item that is not final yet. Items already delivered or closed stay as they are. */
  cancelRequest(actor: Person, requestId: string, reason: string): RequestView {
    const r = this.reqRow(requestId); this.need(actor, r.kind === 'shortage' ? 'shortage.record' : 'customer_request.cancel'); if (!reason?.trim()) throw new OpsError('invalid', 'a reason is required');
    return this.db.tx(() => { const live = this.db.prepare('SELECT id, status FROM request_items WHERE request_id=?').all(String(r.id)).filter(i => !isFinal(i.status as ItemState)); if (!live.length) throw new OpsError('state', 'nothing left to cancel'); for (const i of live) this.move(actor, String(i.id), 'cancelled', { reason }); return this.view(this.reqRow(String(r.id))); });
  }
  /** «ناقص من الشركة»: the supplier cannot provide it. */
  markUnavailable(actor: Person, itemId: string, reason: string): RequestItem { this.guarded(actor, itemId); return this.move(actor, itemId, 'unavailable', { reason }); }
  /** «اتوفر»: it can be had after all, back to be ordered. */
  markAvailable(actor: Person, itemId: string, reason: string): RequestItem { this.guarded(actor, itemId); return this.move(actor, itemId, 'pending_purchase', { reason }); }
  /** Close an unavailable item; for a customer request the customer must have been told. */
  closeUnavailable(actor: Person, itemId: string, o: { customerInformed: boolean; reason: string }): RequestItem { const r = this.guarded(actor, itemId); if (r.kind === 'customer_request' && !o.customerInformed) throw new OpsError('invalid', 'tell the customer first, then close'); return this.move(actor, itemId, 'closed_unavailable', { reason: o.reason, data: { customerInformed: o.customerInformed } }); }
  /** Undo a close: managers only. */
  reopenUnavailable(actor: Person, itemId: string, reason: string): RequestItem { this.guarded(actor, itemId); if (!this.isLead(actor)) throw new OpsError('forbidden', 'only a manager may reopen a closed item'); return this.move(actor, itemId, 'unavailable', { reason }); }

  /** Take an item to work on (one person at a time). Managers may hand it to someone else with `assign`. */
  claim(actor: Person, itemId: string): RequestItem { const r = this.guarded(actor, itemId); if (isFinal(r.status as ItemState)) throw new OpsError('state', 'this item is finished'); if (r.assigned_to && r.assigned_to !== actor.id) throw new OpsError('state', 'someone else is working on this item', { assignedTo: String(r.assigned_to) }); return this.setAssignee(actor, itemId, actor.id, 'claimed'); }
  release(actor: Person, itemId: string): RequestItem { const r = this.guarded(actor, itemId); if (!r.assigned_to) throw new OpsError('state', 'nobody is working on this item'); if (r.assigned_to !== actor.id && !this.isLead(actor)) throw new OpsError('forbidden', 'only the person working on it, or a manager, can release it'); return this.setAssignee(actor, itemId, null, 'released'); }
  assign(actor: Person, itemId: string, userId: string): RequestItem { this.guarded(actor, itemId); if (!this.isLead(actor)) throw new OpsError('forbidden', 'only a manager may assign work'); return this.setAssignee(actor, itemId, userId, 'assigned'); }
  private setAssignee(actor: Person, itemId: string, to: string | null, what: string): RequestItem {
    return this.db.tx(() => { const r = this.itemRow(itemId); this.db.prepare('UPDATE request_items SET assigned_to=?, updated_at=? WHERE id=?').run(to, this.hub.now(), itemId); this.hub.audit(actor.id, `request.item.${what}`, 'request_item', itemId, { ref: String(r.ref), to }); this.hub.emit('request.item.assigned', { ref: String(r.ref), to }); const x = this.itemRow(itemId); return { id: String(x.id), lineNo: Number(x.line_no), itemId: (x.item_id as string) ?? null, itemName: String(x.item_name), qty: Number(x.qty), status: x.status as ItemState, assignedTo: (x.assigned_to as string) ?? null }; });
  }
  /** A comment on a request or on one of its items; append-only. */
  comment(actor: Person, c: { requestId: string; itemId?: string; body: string }): void {
    const r = this.reqRow(c.requestId); this.need(actor, this.writePerm(r.kind as RequestKind)); if (!c.body?.trim()) throw new OpsError('invalid', 'a comment cannot be empty'); if (c.itemId && !this.db.prepare('SELECT 1 FROM request_items WHERE id=? AND request_id=?').get(c.itemId, String(r.id))) throw new OpsError('not-found', 'item of this request');
    this.db.tx(() => { this.db.prepare('INSERT INTO request_comments(id,request_id,request_item_id,body,by,at) VALUES(?,?,?,?,?,?)').run(uuidv7(), String(r.id), c.itemId ?? null, c.body.trim(), actor.id, this.hub.now()); this.hub.audit(actor.id, 'request.commented', 'request', String(r.ref), { itemId: c.itemId ?? null }); });
  }

  get(actor: Person, idOrRef: string): RequestView { const r = this.reqRow(idOrRef); if (!this.canRead(actor, r.kind as RequestKind)) throw new OpsError('forbidden', 'you may not see these requests'); return this.view(r); }
  list(actor: Person, o: { kind?: RequestKind; status?: DerivedStatus; ownerId?: string; customerId?: string; q?: string; limit?: number } = {}): RequestView[] {
    const w: string[] = []; const a: unknown[] = []; if (o.kind) { w.push('r.kind=?'); a.push(o.kind); } if (o.ownerId) { w.push('r.owner_id=?'); a.push(o.ownerId); } if (o.customerId) { w.push('r.customer_id=?'); a.push(o.customerId); }
    if (o.q?.trim()) { w.push("(r.ref LIKE ? OR EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND i.item_name LIKE ?) OR EXISTS (SELECT 1 FROM customers c WHERE c.id = r.customer_id AND c.search_text LIKE ?))"); const q = `%${o.q.trim()}%`; a.push(q, q, `%${normalizeSearch(o.q)}%`); }
    return this.db.prepare(`SELECT r.* FROM requests r ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.rowid DESC`).all(...a).filter(r => this.canRead(actor, r.kind as RequestKind)).map(r => this.view(r)).filter(v => !o.status || v.status === o.status).slice(0, o.limit ?? 100);
  }
  /** Items still open that are mine (claimed by me) or on a request I own. */
  myWork(actor: Person): { requestRef: string; kind: RequestKind; customerName: string | null; item: RequestItem }[] {
    return this.db.prepare("SELECT i.id, r.ref FROM request_items i JOIN requests r ON r.id = i.request_id WHERE i.status NOT IN ('delivered','cancelled','not_collected','stocked','closed_unavailable') AND (i.assigned_to=? OR (i.assigned_to IS NULL AND r.owner_id=?)) ORDER BY i.rowid").all(actor.id, actor.id).map(x => { const it = this.itemRow(String(x.id)); const cu = it.kind === 'customer_request' ? this.db.prepare('SELECT c.name FROM customers c JOIN requests r ON r.customer_id = c.id WHERE r.id=?').get(String(it.request_id)) : undefined; return { requestRef: String(x.ref), kind: it.kind as RequestKind, customerName: cu ? String(cu.name) : null, item: { id: String(it.id), lineNo: Number(it.line_no), itemId: (it.item_id as string) ?? null, itemName: String(it.item_name), qty: Number(it.qty), status: it.status as ItemState, assignedTo: (it.assigned_to as string) ?? null } }; });
  }
  /** What happened to a request, oldest first: item state changes (with who and why) and comments. */
  timeline(actor: Person, idOrRef: string): TimelineEntry[] {
    const r = this.reqRow(idOrRef); if (!this.canRead(actor, r.kind as RequestKind)) throw new OpsError('forbidden', 'you may not see these requests');
    const ev = this.db.prepare('SELECT e.*, i.item_name FROM request_item_events e JOIN request_items i ON i.id = e.request_item_id WHERE i.request_id=?').all(String(r.id)).map(e => ({ at: String(e.at), seq: Number(e.seq), type: 'event' as const, itemName: String(e.item_name), from: (e.from_status as string) ?? null, to: String(e.to_status), reason: (e.reason as string) ?? null, by: String(e.by) }));
    const cm = this.db.prepare('SELECT c.*, i.item_name FROM request_comments c LEFT JOIN request_items i ON i.id = c.request_item_id WHERE c.request_id=?').all(String(r.id)).map(c => ({ at: String(c.at), seq: 1e9 + Number(c.seq), type: 'comment' as const, itemName: (c.item_name as string) ?? null, body: String(c.body), by: String(c.by) }));
    return [...ev, ...cm].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq).map(({ seq: _s, ...x }) => x);
  }
}
