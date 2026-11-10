// Turn decoded printer bits back into a PNG, to see exactly what the printer would draw.
import { createCanvas } from '@napi-rs/canvas';
export function bitsToPng(bits, width, height) {
  const cv = createCanvas(width, height), ctx = cv.getContext('2d'), img = ctx.createImageData(width, height), bpr = width / 8;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const on = bits[y * bpr + (x >> 3)] & (0x80 >> (x & 7)); const v = on ? 0 : 255, o = (y * width + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255; }
  ctx.putImageData(img, 0, 0); return cv.toBuffer('image/png');
}
