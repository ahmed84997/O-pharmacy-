import { useEffect, useState } from 'react';
import { api, arabic } from './api';
import { Icon, useApp } from './ui';
import { useWindowsPrinters } from './printing';

type T = { type: 'windows'; printer: string } | { type: 'tcp'; host: string; port?: number } | { type: 'device' } | { type: 'preview' };
type LocalPrinters = { printers: string[]; receipt: string; label: string; mode: string | null };
type Desk = { localPrinters?: () => Promise<LocalPrinters | null>; setLocalPrinters?: (v: { receipt: string; label: string }) => Promise<boolean> };
const desk = (): Desk | undefined => (window as unknown as { oDesktop?: Desk }).oDesktop;
type P = { name: string; kind: 'receipt' | 'label'; paperWidthMm?: 58 | 80; drawerOnCash?: boolean; transport: T };

/** Printers and the receipt text. A printer installed in Windows prints raw (ESC/POS) through the spooler; a network printer on port 9100; "preview" only shows the receipt on screen. */
export default function Printers() {
  const { toast } = useApp(); const win = useWindowsPrinters(); const [list, setList] = useState<P[]>([]); const [err, setErr] = useState('');
  useEffect(() => { api<{ printers: P[] }>('/api/settings/printers').then(r => { setList(r.printers); }, e => setErr(arabic(e))); }, []);
  const upd = (i: number, p: Partial<P>) => setList(list.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = async () => { setErr(''); try { await api('/api/settings/printers', { body: { printers: list } }); toast('اتحفظت الطابعات وشكل الوصل'); } catch (e) { setErr(arabic(e)); } };
  return (<div className="card" style={{ display: 'grid', gap: 10 }}>
    <b>الطابعات وشكل الوصل</b>
    {list.map((p, i) => <div key={i} className="formgrid" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
      <label>الاسم<input value={p.name} onChange={e => upd(i, { name: e.target.value })} /></label>
      <label>النوع<select value={p.kind} onChange={e => upd(i, { kind: e.target.value as P['kind'] })}><option value="receipt">وصل (كاشير)</option><option value="label">ستيكر أسعار</option></select></label>
      <label>التوصيل<select value={p.transport.type} onChange={e => upd(i, { transport: e.target.value === 'windows' ? { type: 'windows', printer: win.names[0] ?? '' } : e.target.value === 'tcp' ? { type: 'tcp', host: '', port: 9100 } : e.target.value === 'device' ? { type: 'device' } : { type: 'preview' } })}><option value="device">طابعة كل جهاز (كل كاشير يطبع على طابعته)</option><option value="windows">طابعة متعرّفة على الجهاز الأساسي</option><option value="tcp">طابعة شبكة (IP)</option><option value="preview">عرض على الشاشة بس</option></select></label>
      {p.transport.type === 'windows' && <label>اسمها في Windows<span className="pick-row"><select value={p.transport.printer} onChange={e => upd(i, { transport: { type: 'windows', printer: e.target.value } })}><option value="" disabled>{win.loading ? 'بيدوّر على الطابعات...' : win.names.length ? 'اختار الطابعة' : 'مفيش طابعات ظاهرة في Windows'}</option>{p.transport.printer && !win.names.includes(p.transport.printer) && <option value={p.transport.printer}>{p.transport.printer} (مش ظاهرة دلوقتي)</option>}{win.names.map(n => <option key={n} value={n}>{n}</option>)}</select><button type="button" className="btn ghost" onClick={win.refresh} aria-label="حدّث قايمة الطابعات"><Icon n="history" /></button></span></label>}
      {p.transport.type === 'device' && <span className="hint">كل جهاز بيختار طابعته تحت في «طابعات الجهاز ده». بتشتغل من برنامج O Pharmacy، مش من المتصفح.</span>}
      {p.transport.type === 'tcp' && <label>عنوان IP<input dir="ltr" value={p.transport.host} onChange={e => upd(i, { transport: { type: 'tcp', host: e.target.value, port: 9100 } })} placeholder="192.168.1.50" /></label>}
      {p.kind === 'receipt' && <label>عرض الورق<select value={p.paperWidthMm ?? 80} onChange={e => upd(i, { paperWidthMm: Number(e.target.value) as 80 })}><option value={80}>80 مم</option><option value={58}>58 مم</option></select></label>}
      {p.kind === 'receipt' && <label className="chk"><input type="checkbox" checked={p.drawerOnCash !== false} onChange={e => upd(i, { drawerOnCash: e.target.checked })} /> افتح الدرج مع الكاش</label>}
      <button className="btn ghost" onClick={() => setList(list.filter((_, k) => k !== i))}>شيل</button>
    </div>)}
    <div><button className="btn" onClick={() => setList([...list, { name: list.length ? `طابعة ${list.length + 1}` : 'الكاشير', kind: 'receipt', paperWidthMm: 80, drawerOnCash: true, transport: { type: 'device' } }])}>طابعة جديدة</button></div>
    <p className="hint">شكل الفاتورة (المقدمة والنهاية والنسخ والصلاحية): البيانات العامة ← إعدادات طباعة فاتورة البيع. مقاس الاستيكر وما يتطبع عليه: البيانات العامة ← إعدادات طباعة الباركود. التليفونات: بيانات المؤسسة.</p>
    {err && <p className="err">{err}</p>}<div><button className="btn primary" onClick={() => void save()}>حفظ</button></div>
    <ThisDevice />
  </div>);
}

/** D39: the Windows printers of the PC in front of you, for "device" printers. Only inside the desktop app (a browser cannot print raw). */
function ThisDevice() {
  const { toast } = useApp(); const [lp, setLp] = useState<LocalPrinters | null>(null);
  useEffect(() => { const d = desk(); if (d?.localPrinters) void d.localPrinters().then(setLp, () => setLp(null)); }, []);
  if (!desk()?.localPrinters) return <p className="hint">طابعات الجهاز ده بتتظبط من برنامج O Pharmacy على الجهاز نفسه.</p>;
  if (!lp) return null;
  const save = async () => { const ok = await desk()!.setLocalPrinters!({ receipt: lp.receipt, label: lp.label }); toast(ok ? 'اتحفظت طابعات الجهاز ده' : 'مقدرتش أحفظ'); };
  const sel = (k: 'receipt' | 'label', label: string) => <label>{label}<select value={lp[k]} onChange={e => setLp({ ...lp, [k]: e.target.value })}><option value="">مفيش</option>{lp.printers.map(n => <option key={n} value={n}>{n}</option>)}</select></label>;
  return (<div className="card" style={{ display: 'grid', gap: 8 }}>
    <b>طابعات الجهاز ده{lp.mode === 'cashier' ? ' (كاشير)' : ''}</b>
    {lp.printers.length === 0 && <span className="hint">مفيش طابعات متسطّبة على Windows في الجهاز ده.</span>}
    <div className="formgrid">{sel('receipt', 'طابعة الإيصال')}{sel('label', 'طابعة الستيكر والباركود')}</div>
    <div><button className="btn" onClick={() => void save()}>حفظ طابعات الجهاز ده</button></div>
  </div>);
}
