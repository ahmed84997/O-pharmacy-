import { useMemo, useState } from 'react';
import { advanceTransfer, itemById, requestTransfer, searchItems, stockOf } from './domain';
import { ERR, Icon, dmyHm, useApp } from './ui';

const ST = { requested: 'اتطلب', accepted: 'الفرع التاني وافق', dispatched: 'اتشحن', received: 'اتسلم' } as const;
const NEXT_LABEL = { requested: 'محاكاة: الفرع التاني يوافق', accepted: 'محاكاة: الفرع التاني يشحن', dispatched: 'استلام في فرعنا', received: '' } as const;

export default function Branches() {
  const { db, setDb, role, toast, now } = useApp();
  const [q, setQ] = useState(''); const [sel, setSel] = useState<string | null>(null); const [qty, setQty] = useState(1);
  const results = useMemo(() => (sel ? [] : searchItems(db, q, 8)), [db, q, sel]);
  const it = sel ? itemById(db, sel) : null;
  const here = it ? stockOf(db, it.id) : 0;
  const pk = (n: number, per: number) => (per > 1 ? `${Math.floor(n / per)} علبة` : `${n}`);
  const send = () => {
    const r = requestTransfer(db, { itemId: sel!, qtyPack: qty, role, now: now() });
    if (!r.ok) { toast(ERR[r.error] ?? r.error); return; }
    setDb(r.db); toast(`اتبعت طلب التحويل ${r.transfer.no}`);
  };
  const step = (id: string) => { const r = advanceTransfer(db, id, role, now()); if (!r.ok) { toast(ERR[r.error] ?? r.error); return; } setDb(r.db); };

  return (
    <div>
      <h2><Icon n="store" />الفروع (معاينة نسخة Chain)</h2>
      <div className="card warnbox" role="note">معاينة لنسخة الـ Chain (Phase 9): فرعين تجريبيين. الكميات من الفرع التاني بتظهر كارقام فقط ومعاها عمر البيانات، والتحويل بيعدي بسلسلة احداث: طلب ثم موافقة ثم شحن ثم استلام.</div>
      <div className="searchbox" style={{ marginTop: 12 }}>
        <input className="search big" value={q} placeholder="ابحث عن صنف وشوف المتاح في الفرعين" aria-label="صنف" autoComplete="off" onChange={e => { setQ(e.target.value); setSel(null); }} />
        {results.length > 0 && <ul className="dd">{results.map(i => <li key={i.id}><button onClick={() => { setSel(i.id); setQ(i.name); setQty(1); }}><span className="nm">{i.name}</span></button></li>)}</ul>}
      </div>

      {it && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="tablewrap"><table className="cards"><thead><tr><th>الفرع</th><th className="n">المتاح</th><th>عمر البيانات</th></tr></thead><tbody>
            <tr><td className="nm" data-label="الفرع">B1 - فرعنا</td><td className="n" data-label="المتاح">{pk(here, it.perPack)}</td><td data-label="عمر البيانات">دلوقتي</td></tr>
            <tr><td className="nm" data-label="الفرع">B2 - الفرع التاني</td><td className="n" data-label="المتاح">{it.otherBranchQty} علبة</td><td data-label="عمر البيانات"><span className="pill warn">من 4 دقايق</span></td></tr>
          </tbody></table></div>
          <div className="row" style={{ marginTop: 12, marginBottom: 0, alignItems: 'flex-end' }}>
            <div className="field" style={{ maxWidth: 200 }}><label htmlFor="tq">الكمية (علب)</label><input id="tq" className="txt" type="number" min={1} value={qty} onChange={e => setQty(Math.floor(+e.target.value || 1))} /></div>
            <span className="actions"><button className="btn primary" disabled={it.otherBranchQty <= 0} onClick={send}>طلب تحويل من B2</button></span>
          </div>
          {it.otherBranchQty <= 0 && <p className="hint" style={{ marginBottom: 0 }}>الفرع التاني مش معاه رصيد من الصنف ده.</p>}
        </div>
      )}

      <h2 style={{ marginTop: 18 }}><Icon n="truck" />طلبات التحويل</h2>
      <div className="tablewrap"><table className="cards"><thead><tr><th>الرقم</th><th>الصنف</th><th className="n">الكمية</th><th>الحالة</th><th>اخر حركة</th><th /></tr></thead><tbody>
        {db.transfers.length === 0 && <tr><td colSpan={6} className="hint" style={{ padding: 18 }}>مفيش طلبات. اختار صنف الفرع التاني معاه رصيد منه واطلب تحويل.</td></tr>}
        {db.transfers.map(t => (
          <tr key={t.id}><td className="nm" data-label="الرقم">{t.no}</td><td data-label="الصنف">{itemById(db, t.itemId)!.name}</td><td className="n" data-label="الكمية">{t.qtyPack} علبة</td>
            <td data-label="الحالة"><span className={`pill ${t.status === 'received' ? 'ok' : 'warn'}`}>{ST[t.status]}</span></td><td data-label="اخر حركة">{dmyHm(t.log[t.log.length - 1].at)}</td>
            <td className="bt">{t.status !== 'received' && <button className="btn ghost" onClick={() => step(t.id)}>{NEXT_LABEL[t.status]}</button>}</td></tr>
        ))}
      </tbody></table></div>
      <p className="hint">المخزون بيزيد في فرعنا لما الحالة تبقى «اتسلم» بس. ده شكل الـ Phase 9 بشكل مبسط.</p>
    </div>
  );
}
