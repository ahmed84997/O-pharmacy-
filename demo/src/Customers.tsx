import { useEffect, useMemo, useState } from 'react';
import { Customer, CustomerInput, canEditCustomerLimit, cashReceipt, customerStatement, saveCustomer } from './domain';
import { ERR, Icon, TYPE_LABEL, dmyHm, money, useApp } from './ui';

const KIND = { cash: 'نقدي', credit: 'آجل', contract: 'تعاقد' } as const;
type Filter = 'all' | 'credit' | 'owing' | 'over' | 'suspended';

export function Customers() {
  const { db, setDb, role, toast, go } = useApp();
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<Filter>('all');
  const [edit, setEdit] = useState<(CustomerInput & { balance?: number }) | null>(null);
  const [view, setView] = useState<string | null>(null);
  const mgmt = canEditCustomerLimit(role);

  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === 'newcust') setEdit({ name: '', kind: mgmt ? 'credit' : 'cash', limit: 0 }); };
    window.addEventListener('op-cmd', on); return () => window.removeEventListener('op-cmd', on);
  }, [mgmt]);

  const rows = useMemo(() => db.customers.filter(c => c.id !== 'c0').filter(c => (!q || c.name.includes(q)) && (
    filter === 'all' ? true : filter === 'credit' ? c.kind !== 'cash' : filter === 'owing' ? c.balance > 0 : filter === 'over' ? c.balance > c.limit : c.suspended)), [db, q, filter]);
  const totalOwing = rows.reduce((s, c) => s + c.balance, 0);

  const save = () => {
    const r = saveCustomer(db, { input: edit!, role });
    if (!r.ok) { toast(ERR[r.error] ?? r.error); return; }
    setDb(r.db); setEdit(null); toast(edit!.id ? 'اتحفظ التعديل' : 'اتضاف العميل');
  };
  const open = (c: Customer) => setEdit({ id: c.id, name: c.name, kind: c.kind, limit: c.limit, suspended: c.suspended, balance: c.balance });
  const stmt = view ? customerStatement(db, view) : null; const vc = view ? db.customers.find(c => c.id === view) : null;

  return (
    <div>
      <h2><Icon n="users" />قائمة العملاء</h2>
      <div className="row" style={{ alignItems: 'center' }}>
        <input className="search" style={{ margin: 0 }} value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالاسم" aria-label="بحث" />
        <select aria-label="فلتر" value={filter} onChange={e => setFilter(e.target.value as Filter)}>
          <option value="all">الكل</option><option value="credit">آجل وتعاقد</option><option value="owing">عليهم رصيد</option><option value="over">تعدّوا الحد</option><option value="suspended">موقوفين</option></select>
        <button className="btn" onClick={() => setEdit({ name: '', kind: mgmt ? 'credit' : 'cash', limit: 0 })}>عميل جديد</button>
      </div>

      {edit && (
        <div className="card" style={{ marginBottom: 12 }}>
          <strong>{edit.id ? 'تعديل عميل' : 'عميل جديد'}</strong>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field"><label htmlFor="cn">الاسم</label><input id="cn" className="txt" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="ck">النوع</label><select id="ck" value={edit.kind} disabled={!mgmt} onChange={e => setEdit({ ...edit, kind: e.target.value as Customer['kind'] })}><option value="cash">نقدي</option><option value="credit">آجل</option><option value="contract">تعاقد</option></select></div>
            <div className="field"><label htmlFor="cl">حد الائتمان</label><input id="cl" className="txt" type="number" min={0} disabled={!mgmt || edit.kind === 'cash'} value={edit.limit} onChange={e => setEdit({ ...edit, limit: +e.target.value })} /></div>
            {edit.id && <div className="field"><label htmlFor="cs">الحالة</label><select id="cs" disabled={!mgmt} value={edit.suspended ? '1' : '0'} onChange={e => setEdit({ ...edit, suspended: e.target.value === '1' })}><option value="0">شغال</option><option value="1">موقوف</option></select></div>}
          </div>
          {!mgmt && <p className="hint" style={{ marginTop: 0 }}>الآجل وحد الائتمان والايقاف من صلاحية المدير والمالك.</p>}
          <div className="actions" style={{ marginInlineStart: 0 }}><button className="btn primary" onClick={save}>حفظ</button><button className="btn ghost" onClick={() => setEdit(null)}>الغاء</button></div>
        </div>
      )}

      <div className="tablewrap"><table className="cards">
        <thead><tr><th>العميل</th><th>النوع</th><th className="n">الرصيد</th><th className="n">حد الائتمان</th><th>الحالة</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="hint" style={{ padding: 18 }}>مفيش عملاء مطابقين.</td></tr>}
          {rows.map(c => (
            <tr key={c.id}>
              <td className="nm" data-label="العميل">{c.name}</td><td data-label="النوع">{KIND[c.kind]}</td><td className="n" data-label="الرصيد">{money(c.balance)}</td><td className="n" data-label="حد الائتمان">{money(c.limit)}</td>
              <td data-label="الحالة">{c.suspended ? <span className="pill bad">موقوف</span> : c.balance > c.limit ? <span className="pill bad">تعدّى الحد</span> : c.balance > 0 ? <span className="pill warn">عليه رصيد</span> : <span className="pill ok">سليم</span>}</td>
              <td className="bt"><span className="actions" style={{ marginInlineStart: 0 }}><button className="btn ghost" onClick={() => open(c)}>تعديل</button><button className="btn ghost" onClick={() => setView(view === c.id ? null : c.id)}>كشف حساب</button><button className="btn ghost" disabled={c.balance <= 0} onClick={() => go('receipt')}>توريد</button></span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="hint">إجمالي الارصدة في القائمة: {money(totalOwing)} - العميل النقدي مش بيظهر هنا.</p>

      {vc && stmt && (
        <div className="card">
          <strong>كشف حساب: {vc.name}</strong> - الرصيد الحالي {money(vc.balance)}
          <div className="tablewrap" style={{ marginTop: 10 }}><table>
            <thead><tr><th>التاريخ</th><th>البيان</th><th className="n">عليه</th><th className="n">له</th></tr></thead>
            <tbody>
              {stmt.invoices.length + stmt.receipts.length === 0 && <tr><td colSpan={4} className="hint" style={{ padding: 14 }}>مفيش حركات في الديمو لسه. اعمل فاتورة آجل او توريد نقدية.</td></tr>}
              {[...stmt.invoices.map(i => ({ at: i.at, text: `فاتورة ${i.no} (${TYPE_LABEL[i.type]})`, debit: i.net, credit: 0 })), ...stmt.receipts.map(r => ({ at: r.at, text: `توريد ${r.no}`, debit: 0, credit: r.amount }))].sort((a, b) => b.at.localeCompare(a.at))
                .map((m, i) => <tr key={i}><td>{dmyHm(m.at)}</td><td>{m.text}</td><td className="n">{m.debit ? money(m.debit) : ''}</td><td className="n">{m.credit ? money(m.credit) : ''}</td></tr>)}
            </tbody></table></div>
        </div>
      )}
    </div>
  );
}

export function CashReceipt() {
  const { db, setDb, role, toast, now } = useApp();
  const owing = db.customers.filter(c => c.kind !== 'cash' && c.balance > 0);
  const [cid, setCid] = useState(owing[0]?.id ?? ''); const [amount, setAmount] = useState(0); const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const c = db.customers.find(x => x.id === cid);
  const save = () => {
    const r = cashReceipt(db, { customerId: cid, amount, method, role, now: now() });
    if (!r.ok) { toast(ERR[r.error] ?? r.error); return; }
    setDb(r.db); setAmount(0); toast(`تم التوريد ${r.receipt.no} - الرصيد بعد التوريد ${money(r.receipt.balanceAfter)}`);
  };
  return (
    <div>
      <h2><Icon n="wallet" />توريد نقدية</h2>
      <div className="row">
        <div className="field"><label htmlFor="rc">العميل</label>
          <select id="rc" value={cid} onChange={e => setCid(e.target.value)}>{owing.map(x => <option key={x.id} value={x.id}>{x.name} - {money(x.balance)}</option>)}</select></div>
        <div className="field"><label>الرصيد الحالي</label><div className="v">{c ? money(c.balance) : '-'}</div></div>
        <div className="field"><label htmlFor="ra">المبلغ</label><input id="ra" className="txt" type="number" min={0} value={amount} onChange={e => setAmount(+e.target.value)} /></div>
        <div className="field"><label htmlFor="rm">طريقة الدفع</label><select id="rm" value={method} onChange={e => setMethod(e.target.value as 'cash' | 'card')}><option value="cash">كاش</option><option value="card">كارت</option></select></div>
      </div>
      <div className="actions" style={{ marginInlineStart: 0 }}><button className="btn primary" onClick={save}>حفظ التوريد</button>{c && <button className="btn ghost" onClick={() => setAmount(c.balance)}>سداد الرصيد كله</button>}</div>
      <h2 style={{ marginTop: 20 }}><Icon n="history" />آخر التوريدات</h2>
      <div className="tablewrap"><table className="cards"><thead><tr><th>الرقم</th><th>التاريخ</th><th>العميل</th><th className="n">المبلغ</th><th>الطريقة</th><th className="n">الرصيد بعد</th></tr></thead><tbody>
        {db.receipts.length === 0 && <tr><td colSpan={6} className="hint" style={{ padding: 18 }}>مفيش توريدات لسه. التوريد بيقلل رصيد العميل ومش بيتمسح، والتصحيح بيتم بحركة جديدة.</td></tr>}
        {db.receipts.slice(0, 20).map(r => <tr key={r.id}><td className="nm" data-label="الرقم">{r.no}</td><td data-label="التاريخ">{dmyHm(r.at)}</td><td data-label="العميل">{db.customers.find(x => x.id === r.customerId)?.name}</td><td className="n" data-label="المبلغ">{money(r.amount)}</td><td data-label="الطريقة">{r.method === 'cash' ? 'كاش' : 'كارت'}</td><td className="n" data-label="الرصيد بعد">{money(r.balanceAfter)}</td></tr>)}
      </tbody></table></div>
    </div>
  );
}
