import { useEffect, useMemo, useState } from 'react';
import { ItemInput, addShortage, restoreItem, restoreSale, canEditItem, canSeeCost, canVoid, customerById, isExpired, itemById, openShortageIds, saveItem, stockOf, voidSale, daysTo } from './domain';
import { ERR, Icon, ROLE_LABEL, TYPE_LABEL, dmy, dmyHm, money, useApp } from './ui';

export function Items() {
  const { db, setDb, role, toast, now } = useApp(); const [q, setQ] = useState(''); const cost = canSeeCost(role); const can = canEditItem(role);
  const [edit, setEdit] = useState<(ItemInput & { locked?: boolean }) | null>(null);
  const rows = useMemo(() => db.items.filter(i => !q || i.name.includes(q) || i.barcode.startsWith(q)).slice(0, 120), [db, q]);
  const blank: ItemInput = { name: '', drug: false, barcode: '', perPack: 1, subUnit: '', publicPrice: 0 };
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === 'newitem' && can) setEdit(blank); };
    window.addEventListener('op-cmd', on); return () => window.removeEventListener('op-cmd', on);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can]);
  const open = (id: string) => { const i = itemById(db, id)!; setEdit({ id: i.id, name: i.name, drug: i.drug, barcode: i.barcode, perPack: i.perPack, subUnit: i.subUnit, publicPrice: i.publicPrice, suspended: i.suspended, alt: i.alt, locked: i.drug }); };
  const save = () => {
    const r = saveItem(db, { input: edit!, role });
    if (!r.ok) { toast(ERR[r.error] ?? r.error); return; }
    setDb(r.db); toast(edit!.id ? 'اتحفظ كارت الصنف' : 'اتضاف الصنف'); setEdit(null);
  };
  const toShort = (id: string) => { setDb(addShortage(db, id, 'manual', role, now())); toast('اتضاف لكشكول النواقص'); };
  const cur = edit?.id ? itemById(db, edit.id) : null;
  return (
    <div><h2><Icon n="box" />قائمة الاصناف</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <input className="search" style={{ margin: 0 }} value={q} onChange={e => setQ(e.target.value)} placeholder="اكتب جزء من الاسم او الباركود" aria-label="بحث" />
        {can && <button className="btn" onClick={() => setEdit(blank)}>صنف جديد</button>}
      </div>

      {edit && (
        <div className="card itemcard" style={{ marginBottom: 12 }}>
          <strong>{edit.id ? 'كارت الصنف' : 'صنف جديد'}</strong>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ flex: 2 }}><label htmlFor="in">الاسم</label><input id="in" className="txt" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ib">الباركود</label><input id="ib" className="txt" inputMode="numeric" value={edit.barcode} onChange={e => setEdit({ ...edit, barcode: e.target.value })} /></div>
            <div className="field"><label htmlFor="it">النوع</label><select id="it" disabled={!!edit.id} value={edit.drug ? 'drug' : 'non'} onChange={e => setEdit({ ...edit, drug: e.target.value === 'drug' })}><option value="drug">دواء (سعر من الدولة)</option><option value="non">غير دواء (سعر حر)</option></select></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="ip">عدد القطع في العلبة</label><input id="ip" className="txt" type="number" min={1} value={edit.perPack} onChange={e => setEdit({ ...edit, perPack: Math.floor(+e.target.value || 1) })} /></div>
            <div className="field"><label htmlFor="iu">الوحدة الصغرى</label><input id="iu" className="txt" disabled={edit.perPack <= 1} value={edit.subUnit} placeholder="قرص / شريط / امبول" onChange={e => setEdit({ ...edit, subUnit: e.target.value })} /></div>
            <div className="field"><label htmlFor="ipr">{edit.drug ? 'سعر الجمهور (مقفول)' : 'سعر البيع (حر)'}</label><input id="ipr" className="txt" type="number" min={0} step="0.25" disabled={!!edit.locked} value={edit.publicPrice} onChange={e => setEdit({ ...edit, publicPrice: +e.target.value })} /></div>
            {edit.id && <div className="field"><label htmlFor="is">الحالة</label><select id="is" value={edit.suspended ? '1' : '0'} onChange={e => setEdit({ ...edit, suspended: e.target.value === '1' })}><option value="0">شغال</option><option value="1">موقوف</option></select></div>}
          </div>
          {edit.locked && <p className="hint" style={{ marginTop: 0 }}>سعر الدواء بيتغير من فاتورة مشتريات بباتش جديد بسعره (D14).</p>}
          {cur && cur.alt.length > 0 && <p className="hint" style={{ marginTop: 0 }}>البدائل: {cur.alt.map(id => itemById(db, id)?.name).filter(Boolean).join(' - ')}</p>}
          {cur && <p className="hint" style={{ marginTop: 0 }}>الباتشات: {db.batches.filter(b => b.itemId === cur.id && b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry)).map(b => `${dmy(b.expiry).slice(3)} (${cur.perPack > 1 ? Math.floor(b.qty / cur.perPack) + ' علبة' : b.qty})${isExpired(b, db.today) ? ' منتهي' : ''}${cost ? ' - تكلفة ' + money(b.costPack) : ''}`).join(' | ') || 'لا يوجد'}</p>}
          <div className="actions" style={{ marginInlineStart: 0 }}><button className="btn primary" onClick={save}>حفظ</button><button className="btn ghost" onClick={() => setEdit(null)}>الغاء</button></div>
        </div>
      )}

      <div className="tablewrap"><table className="cards"><thead><tr><th>الصنف</th><th>الباركود</th><th>النوع</th><th className="n">الرصيد</th><th className="n">السعر</th><th>اقرب صلاحية</th><th>الحالة</th><th /></tr></thead><tbody>
        {rows.map(i => {
          const bs = db.batches.filter(b => b.itemId === i.id && b.qty > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
          const live = bs.find(b => !isExpired(b, db.today)); const st = stockOf(db, i.id); const exp = bs.some(b => isExpired(b, db.today));
          return <tr key={i.id}><td className="nm" data-label="الصنف">{i.name}</td><td data-label="الباركود">{i.barcode}</td><td data-label="النوع">{i.drug ? 'دواء' : 'غير دواء'}</td><td className="n" data-label="الرصيد">{i.perPack > 1 ? `${Math.floor(st / i.perPack)} علبة` : st}</td><td className="n" data-label="السعر">{money(i.publicPrice)}</td>
            <td data-label="اقرب صلاحية">{live ? <>{dmy(live.expiry).slice(3)}{daysTo(live.expiry, db.today) <= 90 && <span className="pill warn" style={{ marginInlineStart: 6 }}>قريب</span>}</> : '-'}</td>
            <td data-label="الحالة">{i.suspended ? <span className="pill bad">موقوف</span> : st <= 0 ? <span className="pill bad">نفذ</span> : exp ? <span className="pill warn">فيه باتش منتهي</span> : <span className="pill ok">متاح</span>}</td>
            <td className="bt"><span className="actions" style={{ marginInlineStart: 0 }}><button className="btn ghost" onClick={() => open(i.id)}>{can ? 'كارت الصنف' : 'عرض'}</button>{st <= 0 && !db.shortages.some(s => s.itemId === i.id && s.status === 'open') && <button className="btn ghost" onClick={() => toShort(i.id)}>للنواقص</button>}</span></td></tr>;
        })}
      </tbody></table></div>
      <p className="hint">اول 120 صنف مطابقة من {db.items.length}.</p></div>
  );
}

