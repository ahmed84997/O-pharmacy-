import type { ClosingService, SaleService } from '@o-pharmacy/pos';

export type SaleView = ReturnType<SaleService['sale']>;
export type Digits = 'western' | 'arabic';
/** Everything a pharmacy can change about its receipt (becomes settings later; nothing is hardcoded here). */
export interface ReceiptStyle { header?: string; footer?: string; returnPolicy?: string; digits?: Digits; showExpiry?: boolean; showBatch?: boolean; showUnitPrice?: boolean; reserveQr?: boolean; timeZone?: string }
export interface PharmacyInfo { name: string; branch?: string; phones?: string[] }
export interface ReceiptContext { pharmacy: PharmacyInfo; style?: ReceiptStyle; cashierName: string; customerName?: string | null; /** 'delivery' is the copy that goes with the order: only it carries the customer's phone and address. */ copy?: 'counter' | 'delivery'; /** 1 = the original; more = a reprint, marked as a copy. */ copyNo?: number }

export type ReceiptLine =
  | { t: string; size?: number; bold?: boolean; align?: 'right' | 'center' | 'left' }
  | { cols: string[]; widths?: number[]; size?: number; bold?: boolean }
  | { rule: true }
  | { barcode: string }
  | { qr: true };

const AR = '٠١٢٣٤٥٦٧٨٩';
export const money = (minor: number, digits: Digits = 'western'): string => num((minor / 100).toFixed(2), digits);
export const num = (s: string | number, digits: Digits = 'western'): string => digits === 'arabic' ? String(s).replace(/\d/g, d => AR[Number(d)]!) : String(s);
/** dd-mm-yyyy hh:mm in the pharmacy's time zone. Separators are "-" (never a middle dot: next to Arabic digits it reads as a zero). */
export function dateText(iso: string, tz = 'Africa/Cairo'): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`;
}

/** The lines of a receipt. Same structure as the receipt the pharmacy prints today (boxed table with item, unit, quantity, line total; totals; invoice barcode; policy) with the fixes found in the analysis: the discount is its own row, the unpaid amount has a clear label, delivery details print by themselves, counter copies never carry a phone or address. */
export function buildReceipt(sale: SaleView, ctx: ReceiptContext): ReceiptLine[] {
  const st = ctx.style ?? {}; const dg = st.digits ?? 'western'; const n = (v: string | number) => num(v, dg); const m = (v: number) => money(v, dg); const L: ReceiptLine[] = [];
  const copyNo = ctx.copyNo ?? 1; const delivery = (ctx.copy ?? 'counter') === 'delivery' && sale.delivery;
  if (copyNo > 1) L.push({ t: `نسخة مكررة رقم ${n(copyNo)} - ليست أصلًا`, size: 24, bold: true, align: 'center' });
  if (sale.status === 'void') L.push({ t: 'فاتورة ملغاة', size: 30, bold: true, align: 'center' });
  L.push({ t: ctx.pharmacy.name, size: 34, bold: true, align: 'center' });
  if (ctx.pharmacy.branch) L.push({ t: ctx.pharmacy.branch, size: 24, align: 'center' });
  if (ctx.pharmacy.phones?.length) L.push({ t: 'ت: ' + ctx.pharmacy.phones.map(p => n(p)).join(' - '), size: 22, align: 'center' });
  if (st.header) L.push({ t: st.header, size: 22, align: 'center' });
  L.push({ rule: true });
  L.push({ cols: [`فاتورة رقم ${n(sale.saleNo)}`, n(dateText(sale.createdAt, st.timeZone))], size: 22 });
  const type = sale.delivery ? 'توصيل' : sale.onAccountMinor > 0 ? 'بيع آجل' : 'بيع نقدي';
  L.push({ cols: [`الكاشير: ${ctx.cashierName}`, type], size: 22 });
  if (ctx.customerName) L.push({ t: `العميل: ${ctx.customerName}`, size: 22, align: 'right' });
  if (delivery && sale.delivery) {
    L.push({ t: `الاسم: ${sale.delivery.name}`, size: 22, align: 'right' }); L.push({ t: `الهاتف: ${n(sale.delivery.phone)}`, size: 22, align: 'right' }); L.push({ t: `العنوان: ${sale.delivery.address}`, size: 22, align: 'right' });
    if (sale.delivery.agent) L.push({ t: `مندوب التوصيل: ${sale.delivery.agent}`, size: 22, align: 'right' });
  }
  L.push({ rule: true });
  const widths = [0.46, 0.14, 0.12, 0.28]; L.push({ cols: ['الصنف', 'الوحدة', 'الكمية', 'الإجمالي'], size: 22, bold: true, widths });
  const byLine = new Map<number, SaleView['lines']>(); for (const l of sale.lines) byLine.set(l.lineNo, [...(byLine.get(l.lineNo) ?? []), l]);
  for (const picks of byLine.values()) {
    const first = picks[0]!; const total = picks.reduce((s, p) => s + p.amountMinor, 0);
    L.push({ cols: [first.itemName, first.reqUnit, n(first.reqQty), m(total)], size: 24, widths });
    const extra: string[] = []; if (st.showUnitPrice) extra.push('سعر الوحدة ' + [...new Set(picks.map(p => m(p.unitPriceMinor)))].join(' / '));
    if (st.showExpiry) { const e = picks.filter(p => p.expiry).map(p => n(p.expiry!)); if (e.length) extra.push('صلاحية ' + e.join(' / ')); }
    if (st.showBatch) { const b = picks.filter(p => p.lot).map(p => n(p.lot!)); if (b.length) extra.push('تشغيلة ' + b.join(' / ')); }
    if (extra.length) L.push({ t: extra.join(' - '), size: 18, align: 'right' });
  }
  L.push({ rule: true });
  const cash = sale.payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amountMinor, 0), card = sale.payments.filter(p => p.method === 'card').reduce((s, p) => s + p.amountMinor, 0), cod = sale.payments.filter(p => p.method === 'cod').reduce((s, p) => s + p.amountMinor, 0);
  L.push({ cols: ['إجمالي الأصناف', m(sale.grossMinor)], size: 22 });
  if (sale.discountMinor > 0) L.push({ cols: ['الخصم', '-' + m(sale.discountMinor)], size: 22 });
  if (sale.deliveryFeeMinor > 0) L.push({ cols: ['خدمة التوصيل', m(sale.deliveryFeeMinor)], size: 22 });
  if (sale.swapCreditMinor > 0) L.push({ cols: ['رصيد استبدال', '-' + m(sale.swapCreditMinor)], size: 22 });
  L.push({ cols: ['المطلوب', m(sale.totalMinor)], size: 32, bold: true });
  if (cash > 0) L.push({ cols: ['مدفوع نقدًا', m(cash)], size: 22 }); if (card > 0) L.push({ cols: ['مدفوع بالبطاقة', m(card)], size: 22 });
  if (sale.changeMinor > 0) L.push({ cols: ['الباقي للعميل (الفكة)', m(sale.changeMinor)], size: 22 });
  if (cod > 0) L.push({ cols: ['باقي على العميل (عند التسليم)', m(cod)], size: 26, bold: true });
  if (sale.onAccountMinor > 0) L.push({ cols: ['آجل على حساب العميل', m(sale.onAccountMinor)], size: 26, bold: true });
  if (sale.returnedMinor > 0) L.push({ cols: ['مرتجع على هذه الفاتورة', m(sale.returnedMinor)], size: 22 });
  L.push({ rule: true }); L.push({ barcode: sale.saleNo });
  if (st.reserveQr) L.push({ qr: true });
  if (st.footer) L.push({ t: st.footer, size: 24, align: 'center' });
  if (st.returnPolicy) L.push({ t: st.returnPolicy, size: 18, align: 'center' });
  return L;
}

export type SessionReportView = ReturnType<ClosingService['report']>;
/** The drawer-closing report of one session. The drawer part (expected, counted, difference) prints only when the report has it, i.e. for reviewers: the cashier's own copy stays blind. */
export function buildSessionReport(rep: SessionReportView, ctx: { pharmacy: PharmacyInfo; style?: ReceiptStyle; cashierName: string; copyNo?: number }): ReceiptLine[] {
  const st = ctx.style ?? {}; const dg = st.digits ?? 'western'; const n = (v: string | number) => num(v, dg); const m = (v: number) => money(v, dg); const row = (a: string, v: number, bold = false): ReceiptLine => ({ cols: [a, m(v)], size: bold ? 26 : 22, bold }); const L: ReceiptLine[] = [];
  if ((ctx.copyNo ?? 1) > 1) L.push({ t: `نسخة مكررة رقم ${n(ctx.copyNo!)} - ليست أصلًا`, size: 24, bold: true, align: 'center' });
  L.push({ t: ctx.pharmacy.name, size: 30, bold: true, align: 'center' }); L.push({ t: 'تقرير قفل الدرج', size: 28, bold: true, align: 'center' }); L.push({ rule: true });
  L.push({ cols: [`الوردية ${n(rep.sessionNo)}`, `الجهاز ${n(rep.terminal)}`], size: 22 }); L.push({ t: `الكاشير: ${ctx.cashierName}`, size: 22, align: 'right' });
  L.push({ cols: ['الفتح', n(dateText(rep.openedAt, st.timeZone))], size: 22 }); if (rep.closedAt) L.push({ cols: ['القفل', n(dateText(rep.closedAt, st.timeZone))], size: 22 }); L.push({ rule: true });
  L.push({ cols: ['عدد الفواتير', n(rep.sales.count)], size: 22 }); L.push(row('إجمالي المبيعات', rep.sales.totalMinor, true));
  if (rep.sales.discountMinor) L.push(row('منها خصومات', rep.sales.discountMinor)); L.push(row('نقدًا', rep.sales.cashMinor)); L.push(row('بطاقة', rep.sales.cardMinor));
  if (rep.sales.onAccountMinor) L.push(row('آجل على حسابات العملاء', rep.sales.onAccountMinor)); if (rep.sales.codOwedMinor) L.push(row('توصيل (يُحصَّل عند التسليم)', rep.sales.codOwedMinor));
  if (rep.returns.count) { L.push({ cols: ['عدد المرتجعات', n(rep.returns.count)], size: 22 }); L.push(row('قيمة المرتجعات', rep.returns.totalMinor)); }
  if (rep.voids.count) { L.push({ cols: ['فواتير ملغاة', n(rep.voids.count)], size: 22 }); L.push(row('قيمتها', rep.voids.totalMinor)); }
  if (rep.customerPayments.cashMinor || rep.customerPayments.cardMinor) L.push(row('سداد عملاء', rep.customerPayments.cashMinor + rep.customerPayments.cardMinor));
  if (rep.drawer) {
    const d = rep.drawer; L.push({ rule: true }); L.push(row('رصيد بداية الدرج', d.openingFloatMinor)); L.push(row('المتوقع في الدرج', d.expectedCashMinor));
    if (d.countedCashMinor !== null) { L.push(row('المعدود', d.countedCashMinor)); const diff = d.diffMinor ?? 0; L.push(diff === 0 ? { t: 'مطابق', size: 26, bold: true, align: 'center' } : { cols: [diff > 0 ? 'زيادة' : 'عجز', m(Math.abs(diff))], size: 28, bold: true }); }
    if (d.closeNote) L.push({ t: `ملاحظة: ${d.closeNote}`, size: 20, align: 'right' });
    if (d.review) L.push({ t: `المراجعة: ${d.review.decision === 'accepted' ? 'تم القبول' : 'محوّل للإدارة'}${d.review.note ? ' - ' + d.review.note : ''}`, size: 20, align: 'right' });
  }
  L.push({ rule: true }); L.push({ cols: ['توقيع الكاشير', 'توقيع المراجع'], size: 20 }); L.push({ t: ' ', size: 40 });
  return L;
}
