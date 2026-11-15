import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { AppCtx, Icon, ROLE_AR, type Me, type RibbonCmd } from './ui';
import { About, Home, Settings, Soon } from './screens';
import { DeletedScreen, ExpiryScreen, ImportScreen, ItemsScreen, OrdersScreen, PurchaseReturnScreen, StocktakeScreen, StoresScreen, SuppliersScreen } from './inv';
import People from './People';
import { BooksScreen, ChequesScreen, ContractsScreen, LedgerScreen, PayrollScreen, ReportsScreen } from './acc';
import { AlertsScreen, AttendanceScreen, CustomersScreen, HandoversScreen, NotifyScreen, RequestsScreen, StagesScreen, TasksScreen } from './ops';
import Devices from './Devices';
import { PurchaseInvoiceScreen } from './purchase';
import { CatalogsScreen } from './itemform';
import { Logo } from './icons';
import { SideBar, Ticker, sideNarrow, type Glance } from './chrome';
import { FrameTabs, FramesMenu, WorkArea, setFrameNames, useFrameNames, useFrames, type Frame } from './frames';
import { BackupScreen, DrawerScreen, OrgScreen } from './general';
import { LockScreen, ToolBar, lockFlag } from './tools';
import { BackupScheduleScreen, BarcodePrintScreen, ContractPaperScreen, LabelSettingsScreen, ReceiptSettingsScreen } from './printing';
import { ClosingScreen, DeliveriesScreen, EtaScreen, HeldScreen, InvoicesScreen, ReturnsScreen, SaleScreen, SessionScreen } from './pos';

/* physical key -> Arabic letter, so Alt key tips work whichever keyboard layout is active (from the S5 prototype) */
const AR: Record<string, string> = { KeyQ: 'ض', KeyW: 'ص', KeyE: 'ث', KeyR: 'ق', KeyT: 'ف', KeyY: 'غ', KeyU: 'ع', KeyI: 'ه', KeyO: 'خ', KeyP: 'ح', KeyA: 'ش', KeyS: 'س', KeyD: 'ي', KeyF: 'ب', KeyG: 'ل', KeyH: 'ا', KeyJ: 'ت', KeyK: 'ن', KeyL: 'م', KeyZ: 'ئ', KeyX: 'ء', KeyC: 'ؤ', KeyV: 'ر', KeyB: 'لا', KeyN: 'ى', KeyM: 'ة' };
type Tips = null | 'tabs' | 'items';

/* names for frames opened from the side bar or the tool bar (the Ribbon names the rest) */
const EXTRA_NAMES: Record<string, { label: string; icon: string }> = { home: { label: 'الرئيسية', icon: 'home' }, sale: { label: 'فاتورة بيع', icon: 'cart' }, held: { label: 'الفواتير المعلّقة', icon: 'pause' }, items: { label: 'الأصناف', icon: 'box' }, expiry: { label: 'الصلاحية', icon: 'clock' }, requests: { label: 'الطلبات', icon: 'bell' }, pinv: { label: 'فاتورة مشتريات', icon: 'truck' }, customers: { label: 'العملاء', icon: 'users' }, tasks: { label: 'مهامي', icon: 'check' }, session: { label: 'الدرج', icon: 'wallet' }, drawer: { label: 'فتح الدرج', icon: 'wallet' }, attendance: { label: 'الحضور', icon: 'clock' }, alerts: { label: 'التنبيهات', icon: 'bell' }, soon: { label: 'قريبًا', icon: 'clock' }, barcodes: { label: 'طباعة باركود', icon: 'barcode' }, labelset: { label: 'إعدادات الباركود', icon: 'barcode' }, rcptset: { label: 'إعدادات الفاتورة', icon: 'print' } };

/* what can open in the other half of a split (the side bar's places) */
const SPLIT_CHOICES: { id: string; label: string; perms: string[] }[] = [{ id: 'home', label: 'الرئيسية', perms: [] }, { id: 'sale', label: 'فاتورة بيع', perms: ['sale.create'] }, { id: 'items', label: 'الأصناف', perms: ['item.view'] }, { id: 'pinv', label: 'فاتورة مشتريات', perms: ['purchase_invoice.create'] }, { id: 'requests', label: 'الطلبات والنواقص', perms: ['customer_request.create', 'shortage.view'] }, { id: 'customers', label: 'العملاء', perms: ['customer.view'] }, { id: 'invoices', label: 'سجل الفواتير', perms: ['sale.view_own', 'sale.view_all'] }, { id: 'expiry', label: 'الصلاحية', perms: ['expiry.alerts.view', 'stock.view'] }];

