/* Sprint 7.11: the tool bar on the left (things needed all day), the calculator and the screen lock. */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, arabic, device, token } from './api';
import { Logo } from './icons';
import { Icon, type RibbonCmd } from './ui';

type Tool = { id: string; label: string; icon: string; kbd?: string; perms: string[]; run: () => void; dot?: number };

export function ToolBar({ can, go, toast, onLock, hidden }: { can: (k: string) => boolean; go: (screen: string, cmd?: RibbonCmd) => void; toast: (m: string) => void; onLock: () => void; hidden?: boolean }) {
  const [calc, setCalc] = useState(false);
  const backup = async () => { try { await api('/api/system/backup', { body: {} }); toast('اتعملت نسخة احتياطية'); } catch (e) { toast(arabic(e)); } };
  const tools: (Tool | 'sep')[] = [
    { id: 'items', label: 'بحث سريع عن صنف', icon: 'search', kbd: 'F3', perms: ['item.view'], run: () => go('items') },
    { id: 'sale', label: 'فاتورة بيع جديدة', icon: 'cart', perms: ['sale.create'], run: () => go('sale') },
    { id: 'barcodes', label: 'طباعة باركود', icon: 'barcode', perms: ['item.view'], run: () => go('barcodes') },
    { id: 'drawer', label: 'فتح الدرج', icon: 'wallet', perms: ['sale.void'], run: () => go('drawer') },
    { id: 'calc', label: 'آلة حاسبة', icon: 'calc', perms: [], run: () => setCalc(c => !c) },
    'sep',
    { id: 'attendance', label: 'حضوري وانصرافي', icon: 'clock', perms: ['attendance.record_own'], run: () => go('attendance') },
    { id: 'alerts', label: 'التنبيهات', icon: 'bell', perms: ['notification.view'], run: () => go('alerts') },
    { id: 'lock', label: 'قفل الشاشة', icon: 'lock', perms: [], run: onLock },
    'sep',
    { id: 'backup', label: 'نسخة احتياطية سريعة', icon: 'db', perms: ['settings.security'], run: () => void backup() },
  ];
  const list = tools.filter(t => t === 'sep' || t.perms.length === 0 || t.perms.some(can));
  /* F3 opens the item search from anywhere */
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'F3' && can('item.view')) { e.preventDefault(); go('items'); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [can, go]);
  if (hidden) return null;
  return (
    <aside className="tools" aria-label="الأدوات">
      {list.map((t, i) => t === 'sep' ? <span key={`s${i}`} className="tsep" /> : (
        <button key={t.id} className={`tool${t.id === 'calc' && calc ? ' on' : ''}`} aria-label={t.label} onClick={t.run}>
          <Icon n={t.icon} /><span className="ttip" aria-hidden="true">{t.label}{t.kbd && <kbd>{t.kbd}</kbd>}</span>
        </button>
      ))}
      {calc && <Calculator close={() => setCalc(false)} />}
    </aside>
  );
}

