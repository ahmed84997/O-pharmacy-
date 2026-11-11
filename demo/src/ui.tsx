import { createContext, useContext } from 'react';
import { Db, Role } from './domain';

const ICONS: Record<string, string> = {
  cart: 'M3 4h2l2.2 10.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.7L20 8H6.2|c8.5,19,1.4|c17,19,1.4',
  save: 'M5 4h11l3 3v13H5z|M8 4v5h7V4|M8 20v-6h8v6', undo: 'M4 8h10a5 5 0 0 1 0 10H8|M7 4L3 8l4 4',
  pause: 'M8 5v14|M16 5v14', history: 'M3 12a9 9 0 1 0 3-6.7|M3 4v5h5|M12 8v5l3 2', plus: 'M12 5v14|M5 12h14', minus: 'M5 12h14',
  search: 'c11,11,6|M16 16l4 4', box: 'M3 8l9-5 9 5v8l-9 5-9-5z|M3 8l9 5 9-5|M12 13v8',
  truck: 'M2 6h11v9H2z|M13 9h4l3 3v3h-7z|c6,17.5,1.6|c16.5,17.5,1.6', users: 'c9,8,3.2|M3 20a6 6 0 0 1 12 0|c17,9,2.5|M16 14.2A5 5 0 0 1 21 19',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M3 7l12-3v3|M17 14h2', chart: 'M4 20V4|M4 20h16|M8 16v-5|M12 16V8|M16 16v-8',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z|M9 12l2 2 4-4', gear: 'c12,12,3|M12 2v3|M12 19v3|M2 12h3|M19 12h3|M5 5l2 2|M17 17l2 2|M19 5l-2 2|M7 17l-2 2',
  print: 'M7 9V3h10v6|M6 17H4v-6h16v6h-2|M7 14h10v7H7z', file: 'M6 3h8l4 4v14H6z|M14 3v4h4', bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4z|M10 21h4',
  tag: 'M3 12V4h8l10 10-8 8z|c7.5,8.5,1.2', cal: 'M4 6h16v14H4z|M4 10h16|M8 3v4|M16 3v4', trash: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  check: 'M5 12l5 5 9-10', clip: 'M8 4h8v3H8z|M6 5h2|M16 5h2|M6 5v16h12V5', store: 'M3 9l2-5h14l2 5|M3 9v11h18V9|M9 20v-6h6v6', pct: 'M6 18L18 6|c7.5,8.5,1.5|c16.5,16.5,1.5',
  menu: 'M4 7h16|M4 12h16|M4 17h16', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', kbd: 'M3 7h18v10H3z|M7 11h.01|M11 11h.01|M15 11h.01|M7 14h10', x: 'M6 6l12 12|M18 6L6 18',
};
export function Icon({ n }: { n: string }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {(ICONS[n] ?? ICONS.file).split('|').map((p, i) => {
        if (/^c[\d.]+,/.test(p)) { const [cx, cy, r] = p.slice(1).split(','); return <circle key={i} cx={cx} cy={cy} r={r} />; }
        return <path key={i} d={p} />;
      })}
    </svg>
  );
}

/* Western digits (the pharmacy prints Western digits today); the separator in text is always "-". */
export const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const dmyHm = (iso: string) => { const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export type Screen = 'sale' | 'purchase' | 'items' | 'short' | 'invoices' | 'del' | 'customers' | 'receipt' | 'reports' | 'branches' | 'soon';
export interface Ctx {
  db: Db; setDb: (d: Db) => void; role: Role; toast: (m: string) => void; go: (s: Screen, soon?: string) => void; now: () => string; seedPurchase: (itemIds: string[]) => void; purchaseSeed: string[]; clearPurchaseSeed: () => void;
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export const ERR: Record<string, string> = {
  empty: 'الفاتورة فاضية', 'insufficient-stock': 'الكمية المطلوبة اكتر من المتاح (الباتشات المنتهية لا تُباع)', suspended: 'فيه صنف موقوف في الفاتورة',
  'credit-limit': 'العميل تعدّى حد الائتمان', 'credit-not-allowed': 'البيع الآجل غير متاح لهذا العميل', 'no-customer': 'اختار العميل', forbidden: 'ليس لديك صلاحية',
  'reason-required': 'اكتب سبب الإلغاء', 'already-void': 'الفاتورة ملغاة بالفعل', 'not-found': 'غير موجود', 'no-supplier': 'اختار المورد', 'bad-line': 'راجع الكمية والأسعار',
  'bad-expiry': 'تاريخ الصلاحية لازم يكون في المستقبل', 'no-item': 'صنف غير معروف',
  'name-required': 'اكتب الاسم', duplicate: 'الاسم موجود قبل كده', 'bad-limit': 'حد الائتمان لازم يكون صفر او اكتر', 'bad-amount': 'اكتب مبلغ صحيح', 'over-balance': 'المبلغ اكبر من رصيد العميل',
  'bad-barcode': 'الباركود لازم يكون من 8 لـ 14 رقم', 'dup-barcode': 'الباركود مستخدم لصنف تاني', 'bad-pack': 'عدد القطع في العلبة لازم رقم صحيح 1 او اكتر', 'bad-price': 'اكتب سعر صحيح',
  'drug-price-locked': 'سعر الدواء مسعّر من الدولة - بيتغير من فاتورة مشتريات بباتش جديد', 'not-void': 'الفاتورة مش ملغاة', 'other-branch-short': 'الفرع التاني مش معاه الكمية دي', 'already-done': 'التحويل اتسلم خلاص', 'drug-flag-locked': 'نوع الصنف (دواء / غير دواء) مش بيتغير بعد الاضافة',
};
export const ROLE_LABEL: Record<Role, string> = { owner: 'المالك', manager: 'مدير الفرع', pharmacist: 'صيدلي', cashier: 'كاشير' };
export const TYPE_LABEL = { cash: 'كاش', card: 'كارت', credit: 'آجل', delivery: 'توصيل' } as const;
