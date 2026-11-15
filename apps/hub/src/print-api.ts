/* Sprint 7.12 (owner's photos of the eStock screens, 14 Nov 2026): barcode printing with many items and quantities, the sticker and
   receipt settings with a live preview, the dose sticker or slip, the Windows printers list, and the contract paper invoice. */
import { spawn } from 'node:child_process';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can, type Person } from '@o-pharmacy/core';
import { expiryText, type LabelSpec, type ReceiptLine } from '@o-pharmacy/print';
import type { App } from './compose';
import { AccessError } from './access';
import { A4_LAYOUTS, labelPng, labelStyle, mergeReceiptStyle, pharmacyInfo, printers, printService, receiptSamplePng, receiptStyle, saveLabelStyle } from './printing';

type B = Record<string, unknown>;
const body = (q: FastifyRequest) => (q.body ?? {}) as B;
const param = (q: FastifyRequest, k: string) => String((q.params as B)[k] ?? '');
const money = (minor: number) => `${(minor / 100).toFixed(2)} ج`;
/** "2027-10-31" -> "10/27" (short, for a small sticker) */
const shortExpiry = (iso: string | null | undefined) => { const t = expiryText(iso); return t ? `${t.slice(0, 2)}/${t.slice(5)}` : ''; };

let winCache: { at: number; list: string[] } | null = null;
/* Get-Printer where it exists, the WMI list otherwise; UTF-8 so Arabic printer names come through. */
const LIST_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; try { Get-Printer -ErrorAction Stop | Select-Object -ExpandProperty Name } catch { Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name }";
/** The printers installed in Windows on the PC that runs the Hub (for the settings drop-downs). Empty elsewhere. An empty answer is not kept, so the next look tries again. */
function windowsPrinters(fresh = false): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  if (!fresh && winCache && Date.now() - winCache.at < 30_000) return Promise.resolve(winCache.list);
  return new Promise(ok => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LIST_PS], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); let out = '';
    p.stdout.setEncoding('utf8'); p.stdout.on('data', d => { out += String(d); }); p.once('error', () => ok([])); const t = setTimeout(() => { p.kill(); ok([]); }, 20_000);
    p.once('close', () => { clearTimeout(t); const list = [...new Set(out.replace(/^\uFEFF/, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean))].slice(0, 60); winCache = list.length ? { at: Date.now(), list } : null; ok(list); });
  });
}

