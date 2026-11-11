import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { AppCtx, Icon, ROLE_AR, type Me, type RibbonCmd } from './ui';
import { About, Home, Settings, Soon } from './screens';
import { DeletedScreen, ExpiryScreen, ImportScreen, ItemsScreen, OrdersScreen, PurchaseInvoiceScreen, PurchaseReturnScreen, StocktakeScreen, StoresScreen, SuppliersScreen } from './inv';
import People from './People';
import { BooksScreen, ChequesScreen, ContractsScreen, LedgerScreen, PayrollScreen, ReportsScreen } from './acc';
import { AlertsScreen, AttendanceScreen, CustomersScreen, HandoversScreen, NotifyScreen, RequestsScreen, StagesScreen, TasksScreen } from './ops';
import Devices from './Devices';
import { ClosingScreen, DeliveriesScreen, EtaScreen, HeldScreen, InvoicesScreen, ReturnsScreen, SaleScreen, SessionScreen } from './pos';

/* physical key -> Arabic letter, so Alt key tips work whichever keyboard layout is active (from the S5 prototype) */
const AR: Record<string, string> = { KeyQ: 'ض', KeyW: 'ص', KeyE: 'ث', KeyR: 'ق', KeyT: 'ف', KeyY: 'غ', KeyU: 'ع', KeyI: 'ه', KeyO: 'خ', KeyP: 'ح', KeyA: 'ش', KeyS: 'س', KeyD: 'ي', KeyF: 'ب', KeyG: 'ل', KeyH: 'ا', KeyJ: 'ت', KeyK: 'ن', KeyL: 'م', KeyZ: 'ئ', KeyX: 'ء', KeyC: 'ؤ', KeyV: 'ر', KeyB: 'لا', KeyN: 'ى', KeyM: 'ة' };
type Tips = null | 'tabs' | 'items';

