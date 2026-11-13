/* Sprint 7.8: the purchase invoice as a grid (owner's list, 12 Nov 2026): supplier by code, one row per item with unit, quantity,
   expiry, sale price, discount, purchase price, tax, totals and current stock; a side bar and a right-click menu with the same actions;
   hold and restore (held, posted, purchase order); shelf labels; printing the invoice. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, arabic } from './api';
import { int, invErr, NewItem, type InvItem, type Supplier } from './inv';
import { qtyText } from './pos';
import { dmyHm, egp, Icon, money, newKey, toMinor, useApp } from './ui';

type Unit = { name: string; factor: number };
type Hint = { id: string; code: string; nameAr: string; kind: string; status: string; units: Unit[]; listPriceMinor: number | null; stockBase: number; barcode: string | null; last: { priceUnit: string; publicPriceMinor: number | null; costMinor: number | null; discountBp: number } | null };
type Line = { item: Hint; unit: string; qty: string; bonus: string; expiry: string; lot: string; price: string; disc: string; cost: string; tax: string };
type Saved = Omit<Line, 'item'> & { itemId: string };
type Posted = { piNo: string; status: string; supplierId: string; supplierRef: string | null; totalMinor: number; taxTotalMinor: number; createdAt: string; voidReason: string | null; lines: { itemId: string; itemName: string; lot: string; expiry: string; paidBase: number; bonusBase: number; costMinor: number; totalMinor: number; discountBp: number; taxMinor: number; publicPriceMinor: number | null; priceUnit: string; priceFactor: number }[] };

const factor = (h: Hint, unit: string) => h.units.find(u => u.name === unit)?.factor ?? 1;
const biggest = (h: Hint) => [...h.units].sort((a, b) => b.factor - a.factor)[0]!.name;
const conv = (minor: number, fromF: number, toF: number) => Math.round((minor * toF) / fromF);
const bpOf = (disc: string) => { const n = Number(disc.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const pct = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : NaN; };

/** The sale price of one unit: for a drug the last state price we bought it at, for anything else the item's own price. */
function priceFor(h: Hint, unit: string): number | null {
  const f = factor(h, unit);
  if (h.kind === 'drug') { if (!h.last?.publicPriceMinor) return null; return conv(h.last.publicPriceMinor, factor(h, h.last.priceUnit), f); }
  if (h.listPriceMinor == null) return null; const last = h.units[h.units.length - 1]!; return conv(h.listPriceMinor, last.factor, f);
}
function newLine(h: Hint): Line {
  const unit = biggest(h); const p = priceFor(h, unit); const bp = h.last?.discountBp ?? 0;
  const cost = h.last?.costMinor != null ? conv(h.last.costMinor, factor(h, h.last.priceUnit), factor(h, unit)) : p != null ? Math.round((p * (10000 - bp)) / 10000) : null;
  return { item: h, unit, qty: '1', bonus: '', expiry: '', lot: '', price: p == null ? '' : egp(p), disc: bp ? String(bp / 100) : '0', cost: cost == null ? '' : egp(cost), tax: '0' };
}
function calc(l: Line) {
  const P = toMinor(l.price), C = toMinor(l.cost), q = int(l.qty), b = l.bonus ? int(l.bonus) : 0, t = pct(l.tax);
  const ok = q > 0 && C != null; const taxMinor = ok && t >= 0 ? Math.round((C! * q * t) / 100) : 0;
  return { P, C, q, b, taxMinor, totalCost: ok ? C! * q + taxMinor : 0, totalPublic: P != null && q > 0 ? P * q : 0 };
}

