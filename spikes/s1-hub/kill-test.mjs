// Crash-durability test: SIGKILL the writer at random moments, reopen, verify.
// Proves process-crash safety only. A real power cut (OS cache lost) needs a VM hard power-off - see results doc.
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './driver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rounds = Number(process.env.ROUNDS ?? 30), driver = process.env.DRIVER ?? 'better', sync = process.env.SYNC ?? 'FULL';
const dir = mkdtempSync(join(tmpdir(), 's1-'));
const dbPath = join(dir, 'hub.db'), ackPath = join(dir, 'acks.txt');
let killed = 0, failures = [], lastCount = 0;

for (let r = 1; r <= rounds; r++) {
  const child = spawn(process.execPath, [join(here, 'writer.mjs'), dbPath, ackPath, driver, sync], { stdio: 'ignore' });
  await new Promise(res => setTimeout(res, 120 + Math.random() * 500));
  child.kill('SIGKILL'); killed++;
  await new Promise(res => child.on('exit', res));
  const db = openDb(dbPath, driver, sync);
  const integrity = db.get('PRAGMA integrity_check');
  const ids = new Set(db.all('SELECT id FROM movements').map(x => x.id));
  const acks = existsSync(ackPath) ? readFileSync(ackPath, 'utf8').split('\n').filter(Boolean) : [];
  const lostAcked = acks.filter(a => !ids.has(a) || !ids.has(a + ':pair'));
  const orphans = [...ids].filter(i => i.endsWith(':pair') ? !ids.has(i.slice(0, -5)) : !ids.has(i + ':pair'));
  const sum = db.get('SELECT SUM(qty) s FROM movements').s;
  if (Object.values(integrity)[0] !== 'ok') failures.push(`round ${r}: integrity ${JSON.stringify(integrity)}`);
  if (lostAcked.length) failures.push(`round ${r}: ${lostAcked.length} acknowledged commits missing`);
  if (orphans.length) failures.push(`round ${r}: ${orphans.length} half-committed transactions`);
  if (sum !== 0) failures.push(`round ${r}: ledger sum ${sum} != 0`);
  lastCount = ids.size; db.close();
}
// speed: single-row transactions per second, FULL vs NORMAL
const bench = (s) => { const f = join(dir, 'b-' + s + '.db'); const db = openDb(f, driver, s); const t = process.hrtime.bigint(); const n = 300; const lat = [];
  for (let i = 0; i < n; i++) { const a = process.hrtime.bigint(); db.exec('BEGIN'); db.run('INSERT INTO movements VALUES(?,?,?,?)', 'b' + i, 'x', 1, 0); db.exec('COMMIT'); lat.push(Number(process.hrtime.bigint() - a) / 1e6); }
  lat.sort((x, y) => x - y); db.close(); return { sync: s, txPerSec: Math.round(n / (Number(process.hrtime.bigint() - t) / 1e9)), p50ms: +lat[n >> 1].toFixed(2), p95ms: +lat[Math.floor(n * 0.95)].toFixed(2) }; };
const sqliteVersion = (() => { const db = openDb(join(dir, 'v.db'), driver); const v = db.version(); db.close(); return v; })();
const result = { platform: platform(), arch: arch(), node: process.version, driver, sqlite: sqliteVersion, rounds, kills: killed, rowsAfterLastRound: lastCount, failures, bench: [bench('FULL'), bench('NORMAL')] };
console.log(JSON.stringify(result, null, 1));
rmSync(dir, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
