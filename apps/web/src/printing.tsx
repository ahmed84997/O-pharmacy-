/* Sprint 7.12 (owner's photos of the eStock screens, 14 Nov 2026): barcode printing for many items with quantities and the print question,
   the barcode and sale-invoice print settings with a live preview, periodic backups, and the contract paper invoice on A4. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, arabic, device, token } from './api';
import { egp, Icon, money, toMinor, useApp } from './ui';
import { ItemPicker, type TillItem } from './pos';
import { useFrame } from './frames';

/* ---------- shared: a picture from the Hub (POST), refreshed a moment after the inputs settle ---------- */
function usePreview(url: string, payload: unknown, enabled = true): string {
  const [src, setSrc] = useState(''); const key = JSON.stringify(payload);
  useEffect(() => {
    if (!enabled) return; let gone = false; let made = '';
    const t = window.setTimeout(() => {
      const h: Record<string, string> = { 'content-type': 'application/json' }; const d = device.get(); const tk = token.get(); if (d) h['x-device'] = d; if (tk) h.authorization = `Bearer ${tk}`;
      fetch(url, { method: 'POST', headers: h, body: key }).then(r => (r.ok ? r.blob() : null)).then(b => { if (b && !gone) { made = URL.createObjectURL(b); setSrc(old => { if (old) URL.revokeObjectURL(old); return made; }); } }).catch(() => undefined);
    }, 250);
    return () => { gone = true; window.clearTimeout(t); };
  }, [url, key, enabled]);
  return src;
}

type PrinterCfg = { name: string; kind: 'receipt' | 'label'; paperWidthMm?: 58 | 80; drawerOnCash?: boolean; labelMm?: [number, number]; gapMm?: number; density?: number; speed?: number; offsetX?: number; offsetY?: number; language?: 'tspl' | 'zpl'; invert?: boolean; sideMarginMm?: number; transport: { type: 'windows'; printer: string } | { type: 'tcp'; host: string; port?: number } | { type: 'device' } | { type: 'preview' } };
type Desk = { localPrinters?: () => Promise<{ printers: string[]; receipt: string; label: string; mode: string | null } | null>; setLocalPrinters?: (v: { receipt: string; label: string }) => Promise<boolean> };
const desk = (): Desk | undefined => (window as unknown as { oDesktop?: Desk }).oDesktop;

/** All printers as saved, to edit one of them and save the list back. */
function usePrinterList() {
  const [list, setList] = useState<PrinterCfg[] | null>(null); const [win, setWin] = useState<string[]>([]);
  const load = useCallback(() => { api<{ printers: PrinterCfg[] }>('/api/settings/printers').then(r => setList(r.printers), () => setList([])); api<{ printers: string[] }>('/api/print/windows-printers').then(r => setWin(r.printers), () => setWin([])); }, []);
  useEffect(load, [load]);
  const save = async (next: PrinterCfg[]) => { await api('/api/settings/printers', { body: { printers: next } }); setList(next); };
  return { list, setList, win, save };
}