export function PurchaseInvoiceScreen() {
  const { can, toast, ask, go } = useApp();
  const [sups, setSups] = useState<Supplier[]>([]); const [supId, setSupId] = useState(''); const [supCode, setSupCode] = useState(''); const [ref, setRef] = useState('');
  const [lines, setLines] = useState<Line[]>([]); const [sel, setSel] = useState<number | null>(null); const [draft, setDraft] = useState<{ id: string; no: string } | null>(null); const [po, setPo] = useState<{ id: string; no: string } | null>(null);
  const [err, setErr] = useState(''); const [warn, setWarn] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null); const [restore, setRestore] = useState(false); const [adding, setAdding] = useState(false); const [view, setView] = useState<Posted | null>(null); const [printing, setPrinting] = useState<null | { title: string; rows: { name: string; unit: string; qty: number; bonus: number; expiry: string; price: number | null; disc: number; cost: number; tax: number; total: number }[]; tax: number; total: number; pub: number; ref: string | null; when: string }>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  useEffect(() => { api<{ suppliers: Supplier[] }>('/api/buy/suppliers').then(r => setSups(r.suppliers), () => setSups([])); }, []);
  const sup = sups.find(s => s.id === supId);
  const matchCode = (t: string) => sups.find(s => s.code === t || s.code.replace(/\D/g, '').replace(/^0+/, '') === t.replace(/^0+/, ''));
  const pickCode = (v: string) => { setSupCode(v); const t = v.trim(); if (!t) return; const m = matchCode(t); setSupId(m ? m.id : ''); };
  useEffect(() => { const t = supCode.trim(); if (t && !supId) { const m = matchCode(t); if (m) setSupId(m.id); } }, [sups]); // eslint-disable-line react-hooks/exhaustive-deps
  const hint = (id: string) => api<Hint>(`/api/buy/item-hint/${id}`);
  const add = async (id: string) => { try { const h = await hint(id); setLines(ls => { setSel(ls.length); return [...ls, newLine(h)]; }); } catch (e) { toast(arabic(e)); } };
  const upd = (i: number, p: Partial<Line>) => setLines(ls => ls.map((l, k) => {
    if (k !== i) return l; const n = { ...l, ...p };
    if ('unit' in p && p.unit !== l.unit) { const from = factor(l.item, l.unit), to = factor(l.item, p.unit!); const P = toMinor(l.price), C = toMinor(l.cost); if (P != null) n.price = egp(conv(P, from, to)); if (C != null) n.cost = egp(conv(C, from, to)); }
    if ('price' in p || 'disc' in p) { const P = toMinor(n.price), bp = bpOf(n.disc); if (P != null && bp >= 0 && bp <= 10000) n.cost = egp(Math.round((P * (10000 - bp)) / 10000)); }
    if ('cost' in p) { const P = toMinor(n.price), C = toMinor(n.cost); if (P && C != null) n.disc = String(Math.round((1 - C / P) * 10000) / 100); }
    return n;
  }));
  const del = (i: number | null) => { if (i === null) return toast('اختار السطر الأول'); setLines(ls => ls.filter((_, k) => k !== i)); setSel(null); };
  const totals = useMemo(() => lines.reduce((t, l) => { const c = calc(l); return { cost: t.cost + c.totalCost, tax: t.tax + c.taxMinor, pub: t.pub + c.totalPublic }; }, { cost: 0, tax: 0, pub: 0 }), [lines]);
  const clear = () => { setLines([]); setSel(null); setDraft(null); setPo(null); setRef(''); setErr(''); };
  const savedLines = (): Saved[] => lines.map(({ item, ...rest }) => ({ ...rest, itemId: item.id }));

  const hold = useCallback(async () => {
    if (!lines.length) return toast('الفاتورة فاضية'); setBusy(true);
    try { const r = await api<{ id: string; draftNo: string }>('/api/buy/drafts', { body: { key: newKey(), id: draft?.id, supplierId: supId || undefined, supplierRef: ref || undefined, poId: po?.id, lines: savedLines() } }); toast(`اتعلّقت الفاتورة ${r.draftNo}: هتلاقيها في استرجاع`); clear(); }
    catch (e) { toast(invErr(e)); } finally { setBusy(false); }
  }, [lines, draft, supId, ref, po]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    setErr(''); if (!supId) return setErr('اكتب كود المورد أو اختاره'); if (!lines.length) return setErr('الفاتورة فاضية');
    const bad = lines.findIndex(l => { const c = calc(l); return !(c.q > 0) || c.C == null || !l.expiry.trim() || (l.item.kind === 'drug' && c.P == null) || Number.isNaN(bpOf(l.disc)) || Number.isNaN(pct(l.tax)) || (l.bonus && !(int(l.bonus) >= 0)); });
    if (bad >= 0) { setSel(bad); return setErr(`كمّل السطر ${bad + 1}: الكمية والصلاحية وسعر الشراء${lines[bad]!.item.kind === 'drug' ? ' وسعر البيع' : ''}`); }
    setBusy(true);
    try {
      const body = { key: newKey(), supplierId: supId, supplierRef: ref || undefined, poId: po?.id, draftId: draft?.id, lines: lines.map(l => { const c = calc(l); const drug = l.item.kind === 'drug'; return { itemId: l.item.id, lot: l.lot.trim(), expiry: l.expiry.trim(), qty: c.q, unitName: l.unit, bonusQty: c.b || undefined, costMinor: c.C, discountBp: Math.max(0, Math.min(10000, bpOf(l.disc))), taxMinor: c.taxMinor || undefined, publicPriceMinor: drug ? c.P : undefined, priceUnitName: drug ? l.unit : undefined }; }) };
      const r = await api<{ piNo: string; totalMinor: number; warnings: string[] }>('/api/buy/invoices', { body }); toast(`اتحفظت ${r.piNo} - ${money(r.totalMinor)}`); setWarn(r.warnings); clear();
    } catch (e) { setErr(invErr(e)); } finally { setBusy(false); }
  }, [lines, supId, ref, po, draft]);

  const labels = async () => {
    const rows = sel !== null && lines[sel] ? [lines[sel]!] : lines; if (!rows.length) return toast('مفيش أصناف');
    try { const r = await api<{ printer: string; results: { ok: boolean }[] }>('/api/print/labels', { body: { lines: rows.map(l => { const c = calc(l); return { itemId: l.item.id, copies: Math.max(1, (c.q || 1) + (c.b || 0)), priceMinor: c.P ?? undefined }; }) } }); const bad = r.results.filter(x => !x.ok).length; toast(bad ? `اتبعت للطابعة ${r.printer} - ${bad} صنف مطبعش` : `اتبعت الاستيكرات لـ ${r.printer}`); }
    catch (e) { toast((e as { code?: string }).code === 'state' ? 'مفيش طابعة استيكر متظبطة: الإعدادات ← الطابعات' : arabic(e)); }
  };
  const printInvoice = () => {
    if (!lines.length) return toast('مفيش أصناف للطباعة');
    setPrinting({ title: draft ? `فاتورة معلّقة ${draft.no}` : 'فاتورة مشتريات (قبل الحفظ)', ref: ref || null, when: dmyHm(new Date().toISOString()), tax: totals.tax, total: totals.cost, pub: totals.pub,
      rows: lines.map(l => { const c = calc(l); return { name: l.item.nameAr, unit: l.unit, qty: c.q || 0, bonus: c.b || 0, expiry: l.expiry, price: c.P, disc: bpOf(l.disc) / 100, cost: c.C ?? 0, tax: c.taxMinor, total: c.totalCost }; }) });
  };
  const printPosted = (v: Posted) => setPrinting({ title: `فاتورة مشتريات ${v.piNo}${v.status === 'void' ? ' (ملغاة)' : ''}`, ref: v.supplierRef, when: dmyHm(v.createdAt), tax: v.taxTotalMinor, total: v.totalMinor, pub: v.lines.reduce((t, l) => t + (l.publicPriceMinor ?? 0) * (l.paidBase / l.priceFactor), 0),
    rows: v.lines.map(l => ({ name: l.itemName, unit: l.priceUnit, qty: l.paidBase / l.priceFactor, bonus: l.bonusBase / l.priceFactor, expiry: l.expiry.slice(0, 7), price: l.publicPriceMinor, disc: l.discountBp / 100, cost: l.costMinor, tax: l.taxMinor, total: l.totalMinor })) });
  useEffect(() => { if (!printing) return; const t = window.setTimeout(() => { window.print(); setPrinting(null); }, 50); return () => window.clearTimeout(t); }, [printing]);

  const loadSaved = async (o: { lines: Saved[]; supplierId: string | null; supplierRef: string | null; draft?: { id: string; no: string }; po?: { id: string; no: string } }) => {
    try { const hs = await Promise.all([...new Set(o.lines.map(l => l.itemId))].map(id => hint(id))); const by = new Map(hs.map(h => [h.id, h]));
      setLines(o.lines.filter(l => by.has(l.itemId)).map(({ itemId, ...rest }) => ({ ...rest, item: by.get(itemId)! }))); setSupId(o.supplierId ?? ''); setSupCode(''); setRef(o.supplierRef ?? ''); setDraft(o.draft ?? null); setPo(o.po ?? null); setSel(null); setRestore(false); setErr('');
    } catch (e) { toast(arabic(e)); }
  };

  const actions: { id: string; label: string; icon: string; key?: string; run: () => void; show?: boolean }[] = [
    { id: 'save', label: 'حفظ', icon: 'save', key: 'F9', run: () => void save() },
    { id: 'hold', label: 'تعليق الفاتورة', icon: 'pause', key: 'F4', run: () => void hold() },
    { id: 'labels', label: 'طباعة باركود', icon: 'barcode', run: () => void labels() },
    { id: 'print', label: 'طباعة فاتورة', icon: 'print', run: printInvoice },
    { id: 'restore', label: 'استرجاع', icon: 'history', key: 'F6', run: () => setRestore(true) },
    { id: 'add', label: 'إضافة صنف', icon: 'search', key: 'F2', run: () => searchRef.current?.querySelector('input')?.focus() },
    { id: 'del', label: 'حذف سطر', icon: 'trash', key: 'Del', run: () => del(sel) },
    { id: 'new', label: 'صنف جديد', icon: 'plus', run: () => setAdding(true), show: can('item.create') },
  ];
  const visible = actions.filter(a => a.show !== false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (restore || adding || view) return; const inField = (e.target as HTMLElement)?.closest?.('input, select, textarea');
      if (e.key === 'F9') { e.preventDefault(); void save(); } else if (e.key === 'F4') { e.preventDefault(); void hold(); } else if (e.key === 'F6') { e.preventDefault(); setRestore(true); }
      else if (e.key === 'F2') { e.preventDefault(); searchRef.current?.querySelector('input')?.focus(); } else if (e.key === 'Delete' && !inField && sel !== null) { e.preventDefault(); del(sel); }
      else if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [save, hold, sel, restore, adding, view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (adding) return <div className="pi-new"><NewItem done={id => { setAdding(false); if (id) void add(id); }} /></div>;
  return (
    <div className="pi" onContextMenu={e => { if ((e.target as HTMLElement).closest('input, select, textarea')) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }} onClick={() => menu && setMenu(null)}>
      <div className="pi-main">
        <div className="pi-head">
          <h2 style={{ margin: 0 }}><Icon n="file" />فاتورة مشتريات</h2>
          {draft && <span className="pill s-reserved">معلّقة {draft.no}</span>}{po && <span className="pill">من أمر الشراء {po.no}</span>}
        </div>
        <div className="card pi-sup">
          <label>كود المورد<input dir="ltr" value={supCode} onChange={e => pickCode(e.target.value)} placeholder="مثلًا 3" style={{ maxWidth: 120 }} />{supCode.trim() && !supId && <small className="err">مفيش مورد بالكود ده</small>}</label>
          <label style={{ flex: 2 }}>المورد<select value={supId} onChange={e => { setSupId(e.target.value); setSupCode(''); }}><option value="">اختار</option>{sups.map(s => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}</select></label>
          <label>رقم الفاتورة<input dir="ltr" value={ref} onChange={e => setRef(e.target.value)} /></label>
          {sup && <span className="muted pi-supinfo">{sup.phone ?? ''}{sup.address ? ` - ${sup.address}` : ''}</span>}
        </div>

        <div className="card pi-items">
          <div className="pi-itemsbar"><b>أصناف الفاتورة</b><div ref={searchRef} className="pi-search"><PickItem onPick={it => void add(it.id)} /></div></div>
          <div className="tablewrap pgrid-wrap"><table className="pgrid">
            <thead><tr><th>#</th><th>اسم الصنف</th><th>الوحدة</th><th className="n">الكمية</th><th className="n">بونص</th><th>الصلاحية</th><th>التشغيلة</th><th className="n">سعر البيع</th><th className="n">خصم %</th><th className="n">سعر الشراء</th><th className="n">ضريبة %</th><th className="n">إجمالي التكلفة</th><th className="n">الرصيد</th><th className="n">إجمالي الجمهور</th></tr></thead>
            <tbody>
              {lines.map((l, i) => { const c = calc(l); const drug = l.item.kind === 'drug'; return (
                <tr key={i} className={sel === i ? 'sel' : ''} onClick={() => setSel(i)} onContextMenu={() => setSel(i)}>
                  <td className="idx">{i + 1}</td>
                  <td className="nm"><b>{l.item.nameAr}</b><small className="muted">{l.item.code}</small></td>
                  <td><select value={l.unit} onChange={e => upd(i, { unit: e.target.value })}>{l.item.units.map(u => <option key={u.name}>{u.name}</option>)}</select></td>
                  <td><input className="n w6" value={l.qty} onChange={e => upd(i, { qty: e.target.value })} /></td>
                  <td><input className="n w5" value={l.bonus} onChange={e => upd(i, { bonus: e.target.value })} /></td>
                  <td><input dir="ltr" className="w8" value={l.expiry} placeholder="MM/YYYY" onChange={e => upd(i, { expiry: e.target.value })} /></td>
                  <td><input dir="ltr" className="w7" value={l.lot} placeholder="اختياري" onChange={e => upd(i, { lot: e.target.value })} /></td>
                  <td><input className="n w8" value={l.price} readOnly={!drug} title={drug ? 'سعر الجمهور للوحدة' : 'سعر الصنف من كارت الصنف'} onChange={e => upd(i, { price: e.target.value })} /></td>
                  <td><input className="n w5" value={l.disc} onChange={e => upd(i, { disc: e.target.value })} /></td>
                  <td><input className="n w8" value={l.cost} onChange={e => upd(i, { cost: e.target.value })} /></td>
                  <td><input className="n w5" value={l.tax} onChange={e => upd(i, { tax: e.target.value })} /></td>
                  <td className="n"><b>{money(c.totalCost)}</b>{c.taxMinor > 0 && <small className="muted">ض {money(c.taxMinor)}</small>}</td>
                  <td className="n muted">{qtyText(l.item.stockBase, l.item.units)}</td>
                  <td className="n">{money(c.totalPublic)}</td>
                </tr>); })}
              {!lines.length && <tr><td colSpan={14} className="muted" style={{ textAlign: 'center', padding: 24 }}>دوّر على صنف فوق (F2) أو استرجع فاتورة معلّقة أو أمر شراء (F6)</td></tr>}
            </tbody>
          </table></div>
        </div>

        <div className="pi-totals">
          <div className="pi-tot"><span>عدد الأصناف</span><b>{lines.length}</b></div>
          <div className="pi-tot"><span>إجمالي الجمهور</span><b>{money(totals.pub)}</b></div>
          <div className="pi-tot"><span>الضريبة</span><b>{money(totals.tax)}</b></div>
          <div className="pi-tot"><span>الربح المتوقع</span><b>{money(totals.pub - totals.cost)}</b></div>
          <div className="net pi-net"><small>صافي الفاتورة</small><strong>{money(totals.cost)}</strong></div>
        </div>
        {err && <p className="err">{err}</p>}{warn.length > 0 && <div className="card warnbox">{warn.map((w, i) => <div key={i}>{w}</div>)}</div>}
      </div>

      <nav className="pi-side" aria-label="أوامر الفاتورة">
        {visible.map(a => <button key={a.id} className={`pi-act${a.id === 'save' ? ' main' : ''}`} disabled={busy && (a.id === 'save' || a.id === 'hold')} onClick={a.run}><Icon n={a.icon} /><span>{a.label}</span>{a.key && <kbd>{a.key}</kbd>}</button>)}
      </nav>

      {menu && <div className="ctx" style={{ top: Math.min(menu.y, window.innerHeight - 340), left: Math.min(menu.x, window.innerWidth - 230) }} role="menu">
        {visible.map(a => <button key={a.id} role="menuitem" onClick={() => { setMenu(null); a.run(); }}><Icon n={a.icon} />{a.label}{a.key && <kbd>{a.key}</kbd>}</button>)}</div>}

      {restore && <Restore close={() => setRestore(false)} load={loadSaved} view={v => { setRestore(false); setView(v); }} />}
      {view && <ViewPosted v={view} sup={sups.find(s => s.id === view.supplierId)?.name ?? ''} close={() => setView(null)} print={() => printPosted(view)}
        voidIt={can('purchase_invoice.void') && view.status === 'posted' ? () => void ask('سبب إلغاء فاتورة الشراء').then(r => { if (r) void api(`/api/buy/invoices/${view.piNo}/void`, { body: { reason: r } }).then(() => { toast('اتلغت'); setView(null); }, e => toast(invErr(e))); }) : undefined}
        ret={can('purchase_return.create') ? () => { setView(null); go('pret'); } : undefined} />}

      {printing && <div className="print-area" dir="rtl">
        <h1>{printing.title}</h1><p>المورد: {sup?.name ?? '-'}{printing.ref ? ` - فاتورة رقم ${printing.ref}` : ''} - {printing.when}</p>
        <table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>بونص</th><th>الصلاحية</th><th>سعر البيع</th><th>خصم %</th><th>سعر الشراء</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
          <tbody>{printing.rows.map((r, i) => <tr key={i}><td>{i + 1}</td><td>{r.name}</td><td>{r.unit}</td><td>{r.qty}</td><td>{r.bonus || ''}</td><td>{r.expiry}</td><td>{r.price == null ? '' : money(r.price)}</td><td>{r.disc}</td><td>{money(r.cost)}</td><td>{money(r.tax)}</td><td>{money(r.total)}</td></tr>)}</tbody></table>
        <p><b>الضريبة: {money(printing.tax)} - إجمالي الجمهور: {money(printing.pub)} - الصافي: {money(printing.total)}</b></p></div>}
    </div>
  );
}

/** Item search for the grid: picks by name, code or barcode (Enter takes the only match). */
function PickItem({ onPick }: { onPick: (it: InvItem) => void }) {
  const [q, setQ] = useState(''); const [list, setList] = useState<InvItem[]>([]); const [hi, setHi] = useState(0);
  useEffect(() => { if (q.trim().length < 2) { setList([]); return; } const t = window.setTimeout(() => { api<{ items: InvItem[] }>(`/api/inv/search?q=${encodeURIComponent(q)}`).then(r => { setList(r.items); setHi(0); }, () => setList([])); }, 160); return () => window.clearTimeout(t); }, [q]);
  const take = (it: InvItem) => { onPick(it); setQ(''); setList([]); };
  return (<div className="searchbox" style={{ margin: 0 }}><input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="إضافة صنف: الاسم أو الكود أو الباركود (F2)"
    onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); } else if (e.key === 'Enter' && list[hi]) take(list[hi]!); else if (e.key === 'Escape') setList([]); }} />
    {list.length > 0 && <div className="dd">{list.map((it, i) => <button key={it.id} className={i === hi ? 'on' : ''} onClick={() => take(it)}><span>{it.nameAr}</span><span className="meta">{it.code}</span></button>)}</div>}</div>);
}

