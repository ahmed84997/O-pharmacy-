/* Sprint 7.12: printing on A4 through the Windows print dialog: a sale invoice (نوع الطباعة A4) and sticker sheets (columns × rows). */
import { useEffect } from 'react';
import { money } from './ui';

export type A4Pharmacy = { name: string; phones?: string[]; address?: string; taxRegNo?: string; commercialRegNo?: string };
export type A4Style = { header?: string; footer?: string; returnPolicy?: string; printCustomer?: boolean; printSeller?: boolean };
export type A4Sale = { saleNo: string; createdAt: string; status: string; grossMinor: number; discountMinor: number; deliveryFeeMinor: number; totalMinor: number; changeMinor: number; onAccountMinor: number; payments: { method: string; amountMinor: number }[]; lines: { lineNo: number; itemName: string; reqUnit: string; reqQty: number; amountMinor: number; unitPriceMinor: number }[] };
const dt = (iso: string) => { const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/** A sale invoice laid out on A4. */
export function SaleA4({ sale, pharmacy, style, seller, customer, copyNo }: { sale: A4Sale; pharmacy: A4Pharmacy; style: A4Style; seller?: string; customer?: string | null; copyNo?: number }) {
  const byLine = new Map<number, A4Sale['lines']>(); for (const l of sale.lines) byLine.set(l.lineNo, [...(byLine.get(l.lineNo) ?? []), l]);
  const rows = [...byLine.values()].map(ps => ({ ...ps[0]!, amountMinor: ps.reduce((a, p) => a + p.amountMinor, 0) }));
  const cash = sale.payments.filter(p => p.method === 'cash').reduce((a, p) => a + p.amountMinor, 0); const card = sale.payments.filter(p => p.method === 'card').reduce((a, p) => a + p.amountMinor, 0);
  return (<div className="a4">
    {(copyNo ?? 1) > 1 && <div className="a4-copy">نسخة مكررة رقم {copyNo} - ليست أصلًا</div>}
    {sale.status === 'void' && <div className="a4-copy">فاتورة ملغاة</div>}
    <div className="a4-head"><div>{style.header && <div className="a4-small">{style.header}</div>}<h1>{pharmacy.name}</h1>{pharmacy.address && <div>{pharmacy.address}</div>}{pharmacy.phones?.length ? <div dir="ltr" style={{ textAlign: 'right' }}>{pharmacy.phones.join(' - ')}</div> : null}</div>
      <div className="a4-title"><b>فاتورة بيع</b>{pharmacy.taxRegNo && <div>س.ض {pharmacy.taxRegNo}</div>}{pharmacy.commercialRegNo && <div>س.ت {pharmacy.commercialRegNo}</div>}</div></div>
    <table className="a4-info"><tbody>
      <tr><th>رقم الفاتورة</th><td dir="ltr">{sale.saleNo}</td><th>التاريخ</th><td dir="ltr">{dt(sale.createdAt)}</td></tr>
      {(style.printCustomer !== false && customer) || (style.printSeller !== false && seller) ? <tr><th>اسم العميل</th><td>{style.printCustomer !== false ? customer ?? '-' : '-'}</td><th>البائع</th><td>{style.printSeller !== false ? seller ?? '-' : '-'}</td></tr> : null}
    </tbody></table>
    <table className="a4-lines"><thead><tr><th>م</th><th>اسم الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
      <tbody>{rows.map((l, i) => <tr key={l.lineNo}><td>{i + 1}</td><td>{l.itemName}</td><td>{l.reqUnit}</td><td>{l.reqQty}</td><td>{money(l.unitPriceMinor)}</td><td>{money(l.amountMinor)}</td></tr>)}</tbody></table>
    <table className="a4-tot"><tbody>
      <tr><th>الإجمالي</th><td>{money(sale.grossMinor)}</td></tr>
      {sale.discountMinor > 0 && <tr><th>الخصم</th><td>-{money(sale.discountMinor)}</td></tr>}
      {sale.deliveryFeeMinor > 0 && <tr><th>خدمة التوصيل</th><td>{money(sale.deliveryFeeMinor)}</td></tr>}
      <tr><th>المطلوب</th><td><b>{money(sale.totalMinor)}</b></td></tr>
      {card > 0 && <tr><th>مدفوع بالبطاقة</th><td>{money(card)}</td></tr>}{cash > 0 && <tr><th>مدفوع نقدًا</th><td>{money(cash)}</td></tr>}
      {sale.changeMinor > 0 && <tr><th>الباقي للعميل</th><td>{money(sale.changeMinor)}</td></tr>}{sale.onAccountMinor > 0 && <tr><th>آجل على حساب العميل</th><td>{money(sale.onAccountMinor)}</td></tr>}
    </tbody></table>
    <div className="a4-foot">{style.footer && <b>{style.footer}</b>}{style.returnPolicy && <div className="a4-small">{style.returnPolicy}</div>}</div>
  </div>);
}

/** Print what is in `.print-area` through the Windows dialog, once it is drawn; then call `done`. */
export function usePrintWhen(on: boolean, done: () => void, delay = 120) { useEffect(() => { if (!on) return; const t = window.setTimeout(() => { window.print(); done(); }, delay); return () => window.clearTimeout(t); }, [on]); } // eslint-disable-line react-hooks/exhaustive-deps

/** "5x20" -> columns, rows and the size of one sticker on an A4 sheet (4 mm margin all round). */
export function sheetOf(layout: string): { cols: number; rows: number; mm: [number, number] } {
  const [c, r] = layout.split('x').map(Number); const cols = c || 5; const rows = r || 20;
  return { cols, rows, mm: [Math.floor(((210 - 8) / cols) * 10) / 10, Math.floor(((297 - 8) / rows) * 10) / 10] };
}
/** Sticker sheets: pictures laid out cols × rows per A4 page, starting from sticker `start` on the first page (a sheet already partly used). */
export function LabelSheets({ images, layout, start = 1 }: { images: string[]; layout: string; start?: number }) {
  const { cols, rows } = sheetOf(layout); const per = cols * rows; const cells: (string | null)[] = [...Array(Math.max(0, Math.min(per - 1, start - 1))).fill(null), ...images];
  const pages: (string | null)[][] = []; for (let i = 0; i < cells.length; i += per) pages.push(cells.slice(i, i + per));
  return (<>{pages.map((pg, k) => <div key={k} className="sheet" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>{pg.map((src, i) => <div key={i} className="cell">{src && <img src={src} alt="" />}</div>)}</div>)}</>);
}
