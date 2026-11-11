/** Search text normalisation so a pharmacist finds "أموكسيسيلين" by typing "اموكسيسيلين", with Arabic or Western digits, in any case. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const toWesternDigits = (s: string): string => s.replace(/[٠-٩۰-۹]/g, c => String((AR_DIGITS.indexOf(c) >= 0 ? AR_DIGITS.indexOf(c) : FA_DIGITS.indexOf(c))));
export function normalizeSearch(s: string): string {
  return toWesternDigits(s)
    .normalize('NFKC').toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')      // tashkeel, superscript alef, tatweel
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627') // alef variants -> alef
    .replace(/\u0649/g, '\u064a')                       // alef maksura -> ya
    .replace(/\u0629/g, '\u0647')                       // ta marbuta -> ha
    .replace(/\s+/g, ' ').trim();
}
