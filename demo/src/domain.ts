/* O Pharmacy demo - pure business logic (no UI). Everything returns a new Db; nothing is ever deleted (No-Delete, D13). */

export type Role = 'owner' | 'manager' | 'pharmacist' | 'cashier';
export type SaleType = 'cash' | 'card' | 'credit' | 'delivery';

export interface Item {
  id: string; name: string; drug: boolean; packUnit: string; subUnit: string; perPack: number;
  barcode: string; publicPrice: number; suspended: boolean; otherBranchQty: number; alt: string[];
}
export interface Batch {
  id: string; itemId: string; expiry: string; qty: number; costPack: number; pricePack: number; receivedOn: string; priceChanged?: boolean;
}
export interface Customer { id: string; name: string; kind: 'cash' | 'credit' | 'contract'; balance: number; limit: number; suspended: boolean }
export interface Supplier { id: string; name: string; balance: number }
export interface SaleLine {
  itemId: string; batchId: string; unit: 'pack' | 'sub'; qty: number; qtyBase: number; unitPrice: number; discountPct: number; total: number; cost: number;
}
export interface Invoice {
  id: string; no: string; type: SaleType; customerId: string; lines: SaleLine[]; gross: number; discount: number; net: number; cost: number;
  at: string; by: Role; status: 'saved' | 'void'; voidReason?: string; voidBy?: Role; voidAt?: string;
}
export interface PurchaseLine { itemId: string; batchId: string; expiry: string; qtyPack: number; bonusPack: number; costPack: number; pricePack: number }
export interface Purchase { id: string; no: string; supplierId: string; lines: PurchaseLine[]; total: number; paid: number; at: string; by: Role }
export interface Movement { id: string; at: string; kind: 'sale' | 'void-return' | 'purchase'; batchId: string; qtyBase: number; ref: string }
export interface Shortage { id: string; itemId: string; source: 'no-stock' | 'manual'; at: string; by: Role; status: 'open' | 'ordered' }
export interface Want { key: string; itemId: string; unit: 'pack' | 'sub'; qty: number; discountPct: number; batchId?: string }
export interface Receipt { id: string; no: string; customerId: string; amount: number; method: 'cash' | 'card'; at: string; by: Role; balanceAfter: number }
export interface Held { id: string; type: SaleType; customerId: string; wants: Want[]; at: string }

export interface Db {
  today: string;
  items: Item[]; batches: Batch[]; customers: Customer[]; suppliers: Supplier[];
  invoices: Invoice[]; purchases: Purchase[]; movements: Movement[]; shortages: Shortage[]; held: Held[]; receipts: Receipt[];
  counters: { sale: number; purchase: number; receipt: number; id: number };
}

export const BRANCH = 'B1';
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const canSeeCost = (r: Role) => r === 'owner' || r === 'manager';
export const canVoid = (r: Role) => r === 'owner' || r === 'manager';
export const canPurchase = (r: Role) => r !== 'cashier';
export const canSeeDeleted = (r: Role) => r === 'owner' || r === 'manager';

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const isExpired = (b: Batch, today: string) => b.expiry < today;
export const daysTo = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);

export const nextId = (db: Db, p: string): [Db, string] => [{ ...db, counters: { ...db.counters, id: db.counters.id + 1 } }, `${p}${db.counters.id + 1}`];

export const itemById = (db: Db, id: string) => db.items.find(i => i.id === id);
export const customerById = (db: Db, id: string) => db.customers.find(c => c.id === id);

export const stockOf = (db: Db, itemId: string) =>
  db.batches.filter(b => b.itemId === itemId && !isExpired(b, db.today)).reduce((s, b) => s + b.qty, 0);

export function searchItems(db: Db, q: string, limit = 12): Item[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const exact = db.items.filter(i => i.barcode === s);
  if (exact.length) return exact;
  return db.items.filter(i => i.name.toLowerCase().includes(s) || i.barcode.startsWith(s)).slice(0, limit);
}

