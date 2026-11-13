/* Sprint 7.9: the item card as the owner listed it (12 Nov 2026): basic data (short code, several international codes, Arabic and
   English names, active ingredient), item data (maker, description, group, storage place), pricing (consumer price, discount, tax,
   cost), switches (drug, has expiry, prints a label, general shortage, name off the receipt, service without stock) and units
   (large, medium, small). The same form makes a new item and edits one. Lists it picks from: unit names, places, groups. */
import { useCallback, useEffect, useState } from 'react';
import { api, arabic } from './api';
import { invErr, int } from './inv';
import { egp, Icon, toMinor, useApp } from './ui';

type Named = { id: string; name: string; active?: boolean; items?: number };
type Card = { description: string | null; defaultPriceMinor: number | null; defaultCostMinor: number | null; defaultDiscountBp: number; taxBp: number; hasExpiry: boolean; printLabel: boolean; autoShortage: boolean; hideOnReceipt: boolean };
type Item = { id: string; code: string; nameAr: string; nameEn: string | null; kind: string; form: string | null; strength: string | null; activeIngredient: string | null; manufacturer: string | null; groupId: string | null; location: string | null; reorderLevel: number; listPriceMinor: number | null; units: { name: string; factor: number }[]; card: Card };

export function useLists() {
  const [units, setUnits] = useState<Named[]>([]); const [places, setPlaces] = useState<Named[]>([]); const [groups, setGroups] = useState<Named[]>([]);
  const reload = useCallback(() => {
    api<{ units: Named[] }>('/api/inv/unit-names').then(r => setUnits(r.units), () => setUnits([]));
    api<{ locations: Named[] }>('/api/inv/locations').then(r => setPlaces(r.locations), () => setPlaces([]));
    api<{ groups: Named[] }>('/api/inv/groups').then(r => setGroups(r.groups), () => setGroups([]));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { units, places, groups, reload };
}
const pctText = (bp: number) => (bp ? String(bp / 100) : '');
const bpOf = (v: string) => { if (!v.trim()) return 0; const n = Number(v.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))); return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : NaN; };

