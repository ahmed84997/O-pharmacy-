import { createContext, useContext } from 'react';
import { ICONS } from './icons';

export function Icon({ n }: { n: string }) {
  return (<svg className="i" viewBox="0 0 24 24" aria-hidden="true">{(ICONS[n] ?? ICONS.file!).split('|').map((p, i) => { if (/^c[\d.]+,/.test(p)) { const [cx, cy, r] = p.slice(1).split(','); return <circle key={i} cx={cx} cy={cy} r={r} />; } return <path key={i} d={p} />; })}</svg>);
}
/* Money comes in whole piasters; shown with Western digits and two decimals. Separators in text are "-". */
export const money = (minor: number | null | undefined) => minor == null ? '-' : (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dmyHm = (iso: string | null) => { if (!iso) return '-'; const d = new Date(iso); const p = (x: number) => String(x).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export interface RibbonCmd { id: string; label: string; icon: string; key: string; screen: string; primary?: boolean; sprint?: string }
export interface RibbonTab { id: string; label: string; key: string; groups: { label: string; items: RibbonCmd[] }[] }
export interface Me { person: { id: string; username: string; displayName: string; roles: string[]; roleNames: string[]; mustChangeSecret: boolean }; permissions: string[]; ribbon: RibbonTab[]; pharmacyName: string | null; branchId: string; version: string; testMode: boolean }
export interface Ctx { me: Me; can: (k: string) => boolean; toast: (m: string) => void; go: (screen: string, cmd?: RibbonCmd) => void; reloadMe: () => Promise<void>; ask: (label: string, o?: { secret?: boolean }) => Promise<string | null> }
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);
export const ROLE_AR: Record<string, string> = { O: 'المالك', A: 'أدمن الفرع', M: 'مدير الفرع', P: 'صيدلي', C: 'كاشير', S: 'أمين مخزن', E: 'موظف', X: 'محاسب', D: 'مندوب توصيل' };

/** An idempotency key for one action (a retry of the same action sends the same key, so nothing happens twice). Works on plain http too. */
export function newKey(): string { const b = new Uint8Array(16); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
/** "12.5", "١٢٫٥", "12,50" -> 1250 piasters; null when not a valid amount. */
export function toMinor(v: string): number | null { const t = v.trim().replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.'); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null; const [a, b = ''] = t.split('.'); return Number(a) * 100 + Number((b + '00').slice(0, 2)); }
export const egp = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toFixed(2));
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
