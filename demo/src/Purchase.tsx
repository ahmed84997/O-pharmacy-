import { useMemo, useState } from 'react';
import { Item, PurchaseDraftLine, effectiveCost, itemById, marginPct, round2, savePurchase, searchItems, stockOf } from './domain';
import { ERR, Icon, dmy, money, useApp } from './ui';

const addMonths = (today: string, m: number) => { const d = new Date(today + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)).toISOString().slice(0, 10); };

export default function Purchase() {
  const { db, setDb, role, toast, now } = useApp();
  const [sup, setSup] = useState(db.suppliers[0].id);
  const [lines, setLines] = useState<PurchaseDraftLine[]>([]);
  const [paid, setPaid] = useState(0);
  const [q, setQ] = useState('');
  const [it, setIt] = useState<Item | null>(null);
  const [f, setF] = useState({ expiry: addMonths(db.today, 24), qty: 10, bonus: 0, cost: 0, price: 0 });
  const results = useMemo(() => (it ? [] : searchItems(db, q)), [db, q, it]);

  const pick = (i: Item) => {
    const last = db.batches.filter(b => b.itemId === i.id).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn))[0];
    setIt(i); setQ(i.name);
    setF(x => ({ ...x, cost: last?.costPack ?? round2(i.publicPrice * 0.8), price: i.publicPrice, qty: 10, bonus: 0 }));
  };
  const reset = () => { setIt(null); setQ(''); };
  const draft = it ? { itemId: it.id, expiry: f.expiry, qtyPack: f.qty, bonusPack: f.bonus, costPack: f.cost, pricePack: f.price } : null;
  const addLine = () => {
    if (!draft) return;
    if (!(draft.qtyPack > 0 && draft.costPack > 0 && draft.pricePack > 0)) { toast(ERR['bad-line']); return; }
    if (draft.expiry < db.today) { toast(ERR['bad-expiry']); return; }
    setLines(l => [...l, draft]); reset();
  };
  const total = round2(lines.reduce((s, l) => s + l.costPack * l.qtyPack, 0));
  const save = () => {
    const r = savePurchase(db, { supplierId: sup, lines, paid, role, now: now() });
    if (!r.ok) { toast(ERR[r.error] ?? r.error); return; }
    setDb(r.db); setLines([]); setPaid(0); toast(`تم حفظ فاتورة المشتريات ${r.purchase.no} - الاجمالي ${money(r.purchase.total)} - اتضافت باتشات للمخزون`);
  };
  const supplier = db.suppliers.find(s => s.id === sup)!;

  return (
    <div>
      <h2><Icon n="file" />فاتورة مشتريات</h2>
      <div className="row">
        <div className="field"><label htmlFor="sup">المورد</label><select id="sup" value={sup} onChange={e => setSup(e.target.value)}>{db.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>رصيد المورد (مستحق له)</label><div className="v">{money(supplier.balance)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="searchbox">
          <input className="search big" value={q} placeholder="ابحث عن الصنف بالاسم او الباركود" aria-label="صنف" autoComplete="off" onChange={e => { setQ(e.target.value); setIt(null); }} />
          {results.length > 0 && <ul className="dd">{results.map(i => <li key={i.id}><button onClick={() => pick(i)}><span className="nm">{i.name}</span><span className="meta">رصيد {stockOf(db, i.id)} - {money(i.publicPrice)}</span></button></li>)}</ul>}
        </div>
        {it && draft && (
          <>
            <div className="row">
              <div className="field"><label htmlFor="exp">تاريخ الصلاحية</label><input id="exp" className="date" type="date" value={f.expiry} onChange={e => setF({ ...f, expiry: e.target.value })} /></div>
              <div className="field"><label htmlFor="qty">الكمية (علب)</label><input id="qty" className="txt" type="number" min={1} value={f.qty} onChange={e => setF({ ...f, qty: +e.target.value })} /></div>
              <div className="field"><label htmlFor="bonus">بونص (علب)</label><input id="bonus" className="txt" type="number" min={0} value={f.bonus} onChange={e => setF({ ...f, bonus: +e.target.value })} /></div>
              <div className="field"><label htmlFor="cost">سعر الشراء للعلبة</label><input id="cost" className="txt" type="number" min={0} step="0.25" value={f.cost} onChange={e => setF({ ...f, cost: +e.target.value })} /></div>
              <div className="field"><label htmlFor="price">{it.drug ? 'سعر الجمهور (مسعّر من الدولة)' : 'سعر البيع (حر)'}</label><input id="price" className="txt" type="number" min={0} step="0.25" value={f.price} onChange={e => setF({ ...f, price: +e.target.value })} /></div>
            </div>
            <div className="row" style={{ alignItems: 'center', marginBottom: 0 }}>
              <span className="mini">التكلفة الفعلية بعد البونص: <b>{money(effectiveCost(draft))}</b> - هامش الربح: <b>{marginPct(draft)}٪</b>
                {it.drug && f.price !== it.publicPrice && <span className="pill warn" style={{ marginInlineStart: 8 }}>سعر جديد - الباتش ده بسعره الخاص</span>}</span>
              <span className="actions"><button className="btn" onClick={addLine}>اضافة السطر</button><button className="btn ghost" onClick={reset}>الغاء</button></span>
            </div>
          </>
        )}
      </div>

      <div className="tablewrap"><table>
        <thead><tr><th>#</th><th>الصنف</th><th>الصلاحية</th><th className="n">الكمية</th><th className="n">بونص</th><th className="n">سعر الشراء</th><th className="n">التكلفة الفعلية</th><th className="n">سعر البيع</th><th className="n">الهامش</th><th className="n">الاجمالي</th><th /></tr></thead>
        <tbody>
          {lines.length === 0 && <tr><td colSpan={11} className="hint" style={{ padding: 18 }}>لا توجد اسطر - ابحث عن صنف وضيفه.</td></tr>}
          {lines.map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{itemById(db, l.itemId)!.name}</td><td>{dmy(l.expiry)}</td><td className="n">{l.qtyPack}</td><td className="n">{l.bonusPack}</td><td className="n">{money(l.costPack)}</td>
              <td className="n">{money(effectiveCost(l))}</td><td className="n">{money(l.pricePack)}</td><td className="n">{marginPct(l)}٪</td><td className="n">{money(l.costPack * l.qtyPack)}</td>
              <td><button className="qbtn" aria-label="حذف السطر" onClick={() => setLines(x => x.filter((_, k) => k !== i))}><Icon n="x" /></button></td></tr>
          ))}
        </tbody>
      </table></div>

      <div className="totals">
        <div className="net"><small>اجمالي الفاتورة</small><strong>{money(total)}</strong></div>
        <div className="field" style={{ maxWidth: 220 }}><label htmlFor="paid">المدفوع الان</label><input id="paid" className="txt" type="number" min={0} value={paid} onChange={e => setPaid(+e.target.value)} /></div>
        <div className="mini"><span>الباقي على المورد: {money(Math.max(0, total - paid))}</span></div>
        <div className="actions"><button className="btn primary" onClick={save}>حفظ الفاتورة</button></div>
      </div>
      <p className="hint">الحفظ بيضيف باتش جديد لكل سطر (بصلاحيته وسعره)، والبيع بعد كده بيسحب الاقرب انتهاء الاول.</p>
    </div>
  );
}
