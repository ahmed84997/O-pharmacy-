// Minimal "Hub" proof for a single executable: local DB + HTTP health endpoint on the LAN port, no native addon.
const { DatabaseSync } = require('node:sqlite');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dir = process.env.HUB_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
const db = new DatabaseSync(path.join(dir, 'hub.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS boot(at INTEGER)');
db.prepare('INSERT INTO boot VALUES(?)').run(Date.now());
const boots = db.prepare('SELECT COUNT(*) c FROM boot').get().c;
const info = { ok: true, platform: process.platform, arch: process.arch, node: process.version, sqlite: db.prepare('select sqlite_version() v').get().v, boots };
if (process.argv.includes('--once')) { console.log(JSON.stringify(info)); process.exit(0); }
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(info)); });
srv.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log('listening', srv.address().port));
