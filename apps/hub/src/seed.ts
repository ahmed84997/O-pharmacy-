import { gtinCheckDigit } from '@o-pharmacy/inventory';
import type { Person } from '@o-pharmacy/core';
import type { App } from './compose';
import { DRUGS, FIRST, LAST, NONDRUG, SUP } from './seed-data';

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) ^ 0; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const endOfMonth = (today: string, months: number) => { const d = new Date(`${today}T00:00:00Z`); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).toISOString().slice(0, 10); };
const quarter = (egp: number) => Math.max(25, Math.round(egp * 4) * 25); // EGP to piasters, rounded to 0.25 EGP
export interface SeedResult { items: number; batches: number; suppliers: number; customers: number; invoices: number; staff: number }

/** Test data through the real services (so every rule applies): items with units and barcodes, suppliers, purchase invoices that create batches and stock, customers with credit limits, and optionally test staff. Only on an empty pharmacy. */
export function seedTestData(app: App, owner: Person, o: { staffSecret?: string } = {}): SeedResult {
  if (app.hub.db.prepare('SELECT 1 FROM items LIMIT 1').get()) throw new Error('the pharmacy already has items: test data goes only into an empty database');
  const r = rng(20261111); const today = app.batches.today(); let n = 0;
  const barcode = () => { const body = `622${String(100000000 + ++n * 7919).slice(0, 9)}`; return body + gtinCheckDigit(body); };
  const items: { id: string; drug: boolean; per: number; priceMinor: number }[] = [];
  for (const [name, strengths, unit, form, per, base] of DRUGS) strengths.forEach((s, k) => {
    const nameAr = per > 1 ? `${name} ${s} ${unit} - ${per} ${form}` : `${name} ${s} ${unit}`;
    const units = per > 1 ? [{ name: form, factor: 1 }, { name: 'علبة', factor: per }] : [{ name: form, factor: 1 }];
    const it = app.items.create(owner, { nameAr, kind: 'drug', form, strength: `${s} ${unit}`, activeIngredient: name, units, barcodes: [{ barcode: barcode(), unitName: per > 1 ? 'علبة' : form, kind: 'gtin' }], reorderLevel: per * 2 });
    items.push({ id: it.id, drug: true, per, priceMinor: quarter(base * (1 + k * 0.35)) });
  });
  for (const [name, price] of NONDRUG) { const it = app.items.create(owner, { nameAr: name, kind: 'non_drug', listPriceMinor: quarter(price), units: [{ name: 'قطعة', factor: 1 }], barcodes: [{ barcode: barcode(), kind: 'gtin' }], reorderLevel: 2 }); items.push({ id: it.id, drug: false, per: 1, priceMinor: quarter(price) }); }

  const suppliers = SUP.slice(0, 6).map((s, k) => app.purchasing.createSupplier(owner, { name: `شركة ${s} للادوية`, phone: `0100000${String(1000 + k)}` }));
  const lines = new Map<string, { itemId: string; lot: string; expiry: string; qty: number; unitName?: string; costMinor: number; publicPriceMinor?: number; priceUnitName?: string }[]>();
  let lotN = 0; let batchCount = 0;
  for (const it of items) {
    const count = 1 + Math.floor(r() * 2);
    for (let k = 0; k < count; k++) {
      const roll = r(); const months = roll < 0.15 ? Math.floor(r() * 3) : 5 + Math.floor(r() * 26); const sup = suppliers[Math.floor(r() * suppliers.length)]!;
      const unitName = it.per > 1 ? 'علبة' : undefined; const qty = 2 + Math.floor(r() * 10); const costMinor = Math.round(it.priceMinor * (it.drug ? 0.82 : 0.7) / 25) * 25;
      const l = { itemId: it.id, lot: `L${String(++lotN).padStart(5, '0')}`, expiry: endOfMonth(today, months), qty, unitName, costMinor, ...(it.drug ? { publicPriceMinor: it.priceMinor, priceUnitName: unitName } : {}) };
      lines.set(sup.id, [...(lines.get(sup.id) ?? []), l]); batchCount++;
    }
  }
  let invoices = 0; let ref = 0;
  for (const [supplierId, ls] of lines) for (let i = 0; i < ls.length; i += 40) { app.purchasing.postInvoice(owner, { key: `seed-pi-${supplierId}-${i}`, supplierId, supplierRef: `SEED-${++ref}`, lines: ls.slice(i, i + 40) }); invoices++; }

  let customers = 0; for (let k = 0; k < 25; k++) { const c = app.customers.create(owner, { name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]} ${k + 1}`, phone: `0111${String(1000000 + k * 37)}` }); if (k % 3 === 0) app.customers.setCreditLimit(owner, c.id, [200000, 300000, 500000][k % 3 === 0 ? (k / 3) % 3 : 0]!, 'بيانات تجريبية'); customers++; }

  let staff = 0; if (o.staffSecret) for (const [username, displayName, role] of [['manager', 'مدير الفرع (تجريبي)', 'M'], ['pharmacist', 'صيدلي (تجريبي)', 'P'], ['cashier', 'كاشير (تجريبي)', 'C'], ['storekeeper', 'أمين مخزن (تجريبي)', 'S'], ['accountant', 'محاسب (تجريبي)', 'X']] as const) {
    if (app.hub.db.prepare('SELECT 1 FROM people WHERE username_key=?').get(username)) continue; app.access.create(owner, { username, displayName, secret: o.staffSecret, roles: [role] }); staff++;
  }
  app.access.setSetting('test.seeded_at', app.hub.now(), owner.id);
  return { items: items.length, batches: batchCount, suppliers: suppliers.length, customers, invoices, staff };
}
