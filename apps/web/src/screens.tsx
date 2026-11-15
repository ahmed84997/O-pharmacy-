import { useEffect, useState } from 'react';
import { api, arabic } from './api';
import { ChangeSecret } from './App';
import { Mark } from './icons';
import { Icon, useApp, type RibbonCmd } from './ui';
import Printers from './Printers';
import { theme, type Theme, type TickerSettings } from './chrome';

type Dash = { pharmacyName: string | null; items?: number; nearExpiry?: number; people?: number; pendingDevices?: number; suppliers?: number; customers?: number; empty: boolean; testMode: boolean };

const greet = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Cairo' }).format(new Date())); return h < 12 ? 'صباح الخير' : 'مساء الخير'; };
const longDate = () => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }).format(new Date());
const QUICK: { screen: string; label: string; icon: string; perms: string[]; main?: boolean }[] = [
  { screen: 'sale', label: 'فاتورة بيع', icon: 'cart', perms: ['sale.create'], main: true },
  { screen: 'requests', label: 'طلب عميل أو ناقص', icon: 'list', perms: ['customer_request.create', 'shortage.record'] },
  { screen: 'pinv', label: 'فاتورة مشتريات', icon: 'truck', perms: ['purchase_invoice.create'] },
  { screen: 'customers', label: 'تحصيل من عميل', icon: 'users', perms: ['customer.view'] },
  { screen: 'closing', label: 'تقفيل الدرج واليوم', icon: 'check', perms: ['drawer.close.review'] },
  { screen: 'reports', label: 'التقارير', icon: 'chart', perms: ['report.view'] },
];

export function Home() {
  const { me, go, toast, can, glance } = useApp(); const [d, setD] = useState<Dash | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const load = () => api<Dash>('/api/dashboard').then(setD, e => setErr(arabic(e)));
  useEffect(() => { void load(); }, []);
  const seed = async () => { setBusy(true); try { const r = await api<{ items: number; customers: number; staff: number }>('/api/test/seed', { body: {} }); toast(`اتحمّلت البيانات التجريبية: ${r.items} صنف و${r.customers} عميل${r.staff ? ` و${r.staff} موظفين` : ''}`); await load(); } catch (e) { toast(arabic(e)); } finally { setBusy(false); } };
  const card = (label: string, v: number | undefined, screen?: string, tone?: string) => v === undefined ? null : <button className="card stat" key={label} onClick={() => screen && go(screen)} style={{ textAlign: 'start' }}><span className="muted">{label}</span><b style={tone ? { color: `var(--${tone})` } : undefined}>{v}</b></button>;
  const c = glance?.counts ?? {}; const months = glance?.settings.expiryMonths ?? 3;
  /* Owner, 15 Nov 2026: after login the home page is the logo, like eStock's; the person picks what to do from the bars or the buttons below */
  const counts = [c.ready ? { l: 'طلبات جاهزة للإبلاغ', v: c.ready, s: 'requests' } : null, c.shortages ? { l: 'نواقص مفتوحة', v: c.shortages, s: 'requests' } : null, c.nearExpiry ? { l: `تنتهي خلال ${months} شهور`, v: c.nearExpiry, s: 'expiry' } : null, c.tasks ? { l: 'مهامي', v: c.tasks, s: 'tasks' } : null, d?.pendingDevices ? { l: 'أجهزة مستنية موافقة', v: d.pendingDevices, s: 'devices' } : null].filter(Boolean) as { l: string; v: number; s: string }[];
  void card;
  return (<div className="splash">
    <svg className="splash-orbits" aria-hidden="true" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice"><g fill="none" strokeWidth="1.2" transform="rotate(-18 600 330)"><ellipse cx="600" cy="330" rx="360" ry="140" /><ellipse cx="600" cy="330" rx="520" ry="210" strokeDasharray="4 10" /><ellipse cx="600" cy="330" rx="700" ry="290" /></g></svg>
    <div className="splash-in">
      <div className="splash-logo" dir="ltr" role="img" aria-label="O Pharmacy"><Mark size={150} orbit /><div><b>Pharmacy</b><small>O = ORBIT</small></div></div>
      <div className="splash-hello"><b>{greet()} يا {me.person.displayName}</b><span>{longDate()}{me.pharmacyName ? ` - ${me.pharmacyName}` : ''}</span></div>
      {err && <p className="err">{err}</p>}
      {QUICK.some(q => q.perms.some(can)) && <div className="splash-quick">{QUICK.filter(q => q.perms.some(can)).map(q => <button key={q.screen} className={`qa${q.main ? ' main' : ''}`} onClick={() => go(q.screen)}><Icon n={q.icon} />{q.label}</button>)}</div>}
      {counts.length > 0 && <div className="splash-counts">{counts.map(x => <button key={x.l} onClick={() => go(x.s)}><b>{x.v}</b>{x.l}</button>)}</div>}
      {d?.testMode && d.empty && me.person.roles.includes('O') && <div className="card warnbox" style={{ marginTop: 8 }}><p>دي نسخة تجربة وقاعدة البيانات فاضية. تحب تحمّل بيانات تجريبية (أصناف وتشغيلات وموردين وعملاء)؟ بتتعمل من خلال قواعد البرنامج الحقيقية.</p><button className="btn primary" disabled={busy} onClick={() => void seed()}>{busy ? 'بيحمّل...' : 'حمّل البيانات التجريبية'}</button></div>}
    </div>
  </div>);
}

