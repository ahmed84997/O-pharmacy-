import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, arabic } from './api';
import { dmyHm, egp, Icon, money, newKey, toMinor, useApp } from './ui';
import { useFrame } from './frames';
import { SaleA4, usePrintWhen, type A4Pharmacy, type A4Sale, type A4Style } from './a4';

/* ================= shared ================= */
export type TillItem = { id: string; code: string; nameAr: string; kind: string; units: { name: string; factor: number }[]; sellableBase: number; priceMinor: number | null; priceUnit: string | null; nearestExpiry: string | null };
export type Line = { item: TillItem; unitName: string; qty: number };
type Quote = { itemId: string; amountMinor?: number; missingBase?: number; noPrice?: boolean; error?: string; picks?: { lot: string; expiry: string; qtyBase: number; amountMinor: number }[] };
const POS_ERR: Record<string, string> = { insufficient: 'الكمية أكتر من المتاح للبيع (المنتهي والمحجوز مبيتباعش).', underpaid: 'المدفوع أقل من الإجمالي.', 'no-price': 'فيه صنف من غير سعر.', session: 'افتح جلسة الكاشير الأول.', 'discount-limit': 'الخصم أكبر من المسموح لك.', 'credit-limit': 'العميل عدّى حد الآجل.', 'day-closed': 'اليوم اتقفل: البيع بيبدأ يوم جديد.', blocked: 'الصنف ده موقوف أو التشغيلة محجوزة.' };
export const posErr = (e: unknown) => { const c = (e as { code?: string }).code; return (c && POS_ERR[c]) || arabic(e); };
/** Stock comes in the smallest unit; shown as boxes and pieces. */
export const qtyText = (base: number, units: { name: string; factor: number }[]) => { const big = [...units].sort((a, b) => b.factor - a.factor)[0]; if (!big || big.factor === 1) return `${base} ${units[0]?.name ?? ''}`; const b = Math.floor(base / big.factor), r = base % big.factor; return `${b} ${big.name}${r ? ` و${r} ${units.find(u => u.factor === 1)?.name ?? ''}` : ''}`; };

