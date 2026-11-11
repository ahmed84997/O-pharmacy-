import { useMemo, useState } from 'react';
import { canSeeCost, canVoid, customerById, isExpired, itemById, stockOf, voidSale, daysTo } from './domain';
import { ERR, Icon, TYPE_LABEL, dmy, dmyHm, money, useApp } from './ui';

export function Items() {
  const { db, role } = useApp(); const [q, setQ] = useState(''); const cost = canSeeCost(role);
  const rows = useMemo(() => db.items.filter(i => !q || i.name.includes(q) || i.barcode.startsWith(q)).slice(0, 120), [db, q]);
  return (
    <div><h2><Icon n="box" />قائمة الاصناف</h2>
      <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="اكتب جزء من الاسم او الباركود" aria-label="بحث" />
      <div className="tablewrap"><table><thead><tr><th>الصنف</th><th>الباركود</th><th>النوع</th><th className="n">الرصيد</th><th className="n">السعر</th><th>اقرب صلاحية</th><th>الحالة</th></tr></thead><tbody>
        {rows.map(i => {
          const bs = db.batches.filter(b => b.itemId === i.id && b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
          const live = bs.find(b => !isExpired(b, db.today)); const st = stockOf(db, i.id); const exp = bs.some(b => isExpired(b, db.today));
          return <tr key={i.id}><td>{i.name}</td><td>{i.barcode}</td><td>{i.drug ? 'دواء' : 'غير دواء'}</td><td className="n">{i.perPack > 1 ? `${Math.floor(st / i.perPack)} علبة` : st}</td><td className="n">{money(i.publicPrice)}</td>
            <td>{live ? <>{dmy(live.expiry).slice(3)}{daysTo(live.expiry, db.today) <= 90 && <span className="pill warn" style={{ marginInlineStart: 6 }}>قريب</span>}</> : '-'}</td>
            <td>{i.suspended ? <span className="pill bad">موقوف</span> : st <= 0 ? <span className="pill bad">نفذ</span> : exp ? <span className="pill warn">فيه باتش منتهي</span> : <span className="pill ok">متاح</span>}</td></tr>;
        })}
      </tbody></table></div>
      <p className="hint">{cost ? 'سعر التكلفة يظهر في فاتورة المشتريات.' : ''} اول 120 صنف مطابقة من {db.items.length}.</p></div>
  );
}

export function Shortages() {
  const { db, go } = useApp();
  return (
    <div><h2><Icon n="clip" />كشكول النواقص</h2>
      <div className="tablewrap"><table><thead><tr><th>الصنف</th><th>المصدر</th><th>التاريخ</th><th className="n">متاح في فروع اخرى</th><th>الحالة</th></tr></thead><tbody>
        {db.shortages.length === 0 && <tr><td colSpan={5} className="hint" style={{ padding: 18 }}>لا توجد نواقص. جرّب فاتورة بيع لصنف رصيده صفر (مثلا سيتيريزين 10 مجم).</td></tr>}
        {db.shortages.map(s => { const it = itemById(db, s.itemId)!; return <tr key={s.id}><td>{it.name}</td><td>{s.source === 'no-stock' ? 'محاولة بيع بدون رصيد' : 'يدوي'}</td><td>{dmyHm(s.at)}</td><td className="n">{it.otherBranchQty}</td><td>{s.status === 'open' ? <span className="pill warn">مفتوح</span> : <span className="pill ok">اتطلب</span>}</td></tr>; })}
      </tbody></table></div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => go('purchase')}>فتح فاتورة مشتريات</button></div></div>
  );
}

export function Invoices() {
  const { db, setDb, role, toast, now } = useApp();
  const [vid, setVid] = useState<string | null>(null); const [reason, setReason] = useState('');
  const doVoid = () => {
    const r = voidSale(db, vid!, reason, role, now());
    if (!r.ok) { toast(ERR[r.error] ?? r.error); return; }
    setDb(r.db); setVid(null); setReason(''); toast('اتلغت الفاتورة ورجع الرصيد للمخزون - الفاتورة فاضلة ظاهرة للادارة');
  };
  return (
    <div><h2><Icon n="history" />سجل الفواتير</h2>
      <div className="tablewrap"><table><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>النوع</th><th>العميل</th><th className="n">الصافي</th><th>الحالة</th><th /></tr></thead><tbody>
        {db.invoices.slice(0, 40).map(i => (
          <tr key={i.id}><td>{i.no}</td><td>{dmyHm(i.at)}</td><td>{TYPE_LABEL[i.type]}</td><td>{customerById(db, i.customerId)?.name}</td><td className="n">{money(i.net)}</td>
            <td>{i.status === 'void' ? <span className="pill bad">ملغاة</span> : <span className="pill ok">محفوظة</span>}</td>
            <td>{i.status === 'saved' && canVoid(role) && (vid === i.id
              ? <span className="actions"><input className="txt" style={{ minWidth: 180 }} placeholder="سبب الالغاء" aria-label="سبب الالغاء" value={reason} onChange={e => setReason(e.target.value)} /><button className="btn" onClick={doVoid}>تأكيد</button><button className="btn ghost" onClick={() => setVid(null)}>رجوع</button></span>
              : <button className="btn ghost" onClick={() => { setVid(i.id); setReason(''); }}>الغاء (Void)</button>)}</td></tr>
        ))}
      </tbody></table></div>
      <p className="hint">{canVoid(role) ? 'الالغاء بسبب - مفيش حذف نهائي (D13).' : 'الالغاء للمدير والمالك فقط.'}</p></div>
  );
}

export function Deleted() {
  const { db } = useApp(); const rows = db.invoices.filter(i => i.status === 'void');
  return (
    <div><h2><Icon n="trash" />المحذوفات والملغي</h2>
      <div className="tablewrap"><table><thead><tr><th>الفاتورة</th><th className="n">الصافي</th><th>اتلغت بواسطة</th><th>التاريخ</th><th>السبب</th></tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={5} className="hint" style={{ padding: 18 }}>مفيش حاجة ملغاة لسه. الغي فاتورة من سجل الفواتير وهتظهر هنا.</td></tr>}
        {rows.map(i => <tr key={i.id}><td>{i.no}</td><td className="n">{money(i.net)}</td><td>{i.voidBy}</td><td>{i.voidAt ? dmyHm(i.voidAt) : ''}</td><td>{i.voidReason}</td></tr>)}
      </tbody></table></div>
      <p className="hint">الشاشة دي للمالك والمدير فقط. الاستعادة (Restore) في Sprint 1.3.</p></div>
  );
}

export function Soon({ label }: { label: string }) {
  return <div><h2><Icon n="gear" />{label || 'قريبا'}</h2><div className="card">الشاشة دي ضمن Phase 1 وهتتبني في Sprint 1.2 او 1.3 (الاصناف والعملاء والنواقص والتوريد النقدي ومركز التقارير). مكانها موجود في الـ Ribbon عشان تحكم على الشكل العام.</div></div>
}