export default function Shell({ me, reloadMe, logout }: { me: Me; reloadMe: () => Promise<void>; logout: () => void }) {
  const tabs = me.ribbon; const [tab, setTab] = useState(tabs[0]?.id ?? 'home'); const [screen, setScreen] = useState<{ id: string; cmd?: RibbonCmd }>({ id: 'home' });
  const [collapsed, setCollapsed] = useState(false); const [popup, setPopup] = useState(false); const [tips, setTips] = useState<Tips>(null); const [drawer, setDrawer] = useState(false);
  const [online, setOnline] = useState(true); const [askQ, setAskQ] = useState<{ label: string; secret?: boolean; done: (v: string | null) => void } | null>(null); const [askV, setAskV] = useState(''); const [msg, setMsg] = useState(''); const timer = useRef<number>();
  const cur = tabs.find(t => t.id === tab) ?? tabs[0]; const perms = useMemo(() => new Set(me.permissions), [me]);
  const toast = useCallback((m: string) => { setMsg(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 4200); }, []);
  const go = useCallback((id: string, cmd?: RibbonCmd) => { setScreen({ id: cmd?.sprint ? 'soon' : id, cmd }); setPopup(false); setDrawer(false); setTips(null); }, []);
  const run = useCallback((c: RibbonCmd) => go(c.screen, c), [go]);
  /* An in-page question instead of window.prompt (the desktop window does not show browser dialogs). */
  const ask = useCallback((label: string, o: { secret?: boolean } = {}) => new Promise<string | null>(done => { setAskV(''); setAskQ({ label, secret: o.secret, done }); }), []);
  const ctx = useMemo(() => ({ me, can: (k: string) => perms.has(k), toast, go, reloadMe, ask }), [me, perms, toast, go, reloadMe, ask]);

  useEffect(() => { const t = window.setInterval(() => { api('/api/state').then(() => setOnline(true), () => setOnline(false)); }, 30000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { altAlone = true; e.preventDefault(); return; } altAlone = false;
      if (e.key === 'F1' && e.ctrlKey) { e.preventDefault(); setCollapsed(c => !c); setPopup(false); return; }
      if (e.key === 'Escape') { setTips(t => (t === 'items' ? 'tabs' : null)); setPopup(false); setDrawer(false); return; }
      if (tips === 'tabs') { const t = tabs.find(x => x.key === e.code); if (t) { e.preventDefault(); setTab(t.id); setTips('items'); if (collapsed) setPopup(true); } }
      else if (tips === 'items' && cur) { for (const g of cur.groups) { const c = g.items.find(x => x.key === e.code); if (c) { e.preventDefault(); run(c); return; } } }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt' && altAlone) setTips(t => (t ? null : 'tabs')); altAlone = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [tips, tabs, cur, run, collapsed]);

  const tip = (code: string) => (tips ? <span className="tip" aria-hidden="true">{AR[code] ?? code.replace('Key', '')}</span> : null);
  const expanded = !collapsed || popup;
  const body = (() => { switch (screen.id) {
    case 'home': return <Home />; case 'items': return <ItemsScreen />; case 'expiry': return <ExpiryScreen />; case 'stocktake': return <StocktakeScreen />; case 'stores': return <StoresScreen />; case 'import': return <ImportScreen />; case 'pinv': return <PurchaseInvoiceScreen />; case 'po': return <OrdersScreen />; case 'pret': return <PurchaseReturnScreen />; case 'suppliers': return <SuppliersScreen />; case 'deleted': return <DeletedScreen />; case 'customers': return <CustomersScreen />; case 'requests': return <RequestsScreen />; case 'notify': return <NotifyScreen />; case 'handovers': return <HandoversScreen />; case 'stages': return <StagesScreen />; case 'tasks': return <TasksScreen />; case 'attendance': return <AttendanceScreen />; case 'alerts': return <AlertsScreen />; case 'ledger': return <LedgerScreen />; case 'cheques': return <ChequesScreen />; case 'books': return <BooksScreen />; case 'payroll': return <PayrollScreen />; case 'contracts': return <ContractsScreen />; case 'reports': return <ReportsScreen />; case 'people': return <People />; case 'devices': return <Devices />;
    case 'sale': return <SaleScreen />; case 'session': return <SessionScreen />; case 'held': return <HeldScreen />; case 'invoices': return <InvoicesScreen />; case 'returns': return <ReturnsScreen />; case 'deliveries': return <DeliveriesScreen />; case 'closing': return <ClosingScreen />; case 'eta': return <EtaScreen />;
    case 'settings': return <Settings />; case 'about': return <About />; default: return <Soon cmd={screen.cmd} />;
  } })();

  return (
    <AppCtx.Provider value={ctx}>
      <div id="app">
        <header className="title">
          <button className="qbtn menu-btn" onClick={() => setDrawer(true)} aria-label="القائمة"><Icon n="menu" /></button>
          <span className="brand" dir="ltr">O <b>Pharmacy</b></span>
          <div className="qat" role="toolbar" aria-label="شريط الوصول السريع">
            <button className="qbtn" title="الرئيسية" onClick={() => go('home')}><Icon n="store" /></button>
            {perms.has('sale.create') && <button className="qbtn" title="فاتورة بيع" onClick={() => go('sale')}><Icon n="cart" /></button>}{perms.has('item.view') && <button className="qbtn" title="الأصناف والأرصدة" onClick={() => go('items')}><Icon n="search" /></button>}
            <button className="qbtn" title="اختصارات لوحة المفاتيح (Alt)" onClick={() => setTips(t => (t ? null : 'tabs'))}><Icon n="kbd" /></button>
          </div>
          <span className="muted">{me.pharmacyName}</span>{me.testMode && <span className="tests">نسخة تجربة</span>}<span className="spacer" />
          <button className="btn ghost" onClick={logout}>خروج</button>
        </header>
        <div className="tabs" role="tablist" aria-label="تبويبات الشريط">
          {tabs.map(t => <button key={t.id} className="tab" role="tab" aria-selected={t.id === cur?.id} onClick={() => { setTab(t.id); if (collapsed) setPopup(true); }}>{t.label}{tips === 'tabs' && tip(t.key)}</button>)}
          <button className="collapse" onClick={() => { setCollapsed(c => !c); setPopup(false); }} title="طيّ أو تثبيت الشريط (Ctrl+F1)" aria-label="طيّ أو تثبيت الشريط"><Icon n={collapsed ? 'down' : 'up'} /></button>
        </div>
        <div className="ribbon-wrap">
          {expanded && cur && (
            <div className={`ribbon${collapsed ? ' popup' : ''}`} role="tabpanel">
              {cur.groups.map(g => (
                <div className="group" key={g.label}>
                  <div className="items">{g.items.map(c => <button key={c.id} className={`rb${c.primary ? ' primary' : ''}${c.sprint ? ' off' : ''}`} onClick={() => run(c)} title={c.sprint ? `قريبًا في Sprint ${c.sprint}` : c.label}><Icon n={c.icon} />{c.label}{tips === 'items' && tip(c.key)}</button>)}</div>
                  <div className="glabel">{g.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <main id="work">{body}</main>
        <footer className="status">
          <span><span className={`dot${online ? '' : ' off'}`} />{online ? 'متصل بالـ Hub' : 'مش متصل بالـ Hub'}</span>
          <span>{me.person.displayName} - {me.person.roles.map(r => ROLE_AR[r] ?? r).join(' و ')}</span>
          <span>فرع {me.branchId}</span><span className="muted">الإصدار {me.version}</span>
        </footer>
        {drawer && (<>
          <div className="drawer-bg" onClick={() => setDrawer(false)} />
          <nav className="drawer" aria-label="القائمة">
            <h3><span dir="ltr">O Pharmacy</span> <button className="qbtn" style={{ float: 'left' }} onClick={() => setDrawer(false)} aria-label="إغلاق"><Icon n="x" /></button></h3>
            {tabs.map(t => (<details key={t.id} open={t.id === cur?.id}><summary>{t.label}</summary>{t.groups.map(g => <div key={g.label}><div className="grp">{g.label}</div>{g.items.map(c => <button key={c.id} className="rb" onClick={() => run(c)}><Icon n={c.icon} />{c.label}</button>)}</div>)}</details>))}
          </nav>
        </>)}
        {askQ && (<>
          <div className="drawer-bg" onClick={() => { askQ.done(null); setAskQ(null); }} />
          <form className="card askbox" role="dialog" aria-label={askQ.label} onSubmit={e => { e.preventDefault(); const v = askV.trim(); if (!v) return; askQ.done(v); setAskQ(null); }}>
            <label>{askQ.label}<input autoFocus dir={askQ.secret ? 'ltr' : 'auto'} value={askV} onChange={e => setAskV(e.target.value)} /></label>
            <div className="actions"><button className="btn primary">تمام</button><button type="button" className="btn ghost" onClick={() => { askQ.done(null); setAskQ(null); }}>إلغاء</button></div>
          </form>
        </>)}
        {msg && <div className="toast" role="status">{msg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
