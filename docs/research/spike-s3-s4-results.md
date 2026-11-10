# Spike Results - S3 (printing), S4 (cashier speed), S1 remainder - v1.0

10 Nov 2026. Phase 0, Sprint 0.3. Code: `spikes/s3-print`, `spikes/s4-speed`, `spikes/s1-hub/autostart` (throwaway, never shipped). Evidence: GitHub Actions run 42907869391 on Windows, macOS (Apple silicon) and Linux, all green, plus local runs. Status: results for owner review. **S3 is only partly proven: no real printer was available to us**; the printer test kit (`spikes/s3-print/kit/`) is how the real printers get tested.

## 1. S4 - cashier speed (data layer only)
Local SQLite file, 25,000 items (about 62,000 batches and 40,000 barcodes) and also 100,000 items. Measured in milliseconds; the human threshold for "instant" is about 100 ms.

| Operation | Windows VM | macOS VM | Linux VM |
|---|---|---|---|
| Barcode to item (95th percentile) | 0.02 | 0.01 | 0.02 |
| Name search, Arabic or English, middle of word (full-text trigram index, 95th percentile) | 0.05 | 0.04 | 0.09 |
| Worst case: no index, no match, scan every item (25k / 100k items, median) | 3.5 / 18.9 | 2.1 / 10.4 | 3.2 / 14.4 |
| Whole sale of 5 lines, ONE safe commit: median / 95th | 3.9 / 6.4 | 0.2 / 0.3 | 0.3 / 0.6 |

Findings:
1. **The database is not the bottleneck.** Lookup and search are far below a millisecond even at 100,000 items; the cashier's speed will be decided by the screen (rendering, keyboard flow), measured in S5 and Phase 1.
2. **Arabic search works inside words** (trigram full-text index), so typing any 3 letters of a name finds it. It is built once on items and kept in the same file.
3. **Windows safe-mode sale costs about 4 ms** (disk flush); fine, but we saw **occasional stalls of 0.4 to 2 seconds** on the Windows runner (one run 2.0 s, later runs 0.4 to 0.8 s). Moving the log checkpoint right after a bulk load did **not** clearly fix it (with and without gave similar stalls), so the cause is unproven: it may be the virtual machine disk, antivirus, or the checkpoint. **This must be re-measured on the pharmacy's real PC**, and the Hub should log any commit slower than 100 ms.
4. Proposed budget for the data layer: sale commit under 50 ms at the 95th percentile, any single stall under 250 ms on the pharmacy PC. The end-to-end cashier targets against eStock are set in S5 with the owner.
Limits: virtual machines, single process, synthetic fictional data, no network, no UI.

## 2. S3 - printing
**Built:** a receipt renderer that draws Arabic right-to-left text with real shaping (Skia/HarfBuzz) at the printer's dot width (576 dots for 80 mm, 384 for 58 mm), converts it to the ESC/POS raster-image command, adds feed, partial cut and cash-drawer pulse, and generates barcode labels in TSPL (TSC and compatible) and ZPL (Zebra) with an EAN-13 barcode (check digit computed and verified). An independent decoder reads our bytes back and the bitmap must match exactly; this passed on all three systems. A preview image shows what the printer will draw (see `kit/receipt80-preview.png`).

**Findings:**
1. **Print Arabic as an image, not as text.** Receipt printers have only old Arabic code pages and no shaping, and each model differs. Rendering the whole receipt as a bitmap makes the result identical on every printer, with any font and logo. Cost: about 65 KB per receipt (fast on USB and network, slow on old serial printers).
2. **Arabic-Indic digits needed a fix:** drawing "2026-11-10" with Arabic digits came out as "10-11-2026" because the bidirectional rules reorder digit groups separated by "-" or ":" even in a left-to-right run (this is the same trap the owner reported with separators). We lay numbers out token by token. The same rule must be checked in the web UI and in printed reports.
3. **The Windows raw path works at the system level:** our PowerShell script sent the 64,577-byte receipt through the real Windows spooler (RAW data type) to a test printer and the spooler accepted every byte. Whether a physical printer then prints it correctly is **not proven**.
4. Printing needs a text-rendering engine in the Hub (a native addon, installed from prebuilt binaries); it installed and ran on all three systems in CI.
5. The sample receipt reserves the ETA QR area (placeholder box); the real QR content comes with the ETA adapter (Phase 4).

**Not proven (needs the real printers - the kit does this):** that the pharmacy's receipt printer accepts the raster command and cuts; the cash-drawer pin and timing; the label printer's language (TSPL, ZPL or other) and bitmap polarity (the kit prints both variants); printing through the Windows driver; paper widths; speed; USB vs network behaviour.

## 3. S1 remainder - auto-start
- **Windows:** a scheduled task running at startup as the system account started the single-executable Hub, which then answered on its LAN port (CI passed). Not yet tested: restart after a crash, a real Windows Service with recovery rules, a reboot.
- **macOS (launchd) and Linux (systemd):** draft definitions are in `spikes/s1-hub/autostart/`, **untested**.
- Still open from Sprint 0.2: real power cut, installers, auto-update, licence activation, desktop window shell (Electron or Tauri).

## 4. Decisions and questions for the owner
1. Approve "render receipts and labels as images through the Hub print service" as the printing direction.
2. Have someone run the printer test kit on the pharmacy PC (about 10 minutes, steps in `kit/README.md`) and send back `RESULTS.md` with photos. Needed: receipt printer, cash drawer, label printer, barcode reader models.
3. Approve the data-layer budget in section 1, point 4, and the rule that the Hub logs every slow commit.
4. Proposed next step: **Sprint 0.4** - S5 (Ribbon UI prototype, clickable on your phone) and S6 (tenant isolation proof with Row-Level Security). Say "go Sprint 0.4" after merging.
