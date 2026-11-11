import { useEffect, useState } from 'react';
import { api, arabic } from './api';
import { useApp } from './ui';

type T = { type: 'windows'; printer: string } | { type: 'tcp'; host: string; port?: number } | { type: 'preview' };
type P = { name: string; kind: 'receipt' | 'label'; paperWidthMm?: 58 | 80; drawerOnCash?: boolean; transport: T };
type Style = { header?: string; footer?: string; returnPolicy?: string; showExpiry?: boolean; showBatch?: boolean };

/** Printers and the receipt text. A printer installed in Windows prints raw (ESC/POS) through the spooler; a network printer on port 9100; "preview" only shows the receipt on screen. */
export default function Printers() {
  const { toast } = useApp(); const [list, setList] = useState<P[]>([]); const [style, setStyle] = useState<Style>({}); const [phones, setPhones] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api<{ printers: P[]; style: Style; phones: string }>('/api/settings/printers').then(r => { setList(r.printers); setStyle(r.style); setPhones(r.phones); }, e => setErr(arabic(e))); }, []);
  const upd = (i: number, p: Partial<P>) => setList(list.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = async () => { setErr(''); try { await api('/api/settings/printers', { body: { printers: list, style, phones } }); toast('اتحفظت الطابعات وشكل الوصل'); } catch (e) { setErr(arabic(e)); } };
  return (<div className="card" style={{ display: 'grid', gap: 10 }}>
    <b>الطابعات وشكل الوصل</b>
    {list.map((p, i) => <div key={i} className="formgrid" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
      <label>الاسم<input value={p.name} onChange={e => upd(i, { name: e.target.value })} /></label>
      <label>النوع<select value={p.kind} onChange={e => upd(i, { kind: e.target.value as P['kind'] })}><option value="receipt">وصل (كاشير)</option><option value="label">ستيكر أسعار</option></select></label>
      <label>التوصيل<select value={p.transport.type} onChange={e => upd(i, { transport: e.target.value === 'windows' ? { type: 'windows', printer: '' } : e.target.value === 'tcp' ? { type: 'tcp', host: '', port: 9100 } : { type: 'preview' } })}><option value="windows">طابعة متعرّفة على Windows</option><option value="tcp">طابعة شبكة (IP)</option><option value="preview">عرض على الشاشة بس</option></select></label>
      {p.transport.type === 'windows' && <label>اسمها في Windows بالظبط<input dir="ltr" value={p.transport.printer} onChange={e => upd(i, { transport: { type: 'windows', printer: e.target.value } })} placeholder="XP-80C" /></label>}
      {p.transport.type === 'tcp' && <label>عنوان IP<input dir="ltr" value={p.transport.host} onChange={e => upd(i, { transport: { type: 'tcp', host: e.target.value, port: 9100 } })} placeholder="192.168.1.50" /></label>}
      {p.kind === 'receipt' && <label>عرض الورق<select value={p.paperWidthMm ?? 80} onChange={e => upd(i, { paperWidthMm: Number(e.target.value) as 80 })}><option value={80}>80 مم</option><option value={58}>58 مم</option></select></label>}
      {p.kind === 'receipt' && <label className="chk"><input type="checkbox" checked={p.drawerOnCash !== false} onChange={e => upd(i, { drawerOnCash: e.target.checked })} /> افتح الدرج مع الكاش</label>}
      <button className="btn ghost" onClick={() => setList(list.filter((_, k) => k !== i))}>شيل</button>
    </div>)}
    <div><button className="btn" onClick={() => setList([...list, { name: list.length ? `طابعة ${list.length + 1}` : 'الكاشير', kind: 'receipt', paperWidthMm: 80, drawerOnCash: true, transport: { type: 'windows', printer: '' } }])}>طابعة جديدة</button></div>
    <div className="formgrid"><label>تليفونات الصيدلية على الوصل (بفاصلة)<input dir="ltr" value={phones} onChange={e => setPhones(e.target.value)} /></label><label>سطر فوق<input value={style.header ?? ''} onChange={e => setStyle({ ...style, header: e.target.value })} /></label><label>سطر تحت<input value={style.footer ?? ''} onChange={e => setStyle({ ...style, footer: e.target.value })} /></label><label>سياسة المرتجع<input value={style.returnPolicy ?? ''} onChange={e => setStyle({ ...style, returnPolicy: e.target.value })} /></label>
      <label className="chk"><input type="checkbox" checked={style.showExpiry !== false} onChange={e => setStyle({ ...style, showExpiry: e.target.checked })} /> اطبع الصلاحية</label><label className="chk"><input type="checkbox" checked={style.showBatch === true} onChange={e => setStyle({ ...style, showBatch: e.target.checked })} /> اطبع رقم التشغيلة</label></div>
    {err && <p className="err">{err}</p>}<div><button className="btn primary" onClick={() => void save()}>حفظ</button></div>
  </div>);
}