/* ---------- calculator: + - × ÷ with the usual order, decimals, percent of the last number ---------- */
export function evaluate(expr: string): number | null {
  const t = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  const toks = t.match(/(\d+\.?\d*|\.\d+|[-+*/%])/g); if (!toks || toks.join('') !== t) return null;
  /* left to right: × and ÷ before + and −; "a + b%" adds b percent of a (200 + 10% = 220), "a × b%" takes b percent (200 × 10% = 20) */
  let sum = 0; let sign = 1; let term: number | null = null; let mul: string | null = null; let added = false;
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i]!;
    if (/^[\d.]/.test(x)) {
      let n = Number(x); if (toks[i + 1] === '%') { n = term === null && added ? (sum * n) / 100 : n / 100; i++; }
      if (term !== null && mul === null) return null; term = term === null ? n : mul === '*' ? term * n : term / n; mul = null; continue;
    }
    if (x === '+' || x === '-') { if (term === null) { if (x === '-' && i === 0) { sign = -1; continue; } return null; } if (mul) return null; sum += sign * term; sign = x === '+' ? 1 : -1; term = null; added = true; continue; }
    if (x === '*' || x === '/') { if (term === null || mul) return null; mul = x; continue; }
    return null;
  }
  if (term === null || mul) return null; const r = sum + sign * term; return Number.isFinite(r) ? Math.round(r * 1e8) / 1e8 : null;
}
function Calculator({ close }: { close: () => void }) {
  const [e, setE] = useState(''); const [last, setLast] = useState<string | null>(null); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const press = (k: string) => {
    if (k === 'C') { setE(''); setLast(null); return; } if (k === '⌫') { setE(x => x.slice(0, -1)); return; }
    if (k === '=') { const r = evaluate(e); if (r !== null) { setLast(`${e} =`); setE(String(r)); } return; }
    setE(x => (x.length < 40 ? x + k : x));
  };
  const keys = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
  const live = evaluate(e);
  return (
    <div className="calc" ref={box} tabIndex={-1} role="dialog" aria-label="آلة حاسبة" dir="ltr"
      onKeyDown={ev => { const m: Record<string, string> = { Enter: '=', '=': '=', Backspace: '⌫', Escape: '', '*': '×', '/': '÷', '-': '−', Delete: 'C' }; const k = ev.key in m ? m[ev.key]! : /^[\d.+%]$/.test(ev.key) ? ev.key : null; if (ev.key === 'Escape') { ev.preventDefault(); close(); return; } if (k) { ev.preventDefault(); ev.stopPropagation(); press(k); } }}>
      <div className="cscreen"><small>{last ?? (live !== null && /[-+*/×÷−%]/.test(e) ? `= ${live}` : '')}</small><b>{e || '0'}</b></div>
      <div className="ckeys">{keys.map(k => <button key={k} className={k === '=' ? 'eq' : /[÷×−+%]/.test(k) ? 'op' : k === 'C' || k === '⌫' ? 'fn' : ''} onClick={() => press(k)} aria-label={k === '⌫' ? 'امسح رقم' : k === 'C' ? 'امسح الكل' : k}>{k}</button>)}</div>
      <button className="cclose" onClick={close} aria-label="اقفل الآلة الحاسبة"><Icon n="x" /></button>
    </div>
  );
}

/* ---------- screen lock: the open screens stay as they are; the same person's password opens it again ---------- */
export const lockFlag = { get: () => { try { return sessionStorage.getItem('o.locked') === '1'; } catch { return false; } }, set: (v: boolean) => { try { if (v) sessionStorage.setItem('o.locked', '1'); else sessionStorage.removeItem('o.locked'); } catch { /* storage blocked: the lock lasts for this window */ } } };
export function LockScreen({ username, name, unlock, logout }: { username: string; name: string; unlock: () => void; logout: () => void }) {
  const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); const old = token.get();
    try {
      const r = await api<{ token: string }>('/api/login', { body: { username, secret: p } }); token.set(r.token); setP('');
      if (old) { const h: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${old}` }; const d = device.get(); if (d) h['x-device'] = d; void fetch('/api/logout', { method: 'POST', headers: h, body: '{}' }).catch(() => undefined); }
      unlock();
    } catch (x) { setErr(x instanceof ApiError && x.code === 'bad-credentials' ? 'كلمة السر غلط.' : arabic(x)); setP(''); } finally { setBusy(false); }
  };
  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="الشاشة مقفولة">
      <form className="lockcard" onSubmit={go}>
        <Logo size={64} orbit light />
        <b>الشاشة مقفولة</b><span>{name}</span>
        <label>كلمة السر<input type="password" dir="ltr" autoFocus required autoComplete="current-password" value={p} onChange={e => setP(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>افتح</button>
        <button type="button" className="linkbtn" onClick={logout}>خروج ودخول بحساب تاني</button>
      </form>
    </div>
  );
}
