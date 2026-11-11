import { useEffect, useState } from 'react';
import { api, arabic } from './api';
import { dmyHm, Icon, ROLE_AR, useApp } from './ui';

type P = { id: string; username: string; displayName: string; roles: string[]; active: boolean; locked: boolean; mustChangeSecret: boolean; createdAt: string };
type Role = { code: string; name: string };
const AR_ROLE = ROLE_AR;
const ACTION: Record<string, string> = { created: 'اتعمل', updated: 'اتعدّل', secret_reset: 'كلمة السر اتغيرت من المدير', secret_changed: 'غيّر كلمة السر', deactivated: 'اتوقف', activated: 'اتفعّل', locked: 'اتقفل بعد محاولات غلط' };

/** People and roles: add staff with a temporary password, change roles, reset a password, stop or restart an account (with a reason). Nothing is deleted. */
export default function People() {
  const { can, toast, me, ask } = useApp(); const [list, setList] = useState<P[]>([]); const [roles, setRoles] = useState<Role[]>([]); const [err, setErr] = useState('');
  const [add, setAdd] = useState<{ username: string; displayName: string; secret: string; roles: string[] } | null>(null); const [edit, setEdit] = useState<P | null>(null); const [hist, setHist] = useState<{ p: P; rows: { action: string; by: string; at: string }[] } | null>(null);
  const load = () => api<{ people: P[]; roles: Role[] }>('/api/people').then(r => { setList(r.people); setRoles(r.roles); }, e => setErr(arabic(e)));
  useEffect(() => { void load(); }, []);
  const act = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast(ok); await load(); } catch (e) { toast(arabic(e)); } };
  const roleBoxes = (sel: string[], set: (r: string[]) => void) => <div className="rolechips">{roles.filter(r => r.code !== 'O' || me.person.roles.includes('O')).map(r => <label key={r.code}><input type="checkbox" checked={sel.includes(r.code)} onChange={e => set(e.target.checked ? [...sel, r.code] : sel.filter(x => x !== r.code))} />{AR_ROLE[r.code] ?? r.name}</label>)}</div>;
  const nameOf = (id: string) => list.find(p => p.id === id)?.displayName ?? (id === 'setup' ? 'أول تشغيل' : id === 'system' ? 'النظام' : id);
  return (<div style={{ display: 'grid', gap: 12 }}>
    <h2><Icon n="users" />المستخدمون والصلاحيات</h2>{err && <p className="err">{err}</p>}
    {can('user.create') && !add && <div><button className="btn primary" onClick={() => setAdd({ username: '', displayName: '', secret: '', roles: [] })}>مستخدم جديد</button></div>}
    {add && <form className="card" style={{ display: 'grid', gap: 10 }} onSubmit={e => { e.preventDefault(); void act(() => api('/api/people', { body: add }), 'اتضاف المستخدم. هيغيّر كلمة السر أول ما يدخل.').then(() => setAdd(null)); }}>
      <div className="formgrid"><label>الاسم<input required value={add.displayName} onChange={e => setAdd({ ...add, displayName: e.target.value })} /></label><label>اسم المستخدم (إنجليزي)<input required dir="ltr" value={add.username} onChange={e => setAdd({ ...add, username: e.target.value })} /></label><label>كلمة سر مؤقتة<input required dir="ltr" value={add.secret} onChange={e => setAdd({ ...add, secret: e.target.value })} /></label></div>
      <div>الأدوار (ممكن أكتر من دور):</div>{roleBoxes(add.roles, r => setAdd({ ...add, roles: r }))}
      <div className="actions"><button className="btn primary">حفظ</button><button type="button" className="btn ghost" onClick={() => setAdd(null)}>إلغاء</button></div></form>}
    {edit && <div className="card" style={{ display: 'grid', gap: 10 }}><b>أدوار {edit.displayName}</b>{roleBoxes(edit.roles, r => setEdit({ ...edit, roles: r }))}
      <div className="actions"><button className="btn primary" onClick={() => void act(() => api(`/api/people/${edit.id}`, { method: 'PATCH', body: { roles: edit.roles } }), 'اتحفظت الأدوار').then(() => setEdit(null))}>حفظ</button><button className="btn ghost" onClick={() => setEdit(null)}>إلغاء</button></div></div>}
    {hist && <div className="card"><b>سجل {hist.p.displayName}</b><ul>{hist.rows.map((h, i) => <li key={i}>{dmyHm(h.at)} - {ACTION[h.action] ?? h.action} - بواسطة {nameOf(h.by)}</li>)}</ul><button className="btn ghost" onClick={() => setHist(null)}>إغلاق</button></div>}
    <div className="tablewrap"><table className="cards"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الأدوار</th><th>الحالة</th><th></th></tr></thead><tbody>
      {list.map(p => <tr key={p.id}><td className="nm" data-l="الاسم">{p.displayName}{p.id === me.person.id && <small className="muted"> (أنت)</small>}</td><td data-l="اسم المستخدم"><span className="code">{p.username}</span></td><td data-l="الأدوار">{p.roles.map(r => AR_ROLE[r] ?? r).join(' و ')}</td>
        <td data-l="الحالة">{!p.active ? <span className="pill warn">متوقف</span> : p.locked ? <span className="pill warn">مقفول مؤقتًا</span> : p.mustChangeSecret ? <span className="pill">لازم يغيّر كلمة السر</span> : <span className="pill">نشط</span>}</td>
        <td className="bt"><div className="actions">
          {can('role.assign') && p.active && <button className="btn ghost" onClick={() => setEdit(p)}>الأدوار</button>}
          {can('user.update') && p.active && p.id !== me.person.id && <button className="btn ghost" onClick={() => void ask('كلمة سر مؤقتة جديدة (6 حروف على الأقل)', { secret: true }).then(s => { if (s) void act(() => api(`/api/people/${p.id}/secret`, { body: { secret: s } }), 'اتغيرت كلمة السر. هيغيّرها أول ما يدخل.'); })}>كلمة سر جديدة</button>}
          {can('user.deactivate') && p.id !== me.person.id && <button className="btn ghost" onClick={() => void ask(p.active ? 'سبب الإيقاف' : 'سبب إعادة التفعيل').then(reason => { if (reason) void act(() => api(`/api/people/${p.id}/active`, { body: { active: !p.active, reason } }), p.active ? 'اتوقف الحساب' : 'اتفعّل الحساب'); })}>{p.active ? 'إيقاف' : 'تفعيل'}</button>}
          <button className="btn ghost" onClick={() => void api<{ history: { action: string; by: string; at: string }[] }>(`/api/people/${p.id}/history`).then(r => setHist({ p, rows: r.history }), e => toast(arabic(e)))}>السجل</button>
        </div></td></tr>)}
    </tbody></table></div>
  </div>);
}
