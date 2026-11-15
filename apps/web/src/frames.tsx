/* Sprint 7.11 (owner, 14 Nov 2026): open screens stay open as frames (up to 8), shown one at a time or two together,
   side by side or one above the other, with a divider to make one bigger (like a tablet's split view).
   Each frame has four controls: minimize, maximize, split, close. Nothing here is business data: the layout lives in memory only. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type RibbonCmd } from './ui';

export interface Frame { key: string; id: string; cmd?: RibbonCmd; min?: boolean; /** bumped to start the screen afresh (a held sale resumed into an open sale frame) */ epoch?: number }
export type SplitDir = 'h' | 'v';
export interface Layout { split: SplitDir | null; a: string; b: string | null; ratio: number; focus: 'a' | 'b'; max: boolean }

/** Inside a frame: is it the one in focus (keyboard shortcuts go to it) and is it on screen. */
export const FrameCtx = createContext<{ active: boolean; visible: boolean }>({ active: true, visible: true });
export const useFrame = () => useContext(FrameCtx);

export const frameKey = (id: string, cmd?: RibbonCmd) => (id === 'requests' && cmd?.id === 'shortages' ? 'requests:shortages' : id === 'soon' ? `soon:${cmd?.id ?? ''}` : id);

export function useFrames(toast: (m: string) => void) {
  const [frames, setFrames] = useState<Frame[]>([{ key: 'home', id: 'home' }]);
  const [lay, setLay] = useState<Layout>({ split: null, a: 'home', b: null, ratio: 0.5, focus: 'a', max: false });
  const mru = useRef<string[]>(['home']);
  const touch = (k: string) => { mru.current = [k, ...mru.current.filter(x => x !== k)]; };
  const focused = lay.split ? (lay.focus === 'a' ? lay.a : lay.b ?? lay.a) : lay.a;

  /** the most recent frame that is open, not minimized and not in `skip` */
  const pick = (list: Frame[], skip: string[]) => mru.current.find(k => !skip.includes(k) && list.some(f => f.key === k && !f.min)) ?? list.find(f => !f.min && !skip.includes(f.key))?.key ?? '';
  /** take frame `k` off the screen (closed or minimized): its pane closes, or the next recent frame takes its place */
  const vacate = (l: Layout, list: Frame[], k: string): Layout => {
    if (l.split && (l.a === k || l.b === k)) { const other = l.a === k ? l.b! : l.a; return { ...l, split: null, a: other, b: null, focus: 'a' }; }
    if (!l.split && l.a === k) return { ...l, a: pick(list, [k]) };
    return l;
  };
  const showIn = (l: Layout, k: string): Layout => {
    if (!l.split) return { ...l, a: k };
    if (l.a === k) return { ...l, focus: 'a' }; if (l.b === k) return { ...l, focus: 'b' };
    return l.focus === 'a' ? { ...l, a: k } : { ...l, b: k };
  };

  const ref = useRef(frames); ref.current = frames;
  const set = (next: Frame[]) => { ref.current = next; setFrames(next); };

  /* Owner, 15 Nov 2026: no limit on open screens; each screen stays open behind the one in front until it is closed, and keeps its own
     four controls (minimize, maximize, split, close). The strip of tabs is a setting. */
  const open = useCallback((id: string, cmd?: RibbonCmd, fresh = false) => {
    const real = cmd?.sprint ? 'soon' : id; const k = frameKey(real, cmd); let list = ref.current;
    if (list.some(f => f.key === k)) list = list.map(f => (f.key === k ? { ...f, min: false, cmd: cmd ?? f.cmd, epoch: fresh ? (f.epoch ?? 0) + 1 : f.epoch } : f));
    else list = [...list, { key: k, id: real, cmd }];
    set(list); setLay(x => showIn(x, k)); touch(k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const focusFrame = useCallback((k: string) => { set(ref.current.map(f => (f.key === k ? { ...f, min: false } : f))); setLay(l => showIn(l, k)); touch(k); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = useCallback((k: string) => {
    mru.current = mru.current.filter(x => x !== k); let next = ref.current.filter(f => f.key !== k); if (next.length === 0) { next = [{ key: 'home', id: 'home' }]; mru.current = ['home']; }
    set(next); setLay(l => { const v = vacate(l, next, k); return v.a ? v : { ...v, a: next.find(f => !f.min)?.key ?? '' }; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const closeAll = useCallback(() => { mru.current = ['home']; set([{ key: 'home', id: 'home' }]); setLay({ split: null, a: 'home', b: null, ratio: 0.5, focus: 'a', max: false }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const minimize = useCallback((k: string) => { const next = ref.current.map(f => (f.key === k ? { ...f, min: true } : f)); set(next); setLay(l => vacate(l, next, k)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const maximize = useCallback((k: string) => { set(ref.current.map(f => (f.key === k ? { ...f, min: false } : f))); setLay(l => (l.max && (l.split ? false : l.a === k) ? { ...l, max: false } : { ...l, split: null, a: k, b: null, focus: 'a', max: true })); touch(k); }, []);
  const split = useCallback((k: string, other: string, dir: SplitDir) => { if (k === other) return; set(ref.current.map(f => (f.key === k || f.key === other ? { ...f, min: false } : f))); setLay(l => ({ ...l, split: dir, a: k, b: other, focus: 'a', max: false, ratio: l.split ? l.ratio : 0.5 })); touch(other); touch(k); }, []);
  /** split with a screen that is not open yet: it opens in the other half */
  const splitNew = useCallback((k: string, id: string, dir: SplitDir) => {
    const nk = frameKey(id); if (nk === k) return; let list = ref.current;
    if (!list.some(f => f.key === nk)) list = [...list, { key: nk, id }];
    set(list.map(f => (f.key === nk || f.key === k ? { ...f, min: false } : f))); setLay(l => ({ ...l, split: dir, a: k, b: nk, focus: 'b', max: false, ratio: 0.5 })); touch(nk);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsplit = useCallback(() => setLay(l => ({ ...l, split: null, a: l.focus === 'a' ? l.a : l.b ?? l.a, b: null, focus: 'a' })), []);
  const swap = useCallback(() => setLay(l => (l.split && l.b ? { ...l, a: l.b, b: l.a, focus: l.focus === 'a' ? 'b' : 'a', ratio: 1 - l.ratio } : l)), []);
  const flip = useCallback(() => setLay(l => (l.split ? { ...l, split: l.split === 'h' ? 'v' : 'h' } : l)), []);
  const setRatio = useCallback((r: number) => setLay(l => ({ ...l, ratio: Math.min(0.8, Math.max(0.2, r)) })), []);
  const setFocus = useCallback((pane: 'a' | 'b') => setLay(l => { if (l.focus === pane) return l; const k = pane === 'a' ? l.a : l.b; if (k) touch(k); return { ...l, focus: pane }; }), []);
  const unmax = useCallback(() => setLay(l => ({ ...l, max: false })), []);

  return { frames, lay, focused, open, focusFrame, close, closeAll, minimize, maximize, split, splitNew, unsplit, swap, flip, setRatio, setFocus, unmax };
}
export type Frames = ReturnType<typeof useFrames>;

/** the controls of one frame: minimize, maximize (or restore), split, close */
function Controls({ f, fr, title }: { f: Frame; fr: Frames; title: string }) {
  const [pop, setPop] = useState(false); const isMax = fr.lay.max && fr.lay.a === f.key && !fr.lay.split; const inSplit = !!fr.lay.split && (fr.lay.a === f.key || fr.lay.b === f.key);
  const others = fr.frames.filter(x => x.key !== f.key);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (!pop) return; const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setPop(false); }; window.addEventListener('mousedown', off); return () => window.removeEventListener('mousedown', off); }, [pop]);
  return (
    <span className="fctl" ref={box}>
      <button className="fbtn" title="تصغير" aria-label={`تصغير ${title}`} onClick={e => { e.stopPropagation(); fr.minimize(f.key); }}><Icon n="min" /></button>
      <button className="fbtn" title={isMax ? 'رجّع الحجم' : 'تكبير'} aria-label={`${isMax ? 'رجّع حجم' : 'تكبير'} ${title}`} onClick={e => { e.stopPropagation(); fr.maximize(f.key); }}><Icon n={isMax ? 'restore' : 'max'} /></button>
      <button className={`fbtn${inSplit ? ' on' : ''}`} title="تقسيم" aria-label={`تقسيم ${title}`} aria-expanded={pop} onClick={e => { e.stopPropagation(); setPop(p => !p); }}><Icon n="splith" /></button>
      <button className="fbtn x" title="إغلاق" aria-label={`إغلاق ${title}`} onClick={e => { e.stopPropagation(); fr.close(f.key); }}><Icon n="x" /></button>
      {pop && (
        <div className="splitpop" role="menu" aria-label={`تقسيم ${title}`} onClick={e => e.stopPropagation()}>
          {inSplit ? (<>
            <button role="menuitem" onClick={() => { fr.swap(); setPop(false); }}><Icon n="swap" />بدّل المكانين</button>
            <button role="menuitem" onClick={() => { fr.flip(); setPop(false); }}><Icon n={fr.lay.split === 'h' ? 'splitv' : 'splith'} />{fr.lay.split === 'h' ? 'خليهم فوق بعض' : 'خليهم جنب بعض'}</button>
            <button role="menuitem" onClick={() => { fr.unsplit(); setPop(false); }}><Icon n="max" />إلغاء التقسيم</button>
          </>) : (<>
            {others.length > 0 && <><div className="sphead">مع شاشة مفتوحة</div>
            {others.map(o => (
              <div key={o.key} className="sprow"><span>{titleOf(o)}</span>
                <button title="جنب بعض" aria-label={`${titleOf(o)} جنب بعض`} onClick={() => { fr.split(f.key, o.key, 'h'); setPop(false); }}><Icon n="splith" /></button>
                <button title="فوق بعض" aria-label={`${titleOf(o)} فوق بعض`} onClick={() => { fr.split(f.key, o.key, 'v'); setPop(false); }}><Icon n="splitv" /></button>
              </div>
            ))}</>}
            <div className="sphead">مع شاشة جديدة</div>
            {splitChoices.filter(c => frameKey(c.id) !== f.key && !others.some(o => o.key === frameKey(c.id))).map(c => (
              <div key={c.id} className="sprow"><span>{c.label}</span>
                <button title="جنب بعض" aria-label={`${c.label} جنب بعض`} onClick={() => { fr.splitNew(f.key, c.id, 'h'); setPop(false); }}><Icon n="splith" /></button>
                <button title="فوق بعض" aria-label={`${c.label} فوق بعض`} onClick={() => { fr.splitNew(f.key, c.id, 'v'); setPop(false); }}><Icon n="splitv" /></button>
              </div>
            ))}
          </>)}
        </div>
      )}
    </span>
  );
}

/* titles come from the Shell (it knows the Ribbon); set once per render */
let titleOf: (f: Frame) => string = f => f.cmd?.label || f.id;
let iconOf: (f: Frame) => string = f => f.cmd?.icon || 'file';
let splitChoices: { id: string; label: string }[] = [];
export function setFrameNames(t: (f: Frame) => string, i: (f: Frame) => string, choices: { id: string; label: string }[] = []) { titleOf = t; iconOf = i; splitChoices = choices; }
export const frameTitle = (f: Frame) => titleOf(f);

/** the strip of open frames under the Ribbon */
export function FrameTabs({ fr }: { fr: Frames }) {
  const shown = new Set([fr.lay.a, fr.lay.split ? fr.lay.b : null].filter(Boolean) as string[]);
  return (
    <div className="ftabs" role="tablist" aria-label="الشاشات المفتوحة">
      {fr.frames.map(f => {
        const t = titleOf(f); const on = f.key === fr.focused; const vis = shown.has(f.key);
        return (
          <div key={f.key} className={`ftab${on ? ' on' : ''}${vis && !on ? ' vis' : ''}${f.min ? ' min' : ''}`}>
            <button role="tab" aria-selected={on} className="fname" onClick={() => fr.focusFrame(f.key)} title={f.min ? `${t} (متصغّرة)` : t}><Icon n={iconOf(f)} /><span>{t}</span></button>
            <Controls f={f} fr={fr} title={t} />
          </div>
        );
      })}
    </div>
  );
}

/** the "الإطارات" button in the main bar: every open frame, to go back to it or close it */
export function FramesMenu({ fr }: { fr: Frames }) {
  const [open, setOpen] = useState(false); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; window.addEventListener('mousedown', off); return () => window.removeEventListener('mousedown', off); }, [open]);
  return (
    <div className="frames" ref={box}>
      <button className="framesbtn" aria-expanded={open} aria-label={`الإطارات المفتوحة: ${fr.frames.length}`} onClick={() => setOpen(o => !o)}><Icon n="frames" /><span className="fl">الإطارات</span><span className="fcount">{fr.frames.length}</span></button>
      {open && (
        <div className="fmenu" role="menu">
          <div className="fhead">الشاشات المفتوحة - اختار واحدة ترجع لها زي ما سبتها</div>
          {fr.frames.map(f => (
            <div key={f.key} className={`frow${f.key === fr.focused ? ' on' : ''}`}>
              <button role="menuitem" className="fgo" onClick={() => { fr.focusFrame(f.key); setOpen(false); }}><Icon n={iconOf(f)} /><span><b>{titleOf(f)}</b>{f.min && <small>متصغّرة</small>}{f.key === fr.focused && <small>الشاشة اللي قدامك</small>}</span></button>
              <button className="fbtn x" aria-label={`إغلاق ${titleOf(f)}`} onClick={() => fr.close(f.key)}><Icon n="x" /></button>
            </div>
          ))}
          <div className="ffoot"><span>{fr.frames.length} شاشة مفتوحة</span><button className="linkbtn" onClick={() => { fr.closeAll(); setOpen(false); }}>اقفل الكل</button></div>
        </div>
      )}
    </div>
  );
}

/** the work area: every open frame stays mounted (so a half-typed invoice is kept); one or two are on screen */
export function WorkArea({ fr, render, headers = false }: { fr: Frames; render: (f: Frame) => ReactNode; /** each screen shows its own title bar with the four controls (when the tab strip is off) */ headers?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const [narrow, setNarrow] = useState(false);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 820)); ro.observe(el); return () => ro.disconnect(); }, []);
  const { lay } = fr; const dir: SplitDir | null = lay.split ? (narrow ? 'v' : lay.split) : null; const r = lay.ratio;
  const style = (k: string): React.CSSProperties | null => {
    if (!dir) return lay.a === k ? { inset: 0 } : null;
    const gap = 3; const pa = `calc(${r * 100}% - ${gap}px)`; const pb = `calc(${(1 - r) * 100}% - ${gap}px)`;
    if (lay.a === k) return dir === 'h' ? { top: 0, bottom: 0, right: 0, width: pa } : { left: 0, right: 0, top: 0, height: pa };
    if (lay.b === k) return dir === 'h' ? { top: 0, bottom: 0, left: 0, width: pb } : { left: 0, right: 0, bottom: 0, height: pb };
    return null;
  };
  const drag = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); const rect = el.getBoundingClientRect();
    const move = (m: PointerEvent) => fr.setRatio(dir === 'h' ? (rect.right - m.clientX) / rect.width : (m.clientY - rect.top) / rect.height);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const key = (e: React.KeyboardEvent) => { const step = e.shiftKey ? 0.1 : 0.03; const grow = dir === 'h' ? (e.key === 'ArrowRight' ? -1 : e.key === 'ArrowLeft' ? 1 : 0) : (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0); if (grow) { e.preventDefault(); fr.setRatio(r + grow * step); } };
  const empty = !lay.a;
  return (
    <div className="work" ref={ref}>
      {fr.frames.map(f => {
        const st = style(f.key); const pane: 'a' | 'b' = lay.b === f.key && dir ? 'b' : 'a'; const active = f.key === fr.focused;
        return (
          <section key={f.key} className={`frame${dir ? ' split' : ''}${active && dir ? ' focus' : ''}`} style={st ?? { display: 'none' }} aria-hidden={st ? undefined : true} aria-label={titleOf(f)} onMouseDownCapture={() => { if (dir) fr.setFocus(pane); }}>
            {(dir || headers) && st && <div className="phead"><Icon n={iconOf(f)} /><b>{titleOf(f)}</b><Controls f={f} fr={fr} title={titleOf(f)} /></div>}
            <div className="fbody" key={f.epoch ?? 0}><FrameCtx.Provider value={{ active: active && !!st, visible: !!st }}>{render(f)}</FrameCtx.Provider></div>
          </section>
        );
      })}
      {dir && (
        <div className={`divider ${dir}`} role="separator" aria-orientation={dir === 'h' ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(r * 100)} aria-valuemin={20} aria-valuemax={80} aria-label="اسحب عشان تكبّر شاشة وتصغّر التانية" tabIndex={0}
          style={dir === 'h' ? { right: `calc(${r * 100}% - 3px)` } : { top: `calc(${r * 100}% - 3px)` }} onPointerDown={drag} onDoubleClick={() => fr.setRatio(0.5)} onKeyDown={key}><span /></div>
      )}
      {empty && <div className="fempty"><p>مفيش شاشة ظاهرة. اختار شاشة من الشريط اللي فوق أو من الإطارات.</p></div>}
    </div>
  );
}

/** names and icons for frames, from the Ribbon and the side bar places */
export function useFrameNames(ribbon: { groups: { items: RibbonCmd[] }[] }[], extra: Record<string, { label: string; icon: string }>) {
  return useMemo(() => {
    const byScreen = new Map<string, RibbonCmd>(); for (const t of ribbon) for (const g of t.groups) for (const c of g.items) if (!byScreen.has(c.screen)) byScreen.set(c.screen, c);
    const title = (f: Frame) => (f.key === 'requests:shortages' ? 'النواقص' : f.cmd?.label || byScreen.get(f.id)?.label || extra[f.id]?.label || f.id);
    const icon = (f: Frame) => f.cmd?.icon || byScreen.get(f.id)?.icon || extra[f.id]?.icon || 'file';
    return { title, icon };
  }, [ribbon, extra]);
}
