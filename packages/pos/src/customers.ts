import { can, normalizeSearch, uuidv7, type Person } from '@o-pharmacy/core';
import type { Hub } from '@o-pharmacy/hub';
import { PosError, type SaleService } from './sales';

export interface Customer { id: string; code: string; name: string; phone: string | null; address: string | null; kind: 'person' | 'company'; creditLimitMinor: number; notes: string | null; active: boolean; balanceMinor: number }
export interface CustomerInput { name: string; phone?: string; kind?: 'person' | 'company'; notes?: string; address?: string; /** keep an existing code (customers from eStock, D38); new customers get the next plain number */ code?: string }
export interface StatementLine { at: string; kind: string; ref: string | null; note: string | null; debitMinor: number; creditMinor: number; balanceMinor: number }

/** Customers and their account: a credit sale adds to what the customer owes, a payment or an account refund reduces it. The balance is the sum of an append-only ledger (never edited: a mistake is a correcting entry). */
export class CustomerService {
  constructor(private hub: Hub, private sales: SaleService) {}
  private get db() { return this.hub.db; }
  private need(a: Person, perm: string): void { if (!can(a, perm, this.hub.branchId)) throw new PosError('forbidden', `missing permission ${perm}`); }
  private toCustomer(r: Record<string, unknown>): Customer { return { id: String(r.id), code: String(r.code), name: String(r.name), phone: (r.phone as string) ?? null, address: (r.address as string) ?? null, kind: r.kind as Customer['kind'], creditLimitMinor: Number(r.credit_limit_minor), notes: (r.notes as string) ?? null, active: Number(r.active) === 1, balanceMinor: this.sales.customerBalance(String(r.id)) }; }
  private row(id: string) { const r = this.db.prepare('SELECT * FROM customers WHERE id=?').get(id); if (!r) throw new PosError('not-found', `customer ${id}`); return r; }
  private phone(p?: string): string | null { const t = p?.trim().replace(/[\s-]/g, ''); if (!t) return null; const a = t.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))); if (!/^\+?\d{6,15}$/.test(a)) throw new PosError('invalid', 'unreadable phone number'); return a; }

  create(actor: Person, c: CustomerInput): Customer {
    this.need(actor, 'customer.create'); const name = c.name?.trim(); if (!name) throw new PosError('invalid', 'customer name is required'); const phone = this.phone(c.phone);
    if (phone && this.db.prepare('SELECT 1 FROM customers WHERE phone=?').get(phone)) throw new PosError('invalid', 'a customer with this phone exists');
    const id = uuidv7(); return this.db.tx(() => {
      /* plain numbers 1, 2, 3 (D38): the next number after the counter and after any numeric code already used (imported customers keep theirs) */
      const given = c.code?.trim(); if (given && (!/^[A-Za-z0-9-]{1,20}$/.test(given) || this.db.prepare('SELECT 1 FROM customers WHERE code=?').get(given))) throw new PosError('invalid', 'customer code is taken or unreadable');
      const maxNum = Number(this.db.prepare("SELECT COALESCE(MAX(CAST(code AS INTEGER)),0) m FROM customers WHERE code GLOB '[0-9]*' AND code NOT GLOB '*[^0-9]*'").get()!.m);
      const n = Math.max(Number(this.db.prepare("SELECT v FROM pos_counters WHERE k='customer'").get()?.v ?? 0), maxNum) + (given ? 0 : 1);
      const code = given ?? String(n); const counter = given && /^\d+$/.test(given) ? Math.max(n, Number(given)) : n;
      this.db.prepare("INSERT INTO pos_counters(k,v) VALUES('customer',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(counter);
      const address = c.address?.trim() || null; if (address && address.length > 300) throw new PosError('invalid', 'address is too long');
      this.db.prepare('INSERT INTO customers(id,code,name,phone,kind,notes,address,search_text,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, code, name, phone, c.kind ?? 'person', c.notes ?? null, address, normalizeSearch(`${name} ${phone ?? ''} ${code} ${address ?? ''}`), actor.id, this.hub.now());
      this.hub.audit(actor.id, 'customer.created', 'customer', id, { code, name }); this.hub.emit('customer.created', { id, code, name }); return this.toCustomer(this.row(id));
    });
  }
  update(actor: Person, id: string, p: Partial<CustomerInput>): Customer {
    this.need(actor, 'customer.update'); const cur = this.row(id); const name = p.name === undefined ? String(cur.name) : p.name.trim(); if (!name) throw new PosError('invalid', 'customer name is required'); const phone = p.phone === undefined ? ((cur.phone as string) ?? null) : this.phone(p.phone);
    if (phone && phone !== cur.phone && this.db.prepare('SELECT 1 FROM customers WHERE phone=?').get(phone)) throw new PosError('invalid', 'a customer with this phone exists');
    const address = p.address === undefined ? ((cur.address as string) ?? null) : p.address.trim() || null; if (address && address.length > 300) throw new PosError('invalid', 'address is too long');
    return this.db.tx(() => { this.db.prepare('UPDATE customers SET name=?, phone=?, kind=?, notes=?, address=?, search_text=? WHERE id=?').run(name, phone, p.kind ?? cur.kind, p.notes ?? cur.notes ?? null, address, normalizeSearch(`${name} ${phone ?? ''} ${String(cur.code)} ${address ?? ''}`), id); this.hub.audit(actor.id, 'customer.updated', 'customer', id, { fields: Object.keys(p) }); this.hub.emit('customer.updated', { id }); return this.toCustomer(this.row(id)); });
  }
  /** The most this customer may owe at one time (0 = no credit). */
  setCreditLimit(actor: Person, id: string, limitMinor: number, reason: string): Customer {
    this.need(actor, 'customer.credit_limit.set'); this.row(id); if (!Number.isInteger(limitMinor) || limitMinor < 0) throw new PosError('invalid', 'limit must be whole piasters, zero or more'); if (!reason?.trim()) throw new PosError('invalid', 'a reason is required');
    return this.db.tx(() => { const old = Number(this.row(id).credit_limit_minor); this.db.prepare('UPDATE customers SET credit_limit_minor=? WHERE id=?').run(limitMinor, id); this.hub.audit(actor.id, 'customer.credit_limit', 'customer', id, { from: old, to: limitMinor, reason: reason.trim() }); this.hub.emit('customer.credit_limit', { id, limitMinor }); return this.toCustomer(this.row(id)); });
  }
  /** Customers are never deleted; a suspended customer cannot buy on credit (history and balance stay). */
  setActive(actor: Person, id: string, active: boolean, reason: string): void {
    this.need(actor, 'customer.update'); this.row(id); if (!reason?.trim()) throw new PosError('invalid', 'a reason is required');
    this.db.tx(() => { this.db.prepare('UPDATE customers SET active=? WHERE id=?').run(active ? 1 : 0, id); this.db.prepare('INSERT INTO customer_status_log(customer_id,active,reason,by,at) VALUES(?,?,?,?,?)').run(id, active ? 1 : 0, reason.trim(), actor.id, this.hub.now()); this.hub.audit(actor.id, 'customer.active', 'customer', id, { active, reason: reason.trim() }); });
  }
  get(actor: Person, id: string): Customer { this.need(actor, 'customer.view'); return this.toCustomer(this.row(id)); }
  search(actor: Person, q: string, o: { includeInactive?: boolean; limit?: number } = {}): Customer[] {
    this.need(actor, 'customer.view'); const n = normalizeSearch(q ?? ''); const exact = (q ?? '').trim().replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
    /* a customer whose code or phone is exactly what was typed comes first (the cashier types the code for a delivery) */
    return this.db.prepare(`SELECT * FROM customers WHERE (? OR active=1) AND search_text LIKE ? ORDER BY (code = ? OR phone = ?) DESC, name LIMIT ?`).all(o.includeInactive ? 1 : 0, `%${n}%`, exact, exact, o.limit ?? 50).map(r => this.toCustomer(r));
  }
  /** An opening balance (what the customer owed before this system): needs the credit-limit permission, only while the account is empty. */
  openingBalance(actor: Person, id: string, amountMinor: number, note: string): void {
    this.need(actor, 'customer.credit_limit.set'); this.row(id); if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new PosError('invalid', 'amount must be a positive whole number of piasters');
    this.db.tx(() => { if (this.db.prepare('SELECT 1 FROM customer_ledger WHERE customer_id=?').get(id)) throw new PosError('state', 'the account already has entries'); this.db.prepare("INSERT INTO customer_ledger(id,customer_id,kind,amount_minor,note,by,at) VALUES(?,?,'opening',?,?,?,?)").run(uuidv7(), id, amountMinor, note?.trim() || 'opening balance', actor.id, this.hub.now()); this.hub.audit(actor.id, 'customer.opening_balance', 'customer', id, { amountMinor }); });
  }

  /** The customer pays against the balance (توريد نقدية): cash goes into the drawer of the receiver's open session, card is recorded with its reference. Never more than the balance. */
  receivePayment(actor: Person, p: { key: string; customerId: string; sessionId: string; amountMinor: number; method: 'cash' | 'card'; ref?: string; note?: string }): { balanceMinor: number; replay: boolean } {
    this.need(actor, 'sale.create'); if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0) throw new PosError('invalid', 'amount must be a positive whole number of piasters'); if (p.method === 'card' && !p.ref?.trim()) throw new PosError('invalid', 'a card payment needs its approval reference');
    return this.db.tx(() => {
      const prior = this.db.prepare('SELECT customer_id FROM customer_ledger WHERE req_key=?').get(p.key); if (prior) return { balanceMinor: this.sales.customerBalance(String(prior.customer_id)), replay: true };
      const sess = this.sales.session(p.sessionId); if (sess.status !== 'open') throw new PosError('session', 'the session is closed'); if (String(sess.user_id) !== actor.id) throw new PosError('session', 'this session belongs to another user');
      this.row(p.customerId); const bal = this.sales.customerBalance(p.customerId); if (p.amountMinor > bal) throw new PosError('invalid', 'the payment is more than the balance', { balanceMinor: bal });
      this.db.prepare("INSERT INTO customer_ledger(id,customer_id,kind,amount_minor,method,ref,session_id,note,req_key,by,at) VALUES(?,?,'payment',?,?,?,?,?,?,?,?)").run(uuidv7(), p.customerId, -p.amountMinor, p.method, p.ref?.trim() ?? null, p.sessionId, p.note ?? null, p.key, actor.id, this.hub.now());
      this.hub.audit(actor.id, 'customer.payment', 'customer', p.customerId, { amountMinor: p.amountMinor, method: p.method, sessionNo: String(sess.session_no) }); this.hub.emit('customer.payment', { customerId: p.customerId, amountMinor: p.amountMinor, method: p.method, sessionNo: String(sess.session_no) });
      return { balanceMinor: bal - p.amountMinor, replay: false };
    });
  }
  /** Statement of account with a running balance; a date range starts from the balance before it. */
  statement(actor: Person, id: string, o: { fromIso?: string; toIso?: string } = {}): { customer: Customer; opening: number; lines: StatementLine[]; closing: number } {
    this.need(actor, 'customer.view'); const c = this.toCustomer(this.row(id)); const opening = o.fromIso ? Number(this.db.prepare('SELECT COALESCE(SUM(amount_minor),0) b FROM customer_ledger WHERE customer_id=? AND at < ?').get(id, o.fromIso)!.b) : 0; let bal = opening;
    const w = ['customer_id=?']; const a: unknown[] = [id]; if (o.fromIso) { w.push('at >= ?'); a.push(o.fromIso); } if (o.toIso) { w.push('at <= ?'); a.push(o.toIso); }
    const lines = this.db.prepare(`SELECT * FROM customer_ledger WHERE ${w.join(' AND ')} ORDER BY seq`).all(...a).map(r => { const v = Number(r.amount_minor); bal += v; return { at: String(r.at), kind: String(r.kind), ref: (r.ref as string) ?? null, note: (r.note as string) ?? null, debitMinor: v > 0 ? v : 0, creditMinor: v < 0 ? -v : 0, balanceMinor: bal }; });
    return { customer: c, opening, lines, closing: bal };
  }
  /** Who owes money, biggest first (the collection list). */
  owing(actor: Person): { customerId: string; code: string; name: string; phone: string | null; balanceMinor: number; creditLimitMinor: number }[] {
    this.need(actor, 'customer.view');
    return this.db.prepare('SELECT c.id, c.code, c.name, c.phone, c.credit_limit_minor, SUM(l.amount_minor) b FROM customers c JOIN customer_ledger l ON l.customer_id = c.id GROUP BY c.id HAVING b > 0 ORDER BY b DESC, c.name').all().map(r => ({ customerId: String(r.id), code: String(r.code), name: String(r.name), phone: (r.phone as string) ?? null, balanceMinor: Number(r.b), creditLimitMinor: Number(r.credit_limit_minor) }));
  }
}
