import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, arabic, device, token } from './api';
import type { Me } from './ui';
import Shell from './Shell';

type State = { setUp: boolean; pharmacyName: string | null; version: string; testMode: boolean; readOnly?: boolean };
type Gate = 'loading' | 'offline' | 'setup' | 'pending' | 'revoked' | 'login' | 'change' | 'in';
const isDesktop = () => /Electron/.test(navigator.userAgent);
const defaultName = () => (isDesktop() ? 'كمبيوتر الصيدلية' : /Mobi|Android|iPhone/.test(navigator.userAgent) ? 'موبايل' : 'متصفح');

/* Gates in order: the Hub answers, this device is registered and approved, the pharmacy is set up, someone is logged in (and has replaced a temporary password). */
export default function App() {
  const [gate, setGate] = useState<Gate>('loading'); const [st, setSt] = useState<State | null>(null); const [me, setMe] = useState<Me | null>(null); const [err, setErr] = useState(''); const [devName, setDevName] = useState('');
  const loadMe = useCallback(async () => { const m = await api<Me>('/api/me'); setMe(m); setGate(m.person.mustChangeSecret ? 'change' : 'in'); }, []);
  const boot = useCallback(async () => {
    setErr(''); try {
      const s = await api<State>('/api/state'); setSt(s);
      if (!device.get()) { const r = await api<{ id: string; secret: string }>('/api/devices/register', { body: { name: defaultName(), kind: isDesktop() ? 'desktop' : 'browser' } }); device.set(`${r.id}.${r.secret}`); }
      let d: { status: string; name: string }; try { d = await api('/api/devices/me'); } catch (e) { if (e instanceof ApiError && e.code === 'device-unknown') { device.set(null); return boot(); } throw e; }
      setDevName(d.name); if (!s.setUp) return setGate('setup'); if (d.status === 'pending') return setGate('pending'); if (d.status === 'revoked') return setGate('revoked');
      if (token.get()) { try { await loadMe(); return; } catch { token.set(null); } } setGate('login');
    } catch (e) { setErr(arabic(e)); setGate('offline'); }
  }, [loadMe]);
  useEffect(() => { void boot(); }, [boot]);
  const logout = useCallback(async () => { try { await api('/api/logout', { body: {} }); } catch { /* already gone */ } token.set(null); setMe(null); setGate('login'); }, []);

  if (gate === 'in' && me) return <Shell me={me} reloadMe={loadMe} logout={logout} />;
  return (
    <div className="gate"><div className="card">
      <span className="brand" dir="ltr">O <b>Pharmacy</b></span>
      {st?.pharmacyName && <div className="muted">{st.pharmacyName}{st.testMode && <> <span className="tests">نسخة تجربة</span></>}</div>}
      {gate === 'loading' && <p>بيحمّل...</p>}
      {gate === 'offline' && <><p className="err">{err}</p><button className="btn primary" onClick={() => void boot()}>جرّب تاني</button></>}
      {gate === 'setup' && <Setup done={async t => { token.set(t); await loadMe(); }} />}
      {gate === 'pending' && <><h1>الجهاز مستني الموافقة</h1><p>الجهاز ده (<b>{devName}</b>) اتسجل. اطلب من المالك أو المدير يوافق عليه من: الإدارة ← الأجهزة.</p><p className="muted">رقم الجهاز: <span className="code">{device.get()?.slice(0, 8)}</span></p><button className="btn primary" onClick={() => void boot()}>اتوافق عليه؟ جرّب تاني</button></>}
      {gate === 'revoked' && <><h1>الجهاز ده اتلغى</h1><p>لو ده غلط، سجّل الجهاز من جديد وهيستنى موافقة.</p><button className="btn" onClick={() => { device.set(null); void boot(); }}>سجّل الجهاز من جديد</button></>}
      {gate === 'login' && <Login done={async (t, must) => { token.set(t); await loadMe(); if (must) setGate('change'); }} pending={() => setGate('pending')} />}
      {gate === 'change' && <ChangeSecret forced done={async () => { await loadMe(); }} />}
      <div className="muted" style={{ fontSize: 12 }}>الإصدار {st?.version ?? '-'}</div>
    </div></div>
  );
}

