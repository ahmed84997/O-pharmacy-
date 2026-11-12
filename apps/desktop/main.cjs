// O Pharmacy desktop (ADR-0002, D35): a thin Electron window over the local Hub.
// Sprint 7.6: the Hub keeps running when the window closes (tray), starts with Windows, can open to the shop network,
// keeps daily backups (in the Hub) with restore here, and updates itself from a signed manifest (core update logic).
const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, net, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
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
const URL_ = () => `http://127.0.0.1:${config().port}`;
const ping = () => new Promise(ok => { const r = http.get(`${URL_()}/api/state`, { timeout: 1500 }, x => { x.resume(); ok(x.statusCode === 200); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });
const dataDir = () => userFile('data');

// ---------------- the Hub ----------------
async function startHub() {
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
async function restartHub() { restarting = true; try { await stopHub(); await startHub(); } finally { restarting = false; } if (win) win.loadURL(URL_()); }

// ---------------- window and tray ----------------
function showWindow() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
async function createWindow() {
  win = new BrowserWindow({ width: 1366, height: 820, minWidth: 900, minHeight: 600, title: 'O Pharmacy', backgroundColor: '#0B1120', autoHideMenuBar: true, icon: join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: join(__dirname, 'preload.cjs') } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL_()) && !url.startsWith('file:')) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); if (!config().hintShown) { tray?.displayBalloon?.({ title: 'O Pharmacy', content: 'البرنامج لسه شغال في الخلفية عشان الأجهزة التانية. للخروج نهائيًا: أيقونة البرنامج جنب الساعة ← خروج.' }); setConfig({ hintShown: true }); } } });
  win.on('closed', () => { win = null; });
  await win.loadFile(join(__dirname, 'splash.html'));
  try { await startHub(); await win.loadURL(URL_()); recordHealthy(); }
  catch (e) { recordFailedStart(); dialog.showErrorBox('O Pharmacy', `مش قادر أشغّل الـ Hub: ${e.message}`); }
}
function buildTray() {
  const c = config(); const img = nativeImage.createFromPath(join(__dirname, 'tray.png')).resize({ width: 16, height: 16 });
  if (!tray) { tray = new Tray(img); tray.setToolTip('O Pharmacy'); tray.on('click', showWindow); }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'افتح O Pharmacy', click: showWindow },
    { type: 'separator' },
    { label: 'السماح لأجهزة الشبكة (كاشير تاني، موبايل)', type: 'checkbox', checked: c.lan, click: async (i) => { setConfig({ lan: i.checked }); buildTray(); await restartHub(); } },
    { label: 'يشتغل مع Windows', type: 'checkbox', checked: c.autoStart, click: (i) => { setConfig({ autoStart: i.checked }); applyAutoStart(); buildTray(); } },
    { type: 'separator' },
    { label: 'استرجاع نسخة احتياطية...', click: restoreBackup },
    { label: 'فتح فولدر البيانات والنسخ', click: () => shell.openPath(dataDir()) },
    { label: 'البحث عن تحديث', click: () => checkForUpdate(true) },
    { type: 'separator' },
    { label: `الإصدار ${app.getVersion()}`, enabled: false },
    { label: 'خروج نهائي (الأجهزة التانية هتفصل)', click: () => { quitting = true; app.quit(); } },
  ]));
}
function applyAutoStart() { if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: config().autoStart, args: ['--hidden'] }); }

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
ipcMain.handle('o:check-update', (e) => { if (!String(e.senderFrame?.url ?? '').startsWith(URL_())) return false; void checkForUpdate(true); return true; });

// ---------------- start ----------------
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); buildTray(); applyAutoStart();
  if (process.argv.includes('--hidden')) { try { await startHub(); recordHealthy(); } catch { recordFailedStart(); } } else await createWindow();
  setTimeout(() => checkForUpdate(false), 60_000); setInterval(() => checkForUpdate(false), 6 * 3600_000);
});
app.on('window-all-closed', () => { /* stays in the tray: the Hub keeps serving the other devices */ });
app.on('before-quit', () => { quitting = true; if (hub) hub.kill(); });
