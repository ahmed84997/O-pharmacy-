# O-Pharmacy - Roadmap

Version 1.0 CANDIDATE - 10 Nov 2026. Status: **for owner approval**. Phases only; **no dates** until Phase 0 gives real estimates (owner: "not in a hurry, build it right"). Decisions referenced as D1-D26 are in `ARD.md` §2.

Every phase follows the gate: audit → decisions → STOP → owner "go" → build → PR → STOP. A phase starts only after the owner's explicit "go".

Change log: v0.1 first draft - v0.2 Hub topology, Node/TypeScript, 4 products, two editions, Ribbon UI - v1.0 candidate: aligned with ARD v1.0 (D13-D26), Phase 0 deliverables made explicit.

## Phase 0 - Discovery, specification, spikes
Documents and throwaway prototypes only; nothing from Phase 0 ships.
**Done:** competitor research (v1.2), eStock screen inventory (v1), editions study (v1.1), owner decisions D1-D29. **Sprint 0.1 (10 Nov 2026, in PR for review):** ETA/EDA compliance research (`docs/research/compliance-eta-eda.md`), permission matrix v0.1 (`docs/specs/permission-matrix.md`), Phase 1 demo specification v0.1 (`docs/specs/demo-spec-phase1.md`). Sprint 0.1 finding: item ETA code, GTIN, optional serial and 2D-imager hardware are pulled into Phase 3-4 data model and the S3/S4 hardware tests; EDA pharmacy duties are not yet published. **Sprint 0.2 (in PR for review):** S2 offline sync and the safe-write part of S1 proven on Windows, macOS and Linux CI (`docs/research/spike-s1-s2-results.md`); real power cut, installers/services, auto-update and shell choice remain open in S1. **Sprint 0.3 (in PR for review):** S4 cashier speed measured (`docs/research/spike-s3-s4-results.md`), S3 printing prototype and printer test kit built (real printers still to be tested), Windows auto-start proven. **Sprint 0.4 (in PR for review):** S6 tenant isolation proven with PostgreSQL row-level security on Linux and macOS CI (`docs/research/spike-s5-s6-results.md`), S5 Ribbon prototype published; pharmacy receipt analysed (`docs/research/current-receipt-analysis.md`).
**To do:**
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
**Exit:** spike results written; tech stack fixed; ARD/Roadmap/Masterplan updated to v1.1 with the results and first estimates; demo specification approved.

## Phase 1 - Demo "eStock-like"
Clickable demo on seed data inside the Ribbon shell: sale invoice, purchase invoice, item list, customer list, shortage notebook, cash receipt, report-centre sample, deleted-items view (D13). Goal: the owner and pharmacist testers see the vision and give the "his way" change list.

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
Brand and name (D24), macOS and Linux releases (D27), code signing on Windows and macOS (D28), customer-app onboarding per pharmacy (D29), onboarding, subscriptions/licences, import service, support tooling, handbooks, external penetration test, pricing.

## Cross-cutting (every phase)
Tests green in CI, security review, backups verified, in-app guide/handbook updated, no new permission/module without approval, documents updated in the same PR.

## Ordering principles
Retire the biggest risks first (offline/sync, the Hub on three platforms, printing, tenant isolation, compliance) in Phase 0. Build the Chain-ready data model from Phase 2 although the Chain edition ships in Phase 8. Anything that touches money or stock is a ledger with audit.
