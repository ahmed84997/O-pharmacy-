// S4 - cashier speed. 25,000 items, ~60,000 batches, 40,000 barcodes in a local SQLite file (node:sqlite).
// Measures what the cashier feels: barcode -> line, name search (Arabic and English, prefix and middle-of-word), FEFO batch pick, sale commit.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, platform, arch, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const N = Number(process.env.ITEMS ?? 25000);
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const ar = ['باراسيتامول', 'اموكسيسيلين', 'ايبوبروفين', 'اوميبرازول', 'ميتفورمين', 'اتورفاستاتين', 'سيتريزين', 'ديكلوفيناك', 'فيتامين', 'كالسيوم', 'سيبروفلوكساسين', 'لوسارتان', 'املوديبين', 'سالبوتامول', 'كلاريثروميسين', 'مرهم', 'شراب', 'نقط', 'كريم', 'لبوس'];
const en = ['paracetamol', 'amoxicillin', 'ibuprofen', 'omeprazole', 'metformin', 'atorvastatin', 'cetirizine', 'diclofenac', 'vitamin', 'calcium', 'ciprofloxacin', 'losartan', 'amlodipine', 'salbutamol', 'clarithromycin', 'ointment', 'syrup', 'drops', 'cream', 'suppository'];
const strength = ['100', '250', '500', '1000', '5', '10', '20', '40', '80'];
const form = ['اقراص', 'كبسولات', 'امبول', 'شريط', 'علبة'];

const dir = mkdtempSync(join(tmpdir(), 's4-'));
const db = new DatabaseSync(join(dir, 'hub.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE items(id INTEGER PRIMARY KEY, name_ar TEXT, name_en TEXT, price INTEGER, drug INTEGER);
CREATE TABLE barcodes(code TEXT PRIMARY KEY, item_id INTEGER NOT NULL);
CREATE TABLE batches(id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL, expiry INTEGER NOT NULL, qty INTEGER NOT NULL, price INTEGER NOT NULL);
CREATE INDEX batches_item ON batches(item_id, expiry);
CREATE TABLE movements(id TEXT PRIMARY KEY, item_id INTEGER, batch_id INTEGER, qty INTEGER, at INTEGER);
CREATE VIRTUAL TABLE items_fts USING fts5(name_ar, name_en, content='items', content_rowid='id', tokenize='trigram');`);

const t0 = Date.now();
db.exec('BEGIN');
const ii = db.prepare('INSERT INTO items VALUES(?,?,?,?,?)'), ib = db.prepare('INSERT INTO barcodes VALUES(?,?)'), ibt = db.prepare('INSERT INTO batches VALUES(?,?,?,?,?)');
let bid = 1; const codes = [];
for (let i = 1; i <= N; i++) {
  const k = Math.floor(rnd() * ar.length);
  ii.run(i, `${ar[k]} ${pick(strength)} ${pick(form)} ${i}`, `${en[k]} ${pick(strength)} mg ${i}`, 500 + Math.floor(rnd() * 90000), rnd() < 0.8 ? 1 : 0);
  const c = '622' + String(1000000000 + i * 7).slice(0, 10); ib.run(c, i); codes.push(c);
  if (rnd() < 0.6) { const c2 = '628' + String(2000000000 + i * 3).slice(0, 10); ib.run(c2, i); codes.push(c2); }
  const nb = 1 + Math.floor(rnd() * 4); for (let b = 0; b < nb; b++) ibt.run(bid++, i, 20270101 + Math.floor(rnd() * 40000), 1 + Math.floor(rnd() * 30), 500 + Math.floor(rnd() * 90000));
}
db.exec("INSERT INTO items_fts(rowid,name_ar,name_en) SELECT id,name_ar,name_en FROM items; COMMIT;");
const loadMs = Date.now() - t0;

let lastRows = 0;
function timeit(label, fn, n) {
  let rows = 0;
  for (let i = 0; i < Math.min(50, n); i++) rows += fn(i) ?? 0; // warm-up
  const lat = []; for (let i = 0; i < n; i++) { const a = process.hrtime.bigint(); rows += fn(i) ?? 0; lat.push(Number(process.hrtime.bigint() - a) / 1e6); }
  lat.sort((x, y) => x - y);
  return { op: label, n, avgRows: +(rows / (n + Math.min(50, n))).toFixed(1), p50ms: +lat[n >> 1].toFixed(3), p95ms: +lat[Math.floor(n * 0.95)].toFixed(3), maxMs: +lat[n - 1].toFixed(3) };
}
const qBarcode = db.prepare('SELECT i.id,i.name_ar,i.price FROM barcodes b JOIN items i ON i.id=b.item_id WHERE b.code=?');
const qFefo = db.prepare('SELECT id,qty,price,expiry FROM batches WHERE item_id=? AND qty>0 AND expiry>=? ORDER BY expiry LIMIT 1');
const qFts = db.prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ? LIMIT 20');
const qLike = db.prepare('SELECT id FROM items WHERE name_ar LIKE ? LIMIT 20');
const sale = db.prepare('INSERT INTO movements VALUES(?,?,?,?,?)'), dec = db.prepare('UPDATE batches SET qty=qty-1 WHERE id=?');
const res = [];
res.push(timeit('barcode -> item', i => qBarcode.get(codes[(i * 7919) % codes.length]) ? 1 : 0, 3000));
res.push(timeit('FEFO batch pick', i => qFefo.get(1 + ((i * 104729) % N), 20261110) ? 1 : 0, 3000));
res.push(timeit('search Arabic word (trigram, middle of word)', i => qFts.all('"' + ar[i % ar.length].slice(1, 5) + '"').length, 500));
res.push(timeit('search English prefix 3 letters (trigram)', i => qFts.all('"' + en[i % en.length].slice(0, 3) + '"').length, 500));
res.push(timeit('search Arabic LIKE prefix (no FTS, for comparison)', i => qLike.all(ar[i % ar.length].slice(0, 3) + '%').length, 200));
res.push(timeit('search RARE term: item number inside the name (trigram, few matches)', i => qFts.all('"' + (1000 + ((i * 37) % 24000)) + '"').length, 500));
res.push(timeit('search NO match (trigram)', i => qFts.all('"ززززز' + i + '"').length, 500));
res.push(timeit('WORST CASE, no index: LIKE %middle% with no match (full scan of 25k)', i => db.prepare("SELECT id FROM items WHERE name_ar LIKE ? LIMIT 20").all('%ظظظ' + i + '%').length, 100));
res.push(timeit('whole sale of 5 lines: lookup + FEFO + ledger + stock update, ONE safe commit', i => {
  db.exec('BEGIN');
  for (let l = 0; l < 5; l++) { const it = qBarcode.get(codes[((i * 5 + l) * 7919) % codes.length]); const b = qFefo.get(it.id, 20261110); if (b) { sale.run(randomUUID(), it.id, b.id, -1, Date.now()); dec.run(b.id); } }
  db.exec('COMMIT');
}, 300));
const out = { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cores: cpus().length, ramGB: +(totalmem() / 2 ** 30).toFixed(1), node: process.version, items: N, barcodes: codes.length, batches: bid - 1, loadSec: +(loadMs / 1000).toFixed(1), results: res };
console.log(JSON.stringify(out, null, 1));
db.close(); rmSync(dir, { recursive: true, force: true });