export function ItemForm({ id, done }: { id?: string; done: (id?: string) => void }) {
  const { can, toast, ask } = useApp(); const lists = useLists(); const editing = !!id;
  const [it, setIt] = useState<Item | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ code: '', nameAr: '', nameEn: '', activeIngredient: '', manufacturer: '', description: '', groupId: '', location: '', form: '', strength: '', reorderLevel: '', price: '', disc: '', tax: '', cost: '' });
  const [sw, setSw] = useState({ drug: true, hasExpiry: true, printLabel: true, autoShortage: false, hideOnReceipt: false, service: false });
  const [u, setU] = useState({ big: 'علبة', bigCount: '', mid: '', midCount: '', small: 'قرص' });
  const [codes, setCodes] = useState<{ barcode: string; unit: string }[]>([{ barcode: '', unit: '' }]);
  useEffect(() => { if (!id) return; api<{ item: Item }>(`/api/inv/items/${id}`).then(r => {
    const x = r.item; setIt(x);
    setF({ code: x.code, nameAr: x.nameAr, nameEn: x.nameEn ?? '', activeIngredient: x.activeIngredient ?? '', manufacturer: x.manufacturer ?? '', description: x.card.description ?? '', groupId: x.groupId ?? '', location: x.location ?? '', form: x.form ?? '', strength: x.strength ?? '', reorderLevel: x.reorderLevel ? String(x.reorderLevel) : '',
      price: (() => { const p = x.kind === 'drug' ? x.card.defaultPriceMinor : x.listPriceMinor; return p == null ? '' : egp(p); })(), disc: pctText(x.card.defaultDiscountBp), tax: pctText(x.card.taxBp), cost: x.card.defaultCostMinor == null ? '' : egp(x.card.defaultCostMinor) });
    setSw({ drug: x.kind === 'drug', service: x.kind === 'service', hasExpiry: x.card.hasExpiry, printLabel: x.card.printLabel, autoShortage: x.card.autoShortage, hideOnReceipt: x.card.hideOnReceipt });
  }, e => setErr(arabic(e))); }, [id]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(v => ({ ...v, [k]: e.target.value }));
  const flip = (k: keyof typeof sw) => (e: { target: { checked: boolean } }) => setSw(v => {
    const n = { ...v, [k]: e.target.checked };
    if (k === 'service' && e.target.checked) { n.drug = false; n.hasExpiry = false; n.autoShortage = false; }
    if (k === 'drug' && e.target.checked) { n.service = false; n.hasExpiry = true; }
    return n;
  });
  const unitNames = [u.big, u.mid, u.small].map(x => x.trim()).filter(Boolean);
  /* units: small = 1; medium = how many small inside; large = how many medium (or small) inside */
  const buildUnits = (): { name: string; factor: number }[] | string => {
    const small = u.small.trim(); if (!small) return 'اختار الوحدة الصغرى';
    const out = [{ name: small, factor: 1 }]; const mid = u.mid.trim(); const big = u.big.trim(); let midF = 1;
    if (mid) { midF = int(u.midCount); if (!(midF > 1)) return `الـ ${mid} فيها كام ${small}؟ (رقم أكبر من 1)`; out.push({ name: mid, factor: midF }); }
    if (big) { const c = int(u.bigCount); if (!(c >= 1) || (!mid && c < 2)) return `الـ ${big} فيها كام ${mid || small}؟`; const bf = c * midF; if (bf === midF) return `الـ ${big} لازم تبقى أكبر من الـ ${mid}`; out.push({ name: big, factor: bf }); }
    if (new Set(out.map(x => x.name)).size !== out.length) return 'كل وحدة لازم اسم مختلف';
    return out;
  };
  const kind = sw.service ? 'service' : sw.drug ? 'drug' : 'non_drug';
  const save = async () => {
    setErr(''); if (!f.nameAr.trim()) return setErr('اكتب اسم الصنف بالعربي');
    const price = f.price.trim() ? toMinor(f.price) : null; const cost = f.cost.trim() ? toMinor(f.cost) : null; const disc = bpOf(f.disc), tax = bpOf(f.tax);
    if ((f.price.trim() && price == null) || (f.cost.trim() && cost == null)) return setErr('الأسعار بالجنيه، مثلًا 45.50'); if (Number.isNaN(disc) || Number.isNaN(tax)) return setErr('الخصم والضريبة نسبة من 0 لـ 100');
    const canPrice = can('item.price.set');
    const card: Record<string, unknown> = { description: f.description || null, defaultCostMinor: cost, defaultDiscountBp: disc, taxBp: tax, hasExpiry: sw.hasExpiry, printLabel: sw.printLabel, autoShortage: sw.autoShortage, hideOnReceipt: sw.hideOnReceipt };
    if (canPrice && kind === 'drug') card.defaultPriceMinor = price;
    const common = { nameAr: f.nameAr.trim(), nameEn: f.nameEn || undefined, form: f.form || undefined, strength: f.strength || undefined, activeIngredient: f.activeIngredient || undefined, manufacturer: f.manufacturer || undefined, groupId: f.groupId || undefined, location: f.location || undefined, reorderLevel: f.reorderLevel ? int(f.reorderLevel) : 0, card };
    setBusy(true);
    try {
      if (editing && it) {
        const patch: Record<string, unknown> = { ...common, nameEn: f.nameEn || null, form: f.form || null, strength: f.strength || null, activeIngredient: f.activeIngredient || null, manufacturer: f.manufacturer || null, groupId: f.groupId || null, location: f.location || null };
        if (canPrice && it.kind !== 'drug') patch.listPriceMinor = price; await api(`/api/inv/items/${it.id}`, { method: 'PATCH', body: patch }); toast('اتحفظ كارت الصنف'); done(it.id);
      } else {
        const units = buildUnits(); if (typeof units === 'string') { setBusy(false); return setErr(units); }
        const barcodes = codes.filter(c => c.barcode.trim()).map(c => ({ barcode: c.barcode.trim(), unitName: c.unit || units[units.length - 1]!.name, kind: /^\d{8}$|^\d{12,14}$/.test(c.barcode.trim()) ? 'gtin' : 'internal' }));
        const r = await api<{ id: string; code: string }>('/api/inv/items', { body: { ...common, code: f.code.trim() || undefined, kind, units, barcodes, listPriceMinor: kind !== 'drug' && canPrice && price != null ? price : undefined } });
        toast(`اتضاف الصنف ${r.code}`); done(r.id);
      }
    } catch (e) { setErr(invErr(e)); } finally { setBusy(false); }
  };
  const addTo = (path: string, what: string, pick: (name: string, id: string) => void) => void ask(`اسم ${what} الجديد`).then(n => { if (n) void api<{ id: string; name: string }>(path, { body: { name: n } }).then(r => { lists.reload(); pick(r.name, r.id); toast(`اتضاف ${r.name}`); }, e => toast(invErr(e))); });
  const unitSelect = (val: string, on: (v: string) => void, optional = false) => (<div className="ifr-pick"><select value={val} onChange={e => on(e.target.value)}>{optional && <option value="">(مفيش)</option>}{lists.units.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}{val && !lists.units.some(x => x.name === val) && <option value={val}>{val}</option>}</select>{can('item.update') && <button type="button" className="btn ghost" title="وحدة جديدة" onClick={() => addTo('/api/inv/unit-names', 'الوحدة', n => on(n))}>+</button>}</div>);

  if (editing && !it) return <p>{err || 'بيحمّل...'}</p>;
  return (<div className="ifr">
    <div className="ifr-head"><h2 style={{ margin: 0 }}><Icon n={editing ? 'box' : 'plus'} />{editing ? `كارت الصنف - ${it!.nameAr}` : 'صنف جديد'}</h2>
      <div className="actions"><button className="btn primary" disabled={busy} onClick={() => void save()}>حفظ</button><button className="btn ghost" onClick={() => done()}>رجوع</button></div></div>

    <section className="card ifr-sec"><b>البيانات الأساسية</b><div className="formgrid">
      <label>الكود المختصر<input dir="ltr" value={f.code} onChange={set('code')} disabled={editing} placeholder={editing ? '' : 'فاضي = يتعمل لوحده'} /></label>
      <label>اسم الصنف بالعربي<input value={f.nameAr} onChange={set('nameAr')} /></label>
      <label>اسم الصنف بالإنجليزي<input dir="ltr" value={f.nameEn} onChange={set('nameEn')} /></label>
      <label>المادة الفعالة<input dir="auto" value={f.activeIngredient} onChange={set('activeIngredient')} /></label>
    </div>
      {!editing && <div className="ifr-codes"><span className="ifr-lbl">الأكواد الدولية (الباركود) - ينفع أكتر من كود</span>
        {codes.map((c, i) => <div key={i} className="ifr-code"><input dir="ltr" value={c.barcode} placeholder="امسح أو اكتب الكود" onChange={e => setCodes(codes.map((x, k) => (k === i ? { ...x, barcode: e.target.value } : x)))} />
          <select value={c.unit} onChange={e => setCodes(codes.map((x, k) => (k === i ? { ...x, unit: e.target.value } : x)))}><option value="">للوحدة الكبرى</option>{unitNames.map(n => <option key={n}>{n}</option>)}</select>
          {codes.length > 1 && <button type="button" className="btn ghost" onClick={() => setCodes(codes.filter((_, k) => k !== i))} aria-label="شيل الكود"><Icon n="x" /></button>}</div>)}
        <div><button type="button" className="btn ghost" onClick={() => setCodes([...codes, { barcode: '', unit: '' }])}><Icon n="plus" />كود كمان</button></div></div>}
      {editing && <p className="hint" style={{ margin: 0 }}>الكود {it!.code}. الأكواد الدولية بتتضاف من كارت الصنف (زرار "باركود جديد").</p>}
    </section>

    <section className="card ifr-sec"><b>بيانات عن الصنف</b><div className="formgrid">
      <label>الشركة المنتجة<input value={f.manufacturer} onChange={set('manufacturer')} /></label>
      <label>مجموعة الصنف<div className="ifr-pick"><select value={f.groupId} onChange={set('groupId')}><option value="">(مفيش)</option>{lists.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>{can('item.update') && <button type="button" className="btn ghost" onClick={() => addTo('/api/inv/groups', 'المجموعة', (_n, gid) => setF(v => ({ ...v, groupId: gid })))}>+</button>}</div></label>
      <label>مكان تخزين الصنف<div className="ifr-pick"><select value={f.location} onChange={set('location')}><option value="">(مفيش)</option>{lists.places.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}{f.location && !lists.places.some(p => p.name === f.location) && <option value={f.location}>{f.location}</option>}</select>{can('item.update') && <button type="button" className="btn ghost" onClick={() => addTo('/api/inv/locations', 'المكان', n => setF(v => ({ ...v, location: n })))}>+</button>}</div></label>
      <label>الشكل الدوائي<input value={f.form} onChange={set('form')} placeholder="أقراص، شراب..." /></label>
      <label>التركيز<input value={f.strength} onChange={set('strength')} placeholder="500 مجم" /></label>
      <label>حد الطلب (بالوحدة الصغرى)<input className="num" value={f.reorderLevel} onChange={set('reorderLevel')} /></label>
      <label style={{ gridColumn: '1 / -1' }}>وصف الصنف<textarea className="txt" rows={2} value={f.description} onChange={set('description')} /></label>
    </div></section>

    <section className="card ifr-sec"><b>التسعير <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>(للوحدة الكبرى{u.big && !editing ? `: ${u.big}` : ''})</span></b><div className="formgrid">
      <label>سعر المستهلك<input className="num" value={f.price} onChange={set('price')} disabled={!can('item.price.set')} title={kind === 'drug' ? 'السعر المقترح للشراء الجديد، وكل تشغيلة بسعرها' : 'سعر البيع'} /></label>
      <label>نسبة الخصم % (خصم المورد)<input className="num" value={f.disc} onChange={set('disc')} /></label>
      <label>ضريبة المبيعات %<input className="num" value={f.tax} onChange={set('tax')} placeholder="0" /></label>
      <label>سعر التكلفة<input className="num" value={f.cost} onChange={set('cost')} /></label>
    </div>{kind === 'drug' && <p className="hint" style={{ margin: 0 }}>سعر الدواء الحقيقي بييجي مع كل تشغيلة في فاتورة الشراء. السعر هنا بيتحط تلقائي في أول شراء.</p>}</section>

    <section className="card ifr-sec"><b>خيارات الصنف</b><div className="ifr-sw">
      <label className="chk"><input type="checkbox" checked={sw.drug} disabled={editing} onChange={flip('drug')} />دواء</label>
      <label className="chk"><input type="checkbox" checked={sw.hasExpiry} disabled={sw.service} onChange={flip('hasExpiry')} />له تاريخ صلاحية</label>
      <label className="chk"><input type="checkbox" checked={sw.printLabel} onChange={flip('printLabel')} />طباعة باركود</label>
      <label className="chk"><input type="checkbox" checked={sw.autoShortage} disabled={sw.service} onChange={flip('autoShortage')} />نواقص عامة (يدخل النواقص لما يخلص)</label>
      <label className="chk"><input type="checkbox" checked={sw.hideOnReceipt} onChange={flip('hideOnReceipt')} />عدم طباعة اسم الصنف في الفاتورة</label>
      <label className="chk"><input type="checkbox" checked={sw.service} disabled={editing} onChange={flip('service')} />صنف خدمي بدون رصيد</label>
    </div></section>

    <section className="card ifr-sec"><b>وحدات الصنف</b>
      {editing ? <p style={{ margin: 0 }}>{it!.units.map(x => (x.factor > 1 ? `${x.name} = ${x.factor} ${it!.units[0]!.name}` : x.name)).join(' - ')} <span className="hint">(الوحدات مبتتغيرش بعد الحفظ عشان الأرصدة. تقدر تزوّد وحدة أكبر من كارت الصنف.)</span></p>
        : <div className="ifr-units">
          <div className="ifr-unit"><span className="ifr-lbl">الوحدة الكبرى</span>{unitSelect(u.big, v => setU({ ...u, big: v }), true)}{u.big && <label>فيها كام {u.mid || u.small}<input className="num" value={u.bigCount} onChange={e => setU({ ...u, bigCount: e.target.value })} /></label>}</div>
          <div className="ifr-unit"><span className="ifr-lbl">الوحدة المتوسطة</span>{unitSelect(u.mid, v => setU({ ...u, mid: v }), true)}{u.mid && <label>فيها كام {u.small}<input className="num" value={u.midCount} onChange={e => setU({ ...u, midCount: e.target.value })} /></label>}</div>
          <div className="ifr-unit"><span className="ifr-lbl">الوحدة الصغرى</span>{unitSelect(u.small, v => setU({ ...u, small: v }))}</div>
          <p className="hint" style={{ margin: 0, gridColumn: '1 / -1' }}>مثال: علبة فيها 3 شريط، والشريط فيه 10 قرص. لو الصنف بيتباع علبة بس، سيب المتوسطة والكبرى فاضيين واختار "علبة" في الصغرى.</p>
        </div>}
    </section>
    {err && <p className="err">{err}</p>}
    <div className="actions"><button className="btn primary" disabled={busy} onClick={() => void save()}>حفظ</button><button className="btn ghost" onClick={() => done()}>رجوع</button></div>
  </div>);
}

/** Unit names, storage places (and putting items on them), groups. */
export function CatalogsScreen() {
  const { toast, can } = useApp(); const lists = useLists(); const [tab, setTab] = useState<'units' | 'places' | 'assign' | 'groups'>('units');
  const [allUnits, setAllUnits] = useState<Named[]>([]); const [allPlaces, setAllPlaces] = useState<Named[]>([]); const [name, setName] = useState('');
  const reload = useCallback(() => { api<{ units: Named[] }>('/api/inv/unit-names?all=1').then(r => setAllUnits(r.units), () => undefined); api<{ locations: Named[] }>('/api/inv/locations?all=1').then(r => setAllPlaces(r.locations), () => undefined); lists.reload(); }, [lists]);
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (path: string) => { if (!name.trim()) return; try { await api(path, { body: { name } }); setName(''); toast('اتضاف'); reload(); } catch (e) { toast(invErr(e)); } };
  const flip = async (path: string, active: boolean) => { try { await api(path, { body: { active } }); reload(); } catch (e) { toast(arabic(e)); } };
  return (<div style={{ display: 'grid', gap: 12 }}><h2><Icon n="tag" />الوحدات والأماكن والمجموعات</h2>
    <div className="tabs-inline">{([['units', 'وحدات الأصناف'], ['places', 'أماكن الأصناف'], ['assign', 'تحديد أماكن الأصناف'], ['groups', 'مجموعات الأصناف']] as const).map(([k, l]) => <button key={k} className={`btn${tab === k ? ' primary' : ' ghost'}`} onClick={() => { setTab(k); setName(''); }}>{l}</button>)}</div>
    {tab !== 'assign' && can('item.update') && <div className="card formgrid"><label>{tab === 'units' ? 'وحدة جديدة' : tab === 'places' ? 'مكان جديد (رف، درج، ثلاجة...)' : 'مجموعة جديدة'}<input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(tab === 'units' ? '/api/inv/unit-names' : tab === 'places' ? '/api/inv/locations' : '/api/inv/groups'); }} /></label><button className="btn primary" onClick={() => void add(tab === 'units' ? '/api/inv/unit-names' : tab === 'places' ? '/api/inv/locations' : '/api/inv/groups')}>إضافة</button></div>}
    {tab === 'units' && <div className="tablewrap"><table><thead><tr><th>الوحدة</th><th>الحالة</th><th></th></tr></thead><tbody>{allUnits.map(x => <tr key={x.id}><td><b>{x.name}</b></td><td>{x.active ? <span className="pill ok">شغالة</span> : <span className="pill">متوقفة</span>}</td><td>{can('item.update') && <button className="btn ghost" onClick={() => void flip(`/api/inv/unit-names/${x.id}/active`, !x.active)}>{x.active ? 'وقّفها' : 'رجّعها'}</button>}</td></tr>)}</tbody></table></div>}
    {tab === 'places' && <div className="tablewrap"><table><thead><tr><th>المكان</th><th className="n">أصناف</th><th>الحالة</th><th></th></tr></thead><tbody>{allPlaces.map(x => <tr key={x.id}><td><b>{x.name}</b></td><td className="n">{x.items ?? 0}</td><td>{x.active ? <span className="pill ok">شغال</span> : <span className="pill">متوقف</span>}</td><td>{can('item.update') && <button className="btn ghost" onClick={() => void flip(`/api/inv/locations/${x.id}/active`, !x.active)}>{x.active ? 'وقّفه' : 'رجّعه'}</button>}</td></tr>)}</tbody></table></div>}
    {tab === 'groups' && <div className="tablewrap"><table><thead><tr><th>المجموعة</th></tr></thead><tbody>{lists.groups.map(g => <tr key={g.id}><td><b>{g.name}</b></td></tr>)}{!lists.groups.length && <tr><td className="muted">مفيش مجموعات لسه</td></tr>}</tbody></table></div>}
    {tab === 'assign' && <AssignPlaces places={lists.places} />}
    <p className="hint">مفيش حاجة بتتمسح: الوحدة أو المكان اللي مش محتاجه وقّفه، وهيفضل في الأصناف القديمة.</p>
  </div>);
}

