// O Pharmacy desktop (ADR-0002, D35): a thin Electron window over the local Hub.
// Sprint 7.6: the Hub keeps running when the window closes (tray), starts with Windows, can open to the shop network,
// keeps daily backups (in the Hub) with restore here, and updates itself from a signed manifest (core update logic).
// D39: a PC is either the primary (runs the Hub with the data) or a cashier (opens the primary's Hub, starts no Hub of its own).
// Both run a small print agent: prints for "device" printers come back to this PC and go to its own Windows printer.
const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, net, ipcMain } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const os = require('node:os');
const { join } = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');

const PKG = require('./package.json');
const TEST_BUILD = PKG.testBuild === true; // Phase 7 builds: test data allowed into an empty database. Off for the pilot build.
let hub = null; let win = null; let tray = null; let quitting = false; let restarting = false;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showWindow());

const res = (...p) => (app.isPackaged ? join(process.resourcesPath, ...p) : join(__dirname, 'res', ...p));
const extra = (f) => (app.isPackaged ? join(process.resourcesPath, f) : join(__dirname, 'res', 'extra', f));
const userFile = (...p) => join(app.getPath('userData'), ...p);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(join(f, '..'), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const config = () => ({ lan: false, port: 4870, autoStart: true, ...readJson(userFile('config.json'), {}) });
const setConfig = (p) => writeJson(userFile('config.json'), { ...config(), ...p });
const dataDir = () => userFile('data');
const hasData = () => fs.existsSync(join(dataDir(), 'o-pharmacy.db'));
/** primary | cashier | null (not chosen yet). An install that already has data is the primary, as before D39. */
const mode = () => { const c = config(); if (c.mode === 'primary' || c.mode === 'cashier') return c.mode; return hasData() ? 'primary' : null; };
const URL_ = () => (mode() === 'cashier' && config().hubUrl ? config().hubUrl : `http://127.0.0.1:${config().port}`);
/** GET /api/state of a Hub: its JSON, or null. */
const state0 = (base, timeout = 1500) => new Promise(ok => { const r = http.get(`${base}/api/state`, { timeout }, x => { if (x.statusCode !== 200) { x.resume(); return ok(null); } let b = ''; x.setEncoding('utf8'); x.on('data', d => { b += d; if (b.length > 4096) r.destroy(); }); x.on('end', () => { try { const j = JSON.parse(b); ok(j && typeof j === 'object' && 'setUp' in j ? j : null); } catch { ok(null); } }); }); r.on('error', () => ok(null)); r.on('timeout', () => { r.destroy(); ok(null); }); });
const ping = async () => (await state0(URL_())) !== null;
const fromHub = (e) => String(e.senderFrame?.url ?? '').startsWith(URL_());
const fromSetup = (e) => String(e.senderFrame?.url ?? '').startsWith('file:');

// ---------------- the Hub ----------------
async function startHub() {
  if (mode() === 'cashier') return;
  if (await ping()) return;
  const logs = userFile('logs'); fs.mkdirSync(dataDir(), { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  const node = process.platform === 'win32' ? res('node', 'node.exe') : (fs.existsSync(res('node', 'node')) ? res('node', 'node') : 'node');
  const out = fs.openSync(join(logs, 'hub.log'), 'a'); const c = config();
  hub = spawn(node, [res('hub', 'hub.mjs')], { env: { ...process.env, O_DATA_DIR: dataDir(), O_WEB_DIR: res('web'), O_PORT: String(c.port), O_HOST: c.lan ? '0.0.0.0' : '127.0.0.1', ...(TEST_BUILD ? { O_TEST_MODE: '1' } : {}) }, stdio: ['ignore', out, out], windowsHide: true });
  hub.on('exit', code => { hub = null; if (!quitting && !restarting) dialog.showErrorBox('O Pharmacy', `الـ Hub وقف (كود ${code}). افتح البرنامج تاني. السجل في:\n${join(logs, 'hub.log')}`); });
  for (let i = 0; i < 100; i++) { if (await ping()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('the Hub did not start');
}
function stopHub() { return new Promise(ok => { if (!hub) return ok(); const h = hub; h.once('exit', () => ok()); h.kill(); setTimeout(ok, 8000); }); }
async function restartHub() { restarting = true; try { await stopHub(); await startHub(); } finally { restarting = false; } if (win) win.loadURL(URL_()); ensureFirewall(); }

// ---------------- firewall (primary with network access): one rule for the Hub port, asked once through Windows' own prompt ----------------
let fwAsked = false;
function ensureFirewall() {
  const c = config(); if (process.platform !== 'win32' || mode() !== 'primary' || !c.lan || c.firewallPort === c.port || fwAsked) return;
  const name = `O Pharmacy Hub ${c.port}`;
  if (spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], { windowsHide: true }).status === 0) { setConfig({ firewallPort: c.port }); return; }
  fwAsked = true; // once per start: if the owner says no, the next start asks again
  const args = `advfirewall firewall add rule name="${name}" dir=in action=allow protocol=TCP localport=${c.port} profile=any`;
  const p = spawn('powershell', ['-NoProfile', '-Command', `Start-Process netsh -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '${args}'`], { windowsHide: true, stdio: 'ignore' });
  p.on('close', () => { if (spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], { windowsHide: true }).status === 0) setConfig({ firewallPort: c.port }); });
}

// ---------------- window and tray ----------------
function showWindow() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
async function createWindow() {
  win = new BrowserWindow({ width: 1366, height: 820, minWidth: 900, minHeight: 600, title: 'O Pharmacy', backgroundColor: '#0B1120', autoHideMenuBar: true, icon: join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: join(__dirname, 'preload.cjs') } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL_()) && !url.startsWith('file:')) e.preventDefault(); });
  win.webContents.on('did-fail-load', (_e, code, _d, url, main) => { if (main && mode() === 'cashier' && String(url).startsWith(URL_()) && code !== -3) win.loadFile(join(__dirname, 'setup.html'), { query: { state: 'unreachable' } }); });
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
  win.on('close', e => { if (!quitting && mode() !== 'primary') { quitting = true; app.quit(); return; } if (!quitting) { e.preventDefault(); win.hide(); if (!config().hintShown) { tray?.displayBalloon?.({ title: 'O Pharmacy', content: 'البرنامج لسه شغال في الخلفية عشان الأجهزة التانية. للخروج نهائيًا: أيقونة البرنامج جنب الساعة ← خروج.' }); setConfig({ hintShown: true }); } } });
  win.on('closed', () => { win = null; });
  await win.loadFile(join(__dirname, 'splash.html'));
  if (!mode()) { await win.loadFile(join(__dirname, 'setup.html')); return; }
  await openMain();
}
/** The primary starts its Hub and opens it; a cashier opens the primary's Hub (or the setup page when it cannot reach it). */
async function openMain() {
  if (mode() === 'cashier') { recordHealthy(); if (await ping()) await win.loadURL(URL_()); else await win.loadFile(join(__dirname, 'setup.html'), { query: { state: 'unreachable' } }); return; }
  try { await startHub(); await win.loadURL(URL_()); recordHealthy(); ensureFirewall(); }
  catch (e) { recordFailedStart(); dialog.showErrorBox('O Pharmacy', `مش قادر أشغّل الـ Hub: ${e.message}`); }
}
function buildTray() {
  const c = config(); const img = nativeImage.createFromPath(join(__dirname, 'tray.png')).resize({ width: 16, height: 16 });
  if (!tray) { tray = new Tray(img); tray.setToolTip('O Pharmacy'); tray.on('click', showWindow); }
  if (mode() === 'cashier') {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'افتح O Pharmacy', click: showWindow },
      { type: 'separator' },
      { label: `كاشير متوصّل بـ ${String(c.hubUrl ?? '').replace(/^http:\/\//, '')}`, enabled: false },
      { label: 'تغيير الجهاز الأساسي...', click: () => { showWindow(); win?.loadFile(join(__dirname, 'setup.html'), { query: { state: 'cashier' } }); } },
      { label: 'الجهاز ده يبقى الجهاز الأساسي...', click: toPrimary },
      { label: 'يشتغل مع Windows', type: 'checkbox', checked: c.autoStart, click: (i) => { setConfig({ autoStart: i.checked }); applyAutoStart(); buildTray(); } },
      { label: 'البحث عن تحديث', click: () => checkForUpdate(true) },
      { type: 'separator' },
      { label: `الإصدار ${app.getVersion()}`, enabled: false },
      { label: 'خروج', click: () => { quitting = true; app.quit(); } },
    ]));
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'افتح O Pharmacy', click: showWindow },
    { type: 'separator' },
    { label: 'السماح لأجهزة الشبكة (كاشير تاني، موبايل)', type: 'checkbox', checked: c.lan, click: async (i) => { setConfig({ lan: i.checked }); buildTray(); await restartHub(); } },
    { label: 'يشتغل مع Windows', type: 'checkbox', checked: c.autoStart, click: (i) => { setConfig({ autoStart: i.checked }); applyAutoStart(); buildTray(); } },
    { type: 'separator' },
    { label: 'استرجاع نسخة احتياطية...', click: restoreBackup },
    { label: 'فتح فولدر البيانات والنسخ', click: () => shell.openPath(dataDir()) },
    { label: 'البحث عن تحديث', click: () => checkForUpdate(true) },
    { label: 'الجهاز ده يبقى كاشير متوصّل بجهاز تاني...', click: toCashier },
    { type: 'separator' },
    { label: `الإصدار ${app.getVersion()}`, enabled: false },
    { label: 'خروج نهائي (الأجهزة التانية هتفصل)', click: () => { quitting = true; app.quit(); } },
  ]));
}
function applyAutoStart() { if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: config().autoStart, args: mode() === 'cashier' ? [] : ['--hidden'] }); }
async function toCashier() {
  const ok = await dialog.showMessageBox({ type: 'warning', buttons: ['أيوه، يبقى كاشير', 'إلغاء'], defaultId: 1, cancelId: 1, title: 'كاشير', message: 'الجهاز ده هيبطّل يشغّل بيانات الصيدلية، والأجهزة اللي متوصّلة بيه هتفصل. البيانات اللي عليه هتفضل محفوظة زي ما هي ومش هتتمسح. متأكد؟' });
  if (ok.response !== 0) return; restarting = true; try { await stopHub(); } finally { restarting = false; }
  showWindow(); win?.loadFile(join(__dirname, 'setup.html'), { query: { state: 'cashier' } });
}
async function toPrimary() {
  const ok = await dialog.showMessageBox({ type: 'warning', buttons: ['أيوه، يبقى الأساسي', 'إلغاء'], defaultId: 1, cancelId: 1, title: 'الجهاز الأساسي', message: hasData() ? 'الجهاز ده هيرجع يشغّل البيانات اللي كانت عليه قبل كده، مش بيانات الجهاز الأساسي الحالي. متأكد؟' : 'الجهاز ده هيبدأ صيدلية جديدة فاضية، مش بيانات الجهاز الأساسي الحالي. متأكد؟' });
  if (ok.response !== 0) return; setConfig({ mode: 'primary' }); buildTray(); applyAutoStart(); showWindow(); await win?.loadFile(join(__dirname, 'splash.html')); await openMain();
}