export function Soon({ cmd }: { cmd?: RibbonCmd }) {
  return (<div className="soonbox"><h2><Icon n={cmd?.icon ?? 'clip'} />{cmd?.label ?? 'قريبًا'}</h2><div className="card"><p>الشاشة دي جاية في <b>Sprint {cmd?.sprint ?? '-'}</b>. المنطق بتاعها جاهز ومتجرب، والسبرنت ده بيربطه بالشاشة.</p></div></div>);
}

export function Settings() {
  const { me, can, toast, reloadMe } = useApp(); const [name, setName] = useState(me.pharmacyName ?? ''); const [err, setErr] = useState(''); const [mode, setMode] = useState<Theme>(theme.get());
  const save = async (e: React.FormEvent) => { e.preventDefault(); setErr(''); try { await api('/api/settings/pharmacy', { body: { name } }); toast('اتحفظ اسم الصيدلية'); await reloadMe(); } catch (x) { setErr(arabic(x)); } };
  return (<div style={{ display: 'grid', gap: 16 }}>
    <h2><Icon n="gear" />الإعدادات</h2>
    {can('settings.branch') && <form className="card formgrid" onSubmit={save}><label>اسم الصيدلية<input value={name} onChange={e => setName(e.target.value)} /></label><button className="btn primary">حفظ</button>{err && <p className="err">{err}</p>}</form>}
    {can('settings.branch') && <Printers />}
    {can('settings.branch') && <TickerBox />}
    <div className="card" style={{ display: 'grid', gap: 10 }}><b>الشكل على الجهاز ده</b>
      <div className="tabs-inline" role="group" aria-label="الشكل">{(['light', 'dark'] as Theme[]).map(t => <button key={t} className={`btn${mode === t ? ' primary' : ' ghost'}`} onClick={() => { theme.set(t); setMode(t); }}>{t === 'light' ? 'فاتح' : 'غامق'}</button>)}</div>
      <p className="hint" style={{ margin: 0 }}>الفاتح هو الأساسي. الاختيار ده للجهاز ده بس.</p></div>
    <div className="card"><b>كلمة السر بتاعتي</b><ChangeSecret done={() => toast('اتغيرت كلمة السر')} /></div>
  </div>);
}

