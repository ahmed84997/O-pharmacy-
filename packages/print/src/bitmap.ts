/** A gray image: 0 = black, 255 = white. */
export interface GrayImage { width: number; height: number; gray: Uint8Array }
/** Pack to 1 bit per pixel, 1 = black, most significant bit first, rows padded to whole bytes. */
export function toBits(img: GrayImage, threshold = 150): { bpr: number; data: Uint8Array } {
  const bpr = Math.ceil(img.width / 8), out = new Uint8Array(bpr * img.height);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if ((img.gray[y * img.width + x] ?? 255) < threshold) out[y * bpr + (x >> 3)]! |= 0x80 >> (x & 7);
  return { bpr, data: out };
}
