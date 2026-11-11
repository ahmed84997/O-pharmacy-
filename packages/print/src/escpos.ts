import { toBits, type GrayImage } from './bitmap';
const ESC = 0x1b, GS = 0x1d;
export interface ReceiptBytesOptions { drawer?: boolean; cut?: boolean; feed?: number; band?: number }
/** ESC/POS job: init, the receipt as a raster image (Arabic is drawn as a picture, so every printer prints it the same), feed, optional drawer pulse, partial cut. */
export function receiptBytes(img: GrayImage, o: ReceiptBytesOptions = {}): Buffer {
  const { drawer = false, cut = true, feed = 4, band = 128 } = o; const { bpr, data } = toBits(img); const parts: Uint8Array[] = [Uint8Array.of(ESC, 0x40)];
  for (let y = 0; y < img.height; y += band) { const h = Math.min(band, img.height - y); parts.push(Uint8Array.of(GS, 0x76, 0x30, 0, bpr & 255, bpr >> 8, h & 255, h >> 8), data.subarray(y * bpr, (y + h) * bpr)); } // sent in bands so small printer buffers cope
  parts.push(Uint8Array.of(ESC, 0x64, feed));
  if (drawer) parts.push(Uint8Array.of(ESC, 0x70, 0, 60, 120));
  if (cut) parts.push(Uint8Array.of(GS, 0x56, 0x42, 3));
  return Buffer.concat(parts);
}
/** Open the cash drawer only (pin 2, 120 ms on, 240 ms off). */
export const drawerBytes = (): Buffer => Buffer.from([ESC, 0x40, ESC, 0x70, 0, 60, 120]);

/** Independent reader of our own bytes, used by the tests (and by the printer kit to explain a print). */
export function decodeEscpos(buf: Buffer): { commands: string[]; width: number; height: number; bits: Buffer } {
  const cmds: string[] = [], rows: Buffer[] = []; let width = 0, i = 0;
  while (i < buf.length) {
    const b = buf[i]!, n = buf[i + 1];
    if (b === ESC && n === 0x40) { cmds.push('init'); i += 2; }
    else if (b === GS && n === 0x76 && buf[i + 2] === 0x30) { const bpr = buf[i + 4]! | (buf[i + 5]! << 8), h = buf[i + 6]! | (buf[i + 7]! << 8); i += 8; width = bpr * 8; for (let y = 0; y < h; y++) rows.push(buf.subarray(i + y * bpr, i + (y + 1) * bpr)); i += bpr * h; cmds.push(`raster ${bpr}x${h}`); }
    else if (b === ESC && n === 0x64) { cmds.push('feed ' + buf[i + 2]); i += 3; }
    else if (b === ESC && n === 0x70) { cmds.push('drawer'); i += 5; }
    else if (b === GS && n === 0x56) { cmds.push('cut'); i += 4; }
    else throw new Error(`unknown byte at ${i}: 0x${b.toString(16)}`);
  }
  return { commands: cmds, width, height: rows.length, bits: Buffer.concat(rows) };
}