// ---------------- the setup page (first run, or a cashier that cannot reach the primary) ----------------
/** "192.168.1.10", "192.168.1.10:4870" or a full http address -> http://host:port */
function hubAddress(a) { const s = String(a ?? '').trim().replace(/\/+$/, ''); const m = /^(?:http:\/\/)?([A-Za-z0-9.-]+)(?::(\d{2,5}))?$/.exec(s); return m ? `http://${m[1]}:${m[2] ?? 4870}` : null; }
/** Every Hub on this PC's networks (IPv4 /24 around each address, port 4870). */
async function scanHubs() {
  const mine = Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  const hosts = new Set(); for (const ip of mine) { const p = ip.split('.').slice(0, 3).join('.'); for (let i = 1; i < 255; i++) { hosts.add(`${p}.${i}`); } }
  const list = [...hosts].slice(0, 1016); const found = []; let k = 0;
  await Promise.all(Array.from({ length: 64 }, async () => { while (k < list.length) { const h = list[k++]; const st = await state0(`http://${h}:4870`, 600); if (st && st.setUp) found.push({ url: `http://${h}:4870`, pharmacyName: st.pharmacyName ?? null, version: st.version ?? null }); } }));
  return found.sort((a, b) => a.url.localeCompare(b.url));
}
ipcMain.handle('o:setup-info', (e) => (fromSetup(e) ? { mode: mode(), hubUrl: config().hubUrl ?? null, hasData: hasData(), version: app.getVersion() } : null));
ipcMain.handle('o:setup-scan', (e) => (fromSetup(e) ? scanHubs() : []));
ipcMain.handle('o:setup-probe', async (e, a) => { if (!fromSetup(e)) return { ok: false }; const url = hubAddress(a); if (!url) return { ok: false }; const st = await state0(url); return st && st.setUp ? { ok: true, url, pharmacyName: st.pharmacyName ?? null } : { ok: false }; });
ipcMain.handle('o:setup-choose', async (e, c) => {
  if (!fromSetup(e) || !c || (c.mode !== 'primary' && c.mode !== 'cashier')) return { error: 'اختيار غلط' };
  if (c.mode === 'cashier') { const url = hubAddress(c.hubUrl); const st = url ? await state0(url) : null; if (!st || !st.setUp) return { error: 'مش قادر أوصل للجهاز الأساسي على العنوان ده.' }; setConfig({ mode: 'cashier', hubUrl: url }); }
  else setConfig({ mode: 'primary' });
  buildTray(); applyAutoStart(); await win?.loadFile(join(__dirname, 'splash.html')); await openMain(); return { ok: true };
});