/** FEFO: nearest expiry first, expired batches never sold. A forced batch overrides the order. */
export function allocate(db: Db, itemId: string, needBase: number, forcedBatchId?: string): { parts: { batch: Batch; qty: number }[]; missing: number } {
  let pool = db.batches.filter(b => b.itemId === itemId && b.qty > 0 && !isExpired(b, db.today));
  if (forcedBatchId) pool = pool.filter(b => b.id === forcedBatchId);
  pool.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.receivedOn.localeCompare(b.receivedOn));
  const parts: { batch: Batch; qty: number }[] = [];
  let left = needBase;
  for (const b of pool) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    parts.push({ batch: b, qty: take }); left -= take;
  }
  return { parts, missing: left };
}

export interface Priced { lines: SaleLine[]; missing: { itemId: string; missingBase: number }[]; gross: number; discount: number; net: number; cost: number }

export function priceCart(db: Db, wants: Want[]): Priced {
  const lines: SaleLine[] = []; const missing: Priced['missing'] = [];
  for (const w of wants) {
    const it = itemById(db, w.itemId); if (!it || w.qty <= 0) continue;
    const need = w.unit === 'pack' ? w.qty * it.perPack : w.qty;
    const { parts, missing: m } = allocate(db, w.itemId, need, w.batchId);
    if (m > 0) missing.push({ itemId: w.itemId, missingBase: m });
    for (const p of parts) {
      const perBase = p.batch.pricePack / it.perPack;
      const unitPrice = w.unit === 'pack' ? p.batch.pricePack : round2(perBase);
      const qty = w.unit === 'pack' ? p.qty / it.perPack : p.qty;
      const gross = round2(unitPrice * qty);
      const total = round2(gross * (1 - w.discountPct / 100));
      lines.push({ itemId: w.itemId, batchId: p.batch.id, unit: w.unit, qty, qtyBase: p.qty, unitPrice, discountPct: w.discountPct, total, cost: round2(p.batch.costPack / it.perPack * p.qty) });
    }
  }
  const gross = round2(lines.reduce((s, l) => s + round2(l.unitPrice * l.qty), 0));
  const net = round2(lines.reduce((s, l) => s + l.total, 0));
  return { lines, missing, gross, discount: round2(gross - net), net, cost: round2(lines.reduce((s, l) => s + l.cost, 0)) };
}

export type Err = { ok: false; error: string };
export type Ok<T> = { ok: true; db: Db } & T;

export function saveSale(db: Db, a: { wants: Want[]; type: SaleType; customerId: string; role: Role; now: string }): Ok<{ invoice: Invoice }> | Err {
  const cust = customerById(db, a.customerId);
  if (!cust) return { ok: false, error: 'no-customer' };
  if (a.wants.length === 0) return { ok: false, error: 'empty' };
  for (const w of a.wants) { const it = itemById(db, w.itemId); if (it?.suspended) return { ok: false, error: 'suspended' }; }
  const p = priceCart(db, a.wants);
  if (p.missing.length) return { ok: false, error: 'insufficient-stock' };
  if (p.lines.length === 0) return { ok: false, error: 'empty' };
  if ((a.type === 'credit') && (cust.kind === 'cash' || cust.suspended)) return { ok: false, error: 'credit-not-allowed' };
  if (a.type === 'credit' && cust.balance + p.net > cust.limit) return { ok: false, error: 'credit-limit' };
  const n = db.counters.sale + 1;
  const inv: Invoice = { id: `inv${n}`, no: `${BRANCH}-${String(n).padStart(6, '0')}`, type: a.type, customerId: a.customerId, lines: p.lines, gross: p.gross, discount: p.discount, net: p.net, cost: p.cost, at: a.now, by: a.role, status: 'saved' };
  const used = new Map<string, number>();
  const mv: Movement[] = p.lines.map((l, i) => { used.set(l.batchId, (used.get(l.batchId) ?? 0) + l.qtyBase); return { id: `m${db.counters.id + i + 1}`, at: a.now, kind: 'sale', batchId: l.batchId, qtyBase: -l.qtyBase, ref: inv.no }; });
  const out: Db = {
    ...db,
    batches: db.batches.map(b => used.has(b.id) ? { ...b, qty: b.qty - used.get(b.id)! } : b),
    customers: a.type === 'credit' ? db.customers.map(c => c.id === cust.id ? { ...c, balance: round2(c.balance + p.net) } : c) : db.customers,
    invoices: [inv, ...db.invoices], movements: [...mv, ...db.movements],
    counters: { ...db.counters, sale: n, id: db.counters.id + mv.length },
  };
  return { ok: true, db: out, invoice: inv };
}

