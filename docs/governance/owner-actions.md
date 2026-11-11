# Owner Actions - open items waiting for Dr. Ahmed

Updated 11 Nov 2026 (end of Sprint 0.5). Items stay here until done; each says why it matters.

## Friday 13 Nov 2026 - at the pharmacy (agreed 10 Nov)
1. **Run the printer test kit** on the pharmacy Windows PC (`spikes/s3-print/kit/`, steps in its README, about 10 minutes). Send back `RESULTS.md`, photos of the prints, and a photo of the model label on: receipt printer, label printer, barcode reader, and the PC (Windows version, RAM). Why: S3 cannot be called proven until the real printers are tested; also fixes the supported-hardware list.
2. ~~Photo of the printed receipt~~ - received 11 Nov (analysis: `docs/research/current-receipt-analysis.md`). A photo of a normal counter sale (not delivery) would still help.
3. Answer the compliance questions (compliance doc section 4): does the pharmacy issue ETA e-receipts today and through which program, was it an EDA track-and-trace pilot pharmacy and does staff scan a code at sale, laser or 2D barcode reader.

## Pending decisions (any time)
| # | Decision | Where |
|---|---|---|
| 1 | Hide cost/profit from Pharmacist by default; separation of duties default-on; small cashier discount limit | permission-matrix.md section 6 |
| 2 | Approve demo screen list, generic drug names in seed data, name 2-3 pharmacist testers | demo-spec-phase1.md section 9 |
| 3 | `node:sqlite` as the Hub database direction (Node 24 check pending) and "transfers need internet at both ends" | spike-s1-s2-results.md section 5 |
| 4 | Oldest Windows version and weakest PC to support | spike-s1-s2-results.md section 5 |
| 5 | Print receipts and labels as images through the Hub print service; data-layer speed budget | spike-s3-s4-results.md section 4 |
| 6 | D-S6: cloud isolation tier - Standard for Single, Stronger (login per pharmacy) for Chain or on request | spike-s5-s6-results.md (S6) |
| 7 | D-P7: run the pilot right after Phase 4 (about 10-14 months) instead of after Phase 6 (about 17-23 months) | ROADMAP.md, effort estimates |
| 8 | S5 choices: Ribbon tab order and names, Alt key tips as standard, phone layout (bottom bar now in prototype v2) | spike-s5-s6-results.md (S5) |
| 9 | Approve ARD, Roadmap, Masterplan v1.1 (D30 name "O Pharmacy" in English, D31 desktop first with an effective phone version) | PR for Sprint 0.5 |
| 10 | Re-render the kit's sample receipt in the structure of the pharmacy's current receipt (not started, needs "go") | current-receipt-analysis.md section 4 |
| 11 | Send one real eStock export of each: items list, stock by expiry report, suppliers list (CSV or Excel saved as CSV, 20-30 rows, no customer data) so the import headers can be confirmed. The import already understands the usual Arabic headers (Sprint 3.6) | ROADMAP.md Sprint 3.6 |
| 12 | ETA e-receipt (Sprint 4.7), from the accountant or the pharmacy's ETA account: (a) registration number (RIN), registered trade name, branch code and branch address; (b) the activity code and the pharmacist syndicate licence number; (c) the POS serial registered for each cashier terminal; (d) which tax type and subtype ETA expects for medicines and for non-drug items (exempt or taxable), the ETA unit-of-measure code for each unit we use (box, strip, tube...), and the payment-method codes; (e) a pre-production (test) ETA account with client id and secret, to run the first real submission; (f) the code of the delivery service line, if you charge delivery. Until (e) arrives nothing has been sent to ETA | eta README, compliance-eta-eda.md |

## Still to send (when convenient)
Missing eStock screens: add-item form, stocktake, sales return, contracts, drawer closing, settings.
