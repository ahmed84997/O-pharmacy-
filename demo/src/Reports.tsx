import { useEffect, useMemo, useState } from 'react';
import { SalesGroup, canSeeCost, daysTo, expiryReport, isoDay, itemById, round2, salesReport, shortagesReport, toCsv } from './domain';
import { Icon, TYPE_LABEL, dmy, dmyHm, money, useApp } from './ui';

type Kind = 'sales' | 'expiry' | 'shortages';
interface View { name: string; kind: Kind; from: string; to: string; group: SalesGroup; incVoid: boolean; days: number; status: 'all' | 'open' | 'ordered' }
const KIND_LABEL: Record<Kind, string> = { sales: 'المبيعات', expiry: 'الاصناف قريبة الانتهاء', shortages: 'النواقص' };
const GROUP_LABEL: Record<SalesGroup, string> = { day: 'باليوم', type: 'بنوع الفاتورة', by: 'بالمستخدم' };
const ROLE_AR: Record<string, string> = { owner: 'المالك', manager: 'مدير الفرع', pharmacist: 'صيدلي', cashier: 'كاشير' };

export default function Reports() {
  const { db, role, toast } = useApp();
  const cost = canSeeCost(role);
  const [kind, setKind] = useState<Kind>('sales');
  const [from, setFrom] = useState(() => { const d = new Date(db.today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 29); return isoDay(d); });
  const [to, setTo] = useState(db.today);
  const [group, setGroup] = useState<SalesGroup>('day');
  const [incVoid, setIncVoid] = useState(false);
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState<'all' | 'open' | 'ordered'>('all');
  const [views, setViews] = useState<View[]>([{ name: 'مبيعات الشهر باليوم', kind: 'sales', from, to, group: 'day', incVoid: false, days: 90, status: 'all' }, { name: 'قرب الانتهاء 90 يوم', kind: 'expiry', from, to, group: 'day', incVoid: false, days: 90, status: 'all' }]);
  const [vname, setVname] = useState('');

  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === 'report-expiry') { setKind('expiry'); setDays(90); } };
    window.addEventListener('op-cmd', on); return () => window.removeEventListener('op-cmd', on);
  }, []);

  const table = useMemo(() => {
    if (kind === 'sales') {
      const rows = salesReport(db, { from, to, group, includeVoid: incVoid });
      const label = (k: string) => group === 'day' ? dmy(k) : group === 'type' ? TYPE_LABEL[k as keyof typeof TYPE_LABEL] ?? k : ROLE_AR[k] ?? k;
      const head = ['', 'عدد الفواتير', 'الصافي', ...(cost ? ['التكلفة', 'الربح'] : [])];
      const body = rows.map(r => [label(r.key), r.count, money(r.net), ...(cost ? [money(r.cost), money(r.profit)] : [])] as (string | number)[]);
      const tot = rows.reduce((a, r) => ({ c: a.c + r.count, n: round2(a.n + r.net), k: round2(a.k + r.cost) }), { c: 0, n: 0, k: 0 });
      return { head: [GROUP_LABEL[group].replace('ب', ''), ...head.slice(1)], body, foot: ['الاجمالي', tot.c, money(tot.n), ...(cost ? [money(tot.k), money(round2(tot.n - tot.k))] : [])] as (string | number)[] };
    }
    if (kind === 'expiry') {
      const rows = expiryReport(db, days);
      return { head: ['الصنف', 'الصلاحية', 'الايام', 'الكمية', ...(cost ? ['قيمة التكلفة'] : [])],
        body: rows.map(r => { const it = itemById(db, r.itemId)!; return [it.name, dmy(r.expiry), r.days < 0 ? `منتهي من ${-r.days}` : r.days, it.perPack > 1 ? `${Math.floor(r.qty / it.perPack)} علبة` : r.qty, ...(cost ? [money(r.valueCost)] : [])] as (string | number)[]; }),
        foot: ['الاجمالي', '', '', '', ...(cost ? [money(round2(rows.reduce((s, r) => s + r.valueCost, 0)))] : [])] as (string | number)[] };
    }
    const rows = shortagesReport(db, status);
    return { head: ['الصنف', 'المصدر', 'التاريخ', 'الحالة'], body: rows.map(s => [itemById(db, s.itemId)!.name, s.source === 'no-stock' ? 'محاولة بيع بدون رصيد' : 'يدوي', dmyHm(s.at), s.status === 'open' ? 'مفتوح' : 'اتطلب'] as (string | number)[]), foot: ['الاجمالي', rows.length, '', ''] as (string | number)[] };
  }, [db, kind, from, to, group, incVoid, days, status, cost]);

  const apply = (v: View) => { setKind(v.kind); setFrom(v.from); setTo(v.to); setGroup(v.group); setIncVoid(v.incVoid); setDays(v.days); setStatus(v.status); };
  const saveView = () => { const n = vname.trim(); if (!n) { toast('اكتب اسم للعرض'); return; } setViews(v => [{ name: n, kind, from, to, group, incVoid, days, status }, ...v.filter(x => x.name !== n)]); setVname(''); toast('اتحفظ العرض'); };
  const exportCsv = async () => {
    const text = toCsv(table.head, table.body);
    try { await navigator.clipboard.writeText(text); toast('اتنسخ التقرير كـ CSV (في المنتج الحقيقي هينزل ملف Excel)'); }
    catch { toast('النسخ مش متاح هنا - في المنتج الحقيقي هينزل ملف Excel'); }
  };

  return (
    <div>
      <h2><Icon n="chart" />مركز التقارير</h2>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="rk">التقرير</label><select id="rk" value={kind} onChange={e => setKind(e.target.value as Kind)}>{(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
        {kind === 'sales' && <>
          <div className="field"><label htmlFor="rf">من</label><input id="rf" className="date" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="rt">الى</label><input id="rt" className="date" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="field"><label htmlFor="rg">تجميع</label><select id="rg" value={group} onChange={e => setGroup(e.target.value as SalesGroup)}>{(Object.keys(GROUP_LABEL) as SalesGroup[]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></div>
          <label className="chk"><input type="checkbox" checked={incVoid} onChange={e => setIncVoid(e.target.checked)} /> مع الملغي</label>
        </>}
        {kind === 'expiry' && <div className="field"><label htmlFor="rd">خلال</label><select id="rd" value={days} onChange={e => setDays(+e.target.value)}><option value={30}>30 يوم</option><option value={90}>90 يوم</option><option value={180}>180 يوم</option></select></div>}
        {kind === 'shortages' && <div className="field"><label htmlFor="rs">الحالة</label><select id="rs" value={status} onChange={e => setStatus(e.target.value as 'all' | 'open' | 'ordered')}><option value="all">الكل</option><option value="open">مفتوح</option><option value="ordered">اتطلب</option></select></div>}
        <span className="actions"><button className="btn ghost" onClick={exportCsv}>تصدير (CSV)</button></span>
      </div>

      <div className="tablewrap"><table className="cards">
        <thead><tr>{table.head.map((h, i) => <th key={i} className={i > 0 && kind === 'sales' ? 'n' : ''}>{h}</th>)}</tr></thead>
        <tbody>
          {table.body.length === 0 && <tr><td colSpan={table.head.length} className="hint" style={{ padding: 18 }}>مفيش بيانات بالفلتر ده.</td></tr>}
          {table.body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={table.head[j]} className={`${j === 0 ? 'nm' : ''}${j > 0 && kind === 'sales' ? ' n' : ''}`}>{c}</td>)}</tr>)}
          {table.body.length > 0 && <tr className="sum">{table.foot.map((c, j) => <td key={j} data-label={table.head[j]} className={`${j === 0 ? 'nm' : ''}${j > 0 && kind === 'sales' ? ' n' : ''}`}><b>{c}</b></td>)}</tr>}
        </tbody>
      </table></div>

      <div className="card" style={{ marginTop: 12 }}>
        <strong>العروض المحفوظة</strong>
        <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
          {views.map(v => <button key={v.name} className="btn ghost" onClick={() => apply(v)}>{v.name}</button>)}
        </div>
        <div className="row" style={{ marginBottom: 0, alignItems: 'flex-end' }}>
          <div className="field"><label htmlFor="vn">اسم العرض الحالي</label><input id="vn" className="txt" value={vname} onChange={e => setVname(e.target.value)} placeholder="مثلا: مبيعات الاسبوع بالمستخدم" /></div>
          <span className="actions"><button className="btn" onClick={saveView}>حفظ العرض</button></span>
        </div>
      </div>
      <p className="hint">ده تقرير واحد من حوالي 77 تقرير في eStock. هنا 3 عينات بنفس الفكرة: فلتر وتجميع وعرض محفوظ وتصدير. {cost ? '' : 'التكلفة والربح مخفية لهذا الدور.'}</p>
    </div>
  );
}

export { daysTo };