function AssignPlaces({ places }: { places: Named[] }) {
  const { toast } = useApp(); const [place, setPlace] = useState(''); const [here, setHere] = useState<{ id: string; code: string; nameAr: string }[]>([]); const [loose, setLoose] = useState<{ id: string; code: string; nameAr: string }[]>([]); const [pick, setPick] = useState<Set<string>>(new Set()); const [q, setQ] = useState(''); const [found, setFound] = useState<{ id: string; code: string; nameAr: string }[]>([]);
  const load = useCallback(() => { api<{ items: typeof loose }>('/api/inv/by-location?location=-').then(r => setLoose(r.items), () => setLoose([])); if (place) api<{ items: typeof here }>(`/api/inv/by-location?location=${encodeURIComponent(place)}`).then(r => setHere(r.items), () => setHere([])); else setHere([]); }, [place]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (q.trim().length < 2) { setFound([]); return; } const t = window.setTimeout(() => { api<{ items: typeof found }>(`/api/inv/search?q=${encodeURIComponent(q)}`).then(r => setFound(r.items), () => setFound([])); }, 180); return () => window.clearTimeout(t); }, [q]);
  const toggle = (id: string) => setPick(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const assign = async (ids: string[], to: string | null) => { if (!ids.length) return toast('اختار أصناف الأول'); if (to === '' ) return toast('اختار المكان'); try { const r = await api<{ items: number }>('/api/inv/locations/assign', { body: { itemIds: ids, location: to } }); toast(to ? `اتحط ${r.items} صنف في ${to}` : `اتشال ${r.items} صنف من المكان`); setPick(new Set()); load(); } catch (e) { toast(invErr(e)); } };
  const row = (x: { id: string; code: string; nameAr: string }) => <label key={x.id} className="chk ifr-row"><input type="checkbox" checked={pick.has(x.id)} onChange={() => toggle(x.id)} /><b>{x.nameAr}</b><span className="muted code">{x.code}</span></label>;
  return (<div className="ifr-assign">
    <div className="card" style={{ display: 'grid', gap: 10 }}><b>اختار الأصناف</b>
      <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="دوّر على صنف بالاسم أو الكود أو الباركود" style={{ width: '100%', maxWidth: 'none', margin: 0 }} />
      {found.length > 0 && <div className="ifr-list">{found.map(row)}</div>}
      <span className="ifr-lbl">أصناف ملهاش مكان ({loose.length})</span><div className="ifr-list">{loose.map(row)}{!loose.length && <span className="muted">كل الأصناف ليها مكان</span>}</div>
      <div className="actions" style={{ marginInlineStart: 0 }}><select value={place} onChange={e => setPlace(e.target.value)}><option value="">اختار المكان</option>{places.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select><button className="btn primary" onClick={() => void assign([...pick], place)}>حطهم في المكان ({pick.size})</button></div>
    </div>
    <div className="card" style={{ display: 'grid', gap: 10 }}><b>{place ? `في ${place} (${here.length})` : 'اختار مكان تشوف اللي فيه'}</b>
      <div className="ifr-list">{here.map(x => <div key={x.id} className="ifr-row"><b>{x.nameAr}</b><span className="muted code">{x.code}</span><button className="btn ghost" onClick={() => void assign([x.id], null)}>شيله</button></div>)}</div></div>
  </div>);
}