export function printRoutes(s: FastifyInstance, app: App): void {
  const db = app.hub.db; const me = (q: FastifyRequest) => q.person!;
  const need = (p: Person, k: string) => { if (!can(p, k, app.hub.branchId)) throw new AccessError('forbidden', `missing permission ${k}`); };
  const firstBarcode = db.prepare("SELECT barcode FROM item_barcodes WHERE item_id=? ORDER BY CASE kind WHEN 'gtin' THEN 0 WHEN 'internal' THEN 1 ELSE 2 END LIMIT 1");
  const batchesOf = db.prepare("SELECT b.expiry e, b.public_price_minor p, u.name u, u.factor f, (SELECT COALESCE(SUM(qty),0) FROM movements m WHERE m.batch_id=b.id) q FROM batches b JOIN item_units u ON u.id=b.price_unit_id WHERE b.item_id=? AND b.status='active' ORDER BY b.expiry");

  /** an item for the barcode printing grid: its code, barcode, price unit, price, stock and the expiries in stock */
  const labelItem = (id: string) => {
    const it = app.items.get(id); if (!it) throw new AccessError('not-found', 'item');
    const bs = (batchesOf.all(id) as { e: string; p: number | null; u: string; f: number; q: number }[]).filter(b => Number(b.q) > 0);
    const unit = bs[0]?.u ?? it.units[it.units.length - 1]?.name ?? ''; const factor = Number(bs[0]?.f ?? it.units.find(u => u.name === unit)?.factor ?? 1);
    const stockBase = bs.reduce((a, b) => a + Number(b.q), 0);
    return { id: it.id, code: it.code, nameAr: it.nameAr, barcode: (firstBarcode.get(id)?.barcode as string) ?? null, printLabel: it.card.printLabel, unit, stock: Math.round((stockBase / factor) * 100) / 100,
      priceMinor: it.kind === 'drug' ? (bs[0]?.p == null ? null : Number(bs[0].p)) : it.listPriceMinor ?? null,
      batches: bs.map(b => ({ expiry: String(b.e), qty: Math.round((Number(b.q) / Number(b.f)) * 100) / 100, priceMinor: b.p == null ? null : Number(b.p) })) };
  };
  const show = (b: B) => { const st = labelStyle(app); const o = (b.show ?? {}) as B; const pick = (k: string, d: boolean) => (o[k] === undefined ? d : o[k] === true); return { st, pharmacy: pick('pharmacy', st.showPharmacy), phone: pick('phone', st.showPhone), price: pick('price', st.showPrice), expiry: pick('expiry', st.showExpiry) }; };
  const priceSpec = (it: ReturnType<typeof labelItem>, l: B, sh: ReturnType<typeof show>): LabelSpec => {
    const ph = pharmacyInfo(app); const price = l.priceMinor !== undefined && l.priceMinor !== null && l.priceMinor !== '' ? Number(l.priceMinor) : it.priceMinor;
    const exp = typeof l.expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.expiry) ? l.expiry : it.batches[0]?.expiry ?? null;
    return { kind: 'price', name: it.nameAr, barcode: it.barcode ?? it.code, code: it.code, pharmacy: sh.pharmacy ? sh.st.pharmacyName || ph.name : null, phone: sh.phone ? sh.st.phone || ph.phones?.[0] || null : null, price: sh.price && price != null && Number.isFinite(price) ? money(price) : null, expiry: sh.expiry ? shortExpiry(exp) || null : null };
  };
  const labelPrinter = (b: B) => { const name = b.printer ? String(b.printer) : printers(app).find(x => x.kind === 'label')?.name; if (!name) throw new AccessError('state', 'no label printer is set up'); return name; };

  s.get('/api/print/label-item/:id', async (q) => { need(me(q), 'item.view'); return { item: labelItem(param(q, 'id')) }; });
  s.get('/api/settings/label-style', async (q) => { need(me(q), 'item.view'); const ph = pharmacyInfo(app); return { style: labelStyle(app), layouts: A4_LAYOUTS, pharmacy: { name: ph.name, phone: ph.phones?.[0] ?? '' }, printers: printers(app).filter(p => p.kind === 'label') }; });
  s.post('/api/settings/label-style', async (q) => { const p = me(q); need(p, 'settings.branch'); return { style: saveLabelStyle(app, p, body(q)) }; });
  s.get('/api/settings/receipt-style', async (q) => { need(me(q), 'settings.branch'); return { style: receiptStyle(app), printers: printers(app).filter(p => p.kind === 'receipt') }; });
  s.post('/api/settings/receipt-style', async (q) => { const p = me(q); need(p, 'settings.branch'); const st = mergeReceiptStyle(receiptStyle(app), body(q)); app.access.setSetting('receipt.style', JSON.stringify(st), p.id); app.hub.audit(p.id, 'settings.receipt_style', 'settings', 'receipt.style', st as Record<string, unknown>); return { style: st }; });
  /* previews: pictures only, nothing is printed or logged */
  s.post('/api/print/receipt-sample', async (q, rep) => { need(me(q), 'settings.branch'); const b = body(q); const st = mergeReceiptStyle(receiptStyle(app), (b.style ?? {}) as B); rep.header('Content-Type', 'image/png'); return rep.send(receiptSamplePng(app, st, b.width === 58 ? 58 : 80)); });
  s.post('/api/print/label-preview', async (q, rep) => {
    const p = me(q); need(p, 'item.view'); const b = body(q); const mm: [number, number] = Array.isArray(b.mm) ? [Math.min(110, Math.max(15, Number(b.mm[0]) || 40)), Math.min(150, Math.max(8, Number(b.mm[1]) || 30))] : printers(app).find(x => x.kind === 'label')?.labelMm ?? [40, 30]; const dpmm = Math.min(16, Math.max(8, Math.round(Number(b.dpmm) || 8))); const sh0 = (b.show ?? null) as B | null;
    const ph = pharmacyInfo(app); const st = { ...labelStyle(app), ...((b.style ?? {}) as object) } as ReturnType<typeof labelStyle>;
    const spec: LabelSpec = b.itemId ? priceSpec(labelItem(String(b.itemId)), b, sh0 ? show(b) : { st, pharmacy: st.showPharmacy, phone: st.showPhone, price: st.showPrice, expiry: st.showExpiry })
      : { kind: 'price', name: 'اسم الصنف بيكون مكتوب هنا', barcode: '6221031234569', code: '26824', pharmacy: st.showPharmacy ? st.pharmacyName || ph.name : null, phone: st.showPhone ? st.phone || ph.phones?.[0] || null : null, price: st.showPrice ? '4.00 ج' : null, expiry: st.showExpiry ? '10/27' : null };
    rep.header('Content-Type', 'image/png'); return rep.send(labelPng(spec, mm, dpmm));
  });
  s.get('/api/print/windows-printers', async (q) => { need(me(q), 'settings.branch'); return { printers: await windowsPrinters((q.query as B).fresh === '1'), platform: process.platform }; });

  /* the test sticker (إعدادات الباركود): a frame and a centre cross at the roll's size, to see at once whether the size is right */
  s.post('/api/print/label-test', async (q) => {
    const p = me(q); need(p, 'settings.branch'); const b = body(q); const printer = labelPrinter(b); const cfg = printers(app).find(x => x.name === printer); const mm = cfg?.labelMm ?? [40, 30];
    const [r] = await printService(app, q.deviceId).printLabels(p, { printer, items: [{ spec: { kind: 'test', name: `${mm[0]} × ${mm[1]} مم`, code: 'لازم الإطار يبان كامل وفي النص' }, copies: 1, ref: 'test' }] });
    return { printer, ...r };
  });
  /* price stickers for many items, each with its quantity (طباعة باركود); the purchase invoice uses it too (only items whose card prints a label) */
  s.post('/api/print/labels', async (q) => {
    const p = me(q); const b = body(q); const lines = Array.isArray(b.lines) ? (b.lines as B[]) : []; if (!lines.length || lines.length > 100) throw new AccessError('invalid', '1 to 100 lines');
    const printer = labelPrinter(b); const sh = show(b); const svc = printService(app, q.deviceId); const out: { itemId: string; ok: boolean; error?: string; copies?: number }[] = [];
    for (const l of lines) {
      const id = String(l.itemId ?? ''); const it = app.items.get(id) ? labelItem(id) : null; if (!it) { out.push({ itemId: id, ok: false, error: 'not-found' }); continue; }
      if (b.onlyLabelItems === true && !it.printLabel) { out.push({ itemId: id, ok: false, error: 'no-label' }); continue; }
      const copies = Math.min(500, Math.max(1, Math.round(Number(l.copies) || 1))); const [r] = await svc.printLabels(p, { printer, items: [{ spec: priceSpec(it, l, sh), copies, ref: it.code }] });
      out.push({ itemId: id, ok: r!.ok, error: r!.error, copies });
    }
    return { printer, results: out, stickers: out.filter(x => x.ok).reduce((a, x) => a + (x.copies ?? 0), 0) };
  });

  /* the dose (طباعة الاستخدام, D38): a sticker per item on the label printer; with no label printer, one slip on the receipt printer (never the Windows print dialog) */
  s.post('/api/print/dose', async (q) => {
    const p = me(q); const b = body(q); const ls = Array.isArray(b.lines) ? (b.lines as B[]) : []; if (!ls.length || ls.length > 60) throw new AccessError('invalid', '1 to 60 lines');
    const who = b.patient ? String(b.patient).trim().slice(0, 40) : ''; const ph = pharmacyInfo(app); const svc = printService(app, q.deviceId);
    const items = ls.map(l => ({ it: app.items.get(String(l.itemId ?? '')), dose: String(l.dose ?? '').trim().slice(0, 120), copies: Math.min(20, Math.max(1, Math.round(Number(l.copies) || 1))), id: String(l.itemId ?? '') }));
    const bad = items.filter(x => !x.it || !x.dose).map(x => ({ itemId: x.id, ok: false, error: !x.it ? 'not-found' : 'no-dose' })); const good = items.filter(x => x.it && x.dose);
    const label = b.printer ? printers(app).find(x => x.name === String(b.printer) && x.kind === 'label')?.name : printers(app).find(x => x.kind === 'label')?.name;
    if (label) {
      const res = await svc.printLabels(p, { printer: label, items: good.map(x => ({ spec: { kind: 'dose' as const, name: x.it!.nameAr, dose: x.dose, patient: who || null, pharmacy: ph.name, phone: ph.phones?.[0] ?? null }, copies: x.copies, ref: 'dose' })) });
      return { printer: label, mode: 'label', results: [...good.map((x, i) => ({ itemId: x.it!.id, ok: res[i]!.ok, error: res[i]!.error })), ...bad] };
    }
    const receipt = printers(app).find(x => x.kind === 'receipt')?.name; if (!receipt) throw new AccessError('state', 'no label or receipt printer is set up');
    const L: ReceiptLine[] = [{ t: ph.name, size: 28, bold: true, align: 'center' }, { t: 'طريقة الاستخدام', size: 24, align: 'center' }]; if (who) L.push({ t: `المريض: ${who}`, size: 22, align: 'right' });
    for (const x of good) { L.push({ rule: true }); L.push({ t: x.it!.nameAr, size: 26, bold: true, align: 'right' }); L.push({ t: x.dose, size: 30, bold: true, align: 'right' }); }
    L.push({ rule: true }); if (ph.phones?.length) L.push({ t: 'ت/ ' + ph.phones.join(' - '), size: 20, align: 'center' });
    const r = good.length ? await svc.printSlip(p, { printer: receipt, lines: L, ref: 'dose', kind: 'dose' }) : null;
    return { printer: receipt, mode: 'slip', results: [...good.map(x => ({ itemId: x.it!.id, ok: !!r?.ok, error: r?.error })), ...bad] };
  });

  /* the contract paper invoice (إصدار فاتورة ورقية للتعاقد): an insurance sale's claim, by claim or sale number, laid out on A4 by the screen */
  s.get('/api/claims/paper', async (q) => {
    need(me(q), 'contract.view'); const ref = String((q.query as B).ref ?? '').trim(); if (!ref) throw new AccessError('invalid', 'a claim or sale number is required');
    const c = db.prepare('SELECT * FROM claims WHERE claim_no=? OR sale_ref=? ORDER BY rowid DESC LIMIT 1').get(ref, ref) as Record<string, unknown> | undefined; if (!c) throw new AccessError('not-found', 'claim');
    const k = db.prepare('SELECT name, code, payer_type FROM contracts WHERE id=?').get(c.contract_id as string) as Record<string, unknown>; const m = db.prepare('SELECT member_no, name, phone FROM contract_members WHERE id=?').get(c.member_id as string) as Record<string, unknown>;
    const lines = db.prepare('SELECT line_no, item_name, qty, unit_price_minor, line_total_minor, covered_minor, excluded FROM claim_lines WHERE claim_id=? ORDER BY line_no').all(c.id as string).map(l => ({ lineNo: Number(l.line_no), itemName: String(l.item_name), qty: Number(l.qty), unitPriceMinor: Number(l.unit_price_minor), totalMinor: Number(l.line_total_minor), coveredMinor: Number(l.covered_minor), excluded: Number(l.excluded) === 1 }));
    return { pharmacy: pharmacyInfo(app), claim: { claimNo: String(c.claim_no), saleRef: (c.sale_ref as string) ?? null, rxRef: (c.rx_ref as string) ?? null, serviceDate: String(c.service_date), status: String(c.status), coveragePercent: Number(c.coverage_percent), totalMinor: Number(c.total_minor), coveredMinor: Number(c.covered_minor), copayMinor: Number(c.copay_minor) },
      contract: { name: String(k?.name ?? ''), code: String(k?.code ?? ''), payerType: String(k?.payer_type ?? '') }, member: { memberNo: String(m?.member_no ?? ''), name: String(m?.name ?? ''), phone: (m?.phone as string) ?? null }, lines };
  });
}