type Info = { version: string; branchId: string; testMode: boolean; tenantId: string | null; licence: { state: string; configured: boolean; required: boolean; reason: string | null; edition: string | null; expiresAt: string | null; daysLeft: number | null }; addresses: string[]; backups: { name: string; bytes: number; at: string }[]; lastBackup: string | null };
const LIC: Record<string, string> = { valid: 'ساري', grace: 'فترة سماح', 'read-only': 'انتهى: البرنامج للقراءة بس', invalid: 'مش متفعّل' };
export function About() {
  const { can, toast, ask } = useApp(); const [i, setI] = useState<Info | null>(null);
  const load = () => api<Info>('/api/system/info').then(setI, e => toast(arabic(e))); useEffect(() => { void load(); }, []);
  if (!i) return <p>بيحمّل...</p>;
  const desktop = (window as unknown as { oDesktop?: { checkUpdate: () => Promise<boolean> } }).oDesktop;
  return (<div style={{ display: 'grid', gap: 12, maxWidth: 820 }}><h2><Icon n="file" />عن البرنامج</h2>
    <div className="card"><p><span dir="ltr">O Pharmacy</span> - الإصدار {i.version} - فرع {i.branchId}{i.testMode ? ' - نسخة تجربة' : ''}</p><p className="muted">الـ Hub شغال على جهاز الصيدلية وبيحفظ كل حاجة محليًا. مفيش حاجة بتتمسح: الإلغاء والإيقاف بيتسجلوا بالسبب.</p>
      {i.addresses.length > 0 ? <p>الأجهزة التانية في الصيدلية تتوصّل بالعنوان ده (برنامج O Pharmacy ← كاشير، أو المتصفح): {i.addresses.map(a => <span key={a} className="code"> {a} </span>)}</p> : <p className="hint">البرنامج مفتوح للجهاز ده بس. تقدر تسمح لأجهزة الشبكة من أيقونة البرنامج جنب الساعة.</p>}</div>
    <div className="card" style={{ display: 'grid', gap: 6 }}><b>الترخيص</b><div>{i.licence.configured ? `${LIC[i.licence.state] ?? i.licence.state}${i.licence.expiresAt ? ` - لحد ${i.licence.expiresAt.slice(0, 10)}` : ''}${i.licence.edition ? ` - ${i.licence.edition === 'chain' ? 'سلسلة' : 'صيدلية واحدة'}` : ''}` : 'النسخة دي من غير ترخيص (نسخة تجربة).'}</div>{i.tenantId && <div className="muted">رقم الصيدلية للترخيص: <span className="code">{i.tenantId}</span></div>}{i.licence.configured && can('settings.security') && <div><button className="btn" onClick={() => void ask('الصق كود الترخيص').then(t => { if (t) void api('/api/system/licence', { body: { token: t } }).then(() => { toast('اتفعّل الترخيص'); void load(); }, e => toast(arabic(e))); })}>تفعيل الترخيص</button></div>}</div>
    <div className="card" style={{ display: 'grid', gap: 6 }}><b>التحديثات</b>{desktop ? <><p className="hint">البرنامج بيدوّر على إصدار جديد لوحده كل 6 ساعات. كل إصدار موقّع، ومش بيتثبّت غير لما تأكّد، والبيانات مش بتتمسح. لو الإصدار الجديد مفتحش مرتين، بيرجع للي قبله لوحده.</p><div><button className="btn primary" onClick={() => { void desktop.checkUpdate().then(ok => { if (!ok) toast('التحديث متاح من جهاز الصيدلية بس.'); }); }}>البحث عن تحديث</button></div></> : <p className="hint">التحديث بيتعمل من البرنامج على جهاز الصيدلية (عن البرنامج ← البحث عن تحديث)، والأجهزة التانية بتاخد الإصدار الجديد لوحدها.</p>}</div>
    {can('settings.security') && <div className="card" style={{ display: 'grid', gap: 6 }}><b>النسخ الاحتياطي</b><div>آخر نسخة: {i.lastBackup ? new Date(i.lastBackup).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }) : 'لسه'}</div><p className="hint">نسخة كاملة بتتعمل كل يوم لوحدها وبيتحفظ آخر 14 يوم في فولدر البيانات. الاسترجاع من أيقونة البرنامج جنب الساعة.</p><div><button className="btn primary" onClick={() => void api<{ name: string }>('/api/system/backup', { body: {} }).then(r => { toast(`اتعملت النسخة ${r.name}`); void load(); }, e => toast(arabic(e)))}>نسخة احتياطية دلوقتي</button></div>
      {i.backups.length > 0 && <ul className="muted">{i.backups.slice(0, 10).map(b => <li key={b.name}><span className="code">{b.name}</span> - {(b.bytes / 1048576).toFixed(1)} MB</li>)}</ul>}</div>}
  </div>);
}

/** The alert strip at the bottom: on or off, how many months ahead counts as "near expiry", and which kinds it shows. */
function TickerBox() {
  const { toast, glance, refreshGlance } = useApp(); const [t, setT] = useState<TickerSettings | null>(glance?.settings ?? null);
  useEffect(() => { if (!t && glance) setT(glance.settings); }, [glance, t]);
  if (!t) return null;
  const save = async (next: Partial<TickerSettings>) => { try { setT(await api<TickerSettings>('/api/settings/ticker', { body: next })); refreshGlance(); toast('اتحفظ'); } catch (e) { toast(arabic(e)); } };
  const box = (k: keyof TickerSettings, label: string) => <label className="chk"><input type="checkbox" checked={t[k] as boolean} onChange={e => void save({ [k]: e.target.checked })} />{label}</label>;
  return (<div className="card" style={{ display: 'grid', gap: 10 }}><b>شريط التنبيهات</b>
    {box('enabled', 'يظهر تحت في كل الشاشات')}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>{box('showExpiry', 'الصلاحية القريبة')}{box('showShortages', 'النواقص')}{box('showReady', 'طلبات جاهزة للإبلاغ')}{box('showLowStock', 'تحت حد الطلب')}</div>
    <label className="f" style={{ display: 'grid', gap: 6, maxWidth: 260 }}>الصلاحية القريبة خلال (شهور)<select value={t.expiryMonths} onChange={e => void save({ expiryMonths: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 9, 12].map(m => <option key={m} value={m}>{m}</option>)}</select></label>
    <p className="hint" style={{ margin: 0 }}>كل موظف بيشوف في الشريط اللي صلاحياته تسمح بيه بس.</p></div>);
}