// ---------------- the print agent (D39): waits on the Hub for prints meant for this PC and sends them to its own printers ----------------
const agent = { key: null, running: false };
const agentCall = (method, path, body, timeout) => new Promise(ok => {
  const u = new URL(path, URL_()); const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request(u, { method, timeout, headers: { 'x-device': agent.key, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, x => { let b = ''; x.setEncoding('utf8'); x.on('data', d => { b += d; }); x.on('end', () => { if (x.statusCode !== 200) return ok({ status: x.statusCode, body: null }); try { ok({ status: 200, body: JSON.parse(b) }); } catch { ok({ status: 0, body: null }); } }); });
  r.on('error', () => ok({ status: 0, body: null })); r.on('timeout', () => { r.destroy(); ok({ status: 0, body: null }); }); if (data) r.write(data); r.end();
});
function printRaw(job) {
  return new Promise(done => {
    const kind = job.kind === 'label' ? 'label' : 'receipt'; const printer = (config().localPrinters ?? {})[kind];
    if (!printer) return done(`اختار طابعة ${kind === 'label' ? 'الستيكر' : 'الإيصال'} للجهاز ده: الإعدادات ← الطابعات ← طابعات الجهاز ده.`);
    if (process.platform !== 'win32') return done('الطباعة على طابعة الجهاز شغالة على Windows بس.');
    let dir; try { dir = fs.mkdtempSync(join(os.tmpdir(), 'opharm-')); fs.writeFileSync(join(dir, 'job.bin'), Buffer.from(String(job.bytes ?? ''), 'base64')); fs.writeFileSync(join(dir, 'send.ps1'), fs.readFileSync(join(__dirname, 'print-raw.ps1'))); } catch (e) { return done(`مقدرتش أجهّز الطباعة: ${e.message}`); }
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(dir, 'send.ps1'), printer, join(dir, 'job.bin')], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); let err = '';
    p.stderr.on('data', d => { err += String(d); }); const end = (m) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } done(m); };
    p.once('error', e => end(e.message)); p.once('close', c => end(c === 0 ? null : (err.trim().split('\n')[0] || `الطابعة ${printer} رفضت الطباعة`)));
  });
}
async function agentLoop() {
  if (agent.running) return; agent.running = true;
  try {
    while (!quitting && agent.key) {
      const r = await agentCall('GET', '/api/agent/next?wait=25', null, 35_000);
      if (r.status === 200 && r.body && r.body.id) { const error = await printRaw(r.body); await agentCall('POST', '/api/agent/result', error ? { id: r.body.id, ok: false, error } : { id: r.body.id, ok: true }, 10_000); }
      else if (r.status !== 204) await new Promise(x => setTimeout(x, r.status === 403 || r.status === 401 ? 30_000 : 5_000)); // device not approved yet, or the Hub is away
    }
  } finally { agent.running = false; }
}
ipcMain.handle('o:agent', (e, key) => { if (!fromHub(e) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{8,128}$/.test(key)) return false; agent.key = key; void agentLoop(); return true; });
ipcMain.handle('o:local-printers', async (e) => { if (!fromHub(e)) return null; let list = []; try { list = (await e.sender.getPrintersAsync()).map(p => p.name); } catch { /* none */ } const lp = config().localPrinters ?? {}; return { printers: list, receipt: lp.receipt ?? '', label: lp.label ?? '', mode: mode() }; });
ipcMain.handle('o:set-local-printers', async (e, v) => { if (!fromHub(e) || !v) return false; let list = []; try { list = (await e.sender.getPrintersAsync()).map(p => p.name); } catch { /* none */ } const pick = (x) => (typeof x === 'string' && list.includes(x) ? x : ''); setConfig({ localPrinters: { receipt: pick(v.receipt), label: pick(v.label) } }); return true; });

