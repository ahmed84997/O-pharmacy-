import { useEffect, useMemo, useRef, useState } from 'react';
import { Batch, SaleType, Want, addShortage, canSeeCost, holdSale, isExpired, itemById, priceCart, resumeHeld, saveSale, searchItems, stockOf, customerById, daysTo } from './domain';
import { ERR, Icon, TYPE_LABEL, dmy, money, useApp } from './ui';

let seq = 0;
const packs = (n: number, per: number) => (per > 1 ? `${Math.floor(n / per)} علبة${n % per ? ` + ${n % per}` : ''}` : `${n}`);

export default function Sale() {
  const { db, setDb, role, toast, now } = useApp();
  const [wants, setWants] = useState<Want[]>([]);
  const [type, setType] = useState<SaleType>('cash');
  const [cust, setCust] = useState('c0');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [noStock, setNoStock] = useState<string | null>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const cost = canSeeCost(role);

  const results = useMemo(() => searchItems(db, q), [db, q]);
  const priced = useMemo(() => priceCart(db, wants), [db, wants]);
  const customer = customerById(db, cust)!;

  const add = (itemId: string) => {
    const it = itemById(db, itemId)!;
    if (it.suspended) { toast('الصنف موقوف'); return; }
    if (stockOf(db, itemId) <= 0) { setNoStock(itemId); setOpen(false); return; }
    setNoStock(null);
    setWants(w => {
      const ex = w.find(x => x.itemId === itemId && x.unit === 'pack' && !x.batchId);
      return ex ? w.map(x => x === ex ? { ...x, qty: x.qty + 1 } : x) : [...w, { key: `w${++seq}`, itemId, unit: 'pack', qty: 1, discountPct: 0 }];
    });
    setQ(''); setOpen(false); qRef.current?.focus();
  };
  const upd = (key: string, p: Partial<Want>) => setWants(w => w.map(x => x.key === key ? { ...x, ...p } : x));
  const del = (key: string) => setWants(w => w.filter(x => x.key !== key));

  const save = () => {
    const r = saveSale(db, { wants, type, customerId: cust, role, now: now() });
    if (!r.ok) {
      const miss = priced.missing[0];
      if (r.error === 'insufficient-stock' && miss) toast(`${ERR[r.error]}: ${itemById(db, miss.itemId)!.name}`); else toast(ERR[r.error] ?? r.error);
      return;
    }
    setDb(r.db); setWants([]); setType('cash'); setCust('c0'); toast(`تم حفظ الفاتورة ${r.invoice.no} - الصافي ${money(r.invoice.net)} جنيه`);
  };
  const hold = () => {
    const r = holdSale(db, { wants, type, customerId: cust, now: now() });
    if (!r.ok) { toast(ERR[r.error]); return; }
    setDb(r.db); setWants([]); toast('تم تعليق الفاتورة');
  };
  const resume = (id: string) => {
    if (wants.length) { toast('علّق الفاتورة الحالية أو امسحها الأول'); return; }
    const r = resumeHeld(db, id); if (!r) return;
    setDb(r.db); setWants(r.held.wants); setType(r.held.type); setCust(r.held.customerId);
  };
  const shortage = (itemId: string) => { setDb(addShortage(db, itemId, 'no-stock', role, now())); setNoStock(null); setQ(''); toast('اتضاف لكشكول النواقص'); };

  // keep the latest handlers reachable from global shortcuts and Ribbon commands
  const ref = useRef({ save, hold });
  ref.current = { save, hold };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); qRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); ref.current.hold(); }
      else if (e.key === 'F8') { e.preventDefault(); ref.current.save(); }
    };
    const onCmd = (e: Event) => {
      const c = (e as CustomEvent<string>).detail;
      if (c === 'focus') qRef.current?.focus(); else if (c === 'hold') ref.current.hold(); else if (c === 'delline') setWants(w => w.slice(0, -1));
      else if (c === 'print') toast('الطباعة الحقيقية في Phase 4 - هنا نموذج فقط'); else if (c === 'drawer') toast('فتح الدرج يحتاج الـ Hub والطابعة - Phase 4');
    };
    window.addEventListener('keydown', onKey); window.addEventListener('op-cmd', onCmd);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('op-cmd', onCmd); };
  }, [toast]);
  useEffect(() => { qRef.current?.focus(); }, []);

  const lineBatches = (w: Want) => priced.lines.filter(l => l.itemId === w.itemId && l.unit === w.unit && (!w.batchId || l.batchId === w.batchId));
  const missingOf = (w: Want) => priced.missing.find(m => m.itemId === w.itemId);
  const otherBatches = (itemId: string): Batch[] => db.batches.filter(b => b.itemId === itemId && b.qty > 0 && !isExpired(b, db.today)).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const nsItem = noStock ? itemById(db, noStock) : null;

  return (
    <div>
      <h2><Icon n="cart" />فاتورة بيع</h2>
      <div className="row">
        <div className="field"><label htmlFor="type">نوع الفاتورة</label>
          <select id="type" value={type} onChange={e => setType(e.target.value as SaleType)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="cust">العميل</label>
          <select id="cust" value={cust} onChange={e => setCust(e.target.value)}>{db.customers.filter(c => !c.suspended).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>رصيد العميل / حد الائتمان</label>
          <div className="v">{customer.kind === 'cash' ? '-' : <>{money(customer.balance)} / {money(customer.limit)}{customer.balance > customer.limit && <span className="pill bad" style={{ marginInlineStart: 8 }}>تعدّى الحد</span>}</>}</div></div>
      </div>

      <div className="searchbox">
        <input ref={qRef} className="search big" value={q} placeholder="امسح الباركود أو اكتب جزء من الاسم (F2)" aria-label="بحث عن صنف" autoComplete="off"
          onChange={e => { setQ(e.target.value); setOpen(true); setNoStock(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); add(results[0].id); } else if (e.key === 'Escape') { setOpen(false); setQ(''); } }} />
        {open && results.length > 0 && (
          <ul className="dd" role="listbox">
            {results.map(it => {
              const st = stockOf(db, it.id); const nearest = otherBatches(it.id)[0];
              return (
                <li key={it.id}><button role="option" aria-selected={false} onClick={() => add(it.id)}>
                  <span className="nm">{it.name}</span>
                  <span className="meta">{it.suspended ? <span className="pill bad">موقوف</span> : st <= 0 ? <span className="pill bad">لا يوجد رصيد</span> : <>{packs(st, it.perPack)} - {money(it.publicPrice)}{nearest && <> - صلاحية {dmy(nearest.expiry).slice(3)}</>}</>}</span>
                </button></li>
              );
            })}
          </ul>
        )}
      </div>

      {nsItem && (
        <div className="card warnbox" role="status">
          <strong>{nsItem.name}</strong> - لا يوجد رصيد في هذا الفرع.
          <div className="hint" style={{ marginTop: 4 }}>المتاح في فروع أخرى (كميات فقط): <b>{nsItem.otherBranchQty > 0 ? `${nsItem.otherBranchQty} علبة` : 'غير متاح'}</b></div>
          <div className="row" style={{ marginTop: 8, marginBottom: 0 }}>
            <button className="btn" onClick={() => shortage(nsItem.id)}>اضافة لكشكول النواقص</button>
            <button className="btn ghost" onClick={() => setNoStock(null)}>اغلاق</button>
          </div>
        </div>
      )}

      {db.held.length > 0 && (
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="hint" style={{ margin: 0 }}>فواتير معلقة:</span>
          {db.held.map(h => <button key={h.id} className="btn ghost" onClick={() => resume(h.id)}>{customerById(db, h.customerId)?.name} - {h.wants.length} صنف</button>)}
        </div>
      )}

      <div className="tablewrap">
        <table className="lines">
          <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th className="n">الكمية</th><th className="n">السعر</th><th className="n">خصم ٪</th><th className="n">الاجمالي</th><th>الباتش (الاقدم صلاحية اولا)</th><th /></tr></thead>
          <tbody>
            {wants.length === 0 && <tr><td colSpan={9} className="hint" style={{ padding: 18 }}>الفاتورة فاضية - امسح باركود او اكتب اسم صنف.</td></tr>}
            {wants.map((w, i) => {
              const it = itemById(db, w.itemId)!; const ls = lineBatches(w); const miss = missingOf(w);
              const tot = ls.reduce((s, l) => s + l.total, 0);
              const bs = otherBatches(w.itemId);
              return (
                <tr key={w.key} className={miss ? 'sel' : ''}>
                  <td className="idx">{i + 1}</td>
                  <td className="nm">{it.name}{miss && <div className="pill bad" style={{ marginTop: 4, display: 'inline-block' }}>المتاح اقل من المطلوب</div>}</td>
                  <td data-label="الوحدة">{it.perPack > 1 ? <select aria-label="الوحدة" value={w.unit} onChange={e => upd(w.key, { unit: e.target.value as 'pack' | 'sub' })}><option value="pack">{it.packUnit}</option><option value="sub">{it.subUnit}</option></select> : it.packUnit}</td>
                  <td data-label="الكمية" className="n"><input className="num" type="number" min={1} step={1} value={w.qty} aria-label="الكمية" onChange={e => upd(w.key, { qty: Math.max(0, Math.floor(+e.target.value || 0)) })} /></td>
                  <td data-label="السعر" className="n">{ls[0] ? money(ls[0].unitPrice) : '-'}{ls.length > 1 && <small className="muted"> +</small>}</td>
                  <td data-label="خصم ٪" className="n"><input className="num" type="number" min={0} max={cost ? 100 : 10} value={w.discountPct} aria-label="خصم" onChange={e => upd(w.key, { discountPct: Math.min(cost ? 100 : 10, Math.max(0, +e.target.value || 0)) })} /></td>
                  <td data-label="الاجمالي" className="n">{money(tot)}</td>
                  <td data-label="الباتش" className="bt">
                    <select aria-label="تغيير الباتش" value={w.batchId ?? ''} onChange={e => upd(w.key, { batchId: e.target.value || undefined })}>
                      <option value="">تلقائي{ls[0] ? ` (${dmy(db.batches.find(b => b.id === ls[0].batchId)?.expiry ?? db.today).slice(3)})` : ''}</option>
                      {bs.map(b => <option key={b.id} value={b.id}>{dmy(b.expiry).slice(3)} - {packs(b.qty, it.perPack)}{daysTo(b.expiry, db.today) <= 90 ? ' - قريب الانتهاء' : ''}{b.priceChanged ? ' - سعر مختلف' : ''}</option>)}
                    </select>
                  </td>
                  <td><button className="qbtn" onClick={() => del(w.key)} aria-label="حذف السطر"><Icon n="x" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="totals">
        <div className="net"><small>الصافي المطلوب</small><strong>{money(priced.net)}</strong></div>
        <div className="mini">
          <span>عدد الاصناف: {wants.length}</span><span>الاجمالي قبل الخصم: {money(priced.gross)}</span><span>الخصم: {money(priced.discount)}</span>
          {cost ? <><span>تكلفة الفاتورة: {money(priced.cost)}</span><span>ربح الفاتورة: {money(priced.net - priced.cost)}</span></> : <span className="muted">التكلفة والربح مخفية لهذا الدور</span>}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={save}>حفظ (F8)</button>
          <button className="btn ghost" onClick={hold}>تعليق (F4)</button>
          <button className="btn ghost" onClick={() => { setWants([]); setNoStock(null); }}>مسح</button>
        </div>
      </div>
      <p className="hint">F2 بحث - F4 تعليق - F8 حفظ - الباتش بيتاخد تلقائيا من الاقرب انتهاء، وممكن تغيّره من العمود الاخير.</p>
    </div>
  );
}