/** How one printer is reached: each PC's own printer (the desktop app), a printer installed on the main PC (picked from Windows), a network printer, or the screen only. */
function Connection({ p, set, win, kind }: { p: PrinterCfg; set: (p: PrinterCfg) => void; win: string[]; kind: 'receipt' | 'label' }) {
  const [local, setLocal] = useState<{ printers: string[]; receipt: string; label: string } | null>(null);
  useEffect(() => { const d = desk(); if (p.transport.type === 'device' && d?.localPrinters) void d.localPrinters().then(v => setLocal(v), () => setLocal(null)); }, [p.transport.type]);
  const t = p.transport;
  return (<>
    <label>طريقة التوصيل<select value={t.type} onChange={e => set({ ...p, transport: e.target.value === 'windows' ? { type: 'windows', printer: win[0] ?? '' } : e.target.value === 'tcp' ? { type: 'tcp', host: '', port: 9100 } : e.target.value === 'device' ? { type: 'device' } : { type: 'preview' } })}>
      <option value="device">طابعة الجهاز اللي بيطبع (كل كاشير على طابعته)</option><option value="windows">طابعة متسطّبة على الجهاز الأساسي</option><option value="tcp">طابعة شبكة (IP)</option><option value="preview">عرض على الشاشة بس</option></select></label>
    {t.type === 'windows' && <label>إسم الطابعة{win.length ? <select value={t.printer} onChange={e => set({ ...p, transport: { type: 'windows', printer: e.target.value } })}>{!win.includes(t.printer) && t.printer && <option value={t.printer}>{t.printer}</option>}{win.map(n => <option key={n} value={n}>{n}</option>)}</select> : <input dir="ltr" value={t.printer} onChange={e => set({ ...p, transport: { type: 'windows', printer: e.target.value } })} placeholder={kind === 'label' ? 'Xprinter XP-243B' : 'XP-80C'} />}</label>}
    {t.type === 'tcp' && <label>عنوان IP<input dir="ltr" value={t.host} onChange={e => set({ ...p, transport: { type: 'tcp', host: e.target.value, port: 9100 } })} placeholder="192.168.1.50" /></label>}
    {t.type === 'device' && (local ? <label>طابعة {kind === 'label' ? 'الباركود' : 'الفاتورة'} على الجهاز ده<select value={local[kind]} onChange={e => { const v = { ...local, [kind]: e.target.value }; setLocal(v); void desk()!.setLocalPrinters!({ receipt: v.receipt, label: v.label }); }}><option value="">اختار</option>{local.printers.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      : <span className="hint">كل جهاز بيختار طابعته من برنامج O Pharmacy عليه (من الشاشة دي).</span>)}
  </>);
}

/* ================= طباعة باركود ================= */
type LabelItem = { id: string; code: string; nameAr: string; barcode: string | null; unit: string; stock: number; priceMinor: number | null; batches: { expiry: string; qty: number; priceMinor: number | null }[] };
type Row = { it: LabelItem; copies: string; expiry: string; price: string };
type Show = { pharmacy: boolean; phone: boolean; price: boolean; expiry: boolean };
const mmYyyy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function BarcodePrintScreen() {
  const { toast, go } = useApp(); const frame = useFrame(); const [rows, setRows] = useState<Row[]>([]); const [sel, setSel] = useState<number | null>(null); const [ask, setAsk] = useState<Show | null>(null); const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<Show>({ pharmacy: true, phone: true, price: true, expiry: true }); const [printers, setPrinters] = useState<{ name: string }[]>([]); const [printer, setPrinter] = useState('');
  useEffect(() => { api<{ style: { showPharmacy: boolean; showPhone: boolean; showPrice: boolean; showExpiry: boolean }; printers: { name: string }[] }>('/api/settings/label-style').then(r => { setStyle({ pharmacy: r.style.showPharmacy, phone: r.style.showPhone, price: r.style.showPrice, expiry: r.style.showExpiry }); setPrinters(r.printers); setPrinter(r.printers[0]?.name ?? ''); }, () => undefined); }, []);
  const add = async (t: TillItem) => {
    try { const r = await api<{ item: LabelItem }>(`/api/print/label-item/${t.id}`); const it = r.item;
      setRows(rs => { const i = rs.findIndex(x => x.it.id === it.id); if (i >= 0) { setSel(i); return rs.map((x, k) => (k === i ? { ...x, copies: String((Number(x.copies) || 0) + 1) } : x)); } setSel(rs.length); return [...rs, { it, copies: '1', expiry: it.batches[0]?.expiry ?? '', price: it.priceMinor == null ? '' : egp(it.priceMinor) }]; });
    } catch (e) { toast(arabic(e)); }
  };
  const upd = (i: number, p: Partial<Row>) => setRows(rs => rs.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const del = (i: number | null) => { if (i === null) return; setRows(rs => rs.filter((_, k) => k !== i)); setSel(null); };
  const total = rows.reduce((a, r) => a + Math.max(0, Math.round(Number(r.copies) || 0)), 0);
  const doPrint = async (show: Show) => {
    setBusy(true); try {
      const r = await api<{ printer: string; stickers: number; results: { ok: boolean; error?: string }[] }>('/api/print/labels', { body: { printer: printer || undefined, show, lines: rows.map(x => ({ itemId: x.it.id, copies: Math.max(1, Math.round(Number(x.copies) || 1)), priceMinor: toMinor(x.price) ?? undefined, expiry: x.expiry || undefined })) } });
      const bad = r.results.filter(x => !x.ok); toast(bad.length ? `اتطبع ${r.stickers} باركود - ${bad.length} صنف مطبعش: ${bad[0]?.error ?? ''}` : `اتبعت ${r.stickers} باركود لـ ${r.printer}`); setAsk(null);
    } catch (e) { toast((e as { code?: string }).code === 'state' ? 'مفيش طابعة باركود: البيانات العامة ← إعدادات طباعة الباركود' : arabic(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (!frame.active) return; const k = (e: KeyboardEvent) => { const inField = (e.target as HTMLElement)?.closest?.('input, select, textarea'); if (e.key === 'F9' && rows.length) { e.preventDefault(); setAsk({ ...style }); } else if (e.key === 'Delete' && !inField) { e.preventDefault(); del(sel); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });
  const first = rows[sel ?? 0];
  const preview = usePreview('/api/print/label-preview', first && ask ? { itemId: first.it.id, priceMinor: toMinor(first.price) ?? undefined, expiry: first.expiry || undefined, style: { showPharmacy: ask.pharmacy, showPhone: ask.phone, showPrice: ask.price, showExpiry: ask.expiry } } : null, !!(first && ask));
  return (<div style={{ display: 'grid', gap: 12 }}>
    <h2><Icon n="barcode" />طباعة باركود</h2>
    <div className="bc-top"><div style={{ flex: 1, minWidth: 0 }}><ItemPicker onPick={it => void add(it)} autoFocus /></div>
      {printers.length > 1 && <label className="f">الطابعة<select value={printer} onChange={e => setPrinter(e.target.value)}>{printers.map(p => <option key={p.name}>{p.name}</option>)}</select></label>}</div>
    {printers.length === 0 && <div className="card warnbox">مفيش طابعة باركود متعرّفة. <button className="linkbtn" onClick={() => go('labelset')}>اظبطها من إعدادات طباعة الباركود</button></div>}
    <div className="tablewrap"><table className="bc-grid"><thead><tr><th>كود الصنف</th><th>إسم الصنف</th><th>الوحدة</th><th className="n">الكمية</th><th>تاريخ الصلاحية</th><th className="n">الرصيد</th><th className="n">سعر البيع</th><th aria-label="حذف" /></tr></thead>
      <tbody>{rows.length === 0 ? <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>دوّر على صنف أو امسح الباركود وهو هيتضاف هنا. تقدر تضيف أصناف كتير وتكتب عدد الباركود لكل صنف.</td></tr>
        : rows.map((r, i) => (<tr key={r.it.id} className={sel === i ? 'sel' : undefined} onClick={() => setSel(i)}>
          <td className="code">{r.it.code}</td><td>{r.it.nameAr}{!r.it.barcode && <span className="hint" style={{ display: 'block', margin: 0 }}>من غير باركود دولي: هيتطبع كوده</span>}</td><td>{r.it.unit}</td>
          <td className="n"><input className="num" style={{ width: 80 }} inputMode="numeric" value={r.copies} onChange={e => upd(i, { copies: e.target.value.replace(/[^\d]/g, '') })} aria-label={`عدد باركود ${r.it.nameAr}`} /></td>
          <td><select value={r.expiry} onChange={e => upd(i, { expiry: e.target.value })} aria-label={`صلاحية ${r.it.nameAr}`}>{r.it.batches.map(b => <option key={b.expiry} value={b.expiry}>{mmYyyy(b.expiry)} ({b.qty})</option>)}<option value="">بدون</option></select></td>
          <td className="n">{r.it.stock}</td>
          <td className="n"><input className="num" style={{ width: 96 }} inputMode="decimal" value={r.price} onChange={e => upd(i, { price: e.target.value })} aria-label={`سعر ${r.it.nameAr}`} /></td>
          <td><button className="fbtn x" aria-label={`شيل ${r.it.nameAr}`} onClick={e => { e.stopPropagation(); del(i); }}><Icon n="x" /></button></td></tr>))}</tbody></table></div>
    <div className="bc-foot">
      <button className="btn" onClick={() => window.dispatchEvent(new Event('op-focus-search'))}><Icon n="plus" />إضافة صنف</button>
      <button className="btn" disabled={sel === null} onClick={() => del(sel)}><Icon n="trash" />حذف صنف</button>
      <button className="btn primary" disabled={!rows.length || busy} onClick={() => setAsk({ ...style })}><Icon n="print" />طباعة باركود (F9)</button>
      <span className="bc-count">عدد الباركود <b>{total}</b></span>
    </div>
    {ask && (<><div className="drawer-bg" onClick={() => setAsk(null)} />
      <div className="card askbox bc-ask" role="dialog" aria-label="هل تريد طباعة الباركود؟">
        <b>هل تريد طباعة الباركود؟</b>
        <div className="bc-ask-body">
          <div style={{ display: 'grid', gap: 8 }}>
            {([['pharmacy', 'طباعة اسم الصيدلية'], ['phone', 'طباعة التليفون'], ['price', 'طباعة سعر البيع'], ['expiry', 'طباعة تاريخ الصلاحية']] as const).map(([k, l]) => <label key={k} className="chk"><input type="checkbox" checked={ask[k]} onChange={e => setAsk({ ...ask, [k]: e.target.checked })} /> {l}</label>)}
            <span className="hint" style={{ margin: 0 }}>{total} باركود لـ {rows.length} صنف</span>
          </div>
          {preview && <img src={preview} alt="شكل الباركود" className="bc-preview" />}
        </div>
        <div className="actions"><button className="btn primary" autoFocus disabled={busy} onClick={() => void doPrint(ask)}>طباعة</button><button className="btn ghost" onClick={() => setAsk(null)}>عدم الطباعة</button></div>
      </div></>)}
  </div>);
}

/* ================= إعدادات طباعة الباركود ================= */
const SIZES: [number, number][] = [[38, 25], [40, 25], [40, 30], [50, 25], [50, 30], [58, 40]];
type LStyle = { showPharmacy: boolean; pharmacyName: string; showPhone: boolean; phone: string; showPrice: boolean; showExpiry: boolean };
export function LabelSettingsScreen() {
  const { toast } = useApp(); const pl = usePrinterList(); const [st, setSt] = useState<LStyle | null>(null); const [org, setOrg] = useState({ name: '', phone: '' }); const [idx, setIdx] = useState(0); const [err, setErr] = useState('');
  useEffect(() => { api<{ style: LStyle; pharmacy: { name: string; phone: string } }>('/api/settings/label-style').then(r => { setSt(r.style); setOrg(r.pharmacy); }, e => setErr(arabic(e))); }, []);
  const labels = (pl.list ?? []).map((p, i) => ({ p, i })).filter(x => x.p.kind === 'label'); const cur = labels[idx] ?? labels[0];
  const setP = (p: PrinterCfg) => pl.setList(l => (l ? l.map((x, i) => (i === cur!.i ? p : x)) : l));
  const addPrinter = () => pl.setList(l => [...(l ?? []), { name: 'الباركود', kind: 'label', labelMm: [38, 25], gapMm: 2, density: 8, speed: 4, offsetX: 0, offsetY: 0, language: 'tspl', transport: { type: 'device' } }]);
  const preview = usePreview('/api/print/label-preview', st ? { mm: cur?.p.labelMm ?? [38, 25], style: st } : null, !!st);
  const save = async () => { setErr(''); try { if (st) await api('/api/settings/label-style', { body: st }); if (pl.list) await pl.save(pl.list); toast('اتحفظت إعدادات طباعة الباركود'); } catch (e) { setErr(arabic(e)); } };
  if (!st || !pl.list) return <p className="muted">{err || 'بيحمّل...'}</p>;
  const p = cur?.p; const mm = p?.labelMm ?? [38, 25]; const preset = SIZES.some(s => s[0] === mm[0] && s[1] === mm[1]) ? `${mm[0]}x${mm[1]}` : 'custom';
  return (<div className="set2">
    <div className="set2-form">
      <h2><Icon n="barcode" />إعدادات طباعة الباركود</h2>
      <div className="card set-band"><label className="chk"><input type="radio" checked={!!p} onChange={() => { if (!p) addPrinter(); }} /> طباعة على طابعة حراري</label><label className="chk muted"><input type="radio" disabled /> طباعة على ورق A4 (بعدين)</label></div>
      {!p ? <div className="card"><p>مفيش طابعة باركود.</p><button className="btn primary" onClick={addPrinter}>أضف طابعة الباركود</button></div> : (<>
        <div className="card formgrid">
          {labels.length > 1 && <label>الطابعة<select value={idx} onChange={e => setIdx(Number(e.target.value))}>{labels.map((x, k) => <option key={x.i} value={k}>{x.p.name}</option>)}</select></label>}
          <label>اسمها في البرنامج<input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></label>
          <Connection p={p} set={setP} win={pl.win} kind="label" />
          <label>مقاس الاستيكر (مم)<select value={preset} onChange={e => { if (e.target.value !== 'custom') { const [w, h] = e.target.value.split('x').map(Number); setP({ ...p, labelMm: [w!, h!] }); } }}>{SIZES.map(s => <option key={`${s[0]}x${s[1]}`} value={`${s[0]}x${s[1]}`}>{s[0]} × {s[1]}</option>)}<option value="custom">مقاس تاني</option></select></label>
          {preset === 'custom' && <><label>العرض (مم)<input className="num" inputMode="numeric" value={mm[0]} onChange={e => setP({ ...p, labelMm: [Number(e.target.value) || 0, mm[1]] })} /></label><label>الطول (مم)<input className="num" inputMode="numeric" value={mm[1]} onChange={e => setP({ ...p, labelMm: [mm[0], Number(e.target.value) || 0] })} /></label></>}
          <label>المسافة بين الاستيكرات (مم)<input className="num" inputMode="numeric" value={p.gapMm ?? 2} onChange={e => setP({ ...p, gapMm: Number(e.target.value) || 0 })} /></label>
          <label>غمق الطباعة (0 - 15)<input type="range" min={0} max={15} value={p.density ?? 8} onChange={e => setP({ ...p, density: Number(e.target.value) })} /></label>
          <label>السرعة (1 - 6)<input type="range" min={1} max={6} value={p.speed ?? 4} onChange={e => setP({ ...p, speed: Number(e.target.value) })} /></label>
          <label>إزاحة يمين/شمال (نقطة)<input className="num" inputMode="numeric" value={p.offsetX ?? 0} onChange={e => setP({ ...p, offsetX: Number(e.target.value) || 0 })} /></label>
          <label>إزاحة فوق/تحت (نقطة)<input className="num" inputMode="numeric" value={p.offsetY ?? 0} onChange={e => setP({ ...p, offsetY: Number(e.target.value) || 0 })} /></label>
          <label>لغة الطابعة<select value={p.language ?? 'tspl'} onChange={e => setP({ ...p, language: e.target.value as 'tspl' })}><option value="tspl">TSPL (Xprinter وTSC)</option><option value="zpl">ZPL (Zebra)</option></select></label>
          <label className="chk"><input type="checkbox" checked={!!p.invert} onChange={e => setP({ ...p, invert: e.target.checked })} /> الطباعة طالعة معكوسة (أبيض في أسود)</label>
        </div>
        <div className="card formgrid">
          <label className="chk"><input type="checkbox" checked={st.showPharmacy} onChange={e => setSt({ ...st, showPharmacy: e.target.checked })} /> طباعة اسم المؤسسة</label>
          <label>اسم المؤسسة<input value={st.pharmacyName} placeholder={org.name} onChange={e => setSt({ ...st, pharmacyName: e.target.value })} /></label>
          <label className="chk"><input type="checkbox" checked={st.showPhone} onChange={e => setSt({ ...st, showPhone: e.target.checked })} /> طباعة رقم التليفون</label>
          <label>رقم التليفون<input dir="ltr" value={st.phone} placeholder={org.phone} onChange={e => setSt({ ...st, phone: e.target.value })} /></label>
          <label className="chk"><input type="checkbox" checked={st.showPrice} onChange={e => setSt({ ...st, showPrice: e.target.checked })} /> طباعة سعر البيع</label>
          <label className="chk"><input type="checkbox" checked={st.showExpiry} onChange={e => setSt({ ...st, showExpiry: e.target.checked })} /> طباعة تاريخ الصلاحية</label>
        </div>
      </>)}
      {err && <p className="err">{err}</p>}
      <div className="actions"><button className="btn primary" onClick={() => void save()}>حفظ</button></div>
    </div>
    <div className="set2-preview"><b>شكل الاستيكر</b>{preview ? <img src={preview} alt="شكل الاستيكر" className="lab-prev" /> : <span className="muted">بيجهّز...</span>}<span className="hint">{mm[0]} × {mm[1]} مم - الأبيض حوالين الصورة هو حرف الاستيكر</span></div>
  </div>);
}

/* ================= إعدادات طباعة فاتورة البيع ================= */
type RStyle = { template?: 'table' | 'compact'; header?: string; footer?: string; returnPolicy?: string; showExpiry?: boolean; showBatch?: boolean; printCustomer?: boolean; printSeller?: boolean; askBeforePrint?: boolean; minPrintMinor?: number; copies?: number; sideMarginMm?: number };
export function ReceiptSettingsScreen() {
  const { toast, go } = useApp(); const pl = usePrinterList(); const [st, setSt] = useState<RStyle | null>(null); const [org, setOrg] = useState<{ name: string; phones: string; taxRegNo: string; commercialRegNo: string } | null>(null); const [idx, setIdx] = useState(0); const [err, setErr] = useState(''); const [min, setMin] = useState('');
  useEffect(() => { api<{ style: RStyle }>('/api/settings/receipt-style').then(r => { setSt(r.style); setMin(r.style.minPrintMinor ? egp(r.style.minPrintMinor) : ''); }, e => setErr(arabic(e))); api<{ name: string; phones: string; taxRegNo: string; commercialRegNo: string }>('/api/settings/pharmacy').then(setOrg, () => undefined); }, []);
  const recs = (pl.list ?? []).map((p, i) => ({ p, i })).filter(x => x.p.kind === 'receipt'); const cur = recs[idx] ?? recs[0];
  const setP = (p: PrinterCfg) => pl.setList(l => (l ? l.map((x, i) => (i === cur!.i ? p : x)) : l));
  const preview = usePreview('/api/print/receipt-sample', st ? { style: st, width: cur?.p.paperWidthMm === 58 ? 58 : 80 } : null, !!st);
  const set = (p: Partial<RStyle>) => setSt(s => (s ? { ...s, ...p } : s));
  const save = async () => { setErr(''); try { await api('/api/settings/receipt-style', { body: { ...st, minPrintMinor: min.trim() ? toMinor(min) ?? 0 : 0 } }); if (pl.list) await pl.save(pl.list); toast('اتحفظت إعدادات طباعة فاتورة البيع'); } catch (e) { setErr(arabic(e)); } };
  if (!st || !pl.list) return <p className="muted">{err || 'بيحمّل...'}</p>;
  const p = cur?.p;
  return (<div className="set2">
    <div className="set2-form">
      <h2><Icon n="print" />إعدادات طباعة فاتورة البيع</h2>
      <div className="card formgrid">
        <label>شكل الفاتورة<select value={st.template ?? 'table'} onChange={e => set({ template: e.target.value as 'table' })}><option value="table">جدول (زي eStock)</option><option value="compact">مختصر</option></select></label>
        <label>مقدمة الفاتورة<input value={st.header ?? ''} onChange={e => set({ header: e.target.value })} placeholder="الصحة خير من الرزق" /></label>
        <label>نهاية الفاتورة<input value={st.footer ?? ''} onChange={e => set({ footer: e.target.value })} placeholder="نتمنى لكم الشفاء العاجل" /></label>
        <label>سياسة الاستبدال والاسترجاع<input value={st.returnPolicy ?? ''} onChange={e => set({ returnPolicy: e.target.value })} placeholder="الاستبدال والاسترجاع خلال 14 يوما ..." /></label>
      </div>
      {org && <div className="card org-mini"><span>إسم المؤسسة: <b>{org.name}</b></span><span>رقم التليفون: <b dir="ltr">{org.phones || '-'}</b></span><span>السجل الضريبي: <b dir="ltr">{org.taxRegNo || '-'}</b></span><span>السجل التجاري: <b dir="ltr">{org.commercialRegNo || '-'}</b></span><button className="linkbtn" onClick={() => go('org')}>عدّلهم من بيانات المؤسسة</button></div>}
      <div className="card formgrid">
        <label className="chk"><input type="checkbox" checked={st.printCustomer !== false} onChange={e => set({ printCustomer: e.target.checked })} /> طباعة اسم العميل</label>
        <label className="chk"><input type="checkbox" checked={st.printSeller !== false} onChange={e => set({ printSeller: e.target.checked })} /> طباعة اسم البائع</label>
        <label className="chk"><input type="checkbox" checked={!!st.askBeforePrint} onChange={e => set({ askBeforePrint: e.target.checked })} /> سؤال عند كل طباعة</label>
        <label className="chk"><input type="checkbox" checked={st.showExpiry !== false} onChange={e => set({ showExpiry: e.target.checked })} /> طباعة الصلاحية</label>
        <label className="chk"><input type="checkbox" checked={!!st.showBatch} onChange={e => set({ showBatch: e.target.checked })} /> طباعة رقم التشغيلة</label>
        <label>أقل قيمة للفاتورة لطباعتها (ج)<input className="num" inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} placeholder="0" /></label>
        <label>عدد النسخ المطبوعة<input type="number" min={1} max={5} value={st.copies ?? 1} onChange={e => set({ copies: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} /></label>
        <label>هامش الجنب (مم)<input type="number" min={0} max={8} value={st.sideMarginMm ?? 1} onChange={e => set({ sideMarginMm: Math.min(8, Math.max(0, Number(e.target.value) || 0)) })} /></label>
      </div>
      {p ? <div className="card formgrid">
        {recs.length > 1 && <label>الطابعة<select value={idx} onChange={e => setIdx(Number(e.target.value))}>{recs.map((x, k) => <option key={x.i} value={k}>{x.p.name}</option>)}</select></label>}
        <label>اسمها في البرنامج<input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></label>
        <Connection p={p} set={setP} win={pl.win} kind="receipt" />
        <label>عرض الورق<select value={p.paperWidthMm ?? 80} onChange={e => setP({ ...p, paperWidthMm: Number(e.target.value) as 80 })}><option value={80}>80 مم</option><option value={58}>58 مم</option></select></label>
        <label className="chk"><input type="checkbox" checked={p.drawerOnCash !== false} onChange={e => setP({ ...p, drawerOnCash: e.target.checked })} /> افتح الدرج مع الكاش</label>
      </div> : <div className="card"><p>مفيش طابعة فاتورة.</p><button className="btn primary" onClick={() => pl.setList(l => [...(l ?? []), { name: 'الكاشير', kind: 'receipt', paperWidthMm: 80, drawerOnCash: true, transport: { type: 'device' } }])}>أضف طابعة الفاتورة</button></div>}
      {err && <p className="err">{err}</p>}
      <div className="actions"><button className="btn primary" onClick={() => void save()}>حفظ</button></div>
    </div>
    <div className="set2-preview"><b>شكل الفاتورة</b>{preview ? <img src={preview} alt="شكل الفاتورة" className="rc-prev" /> : <span className="muted">بيجهّز...</span>}<span className="hint">فاتورة تجريبية بالإعدادات اللي قدامك، قبل الحفظ.</span></div>
  </div>);
}

/* ================= نسخ احتياطية دورية ================= */
type Sched = { hour: number; keep: number; copyDir: string; lastCopy: { at: string; ok: boolean; error?: string } | null };
const hourText = (h: number) => `${h === 0 ? 12 : h > 12 ? h - 12 : h} ${h < 5 ? 'بعد نص الليل' : h < 12 ? 'الصبح' : h < 17 ? 'الضهر' : 'بالليل'}`;
export function BackupScheduleScreen() {
  const { toast } = useApp(); const [s, setS] = useState<Sched | null>(null); const [dir, setDir] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ schedule: Sched; backupDir: string | null }>('/api/system/backup-schedule').then(r => { setS(r.schedule); setDir(r.backupDir ?? ''); }, e => setErr(arabic(e))); }, []);
  const save = async () => { if (!s) return; setBusy(true); setErr(''); try { const r = await api<{ schedule: Sched }>('/api/system/backup-schedule', { body: { hour: s.hour, keep: s.keep, copyDir: s.copyDir } }); setS(r.schedule); toast('اتحفظت مواعيد النسخ الاحتياطية'); } catch (e) { setErr(arabic(e)); } finally { setBusy(false); } };
  if (!s) return <p className="muted">{err || 'بيحمّل...'}</p>;
  return (<div style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
    <h2><Icon n="clock" />نسخ احتياطية دورية</h2>
    <p className="hint" style={{ marginTop: 0 }}>البرنامج بياخد نسخة كاملة من البيانات كل يوم لوحده. لو الجهاز كان مقفول في الميعاد، بياخدها أول ما يشتغل.</p>
    <div className="card formgrid">
      <label>ميعاد النسخة اليومية<select value={s.hour} onChange={e => setS({ ...s, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourText(h)}</option>)}</select></label>
      <label>عدد النسخ اليومية اللي تتحفظ<input type="number" min={3} max={90} value={s.keep} onChange={e => setS({ ...s, keep: Number(e.target.value) || 14 })} /></label>
      <label style={{ gridColumn: '1 / -1' }}>فولدر تاني (فلاشة أو هارد تاني) بتتنسخ عليه كل نسخة<input dir="ltr" value={s.copyDir} onChange={e => setS({ ...s, copyDir: e.target.value })} placeholder="E:\O-Pharmacy-backups" /></label>
    </div>
    {s.copyDir && s.lastCopy && <div className={`card ${s.lastCopy.ok ? '' : 'warnbox'}`}>{s.lastCopy.ok ? 'آخر نسخة اتنسخت على الفولدر التاني بنجاح.' : `آخر نسخة مااتنسختش على الفولدر التاني: ${s.lastCopy.error ?? ''}`}</div>}
    {dir && <p className="hint">النسخ الأساسية في: <span className="code">{dir}</span></p>}
    {err && <p className="err">{err}</p>}
    <div><button className="btn primary" disabled={busy} onClick={() => void save()}>حفظ</button></div>
  </div>);
}

/* ================= إصدار فاتورة ورقية للتعاقد (A4) ================= */
type Paper = { pharmacy: { name: string; phones?: string[]; address?: string; taxRegNo?: string; commercialRegNo?: string }; claim: { claimNo: string; saleRef: string | null; rxRef: string | null; serviceDate: string; status: string; coveragePercent: number; totalMinor: number; coveredMinor: number; copayMinor: number }; contract: { name: string; code: string }; member: { memberNo: string; name: string; phone: string | null }; lines: { lineNo: number; itemName: string; qty: number; unitPriceMinor: number; totalMinor: number; coveredMinor: number; excluded: boolean }[] };
export function ContractPaperScreen() {
  const [ref, setRef] = useState(''); const [p, setP] = useState<Paper | null>(null); const [err, setErr] = useState(''); const [printing, setPrinting] = useState(false); const inp = useRef<HTMLInputElement>(null);
  const load = async (e?: React.FormEvent) => { e?.preventDefault(); if (!ref.trim()) return; setErr(''); try { setP(await api<Paper>(`/api/claims/paper?ref=${encodeURIComponent(ref.trim())}`)); } catch (x) { setP(null); setErr((x as { code?: string }).code === 'not-found' ? 'مفيش مطالبة تأمين بالرقم ده (اكتب رقم الفاتورة أو رقم المطالبة)' : arabic(x)); } };
  useEffect(() => { if (!printing) return; const t = window.setTimeout(() => { window.print(); setPrinting(false); }, 60); return () => window.clearTimeout(t); }, [printing]);
  const doc = p && (<div className="a4">
    <div className="a4-head"><div><h1>{p.pharmacy.name}</h1>{p.pharmacy.address && <div>{p.pharmacy.address}</div>}{p.pharmacy.phones?.length ? <div dir="ltr">{p.pharmacy.phones.join(' - ')}</div> : null}</div>
      <div className="a4-title"><b>فاتورة تعاقد</b>{p.pharmacy.taxRegNo && <div>س.ض {p.pharmacy.taxRegNo}</div>}{p.pharmacy.commercialRegNo && <div>س.ت {p.pharmacy.commercialRegNo}</div>}</div></div>
    <table className="a4-info"><tbody>
      <tr><th>جهة التعاقد</th><td>{p.contract.name} ({p.contract.code})</td><th>رقم المطالبة</th><td dir="ltr">{p.claim.claimNo}</td></tr>
      <tr><th>اسم المنتفع</th><td>{p.member.name}</td><th>رقم المنتفع</th><td dir="ltr">{p.member.memberNo}</td></tr>
      <tr><th>رقم الفاتورة</th><td dir="ltr">{p.claim.saleRef ?? '-'}</td><th>التاريخ</th><td dir="ltr">{p.claim.serviceDate}</td></tr>
      {p.claim.rxRef && <tr><th>رقم الروشتة</th><td colSpan={3}>{p.claim.rxRef}</td></tr>}
    </tbody></table>
    <table className="a4-lines"><thead><tr><th>م</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>على الجهة</th></tr></thead>
      <tbody>{p.lines.map(l => <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.itemName}{l.excluded && ' (غير مغطى)'}</td><td>{l.qty}</td><td>{money(l.unitPriceMinor)}</td><td>{money(l.totalMinor)}</td><td>{money(l.coveredMinor)}</td></tr>)}</tbody></table>
    <table className="a4-tot"><tbody>
      <tr><th>الإجمالي</th><td>{money(p.claim.totalMinor)}</td></tr>
      <tr><th>نسبة التغطية</th><td>{p.claim.coveragePercent}%</td></tr>
      <tr><th>المستحق على جهة التعاقد</th><td><b>{money(p.claim.coveredMinor)}</b></td></tr>
      <tr><th>نصيب المنتفع (دفعه)</th><td>{money(p.claim.copayMinor)}</td></tr>
    </tbody></table>
    <div className="a4-sign"><div>توقيع المنتفع<span /></div><div>توقيع الصيدلي<span /></div><div>ختم الصيدلية<span /></div></div>
  </div>);
  return (<div style={{ display: 'grid', gap: 12 }}>
    <h2><Icon n="file" />إصدار فاتورة ورقية للتعاقد</h2>
    <form className="row-form" onSubmit={e => void load(e)}><input ref={inp} autoFocus dir="ltr" value={ref} onChange={e => setRef(e.target.value)} placeholder="رقم فاتورة البيع أو رقم المطالبة" aria-label="رقم فاتورة البيع أو رقم المطالبة" /><button className="btn primary">اعرض</button>{p && <button type="button" className="btn" onClick={() => setPrinting(true)}><Icon n="print" />اطبع A4</button>}</form>
    {err && <p className="err">{err}</p>}
    {doc && <div className="a4-wrap">{doc}</div>}
    {printing && doc && <div className="print-area a4-print">{doc}</div>}
  </div>);
}