/** Void instead of delete (D13): stock comes back as a movement, the invoice stays with who/when/why. */
export function voidSale(db: Db, invoiceId: string, reason: string, role: Role, now: string): Ok<{}> | Err {
  if (!canVoid(role)) return { ok: false, error: 'forbidden' };
  if (!reason.trim()) return { ok: false, error: 'reason-required' };
  const inv = db.invoices.find(i => i.id === invoiceId);
  if (!inv) return { ok: false, error: 'not-found' };
  if (inv.status === 'void') return { ok: false, error: 'already-void' };
  const back = new Map<string, number>();
  for (const l of inv.lines) back.set(l.batchId, (back.get(l.batchId) ?? 0) + l.qtyBase);
  const mv: Movement[] = inv.lines.map((l, i) => ({ id: `m${db.counters.id + i + 1}`, at: now, kind: 'void-return', batchId: l.batchId, qtyBase: l.qtyBase, ref: inv.no }));
  return {
    ok: true,
    db: {
      ...db,
      batches: db.batches.map(b => back.has(b.id) ? { ...b, qty: b.qty + back.get(b.id)! } : b),
      customers: inv.type === 'credit' ? db.customers.map(c => c.id === inv.customerId ? { ...c, balance: round2(c.balance - inv.net) } : c) : db.customers,
      invoices: db.invoices.map(i => i.id === invoiceId ? { ...i, status: 'void', voidReason: reason.trim(), voidBy: role, voidAt: now } : i),
      movements: [...mv, ...db.movements], counters: { ...db.counters, id: db.counters.id + mv.length },
    },
  };
}

export function holdSale(db: Db, a: { wants: Want[]; type: SaleType; customerId: string; now: string }): Ok<{}> | Err {
  if (a.wants.length === 0) return { ok: false, error: 'empty' };
  const [d2, id] = nextId(db, 'h');
  return { ok: true, db: { ...d2, held: [{ id, type: a.type, customerId: a.customerId, wants: a.wants, at: a.now }, ...d2.held] } };
}
export function resumeHeld(db: Db, id: string): { db: Db; held: Held } | null {
  const h = db.held.find(x => x.id === id); if (!h) return null;
  return { db: { ...db, held: db.held.filter(x => x.id !== id) }, held: h };
}

export function addShortage(db: Db, itemId: string, source: Shortage['source'], role: Role, now: string): Db {
  if (db.shortages.some(s => s.itemId === itemId && s.status === 'open')) return db;
  const [d2, id] = nextId(db, 's');
  return { ...d2, shortages: [{ id, itemId, source, at: now, by: role, status: 'open' }, ...d2.shortages] };
}

export interface PurchaseDraftLine { itemId: string; expiry: string; qtyPack: number; bonusPack: number; costPack: number; pricePack: number }
export const effectiveCost = (l: { qtyPack: number; bonusPack: number; costPack: number }) => l.qtyPack + l.bonusPack > 0 ? round2(l.costPack * l.qtyPack / (l.qtyPack + l.bonusPack)) : l.costPack;
export const marginPct = (l: { qtyPack: number; bonusPack: number; costPack: number; pricePack: number }) => l.pricePack > 0 ? round2((l.pricePack - effectiveCost(l)) / l.pricePack * 100) : 0;

