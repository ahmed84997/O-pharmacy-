# O-Pharmacy - Roadmap

Version 0.2 DRAFT - 10 Nov 2026. Phases only; **no dates yet** - set after Phase 0 gives real estimates ("not in a hurry, build it right" - owner). Every phase follows the gate: audit → decisions → STOP → owner "go" → build → PR → STOP.

Change log: v0.1 first draft - v0.2 reflects ARD v0.2 (Hub topology, Node/TypeScript, 4 products, two editions, Ribbon UI, white-label app).

## Phase 0 - Discovery, specification, spikes (documents + throwaway prototypes)
- ✅ Competitor research v1 (incl. B-Connect, Titan, eStock vendor).
- ✅ eStock screen/feature inventory v1 (from owner screenshots); collect the missing screens (item form, stocktake, returns, contracts, drawer closing, settings, printed samples).
- ✅ Editions study (Single vs Chain) v1.
- Spikes (each a small throwaway prototype, results written down):
  1. **Hub on Windows:** installer + Windows service + local database + auto-update; power cut and restart.
  2. **Offline + sync:** Hub + 2 devices + cloud; unplug internet; unplug a device; unplug the Hub; replay queues; verify ledger totals.
  3. **Printing:** receipt printer, barcode-label printer, cash drawer via the Hub print service.
  4. **Cashier speed:** barcode-to-line and search on ~25k items on an ordinary PC.
  5. **Ribbon UI:** clickable Ribbon prototype in Arabic RTL (collapse/expand, labels, Quick Access, key tips).
- Compliance research: ETA e-receipt rules for pharmacies (incl. offline issuing and numbering), EDA track-and-trace duties for dispensing points.
- Competitor demos and prices (B-Connect ePlus/eChain, dawaTech, Dexef).
- Exit: ARD v1.0, Roadmap v1.0, Masterplan v1.0 approved; demo specification approved; tech stack fixed from spike results.

## Phase 1 - Demo "eStock-like" (clickable, seed data)
Ribbon shell, sale invoice, purchase invoice, item list, customer list, shortage notebook, cash receipt, a report-centre sample. Goal: the owner and pharmacist testers see the vision and give the "his way" change list.

## Phase 2 - Foundation and sync engine
Identity, roles/permissions, devices, branches/stores, configuration, audit, licensing, Hub ↔ Cloud sync, installer and auto-update, tenancy.

## Phase 3 - Master data, inventory, purchasing
Items and units, batches/expiry, stock ledger, internal-store transfers, stocktake, purchase invoices and returns, supplier prices; **import from eStock**.

## Phase 4 - POS, printing, e-receipt
Cashier sessions, all sale types, returns and swaps, held bills, customer balances, receipts and labels, drawer closing, ETA e-receipt.

## Phase 5 - Operations (YK base)
Customer requests, shortages, PO stages, notifications, delivery, tasks, attendance, closings, alerts, AI - now on the native stock.

## Phase 6 - Accounts, HR/payroll, contracts and insurance, report centre
Daily cash, banks, cheques, chart of accounts and statements; payroll; contracts → insurance claims; the report centre.

## Phase 7 - Pilot: Single edition at the owner's pharmacy
Side by side with eStock, then cut over. Exit: a full month of days closed with no unexplained stock/cash differences, no selling downtime, cashier speed on par.

## Phase 8 - Chain edition
Central master data, cross-branch visibility, inter-branch requests/transfers, central purchasing/warehouse, consolidated reports.

## Phase 9 - Customer App (white-label) and Website
Catalogue, ordering, prescription photo, order tracking, notifications; per-pharmacy builds and store publishing.

## Phase 10 - Compliance depth
Track and trace at dispensing, controlled-drug register, recall by batch (scope from Phase 0 research; may move earlier if regulation requires).

## Phase 11 - Commercial launch
Onboarding, subscriptions/licences, import service, support tooling, handbooks, security review, pricing.

## Cross-cutting (every phase)
Tests green in CI, handbook/in-app guide updates, security review, backups verified, no new permission/module without approval, documents updated in the same PR.

## Ordering principles
Retire the biggest risks first (offline/sync, Windows Hub, printing, compliance) in Phase 0 spikes. Build the Chain-ready data model from Phase 2 even though the Chain edition ships in Phase 8. Anything that touches money or stock is a ledger with audit.
