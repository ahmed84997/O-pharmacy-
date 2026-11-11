import { useEffect, useState } from 'react';
import { api, arabic } from './api';
import { dmyHm, Icon, useApp } from './ui';

type D = { id: string; name: string; kind: string; status: 'pending' | 'approved' | 'revoked'; createdAt: string; lastSeenAt: string | null };
const KIND: Record<string, string> = { desktop: 'برنامج الديسكتوب', browser: 'متصفح', pos: 'كاشير', phone: 'موبايل', tablet: 'تابلت' };
const STATUS: Record<string, string> = { pending: 'مستني موافقة', approved: 'متوافق عليه', revoked: 'ملغي' };

/** Every PC, browser or phone must be approved before anyone logs in on it; a revoked device stays revoked (it registers again). */
export default function Devices() {
  const { can, toast, ask } = useApp(); const [list, setList] = useState<D[]>([]); const [current, setCurrent] = useState(''); const [err, setErr] = useState('');
  const load = () => api<{ devices: D[]; current: string }>('/api/devices').then(r => { setList(r.devices); setCurrent(r.current); }, e => setErr(arabic(e)));
  useEffect(() => { void load(); }, []);
  const act = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast(ok); await load(); } catch (e) { toast(arabic(e)); } };
  return (<div style={{ display: 'grid', gap: 12 }}>
    <h2><Icon n="shield" />الأجهزة</h2>{err && <p className="err">{err}</p>}
    <p className="hint">أي جهاز جديد بيفتح البرنامج بيظهر هنا ومحدش يقدر يدخل منه غير بعد الموافقة. رقم الجهاز بيظهر على شاشته.</p>
    <div className="tablewrap"><table className="cards"><thead><tr><th>الجهاز</th><th>النوع</th><th>الحالة</th><th>آخر ظهور</th><th></th></tr></thead><tbody>
      {list.map(d => <tr key={d.id}><td className="nm" data-l="الجهاز">{d.name}{d.id === current && <small className="muted"> (الجهاز ده)</small>}<br /><small className="muted code">{d.id.slice(0, 8)}</small></td><td data-l="النوع">{KIND[d.kind] ?? d.kind}</td>
        <td data-l="الحالة"><span className={`pill${d.status === 'approved' ? '' : ' warn'}`}>{STATUS[d.status]}</span></td><td data-l="آخر ظهور">{dmyHm(d.lastSeenAt ?? d.createdAt)}</td>
        <td className="bt"><div className="actions">
          {d.status === 'pending' && can('device.approve') && <button className="btn primary" onClick={() => void act(() => api(`/api/devices/${d.id}/approve`, { body: {} }), 'اتوافق على الجهاز')}>موافقة</button>}
          {d.status !== 'revoked' && d.id !== current && can('device.revoke') && <button className="btn ghost" onClick={() => void ask('سبب إلغاء الجهاز').then(reason => { if (reason) void act(() => api(`/api/devices/${d.id}/revoke`, { body: { reason } }), 'اتلغى الجهاز'); })}>إلغاء</button>}
        </div></td></tr>)}
    </tbody></table></div>
  </div>);
}
