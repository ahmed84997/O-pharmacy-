// ESC/POS generation (receipt printers) and an independent decoder used to verify our own bytes.
const ESC = 0x1b, GS = 0x1d;
export function toBits(img, threshold = 150) { // packs 1 = black, MSB first, rows padded to bytes
  const bpr = Math.ceil(img.width / 8), out = new Uint8Array(bpr * img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.gray[y * img.width + x] < threshold) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  return { bpr, data: out };
}
export function receiptBytes(img, { drawer = false, cut = true, feed = 4, band = 128 } = {}) {
  const { bpr, data } = toBits(img), parts = [Uint8Array.of(ESC, 0x40)]; // init
  for (let y = 0; y < img.height; y += band) { // GS v 0: raster bit image, sent in bands so small printer buffers cope
    const h = Math.min(band, img.height - y);
    parts.push(Uint8Array.of(GS, 0x76, 0x30, 0, bpr & 255, bpr >> 8, h & 255, h >> 8), data.subarray(y * bpr, (y + h) * bpr));
  }
  parts.push(Uint8Array.of(ESC, 0x64, feed));                    // feed n lines
  if (drawer) parts.push(Uint8Array.of(ESC, 0x70, 0, 60, 120));  // cash drawer pulse, pin 2
  if (cut) parts.push(Uint8Array.of(GS, 0x56, 0x42, 3));         // partial cut after feeding
  return Buffer.concat(parts);
}
export const drawerBytes = () => Buffer.from([ESC, 0x40, ESC, 0x70, 0, 60, 120]);

export function decode(buf) { // returns { commands: string[], width, height, bits }
  const cmds = [], rows = []; let width = 0, i = 0;
  while (i < buf.length) {
    if (buf[i] === ESC && buf[i + 1] === 0x40) { cmds.push('init'); i += 2; }
    else if (buf[i] === GS && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const bpr = buf[i + 4] | (buf[i + 5] << 8), h = buf[i + 6] | (buf[i + 7] << 8); i += 8; width = bpr * 8;
      for (let y = 0; y < h; y++) rows.push(buf.subarray(i + y * bpr, i + (y + 1) * bpr)); i += bpr * h; cmds.push(`raster ${bpr}x${h}`);
    } else if (buf[i] === ESC && buf[i + 1] === 0x64) { cmds.push('feed ' + buf[i + 2]); i += 3; }
    else if (buf[i] === ESC && buf[i + 1] === 0x70) { cmds.push('drawer'); i += 5; }
    else if (buf[i] === GS && buf[i + 1] === 0x56) { cmds.push('cut'); i += 4; }
    else throw new Error('unknown byte at ' + i + ': 0x' + buf[i].toString(16));
  }
  return { commands: cmds, width, height: rows.length, bits: Buffer.concat(rows) };
}
