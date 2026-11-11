/* Deterministic seed data: generic active-ingredient names only (no trade names), fictional customers and suppliers. */
import { Batch, Customer, Db, Invoice, Item, SaleLine, Supplier, round2 } from './domain';

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t) ^ 0; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// [name, strengths, unit label, form, pieces per box, base price per box (EGP)]
type Ing = [string, number[], string, string, number, number];
const TAB = 'قرص', CAP = 'كبسولة', AMP = 'امبول';
const DRUGS: Ing[] = [
  ['باراسيتامول', [500, 1000], 'مجم', TAB, 20, 28], ['ايبوبروفين', [200, 400, 600], 'مجم', TAB, 20, 36], ['ديكلوفيناك', [50, 75], 'مجم', TAB, 20, 42],
  ['اموكسيسيلين', [500, 1000], 'مجم', CAP, 16, 64], ['اموكسيسيلين وحمض الكلافيولانيك', [625, 1000], 'مجم', TAB, 14, 118], ['ازيثروميسين', [250, 500], 'مجم', TAB, 6, 76],
  ['سيبروفلوكساسين', [250, 500], 'مجم', TAB, 10, 58], ['سيفوروكسيم', [250, 500], 'مجم', TAB, 10, 96], ['اوميبرازول', [20, 40], 'مجم', CAP, 14, 44],
  ['ايزوميبرازول', [20, 40], 'مجم', TAB, 14, 92], ['رانيتيدين', [150, 300], 'مجم', TAB, 20, 24], ['دومبيريدون', [10], 'مجم', TAB, 30, 38],
  ['ميتفورمين', [500, 850, 1000], 'مجم', TAB, 30, 31], ['جليمبيريد', [1, 2, 3, 4], 'مجم', TAB, 30, 46], ['سيتاجليبتين', [50, 100], 'مجم', TAB, 28, 285],
  ['املوديبين', [5, 10], 'مجم', TAB, 30, 33], ['اتينولول', [25, 50, 100], 'مجم', TAB, 30, 27], ['بيسوبرولول', [2.5, 5, 10], 'مجم', TAB, 30, 52],
  ['لوسارتان', [50, 100], 'مجم', TAB, 30, 68], ['فالسارتان', [80, 160], 'مجم', TAB, 28, 105], ['ارورفاستاتين', [10, 20, 40], 'مجم', TAB, 30, 92],
  ['سيمفاستاتين', [10, 20, 40], 'مجم', TAB, 30, 61], ['كلوبيدوجريل', [75], 'مجم', TAB, 28, 118], ['اسبرين', [75, 81, 162], 'مجم', TAB, 30, 22],
  ['وارفارين', [1, 3, 5], 'مجم', TAB, 30, 29], ['فيوروسيميد', [40], 'مجم', TAB, 20, 18], ['سبيرونولاكتون', [25, 50, 100], 'مجم', TAB, 20, 34],
  ['ليفوثيروكسين', [25, 50, 100], 'ميكروجرام', TAB, 50, 39], ['بريدنيزولون', [5, 20], 'مجم', TAB, 20, 26], ['ديكساميثازون', [0.5, 4], 'مجم', TAB, 20, 31],
  ['سيتيريزين', [10], 'مجم', TAB, 10, 22], ['لوراتادين', [10], 'مجم', TAB, 10, 19], ['فيكسوفينادين', [120, 180], 'مجم', TAB, 10, 54],
  ['مونتيلوكاست', [4, 5, 10], 'مجم', TAB, 14, 88], ['سالبوتامول', [2, 4], 'مجم', TAB, 20, 15], ['كاربوسيستين', [250, 375], 'مجم', CAP, 20, 41],
  ['اسيتيل سيستين', [200, 600], 'مجم', TAB, 20, 47], ['بروميهكسين', [8], 'مجم', TAB, 20, 23], ['اوندانسيترون', [4, 8], 'مجم', TAB, 10, 39],
  ['لوبيراميد', [2], 'مجم', CAP, 12, 21], ['هيوسين بيوتيل بروميد', [10], 'مجم', TAB, 20, 29], ['ميبيفيرين', [135], 'مجم', TAB, 30, 34],
  ['ميترونيدازول', [250, 500], 'مجم', TAB, 20, 25], ['فلوكونازول', [50, 150, 200], 'مجم', CAP, 7, 57], ['اسيكلوفير', [200, 400, 800], 'مجم', TAB, 25, 48],
  ['ايفرمكتين', [3, 6], 'مجم', TAB, 4, 36], ['البيندازول', [400], 'مجم', TAB, 3, 27], ['جابابنتين', [100, 300, 400], 'مجم', CAP, 30, 84],
  ['بريجابالين', [75, 150], 'مجم', CAP, 14, 112], ['سيرترالين', [50, 100], 'مجم', TAB, 14, 96], ['اسيتالوبرام', [10, 20], 'مجم', TAB, 14, 78],
  ['الزولام', [0.25, 0.5], 'مجم', TAB, 30, 44], ['ميلوكسيكام', [7.5, 15], 'مجم', TAB, 20, 58], ['ترامادول', [50, 100], 'مجم', CAP, 10, 41],
  ['حمض الفوليك', [5], 'مجم', TAB, 20, 12], ['فيتامين د3', [1000, 5000, 50000], 'وحدة', CAP, 12, 45], ['كالسيوم وفيتامين د', [500], 'مجم', TAB, 30, 72],
  ['حديد وحمض الفوليك', [100], 'مجم', CAP, 30, 55], ['زنك', [15, 50], 'مجم', CAP, 30, 48], ['فيتامين ب المركب', [1], 'قرص', TAB, 30, 32],
  ['بوتاسيوم كلوريد', [600], 'مجم', TAB, 30, 29], ['لاكتولوز', [3.35], 'جم/5مل', 'زجاجة', 1, 52], ['باراسيتامول شراب', [120, 250], 'مجم/5مل', 'زجاجة', 1, 21],
  ['ايبوبروفين شراب', [100], 'مجم/5مل', 'زجاجة', 1, 26], ['اموكسيسيلين شراب', [250, 500], 'مجم/5مل', 'زجاجة', 1, 49], ['سيتيريزين شراب', [5], 'مجم/5مل', 'زجاجة', 1, 24],
  ['بيتاميثازون كريم', [0.05, 0.1], '٪', 'انبوبة', 1, 33], ['كلوتريمازول كريم', [1], '٪', 'انبوبة', 1, 27], ['دايكلوفيناك جل', [1], '٪', 'انبوبة', 1, 38],
  ['فيوسيدات كريم', [2], '٪', 'انبوبة', 1, 62], ['تتراسيكلين مرهم عيون', [1], '٪', 'انبوبة', 1, 14], ['نقط عين ليفوفلوكساسين', [0.5], '٪', 'زجاجة', 1, 58],
  ['نقط انف اكسيلوميتازولين', [0.05, 0.1], '٪', 'زجاجة', 1, 19], ['حقن ديكلوفيناك', [75], 'مجم', AMP, 5, 24], ['حقن فيتامين ب12', [1000], 'ميكروجرام', AMP, 5, 28],
  ['حقن اوندانسيترون', [4], 'مجم', AMP, 5, 35], ['حقن سيفترياكسون', [500, 1000], 'مجم', 'فيال', 1, 41],
];
const NONDRUG: [string, number][] = [
  ['شامبو للاطفال 200 مل', 68], ['كريم مرطب لليدين 100 مل', 45], ['واقي شمس 50 spf 60 مل', 185], ['معجون اسنان للحساسية 75 مل', 74], ['فرشاة اسنان ناعمة', 22],
  ['كمامة طبية 50 قطعة', 60], ['قفازات طبية 100 قطعة', 120], ['شاش طبي معقم 10 قطع', 18], ['بلاستر جروح 20 قطعة', 16], ['قطن طبي 100 جم', 24],
  ['جهاز قياس ضغط رقمي', 950], ['جهاز قياس سكر مع 10 شرائط', 480], ['شرائط قياس سكر 50 شريط', 360], ['ترمومتر رقمي', 85], ['جهاز بخار للاطفال', 1250],
  ['حفاضات اطفال مقاس 3 - 40 قطعة', 310], ['مناديل مبللة 80 قطعة', 38], ['رضاعة زجاج 240 مل', 95], ['لهاية سيليكون', 40], ['لبن اطفال المرحلة الاولى 400 جم', 255],
  ['مياه معدنية صغيرة', 8], ['عسل نحل 250 جم', 120], ['بذور حبة البركة 100 جم', 35], ['مكمل غذائي اوميجا 3 - 30 كبسولة', 210], ['مكمل بروتين 900 جم', 980],
  ['سماعة طبية', 420], ['حقنة بلاستيك 5 مل - 10 قطع', 30], ['محلول معقم 500 مل', 55], ['كحول طبي 70 ٪ 250 مل', 27], ['بيتادين محلول 120 مل', 41],
  ['وسادة طبية للرقبة', 260], ['حزام ظهر طبي', 340], ['ركبة مطاط طبية', 180], ['جورب طبي ضغط', 290], ['عكاز تلسكوبي', 450],
  ['اكياس شاي اعشاب للمعدة 20 كيس', 28], ['مبيد حشرات للجلد 100 مل', 52], ['منظف يد معقم 250 مل', 46], ['مناديل ورقية 6 علب', 70], ['بطارية قلم 2 قطعة', 25],
];
const FIRST = ['احمد', 'محمد', 'محمود', 'مصطفى', 'عمر', 'يوسف', 'علي', 'حسن', 'خالد', 'ابراهيم', 'سارة', 'مريم', 'منى', 'هدى', 'نورا', 'ايمان', 'دعاء', 'رانيا', 'سلمى', 'ياسمين'];
const LAST = ['السيد', 'عبد الله', 'الشرقاوي', 'منصور', 'فؤاد', 'حمدي', 'زكي', 'عوض', 'النجار', 'سليمان', 'الجمال', 'رمضان', 'ابو زيد', 'عطية', 'مراد'];
const SUP = ['الندى', 'الامل', 'النيل', 'الشروق', 'المستقبل', 'الصفوة', 'الواحة', 'الاهرام', 'السلام', 'الفجر', 'البركة', 'النور', 'الوفاء', 'الرحمة', 'المنار'];

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
const addMonthsEnd = (today: string, months: number) => { const d = new Date(today + 'T00:00:00Z'); return lastDay(d.getUTCFullYear(), d.getUTCMonth() + months); };
const q25 = (n: number) => Math.max(1, Math.round(n * 4) / 4);