/** Restore: a held invoice, a posted invoice (to see, print, void or return) or a purchase order (its remaining quantities). */
function Restore({ close, load, view }: { close: () => void; load: (o: { lines: Saved[]; supplierId: string | null; supplierRef: string | null; draft?: { id: string; no: string }; po?: { id: string; no: string } }) => void; view: (v: Posted) => void }) {
  const { toast, ask, can } = useApp(); const [tab, setTab] = useState<'held' | 'posted' | 'po'>('held');
  const [held, setHeld] = useState<{ id: string; draftNo: string; supplier: string | null; supplierRef: string | null; lines: number; updatedAt: string }[]>([]);
  const [posted, setPosted] = useState<{ piNo: string; supplier: string; supplierRef: string | null; status: string; totalMinor: number; createdAt: string }[]>([]);
  const [pos, setPos] = useState<{ id: string; poNo: string; status: string; supplier: string; createdAt: string }[]>([]);
  const reload = useCallback(() => {
    api<{ drafts: typeof held }>('/api/buy/drafts').then(r => setHeld(r.drafts), () => setHeld([]));
    api<{ invoices: typeof posted }>('/api/buy/invoices').then(r => setPosted(r.invoices.slice(0, 60)), () => setPosted([]));
    if (can('purchase_order.create')) api<{ orders: typeof pos }>('/api/buy/orders').then(r => setPos(r.orders.filter(o => o.status === 'sent' || o.status === 'partly_received')), () => setPos([]));
  }, [can]);
  useEffect(() => { reload(); }, [reload]);
  const openHeld = async (id: string) => { try { const d = await api<{ id: string; draftNo: string; supplierId: string | null; supplierRef: string | null; poId: string | null; lines: Saved[] }>(`/api/buy/drafts/${id}`); load({ lines: d.lines, supplierId: d.supplierId, supplierRef: d.supplierRef, draft: { id: d.id, no: d.draftNo } }); } catch (e) { toast(arabic(e)); } };
  const openPo = async (id: string, no: string) => {
    try { const o = await api<{ supplierId: string; lines: { itemId: string; remainingBase: number }[] }>(`/api/buy/orders/${id}`); const rest = o.lines.filter(l => l.remainingBase > 0);
      if (!rest.length) return toast('أمر الشراء ده وصل كله');
      const hs = await Promise.all(rest.map(l => api<Hint>(`/api/buy/item-hint/${l.itemId}`)));
      const lines: Saved[] = rest.map((l, k) => {
        const h = hs[k]!; const big = [...h.units].sort((x, y) => y.factor - x.factor).find(u => l.remainingBase % u.factor === 0) ?? h.units[0]!;
        const p = priceFor(h, big.name); const bp = h.last?.discountBp ?? 0; const { item: _drop, ...b } = newLine(h); void _drop;
        return { ...b, itemId: h.id, unit: big.name, qty: String(l.remainingBase / big.factor), price: p == null ? '' : egp(p), cost: p == null ? b.cost : egp(Math.round((p * (10000 - bp)) / 10000)) };
      });
      load({ lines, supplierId: o.supplierId, supplierRef: null, po: { id, no } });
    } catch (e) { toast(arabic(e)); }
  };
  const cancelHeld = (id: string) => void ask('سبب إلغاء الفاتورة المعلّقة').then(r => { if (r) void api(`/api/buy/drafts/${id}/cancel`, { body: { reason: r } }).then(() => { toast('اتلغت'); reload(); }, e => toast(arabic(e))); });
  return (<>
    <div className="drawer-bg" onClick={close} />
    <div className="card pi-modal" role="dialog" aria-label="استرجاع">
      <div className="pi-modal-head"><b>استرجاع</b><button className="qbtn" onClick={close} aria-label="إغلاق"><Icon n="x" /></button></div>
      <div className="tabs-inline" role="tablist">
        <button className={`btn${tab === 'held' ? ' primary' : ' ghost'}`} onClick={() => setTab('held')}>فواتير معلّقة ({held.length})</button>
        <button className={`btn${tab === 'posted' ? ' primary' : ' ghost'}`} onClick={() => setTab('posted')}>فواتير شراء</button>
        {can('purchase_order.create') && <button className={`btn${tab === 'po' ? ' primary' : ' ghost'}`} onClick={() => setTab('po')}>طلبات الشراء ({pos.length})</button>}
      </div>
      <div className="tablewrap" style={{ maxHeight: '55vh', overflow: 'auto' }}>
        {tab === 'held' && <table><thead><tr><th>رقم</th><th>المورد</th><th>رقم الفاتورة</th><th className="n">أصناف</th><th>آخر تعديل</th><th></th></tr></thead><tbody>
          {held.map(d => <tr key={d.id}><td className="code">{d.draftNo}</td><td>{d.supplier ?? '-'}</td><td>{d.supplierRef ?? '-'}</td><td className="n">{d.lines}</td><td>{dmyHm(d.updatedAt)}</td><td><div className="actions"><button className="btn" onClick={() => void openHeld(d.id)}>افتح</button><button className="btn ghost" onClick={() => cancelHeld(d.id)}>إلغاء</button></div></td></tr>)}
          {!held.length && <tr><td colSpan={6} className="muted">مفيش فواتير معلّقة</td></tr>}</tbody></table>}
        {tab === 'posted' && <table><thead><tr><th>رقم</th><th>المورد</th><th>رقم الفاتورة</th><th className="n">الإجمالي</th><th>الوقت</th><th></th></tr></thead><tbody>
          {posted.map(x => <tr key={x.piNo}><td className="code">{x.piNo}{x.status === 'void' && <span className="pill bad">ملغاة</span>}</td><td>{x.supplier}</td><td>{x.supplierRef ?? '-'}</td><td className="n">{money(x.totalMinor)}</td><td>{dmyHm(x.createdAt)}</td><td><button className="btn" onClick={() => void api<Posted>(`/api/buy/invoices/${x.piNo}`).then(view, e => toast(arabic(e)))}>اعرض</button></td></tr>)}</tbody></table>}
        {tab === 'po' && <table><thead><tr><th>رقم</th><th>المورد</th><th>الحالة</th><th>الوقت</th><th></th></tr></thead><tbody>
          {pos.map(o => <tr key={o.id}><td className="code">{o.poNo}</td><td>{o.supplier}</td><td>{o.status === 'sent' ? 'اتبعت' : 'وصل جزء'}</td><td>{dmyHm(o.createdAt)}</td><td><button className="btn" onClick={() => void openPo(o.id, o.poNo)}>حمّل الباقي</button></td></tr>)}
          {!pos.length && <tr><td colSpan={5} className="muted">مفيش أوامر شراء مستنية استلام</td></tr>}</tbody></table>}
      </div>
    </div>
  </>);
}

