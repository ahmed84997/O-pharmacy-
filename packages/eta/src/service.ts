import { can, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import type { ItemService } from '@o-pharmacy/inventory';
import type { ReturnService, SaleService } from '@o-pharmacy/pos';
import { EtaBuildError, returnDocument, saleDocument, voidDocument, type EtaConfig } from './document';
import { etaUuid } from './serialize';
import { EtaHttpError, type EtaTransport } from './transport';

export class EtaError extends Error { constructor(public code: 'forbidden' | 'invalid' | 'not-found' | 'state' | 'window-closed', message: string) { super(message); } }
export interface QueueRow { id: string; kind: 'sale' | 'return' | 'void'; ref: string; docType: 's' | 'r'; device: string; uuid: string; previousUuid: string; referenceUuid: string | null; oldUuid: string | null; issuedAt: string; deadlineAt: string; status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'replaced'; attempts: number; nextAttemptAt: string | null; lastError: string | null; longId: string | null; submissionUuid: string | null }
export interface EtaAlert { ref: string; kind: string; status: string; level: 'warning' | 'critical' | 'expired' | 'rejected'; minutesLeft: number; error: string | null }
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** ETA e-receipt adapter (D26). Every sale, return and void becomes a receipt whose UUID is computed on the Hub at once (offline works), chained per cashier terminal; submission is a queue with retries, a 24 hour deadline clock and alerts. The sale flow never waits for ETA. */
export class EtaService {
  constructor(private hub: Hub, private sales: SaleService, private returns: ReturnService, private items: ItemService, private transport: EtaTransport, private cfg: () => EtaConfig, private o: { batchSize?: number } = {}) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new EtaError('forbidden', `missing permission ${perm}`); }
  private row(r: Record<string, unknown>): QueueRow { return { id: String(r.id), kind: r.kind as QueueRow['kind'], ref: String(r.ref), docType: r.doc_type as 's' | 'r', device: String(r.device), uuid: String(r.uuid), previousUuid: String(r.previous_uuid), referenceUuid: (r.reference_uuid as string) ?? null, oldUuid: (r.old_uuid as string) ?? null, issuedAt: String(r.issued_at), deadlineAt: String(r.deadline_at), status: r.status as QueueRow['status'], attempts: Number(r.attempts), nextAttemptAt: (r.next_attempt_at as string) ?? null, lastError: (r.last_error as string) ?? null, longId: (r.long_id as string) ?? null, submissionUuid: (r.submission_uuid as string) ?? null }; }
  private itemOf = (id: string) => { const i = this.items.get(id); if (!i) throw new EtaBuildError('item-code', `item ${id} not found`); return i; };
  private current(kind: string, ref: string) { return this.db.prepare("SELECT * FROM eta_receipts WHERE kind=? AND ref=? AND status<>'replaced'").get(kind, ref); }
  private lastUuid(device: string): string { return String(this.db.prepare('SELECT uuid FROM eta_receipts WHERE device=? AND old_uuid IS NULL ORDER BY seq DESC LIMIT 1').get(device)?.uuid ?? ''); }
  private terminalOf(saleNo: string): string { const r = this.db.prepare('SELECT c.terminal FROM sales s JOIN cashier_sessions c ON c.id = s.session_id WHERE s.sale_no=?').get(saleNo); if (!r) throw new EtaError('not-found', saleNo); return String(r.terminal); }

  /** Build, number and store one receipt. `previous` and `old` are set only when a rejected receipt is corrected (same place in the chain, new UUID, pointing at the old one). */
  private store(actor: Person, k: { kind: 'sale' | 'return' | 'void'; ref: string; device: string; issuedAt: string; referenceUuid?: string; build: (previousUuid: string, oldUuid?: string) => Record<string, unknown>; old?: QueueRow; reason?: string }): QueueRow {
    const previous = k.old ? k.old.previousUuid : this.lastUuid(k.device); const doc = k.build(previous, k.old?.uuid); const uuid = etaUuid(doc as never); (doc.header as Record<string, unknown>).uuid = uuid;
    const window = k.old ? 96 * HOUR : 24 * HOUR; const id = uuidv7(); const now = this.hub.now();
    this.db.prepare('INSERT INTO eta_receipts(id,kind,ref,doc_type,device,uuid,previous_uuid,reference_uuid,old_uuid,payload,issued_at,deadline_at,next_attempt_at,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, k.kind, k.ref, (doc.documentType as { receiptType: string }).receiptType, k.device, uuid, previous, k.referenceUuid ?? null, k.old?.uuid ?? null, JSON.stringify(doc), k.issuedAt, iso(Date.parse(k.issuedAt) + window), now, k.reason ?? null, actor.id, now);
    this.hub.audit(actor.id, k.old ? 'eta.receipt.corrected' : 'eta.receipt.queued', 'eta_receipt', id, { kind: k.kind, ref: k.ref, uuid, oldUuid: k.old?.uuid ?? null, reason: k.reason ?? null }); this.hub.emit('eta.queued', { kind: k.kind, ref: k.ref, uuid });
    return this.row(this.db.prepare('SELECT * FROM eta_receipts WHERE id=?').get(id)!);
  }
  private saleBuild(actor: Person, saleNo: string, k: { old?: QueueRow; reason?: string } = {}): QueueRow {
    const sale = this.sales.sale(actor, saleNo); const device = this.cfg().deviceSerial(this.terminalOf(saleNo)); const cfg = this.cfg();
    return this.store(actor, { kind: 'sale', ref: saleNo, device, issuedAt: sale.createdAt, build: (prev, old) => saleDocument(sale, this.itemOf, device, prev, cfg, old), ...k });
  }
  private refOf(saleNo: string): QueueRow { const r = this.current('sale', saleNo); if (!r) throw new EtaBuildError('reference', `sale ${saleNo} has no ETA receipt yet`); return this.row(r); }
  private returnBuild(actor: Person, saleNo: string, returnNo: string, k: { old?: QueueRow; reason?: string } = {}): QueueRow {
    const sale = this.sales.sale(actor, saleNo); const ret = this.returns.returnsOf(actor, saleNo).find(r => r.returnNo === returnNo); if (!ret) throw new EtaError('not-found', returnNo); const orig = this.refOf(saleNo); const cfg = this.cfg();
    return this.store(actor, { kind: 'return', ref: returnNo, device: orig.device, issuedAt: ret.at, referenceUuid: orig.uuid, build: (prev, old) => returnDocument(sale, ret, sale.createdAt, this.itemOf, orig.device, prev, orig.uuid, cfg, old), ...k });
  }
  private voidBuild(actor: Person, saleNo: string, k: { old?: QueueRow; reason?: string } = {}): QueueRow {
    const sale = this.sales.sale(actor, saleNo); const orig = this.refOf(saleNo); const at = String(this.db.prepare('SELECT void_at FROM sales WHERE sale_no=?').get(saleNo)?.void_at ?? this.hub.now()); const cfg = this.cfg();
    return this.store(actor, { kind: 'void', ref: saleNo, device: orig.device, issuedAt: at, referenceUuid: orig.uuid, build: (prev, old) => voidDocument(sale, at, `V-${saleNo}`, sale.createdAt, this.itemOf, orig.device, prev, orig.uuid, cfg, old), ...k });
  }

  /** Queue the receipt of a posted sale (once). A sale voided before it was ever queued needs no receipt. Needs a person who can read all sales (the Hub's system account). */
  enqueueSale(actor: Person, saleNo: string): { receipt: QueueRow | null; replay: boolean } {
    this.need(actor, 'compliance.eta.retry'); return this.db.tx(() => { const ex = this.current('sale', saleNo); if (ex) return { receipt: this.row(ex), replay: true }; if (this.sales.sale(actor, saleNo).status !== 'posted') return { receipt: null, replay: false }; return { receipt: this.saleBuild(actor, saleNo), replay: false }; });
  }
  enqueueReturn(actor: Person, saleNo: string, returnNo: string): { receipt: QueueRow; replay: boolean } {
    this.need(actor, 'compliance.eta.retry'); return this.db.tx(() => { const ex = this.current('return', returnNo); if (ex) return { receipt: this.row(ex), replay: true }; return { receipt: this.returnBuild(actor, saleNo, returnNo), replay: false }; });
  }
  /** A void after the sale receipt exists is a full return receipt (ETA has no delete either). */
  enqueueVoid(actor: Person, saleNo: string): { receipt: QueueRow; replay: boolean } {
    this.need(actor, 'compliance.eta.retry'); return this.db.tx(() => { const ex = this.current('void', saleNo); if (ex) return { receipt: this.row(ex), replay: true }; if (this.sales.sale(actor, saleNo).status !== 'void') throw new EtaError('state', 'the sale is not void'); return { receipt: this.voidBuild(actor, saleNo), replay: false }; });
  }
  /** Queue everything that has no receipt yet, in the order it happened (so the chain follows real time). A document that cannot be built (an item without an ETA code, a missing setting) is reported in `problems` and tried again on the next scan; it never blocks the others. */
  scan(actor: Person): { queued: number; problems: { ref: string; kind: string; message: string }[] } {
    this.need(actor, 'compliance.eta.retry'); type Ev = { at: string; kind: 'sale' | 'void' | 'return'; ref: string; saleNo: string };
    const ev: Ev[] = []; for (const s of this.db.prepare('SELECT sale_no, status, created_at, void_at FROM sales ORDER BY rowid').all()) { const no = String(s.sale_no); if (!this.current('sale', no)) { if (s.status === 'posted') ev.push({ at: String(s.created_at), kind: 'sale', ref: no, saleNo: no }); } else if (s.status === 'void' && !this.current('void', no)) ev.push({ at: String(s.void_at), kind: 'void', ref: no, saleNo: no }); }
    for (const r of this.db.prepare('SELECT r.return_no, r.at, s.sale_no FROM sale_returns r JOIN sales s ON s.id = r.sale_id ORDER BY r.rowid').all()) if (!this.current('return', String(r.return_no))) ev.push({ at: String(r.at), kind: 'return', ref: String(r.return_no), saleNo: String(r.sale_no) });
    ev.sort((a, b) => a.at.localeCompare(b.at)); let queued = 0; const problems: { ref: string; kind: string; message: string }[] = [];
    for (const e of ev) { try { this.db.tx(() => { if (e.kind === 'sale') this.saleBuild(actor, e.ref); else if (e.kind === 'void') this.voidBuild(actor, e.ref); else this.returnBuild(actor, e.saleNo, e.ref); }); queued++; } catch (x) { if (x instanceof EtaBuildError) problems.push({ ref: e.ref, kind: e.kind, message: x.message }); else throw x; } }
    return { queued, problems };
  }

  /** Send what is due, in order, in one batch. Receipts past their deadline become `expired` first (a person decides, see `resubmit`). A refused submission or a dead line keeps the receipts pending and backs off (1, 2, 4 ... 60 minutes, or ETA's Retry-After). */
  async drain(actor: Person): Promise<{ sent: number; accepted: number; rejected: number; expired: number; error?: string }> {
    this.need(actor, 'compliance.eta.retry'); const now = this.hub.now(); const expired = this.db.prepare("UPDATE eta_receipts SET status='expired', last_error='deadline passed before ETA accepted it' WHERE status='pending' AND deadline_at < ?").run(now).changes;
    const due = this.db.prepare("SELECT * FROM eta_receipts WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY seq LIMIT ?").all(now, this.o.batchSize ?? 20); if (!due.length) return { sent: 0, accepted: 0, rejected: 0, expired: Number(expired) };
    const note = (id: string, outcome: string, http: number | null, detail: string | null) => this.db.prepare('INSERT INTO eta_attempts(receipt_id,at,outcome,http_status,detail) VALUES(?,?,?,?,?)').run(id, this.hub.now(), outcome, http, detail);
    try {
      const res = await this.transport.submit(due.map(r => JSON.parse(String(r.payload)))); let acc = 0, rej = 0; const byUuid = new Map(due.map(r => [String(r.uuid), r]));
      this.db.tx(() => {
        for (const a of res.accepted) { const r = byUuid.get(a.uuid); if (!r) continue; this.db.prepare("UPDATE eta_receipts SET status='accepted', long_id=?, submission_uuid=?, settled_at=?, attempts=attempts+1, last_error=NULL WHERE id=?").run(a.longId, res.submissionUuid, this.hub.now(), r.id); note(String(r.id), 'accepted', 202, a.longId); this.hub.emit('eta.accepted', { kind: String(r.kind), ref: String(r.ref), uuid: a.uuid }); acc++; }
        for (const x of res.rejected) { const r = byUuid.get(x.uuid); if (!r) continue; const msg = `${x.error.message}${x.error.propertyPath ? ' (' + x.error.propertyPath + ')' : ''}`; this.db.prepare("UPDATE eta_receipts SET status='rejected', submission_uuid=?, settled_at=?, attempts=attempts+1, last_error=? WHERE id=?").run(res.submissionUuid, this.hub.now(), msg, r.id); note(String(r.id), 'rejected', 202, msg); this.hub.audit(actor.id, 'eta.receipt.rejected', 'eta_receipt', String(r.id), { ref: String(r.ref), message: msg }); this.hub.emit('eta.rejected', { kind: String(r.kind), ref: String(r.ref), message: msg }); rej++; }
      });
      return { sent: due.length, accepted: acc, rejected: rej, expired: Number(expired) };
    } catch (e) {
      const err = e instanceof EtaHttpError ? e : new EtaHttpError(0, 'Unknown', (e as Error).message); const base = Date.parse(this.hub.now());
      this.db.tx(() => { for (const r of due) { const n = Number(r.attempts) + 1; const wait = err.retryAfterSec !== undefined ? err.retryAfterSec * 1000 : Math.min(60, 2 ** (n - 1)) * 60_000; this.db.prepare('UPDATE eta_receipts SET attempts=?, next_attempt_at=?, last_error=? WHERE id=?').run(n, iso(base + wait), `${err.code}: ${err.message}`, r.id); note(String(r.id), 'error', err.status || null, `${err.code}: ${err.message}`); } });
      return { sent: due.length, accepted: 0, rejected: 0, expired: Number(expired), error: `${err.code}: ${err.message}` };
    }
  }
  /** Issue a corrected receipt for a rejected one (after the cause, usually an item code, was fixed), or for an expired one (`compliance.eta.late_submit`). Same place in the chain, a new UUID, `referenceOldUUID` pointing at the old one; allowed for 96 hours from the original issue. */
  resubmit(actor: Person, id: string, reason: string): QueueRow {
    const old = this.db.prepare('SELECT * FROM eta_receipts WHERE id=?').get(id); if (!old) throw new EtaError('not-found', id); const o = this.row(old);
    this.need(actor, o.status === 'expired' ? 'compliance.eta.late_submit' : 'compliance.eta.retry'); if (!reason?.trim()) throw new EtaError('invalid', 'a reason is required'); if (o.status !== 'rejected' && o.status !== 'expired') throw new EtaError('state', `a ${o.status} receipt cannot be corrected`);
    if (Date.parse(this.hub.now()) > Date.parse(o.issuedAt) + 96 * HOUR) throw new EtaError('window-closed', 'more than 96 hours since the receipt was issued: ETA no longer accepts a correction');
    return this.db.tx(() => { this.db.prepare("UPDATE eta_receipts SET status='replaced' WHERE id=?").run(id); const k = { old: o, reason: reason.trim() }; return o.kind === 'sale' ? this.saleBuild(actor, o.ref, k) : o.kind === 'void' ? this.voidBuild(actor, o.ref, k) : this.returnBuild(actor, String(this.db.prepare('SELECT s.sale_no FROM sale_returns r JOIN sales s ON s.id = r.sale_id WHERE r.return_no=?').get(o.ref)?.sale_no), o.ref, k); });
  }

  /** What needs a person: receipts close to their deadline (under 6 hours: warning, under 1 hour: critical), expired ones, and rejected ones. */
  alerts(actor: Person): EtaAlert[] {
    this.need(actor, 'compliance.eta.view'); const now = Date.parse(this.hub.now()); const out: EtaAlert[] = [];
    for (const r of this.db.prepare("SELECT * FROM eta_receipts WHERE status IN ('pending','rejected','expired') ORDER BY deadline_at").all()) {
      const left = Math.floor((Date.parse(String(r.deadline_at)) - now) / 60_000); const status = String(r.status); const base = { ref: String(r.ref), kind: String(r.kind), status, minutesLeft: left, error: (r.last_error as string) ?? null };
      if (status === 'expired' || left < 0) out.push({ ...base, level: 'expired' }); else if (status === 'rejected') out.push({ ...base, level: 'rejected' }); else if (left < 60) out.push({ ...base, level: 'critical' }); else if (left < 360) out.push({ ...base, level: 'warning' });
    }
    return out;
  }
  queue(actor: Person, o: { status?: QueueRow['status']; limit?: number } = {}): QueueRow[] { this.need(actor, 'compliance.eta.view'); return this.db.prepare(`SELECT * FROM eta_receipts ${o.status ? 'WHERE status=?' : ''} ORDER BY seq DESC LIMIT ?`).all(...(o.status ? [o.status] : []), o.limit ?? 100).map(r => this.row(r)); }
  receiptOf(actor: Person, kind: QueueRow['kind'], ref: string): QueueRow | null { this.need(actor, 'compliance.eta.view'); const r = this.current(kind, ref); return r ? this.row(r) : null; }
  attempts(actor: Person, id: string) { this.need(actor, 'compliance.eta.view'); return this.db.prepare('SELECT at, outcome, http_status, detail FROM eta_attempts WHERE receipt_id=? ORDER BY seq').all(id).map(a => ({ at: String(a.at), outcome: String(a.outcome), httpStatus: a.http_status === null ? null : Number(a.http_status), detail: (a.detail as string) ?? null })); }
  /** The text of the QR printed on the customer's receipt: a link to the receipt in the ETA portal (`{portal}/receipts/search/{uuid}/share/{issued UTC}#Total:{total},IssuerRIN:{rin}`). The UUID exists from the moment of the sale, so the QR prints even offline. */
  qrText(saleNo: string): string | null {
    const r = this.current('sale', saleNo); if (!r) return null; const c = this.cfg(); const total = (JSON.parse(String(r.payload)) as { totalAmount: number }).totalAmount;
    return `${c.portalUrl.replace(/\/$/, '')}/receipts/search/${String(r.uuid)}/share/${String(r.issued_at).replace(/\.\d+Z$/, 'Z')}#Total:${total.toFixed(3)},IssuerRIN:${c.seller.rin}`;
  }
}