export function buildSeed(todayIso: string): Db {
  const r = rng(20261110);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const items: Item[] = []; let n = 0;
  const mk = (name: string, drug: boolean, per: number, form: string, price: number) => {
    n++;
    const barcode = '6221' + String(100000000 + n * 7919).padStart(9, '0').slice(0, 9);
    items.push({ id: `i${n}`, name, drug, packUnit: drug ? 'علبة' : 'قطعة', subUnit: per > 1 ? form : '', perPack: per, barcode, publicPrice: q25(price), suspended: false, otherBranchQty: r() < .5 ? Math.floor(r() * 12) : 0, alt: [] });
  };
  for (const [name, strengths, unit, form, per, base] of DRUGS) {
    strengths.forEach((s, k) => {
      const label = per > 1 ? `${name} ${s} ${unit} - ${per} ${form}` : `${name} ${s} ${unit}`;
      mk(label, true, per, form, base * (1 + k * 0.35));
      if (per > 1 && k % 2 === 0) mk(`${name} ${s} ${unit} - ${per * 2} ${form}`, true, per * 2, form, base * (1 + k * 0.35) * 1.85);
    });
  }
  // Alternatives: other strengths/packs of the same active ingredient (same first word).
  for (const it of items) if (it.drug) it.alt = items.filter(o => o.drug && o.id !== it.id && o.name.split(' ')[0] === it.name.split(' ')[0]).slice(0, 3).map(o => o.id);
  const drugCount = items.length;
  for (const [name, price] of NONDRUG) mk(name, false, 1, '', price);
  // Trim or extend to about 300 so the numbers in the spec hold.
  while (items.length > 300) items.splice(Math.floor(r() * drugCount), 1);

  const batches: Batch[] = []; let bn = 0;
  for (const it of items) {
    const count = 1 + Math.floor(r() * 3);
    for (let k = 0; k < count; k++) {
      const roll = r();
      const months = roll < 0.06 ? -(1 + Math.floor(r() * 3)) : roll < 0.2 ? Math.floor(r() * 3) : 5 + Math.floor(r() * 26);
      const priceDrift = it.drug && r() < 0.12 ? 1.08 : 1;
      const pricePack = q25(it.publicPrice / priceDrift);
      const costPack = round2(pricePack * (it.drug ? 0.82 : 0.7) * (0.97 + r() * 0.06));
      batches.push({ id: `b${++bn}`, itemId: it.id, expiry: addMonthsEnd(todayIso, months), qty: Math.floor(r() * 9) * Math.max(1, it.perPack) + (it.perPack > 1 ? Math.floor(r() * it.perPack) : 0), costPack, pricePack, receivedOn: addMonthsEnd(todayIso, -2 - Math.floor(r() * 6)).slice(0, 8) + '01', priceChanged: priceDrift !== 1 });
    }
  }
  // Deliberate traps (spec section 5).
  const find = (s: string) => items.find(i => i.name.startsWith(s))!;
  const zero = find('سيتيريزين 10'); batches.filter(b => b.itemId === zero.id).forEach(b => (b.qty = 0));
  const amox = find('اموكسيسيلين 500'); batches.push({ id: `b${++bn}`, itemId: amox.id, expiry: addMonthsEnd(todayIso, -1), qty: amox.perPack * 6, costPack: round2(amox.publicPrice * .8), pricePack: amox.publicPrice, receivedOn: addMonthsEnd(todayIso, -14).slice(0, 8) + '01' });
  find('ترامادول 100').suspended = true;
  // A near-expiry batch that must be sold first, next to a fresher one (FEFO demo).
  const para = find('باراسيتامول 500'); batches.filter(b => b.itemId === para.id).forEach(b => (b.qty = 0));
  batches.push({ id: `b${++bn}`, itemId: para.id, expiry: addMonthsEnd(todayIso, 2), qty: para.perPack * 3, costPack: round2(para.publicPrice * .8), pricePack: para.publicPrice, receivedOn: addMonthsEnd(todayIso, -9).slice(0, 8) + '01' });
  batches.push({ id: `b${++bn}`, itemId: para.id, expiry: addMonthsEnd(todayIso, 20), qty: para.perPack * 12, costPack: round2(para.publicPrice * .8), pricePack: para.publicPrice, receivedOn: addMonthsEnd(todayIso, -1).slice(0, 8) + '01' });

  const customers: Customer[] = [{ id: 'c0', name: 'عميل نقدي', kind: 'cash', balance: 0, limit: 0, suspended: false }];
  for (let k = 1; k < 40; k++) {
    const kind: Customer['kind'] = k === 5 ? 'contract' : 'credit';
    const limit = [2000, 3000, 5000, 8000][Math.floor(r() * 4)];
    customers.push({ id: `c${k}`, name: `${pick(FIRST)} ${pick(LAST)}`, kind, balance: round2(r() * limit * 0.6), limit, suspended: false });
  }
  customers[7].balance = customers[7].limit + 350; // over the credit limit
  customers[9].suspended = true;
  customers[5].name = 'شركة التأمين الطبي - تعاقد';

  const suppliers: Supplier[] = SUP.map((s, k) => ({ id: `s${k + 1}`, name: `شركة ${s} للادوية`, balance: round2(r() * 40000) }));

  // About 150 past invoices over 30 days (history only: they do not touch current stock).
  const invoices: Invoice[] = [];
  const dayMs = 86400000, t0 = Date.parse(todayIso + 'T12:30:00Z');
  for (let k = 0; k < 150; k++) {
    const lines: SaleLine[] = [];
    const cnt = 1 + Math.floor(r() * 4);
    for (let j = 0; j < cnt; j++) {
      const it = pick(items); const b = batches.find(x => x.itemId === it.id) ?? batches[0];
      const q = 1 + Math.floor(r() * 3);
      lines.push({ itemId: it.id, batchId: b.id, unit: 'pack', qty: q, qtyBase: q * it.perPack, unitPrice: b.pricePack, discountPct: 0, total: round2(b.pricePack * q), cost: round2(b.costPack * q) });
    }
    const gross = round2(lines.reduce((s, l) => s + l.total, 0));
    const when = new Date(t0 - Math.floor(r() * 30) * dayMs - Math.floor(r() * 8) * 3600000).toISOString();
    const type = r() < .8 ? 'cash' : r() < .6 ? 'card' : 'delivery';
    invoices.push({ id: `old${k}`, no: `B1-${String(k + 1).padStart(6, '0')}`, type, customerId: 'c0', lines, gross, discount: 0, net: gross, cost: round2(lines.reduce((s, l) => s + l.cost, 0)), at: when, by: 'cashier', status: 'saved' });
  }
  invoices.sort((a, b) => b.at.localeCompare(a.at));

  return { today: todayIso, items, batches, customers, suppliers, invoices, purchases: [], movements: [], shortages: [], held: [], receipts: [], counters: { sale: 150, purchase: 0, receipt: 0, id: 1000 } };
}