export default function Shell({ me, reloadMe, logout }: { me: Me; reloadMe: () => Promise<void>; logout: () => void }) {
  const tabs = me.ribbon; const [tab, setTab] = useState(tabs.find(t => t.id === 'home')?.id ?? tabs[0]?.id ?? 'home');
  const [collapsed, setCollapsed] = useState(false); const [popup, setPopup] = useState(false); const [tips, setTips] = useState<Tips>(null); const [drawer, setDrawer] = useState(false);
  const [online, setOnline] = useState(true); const [readOnly, setReadOnly] = useState(false); const [askQ, setAskQ] = useState<{ label: string; secret?: boolean; done: (v: string | null) => void } | null>(null); const [askV, setAskV] = useState(''); const [msg, setMsg] = useState(''); const timer = useRef<number>();
  const [glance, setGlance] = useState<Glance | null>(null); const [narrow, setNarrowS] = useState(sideNarrow.get()); const setNarrow = (v: boolean) => { sideNarrow.set(v); setNarrowS(v); };
  const [locked, setLockedS] = useState(lockFlag.get()); const setLocked = (v: boolean) => { lockFlag.set(v); setLockedS(v); };
  const refreshGlance = useCallback(() => { api<Glance>('/api/glance').then(setGlance, () => undefined); }, []);
  const cur = tabs.find(t => t.id === tab) ?? tabs[0]; const perms = useMemo(() => new Set(me.permissions), [me]);
  const toast = useCallback((m: string) => { setMsg(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 4200); }, []);
  const fr = useFrames(toast); const names = useFrameNames(tabs, EXTRA_NAMES); setFrameNames(names.title, names.icon, SPLIT_CHOICES.filter(c => c.perms.length === 0 || c.perms.some(k => perms.has(k))));
  /* a screen handed data through sessionStorage (resume a held sale, return from a sale) starts afresh even when its frame is open */
  const go = useCallback((id: string, cmd?: RibbonCmd) => { const has = (k: string) => { try { return sessionStorage.getItem(k) !== null; } catch { return false; } }; fr.open(id, cmd, (id === 'sale' && has('o.resume')) || (id === 'returns' && has('o.returnSale'))); setPopup(false); setDrawer(false); setTips(null); }, [fr.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useCallback((c: RibbonCmd) => go(c.screen, c), [go]);
  /* An in-page question instead of window.prompt (the desktop window does not show browser dialogs). */
  const ask = useCallback((label: string, o: { secret?: boolean } = {}) => new Promise<string | null>(done => { setAskV(''); setAskQ({ label, secret: o.secret, done }); }), []);
  const ctx = useMemo(() => ({ me, can: (k: string) => perms.has(k), toast, go, reloadMe, ask, glance, refreshGlance }), [me, perms, toast, go, reloadMe, ask, glance, refreshGlance]);
  const can = useCallback((k: string) => perms.has(k), [perms]);
  /* counts and the alert strip: on every screen change and every 2 minutes */
  useEffect(() => { refreshGlance(); }, [fr.focused, refreshGlance]);
  useEffect(() => { const t = window.setInterval(refreshGlance, 120000); return () => window.clearInterval(t); }, [refreshGlance]);
  /* D39: in the desktop app, start its print agent with this device's key (prints for "device" printers come back to this PC) */
  useEffect(() => { try { const d = localStorage.getItem('o.device'); const od = (window as unknown as { oDesktop?: { agent?: (k: string) => Promise<boolean> } }).oDesktop; if (d && od?.agent) void od.agent(d); } catch { /* storage blocked: no agent */ } }, []);

  useEffect(() => { const ping = () => { api<{ readOnly?: boolean }>('/api/state').then(r => { setOnline(true); setReadOnly(!!r.readOnly); }, () => setOnline(false)); }; ping(); const t = window.setInterval(ping, 30000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (locked) return; let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { altAlone = true; e.preventDefault(); return; } altAlone = false;
      if (e.key === 'F1' && e.ctrlKey) { e.preventDefault(); setCollapsed(c => !c); setPopup(false); return; }
      if (e.key === 'Escape') { setTips(t => (t === 'items' ? 'tabs' : null)); setPopup(false); setDrawer(false); return; }
      if (tips === 'tabs') { const t = tabs.find(x => x.key === e.code); if (t) { e.preventDefault(); setTab(t.id); setTips('items'); if (collapsed) setPopup(true); } }
      else if (tips === 'items' && cur) { for (const g of cur.groups) { const c = g.items.find(x => x.key === e.code); if (c) { e.preventDefault(); run(c); return; } } }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt' && altAlone) setTips(t => (t ? null : 'tabs')); altAlone = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [tips, tabs, cur, run, collapsed, locked]);

  const tip = (code: string) => (tips ? <span className="tip" aria-hidden="true">{AR[code] ?? code.replace('Key', '')}</span> : null);
  const max = fr.lay.max; const expanded = (!collapsed || popup) && !max;
  const render = (f: Frame) => { const cmd = f.cmd; switch (f.id) {
    case 'home': return <Home />; case 'items': return <ItemsScreen />; case 'expiry': return <ExpiryScreen />; case 'catalogs': return <CatalogsScreen />; case 'stocktake': return <StocktakeScreen />; case 'stores': return <StoresScreen />; case 'import': return <ImportScreen />; case 'pinv': return <PurchaseInvoiceScreen />; case 'po': return <OrdersScreen />; case 'pret': return <PurchaseReturnScreen />; case 'suppliers': return <SuppliersScreen />; case 'deleted': return <DeletedScreen />; case 'customers': return <CustomersScreen />; case 'requests': return <RequestsScreen initial={f.key === 'requests:shortages' ? 'shortage' : undefined} />; case 'notify': return <NotifyScreen />; case 'handovers': return <HandoversScreen />; case 'stages': return <StagesScreen />; case 'tasks': return <TasksScreen />; case 'attendance': return <AttendanceScreen />; case 'alerts': return <AlertsScreen />; case 'ledger': return <LedgerScreen />; case 'cheques': return <ChequesScreen />; case 'books': return <BooksScreen />; case 'payroll': return <PayrollScreen />; case 'contracts': return <ContractsScreen />; case 'reports': return <ReportsScreen />; case 'people': return <People />; case 'devices': return <Devices />;
    case 'sale': return <SaleScreen />; case 'session': return <SessionScreen />; case 'held': return <HeldScreen />; case 'invoices': return <InvoicesScreen />; case 'returns': return <ReturnsScreen />; case 'deliveries': return <DeliveriesScreen />; case 'closing': return <ClosingScreen />; case 'eta': return <EtaScreen />;
    case 'barcodes': return <BarcodePrintScreen />; case 'labelset': return <LabelSettingsScreen />; case 'rcptset': return <ReceiptSettingsScreen />; case 'backupauto': return <BackupScheduleScreen />; case 'contractpaper': return <ContractPaperScreen />;
    case 'org': return <OrgScreen />; case 'backup': return <BackupScreen />; case 'drawer': return <DrawerScreen />;
    case 'settings': return <Settings />; case 'about': return <About />; default: return <Soon cmd={cmd} />;
  } };
  const focusedFrame = fr.frames.find(f => f.key === fr.focused);

  return (
    <AppCtx.Provider value={ctx}>
      <div id="app" className={max ? 'maxed' : undefined}>
        {!max && <SideBar can={can} current={focusedFrame?.key === 'requests:shortages' ? 'shortages' : focusedFrame?.id ?? ''} glance={glance} narrow={narrow} setNarrow={setNarrow} go={go} head={{ pharmacy: me.pharmacyName ?? '', person: `${me.person.displayName} - ${me.person.roles.map(r => ROLE_AR[r] ?? r).join(' و ')}`, testMode: me.testMode }} />}
        <div className="col">
          <div className="mainbar">
            <button className="qbtn menu-btn" onClick={() => setDrawer(true)} aria-label="القائمة"><Icon n="menu" /></button>
            <nav className="tabs" role="tablist" aria-label="القوائم">
              {tabs.map(t => <button key={t.id} className="tab" role="tab" aria-selected={t.id === cur?.id && expanded} onClick={() => { if (max) fr.unmax(); setTab(t.id); if (collapsed) setPopup(p => (t.id === cur?.id ? !p : true)); }}>{t.label}{tips === 'tabs' && tip(t.key)}</button>)}
            </nav>
            <FramesMenu fr={fr} />
            <button className="mbtn collapse" onClick={() => { setCollapsed(c => !c); setPopup(false); }} title="طيّ أو تثبيت الشريط (Ctrl+F1)" aria-label="طيّ أو تثبيت الشريط"><Icon n={collapsed ? 'down' : 'up'} /></button>
            <button className="mbtn" title="اختصارات لوحة المفاتيح (Alt)" aria-label="اختصارات لوحة المفاتيح" onClick={() => setTips(t => (t ? null : 'tabs'))}><Icon n="kbd" /></button>
            <span className="mlogo"><Logo size={30} orbit light /></span>
            <button className="mbtn" onClick={logout} title="خروج" aria-label="خروج"><Icon n="logout" /></button>
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
          {readOnly && <div className="card warnbox" role="alert" style={{ margin: 8 }}>الترخيص انتهى: البرنامج للقراءة والتقارير بس لحد ما يتجدد. البيانات كلها موجودة. (عن البرنامج ← تفعيل الترخيص)</div>}
          {me.ui?.tabs !== false && <FrameTabs fr={fr} />}
          <div className="bodyrow">
            <WorkArea fr={fr} render={render} headers={me.ui?.tabs === false} />
            <ToolBar can={can} go={go} toast={toast} onLock={() => setLocked(true)} hidden={max} />
          </div>
          <Ticker glance={glance} go={go} />
          <footer className="status">
            <span><span className={`dot${online ? '' : ' off'}`} />{online ? 'متصل بالـ Hub' : 'مش متصل بالـ Hub'}</span>
            <span>{me.person.displayName} - {me.person.roles.map(r => ROLE_AR[r] ?? r).join(' و ')}</span>
            <span className="muted">الإصدار {me.version}</span>
          </footer>
        </div>
        {drawer && (<>
          <div className="drawer-bg" onClick={() => setDrawer(false)} />
          <nav className="drawer" aria-label="القائمة">
            <h3><Logo size={24} /> <button className="qbtn" style={{ float: 'left' }} onClick={() => setDrawer(false)} aria-label="إغلاق"><Icon n="x" /></button></h3>
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
        {locked && <LockScreen username={me.person.username} name={me.person.displayName} unlock={() => setLocked(false)} logout={() => { setLocked(false); logout(); }} />}
      </div>
    </AppCtx.Provider>
  );
}
