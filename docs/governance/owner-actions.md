# Owner Actions - open items waiting for Dr. Ahmed

Updated 10 Nov 2026 (end of Sprint 0.3). Items stay here until done; each says why it matters.

## Friday 13 Nov 2026 - at the pharmacy (agreed 10 Nov)
1. **Run the printer test kit** on the pharmacy Windows PC (`spikes/s3-print/kit/`, steps in its README, about 10 minutes). Send back `RESULTS.md`, photos of the prints, and a photo of the model label on: receipt printer, label printer, barcode reader, and the PC (Windows version, RAM). Why: S3 cannot be called proven until the real printers are tested; also fixes the supported-hardware list.
2. Take a **photo of the printed receipt** the pharmacy gives customers today (same visit).
3. Answer the compliance questions (compliance doc section 4): does the pharmacy issue ETA e-receipts today and through which program, was it an EDA track-and-trace pilot pharmacy and does staff scan a code at sale, laser or 2D barcode reader.

## Pending decisions (any time)
| # | Decision | Where |
|---|---|---|
| 1 | Hide cost/profit from Pharmacist by default; separation of duties default-on; small cashier discount limit | permission-matrix.md section 6 |
| 2 | Approve demo screen list, generic drug names in seed data, name 2-3 pharmacist testers | demo-spec-phase1.md section 9 |
| 3 | `node:sqlite` as the Hub database direction (Node 24 check pending) and "transfers need internet at both ends" | spike-s1-s2-results.md section 5 |
| 4 | Oldest Windows version and weakest PC to support | spike-s1-s2-results.md section 5 |
| 5 | Print receipts and labels as images through the Hub print service; data-layer speed budget | spike-s3-s4-results.md section 4 |

## Still to send (when convenient)
Missing eStock screens: add-item form, stocktake, sales return, contracts, drawer closing, settings.
