import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { OpsError, type RequestService } from './requests';

const LEAD = ['O', 'A', 'M'];
export type HandoverStep = 'dispatched' | 'delivered' | 'failed' | 'not_collected';
export interface Handover { step: HandoverStep; method: string | null; address: string | null; receiver: string | null; note: string | null; by: string; at: string }

/** The last mile of a customer request: the customer comes to the counter (pickup) or the order goes out (home delivery), or the customer never comes. Every step is recorded (who, when, who received it) on top of `RequestService.move`. Needs `customer_request.update`; reopening a delivered item is for managers. */
export class DeliveryService {
  constructor(private hub: Hub, private reqs: RequestService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  private item(id: string) { const r = this.db.prepare('SELECT i.status, r.kind FROM request_items i JOIN requests r ON r.id=i.request_id WHERE i.id=?').get(id); if (!r) throw new OpsError('not-found', 'request item'); if (r.kind !== 'customer_request') throw new OpsError('invalid', 'a shortage is not handed to a customer'); return r; }
  private log(actor: Person, itemId: string, step: HandoverStep, o: { method?: string; address?: string; receiver?: string; note?: string }): void { this.db.prepare('INSERT INTO item_handovers(id,request_item_id,step,method,address,receiver,note,by,at) VALUES(?,?,?,?,?,?,?,?,?)').run(uuidv7(), itemId, step, o.method ?? null, o.address?.trim() || null, o.receiver?.trim() || null, o.note?.trim() || null, actor.id, this.hub.now()); }
  /** The customer was told and the order goes out: needs an address. */
  dispatch(actor: Person, itemId: string, o: { address: string; note?: string }): void {
    this.need(actor, 'customer_request.update'); if (!o.address?.trim()) throw new OpsError('invalid', 'an address is required');
    this.db.tx(() => { this.item(itemId); this.reqs.move(actor, itemId, 'out_for_delivery', { data: { address: o.address.trim() } }); this.log(actor, itemId, 'dispatched', { method: 'home', address: o.address, note: o.note }); });
  }
  /** Handed over, at the counter (from notified) or at the door (from out for delivery). Needs the receiver's name. */
  deliver(actor: Person, itemId: string, o: { receiver: string; note?: string }): void {
    this.need(actor, 'customer_request.update'); if (!o.receiver?.trim()) throw new OpsError('invalid', 'who received it is required');
    this.db.tx(() => { const r = this.item(itemId); const method = r.status === 'out_for_delivery' ? 'home' : 'pickup'; this.reqs.move(actor, itemId, 'delivered', { data: { receiver: o.receiver.trim(), method } }); this.log(actor, itemId, 'delivered', { method, receiver: o.receiver, note: o.note }); });
  }
  /** The courier could not hand it over: back to notified, with the reason. */
  failDelivery(actor: Person, itemId: string, reason: string): void {
    this.need(actor, 'customer_request.update'); if (!reason?.trim()) throw new OpsError('invalid', 'a reason is required');
    this.db.tx(() => { this.item(itemId); this.reqs.move(actor, itemId, 'notified', { reason }); this.log(actor, itemId, 'failed', { note: reason }); });
  }
  /** The customer never came: the item is closed as not collected, with the reason. */
  markNotCollected(actor: Person, itemId: string, reason: string): void {
    this.need(actor, 'customer_request.update'); if (!reason?.trim()) throw new OpsError('invalid', 'a reason is required');
    this.db.tx(() => { this.item(itemId); this.reqs.move(actor, itemId, 'not_collected', { data: { reason: reason.trim() } }); this.log(actor, itemId, 'not_collected', { note: reason }); });
  }
  /** Undo a hand-over or a not-collected close (managers only, with a reason): the item goes back to notified. */
  reopen(actor: Person, itemId: string, reason: string): void {
    this.need(actor, 'customer_request.update'); if (!actor.roles.some(r => LEAD.includes(r))) throw new OpsError('forbidden', 'only a manager may reopen a handed-over item');
    this.db.tx(() => { this.item(itemId); this.reqs.move(actor, itemId, 'notified', { reason }); });
  }
  history(actor: Person, itemId: string): Handover[] { this.need(actor, 'customer_request.create'); return this.db.prepare('SELECT * FROM item_handovers WHERE request_item_id=? ORDER BY seq').all(itemId).map(h => ({ step: h.step as HandoverStep, method: (h.method as string) ?? null, address: (h.address as string) ?? null, receiver: (h.receiver as string) ?? null, note: (h.note as string) ?? null, by: String(h.by), at: String(h.at) })); }
  /** Items out for delivery, and told-but-not-collected items older than `days` (default 7): the lists staff work from. */
  board(actor: Person, days = 7) {
    this.need(actor, 'customer_request.create'); const cut = new Date(Date.parse(this.hub.now()) - days * 86400000).toISOString();
    const rows = (sql: string, ...a: unknown[]) => this.db.prepare(sql).all(...a).map(x => ({ requestItemId: String(x.id), ref: String(x.ref), customerName: String(x.name), itemName: String(x.item_name), since: String(x.updated_at) }));
    const base = 'SELECT i.id, i.item_name, i.updated_at, r.ref, c.name FROM request_items i JOIN requests r ON r.id=i.request_id JOIN customers c ON c.id=r.customer_id WHERE';
    return { outForDelivery: rows(`${base} i.status='out_for_delivery' ORDER BY i.updated_at`), waitingTooLong: rows(`${base} i.status='notified' AND i.updated_at <= ? ORDER BY i.updated_at`, cut) };
  }
}