function Setup({ done }: { done: (token: string) => Promise<void> }) {
  const [f, setF] = useState({ pharmacyName: '', displayName: '', username: '', secret: '', again: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = async (e: React.FormEvent) => { e.preventDefault(); if (f.secret !== f.again) return setErr('كلمتين السر مش زي بعض.'); setBusy(true); setErr(''); try { const r = await api<{ token: string }>('/api/setup', { body: f }); await done(r.token); } catch (x) { setErr(arabic(x)); } finally { setBusy(false); } };
  return (<form onSubmit={go} style={{ display: 'grid', gap: 12 }}>
    <h1>أول تشغيل</h1><p className="muted">هنعمل حساب المالك. الجهاز ده هيبقى أول جهاز متوافق عليه.</p>
    <label>اسم الصيدلية<input required value={f.pharmacyName} onChange={set('pharmacyName')} /></label>
    <label>اسمك<input required value={f.displayName} onChange={set('displayName')} /></label>
    <label>اسم المستخدم (إنجليزي)<input required dir="ltr" autoComplete="username" value={f.username} onChange={set('username')} /></label>
    <label>كلمة السر<input required type="password" dir="ltr" autoComplete="new-password" value={f.secret} onChange={set('secret')} /></label>
    <label>كلمة السر تاني<input required type="password" dir="ltr" autoComplete="new-password" value={f.again} onChange={set('again')} /></label>
    {err && <p className="err">{err}</p>}<button className="btn primary" disabled={busy}>ابدأ</button>
  </form>);
}

function Login({ done, pending }: { done: (token: string, mustChange: boolean) => Promise<void>; pending: () => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await api<{ token: string; mustChangeSecret: boolean }>('/api/login', { body: { username: u, secret: p } }); await done(r.token, r.mustChangeSecret); } catch (x) { if (x instanceof ApiError && x.code === 'device-pending') return pending(); setErr(arabic(x)); setP(''); } finally { setBusy(false); } };
  return (<form onSubmit={go} style={{ display: 'grid', gap: 12 }}>
    <h1>تسجيل الدخول</h1>
    <label>اسم المستخدم<input required autoFocus dir="ltr" autoComplete="username" value={u} onChange={e => setU(e.target.value)} /></label>
    <label>كلمة السر<input required type="password" dir="ltr" autoComplete="current-password" value={p} onChange={e => setP(e.target.value)} /></label>
    {err && <p className="err">{err}</p>}<button className="btn primary" disabled={busy}>دخول</button>
  </form>);
}

export function ChangeSecret({ forced, done }: { forced?: boolean; done: () => Promise<void> | void }) {
  const [f, setF] = useState({ current: '', next: '', again: '' }); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  const go = async (e: React.FormEvent) => { e.preventDefault(); if (f.next !== f.again) return setErr('كلمتين السر الجديدة مش زي بعض.'); setErr(''); try { await api('/api/me/secret', { body: { current: f.current, next: f.next } }); setOk(true); setF({ current: '', next: '', again: '' }); await done(); } catch (x) { setErr(arabic(x)); } };
  return (<form onSubmit={go} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
    {forced && <><h1>غيّر كلمة السر</h1><p className="muted">دي كلمة سر مؤقتة من المدير. اختار كلمة سر خاصة بيك.</p></>}
    <label>كلمة السر الحالية<input required type="password" dir="ltr" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></label>
    <label>كلمة السر الجديدة<input required type="password" dir="ltr" autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
    <label>الجديدة تاني<input required type="password" dir="ltr" autoComplete="new-password" value={f.again} onChange={e => setF({ ...f, again: e.target.value })} /></label>
    {err && <p className="err">{err}</p>}{ok && !forced && <p>اتغيرت.</p>}<button className="btn primary">حفظ</button>
  </form>);
}
