/* Sprint 7.7: the side bar (quick places with live counts) and the alert strip at the bottom. Both read /api/glance. */
import { Icon, type RibbonCmd } from './ui';

export type GlanceEntry =
  | { kind: 'expiry'; itemId: string; name: string; qty: number; unit: string | null; expiry: string; expired: boolean }
  | { kind: 'shortage'; ref: string; name: string; qty: number }
  | { kind: 'ready'; ref: string; name: string; customer: string | null }
  | { kind: 'low'; itemId: string; name: string; qty: number; reorder: number };
export interface TickerSettings { enabled: boolean; expiryMonths: number; showExpiry: boolean; showShortages: boolean; showReady: boolean; showLowStock: boolean }
export interface Glance { counts: { nearExpiry?: number; shortages?: number; ready?: number; tasks?: number; held?: number }; ticker: GlanceEntry[]; settings: TickerSettings }

/* per-device conveniences (never business data): theme and the side bar width */
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: stays for this window */ } };
export type Theme = 'light' | 'dark';
export const theme = { get: (): Theme => (read('o.theme') === 'dark' ? 'dark' : 'light'), set: (t: Theme) => { write('o.theme', t); document.documentElement.dataset.theme = t; }, apply: () => { document.documentElement.dataset.theme = theme.get(); } };
export const sideNarrow = { get: () => read('o.side') === 'narrow', set: (v: boolean) => write('o.side', v ? 'narrow' : 'wide') };

type Place = { id: string; screen: string; label: string; icon: string; perms: string[]; count?: (g: Glance) => number | undefined };
const PLACES: Place[] = [
  { id: 'side-home', screen: 'home', label: 'الرئيسية', icon: 'home', perms: [] },
  { id: 'side-sale', screen: 'sale', label: 'بيع', icon: 'cart', perms: ['sale.create'] },
  { id: 'side-held', screen: 'held', label: 'معلّقة', icon: 'pause', perms: ['sale.hold'], count: g => g.counts.held },
  { id: 'side-items', screen: 'items', label: 'الأصناف', icon: 'box', perms: ['item.view'] },
  { id: 'side-expiry', screen: 'expiry', label: 'الصلاحية', icon: 'clock', perms: ['expiry.alerts.view', 'stock.view'], count: g => g.counts.nearExpiry },
  { id: 'shortages', screen: 'requests', label: 'النواقص', icon: 'list', perms: ['shortage.view'], count: g => g.counts.shortages },
  { id: 'side-requests', screen: 'requests', label: 'الطلبات', icon: 'bell', perms: ['customer_request.create'], count: g => g.counts.ready },
  { id: 'side-pinv', screen: 'pinv', label: 'المشتريات', icon: 'truck', perms: ['purchase_invoice.create'] },
  { id: 'side-customers', screen: 'customers', label: 'العملاء', icon: 'users', perms: ['customer.view'] },
  { id: 'side-tasks', screen: 'tasks', label: 'مهامي', icon: 'check', perms: ['staff_tasks.my'], count: g => g.counts.tasks },
  { id: 'side-session', screen: 'session', label: 'الدرج', icon: 'wallet', perms: ['cashier_session.open'] },
];

export function SideBar({ can, current, glance, narrow, setNarrow, go, head }: { can: (k: string) => boolean; current: string; glance: Glance | null; narrow: boolean; setNarrow: (v: boolean) => void; go: (screen: string, cmd?: RibbonCmd) => void; head?: { pharmacy: string; person: string; testMode?: boolean } }) {
  const list = PLACES.filter(p => p.perms.length === 0 || p.perms.some(can));
  return (
    <nav className={`side${narrow ? ' narrow' : ''}`} aria-label="الوصول السريع">
      {head && <div className="shead" title={`${head.pharmacy} - ${head.person}`}><b>{head.pharmacy}</b><span className="sl">{head.person}</span>{head.testMode && <span className="tests">تجربة</span>}</div>}
      {list.map(p => {
        const n = glance && p.count ? p.count(glance) : undefined; const on = current === p.id || (current === p.screen && p.id !== 'shortages');
        return (<button key={p.id} className={`sitem${on ? ' on' : ''}`} title={p.label} aria-current={on ? 'page' : undefined}
          onClick={() => go(p.screen, { id: p.id, label: p.label, icon: p.icon, key: '', screen: p.screen })}>
          <Icon n={p.icon} /><span className="sl">{p.label}</span>{n ? <span className="sdot" aria-label={`${n}`}>{n > 99 ? '99+' : n}</span> : null}
        </button>);
      })}
      <button className="sitem sfold" onClick={() => setNarrow(!narrow)} title={narrow ? 'كبّر الشريط' : 'صغّر الشريط'} aria-label={narrow ? 'كبّر الشريط' : 'صغّر الشريط'}><Icon n="side" /><span className="sl">{narrow ? 'كبّر' : 'صغّر'}</span></button>
    </nav>
  );
}

const mmYyyy = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
function entry(e: GlanceEntry): { dot: string; strong: string; rest: string; screen: string; cmd?: string } {
  switch (e.kind) {
    case 'expiry': return { dot: 'd-exp', strong: e.name, rest: `${e.qty}${e.unit ? ` ${e.unit}` : ''} - ${e.expired ? 'انتهت' : 'تنتهي'} ${mmYyyy(e.expiry)}`, screen: 'expiry' };
    case 'shortage': return { dot: 'd-short', strong: e.name, rest: `ناقص - مطلوب ${e.qty}`, screen: 'requests', cmd: 'shortages' };
    case 'ready': return { dot: 'd-ready', strong: e.ref, rest: `${e.name} جاهز${e.customer ? ` - بلّغ ${e.customer}` : ''}`, screen: 'requests' };
    case 'low': return { dot: 'd-low', strong: e.name, rest: `الرصيد ${e.qty} تحت حد الطلب ${e.reorder}`, screen: 'items' };
  }
}

export function Ticker({ glance, go }: { glance: Glance | null; go: (screen: string, cmd?: RibbonCmd) => void }) {
  if (!glance || glance.ticker.length === 0) return null;
  const items = glance.ticker.map(entry); const secs = Math.max(30, items.length * 6);
  const row = (hidden: boolean) => items.map((x, i) => (
    <button key={`${hidden ? 'b' : 'a'}${i}`} className="titem" tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined} onClick={() => go(x.screen, x.cmd ? { id: x.cmd, label: '', icon: '', key: '', screen: x.screen } : undefined)}>
      <span className={`tdot ${x.dot}`} /><b>{x.strong}</b> - {x.rest}
    </button>
  ));
  return (
    <div className="ticker" role="region" aria-label="شريط التنبيهات">
      <span className="tlabel"><Icon n="alert" />تنبيهات</span>
      <div className="tview"><div className="track" style={{ animationDuration: `${secs}s` }}>{row(false)}{row(true)}</div></div>
    </div>
  );
}