export function Shortages() {
  const { db, seedPurchase, toast } = useApp();
  const open = openShortageIds(db);
  return (
    <div><h2><Icon n="clip" />كشكول النواقص</h2>
      <div className="tablewrap"><table className="cards"><thead><tr><th>الصنف</th><th>المصدر</th><th>التاريخ</th><th className="n">متاح في فروع اخرى</th><th>الحالة</th></tr></thead><tbody>
        {db.shortages.length === 0 && <tr><td colSpan={5} className="hint" style={{ padding: 18 }}>لا توجد نواقص. جرّب فاتورة بيع لصنف رصيده صفر (مثلا سيتيريزين 10 مجم) او اضف من قائمة الاصناف.</td></tr>}
        {db.shortages.map(s => { const it = itemById(db, s.itemId)!; return <tr key={s.id}><td className="nm" data-label="الصنف">{it.name}</td><td data-label="المصدر">{s.source === 'no-stock' ? 'محاولة بيع بدون رصيد' : 'يدوي'}</td><td data-label="التاريخ">{dmyHm(s.at)}</td><td className="n" data-label="متاح في فروع اخرى">{it.otherBranchQty}</td><td data-label="الحالة">{s.status === 'open' ? <span className="pill warn">مفتوح</span> : <span className="pill ok">اتطلب</span>}</td></tr>; })}
      </tbody></table></div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={open.length === 0} onClick={() => { seedPurchase(open); toast(`اتجهزت مسودة مشتريات بـ ${open.length} صنف - راجع الكميات والاسعار`); }}>تحويل المفتوح لفاتورة مشتريات ({open.length})</button>
      </div>
      <p className="hint">المسودة بتتعبى بآخر سعر شراء وسعر الجمهور، وبتقفل النقص لما تحفظ الفاتورة.</p></div>
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
  const { db, setDb, role, toast, now } = useApp(); const rows = db.invoices.filter(i => i.status === 'void'); const arch = db.items.filter(i => i.suspended);
  const rest = (id: string) => { const r = restoreSale(db, id, role, now()); if (!r.ok) { toast(ERR[r.error] ?? r.error); return; } setDb(r.db); toast('اتستعادت الفاتورة وخرج الرصيد تاني'); };
  const restI = (id: string) => { const r = restoreItem(db, id, role); if (!r.ok) { toast(ERR[r.error] ?? r.error); return; } setDb(r.db); toast('الصنف رجع شغال'); };
  return (
    <div><h2><Icon n="trash" />المحذوفات والملغي</h2>
      <strong>فواتير ملغاة</strong>
      <div className="tablewrap" style={{ marginTop: 8 }}><table className="cards"><thead><tr><th>الفاتورة</th><th className="n">الصافي</th><th>اتلغت بواسطة</th><th>التاريخ</th><th>السبب</th><th /></tr></thead><tbody>
        {rows.length === 0 && <tr><td colSpan={6} className="hint" style={{ padding: 18 }}>مفيش حاجة ملغاة لسه. الغي فاتورة من سجل الفواتير وهتظهر هنا.</td></tr>}
        {rows.map(i => <tr key={i.id}><td className="nm" data-label="الفاتورة">{i.no}</td><td className="n" data-label="الصافي">{money(i.net)}</td><td data-label="اتلغت بواسطة">{ROLE_LABEL[i.voidBy!]}</td><td data-label="التاريخ">{i.voidAt ? dmyHm(i.voidAt) : ''}</td><td data-label="السبب">{i.voidReason}</td><td className="bt"><button className="btn ghost" onClick={() => rest(i.id)}>استعادة</button></td></tr>)}
      </tbody></table></div>
      <p className="hint">الاستعادة بتخرج الرصيد من المخزون تاني، ولو الرصيد خلص مش بتتم. تاريخ الالغاء بيفضل محفوظ.</p>
      <strong>اصناف موقوفة</strong>
      <div className="tablewrap" style={{ marginTop: 8 }}><table className="cards"><thead><tr><th>الصنف</th><th /></tr></thead><tbody>
        {arch.length === 0 && <tr><td colSpan={2} className="hint" style={{ padding: 18 }}>مفيش اصناف موقوفة.</td></tr>}
        {arch.map(i => <tr key={i.id}><td className="nm" data-label="الصنف">{i.name}</td><td className="bt"><button className="btn ghost" onClick={() => restI(i.id)}>رجّعه شغال</button></td></tr>)}
      </tbody></table></div>
      <p className="hint">الشاشة دي للمالك والمدير فقط.</p></div>
  );
}

export function Soon({ label }: { label: string }) {
  return <div><h2><Icon n="gear" />{label || 'قريبا'}</h2><div className="card">الشاشة دي ضمن Phase 1 وهتتبني في Sprint 1.2 او 1.3 (الاصناف والعملاء والنواقص والتوريد النقدي ومركز التقارير). مكانها موجود في الـ Ribbon عشان تحكم على الشكل العام.</div></div>
}
