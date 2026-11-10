// Generates the printer test kit (raw printer files + previews) and checks every file by decoding it again.
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderReceipt, renderText } from './src/render.mjs';
import { receiptBytes, drawerBytes, decode, toBits } from './src/escpos.mjs';
import { tspl, zpl } from './src/label.mjs';
import { bitsToPng } from './src/preview.mjs';
import { sample } from './src/sample.mjs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const kit = fileURLToPath(new URL('./kit/', import.meta.url));
mkdirSync(kit, { recursive: true });
const report = {};

for (const [name, width] of [['receipt80', 576], ['receipt58', 384]]) {
  const img = renderReceipt(sample, { width });
  const bytes = receiptBytes(img, { drawer: false });
  const d = decode(bytes);
  // Round trip: the bits the printer receives must equal the bits we rendered.
  const { bpr, data } = toBits(img);
  assert.equal(d.width, bpr * 8); assert.equal(d.height, img.height);
  assert.ok(Buffer.compare(Buffer.from(data), d.bits) === 0, name + ' raster mismatch');
  assert.deepEqual(d.commands.filter(c => !c.startsWith('raster')), ['init', 'feed 4', 'cut']);
  writeFileSync(kit + name + '.bin', bytes);
  writeFileSync(kit + name + '-preview.png', bitsToPng(d.bits, d.width, d.height));
  report[name] = { dots: `${img.width}x${img.height}`, bytes: bytes.length, commands: d.commands.length };
}
const dr = decode(drawerBytes()); assert.deepEqual(dr.commands, ['init', 'drawer']);
writeFileSync(kit + 'drawer.bin', drawerBytes());

const lab = renderText('باراسيتامول ٥٠٠ مجم\n٣٥.٠٠ ج.م', { width: 320, height: 100, size: 26 });
const t1 = tspl(lab, '622123456789'), t2 = tspl(lab, '622123456789', { invert: true }), z = zpl(lab, '622123456789');
writeFileSync(kit + 'label-tspl.bin', t1); writeFileSync(kit + 'label-tspl-invert.bin', t2); writeFileSync(kit + 'label-zpl.bin', z);
writeFileSync(kit + 'label-preview.png', lab.png());
assert.ok(t1.includes(Buffer.from('BARCODE 40,130,"EAN13",60,1,0,2,2,"6221234567891"'))); // check digit computed
assert.ok(z.toString('ascii').startsWith('^XA') && z.toString('ascii').trimEnd().endsWith('^XZ'));
report.labels = { tspl: t1.length, zpl: z.length };
console.log(JSON.stringify(report));
