// O Pharmacy desktop window (ADR-0002): a thin Electron window over the local Hub.
// Sprint 7.1: the window starts the Hub (bundled Node + hub.mjs) and stops it on exit. Sprint 7.6 moves the Hub to a Windows service so it keeps running without the window.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const PORT = Number(process.env.O_PORT || 4870);
const URL = `http://127.0.0.1:${PORT}`;
let hub = null; let win = null; let quitting = false;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const res = (...p) => app.isPackaged ? join(process.resourcesPath, ...p) : join(__dirname, 'res', ...p);
const ping = () => new Promise(ok => { const r = http.get(`${URL}/api/state`, { timeout: 1500 }, x => { x.resume(); ok(x.statusCode === 200); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });

async function startHub() {
  if (await ping()) return; // a Hub is already running on this PC (another window or, later, the service)
  const data = join(app.getPath('userData'), 'data'); const logs = join(app.getPath('userData'), 'logs'); fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(logs, { recursive: true });
  const node = process.platform === 'win32' ? res('node', 'node.exe') : (fs.existsSync(res('node', 'node')) ? res('node', 'node') : 'node');
  const out = fs.openSync(join(logs, 'hub.log'), 'a');
  hub = spawn(node, [res('hub', 'hub.mjs')], { env: { ...process.env, O_DATA_DIR: data, O_WEB_DIR: res('web'), O_PORT: String(PORT), O_HOST: '127.0.0.1' }, stdio: ['ignore', out, out], windowsHide: true });
  hub.on('exit', code => { hub = null; if (!quitting) { dialog.showErrorBox('O Pharmacy', `الـ Hub وقف (كود ${code}). اقفل البرنامج وافتحه تاني. السجل في:\n${join(logs, 'hub.log')}`); } });
  for (let i = 0; i < 100; i++) { if (await ping()) return; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('the Hub did not start');
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 1366, height: 820, minWidth: 900, minHeight: 600, title: 'O Pharmacy', backgroundColor: '#0B1120', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL) && !url.startsWith('file:')) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen()); });
  await win.loadFile(join(__dirname, 'splash.html'));
  try { await startHub(); await win.loadURL(URL); }
  catch (e) { dialog.showErrorBox('O Pharmacy', `مش قادر أشغّل الـ Hub: ${e.message}`); quitting = true; app.quit(); }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { quitting = true; if (hub) hub.kill(); app.quit(); });
app.on('before-quit', () => { quitting = true; if (hub) hub.kill(); });
