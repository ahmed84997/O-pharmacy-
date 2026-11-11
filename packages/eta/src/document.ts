import type { Item } from '@o-pharmacy/inventory';
import type { ReturnService, SaleService } from '@o-pharmacy/pos';

export type SaleView = ReturnType<SaleService['sale']>;
export type ReturnView = ReturnType<ReturnService['returnsOf']>[number];
export interface TaxableItem { taxType: string; amount: number; subType: string; rate?: number }
export interface BranchAddress { country: 'EG'; governate: string; regionCity: string; street: string; buildingNumber: string; postalCode?: string; floor?: string; room?: string; landmark?: string; additionalInformation?: string }
export interface EtaSeller { rin: string; companyTradeName: string; branchCode: string; branchAddress: BranchAddress; activityCode: string; syndicateLicenseNumber?: string }
/** Everything the ETA document needs that the pharmacy owns (registration data and code choices). Nothing here is guessed in code: until the accountant confirms the tax, unit and payment codes, the resolvers decide. */
export interface EtaConfig {
  seller: EtaSeller;
  /** The registered POS serial of a cashier terminal (each terminal is one ETA device with its own receipt chain). */
  deviceSerial(terminal: string): string;
  /** The e-invoicing portal address the QR points to. */
  portalUrl: string;
  /** ETA unit-of-measure code for one of our unit names. */
  unitCode(unitName: string): string;
  /** ETA payment method code from what the customer paid with. */
  paymentCode(paid: { cash: boolean; card: boolean }): string;
  /** Taxes for a line (the net sale after discount, in piasters). Return nothing for an exempt line only if ETA accepts that for the activity. */
  taxes(item: Item, netSaleMinor: number): TaxableItem[];
  /** A delivery fee is a service line and needs its own registered code. */
  deliveryItem?: { internalCode: string; description: string; itemType: 'GS1' | 'EGS'; itemCode: string; unitType: string };
}
export class EtaBuildError extends Error { constructor(public code: 'item-code' | 'config' | 'reference', message: string) { super(message); } }

const d = (minor: number): number => minor / 100;
const rate5 = (n: number): number => Math.round(n * 1e5) / 1e5;
export const etaDate = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z').replace(/([^Z])$/, '$1');
type Line = Record<string, unknown>;

function line(item: Item, p: { description: string; unitType: string; qty: number; totalSaleMinor: number; discountMinor: number }, cfg: EtaConfig): { line: Line; netMinor: number; taxMinor: number; totalMinor: number; taxes: TaxableItem[] } {
  if (!item.eta.type) throw new EtaBuildError('item-code', `item ${item.code} has no ETA code`);
  const net = p.totalSaleMinor - p.discountMinor; const taxes = cfg.taxes(item, net).map(t => ({ ...t, amount: Math.round(t.amount * 100) / 100 })); /* ETA keeps 2 decimals on a line tax */ const taxMinor = Math.round(taxes.reduce((s, t) => s + t.amount, 0) * 100); const total = net + taxMinor;
  const l: Line = { internalCode: item.code, description: p.description, itemType: item.eta.type, itemCode: item.eta.code, unitType: p.unitType, quantity: rate5(p.qty), unitPrice: rate5(p.totalSaleMinor / 100 / p.qty), netSale: d(net), totalSale: d(p.totalSaleMinor), total: d(total) };
  if (p.discountMinor > 0) l.commercialDiscountData = [{ amount: d(p.discountMinor), description: 'خصم' }];
  if (taxes.length) l.taxableItems = taxes;
  return { line: l, netMinor: net, taxMinor, totalMinor: total, taxes };
}
function envelope(kind: 's' | 'r', head: { dateTimeIssued: string; receiptNumber: string; previousUUID: string; referenceUUID?: string; salesIssuedDateTime?: string; referenceOldUUID?: string }, device: string, items: Line[], t: { sales: number; discount: number; net: number; total: number; taxes: Map<string, number> }, payment: string, cfg: EtaConfig): Record<string, unknown> {
  const header: Record<string, unknown> = { dateTimeIssued: head.dateTimeIssued, receiptNumber: head.receiptNumber, uuid: '', previousUUID: head.previousUUID };
  if (head.referenceUUID) header.referenceUUID = head.referenceUUID; if (head.salesIssuedDateTime) header.salesIssuedDateTime = head.salesIssuedDateTime; if (head.referenceOldUUID) header.referenceOldUUID = head.referenceOldUUID; header.currency = 'EGP';
  const s = cfg.seller; const taxTotals = [...t.taxes].map(([taxType, amount]) => ({ taxType, amount: rate5(amount) }));
  return { header, documentType: { receiptType: kind, typeVersion: '1.2' }, seller: { rin: s.rin, companyTradeName: s.companyTradeName, branchCode: s.branchCode, branchAddress: s.branchAddress, deviceSerialNumber: device, ...(s.syndicateLicenseNumber ? { syndicateLicenseNumber: s.syndicateLicenseNumber } : {}), activityCode: s.activityCode }, buyer: { type: 'P' }, itemData: items,
    totalSales: d(t.sales), ...(t.discount > 0 ? { totalCommercialDiscount: d(t.discount) } : {}), netAmount: d(t.net), totalAmount: d(t.total), ...(taxTotals.length ? { taxTotals } : {}), paymentMethod: payment };
}
function totals(rows: { line: Line; netMinor: number; taxMinor: number; totalMinor: number; taxes: TaxableItem[] }[], sales: number[], disc: number[]) {
  const taxes = new Map<string, number>(); for (const r of rows) for (const x of r.taxes) taxes.set(x.taxType, (taxes.get(x.taxType) ?? 0) + x.amount);
  return { sales: sales.reduce((a, b) => a + b, 0), discount: disc.reduce((a, b) => a + b, 0), net: rows.reduce((s, r) => s + r.netMinor, 0), total: rows.reduce((s, r) => s + r.totalMinor, 0), taxes };
}
type ItemOf = (itemId: string) => Item;
const unitNameOf = (item: Item, factor: number): string => item.units.find(u => u.factor === factor)?.name ?? item.units.find(u => u.isBase)?.name ?? '';
function saleRows(sale: SaleView, itemOf: ItemOf, cfg: EtaConfig) {
  const rows = sale.lines.map(l => { const item = itemOf(l.itemId); const unit = unitNameOf(item, l.priceUnitFactor); return { ...line(item, { description: l.itemName, unitType: cfg.unitCode(unit), qty: l.qtyBase / Math.max(1, l.priceUnitFactor), totalSaleMinor: l.amountMinor, discountMinor: l.discountMinor }, cfg), sale: l.amountMinor, disc: l.discountMinor }; });
  if (sale.deliveryFeeMinor > 0) { const f = cfg.deliveryItem; if (!f) throw new EtaBuildError('config', 'a delivery fee needs eta.deliveryItem (its registered service code)'); rows.push({ line: { internalCode: f.internalCode, description: f.description, itemType: f.itemType, itemCode: f.itemCode, unitType: f.unitType, quantity: 1, unitPrice: d(sale.deliveryFeeMinor), netSale: d(sale.deliveryFeeMinor), totalSale: d(sale.deliveryFeeMinor), total: d(sale.deliveryFeeMinor) }, netMinor: sale.deliveryFeeMinor, taxMinor: 0, totalMinor: sale.deliveryFeeMinor, taxes: [], sale: sale.deliveryFeeMinor, disc: 0 }); }
  return rows;
}
const paymentOf = (sale: SaleView, cfg: EtaConfig): string => cfg.paymentCode({ cash: sale.payments.some(p => p.method === 'cash' || p.method === 'cod') || sale.onAccountMinor > 0, card: sale.payments.some(p => p.method === 'card') });