function ViewPosted({ v, sup, close, print, voidIt, ret }: { v: Posted; sup: string; close: () => void; print: () => void; voidIt?: () => void; ret?: () => void }) {
  return (<>
    <div className="drawer-bg" onClick={close} />
    <div className="card pi-modal" role="dialog" aria-label={v.piNo}>
      <div className="pi-modal-head"><b>{v.piNo} - {sup}{v.supplierRef ? ` - ${v.supplierRef}` : ''}</b>{v.status === 'void' && <span className="pill bad">ملغاة: {v.voidReason}</span>}<button className="qbtn" onClick={close} aria-label="إغلاق"><Icon n="x" /></button></div>
      <div className="tablewrap" style={{ maxHeight: '50vh', overflow: 'auto' }}><table><thead><tr><th>الصنف</th><th>الصلاحية</th><th>التشغيلة</th><th className="n">الكمية</th><th className="n">سعر البيع</th><th className="n">خصم %</th><th className="n">سعر الشراء</th><th className="n">الضريبة</th><th className="n">الإجمالي</th></tr></thead>
        <tbody>{v.lines.map((l, i) => <tr key={i}><td>{l.itemName}</td><td>{l.expiry.slice(0, 7)}</td><td className="code">{l.lot}</td><td className="n">{l.paidBase / l.priceFactor} {l.priceUnit}{l.bonusBase ? ` + ${l.bonusBase / l.priceFactor}` : ''}</td><td className="n">{l.publicPriceMinor == null ? '-' : money(l.publicPriceMinor)}</td><td className="n">{l.discountBp / 100}</td><td className="n">{money(l.costMinor)}</td><td className="n">{money(l.taxMinor)}</td><td className="n"><b>{money(l.totalMinor)}</b></td></tr>)}</tbody></table></div>
      <div className="actions"><b>الصافي: {money(v.totalMinor)}{v.taxTotalMinor ? ` (منها ضريبة ${money(v.taxTotalMinor)})` : ''}</b><button className="btn ghost" onClick={print}>طباعة</button>{ret && <button className="btn ghost" onClick={ret}>مرتجع للمورد</button>}{voidIt && <button className="btn ghost" onClick={voidIt}>إلغاء الفاتورة</button>}</div>
    </div>
  </>);
}
