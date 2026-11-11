/** Code 39 (the invoice barcode, scannable by any reader). 1 = bar module, 0 = space module; a narrow element is 1 module, a wide one 3. Table checked against an independent implementation. */
const START_STOP = '100010111011101';
const PATTERNS: Record<string, string> = {
  '0': '101000111011101',
  '1': '111010001010111',
  '2': '101110001010111',
  '3': '111011100010101',
  '4': '101000111010111',
  '5': '111010001110101',
  '6': '101110001110101',
  '7': '101000101110111',
  '8': '111010001011101',
  '9': '101110001011101',
  'A': '111010100010111',
  'B': '101110100010111',
  'C': '111011101000101',
  'D': '101011100010111',
  'E': '111010111000101',
  'F': '101110111000101',
  'G': '101010001110111',
  'H': '111010100011101',
  'I': '101110100011101',
  'J': '101011100011101',
  'K': '111010101000111',
  'L': '101110101000111',
  'M': '111011101010001',
  'N': '101011101000111',
  'O': '111010111010001',
  'P': '101110111010001',
  'Q': '101010111000111',
  'R': '111010101110001',
  'S': '101110101110001',
  'T': '101011101110001',
  'U': '111000101010111',
  'V': '100011101010111',
  'W': '111000111010101',
  'X': '100010111010111',
  'Y': '111000101110101',
  'Z': '100011101110101',
  '-': '100010101110111',
  '.': '111000101011101',
  ' ': '100011101011101',
  '$': '100010001000101',
  '/': '100010001010001',
  '+': '100010100010001',
  '%': '101000100010001',
};
export const code39Supported = (s: string): boolean => s.length > 0 && [...s.toUpperCase()].every(c => c in PATTERNS);
/** Module string for the text (start and stop included, one narrow space between characters). */
export function code39Modules(text: string): string {
  const up = text.toUpperCase(); if (!code39Supported(up)) throw new Error('code39: unsupported character in ' + JSON.stringify(text));
  return [START_STOP, ...[...up].map(c => PATTERNS[c]!), START_STOP].join('0');
}