export function savePurchase(db: Db, a: { supplierId: string; lines: PurchaseDraftLine[]; paid: number; role: Role; now: string }): Ok<{ purchase: Purchase }> | Err {
  if (!canPurchase(a.role)) return { ok: false, error: 'forbidden' };
  if (!db.suppliers.some(s => s.id === a.supplierId)) return { ok: false, error: 'no-supplier' };
  if (a.lines.length === 0) return { ok: false, error: 'empty' };
  for (const l of a.lines) {
    if (!itemById(db, l.itemId)) return { ok: false, error: 'no-item' };
    if (!(l.qtyPack > 0) || l.bonusPack < 0 || !(l.costPack > 0) || !(l.pricePack > 0)) return { ok: false, error: 'bad-line' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.expiry) || l.expiry < db.today) return { ok: false, error: 'bad-expiry' };
  }
  const n = db.counters.purchase + 1;
  let idc = db.counters.id;
  const batches: Batch[] = []; const lines: PurchaseLine[] = []; const mv: Movement[] = [];
  const no = `${BRANCH}-P${String(n).padStart(5, '0')}`;
  for (const l of a.lines) {
    const it = itemById(db, l.itemId)!;
    const bid = `b${++idc}`;
    batches.push({ id: bid, itemId: l.itemId, expiry: l.expiry, qty: Math.round((l.qtyPack + l.bonusPack) * it.perPack), costPack: effectiveCost(l), pricePack: l.pricePack, receivedOn: a.now.slice(0, 10), priceChanged: it.drug && l.pricePack !== it.publicPrice });
    lines.push({ ...l, batchId: bid });
    mv.push({ id: `m${++idc}`, at: a.now, kind: 'purchase', batchId: bid, qtyBase: Math.round((l.qtyPack + l.bonusPack) * it.perPack), ref: no });
  }
  const total = round2(a.lines.reduce((s, l) => s + l.costPack * l.qtyPack, 0));
  const paid = Math.min(Math.max(a.paid, 0), total);
  const pu: Purchase = { id: `pur${n}`, no, supplierId: a.supplierId, lines, total, paid, at: a.now, by: a.role };
  // A new public price on a drug becomes that batch's price (D14); the item card keeps the latest as reference.
  const items = db.items.map(it => { const l = a.lines.filter(x => x.itemId === it.id).pop(); return l && it.drug ? { ...it, publicPrice: l.pricePack } : it; });
  return {
    ok: true, purchase: pu,
    db: { ...db, items, batches: [...db.batches, ...batches], purchases: [pu, ...db.purchases], movements: [...mv, ...db.movements],
      suppliers: db.suppliers.map(s => s.id === a.supplierId ? { ...s, balance: round2(s.balance + total - paid) } : s),
      shortages: db.shortages.map(s => s.status === 'open' && a.lines.some(l => l.itemId === s.itemId) ? { ...s, status: 'ordered' as const } : s),
      counters: { ...db.counters, purchase: n, id: idc } },
  };
}

/* ---------- Sprint 1.2: customers, cash receipts, item card, shortages to purchase ---------- */

export const canEditCustomerLimit = (r: Role) => r === 'owner' || r === 'manager';
export const canEditItem = (r: Role) => r !== 'cashier';

export interface CustomerInput { id?: string; name: string; kind: Customer['kind']; limit: number; suspended?: boolean }

export function saveCustomer(db: Db, a: { input: CustomerInput; role: Role }): Ok<{ customer: Customer }> | Err {
  const { input, role } = a;
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'name-required' };
  if (!(input.limit >= 0)) return { ok: false, error: 'bad-limit' };
  if (input.id) {
    const old = customerById(db, input.id); if (!old) return { ok: false, error: 'not-found' };
    if (old.kind === 'cash' && old.id === 'c0') return { ok: false, error: 'forbidden' };
    if ((input.limit !== old.limit || input.kind !== old.kind || !!input.suspended !== old.suspended) && !canEditCustomerLimit(role)) return { ok: false, error: 'forbidden' };
    const c: Customer = { ...old, name, kind: input.kind, limit: input.kind === 'cash' ? 0 : input.limit, suspended: !!input.suspended };
    return { ok: true, customer: c, db: { ...db, customers: db.customers.map(x => x.id === c.id ? c : x) } };
  }
  if (db.customers.some(c => c.name === name)) return { ok: false, error: 'duplicate' };
  // A cashier can add a customer for the counter, but credit and limits are management decisions.
  const kind = canEditCustomerLimit(role) ? input.kind : 'cash';
  const [d2, id] = nextId(db, 'c');
  const c: Customer = { id, name, kind, balance: 0, limit: kind === 'cash' || !canEditCustomerLimit(role) ? 0 : input.limit, suspended: false };
  return { ok: true, customer: c, db: { ...d2, customers: [...d2.customers, c] } };
}

