/* Sprint 7.11: the "البيانات العامة" tab's own screens: the pharmacy's data, backups with the database size, and opening the drawer. */
import { useCallback, useEffect, useState } from 'react';
import { api, arabic } from './api';
import { dmyHm, Icon, useApp } from './ui';
import { usePrinters } from './pos';

type Org = { name: string; phones: string; address: string; supportPhone: string; taxRegNo: string; commercialRegNo: string };
const EMPTY: Org = { name: '', phones: '', address: '', supportPhone: '', taxRegNo: '', commercialRegNo: '' };

export function OrgScreen() {
  const { toast, reloadMe } = useApp(); const [f, setF] = useState<Org>(EMPTY); const [loaded, setLoaded] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<Org>('/api/settings/pharmacy').then(o => { setF(o); setLoaded(true); }, e => setErr(arabic(e))); }, []);
  const set = (k: keyof Org) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { await api('/api/settings/pharmacy', { body: f }); toast('اتحفظت بيانات المؤسسة'); await reloadMe(); } catch (x) { setErr(arabic(x)); } finally { setBusy(false); } };
  return (<form onSubmit={save} style={{ display: 'grid', gap: 12, maxWidth: 860 }}>
    <h2><Icon n="store" />بيانات المؤسسة</h2>
    <p className="hint">بتظهر على فاتورة البيع والباركود وشاشة الدخول.</p>
    {!loaded && !err && <p className="muted">بيحمّل...</p>}
    {loaded && <><div className="card formgrid">
      <label>اسم المؤسسة<input required maxLength={80} value={f.name} onChange={set('name')} /></label>
      <label>التليفونات<input dir="ltr" maxLength={80} value={f.phones} onChange={set('phones')} placeholder="01xxxxxxxxx - 0xxxxxxx" /></label>
      <label>العنوان<input maxLength={160} value={f.address} onChange={set('address')} /></label>
      <label>رقم الدعم الفني (على شاشة الدخول)<input dir="ltr" maxLength={40} value={f.supportPhone} onChange={set('supportPhone')} /></label>
      <label>السجل الضريبي<input dir="ltr" maxLength={40} value={f.taxRegNo} onChange={set('taxRegNo')} /></label>
      <label>السجل التجاري<input dir="ltr" maxLength={40} value={f.commercialRegNo} onChange={set('commercialRegNo')} /></label>
    </div>
    <div><button className="btn primary" disabled={busy}>حفظ</button></div></>}
    {err && <p className="err">{err}</p>}
  </form>);
}

type Info = { backups: { name: string; bytes: number; at: string }[]; lastBackup: string | null; db: { bytes: number; freeBytes: number } | null };
export const size = (b: number) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function BackupScreen() {
  const { toast } = useApp(); const [i, setI] = useState<Info | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Info>('/api/system/info').then(setI, e => setErr(arabic(e))); }, []);
  useEffect(load, [load]);
  const now = async () => { setBusy(true); try { const r = await api<{ name: string; bytes: number }>('/api/system/backup', { body: {} }); toast(`اتعملت نسخة (${size(r.bytes)})`); load(); } catch (e) { setErr(arabic(e)); } finally { setBusy(false); } };
  return (<div style={{ display: 'grid', gap: 12, maxWidth: 860 }}>
    <h2><Icon n="db" />النسخ الاحتياطية وحجم قاعدة البيانات</h2>
    {err && <p className="err">{err}</p>}
    {i && <div className="stats">
      <div className="card stat"><span className="muted">حجم قاعدة البيانات</span><b>{i.db ? size(i.db.bytes) : '-'}</b>{i.db && i.db.freeBytes > 0 && <span className="hint">منها {size(i.db.freeBytes)} مساحة فاضية</span>}</div>
      <div className="card stat"><span className="muted">آخر نسخة</span><b style={{ fontSize: '1.1rem' }}>{dmyHm(i.lastBackup)}</b><span className="hint">البرنامج بياخد نسخة كل يوم لوحده ويحتفظ بآخر 14</span></div>
    </div>}
    <div><button className="btn primary" disabled={busy} onClick={() => void now()}><Icon n="save" />خد نسخة دلوقتي</button></div>
    <p className="hint">النسخ الاحتياطية الدورية (الساعة، العدد، ونسخة على فلاشة أو فولدر تاني) جاية في Sprint 7.12.</p>
    {i && i.backups.length > 0 && <div className="tablewrap"><table><thead><tr><th>النسخة</th><th>الوقت</th><th className="n">الحجم</th></tr></thead><tbody>
      {i.backups.map(b => <tr key={b.name}><td className="code">{b.name}</td><td>{dmyHm(b.at)}</td><td className="n">{size(b.bytes)}</td></tr>)}
    </tbody></table></div>}
  </div>);
}

export function DrawerScreen() {
  const { toast } = useApp(); const printers = usePrinters(); const [p, setP] = useState(''); const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!p && printers[0]) setP(printers[0].name); }, [printers, p]);
  const go = async (e: React.FormEvent) => { e.preventDefault(); if (!reason.trim()) return setErr('اكتب سبب فتح الدرج'); setBusy(true); setErr(''); try { const r = await api<{ ok: boolean; error?: string }>('/api/print/drawer', { body: { printer: p, reason } }); if (r.ok) { toast('الدرج اتفتح'); setReason(''); } else setErr(`مفتحش: ${r.error ?? ''}`); } catch (x) { setErr(arabic(x)); } finally { setBusy(false); } };
  return (<form onSubmit={go} style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
    <h2><Icon n="wallet" />فتح الدرج</h2>
    <p className="hint">فتح الدرج من غير بيع بيتسجّل باسمك والسبب.</p>
    {printers.length === 0 ? <p className="hint">مفيش طابعة إيصال متعرّفة: البيانات العامة ← إعدادات التشغيل ← الطابعات.</p> : <div className="card formgrid">
      <label>طابعة الإيصال (الدرج متوصّل بيها)<select value={p} onChange={e => setP(e.target.value)}>{printers.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}</select></label>
      <label>السبب<input required value={reason} onChange={e => setReason(e.target.value)} placeholder="فكة، مراجعة..." /></label>
    </div>}
    {err && <p className="err">{err}</p>}
    <div><button className="btn primary" disabled={busy || printers.length === 0}>افتح الدرج</button></div>
  </form>);
}