// ---------------- restore ----------------
async function restoreBackup() {
  const pick = await dialog.showOpenDialog({ title: 'اختار النسخة الاحتياطية', defaultPath: join(dataDir(), 'backups'), filters: [{ name: 'O Pharmacy backup', extensions: ['db'] }], properties: ['openFile'] });
  if (pick.canceled || !pick.filePaths[0]) return;
  const ok = await dialog.showMessageBox({ type: 'warning', buttons: ['استرجع', 'إلغاء'], defaultId: 1, cancelId: 1, title: 'استرجاع', message: 'البيانات الحالية هتتحفظ في نسخة جانبية، وبعدين النسخة اللي اخترتها هتبقى هي الشغالة. متأكد؟' });
  if (ok.response !== 0) return;
  restarting = true; try {
    await stopHub(); const db = join(dataDir(), 'o-pharmacy.db'); const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    for (const ext of ['', '-wal', '-shm']) { if (fs.existsSync(db + ext)) fs.renameSync(db + ext, join(dataDir(), `before-restore-${stamp}.db${ext}`)); } // nothing is deleted: the current data is kept beside
    fs.copyFileSync(pick.filePaths[0], db); await startHub();
  } catch (e) { dialog.showErrorBox('O Pharmacy', `الاسترجاع فشل: ${e.message}`); } finally { restarting = false; }
  if (win) win.loadURL(URL_()); dialog.showMessageBox({ message: 'اتسترجعت النسخة. البيانات اللي كانت قبلها محفوظة في فولدر البيانات باسم before-restore.' });
}

