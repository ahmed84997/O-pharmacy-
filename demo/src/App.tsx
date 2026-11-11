import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Db, Role, canSeeDeleted, isoDay } from './domain';
import { buildSeed } from './seed';
import { AR, Cmd, visItems, visTabs } from './ribbon';
import { AppCtx, Icon, ROLE_LABEL, Screen } from './ui';
import Sale from './Sale';
import Purchase from './Purchase';
import { Deleted, Invoices, Items, Shortages, Soon } from './Lists';
import { Customers, CashReceipt } from './Customers';

type Tips = null | 'tabs' | 'items';
const BOTTOM: [Screen, string, string][] = [['sale', 'فاتورة بيع', 'cart'], ['items', 'الأصناف', 'box'], ['customers', 'العملاء', 'users'], ['short', 'النواقص', 'bell']];

export default function App() {
  const [db, setDb] = useState<Db>(() => buildSeed(isoDay(new Date())));
  const [role, setRole] = useState<Role>('owner');
  const [tab, setTab] = useState('home');
  const [screen, setScreen] = useState<Screen>('sale');
  const [soonLabel, setSoonLabel] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [popup, setPopup] = useState(false);
  const [tips, setTips] = useState<Tips>(null);
  const [drawer, setDrawer] = useState(false);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState('');
  const [purchaseSeed, setPurchaseSeed] = useState<string[]>([]);
  const timer = useRef<number>();
  const tabsList = useMemo(() => visTabs(role), [role]);
  const cur = tabsList.find(t => t.id === tab) ?? tabsList[0];

  const toast = useCallback((m: string) => { setMsg(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 4200); }, []);
  const go = useCallback((s: Screen, label = '') => { setScreen(s); setSoonLabel(label); setPopup(false); setDrawer(false); setTips(null); }, []);
  const now = useCallback(() => new Date().toISOString(), []);
  const seedPurchase = useCallback((ids: string[]) => { setPurchaseSeed(ids); setScreen('purchase'); setSoonLabel(''); }, []);
  const clearPurchaseSeed = useCallback(() => setPurchaseSeed([]), []);
  const ctx = useMemo(() => ({ db, setDb, role, toast, go, now, seedPurchase, purchaseSeed, clearPurchaseSeed }), [db, role, toast, go, now, seedPurchase, purchaseSeed, clearPurchaseSeed]);

  const run = useCallback((c: Cmd) => {
    setTips(null); setPopup(false); setDrawer(false);
    if (c.screen) { setScreen(c.screen); setSoonLabel(c.screen === 'soon' ? c.label : ''); }
    if (c.cmd) window.setTimeout(() => window.dispatchEvent(new CustomEvent('op-cmd', { detail: c.cmd })), 0);
  }, []);

  const changeRole = (r: Role) => {
    setRole(r);
    const t = visTabs(r); if (!t.some(x => x.id === tab)) setTab('home');
    if ((screen === 'del' && !canSeeDeleted(r)) || (screen === 'purchase' && r === 'cashier')) setScreen('sale');
  };

  // Key tips (Alt, then a letter by physical key), Ctrl+F1 collapse, Escape
  useEffect(() => {
    let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { altAlone = true; e.preventDefault(); return; }
      altAlone = false;
      if (e.key === 'F1' && e.ctrlKey) { e.preventDefault(); setCollapsed(c => !c); setPopup(false); return; }
      if (e.key === 'Escape') { setTips(t => (t === 'items' ? 'tabs' : null)); setPopup(false); setDrawer(false); return; }
      if (tips === 'tabs') {
        const t = tabsList.find(x => x.key === e.code); if (t) { e.preventDefault(); setTab(t.id); setTips('items'); if (collapsed) setPopup(true); }
      } else if (tips === 'items') {
        for (const g of cur.groups) { const c = visItems(g, role).find(x => x.key === e.code); if (c) { e.preventDefault(); run(c); return; } }
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt' && altAlone) { setTips(t => (t ? null : 'tabs')); } altAlone = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [tips, tabsList, cur, role, run, collapsed]);

  const tip = (code: string) => (tips ? <span className="tip" aria-hidden="true">{AR[code] ?? code.replace('Key', '')}</span> : null);
  const expanded = !collapsed || popup;
  const body = (() => {
    switch (screen) {
      case 'sale': return <Sale />;
      case 'purchase': return <Purchase />;
      case 'items': return <Items />;
      case 'short': return <Shortages />;
      case 'invoices': return <Invoices />;
      case 'customers': return <Customers />;
      case 'receipt': return <CashReceipt />;
      case 'del': return canSeeDeleted(role) ? <Deleted /> : <Soon label="غير مسموح" />;
      default: return <Soon label={soonLabel} />;
    }
  })();

  return (
    <AppCtx.Provider value={ctx}>
      <div id="app">
        <header className="title">
          <button className="qbtn menu-btn" onClick={() => setDrawer(true)} aria-label="القائمة"><Icon n="menu" /></button>
          <span className="brand" dir="ltr">O <b>Pharmacy</b></span>
          <div className="qat" role="toolbar" aria-label="شريط الوصول السريع">
            <button className="qbtn" title="فاتورة بيع جديدة" onClick={() => go('sale')}><Icon n="cart" /></button>
            <button className="qbtn" title="فاتورة مشتريات" onClick={() => role !== 'cashier' && go('purchase')}><Icon n="file" /></button>
            <button className="qbtn" title="آخر الفواتير" onClick={() => go('invoices')}><Icon n="history" /></button>
            <button className="qbtn" title="اختصارات لوحة المفاتيح (Alt)" onClick={() => setTips(t => (t ? null : 'tabs'))}><Icon n="kbd" /></button>
          </div>
          <span className="demo">DEMO - نموذج تجريبي، ليس نظامًا حقيقيًا</span><span className="spacer" />
          <label className="role"><span>الدور:</span>
            <select aria-label="الدور" value={role} onChange={e => changeRole(e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map(k => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}</select></label>
        </header>
        <div className="tabs" role="tablist" aria-label="تبويبات الشريط">
          {tabsList.map(t => <button key={t.id} className="tab" role="tab" aria-selected={t.id === cur.id} onClick={() => { setTab(t.id); if (collapsed) setPopup(true); }}>{t.label}{tips === 'tabs' && tip(t.key)}</button>)}
          <button className="collapse" onClick={() => { setCollapsed(c => !c); setPopup(false); }} title="طيّ أو تثبيت الشريط (Ctrl+F1)" aria-label="طيّ أو تثبيت الشريط"><Icon n={collapsed ? 'down' : 'up'} /></button>
        </div>
        <div className="ribbon-wrap">
          {expanded && (
            <div className={`ribbon${collapsed ? ' popup' : ''}`} role="tabpanel">
              {cur.groups.map(g => (
                <div className="group" key={g.label}>
                  <div className={g.stack ? 'items stack' : 'items'}>
                    {visItems(g, role).map(c => (
                      <button key={c.id} className={`rb${c.primary ? ' primary' : ''}${g.stack ? ' small' : ''}`} onClick={() => run(c)}><Icon n={c.icon} />{c.label}{tips === 'items' && tip(c.key)}</button>
                    ))}
                  </div>
                  <div className="glabel">{g.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <main id="work">{body}</main>
        <nav className="bbar" aria-label="تنقل سريع">
          {BOTTOM.map(([s, l, ic]) => <button key={s} className={screen === s ? 'on' : ''} onClick={() => go(s)}><Icon n={ic} /><span>{l}</span></button>)}
          <button onClick={() => setDrawer(true)}><Icon n="menu" /><span>القائمة</span></button>
        </nav>
        <footer className="status">
          <span><span className={`dot${offline ? ' off' : ''}`} />{offline ? 'بدون إنترنت - البيع شغال والمزامنة مؤجلة' : 'متصل بالـ Hub والسحابة'}</span>
          <button onClick={() => setOffline(o => !o)}>{offline ? 'رجّع الاتصال' : 'جرّب قطع الإنترنت'}</button>
          <button onClick={() => { setDb(buildSeed(isoDay(new Date()))); toast('اتعمل Reset للبيانات التجريبية'); }}>Reset demo</button>
          <span>{ROLE_LABEL[role]} - فرع التجربة B1</span>
        </footer>
        {drawer && (
          <>
            <div className="drawer-bg" onClick={() => setDrawer(false)} />
            <nav className="drawer" aria-label="القائمة">
              <h3><span dir="ltr">O Pharmacy</span> <button className="qbtn" style={{ float: 'left' }} onClick={() => setDrawer(false)} aria-label="إغلاق"><Icon n="x" /></button></h3>
              {tabsList.map(t => (
                <details key={t.id} open={t.id === cur.id}><summary>{t.label}</summary>
                  {t.groups.map(g => <div key={g.label}><div className="grp">{g.label}</div>{visItems(g, role).map(c => <button key={c.id} className="rb" onClick={() => run(c)}><Icon n={c.icon} />{c.label}</button>)}</div>)}
                </details>
              ))}
            </nav>
          </>
        )}
        {msg && <div className="toast" role="status">{msg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