/** Scan or type: Enter tries the exact barcode or code first, otherwise the matches show below. */
export function ItemPicker({ onPick, autoFocus }: { onPick: (it: TillItem, unitName?: string) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState(''); const [list, setList] = useState<TillItem[]>([]); const [msg, setMsg] = useState(''); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const f = () => { if (ref.current?.offsetParent) ref.current.focus(); }; window.addEventListener('op-focus-search', f); return () => window.removeEventListener('op-focus-search', f); }, []);
  useEffect(() => { if (q.trim().length < 2) { setList([]); return; } const t = window.setTimeout(() => { api<{ items: TillItem[] }>(`/api/pos/search?q=${encodeURIComponent(q)}`).then(r => setList(r.items), () => setList([])); }, 180); return () => window.clearTimeout(t); }, [q]);
  const pick = (it: TillItem, unit?: string) => { onPick(it, unit); setQ(''); setList([]); setMsg(''); ref.current?.focus(); };
  const enter = async () => { const code = q.trim(); if (!code) return; try { const r = await api<{ item: TillItem | null; unitName: string | null }>(`/api/pos/lookup?code=${encodeURIComponent(code)}`); if (r.item) return pick(r.item, r.unitName ?? undefined); if (list.length === 1) return pick(list[0]!); setMsg(list.length ? 'اختار من القائمة' : 'مفيش صنف بالكود أو الاسم ده'); } catch (e) { setMsg(arabic(e)); } };
  return (<div className="searchbox">
    <input ref={ref} className="search big" value={q} autoFocus={autoFocus} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void enter(); } if (e.key === 'ArrowDown') (document.querySelector('.dd button') as HTMLButtonElement | null)?.focus(); }} placeholder="امسح الباركود أو اكتب اسم الصنف (F2)" aria-label="بحث الصنف" />
    {msg && <div className="hint">{msg}</div>}
    {list.length > 0 && <div className="dd" role="listbox">{list.map(it => <button key={it.id} onClick={() => pick(it)}><span>{it.nameAr}</span><span className="meta">{it.priceMinor == null ? 'بدون سعر' : `${money(it.priceMinor)} / ${it.priceUnit}`} - {it.sellableBase > 0 ? qtyText(it.sellableBase, it.units) : 'مفيش رصيد'}</span></button>)}</div>}
  </div>);
}
/** Lines with unit and quantity; prices come from the server's FEFO preview so the screen never invents a price. */
export function LinesTable({ lines, setLines, quotes, sel, onSel }: { lines: Line[]; setLines: (l: Line[]) => void; quotes: Quote[]; sel?: number | null; onSel?: (i: number) => void }) {
  const upd = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return (<div className="tablewrap"><table className="lines"><thead><tr><th>الصنف</th><th>الوحدة</th><th className="n">الكمية</th><th className="n">القيمة</th><th></th></tr></thead><tbody>
    {lines.map((l, i) => { const q = quotes[i]; const short = q?.missingBase ? `ناقص ${qtyText(q.missingBase, l.item.units)}` : q?.error ? 'مش متاح' : q?.noPrice ? 'بدون سعر' : '';
      return (<tr key={i} className={sel === i ? 'sel' : ''} onClick={() => onSel?.(i)} onContextMenu={() => onSel?.(i)}><td className="nm" data-l="الصنف">{l.item.nameAr}{q?.picks && q.picks.length > 1 && <small className="muted"><br />من {q.picks.length} تشغيلات (الأقرب انتهاءً الأول)</small>}{short && <><br /><span className="err">{short}</span></>}</td>
        <td data-l="الوحدة">{l.item.units.length > 1 ? <select value={l.unitName} onChange={e => upd(i, { unitName: e.target.value })}>{l.item.units.map(u => <option key={u.name} value={u.name}>{u.name}</option>)}</select> : l.unitName}</td>
        <td className="n" data-l="الكمية"><input className="num" inputMode="numeric" value={l.qty} onChange={e => { const n = Number(e.target.value.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))); if (Number.isInteger(n) && n >= 0 && n < 100000) upd(i, { qty: n }); }} aria-label="الكمية" /></td>
        <td className="n" data-l="القيمة">{q?.amountMinor != null ? money(q.amountMinor) : '-'}</td>
        <td className="bt"><button className="btn ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="حذف السطر"><Icon n="x" /></button></td></tr>); })}
    {!lines.length && <tr><td colSpan={5} className="muted">الفاتورة فاضية: امسح أو دوّر على صنف.</td></tr>}
  </tbody></table></div>);
}
export function useQuotes(lines: Line[]) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const sig = JSON.stringify(lines.map(l => [l.item.id, l.unitName, l.qty]));
  useEffect(() => { const ls = lines.filter(l => l.qty > 0); if (!ls.length) { setQuotes([]); return; } const t = window.setTimeout(() => { api<{ lines: Quote[] }>('/api/pos/quote', { body: { lines: lines.map(l => ({ itemId: l.item.id, qty: Math.max(1, l.qty), unitName: l.unitName })) } }).then(r => setQuotes(r.lines), () => setQuotes([])); }, 150); return () => window.clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return quotes;
}
export const addLine = (lines: Line[], it: TillItem, unitName?: string): Line[] => { const unit = unitName ?? [...it.units].sort((a, b) => b.factor - a.factor)[0]?.name ?? ''; const i = lines.findIndex(l => l.item.id === it.id && l.unitName === unit); return i >= 0 ? lines.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { item: it, unitName: unit, qty: 1 }]; };
type Session = { id: string; sessionNo: string; terminal: string } | null;
export function useSession() { const [s, setS] = useState<{ session: Session; terminal: string; today: string } | null>(null); const load = useCallback(() => api<{ session: Session; terminal: string; today: string }>('/api/pos/session').then(setS), []); useEffect(() => { void load(); }, [load]); return { info: s, reload: load }; }
type Printer = { name: string; kind: string; paperWidthMm?: number; type: string };
export type PrintStyle = { askBeforePrint?: boolean; minPrintMinor?: number; copies?: number; paper?: 'receipt' | 'a4' };
export function usePrintSetup() { const [v, setV] = useState<{ printers: Printer[]; style: PrintStyle }>({ printers: [], style: {} }); useEffect(() => { api<{ printers: Printer[]; style: PrintStyle }>('/api/print/printers').then(r => setV({ printers: r.printers.filter(x => x.kind === 'receipt'), style: r.style ?? {} }), () => undefined); }, []); return v; }
export function usePrinters() { return usePrintSetup().printers; }

/** The receipt as it prints, plus print and reprint (a reprint needs a reason). */
/* Sprint 7.12: the receipt settings decide the automatic print: below the minimum value nothing prints by itself, and "ask before each print" asks here first. */
export function ReceiptBox({ saleNo, autoPrint, totalMinor }: { saleNo: string; autoPrint?: boolean; totalMinor?: number }) {
  const { toast, ask } = useApp(); const { printers: recPrinters, style } = usePrintSetup(); const [askNow, setAskNow] = useState(false); const [a4, setA4] = useState<{ sale: A4Sale; pharmacy: A4Pharmacy; style: A4Style; seller: string; customer: string | null; copyNo: number } | null>(null);
  /* نوع الطباعة A4: one target, the Windows print dialog */ const printers = style.paper === 'a4' ? [{ name: 'A4', kind: 'receipt', type: 'a4' }] : recPrinters;
  usePrintWhen(!!a4, () => setA4(null), 200); const [src, setSrc] = useState(''); const [printed, setPrinted] = useState(0); const done = useRef('');
  useEffect(() => { let url = ''; const h: Record<string, string> = {}; try { const d = localStorage.getItem('o.device'); const t = sessionStorage.getItem('o.token'); if (d) h['x-device'] = d; if (t) h.authorization = `Bearer ${t}`; } catch { /* storage blocked */ }
    fetch(`/api/print/preview/${encodeURIComponent(saleNo)}`, { headers: h }).then(r => (r.ok ? r.blob() : null)).then(b => { if (b) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => undefined); return () => { if (url) URL.revokeObjectURL(url); }; }, [saleNo]);
  const print = useCallback(async (printer: string, reason?: string) => { if (printer === 'A4') { try { const r = await api<{ copyNo: number; sale: A4Sale; pharmacy: A4Pharmacy; style: A4Style; seller: string; customer: string | null }>('/api/print/receipt-a4', { body: { saleNo, reason } }); setPrinted(n => n + 1); setA4(r); } catch (e) { toast(arabic(e)); } return; } try { const r = await api<{ ok: boolean; error?: string; copyNo?: number; drawer?: boolean }>('/api/print/receipt', { body: { saleNo, printer, reason } }); if (r.ok) { setPrinted(n => n + 1); toast(r.copyNo && r.copyNo > 1 ? `اتطبعت نسخة رقم ${r.copyNo}` : `اتطبع الوصل${r.drawer ? ' واتفتح الدرج' : ''}`); } else toast(`الطباعة فشلت: ${r.error ?? ''}`); } catch (e) { toast(arabic(e)); } }, [saleNo, toast]);
  useEffect(() => { if (autoPrint && printers[0] && done.current !== saleNo) { done.current = saleNo; if (totalMinor !== undefined && style.minPrintMinor && totalMinor < style.minPrintMinor) return; if (style.askBeforePrint) setAskNow(true); else void print(printers[0].name); } }, [autoPrint, printers, saleNo, print, style, totalMinor]);
  return (<div className="card" style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
    {src ? <img src={src} alt={`وصل ${saleNo}`} style={{ width: 'min(300px, 100%)', background: '#fff', border: '1px solid var(--line)' }} /> : <span className="muted">بيجهّز الوصل...</span>}
    {askNow && printers[0] && printed === 0 && <div className="actions"><b>تطبع الفاتورة؟</b><button className="btn primary" autoFocus onClick={() => { setAskNow(false); void print(printers[0]!.name); }}><Icon n="print" />اطبع</button><button className="btn ghost" onClick={() => setAskNow(false)}>لا</button></div>}
    <div className="actions">{printers.length === 0 && <span className="hint">مفيش طابعة متعرّفة: الإعدادات ← الطابعات.</span>}
      {printers.map(p => <button key={p.name} className="btn" onClick={() => { if (printed === 0) void print(p.name); else void ask('سبب طباعة نسخة تانية').then(r => { if (r) void print(p.name, r); }); }}><Icon n="print" />{printed === 0 ? `اطبع (${p.name})` : `نسخة تانية (${p.name})`}</button>)}</div>
    {a4 && <div className="print-area a4-print"><SaleA4 sale={a4.sale} pharmacy={a4.pharmacy} style={a4.style} seller={a4.seller} customer={a4.customer} copyNo={a4.copyNo} /></div>}
  </div>);
}

/* ================= session ================= */
export function SessionScreen() {
  const { toast, ask } = useApp(); const { info, reload } = useSession(); const [float, setFloat] = useState(''); const [count, setCount] = useState(''); const [report, setReport] = useState<Report | null>(null); const [err, setErr] = useState('');
  const open = async () => { const m = toMinor(float || '0'); if (m === null) return setErr('اكتب المبلغ اللي في الدرج صح'); setErr(''); try { await api('/api/pos/session/open', { body: { key: newKey(), openingFloatMinor: m } }); toast('الجلسة اتفتحت'); setFloat(''); await reload(); } catch (e) { setErr(posErr(e)); } };
  const close = async () => { if (!info?.session) return; const m = toMinor(count); if (m === null) return setErr('اكتب الفلوس اللي عدّيتها'); const note = (await ask('ملاحظة على التقفيل (اكتب - لو مفيش)')) ?? null; if (note === null) return; setErr('');
    try { const id = info.session.id; await api(`/api/pos/session/${id}/close`, { body: { countedCashMinor: m, note: note === '-' ? undefined : note } }); toast('الجلسة اتقفلت. المراجعة عند المدير.'); setCount(''); await reload(); const r = await api<{ report: Report }>(`/api/pos/sessions/${id}/report`); setReport(r.report); } catch (e) { setErr(posErr(e)); } };
  if (!info) return <p>بيحمّل...</p>;
  return (<div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
    <h2><Icon n="wallet" />جلسة الكاشير - {info.terminal}</h2>{err && <p className="err">{err}</p>}
    {!info.session ? <div className="card formgrid"><label>الفلوس اللي في الدرج دلوقتي (جنيه)<input className="num" inputMode="decimal" value={float} onChange={e => setFloat(e.target.value)} placeholder="0" /></label><button className="btn primary" onClick={() => void open()}>افتح الجلسة</button></div>
      : <div className="card" style={{ display: 'grid', gap: 10 }}><div>الجلسة <b className="code">{info.session.sessionNo}</b> مفتوحة على {info.session.terminal}.</div>
        <p className="hint">التقفيل أعمى: عدّ الفلوس اللي في الدرج واكتبها. المتوقع والفرق بيشوفهم المدير بس.</p>
        <div className="formgrid"><label>الفلوس اللي عدّيتها (جنيه)<input className="num" inputMode="decimal" value={count} onChange={e => setCount(e.target.value)} /></label><button className="btn primary" onClick={() => void close()}>اقفل الجلسة</button></div></div>}
    {report && <ReportView r={report} />}
  </div>);
}
type Report = { sessionNo: string; terminal: string; status: string; openedAt: string; closedAt: string | null; sales: { count: number; totalMinor: number; cashMinor: number; cardMinor: number; discountMinor: number; onAccountMinor: number; codOwedMinor: number }; voids: { count: number; totalMinor: number }; returns: { count: number; totalMinor: number; cashMinor: number }; customerPayments: { cashMinor: number; cardMinor: number }; drawer?: { openingFloatMinor: number; expectedCashMinor: number; countedCashMinor: number | null; diffMinor: number | null; closeNote: string | null; review: { decision: string; note: string | null; at: string } | null } };
export function ReportView({ r }: { r: Report }) {
  const row = (l: string, v: string | number) => <tr><td>{l}</td><td className="n">{v}</td></tr>;
  return (<div className="card"><b>تقرير الجلسة {r.sessionNo} - {r.terminal}</b><div className="muted">من {dmyHm(r.openedAt)} لـ {dmyHm(r.closedAt)}</div>
    <table><tbody>{row('عدد الفواتير', r.sales.count)}{row('إجمالي المبيعات', money(r.sales.totalMinor))}{row('كاش', money(r.sales.cashMinor))}{row('فيزا', money(r.sales.cardMinor))}{row('خصومات', money(r.sales.discountMinor))}{row('آجل على العملاء', money(r.sales.onAccountMinor))}{row('توصيل لسه متحصّلش', money(r.sales.codOwedMinor))}{row('ملغي', `${r.voids.count} - ${money(r.voids.totalMinor)}`)}{row('مرتجع', `${r.returns.count} - ${money(r.returns.totalMinor)} (كاش ${money(r.returns.cashMinor)})`)}{row('تحصيل من عملاء', money(r.customerPayments.cashMinor + r.customerPayments.cardMinor))}
      {r.drawer && <>{row('رصيد أول الجلسة', money(r.drawer.openingFloatMinor))}{row('المتوقع في الدرج', money(r.drawer.expectedCashMinor))}{row('اللي اتعد', money(r.drawer.countedCashMinor))}<tr><td>الفرق</td><td className="n"><b className={r.drawer.diffMinor ? 'err' : ''}>{money(r.drawer.diffMinor)}</b></td></tr>{r.drawer.closeNote && row('ملاحظة الكاشير', r.drawer.closeNote)}{r.drawer.review && row('المراجعة', `${r.drawer.review.decision === 'accepted' ? 'مقبول' : 'متصعّد'}${r.drawer.review.note ? ` - ${r.drawer.review.note}` : ''}`)}</>}
    </tbody></table></div>);
}

/* ================= sale ================= */
/* Sprint 7.10 (owner's list, 12 Nov 2026): a side bar and a right-click menu with save, hold for delivery, home-delivery orders,
   add item, delete line, incomplete invoices (kept on this device while typing), close and the dose sticker; the customer by code. */
type Cust = { id: string; code: string; name: string; phone: string | null; address: string | null; balanceMinor: number };
type Deliv = { name: string; phone: string; address: string; fee: string };
type Draft = { id: string; at: string; lines: Line[]; customer: Cust | null; deliv: Deliv | null };
const DRAFTS = 'o.sale.drafts';
const readDrafts = (): Draft[] => { try { return JSON.parse(localStorage.getItem(DRAFTS) ?? '[]') as Draft[]; } catch { return []; } };
const writeDrafts = (d: Draft[]) => { try { localStorage.setItem(DRAFTS, JSON.stringify(d.slice(0, 10))); } catch { /* storage blocked: nothing kept */ } };
const dropDraft = (id: string) => writeDrafts(readDrafts().filter(d => d.id !== id));

/** Customer by code, name or phone; a new customer needs a name, a mobile and an address. */
function CustomerPick({ value, onPick }: { value: Cust | null; onPick: (c: Cust | null) => void }) {
  const { can, toast } = useApp(); const [q, setQ] = useState(''); const [list, setList] = useState<Cust[]>([]); const [add, setAdd] = useState<{ name: string; phone: string; address: string } | null>(null);
  useEffect(() => { if (!q.trim()) { setList([]); return; } const t = window.setTimeout(() => { api<{ customers: Cust[] }>(`/api/customers?q=${encodeURIComponent(q)}`).then(r => setList(r.customers.slice(0, 8)), () => setList([])); }, 160); return () => window.clearTimeout(t); }, [q]);
  const save = async () => { if (!add) return; if (!add.name.trim() || !add.phone.trim() || !add.address.trim()) return toast('اكتب الاسم والموبايل والعنوان'); try { const c = await api<Cust>('/api/customers', { body: add }); toast(`اتسجل العميل - كوده ${c.code}`); onPick(c); setAdd(null); } catch (e) { toast(arabic(e)); } };
  if (value) return (<div className="cust-chip"><Icon n="users" /><b>{value.name}</b><span className="code">كود {value.code}</span>{value.phone && <span className="code">{value.phone}</span>}{value.balanceMinor > 0 && <span className="pill warn">عليه {money(value.balanceMinor)}</span>}<button className="btn ghost" onClick={() => onPick(null)}>غيّر</button></div>);
  if (add) return (<div className="card formgrid"><label>اسم العميل<input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} autoFocus /></label><label>الموبايل<input dir="ltr" value={add.phone} onChange={e => setAdd({ ...add, phone: e.target.value })} /></label><label style={{ gridColumn: 'span 2' }}>العنوان<input value={add.address} onChange={e => setAdd({ ...add, address: e.target.value })} /></label><div className="actions"><button className="btn primary" onClick={() => void save()}>حفظ العميل</button><button className="btn ghost" onClick={() => setAdd(null)}>إلغاء</button></div></div>);
  return (<div className="searchbox cust-search"><input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="العميل: الكود أو الاسم أو الموبايل (اختياري)" onKeyDown={e => { if (e.key === 'Enter' && list[0]) { onPick(list[0]); setQ(''); } }} aria-label="العميل" />
    {can('customer.create') && <button className="btn ghost" onClick={() => setAdd({ name: q && !/^\d+$/.test(q) ? q : '', phone: /^0\d{6,}$/.test(q) ? q : '', address: '' })}><Icon n="plus" />عميل جديد</button>}
    {list.length > 0 && <div className="dd">{list.map(c => <button key={c.id} onClick={() => { onPick(c); setQ(''); setList([]); }}><span><b className="code">{c.code}</b> - {c.name}</span><span className="meta">{c.phone ?? ''}{c.address ? ` - ${c.address}` : ''}</span></button>)}</div>}</div>);
}

export function SaleScreen() {
  const frame = useFrame(); const { can, toast, go } = useApp(); const { info } = useSession(); const [lines, setLines] = useState<Line[]>(() => { try { const h = sessionStorage.getItem('o.resume'); if (h) { sessionStorage.removeItem('o.resume'); return JSON.parse(h).lines as Line[]; } } catch { /* none */ } return []; });
  const [fromHold] = useState<string | undefined>(() => { try { const h = sessionStorage.getItem('o.resumeId'); if (h) { sessionStorage.removeItem('o.resumeId'); return h; } } catch { /* none */ } return undefined; });
  const [cash, setCash] = useState(''); const [card, setCard] = useState(''); const [cardRef, setCardRef] = useState(''); const [disc, setDisc] = useState(''); const [deliv, setDeliv] = useState<Deliv | null>(null);
  const [customer, setCustomer] = useState<Cust | null>(null); const [sel, setSel] = useState<number | null>(null); const [draftId, setDraftId] = useState(() => newKey());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null); const [modal, setModal] = useState<null | 'home' | 'drafts' | 'dose'>(null); const [closeArmed, setCloseArmed] = useState(false);
  const [done, setDone] = useState<{ saleNo: string; totalMinor: number; changeMinor: number; codMinor: number; note?: string } | null>(null);
  const [ins, setIns] = useState<{ contractId: string; memberNo: string } | null>(null); const [contracts, setContracts] = useState<{ id: string; name: string; customerId: string | null; status: string }[]>([]); const [insQ, setInsQ] = useState<{ totalMinor: number; coveredMinor: number; copayMinor: number; needsApproval: boolean } | null>(null);
  useEffect(() => { if (ins && !contracts.length) api<{ contracts: typeof contracts }>('/api/contracts?status=active').then(r => setContracts(r.contracts.filter(c => c.customerId)), () => undefined); }, [ins, contracts.length]);
  const insSig = JSON.stringify([ins?.contractId, lines.map(l => [l.item.id, l.unitName, l.qty])]);
  useEffect(() => { if (!ins?.contractId || !lines.length) { setInsQ(null); return; } const t = window.setTimeout(() => { api<NonNullable<typeof insQ>>('/api/pos/insurance-quote', { body: { contractId: ins.contractId, lines: lines.map(l => ({ itemId: l.item.id, qty: l.qty, unitName: l.unitName })) } }).then(setInsQ, () => setInsQ(null)); }, 250); return () => window.clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insSig]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const keyRef = useRef(newKey());
  const quotes = useQuotes(lines); const total = useMemo(() => quotes.reduce((s, q) => s + (q.amountMinor ?? 0), 0), [quotes]);
  const discBp = disc ? Math.round(Number(disc.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))) * 100) : 0; const approxNet = total - Math.round(total * discBp / 10000) + (deliv ? toMinor(deliv.fee || '0') ?? 0 : 0);
  const blocked = quotes.some(q => q.error || q.missingBase || q.noPrice) || lines.some(l => l.qty <= 0);
  /* incomplete invoices: what is on the screen is kept on this device while typing, so a crash or a closed window loses nothing */
  useEffect(() => { const t = window.setTimeout(() => { const rest = readDrafts().filter(d => d.id !== draftId); if (lines.length) writeDrafts([{ id: draftId, at: new Date().toISOString(), lines, customer, deliv }, ...rest]); else writeDrafts(rest); }, 400); return () => window.clearTimeout(t); }, [lines, customer, deliv, draftId]);
  const reset = () => { dropDraft(draftId); setDraftId(newKey()); setLines([]); setCash(''); setCard(''); setCardRef(''); setDisc(''); setDeliv(null); setCustomer(null); setSel(null); keyRef.current = newKey(); };
  const pickCustomer = (c: Cust | null) => { setCustomer(c); if (c && deliv) setDeliv({ ...deliv, name: deliv.name || c.name, phone: deliv.phone || (c.phone ?? ''), address: deliv.address || (c.address ?? '') }); };
  const toggleDeliv = (on: boolean) => setDeliv(on ? { name: customer?.name ?? '', phone: customer?.phone ?? '', address: customer?.address ?? '', fee: '' } : null);

  async function sell(o: { delivery?: Deliv } = {}) {
    if (!info?.session || busy || !lines.length) return; if (blocked) return setErr('فيه سطر محتاج تعديل (كمية أو رصيد أو سعر).'); setErr('');
    const dl = o.delivery ?? deliv;
    const cashM = cash ? toMinor(cash) : null; const cardM = card ? toMinor(card) : null; if ((cash && cashM === null) || (card && cardM === null)) return setErr('اكتب المبلغ صح'); if (cardM && !cardRef.trim()) return setErr('اكتب رقم عملية الفيزا');
    const pays = o.delivery ? [] : [...(cardM ? [{ method: 'card', amountMinor: cardM, ref: cardRef.trim() }] : []), ...(cashM ? [{ method: 'cash', amountMinor: cashM }] : [])]; const paidNothing = !pays.length;
    if (ins && !o.delivery) { if (!ins.contractId || !ins.memberNo.trim()) return setErr('اختار جهة التأمين واكتب رقم العضو'); setBusy(true); try { const r = await api<{ sale: { saleNo: string; totalMinor: number; changeMinor: number; codMinor: number }; claim: { claimNo: string; status: string }; coveredMinor: number; copayMinor: number }>('/api/pos/insurance-sale', { body: { key: keyRef.current, sessionId: info.session.id, contractId: ins.contractId, memberNo: ins.memberNo.trim(), lines: lines.map(l => ({ itemId: l.item.id, qty: l.qty, unitName: l.unitName })), cashMinor: cashM ?? undefined } }); setDone({ ...r.sale, note: `مطالبة ${r.claim.claimNo}${r.claim.status === 'pending_approval' ? ' (محتاجة موافقة)' : ''}: على الجهة ${money(r.coveredMinor)} - العضو دفع ${money(r.copayMinor)}` }); reset(); setIns(null); } catch (e) { setErr(posErr(e)); } finally { setBusy(false); } return; }
    if (dl && (!dl.name.trim() || !dl.phone.trim() || !dl.address.trim())) return setErr('التوصيل محتاج اسم العميل والموبايل والعنوان');
    setBusy(true); try { const r = await api<{ saleNo: string; totalMinor: number; changeMinor: number; codMinor: number }>('/api/pos/sales', { body: { key: keyRef.current, sessionId: info.session.id, lines: lines.map(l => ({ itemId: l.item.id, qty: l.qty, unitName: l.unitName })), ...(paidNothing && !dl ? { cashMinor: approxNet } : { payments: pays }), discountBp: discBp || undefined, fromHold, customerId: customer?.id, delivery: dl ? { name: dl.name, phone: dl.phone, address: dl.address, feeMinor: toMinor(dl.fee || '0') ?? 0 } : undefined } });
      setDone({ ...r, note: o.delivery ? 'الأوردر اتعلّق للتوصيل: هتلاقيه في "الفواتير المنزلي" لحد ما الدليفري يرجع بالفلوس' : undefined }); reset(); } catch (e) { setErr(posErr(e)); } finally { setBusy(false); } }
  /* hold for delivery: the order leaves with the driver now (stock out) and is saved for good when the money comes back (الفواتير المنزلي) */
  const holdDelivery = () => { if (!lines.length) return toast('الفاتورة فاضية'); if (!can('home_delivery.create')) return toast('التوصيل مش ضمن صلاحياتك'); const d = deliv ?? { name: customer?.name ?? '', phone: customer?.phone ?? '', address: customer?.address ?? '', fee: '' }; if (!deliv) setDeliv(d); if (!d.name.trim() || !d.phone.trim() || !d.address.trim()) return setErr('اختار العميل أو اكتب اسمه وموبايله وعنوانه في التوصيل'); void sell({ delivery: d }); };
  const hold = async () => { if (!info?.session || !lines.length) return; try { const r = await api<{ holdNo: string }>('/api/pos/holds', { body: { key: newKey(), sessionId: info.session.id, lines: lines.map(l => ({ itemId: l.item.id, qty: l.qty, unitName: l.unitName })) } }); toast(`الفاتورة اتعلّقت (${r.holdNo})`); reset(); } catch (e) { setErr(posErr(e)); } };
  const delLine = () => { if (sel === null || !lines[sel]) return toast('اختار السطر الأول'); setLines(lines.filter((_, k) => k !== sel)); setSel(null); };
  const closeInvoice = () => { if (!lines.length) { reset(); return; } if (!closeArmed) { setCloseArmed(true); toast('اضغط "إغلاق" تاني عشان تقفل الفاتورة من غير حفظ'); window.setTimeout(() => setCloseArmed(false), 3500); return; } setCloseArmed(false); reset(); toast('اتقفلت الفاتورة'); };
  const actions: { id: string; label: string; icon: string; key?: string; run: () => void; show?: boolean }[] = [
    { id: 'save', label: 'حفظ', icon: 'save', key: 'F9', run: () => void sell() },
    { id: 'hold-d', label: 'تعليق (دليفري)', icon: 'truck', key: 'F4', run: holdDelivery, show: can('home_delivery.create') },
    { id: 'home', label: 'الفواتير المنزلي', icon: 'store', key: 'F6', run: () => setModal('home'), show: can('home_delivery.create') },
    { id: 'add', label: 'إضافة صنف', icon: 'search', key: 'F2', run: () => window.dispatchEvent(new Event('op-focus-search')) },
    { id: 'del', label: 'حذف سطر', icon: 'trash', key: 'Del', run: delLine },
    { id: 'drafts', label: 'فواتير غير مكتملة', icon: 'history', key: 'F7', run: () => setModal('drafts') },
    { id: 'close', label: 'إغلاق', icon: 'x', key: 'Esc', run: closeInvoice },
    { id: 'dose', label: 'طباعة الاستخدام', icon: 'print', key: 'F8', run: () => (lines.length ? setModal('dose') : toast('ضيف الأصناف الأول')) },
    { id: 'hold', label: 'تعليق مؤقت', icon: 'pause', run: () => void hold(), show: can('sale.hold') },
  ];
  const visible = actions.filter(a => a.show !== false);
  useEffect(() => { if (!frame.active) return; const k = (e: KeyboardEvent) => {
    if (modal) { if (e.key === 'Escape') setModal(null); return; } const inField = (e.target as HTMLElement)?.closest?.('input, select, textarea');
    if (e.key === 'F2') { e.preventDefault(); window.dispatchEvent(new Event('op-focus-search')); } else if (e.key === 'F9') { e.preventDefault(); void sell(); } else if (e.key === 'F4') { e.preventDefault(); holdDelivery(); }
    else if (e.key === 'F6') { e.preventDefault(); setModal('home'); } else if (e.key === 'F7') { e.preventDefault(); setModal('drafts'); } else if (e.key === 'F8') { e.preventDefault(); if (lines.length) setModal('dose'); }
    else if (e.key === 'Delete' && !inField) { e.preventDefault(); delLine(); } else if (e.key === 'Escape') { if (menu) setMenu(null); else if (!inField) closeInvoice(); }
  }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  if (!info) return <p>بيحمّل...</p>;
  if (!info.session) return (<div className="soonbox"><h2><Icon n="cart" />فاتورة بيع</h2><div className="card"><p>لازم تفتح جلسة كاشير على الجهاز ده الأول.</p><button className="btn primary" onClick={() => go('session')}>افتح الجلسة</button></div></div>);
  return (<div className="pi" onContextMenu={e => { if ((e.target as HTMLElement).closest('input, select, textarea')) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }} onClick={() => menu && setMenu(null)}>
    <div className="pi-main">
    <h2 style={{ margin: 0 }}><Icon n="cart" />فاتورة بيع <small className="muted">- {info.session.sessionNo}</small>{fromHold && <span className="pill">من فاتورة معلّقة</span>}</h2>
    {done && <div className="card warnbox" style={{ display: 'grid', gap: 8 }}><b>اتسجلت الفاتورة {done.saleNo} - الإجمالي {money(done.totalMinor)}{done.changeMinor > 0 && <> - الباقي للعميل <span style={{ fontSize: '1.3em' }}>{money(done.changeMinor)}</span></>}{done.codMinor > 0 && <> - يتحصّل عند التوصيل {money(done.codMinor)}</>}</b>{done.note && <span>{done.note}</span>}<ReceiptBox saleNo={done.saleNo} autoPrint totalMinor={done.totalMinor} /><button className="btn ghost" onClick={() => setDone(null)}>فاتورة جديدة</button></div>}
    {!done && <>
      <CustomerPick value={customer} onPick={pickCustomer} />
      <ItemPicker autoFocus onPick={(it, u) => setLines(addLine(lines, it, u))} />
      <LinesTable lines={lines} setLines={setLines} quotes={quotes} sel={sel} onSel={setSel} />
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="totals"><div className="net"><small>الصافي المطلوب</small><strong>{money(approxNet)}</strong></div><div className="mini"><span>الإجمالي قبل الخصم: <b>{money(total)}</b></span><span>عدد الأصناف: <b>{lines.length}</b></span></div></div>
        <div className="formgrid">
          {can('sale.discount') && <label>خصم %<input className="num" inputMode="decimal" value={disc} onChange={e => setDisc(e.target.value)} placeholder="0" /></label>}
          <label>كاش (جنيه)<input className="num" inputMode="decimal" value={cash} onChange={e => setCash(e.target.value)} placeholder={egp(approxNet)} onKeyDown={e => { if (e.key === 'Enter') void sell(); }} /></label>
          <label>فيزا (جنيه)<input className="num" inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} /></label>
          {card && <label>رقم عملية الفيزا<input value={cardRef} onChange={e => setCardRef(e.target.value)} dir="ltr" /></label>}
        </div>
        {cash && toMinor(cash) !== null && (toMinor(cash)! + (toMinor(card || '0') ?? 0)) > approxNet && <div>الباقي تقريبًا: <b>{money(toMinor(cash)! + (toMinor(card || '0') ?? 0) - approxNet)}</b></div>}
        {can('insurance_claim.submit') && can('sale.credit.create') && <label className="chk"><input type="checkbox" checked={!!ins} onChange={e => setIns(e.target.checked ? { contractId: '', memberNo: '' } : null)} /> تأمين / تعاقد (العضو يدفع نسبته والباقي على الجهة)</label>}
        {ins && <div className="formgrid"><label>الجهة<select value={ins.contractId} onChange={e => setIns({ ...ins, contractId: e.target.value })}><option value="">اختار</option>{contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>رقم العضو<input dir="ltr" value={ins.memberNo} onChange={e => setIns({ ...ins, memberNo: e.target.value })} /></label>{insQ && <div>على الجهة <b>{money(insQ.coveredMinor)}</b> - العضو يدفع <b>{money(insQ.copayMinor)}</b>{insQ.needsApproval && <span className="pill warn">محتاجة موافقة</span>}</div>}</div>}
        {can('home_delivery.create') && !ins && <label className="chk"><input type="checkbox" checked={!!deliv} onChange={e => toggleDeliv(e.target.checked)} /> توصيل للبيت (اللي مش مدفوع يتحصّل عند التوصيل)</label>}
        {deliv && <div className="formgrid"><label>اسم العميل<input value={deliv.name} onChange={e => setDeliv({ ...deliv, name: e.target.value })} /></label><label>الموبايل<input dir="ltr" value={deliv.phone} onChange={e => setDeliv({ ...deliv, phone: e.target.value })} /></label><label>العنوان<input value={deliv.address} onChange={e => setDeliv({ ...deliv, address: e.target.value })} /></label><label>مصاريف التوصيل<input className="num" value={deliv.fee} onChange={e => setDeliv({ ...deliv, fee: e.target.value })} /></label></div>}
        {err && <p className="err">{err}</p>}
        <p className="hint" style={{ margin: 0 }}>الكاش فاضي = العميل دفع المبلغ بالظبط. الأسعار من التشغيلة الأقرب انتهاءً. كليك يمين في أي حتة يطلع نفس أوامر الشريط.</p>
      </div>
    </>}
    </div>
    <nav className="pi-side" aria-label="أوامر الفاتورة">
      {visible.map(a => <button key={a.id} className={`pi-act${a.id === 'save' ? ' main' : ''}${a.id === 'close' && closeArmed ? ' armed' : ''}`} disabled={busy && a.id === 'save'} onClick={a.run}><Icon n={a.icon} /><span>{a.label}</span>{a.key && <kbd>{a.key}</kbd>}</button>)}
    </nav>
    {menu && <div className="ctx" style={{ top: Math.min(menu.y, window.innerHeight - 380), left: Math.min(menu.x, window.innerWidth - 230) }} role="menu">{visible.map(a => <button key={a.id} role="menuitem" onClick={() => { setMenu(null); a.run(); }}><Icon n={a.icon} />{a.label}{a.key && <kbd>{a.key}</kbd>}</button>)}</div>}
    {modal === 'home' && <HomeOrders close={() => setModal(null)} />}
    {modal === 'drafts' && <Drafts current={draftId} close={() => setModal(null)} open={d => { setLines(d.lines); setCustomer(d.customer); setDeliv(d.deliv); setDraftId(d.id); setSel(null); setModal(null); setDone(null); }} />}
    {modal === 'dose' && <DosePrint lines={lines} patient={customer?.name ?? deliv?.name ?? ''} close={() => setModal(null)} />}
  </div>);
}

/** الفواتير المنزلي: delivery orders out with the driver; collecting the money saves them for good. */
function HomeOrders({ close }: { close: () => void }) {
  const { toast, ask } = useApp(); const [list, setList] = useState<{ saleNo: string; status: string; name: string; phone: string; address: string; codMinor: number; agent: string | null; createdAt: string }[]>([]);
  const load = useCallback(() => { Promise.all(['pending', 'out_for_delivery'].map(st => api<{ deliveries: typeof list }>(`/api/pos/deliveries?status=${st}`).then(r => r.deliveries, () => []))).then(([a, b]) => setList([...(a ?? []), ...(b ?? [])])); }, []);
  useEffect(() => { load(); }, [load]);
  const act = (p: Promise<unknown>, ok: string) => p.then(() => { toast(ok); load(); }, e => toast(posErr(e)));
  return (<><div className="drawer-bg" onClick={close} /><div className="card pi-modal" role="dialog" aria-label="الفواتير المنزلي">
    <div className="pi-modal-head"><b>الفواتير المنزلي ({list.length})</b><button className="qbtn" onClick={close} aria-label="إغلاق"><Icon n="x" /></button></div>
    <div className="tablewrap" style={{ maxHeight: '60vh', overflow: 'auto' }}><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>العنوان</th><th>الحالة</th><th className="n">يتحصّل</th><th></th></tr></thead><tbody>
      {list.map(d => <tr key={d.saleNo}><td className="code">{d.saleNo}</td><td>{d.name}<br /><small className="code">{d.phone}</small></td><td>{d.address}</td><td>{d.status === 'pending' ? <span className="pill s-pending_purchase">مستني</span> : <span className="pill s-out_for_delivery">مع {d.agent ?? 'المندوب'}</span>}</td><td className="n"><b>{money(d.codMinor)}</b></td>
        <td><div className="actions">
          {d.status === 'pending' && <button className="btn" onClick={() => void ask('اسم المندوب').then(a => { if (a) void act(api(`/api/pos/deliveries/${d.saleNo}/status`, { body: { status: 'out_for_delivery', agent: a } }), 'خرج مع المندوب'); })}>خرج</button>}
          {d.status === 'out_for_delivery' && <button className="btn primary" onClick={() => void ask(`المبلغ اللي رجع بيه الدليفري (المطلوب ${egp(d.codMinor)})`).then(v => { const m = v ? toMinor(v) : null; if (m !== null) act(api(`/api/pos/deliveries/${d.saleNo}/collect`, { body: { cashMinor: m } }), 'اتحفظت ودخلت الفلوس الدرج'); })}>الفلوس وصلت - احفظ</button>}
          <button className="btn ghost" onClick={() => void ask('سبب إلغاء التوصيل (الأصناف هترجع المخزون)').then(r => { if (r) void act(api(`/api/pos/deliveries/${d.saleNo}/status`, { body: { status: 'failed', reason: r } }), 'اتلغى والمخزون رجع'); })}>فشل</button>
        </div></td></tr>)}
      {!list.length && <tr><td colSpan={6} className="muted">مفيش أوردرات توصيل مستنية</td></tr>}</tbody></table></div>
    <p className="hint" style={{ margin: 0 }}>الأوردر بيطلع من المخزون وقت ما بيخرج مع الدليفري، والفلوس بتدخل الدرج لما تدوس "الفلوس وصلت".</p>
  </div></>);
}

/** Invoices left on this device before they were saved (a crash, a closed window, a switch to another screen). */
function Drafts({ current, close, open }: { current: string; close: () => void; open: (d: Draft) => void }) {
  const [list, setList] = useState<Draft[]>(() => readDrafts().filter(d => d.id !== current));
  return (<><div className="drawer-bg" onClick={close} /><div className="card pi-modal" role="dialog" aria-label="فواتير غير مكتملة">
    <div className="pi-modal-head"><b>فواتير غير مكتملة ({list.length})</b><button className="qbtn" onClick={close} aria-label="إغلاق"><Icon n="x" /></button></div>
    <div className="tablewrap"><table><thead><tr><th>الوقت</th><th>العميل</th><th>الأصناف</th><th></th></tr></thead><tbody>
      {list.map(d => <tr key={d.id}><td>{dmyHm(d.at)}</td><td>{d.customer?.name ?? d.deliv?.name ?? '-'}</td><td>{d.lines.map(l => `${l.item.nameAr} ×${l.qty}`).join(' - ')}</td><td><div className="actions"><button className="btn primary" onClick={() => open(d)}>رجّعها</button><button className="btn ghost" onClick={() => { dropDraft(d.id); setList(list.filter(x => x.id !== d.id)); }}>شيلها</button></div></td></tr>)}
      {!list.length && <tr><td colSpan={4} className="muted">مفيش فواتير ناقصة على الجهاز ده</td></tr>}</tbody></table></div>
    <p className="hint" style={{ margin: 0 }}>دي محفوظة على الجهاز ده بس لحد ما تتسجل أو تتقفل.</p>
  </div></>);
}

const DOSE_CHIPS = ['قرص', 'كبسولة', 'معلقة صغيرة', 'مرة يوميًا', 'مرتين يوميًا', '3 مرات يوميًا', 'كل 8 ساعات', 'كل 12 ساعة', 'قبل الأكل', 'بعد الأكل', 'قبل النوم', 'لمدة 5 أيام', 'لمدة أسبوع', 'عند اللزوم'];
/** طباعة الاستخدام: a sticker per item with how to take it (label printer), or a slip when there is none. */
function DosePrint({ lines, patient, close }: { lines: Line[]; patient: string; close: () => void }) {
  const { toast } = useApp(); const [doses, setDoses] = useState<string[]>(() => lines.map(() => '')); const [who, setWho] = useState(patient); const [focus, setFocus] = useState(0);
  const chip = (c: string) => setDoses(ds => ds.map((d, i) => (i === focus ? (d ? `${d} ${c}` : c) : d)));
  const print = async () => {
    const ls = lines.map((l, i) => ({ itemId: l.item.id, dose: doses[i]!.trim() })).filter(l => l.dose); if (!ls.length) return toast('اكتب الجرعة لصنف واحد على الأقل');
    /* a sticker per item on the label printer; with no label printer the Hub prints one slip on the receipt printer (Sprint 7.12) */
    try { const r = await api<{ printer: string; mode: 'label' | 'slip'; results: { ok: boolean; error?: string }[] }>('/api/print/dose', { body: { patient: who || undefined, lines: ls } }); const bad = r.results.filter(x => !x.ok);
      toast(bad.length ? `${bad.length} ${r.mode === 'slip' ? 'صنف' : 'استيكر'} مطبعش${bad[0]?.error ? `: ${bad[0].error}` : ''}` : r.mode === 'slip' ? `اتطبعت ورقة الاستخدام على ${r.printer}` : `اتبعتت ${ls.length} استيكر لـ ${r.printer}`); if (!bad.length) close(); }
    catch (e) { toast((e as { code?: string }).code === 'state' ? 'مفيش طابعة استيكر ولا طابعة إيصال: البيانات العامة ← إعدادات التشغيل ← الطابعات' : arabic(e)); }
  };
  return (<><div className="drawer-bg" onClick={close} /><div className="card pi-modal" role="dialog" aria-label="طباعة الاستخدام">
    <div className="pi-modal-head"><b>طباعة الاستخدام</b><button className="qbtn" onClick={close} aria-label="إغلاق"><Icon n="x" /></button></div>
    <label className="f" style={{ display: 'grid', gap: 6, maxWidth: 360 }}>اسم المريض (اختياري)<input value={who} onChange={e => setWho(e.target.value)} /></label>
    <div style={{ display: 'grid', gap: 8 }}>{lines.map((l, i) => <label key={i} className="dose-row"><b>{l.item.nameAr}</b><input value={doses[i]} onFocus={() => setFocus(i)} onChange={e => setDoses(doses.map((d, k) => (k === i ? e.target.value : d)))} placeholder="مثلًا: قرص كل 8 ساعات بعد الأكل" /></label>)}</div>
    <div className="dose-chips">{DOSE_CHIPS.map(c => <button key={c} className="btn ghost" onClick={() => chip(c)}>{c}</button>)}</div>
    <div className="actions"><button className="btn primary" onClick={() => void print()}><Icon n="print" />اطبع</button><button className="btn ghost" onClick={close}>إلغاء</button></div>
  </div></>);
}

/* ================= held bills ================= */
export function HeldScreen() {
  const { toast, go, ask } = useApp(); const [list, setList] = useState<{ id: string; holdNo: string; note: string | null; createdAt: string; lines: unknown }[]>([]);
  const load = () => api<{ holds: typeof list }>('/api/pos/holds').then(r => setList(r.holds), e => toast(arabic(e))); useEffect(() => { void load(); }, []);
  const resume = async (id: string) => { try { const r = await api<{ lines: { itemId: string; qty: number; unitName?: string }[] }>(`/api/pos/holds/${id}/resume`, { body: {} }); const items: Line[] = []; for (const l of r.lines) { const it = (await api<{ item: TillItem }>(`/api/pos/items/${l.itemId}`)).item; items.push({ item: it, unitName: l.unitName ?? it.units[0]!.name, qty: l.qty }); } sessionStorage.setItem('o.resume', JSON.stringify({ lines: items })); sessionStorage.setItem('o.resumeId', id); go('sale'); } catch (e) { toast(posErr(e)); } };
  return (<div style={{ display: 'grid', gap: 12 }}><h2><Icon n="pause" />الفواتير المعلّقة</h2>
    <div className="tablewrap"><table className="cards"><thead><tr><th>رقم</th><th>ملاحظة</th><th>الوقت</th><th></th></tr></thead><tbody>
      {list.map(h => <tr key={h.id}><td data-l="رقم" className="code">{h.holdNo}</td><td data-l="ملاحظة">{h.note ?? '-'}</td><td data-l="الوقت">{dmyHm(h.createdAt)}</td><td className="bt"><div className="actions"><button className="btn primary" onClick={() => void resume(h.id)}>كمّل البيع</button><button className="btn ghost" onClick={() => void ask('سبب إلغاء الفاتورة المعلّقة').then(r => { if (r) void api(`/api/pos/holds/${h.id}/cancel`, { body: { reason: r } }).then(() => { toast('اتلغت'); void load(); }, e => toast(posErr(e))); })}>إلغاء</button></div></td></tr>)}
      {!list.length && <tr><td colSpan={4} className="muted">مفيش فواتير معلّقة.</td></tr>}</tbody></table></div></div>);
}

/* ================= invoices ================= */
type SaleDetail = { saleNo: string; status: string; totalMinor: number; grossMinor: number; discountMinor: number; createdAt: string; createdBy: string; payments: { method: string; amountMinor: number; ref: string | null }[]; lines: { lineNo: number; itemName: string; qtyBase: number; amountMinor: number; lot: string | null; expiry: string | null }[]; returnedMinor: number; delivery: unknown };
export function InvoicesScreen() {
  const { can, toast, ask, go } = useApp(); const [list, setList] = useState<{ saleNo: string; status: string; totalMinor: number; createdAt: string; createdByName: string }[]>([]); const [open, setOpen] = useState<SaleDetail | null>(null); const [q, setQ] = useState('');
  const load = () => api<{ sales: typeof list }>('/api/pos/sales').then(r => setList(r.sales), e => toast(arabic(e))); useEffect(() => { void load(); }, []);
  const show = (no: string) => api<{ sale: SaleDetail }>(`/api/pos/sales/${encodeURIComponent(no)}`).then(r => setOpen(r.sale), e => toast(arabic(e)));
  const rows = list.filter(s => !q || s.saleNo.includes(q.trim()));
  return (<div style={{ display: 'grid', gap: 12 }}><h2><Icon n="history" />سجل الفواتير</h2>
    <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="رقم الفاتورة" />
    {open && <div className="card" style={{ display: 'grid', gap: 8 }}><b>فاتورة {open.saleNo} {open.status === 'void' && <span className="pill warn">ملغاة</span>}</b>
      <div className="tablewrap"><table><thead><tr><th>#</th><th>الصنف</th><th>التشغيلة</th><th className="n">القيمة</th></tr></thead><tbody>{open.lines.map((l, i) => <tr key={i}><td>{l.lineNo}</td><td>{l.itemName}</td><td className="code">{l.lot ?? '-'}{l.expiry ? ` - ${l.expiry}` : ''}</td><td className="n">{money(l.amountMinor)}</td></tr>)}</tbody></table></div>
      <div>الإجمالي {money(open.totalMinor)} - الدفع: {open.payments.map(p => `${p.method === 'cash' ? 'كاش' : p.method === 'card' ? 'فيزا' : p.method === 'cod' ? 'عند التوصيل' : p.method} ${money(p.amountMinor)}`).join(' - ')}{open.returnedMinor > 0 && ` - مرتجع ${money(open.returnedMinor)}`}</div>
      <ReceiptBox saleNo={open.saleNo} />
      <div className="actions">{open.status === 'posted' && (can('sale.return') || can('sale.swap')) && <button className="btn" onClick={() => { sessionStorage.setItem('o.returnSale', open.saleNo); go('returns'); }}><Icon n="undo" />مرتجع</button>}
        {open.status === 'posted' && can('sale.void') && <button className="btn ghost" onClick={() => void ask('سبب إلغاء الفاتورة').then(r => { if (r) void api(`/api/pos/sales/${open.saleNo}/void`, { body: { reason: r } }).then(() => { toast('الفاتورة اتلغت والمخزون رجع'); void show(open.saleNo); void load(); }, e => toast(posErr(e))); })}>إلغاء الفاتورة</button>}
        <button className="btn ghost" onClick={() => setOpen(null)}>إغلاق</button></div></div>}
    <div className="tablewrap"><table className="cards"><thead><tr><th>الفاتورة</th><th>الوقت</th><th>الكاشير</th><th className="n">الإجمالي</th><th>الحالة</th></tr></thead><tbody>
      {rows.map(s => <tr key={s.saleNo} onClick={() => void show(s.saleNo)} style={{ cursor: 'pointer' }}><td data-l="الفاتورة" className="code">{s.saleNo}</td><td data-l="الوقت">{dmyHm(s.createdAt)}</td><td data-l="الكاشير">{s.createdByName}</td><td className="n" data-l="الإجمالي">{money(s.totalMinor)}</td><td data-l="الحالة">{s.status === 'void' ? <span className="pill warn">ملغاة</span> : <span className="pill">مسجلة</span>}</td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="muted">مفيش فواتير.</td></tr>}</tbody></table></div></div>);
}

/* ================= returns and swaps ================= */
const REASONS: [string, string][] = [['changed_mind', 'العميل غيّر رأيه'], ['wrong_item', 'صنف غلط'], ['damaged', 'تالف'], ['doctor_changed', 'الدكتور غيّر العلاج'], ['other', 'سبب تاني']];
export function ReturnsScreen() {
  const { can, toast } = useApp(); const { info } = useSession(); const [no, setNo] = useState(() => { try { const v = sessionStorage.getItem('o.returnSale'); if (v) sessionStorage.removeItem('o.returnSale'); return v ?? ''; } catch { return ''; } });
  const [sale, setSale] = useState<SaleDetail | null>(null); const [qty, setQty] = useState<Record<number, number>>({}); const [reason, setReason] = useState('changed_mind'); const [cond, setCond] = useState<'resellable' | 'damaged'>('resellable'); const [refund, setRefund] = useState<'cash' | 'card' | 'account'>('cash'); const [cardRef, setCardRef] = useState('');
  const [swap, setSwap] = useState(false); const [newLines, setNewLines] = useState<Line[]>([]); const quotes = useQuotes(newLines); const [cash, setCash] = useState(''); const [err, setErr] = useState(''); const [done, setDone] = useState(''); const keyRef = useRef(newKey());
  const find = useCallback(async (n: string) => { setErr(''); setSale(null); try { const r = await api<{ sale: SaleDetail }>(`/api/pos/sales/${encodeURIComponent(n.trim())}`); setSale(r.sale); setQty({}); } catch (e) { setErr(arabic(e)); } }, []);
  useEffect(() => { if (no) void find(no); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const byLine = useMemo(() => { const m = new Map<number, { name: string; qtyBase: number; amountMinor: number }>(); for (const l of sale?.lines ?? []) { const x = m.get(l.lineNo) ?? { name: l.itemName, qtyBase: 0, amountMinor: 0 }; x.qtyBase += l.qtyBase; x.amountMinor += l.amountMinor; m.set(l.lineNo, x); } return m; }, [sale]);
  const chosen = Object.entries(qty).filter(([, q]) => q > 0).map(([lineNo, q]) => ({ lineNo: Number(lineNo), qty: q }));
  const submit = async () => { if (!info?.session) return setErr('افتح جلسة كاشير الأول: الفلوس بتطلع من درجك.'); if (!sale || !chosen.length) return setErr('اختار الكمية اللي راجعة'); if (refund === 'card' && !cardRef.trim()) return setErr('اكتب رقم عملية الفيزا'); setErr('');
    try { if (swap) { const r = await api<{ returnNo: string; newSaleNo: string }>('/api/pos/swaps', { body: { key: keyRef.current, saleNo: sale.saleNo, sessionId: info.session.id, lines: chosen, reasonCode: reason, condition: cond, newLines: newLines.map(l => ({ itemId: l.item.id, qty: l.qty, unitName: l.unitName })), cashMinor: cash ? toMinor(cash) ?? undefined : undefined } }); setDone(`اتعمل الاستبدال: مرتجع ${r.returnNo} وفاتورة جديدة ${r.newSaleNo}`); }
      else { const r = await api<{ returnNo: string; totalMinor: number; cashMinor: number; cardMinor: number; accountMinor: number }>('/api/pos/returns', { body: { key: keyRef.current, saleNo: sale.saleNo, sessionId: info.session.id, lines: chosen, reasonCode: reason, condition: cond, refund: refund === 'card' ? { method: 'card', ref: cardRef.trim() } : { method: refund } } }); setDone(`اتعمل المرتجع ${r.returnNo}: ${money(r.totalMinor)}${r.cashMinor ? ` - رجّع للعميل كاش ${money(r.cashMinor)}` : ''}${r.cardMinor ? ` - على الفيزا ${money(r.cardMinor)}` : ''}${r.accountMinor ? ` - على حسابه ${money(r.accountMinor)}` : ''}`); }
      keyRef.current = newKey(); setSale(null); setQty({}); setNewLines([]); toast('تم'); } catch (e) { setErr(posErr(e)); } };
  return (<div style={{ display: 'grid', gap: 12, maxWidth: 900 }}><h2><Icon n="undo" />مرتجع واستبدال</h2>
    {done && <div className="card warnbox">{done}</div>}
    <div className="formgrid"><label>رقم الفاتورة<input className="code" value={no} onChange={e => setNo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void find(no); }} /></label><button className="btn" onClick={() => void find(no)}>هات الفاتورة</button></div>
    {err && <p className="err">{err}</p>}
    {sale && <div className="card" style={{ display: 'grid', gap: 10 }}><b>فاتورة {sale.saleNo} - {money(sale.totalMinor)}{sale.returnedMinor > 0 && ` (رجع منها ${money(sale.returnedMinor)})`}</b>
      <div className="tablewrap"><table><thead><tr><th>الصنف</th><th className="n">المباع (أصغر وحدة)</th><th className="n">راجع (أصغر وحدة)</th></tr></thead><tbody>{[...byLine.entries()].map(([ln, l]) => <tr key={ln}><td>{l.name}</td><td className="n">{l.qtyBase}</td><td className="n"><input className="num" inputMode="numeric" value={qty[ln] ?? ''} onChange={e => { const n = Number(e.target.value); if (e.target.value === '' || (Number.isInteger(n) && n >= 0 && n <= l.qtyBase)) setQty({ ...qty, [ln]: e.target.value === '' ? 0 : n }); }} /></td></tr>)}</tbody></table></div>
      <div className="formgrid"><label>السبب<select value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>حالة البضاعة<select value={cond} onChange={e => setCond(e.target.value as 'resellable')}><option value="resellable">سليمة (ترجع للرف)</option><option value="damaged">تالفة (مخزن المرتجعات)</option></select></label>
        {!swap && <label>الفلوس ترجع<select value={refund} onChange={e => setRefund(e.target.value as 'cash')}><option value="cash">كاش من الدرج</option><option value="card">على الفيزا</option><option value="account">على حساب العميل</option></select></label>}{!swap && refund === 'card' && <label>رقم العملية<input dir="ltr" value={cardRef} onChange={e => setCardRef(e.target.value)} /></label>}</div>
      {can('sale.swap') && <label className="chk"><input type="checkbox" checked={swap} onChange={e => setSwap(e.target.checked)} /> استبدال بأصناف تانية (قيمة المرتجع بتتخصم من الفاتورة الجديدة)</label>}
      {swap && <><ItemPicker onPick={(it, u) => setNewLines(addLine(newLines, it, u))} /><LinesTable lines={newLines} setLines={setNewLines} quotes={quotes} /><label>كاش من العميل لو الجديد أغلى (جنيه)<input className="num" value={cash} onChange={e => setCash(e.target.value)} /></label></>}
      <div className="actions"><button className="btn primary" onClick={() => void submit()}>{swap ? 'تنفيذ الاستبدال' : 'تنفيذ المرتجع'}</button></div></div>}
  </div>);
}

/* ================= deliveries ================= */
export function DeliveriesScreen() {
  const { can, toast, ask } = useApp(); const [st, setSt] = useState('pending'); const [list, setList] = useState<{ saleNo: string; status: string; name: string; phone: string; address: string; codMinor: number; agent: string | null; createdAt: string }[]>([]);
  const load = () => api<{ deliveries: typeof list }>(`/api/pos/deliveries?status=${st}`).then(r => setList(r.deliveries), e => toast(arabic(e))); useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);
  const act = (p: Promise<unknown>, ok: string) => p.then(() => { toast(ok); void load(); }, e => toast(posErr(e)));
  return (<div style={{ display: 'grid', gap: 12 }}><h2><Icon n="truck" />توصيل الفواتير</h2>
    <div className="tabs-inline">{[['pending', 'مستني'], ['out_for_delivery', 'خرج مع المندوب'], ['delivered', 'اتسلّم'], ['failed', 'فشل']].map(([k, v]) => <button key={k} className={`btn${st === k ? ' primary' : ' ghost'}`} onClick={() => setSt(k!)}>{v}</button>)}</div>
    <div className="tablewrap"><table className="cards"><thead><tr><th>الفاتورة</th><th>العميل</th><th>العنوان</th><th className="n">يتحصّل</th><th></th></tr></thead><tbody>
      {list.map(d => <tr key={d.saleNo}><td data-l="الفاتورة" className="code">{d.saleNo}</td><td data-l="العميل">{d.name}<br /><small className="code">{d.phone}</small></td><td data-l="العنوان">{d.address}</td><td className="n" data-l="يتحصّل">{money(d.codMinor)}</td>
        <td className="bt"><div className="actions">
          {d.status === 'pending' && can('home_delivery.create') && <button className="btn" onClick={() => void ask('اسم المندوب').then(a => { if (a) void act(api(`/api/pos/deliveries/${d.saleNo}/status`, { body: { status: 'out_for_delivery', agent: a } }), 'خرج مع المندوب'); })}>خرج للتوصيل</button>}
          {d.status === 'out_for_delivery' && <button className="btn primary" onClick={() => void ask(`المبلغ اللي اتحصّل (المطلوب ${egp(d.codMinor)})`).then(v => { const m = v ? toMinor(v) : null; if (m !== null) act(api(`/api/pos/deliveries/${d.saleNo}/collect`, { body: { cashMinor: m } }), 'اتحصّل ودخل الدرج'); })}>تحصيل</button>}
          {(d.status === 'pending' || d.status === 'out_for_delivery') && <button className="btn ghost" onClick={() => void ask('سبب فشل التوصيل').then(r => { if (r) void act(api(`/api/pos/deliveries/${d.saleNo}/status`, { body: { status: 'failed', reason: r } }), 'اتسجل فشل التوصيل والمخزون رجع'); })}>فشل</button>}
        </div></td></tr>)}
      {!list.length && <tr><td colSpan={5} className="muted">مفيش.</td></tr>}</tbody></table></div></div>);
}

/* ================= closing (reviewers) ================= */
export function ClosingScreen() {
  const { toast, ask } = useApp(); const [date, setDate] = useState(''); const [data, setData] = useState<{ date: string; sessions: { id: string; sessionNo: string; terminal: string; userName: string; status: string; openedAt: string; closedAt: string | null; diffMinor: number | null }[] } | null>(null);
  const [day, setDay] = useState<{ date: string; closed: boolean; blockers: { open: string[]; unreviewed: string[] } | null; days: { date: string; totals: { salesMinor: number; salesCount: number; cashMinor: number; cardMinor: number; returnsMinor: number }; closedAt: string }[] } | null>(null); const [rep, setRep] = useState<{ id: string; r: Report } | null>(null); const printers = usePrinters();
  const load = useCallback(async (d?: string) => { try { const s = await api<NonNullable<typeof data>>(`/api/pos/sessions${d ? `?date=${d}` : ''}`); setData(s); setDate(s.date); setDay(await api(`/api/pos/day?date=${s.date}`)); } catch (e) { toast(arabic(e)); } }, [toast]);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { try { setRep({ id, r: (await api<{ report: Report }>(`/api/pos/sessions/${id}/report`)).report }); } catch (e) { toast(posErr(e)); } };
  const review = async (decision: 'accepted' | 'escalated') => { if (!rep) return; const note = await ask(decision === 'accepted' ? 'ملاحظة القبول (لازمة لو فيه فرق، اكتب - لو مفيش)' : 'سبب التصعيد'); if (note === null) return; try { await api(`/api/pos/sessions/${rep.id}/review`, { body: { decision, note: note === '-' ? undefined : note } }); toast(decision === 'accepted' ? 'اتقبلت الجلسة' : 'اتصعّدت'); await open(rep.id); await load(date); } catch (e) { toast(posErr(e)); } };
  const closeDay = async () => { const note = await ask(`تقفيل يوم ${date} نهائي. ملاحظة (اكتب - لو مفيش)`); if (note === null) return; try { await api('/api/pos/day/close', { body: { key: newKey(), date, note: note === '-' ? undefined : note } }); toast('اليوم اتقفل'); await load(date); } catch (e) { toast(posErr(e)); } };
  return (<div style={{ display: 'grid', gap: 12 }}><h2><Icon n="check" />تقفيل الدرج واليوم</h2>
    <div className="formgrid"><label>اليوم<input type="date" value={date} onChange={e => void load(e.target.value)} /></label></div>
    {day && (day.closed ? <div className="card">اليوم ده متقفل.</div> : <div className="card" style={{ display: 'grid', gap: 6 }}>{day.blockers && (day.blockers.open.length || day.blockers.unreviewed.length) ? <><span>لسه مينفعش يتقفل:</span>{day.blockers.open.length > 0 && <span>جلسات مفتوحة: <span className="code">{day.blockers.open.join(' - ')}</span></span>}{day.blockers.unreviewed.length > 0 && <span>جلسات فيها فرق محدش قبله: <span className="code">{day.blockers.unreviewed.join(' - ')}</span></span>}</> : <><span>كل الجلسات مقفولة ومراجعة.</span><button className="btn primary" onClick={() => void closeDay()}>اقفل اليوم</button></>}</div>)}
    <div className="tablewrap"><table className="cards"><thead><tr><th>الجلسة</th><th>الكاشير</th><th>الجهاز</th><th>الحالة</th><th className="n">الفرق</th></tr></thead><tbody>
      {data?.sessions.map(s => <tr key={s.id} onClick={() => void open(s.id)} style={{ cursor: 'pointer' }}><td data-l="الجلسة" className="code">{s.sessionNo}</td><td data-l="الكاشير">{s.userName}</td><td data-l="الجهاز">{s.terminal}</td><td data-l="الحالة">{s.status === 'open' ? <span className="pill warn">مفتوحة</span> : <span className="pill">مقفولة</span>}</td><td className="n" data-l="الفرق">{s.diffMinor == null ? '-' : <b className={s.diffMinor ? 'err' : ''}>{money(s.diffMinor)}</b>}</td></tr>)}
      {!data?.sessions.length && <tr><td colSpan={5} className="muted">مفيش جلسات في اليوم ده.</td></tr>}</tbody></table></div>
    {rep && <><ReportView r={rep.r} />{rep.r.status === 'closed' && <div className="actions"><button className="btn primary" onClick={() => void review('accepted')}>قبول</button><button className="btn ghost" onClick={() => void review('escalated')}>تصعيد</button>{printers.map(p => <button key={p.name} className="btn" onClick={() => void api<{ ok: boolean; error?: string }>('/api/print/session-report', { body: { sessionId: rep.id, printer: p.name } }).then(r => toast(r.ok ? 'اتطبع التقرير' : `فشل: ${r.error}`), e => void ask('سبب طباعة نسخة تانية').then(reason => { if (reason) void api('/api/print/session-report', { body: { sessionId: rep.id, printer: p.name, reason } }).then(() => toast('اتطبعت نسخة'), () => toast(arabic(e))); }))}><Icon n="print" />اطبع ({p.name})</button>)}</div>}</>}
    {day && day.days.length > 0 && <div className="card"><b>آخر الأيام المقفولة</b><div className="tablewrap"><table><thead><tr><th>اليوم</th><th className="n">فواتير</th><th className="n">مبيعات</th><th className="n">كاش</th><th className="n">فيزا</th><th className="n">مرتجع</th></tr></thead><tbody>{day.days.map(d => <tr key={d.date}><td>{d.date}</td><td className="n">{d.totals.salesCount}</td><td className="n">{money(d.totals.salesMinor)}</td><td className="n">{money(d.totals.cashMinor)}</td><td className="n">{money(d.totals.cardMinor)}</td><td className="n">{money(d.totals.returnsMinor)}</td></tr>)}</tbody></table></div></div>}
  </div>);
}

export function EtaScreen() {
  return (<div className="soonbox"><h2><Icon n="file" />الفاتورة الإلكترونية (ETA)</h2><div className="card"><p>الإيصال الإلكتروني جاهز في البرنامج (التوقيع والسلسلة والطابور والـ QR)، لكنه <b>مش متفعّل</b> لحد ما توصل بيانات تسجيل الصيدلية عند مصلحة الضرائب: رقم التسجيل، كود النشاط، وسيريال كل جهاز كاشير (بند 12 في المطلوب منك).</p><p className="muted">لما البيانات توصل، كل فاتورة بتتسجل بتدخل الطابور وتتبعت خلال 24 ساعة، والـ QR بيتطبع على الوصل.</p></div></div>);
}
