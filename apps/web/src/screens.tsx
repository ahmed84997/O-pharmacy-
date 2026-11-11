import { useEffect, useState } from 'react';
import { api, arabic } from './api';
import { ChangeSecret } from './App';
import { Icon, useApp, type RibbonCmd } from './ui';
import Printers from './Printers';

type Dash = { pharmacyName: string | null; items?: number; nearExpiry?: number; people?: number; pendingDevices?: number; suppliers?: number; customers?: number; empty: boolean; testMode: boolean };
const SPRINTS: [string, string][] = [['7.3', 'المخزون والمشتريات واستيراد eStock'], ['7.4', 'العملاء والعمليات (الطلبات والنواقص والتوصيل والمهام والحضور)'], ['7.5', 'الحسابات والمرتبات والتأمين ومركز التقارير'], ['7.6', 'تقوية البرنامج: الخدمة والتحديث والنسخ الاحتياطي']];

export function Home() {
  const { me, go, toast } = useApp(); const [d, setD] = useState<Dash | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = () => api<Dash>('/api/dashboard').then(setD, e => setErr(arabic(e)));
  useEffect(() => { void load(); }, []);
  const seed = async () => { setBusy(true); try { const r = await api<{ items: number; customers: number; staff: number }>('/api/test/seed', { body: {} }); toast(`اتحمّلت البيانات التجريبية: ${r.items} صنف و${r.customers} عميل${r.staff ? ` و${r.staff} موظفين` : ''}`); await load(); } catch (e) { toast(arabic(e)); } finally { setBusy(false); } };
  const card = (label: string, v: number | undefined, screen?: string) => v === undefined ? null : <button className="card stat" key={label} onClick={() => screen && go(screen)} style={{ textAlign: 'start' }}><span className="muted">{label}</span><b>{v}</b></button>;
  return (<div>
    <h2><Icon n="store" />أهلًا {me.person.displayName}</h2>
    {err && <p className="err">{err}</p>}
    {d && <div className="stats">{card('أصناف نشطة', d.items, 'items')}{card('تشغيلات تنتهي خلال 90 يوم', d.nearExpiry)}{card('موردين', d.suppliers)}{card('عملاء', d.customers)}{card('مستخدمين نشطين', d.people, 'people')}{card('أجهزة مستنية موافقة', d.pendingDevices, 'devices')}</div>}
    {d?.testMode && d.empty && me.person.roles.includes('O') && <div className="card warnbox" style={{ marginTop: 12 }}><p>دي نسخة تجربة وقاعدة البيانات فاضية. تحب تحمّل بيانات تجريبية (أصناف وتشغيلات وموردين وعملاء)؟ بتتعمل من خلال قواعد البرنامج الحقيقية.</p><button className="btn primary" disabled={busy} onClick={() => void seed()}>{busy ? 'بيحمّل...' : 'حمّل البيانات التجريبية'}</button></div>}
    <div className="card soonbox" style={{ marginTop: 12 }}><b>اللي جاي في Phase 7</b>{SPRINTS.map(([s, t]) => <div key={s}><span className="pill">{s}</span> {t}</div>)}</div>
  </div>);
}

export function Soon({ cmd }: { cmd?: RibbonCmd }) {
  return (<div className="soonbox"><h2><Icon n={cmd?.icon ?? 'clip'} />{cmd?.label ?? 'قريبًا'}</h2><div className="card"><p>الشاشة دي جاية في <b>Sprint {cmd?.sprint ?? '-'}</b>. المنطق بتاعها جاهز ومتجرب، والسبرنت ده بيربطه بالشاشة.</p></div></div>);
}

export function Settings() {
  const { me, can, toast, reloadMe } = useApp(); const [name, setName] = useState(me.pharmacyName ?? ''); const [err, setErr] = useState('');
  const save = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); try { await api('/api/settings/pharmacy', { body: { name } }); toast('اتحفظ اسم الصيدلية'); await reloadMe(); } catch (x) { setErr(arabic(x)); } };
  return (<div style={{ display: 'grid', gap: 16 }}>
    <h2><Icon n="gear" />الإعدادات</h2>
    {can('settings.branch') && <form className="card formgrid" onSubmit={save}><label>اسم الصيدلية<input value={name} onChange={e => setName(e.target.value)} /></label><button className="btn primary">حفظ</button>{err && <p className="err">{err}</p>}</form>}
    {can('settings.branch') && <Printers />}
    <div className="card"><b>كلمة السر بتاعتي</b><ChangeSecret done={() => toast('اتغيرت كلمة السر')} /></div>
  </div>);
}

export function About() {
  const { me } = useApp();
  return (<div className="soonbox"><h2><Icon n="file" />عن البرنامج</h2><div className="card"><p><span dir="ltr">O Pharmacy</span> - الإصدار {me.version} - فرع {me.branchId}{me.testMode ? ' - نسخة تجربة' : ''}</p><p className="muted">الـ Hub شغال على جهاز الصيدلية وبيحفظ كل حاجة محليًا. مفيش حاجة بتتمسح: الإلغاء والإيقاف بيتسجلوا بالسبب.</p></div></div>);
}