/** Cash receipt (توريد نقدية): reduces the customer's balance. Nothing is deleted; a mistake is a new entry. */
export function cashReceipt(db: Db, a: { customerId: string; amount: number; method: 'cash' | 'card'; role: Role; now: string }): Ok<{ receipt: Receipt }> | Err {
  const c = customerById(db, a.customerId);
  if (!c || c.kind === 'cash') return { ok: false, error: 'no-customer' };
  if (!(a.amount > 0)) return { ok: false, error: 'bad-amount' };
  if (round2(a.amount) > c.balance) return { ok: false, error: 'over-balance' };
  const n = db.counters.receipt + 1;
  const after = round2(c.balance - a.amount);
  const r: Receipt = { id: `rc${n}`, no: `${BRANCH}-R${String(n).padStart(5, '0')}`, customerId: c.id, amount: round2(a.amount), method: a.method, at: a.now, by: a.role, balanceAfter: after };
  return { ok: true, receipt: r, db: { ...db, receipts: [r, ...db.receipts], customers: db.customers.map(x => x.id === c.id ? { ...x, balance: after } : x), counters: { ...db.counters, receipt: n } } };
}

export interface ItemInput { id?: string; name: string; drug: boolean; barcode: string; perPack: number; subUnit: string; publicPrice: number; suspended?: boolean; alt?: string[] }

export function saveItem(db: Db, a: { input: ItemInput; role: Role }): Ok<{ item: Item }> | Err {
  const { input, role } = a;
  if (!canEditItem(role)) return { ok: false, error: 'forbidden' };
  const name = input.name.trim(); const barcode = input.barcode.trim();
  if (!name) return { ok: false, error: 'name-required' };
  if (!/^\d{8,14}$/.test(barcode)) return { ok: false, error: 'bad-barcode' };
  if (!(input.perPack >= 1) || !Number.isInteger(input.perPack)) return { ok: false, error: 'bad-pack' };
  if (!(input.publicPrice > 0)) return { ok: false, error: 'bad-price' };
  if (db.items.some(i => i.barcode === barcode && i.id !== input.id)) return { ok: false, error: 'dup-barcode' };
  if (db.items.some(i => i.name === name && i.id !== input.id)) return { ok: false, error: 'duplicate' };
  const alt = (input.alt ?? []).filter(x => x !== input.id && db.items.some(i => i.id === x));
  if (input.id) {
    const old = itemById(db, input.id); if (!old) return { ok: false, error: 'not-found' };
    // A medicine's public price is fixed by the state and changes only through a purchase invoice (D14); non-drug prices are free (D20).
    if (old.drug && round2(input.publicPrice) !== old.publicPrice) return { ok: false, error: 'drug-price-locked' };
    if (old.drug !== input.drug) return { ok: false, error: 'drug-flag-locked' };
    const it: Item = { ...old, name, barcode, perPack: input.perPack, subUnit: input.perPack > 1 ? (input.subUnit.trim() || 'قطعة') : '', publicPrice: old.drug ? old.publicPrice : round2(input.publicPrice), suspended: !!input.suspended, alt };
    return { ok: true, item: it, db: { ...db, items: db.items.map(x => x.id === it.id ? it : x) } };
  }
  const [d2, id] = nextId(db, 'i');
  const it: Item = { id, name, drug: input.drug, packUnit: input.drug ? 'علبة' : 'قطعة', subUnit: input.perPack > 1 ? (input.subUnit.trim() || 'قطعة') : '', perPack: input.perPack, barcode, publicPrice: round2(input.publicPrice), suspended: false, otherBranchQty: 0, alt };
  return { ok: true, item: it, db: { ...d2, items: [...d2.items, it] } };
}

/** Prefilled purchase line for an item (used when a shortage becomes a purchase draft). Cost and price come from the latest batch. */
export function draftLineFor(db: Db, itemId: string, qtyPack = 10): PurchaseDraftLine | null {
  const it = itemById(db, itemId); if (!it) return null;
  const last = db.batches.filter(b => b.itemId === itemId).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))[0];
  const d = new Date(db.today + 'T00:00:00Z');
  const expiry = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 25, 0)).toISOString().slice(0, 10);
  return { itemId, expiry, qtyPack, bonusPack: 0, costPack: last?.costPack ?? round2(it.publicPrice * 0.8), pricePack: it.publicPrice };
}
export const openShortageIds = (db: Db) => db.shortages.filter(s => s.status === 'open').map(s => s.itemId);

export const customerStatement = (db: Db, customerId: string) => ({
  invoices: db.invoices.filter(i => i.customerId === customerId && i.type === 'credit' && i.status === 'saved'),
  receipts: db.receipts.filter(r => r.customerId === customerId),
});