/** The sale receipt (type s). `uuid` is empty: the caller computes it from the serialised document. */
export function saleDocument(sale: SaleView, itemOf: ItemOf, device: string, previousUuid: string, cfg: EtaConfig, referenceOldUuid?: string): Record<string, unknown> {
  const rows = saleRows(sale, itemOf, cfg); return envelope('s', { dateTimeIssued: etaDate(sale.createdAt), receiptNumber: sale.saleNo, previousUUID: previousUuid, referenceOldUUID: referenceOldUuid }, device, rows.map(r => r.line), totals(rows, rows.map(r => r.sale), rows.map(r => r.disc)), paymentOf(sale, cfg), cfg);
}
/** The return receipt (type r) of a partial return or swap: the refunded value of each returned line, in base units. `referenceUuid` is the original sale's receipt. */
export function returnDocument(sale: SaleView, ret: ReturnView, saleIssuedAt: string, itemOf: ItemOf, device: string, previousUuid: string, referenceUuid: string, cfg: EtaConfig, referenceOldUuid?: string): Record<string, unknown> {
  const rows = ret.lines.map(l => { const lineOf = sale.lines.find(x => x.itemName === l.itemName && x.lot === l.lot) ?? sale.lines.find(x => x.itemName === l.itemName); if (!lineOf) throw new EtaBuildError('reference', `returned line ${l.itemName} is not on sale ${sale.saleNo}`); const item = itemOf(lineOf.itemId);
    return { ...line(item, { description: l.itemName, unitType: cfg.unitCode(item.units.find(u => u.isBase)?.name ?? ''), qty: l.qtyBase, totalSaleMinor: l.refundMinor, discountMinor: 0 }, cfg), sale: l.refundMinor, disc: 0 }; });
  return envelope('r', { dateTimeIssued: etaDate(ret.at), receiptNumber: ret.returnNo, previousUUID: previousUuid, referenceUUID: referenceUuid, salesIssuedDateTime: etaDate(saleIssuedAt), referenceOldUUID: referenceOldUuid }, device, rows.map(r => r.line), totals(rows, rows.map(r => r.sale), rows.map(r => r.disc)), paymentOf(sale, cfg), cfg);
}
/** The return receipt of a voided sale: the whole sale given back, line for line. */
export function voidDocument(sale: SaleView, voidAt: string, number: string, saleIssuedAt: string, itemOf: ItemOf, device: string, previousUuid: string, referenceUuid: string, cfg: EtaConfig, referenceOldUuid?: string): Record<string, unknown> {
  const rows = saleRows(sale, itemOf, cfg); return envelope('r', { dateTimeIssued: etaDate(voidAt), receiptNumber: number, previousUUID: previousUuid, referenceUUID: referenceUuid, salesIssuedDateTime: etaDate(saleIssuedAt), referenceOldUUID: referenceOldUuid }, device, rows.map(r => r.line), totals(rows, rows.map(r => r.sale), rows.map(r => r.disc)), paymentOf(sale, cfg), cfg);
}
