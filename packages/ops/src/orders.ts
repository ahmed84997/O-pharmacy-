import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { OpsError, type RequestService } from './requests';
import type { ItemState } from './states';

export const ORDER_STAGES = ['ordered', 'received', 'counted', 'entered', 'labelled', 'shelved'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];
export type CountResult = 'arrived' | 'missing' | 'damaged';
export interface StageEntry { stage: OrderStage; by: string; at: string; minutesSincePrev: number | null; note: string | null }
export interface NotifyChannel { channel: 'phone' | 'whatsapp' | 'sms' | 'in_person' }

/** The life of a purchase order after it is sent, ported from YK: ordered, received, counted, entered, labelled, shelved. Each stage is stamped once (who, when, minutes since the previous stage) and must follow the one before it. "Entered" is not typed in: it needs a posted (not void) supplier invoice on the order. Counting moves the linked request items: arrived goes on to the customer (or to stock for a shortage), missing or damaged goes back to be bought again. Nothing is deleted. */
export class OrderStageService {
  constructor(private hub: Hub, private reqs: RequestService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  private po(id: string) { const o = this.db.prepare('SELECT * FROM purchase_orders WHERE id=? OR po_no=?').get(id, id); if (!o) throw new OpsError('not-found', `purchase order ${id}`); return o; }
  private done(poId: string): StageEntry[] { return this.db.prepare('SELECT * FROM order_stages WHERE po_id=? ORDER BY seq').all(poId).map(s => ({ stage: s.stage as OrderStage, by: String(s.by), at: String(s.at), minutesSincePrev: s.minutes_since_prev === null ? null : Number(s.minutes_since_prev), note: (s.note as string) ?? null })); }
  private stamp(actor: Person, poId: string, stage: OrderStage, note?: string): void {
    const have = this.done(poId); if (have.some(h => h.stage === stage)) throw new OpsError('state', `stage ${stage} is already done`);
    const prev = ORDER_STAGES[ORDER_STAGES.indexOf(stage) - 1]; const p = prev ? have.find(h => h.stage === prev) : undefined; if (prev && !p) throw new OpsError('state', `${prev} must be done before ${stage}`);
    const now = this.hub.now(); const mins = p ? Math.max(0, Math.round((Date.parse(now) - Date.parse(p.at)) / 60000)) : null;
    this.db.prepare('INSERT INTO order_stages(id,po_id,stage,by,at,minutes_since_prev,note) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), poId, stage, actor.id, now, mins, note?.trim() || null);
    this.hub.audit(actor.id, `po.stage.${stage}`, 'purchase_order', poId, { minutes: mins }); this.hub.emit('po.stage', { poId, stage });
  }
  private linked(poId: string) { return this.db.prepare("SELECT i.id, i.status, r.kind FROM request_item_orders l JOIN request_items i ON i.id=l.request_item_id JOIN requests r ON r.id=i.request_id WHERE l.po_id=? ORDER BY l.rowid").all(poId); }

  /** Attach a request item (a customer's item or a shortage) to an order that is not yet received: the item moves from pending purchase to ordered. */
  link(actor: Person, requestItemId: string, poId: string): void {
    this.need(actor, 'purchase_order.update');
    this.db.tx(() => {
      const o = this.po(poId); if (o.status === 'cancelled' || o.status === 'received') throw new OpsError('state', `order is ${String(o.status)}`);
      if (this.done(String(o.id)).some(s => s.stage === 'received')) throw new OpsError('state', 'the goods were already received');
      const it = this.db.prepare('SELECT status FROM request_items WHERE id=?').get(requestItemId); if (!it) throw new OpsError('not-found', 'request item');
      if (this.db.prepare('SELECT 1 FROM request_item_orders WHERE request_item_id=? AND po_id=?').get(requestItemId, String(o.id))) throw new OpsError('duplicate', 'already on this order');
      this.reqs.move(actor, requestItemId, 'ordered', { data: { po: String(o.po_no) } });
      this.db.prepare('INSERT INTO request_item_orders(id,request_item_id,po_id,by,at) VALUES(?,?,?,?,?)').run(uuidv7(), requestItemId, String(o.id), actor.id, this.hub.now());
    });
  }
  /** The order went to the supplier (the order must be in status sent). */
  markOrdered(actor: Person, poId: string, note?: string): StageEntry[] {
    this.need(actor, 'purchase_order.update');
    return this.db.tx(() => { const o = this.po(poId); if (o.status !== 'sent') throw new OpsError('state', 'send the order first'); this.stamp(actor, String(o.id), 'ordered', note); return this.done(String(o.id)); });
  }
  /** The goods are at the door: linked items go to awaiting verification. */
  receive(actor: Person, poId: string, note?: string): StageEntry[] {
    this.need(actor, 'receiving.verify');
    return this.db.tx(() => { const o = this.po(poId); const id = String(o.id); this.stamp(actor, id, 'received', note); for (const i of this.linked(id)) if (i.status === 'ordered') this.reqs.move(actor, String(i.id), 'awaiting_verification', { data: { po: String(o.po_no) } }); return this.done(id); });
  }
  /** Count the goods. Every linked item waiting for verification needs a result. */
  count(actor: Person, poId: string, results: { requestItemId: string; result: CountResult; note?: string }[]): StageEntry[] {
    this.need(actor, 'receiving.verify');
    return this.db.tx(() => {
      const o = this.po(poId); const id = String(o.id); const waiting = this.linked(id).filter(i => i.status === 'awaiting_verification');
      const by = new Map<string, (typeof results)[number]>(); for (const r of results) { if (by.has(r.requestItemId)) throw new OpsError('invalid', 'an item is listed twice'); by.set(r.requestItemId, r); }
      for (const r of results) if (!waiting.some(w => String(w.id) === r.requestItemId)) throw new OpsError('invalid', 'an item is not waiting for verification on this order');
      for (const w of waiting) if (!by.has(String(w.id))) throw new OpsError('invalid', 'every item on the order needs a count result');
      this.stamp(actor, id, 'counted');
      for (const w of waiting) {
        const r = by.get(String(w.id))!; if (r.result !== 'arrived' && !r.note?.trim()) throw new OpsError('invalid', 'a note is required for a missing or damaged item');
        this.db.prepare('INSERT INTO count_results(id,po_id,request_item_id,result,note,by,at) VALUES(?,?,?,?,?,?,?)').run(uuidv7(), id, String(w.id), r.result, r.note?.trim() || null, actor.id, this.hub.now());
        const to: ItemState = r.result !== 'arrived' ? 'pending_purchase' : w.kind === 'shortage' ? 'stocked' : 'ready_to_notify';
        this.reqs.move(actor, String(w.id), to, { reason: r.result !== 'arrived' ? `${r.result}: ${r.note!.trim()}` : undefined, data: { po: String(o.po_no), result: r.result } });
      }
      return this.done(id);
    });
  }
  /** The supplier invoice is in the stock system: needs a posted invoice on this order. */
  markEntered(actor: Person, poId: string): StageEntry[] {
    this.need(actor, 'receiving.verify');
    return this.db.tx(() => { const o = this.po(poId); const id = String(o.id); if (!this.db.prepare("SELECT 1 FROM purchase_invoices WHERE po_id=? AND status='posted'").get(id)) throw new OpsError('state', 'post the supplier invoice on this order first'); this.stamp(actor, id, 'entered'); return this.done(id); });
  }
  markLabelled(actor: Person, poId: string): StageEntry[] { this.need(actor, 'receiving.verify'); return this.db.tx(() => { const id = String(this.po(poId).id); this.stamp(actor, id, 'labelled'); return this.done(id); }); }
  markShelved(actor: Person, poId: string): StageEntry[] { this.need(actor, 'receiving.verify'); return this.db.tx(() => { const id = String(this.po(poId).id); this.stamp(actor, id, 'shelved'); return this.done(id); }); }
  stages(actor: Person, poId: string): StageEntry[] { this.need(actor, 'purchase_order.create'); return this.done(String(this.po(poId).id)); }
  /** Orders that have started but not finished the stages, with the stage they wait for. */
  open(actor: Person): { poNo: string; waitingFor: OrderStage; sinceMinutes: number }[] {
    this.need(actor, 'purchase_order.create'); const now = Date.parse(this.hub.now());
    return this.db.prepare('SELECT DISTINCT po_id FROM order_stages').all().map(r => String(r.po_id)).flatMap(id => { const d = this.done(id); if (d.length === ORDER_STAGES.length) return []; const last = d[d.length - 1]!; return [{ poNo: String(this.po(id).po_no), waitingFor: ORDER_STAGES[d.length]!, sinceMinutes: Math.round((now - Date.parse(last.at)) / 60000) }]; });
  }
}

/** Telling the customer. The system writes the message (a fixed Arabic template) and records that staff told them; it never sends to a real number by itself. Telling moves the item from ready to notify (or reserved) to notified. */
export class NotificationService {
  constructor(private hub: Hub, private reqs: RequestService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new OpsError('forbidden', `missing permission ${perm}`); }
  /** Customer items waiting to be told, oldest first, each with the ready-to-copy message. */
  toNotify(actor: Person) {
    this.need(actor, 'notification.view');
    return this.db.prepare("SELECT i.id, i.item_name, i.qty, c.id cid, c.name, c.phone FROM request_items i JOIN requests r ON r.id=i.request_id JOIN customers c ON c.id=r.customer_id WHERE i.status IN ('ready_to_notify','reserved') ORDER BY i.updated_at, i.id").all()
      .map(x => ({ requestItemId: String(x.id), customerId: String(x.cid), customerName: String(x.name), phone: (x.phone as string) ?? null, itemName: String(x.item_name), qty: Number(x.qty), message: NotificationService.message(String(x.name), String(x.item_name)) }));
  }
  static message(customer: string, item: string): string { return `أهلا ${customer}، طلبك (${item}) وصل صيدلية O Pharmacy وجاهز للاستلام. شكرا لك.`; }
  /** Record that the customer was told and move the item to notified. */
  notify(actor: Person, requestItemId: string, channel: NotifyChannel['channel']): { id: string; body: string } {
    this.need(actor, 'notification.send');
    return this.db.tx(() => {
      const x = this.db.prepare('SELECT i.item_name, i.status, r.customer_id, c.name FROM request_items i JOIN requests r ON r.id=i.request_id LEFT JOIN customers c ON c.id=r.customer_id WHERE i.id=?').get(requestItemId); if (!x) throw new OpsError('not-found', 'request item');
      if (!x.customer_id) throw new OpsError('invalid', 'a shortage has no customer to tell');
      this.reqs.move(actor, requestItemId, 'notified', { data: { channel } }); const id = uuidv7(); const body = NotificationService.message(String(x.name), String(x.item_name));
      this.db.prepare('INSERT INTO notifications(id,request_item_id,customer_id,channel,template,body,by,at) VALUES(?,?,?,?,?,?,?,?)').run(id, requestItemId, String(x.customer_id), channel, 'ready_for_pickup', body, actor.id, this.hub.now());
      this.hub.audit(actor.id, 'notification.sent', 'request_item', requestItemId, { channel }); this.hub.emit('notification.recorded', { requestItemId, channel }); return { id, body };
    });
  }
  history(actor: Person, requestItemId: string) { this.need(actor, 'notification.view'); return this.db.prepare('SELECT channel, template, body, by, at FROM notifications WHERE request_item_id=? ORDER BY seq').all(requestItemId).map(n => ({ channel: String(n.channel), template: String(n.template), body: String(n.body), by: String(n.by), at: String(n.at) })); }
}
