# @o-pharmacy/print - receipts, labels, cash drawer (Sprint 4.5)

Printing is separate from selling: a sale is complete before anything prints, and a printer that is off never undoes a sale.

- **Receipt model** (`buildReceipt`): same structure as the pharmacy's current receipt (boxed table: item, unit, quantity, line total; totals; invoice barcode; policy) with the fixes from `docs/research/current-receipt-analysis.md`: the discount is its own row, the unpaid amount is labelled "باقي على العميل", credit sales show "آجل على حساب العميل", delivery name, phone, address and agent print by themselves **on the delivery copy only** (a counter copy never carries a phone or address). Header, footer, return policy, digits (Western or Arabic-Indic), expiry, batch, unit price and the ETA QR (a real QR from the ETA queue via `PrintEnv.qrTextOf`, a placeholder box until then) are style options (`ReceiptStyle`), not code. Dates are `dd-mm-yyyy hh:mm` in the pharmacy time zone; separators are "-".
- **Rendering** (`SkiaRasterizer`): Arabic is drawn as a picture (Skia + HarfBuzz, IBM Plex Sans Arabic) at 576 dots (80 mm) or 384 dots (58 mm), so every printer prints it the same. Numbers and invoice numbers are placed left-to-right by hand inside right-to-left text.
- **Bytes**: `receiptBytes` (ESC/POS: init, raster bands, feed, drawer pulse, partial cut), `drawerBytes`, `tspl` and `zpl` labels (the printer draws the EAN-13 bars; a code that is not a valid EAN-13 prints without bars), `code39Modules` (invoice barcode, scannable for a return). `decodeEscpos` reads our own bytes back (tests, printer kit).
- **Transports** (`PrintTransport`): `TcpTransport` (network printer, port 9100), `WindowsSpoolerTransport` (printer installed in Windows, RAW through the spooler, same C# helper as the printer kit), `FileTransport`, `MemoryTransport`.
- **`PrintService`** (migration `print_0001_jobs`, append-only log):
  - `printReceipt`: the first print of a copy kind is the original and opens the drawer when the sale took cash; later prints are marked "نسخة مكررة رقم N" and need a reason; never opens the drawer. A failed print is logged and returned (`ok: false`), it never throws and never touches the sale; the retry is still the original. Reading a sale follows the sale permissions (own sale or `sale.view_all`).
  - `printSessionReport`: the drawer-closing report (reviewer copy with expected, counted and difference; the cashier's copy is blind); same original / copy rules.
  - `openDrawer` (no sale): `sale.void` (management) and a reason, always logged.
  - `printLabel`: `item.view`, 1 to 200 copies, TSPL or ZPL per printer.
  - `jobs`: the print log (`sale.view_all`).

**Not proven yet:** a real printer (cut, drawer pin and timing, label polarity, Windows driver path). Everything here is verified by decoding our own bytes and rendering in CI; the printer kit (Friday 13 Nov) is the real test. Wiring the printers and the style to settings comes with the settings screens; the style is injected so nothing is hardcoded.