// ---------------- auto-update (signed manifest, SHA-256, staged rollout, rollback) ----------------
const UPDATE = readJson(extra('update.json'), {}); // { baseUrl } written by the build
const updatePub = (() => { try { return fs.readFileSync(extra('update-public.pem'), 'utf8'); } catch { return null; } })();
const core = (() => { try { return require(extra('update.cjs')); } catch { return null; } })();
const deviceId = () => { const f = userFile('device-id'); try { return fs.readFileSync(f, 'utf8'); } catch { const id = crypto.randomUUID(); fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(f, id); return id; } };
const state = () => readJson(userFile('update-state.json'), {}); const setState = (p) => writeJson(userFile('update-state.json'), { ...state(), ...p });
function recordHealthy() { const s = state(); if (s.pendingVersion === app.getVersion()) setState({ pendingVersion: null, failedStarts: 0 }); }
function recordFailedStart() { const s = state(); if (s.pendingVersion !== app.getVersion()) return; const failedStarts = (s.failedStarts || 0) + 1; setState({ failedStarts }); if (core && core.shouldRollback({ failedStarts, healthy: false }) && s.previousInstaller && fs.existsSync(s.previousInstaller)) { setState({ pendingVersion: null, failedStarts: 0, rolledBackFrom: app.getVersion() }); spawn(s.previousInstaller, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref(); quitting = true; app.quit(); } }
const fetchBuf = (url) => new Promise((ok, bad) => { const r = net.request({ url, redirect: 'follow' }); r.setHeader('Cache-Control', 'no-cache'); const chunks = []; r.on('response', res2 => { if (res2.statusCode !== 200) { bad(new Error(`HTTP ${res2.statusCode}`)); return; } res2.on('data', d => chunks.push(d)); res2.on('end', () => ok(Buffer.concat(chunks))); res2.on('error', bad); }); r.on('error', bad); r.end(); });
async function checkForUpdate(manual) {
  if (!UPDATE.baseUrl || !updatePub || !core) { if (manual) dialog.showMessageBox({ message: 'التحديث التلقائي مش متظبط في النسخة دي.' }); return; }
  try {
    const token = (await fetchBuf(`${UPDATE.baseUrl.replace(/\/$/, '')}/manifest.txt`)).toString().trim(); const m = core.verifyManifest(token, updatePub); if (!m) throw new Error('bad signature');
    const h = new Date().getHours(); const d = core.decideUpdate(m, { current: app.getVersion(), platform: process.platform, arch: process.arch === 'arm64' ? 'arm64' : 'x64', channel: 'stable', deviceId: deviceId(), businessHours: !manual && h >= 9 && h < 23 });
    if (d.action === 'none') { if (manual) dialog.showMessageBox({ message: `معاك آخر إصدار (${app.getVersion()}).` }); return; }
    if (d.action === 'install-later') return; // during working hours the automatic check waits; "البحث عن تحديث" installs any time
    const art = d.artifact; const url = /^https?:/.test(art.url) ? art.url : `${UPDATE.baseUrl.replace(/\/$/, '')}/${art.url}`; const bytes = await fetchBuf(url);
    if (!core.verifyArtifactBytes(bytes, art)) throw new Error('the download does not match its checksum');
    const dir = userFile('updates'); fs.mkdirSync(dir, { recursive: true }); const file = join(dir, `O-Pharmacy-Setup-${m.version}.exe`); fs.writeFileSync(file, bytes);
    const keep = fs.readdirSync(dir).filter(f => f.endsWith('.exe')).sort().reverse(); for (const f of keep.slice(3)) { try { fs.unlinkSync(join(dir, f)); } catch { /* in use */ } }
    const go = d.forced ? true : (await dialog.showMessageBox({ type: 'info', buttons: ['ثبّت دلوقتي', 'بعدين'], defaultId: 0, cancelId: 1, message: `إصدار جديد ${m.version} جاهز.${m.notes ? `\n${m.notes}` : ''}\nالبرنامج هيقفل دقيقة ويرجع لوحده.` })).response === 0;
    if (!go) return; const prev = join(dir, `O-Pharmacy-Setup-${app.getVersion()}.exe`);
    setState({ pendingVersion: m.version, failedStarts: 0, previousInstaller: fs.existsSync(prev) ? prev : state().previousInstaller ?? null });
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref(); quitting = true; app.quit();
  } catch (e) { if (manual) dialog.showMessageBox({ type: 'warning', message: `مقدرتش أشوف التحديث: ${e.message}` }); }
}

// the About screen's button (only from the Hub page this window shows)
ipcMain.handle('o:check-update', (e) => { if (!fromHub(e)) return false; void checkForUpdate(true); return true; });

// ---------------- start ----------------
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); buildTray(); applyAutoStart();
  if (process.argv.includes('--hidden') && mode() === 'primary') { try { await startHub(); recordHealthy(); } catch { recordFailedStart(); } } else await createWindow();
  setTimeout(() => checkForUpdate(false), 60_000); setInterval(() => checkForUpdate(false), 6 * 3600_000);
});
app.on('window-all-closed', () => { /* stays in the tray: the Hub keeps serving the other devices */ });
app.on('before-quit', () => { quitting = true; if (hub) hub.kill(); });
