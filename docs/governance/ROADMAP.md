# O Pharmacy - Roadmap

Version 1.1 - 11 Nov 2026. Status: **v1.0 approved (PR #2); v1.1 adds Phase 0 results, D30-D31 and first effort ranges, for owner approval.** **No calendar dates**: the ranges below are effort estimates, not promises (owner: "not in a hurry, build it right"). Decisions D1-D31 are in `ARD.md` §2.

Every phase follows the gate: audit → decisions → STOP → owner "go" → build → PR → STOP. A phase starts only after the owner's explicit "go".

Change log: v1.1 - Phase 0 results, D30 name "O Pharmacy", D31 desktop-first with an effective phone version, effort estimates - v0.1 first draft - v0.2 Hub topology, Node/TypeScript, 4 products, two editions, Ribbon UI - v1.0 candidate: aligned with ARD v1.0 (D13-D26), Phase 0 deliverables made explicit.

## Phase 0 - Discovery, specification, spikes
Documents and throwaway prototypes only; nothing from Phase 0 ships.
**Done:** competitor research (v1.2), eStock screen inventory (v1), editions study (v1.1), owner decisions D1-D29. **Sprint 0.1 (10 Nov 2026, in PR for review):** ETA/EDA compliance research (`docs/research/compliance-eta-eda.md`), permission matrix v0.1 (`docs/specs/permission-matrix.md`), Phase 1 demo specification v0.1 (`docs/specs/demo-spec-phase1.md`). Sprint 0.1 finding: item ETA code, GTIN, optional serial and 2D-imager hardware are pulled into Phase 3-4 data model and the S3/S4 hardware tests; EDA pharmacy duties are not yet published. **Sprint 0.2 (in PR for review):** S2 offline sync and the safe-write part of S1 proven on Windows, macOS and Linux CI (`docs/research/spike-s1-s2-results.md`); real power cut, installers/services, auto-update and shell choice remain open in S1. **Sprint 0.3 (in PR for review):** S4 cashier speed measured (`docs/research/spike-s3-s4-results.md`), S3 printing prototype and printer test kit built (real printers still to be tested), Windows auto-start proven. **Sprint 0.4 (in PR for review):** S6 tenant isolation proven with PostgreSQL row-level security on Linux and macOS CI (`docs/research/spike-s5-s6-results.md`), S5 Ribbon prototype published; pharmacy receipt analysed (`docs/research/current-receipt-analysis.md`).
**Sprint 0.5 (merged):** documents v1.1 (this file, ARD, Masterplan, demo spec), D30-D31 recorded, S5 prototype updated (desktop-first, phone bottom bar, English name).
**Still to do before the Phase 0 exit:**
1. **Spikes** (each a small prototype with a written result):
   - S1 Hub on Windows, macOS and Linux - installers, background service, local database, activation, auto-update, code signing, power cut and restart; desktop-window shell choice (D27).
   - S2 Offline + sync - Hub + 2 devices + cloud; unplug the internet, a device, the Hub; replay queues; ledger totals must match. Includes two offline branches and one transfer.
   - S3 Printing - receipt printer, barcode-label printer, cash drawer through the Hub print service on the three platforms (the pharmacy's own printers first).
   - S4 Cashier speed - barcode-to-line and search on ~25k items on an ordinary PC; sets the numeric targets against eStock.
   - S5 Ribbon UI - clickable Arabic RTL prototype (labels, collapse/expand, Quick Access, key tips, phone layout).
   - S6 Tenant isolation - Row-Level Security proof with isolation tests (D25).
2. **Research:** ETA e-receipt rules for pharmacies (obligation, offline issuing, numbering, approved-supplier route); EDA track-and-trace duties for dispensing points.
3. **Specifications:** detailed permission matrix (D23); demo specification for Phase 1; sample printed receipt (from the owner's pharmacy); missing eStock screens (item form, stocktake, sales return, contracts, drawer closing, settings).
4. **Market:** competitor demos and prices (B-Connect ePlus/eChain, dawaTech, Dexef).
**Exit:** spike results written (done, except the items below); tech stack fixed (done except the desktop shell); ARD/Roadmap/Masterplan v1.1 with results and first estimates (done in Sprint 0.5, awaiting approval); demo specification approved (awaiting the owner). **Open before or inside Phase 2:** real printers (Friday kit), real power-cut test, desktop shell choice, auto-update, ETA/EDA answers from the pharmacy and suppliers, competitor demos and prices.

## Phase 1 - Demo "eStock-like"
Clickable demo (desktop first, with a good phone version, D31) on seed data inside the Ribbon shell: sale invoice, purchase invoice, item list, customer list, shortage notebook, cash receipt, report-centre sample, deleted-items view (D13). Goal: the owner and pharmacist testers see the vision and give the "his way" change list.

**Phase 1 progress:** Sprint 1.1 (merged): React Ribbon shell, seed data (about 250 items, 40 customers, 15 suppliers, 150 invoices), sale invoice with FEFO, hold and void, purchase invoice with bonus and per-batch prices, 24 logic tests, CI `demo.yml` (code in `demo/`). **Sprint 1.2 (in PR for review):** customers (add, edit limit and suspend by management only, statement), cash receipt against balance, item card (drug price locked per D14, free non-drug price, alternatives, batches), shortage notebook converts open shortages to a prefilled purchase draft, card layout on the phone for the tables; 35 logic tests; live copy updates on merge (`deploy-demo.yml`). **Sprint 1.3 (in PR for review):** report-centre sample (3 reports with filters, saved views, CSV copy), Chain preview with other-branch lookup and transfer request, restore of voided invoices and suspended items, in-demo feedback panel; 44 logic tests. Next: the owner test round and change list (`docs/specs/demo-feedback.md`).

## Phase 2 - Foundation and sync engine
Identity, role templates with multiple roles per person (D23), permissions, devices, branches/stores, configuration, audit, licensing/editions, Hub ↔ Cloud sync, installer and auto-update, cloud tenancy with RLS and per-tenant keys (D25). Data model is Chain-ready from here (branch scope, ledgers, UUID messages).

## Phase 3 - Master data, inventory, purchasing
Items and units, batches with expiry and per-batch prices (D14), non-drug free prices (D20), stock ledger, internal-store transfers, stocktake, purchase invoices and returns, supplier prices; **import from eStock**.

## Phase 4 - POS, printing, e-receipt
Cashier sessions, all sale types, FEFO batch selection (D21), returns and swaps, held bills, customer balances, receipts and labels, drawer closing, ETA e-receipt adapter (D26).

## Phase 5 - Operations (YK base, D5)
Customer requests, shortages, PO stages, notifications, delivery, tasks, attendance, closings, alerts, AI - on the native stock.

## Phase 6 - Accounts, HR/payroll, contracts and insurance, report centre
Daily cash, banks, cheques, chart of accounts and statements; payroll; contracts → insurance claims; the report centre.

## Phase 7 - Pilot: Single edition at the owner's pharmacy
On Windows (D27). Side by side with eStock, then cut over. Exit: a full month of closed days with no unexplained stock/cash differences, no selling downtime, cashier speed at least eStock's.

## Phase 8 - Chain edition
Shared customers with one balance (D16), optional central warehouse (D17), cross-branch quantities (D18), transfer workflow (D19) and accounting modes (D22), central purchasing, consolidated reports, owner view of everything (D15).

## Phase 9 - Customer App (white-label) and Website
One white-label base (D9, D29) and the website: catalogue, ordering, prescription photo, order tracking, notifications. Build pipeline that produces a pharmacy's app from its name and identity, ready to publish on the **pharmacy's own** App Store / Google Play accounts. Offered from the commercial launch.

## Phase 10 - Compliance depth
Track and trace at dispensing, controlled-drug register, recall by batch (scope from Phase 0 research; moves earlier if regulation requires).

## Phase 11 - Commercial launch
Logo and visual identity (the name is fixed, D30), macOS and Linux releases (D27), code signing on Windows and macOS (D28), customer-app onboarding per pharmacy (D29), onboarding, subscriptions/licences, import service, support tooling, handbooks, external penetration test, pricing.

## Effort estimates v1.1 [ESTIMATE, plus or minus 50 percent, no commitment]
Pace assumed: Claude builds, the owner reviews in short rounds (phase gate), no other developers. Months of elapsed work; they move with how fast decisions and test rounds come back.

| Phase | Months | Main uncertainty |
|---|---|---|
| 1 Demo | 1-2 | Owner's change list after testing |
| 2 Foundation and sync | 3-4 | Auto-update, desktop shell choice, Hub on three OSes |
| 3 Master data, inventory, purchasing | 3-4 | eStock import quality, batch and price rules |
| 4 POS, printing, e-receipt | 3-4 | Real printers, ETA offline rules and approved-provider route |
| 5 Operations (YK base) | 3 | Porting YK logic onto native stock |
| 6 Accounts, HR/payroll, contracts, reports | 3-4 | Size of the report centre |
| 7 Pilot (one full month of closed days minimum) | 1-2 | Findings in the pilot month |
| 8 Chain edition | 3 | Cross-branch rules (D15-D22) |
| 9 Customer App and Website | 2-3 | Per-pharmacy build pipeline |
| 10 Compliance depth | 2 | EDA pharmacy duties still unpublished |
| 11 Commercial launch | 2-3 | Penetration test, signing, onboarding |

**Totals:** Phases 1 to 7 (the pilot done): about **17 to 23 months**; all phases: about **26 to 34 months**.

**Option for the owner (decision D-P7):** run the pilot earlier, side by side with eStock, right after Phase 4 (sell, stock, buy, print) while Operations and Accounts are built after it. This puts real use about **10 to 14 months** out and lets the pharmacy find problems sooner, at the cost of two-system work for the staff during that time. Phase 7's exit rule stays the same.

## Proposed sprints per phase [PROPOSAL, confirmed at the start of each phase]
A sprint is a package of work with its own PR and gate, not a fixed duration.

| Phase | Sprints |
|---|---|
| 0 (done) | 0.1 research and specifications - 0.2 S1/S2 - 0.3 S3/S4 - 0.4 S5/S6 - 0.5 documents v1.1 |
| 1 Demo | 1.1 shell, sale, purchase (done) - 1.2 customers, receipt, item card, shortage to purchase - 1.3 report centre sample, branch switcher, deleted-items restore, owner test round and change list |
| 2 Foundation | 2.1 structure, CI, config engine, audit - 2.2 identity, roles, permissions, devices - 2.3 Hub (ledger, outbox) - 2.4 Cloud (Postgres RLS) - 2.5 sync Hub, devices, Cloud - 2.6 installer, auto-update, licences |
| 3 Inventory | 3.1 items, units, barcodes, ETA codes - 3.2 batches, expiry, per-batch prices - 3.3 stock ledger, stores - 3.4 stocktake, adjustments - 3.5 purchasing, returns - 3.6 import from eStock |
| 4 POS | 4.1 cashier sessions, sale core - 4.2 invoice types, FEFO, held bills - 4.3 returns, swaps - 4.4 customer balances - 4.5 printing and drawer on real printers - 4.6 drawer closing - 4.7 ETA e-receipt |
| 5 Operations | 5.1 customer requests, shortages - 5.2 PO stages, notifications - 5.3 delivery, tasks - 5.4 attendance, closings - 5.5 alerts, AI |
| 6 Accounts | 6.1 cash, banks, cheques - 6.2 chart of accounts, statements - 6.3 payroll, HR - 6.4 contracts, insurance claims - 6.5 report centre |
| 7 Pilot | 7.1 preparation (import, training, side by side) - 7.2 a full month of closed days - 7.3 fixes, exit review (moves after 4.7 if D-P7 is approved) |
| 8 Chain | 8.1 shared customers - 8.2 central warehouse - 8.3 cross-branch quantities, transfers - 8.4 accounting modes - 8.5 central purchasing, consolidated reports |
| 9 App and Website | 9.1 white-label app base - 9.2 ordering, prescription photo, tracking - 9.3 website - 9.4 per-pharmacy build pipeline |
| 10 Compliance | 10.1 track and trace at dispensing - 10.2 controlled-drug register - 10.3 recall by batch |
| 11 Launch | 11.1 logo and identity - 11.2 macOS and Linux releases, signing - 11.3 subscriptions, support, training - 11.4 penetration test, handbooks |

## Cross-cutting (every phase)
Tests green in CI, security review, backups verified, in-app guide/handbook updated, no new permission/module without approval, documents updated in the same PR.

## Ordering principles
Retire the biggest risks first (offline/sync, the Hub on three platforms, printing, tenant isolation, compliance) in Phase 0. Build the Chain-ready data model from Phase 2 although the Chain edition ships in Phase 8. Anything that touches money or stock is a ledger with audit.
