# O Pharmacy - Architecture and Requirements Document (ARD)

Version 1.2 - 11 Nov 2026. Owner: Dr. Ahmed. Status: **approved baseline (v1.0, PR #2) plus Phase 0 results and owner decisions D30-D31**; changes only through a versioned PR. **[DECIDED]** = owner decision (section 2); **[PHASE 0]** = settled by a Phase 0 spike or research; **[LATER]** = decided in a later phase.

Change log: v1.3 (12 Nov) adds D36 (visual identity: capsule mark, light look, side bar, alert strip) and D37 (version numbers) - v1.2 (11 Nov) adds D32-D35 (Phase 7 "The program", test path, staff mobile apps, Electron accepted) - v0.1 (10 Nov) first draft - v0.2 (10 Nov) adds the deployment topology (Cloud + Branch Hub), installer, the 4-product package, the technology choice, editions, Ribbon UI, white-label app, and the eStock inventory - v0.3 (10 Nov) adds No-Delete UX (D13) and the chain decisions D14-D22, roles D23, the code name D24, cloud tenancy D25 and e-receipt D26 - v1.0 candidate (10 Nov): review for consistency, open items split into Phase 0 vs later, glossary added; D27 desktop platforms; D28 code signing; D29 customer app publishing. v1.1 (11 Nov): Phase 0 spike results folded in (sections 8-10, 15); D24 superseded by D30 (the product name is "O Pharmacy"); D31 desktop-first with an effective phone version.

## 1. Purpose
Define what the integrated pharmacy system must do and the architecture rules it is built on, before any code. The Roadmap and Masterplan refer to this document.

## 2. Decisions taken
| # | Decision | Date |
|---|---|---|
| D1 | One all-in-one system | 10 Nov 2026 |
| D2 | Commercial product, sold to other pharmacies | 10 Nov 2026 |
| D3 | Egypt first | 10 Nov 2026 |
| D4 | Start with an eStock-like demo, then rebuild every detail the owner's way | 10 Nov 2026 |
| D5 | The YK operations system is the base for the Operations product: its database design and domain are taken, renamed, no YK brand. YK itself stays live and untouched. | 10 Nov 2026 |
| D6 | Each branch runs locally on a **Hub** (the "Master" PC, like eStock) and keeps working fully offline; devices in the branch connect to it over Ethernet; sync with the cloud when the internet returns. Each branch is independent of the others. | 10 Nov 2026 |
| D7 | Installed like eStock: download, activate with pharmacy data, desktop icon | 10 Nov 2026 |
| D8 | Package of 4 products: System (sales/ERP), Operations, Customer App, Customer Website | 10 Nov 2026 |
| D9 | Customer App: **one app per pharmacy** (white-label, the pharmacy's name and logo) | 10 Nov 2026 |
| D10 | Technology direction: **Node.js + TypeScript** end to end; quality over speed ("not in a hurry, build it right") | 10 Nov 2026 |
| D11 | Two editions like the market: **Single pharmacy** and **Chain (branches)** | 10 Nov 2026 |
| D12 | UI uses a **Ribbon** (like Microsoft Word), not drop-down menus; icons with their names; can be collapsed/expanded | 10 Nov 2026 |
| D13 | **No-Delete:** «حذف» stays in the UI for staff and hides the record from them; it is kept for management with who / when / reason; management has «المحذوفات» with restore and a per-employee deletion report | 10 Nov 2026 |
| D14 | Medicines: public and pharmacist prices are state-fixed and come on the purchase invoice; prices are stored **per batch** (old and new price can coexist); no branch price setting | 10 Nov 2026 |
| D15 | Each branch has its own Admin and Branch Manager; the chain owner has access to everything | 10 Nov 2026 |
| D16 | Customers are shared across branches with **one balance usable in any branch** | 10 Nov 2026 |
| D17 | Central warehouse is **optional** | 10 Nov 2026 |
| D18 | Branch staff see only the **available quantities** of other branches | 10 Nov 2026 |
| D19 | Inter-branch transfer workflow (request → accept → dispatch → in transit → receive); accepted at the holding branch by its Manager, storekeeper or an employee with the permission | 10 Nov 2026 |
| D20 | Non-drug items have **free pricing**, set by the pharmacy (in a chain, by the branch Admin / Manager) | 10 Nov 2026 |
| D21 | Stock is sold **nearest expiry first (FEFO)**, also when old and new prices coexist | 10 Nov 2026 |
| D22 | Transfers: default stock move at cost with no branch-to-branch debt; a chain setting makes the receiving branch owe the sender (cost or cost + margin, settled periodically); branch reports always show value transferred in / out | 10 Nov 2026 |
| D23 | Roles (templates): Owner, Branch Admin, Branch Manager, Pharmacist, Cashier, Storekeeper, Employee, Accountant, Delivery agent, Customer (app); platform: Super Admin, Support. **One person can hold several roles** (e.g. Admin = Manager in a small pharmacy; pharmacist who is also the cashier); permissions adjustable per person | 10 Nov 2026 |
| D24 | ~~"O-Pharmacy" is the code name until the commercial name is chosen~~ - **superseded by D30** | 10 Nov 2026 |
| D25 | **Cloud tenancy:** one shared cloud database with defence in depth - (1) database Row-Level Security per tenant, (2) a separate encryption key per tenant for backups and sensitive data, (3) automated tenant-isolation tests on every change, (4) a **dedicated server** tier for chains that require full isolation. Each pharmacy's primary data also lives on its own Hub. | 10 Nov 2026 |
| D26 | **ETA e-receipt:** supported in the product through an adapter that works both **direct** with ETA and through an **approved provider**; the printed receipt carries the ETA QR; aim to become an ETA-approved supplier (requirements confirmed in Phase 0) | 10 Nov 2026 |
| D27 | **All desktop platforms:** the Hub and the staff/cashier app run on **Windows, macOS and Linux** (target the whole market); Windows ships first in the pilot, macOS and Linux before the commercial launch | 10 Nov 2026 |
| D28 | Desktop software is **never published on an app store**: installed from a file downloaded from our website. **Code signing** (Windows certificate, Apple Developer ID + notarisation) is **deferred to the commercial launch**; the pilot runs unsigned | 10 Nov 2026 |
| D29 | **Customer app:** we build one white-label base; for each pharmacy that wants an app we prepare a build with its name and identity, and it is **published on the pharmacy's own App Store / Google Play accounts**, not ours. Comes with the commercial launch | 10 Nov 2026 |
| D30 | **The product name is "O Pharmacy", always written in English (Latin letters), even inside Arabic screens, documents, receipts and the customer app.** No Arabic spelling of the name. Logo and visual identity are still to be designed (near launch). Repository and file names keep the hyphenated form `O-pharmacy` | 11 Nov 2026 |
| D31 | **Desktop first, phone must be good and effective.** The staff system is designed for desktop (mouse and keyboard, cashier speed is the yardstick); the phone version is a real product built from the same code and API, designed for the phone (bottom bar, drawer, camera barcode, touch targets), not a shrunk desktop. Full cashier operation stays on the desktop and the Hub; any screen judged unsuitable for the phone is listed and needs the owner's approval before it is left out. Every demo screen is tested on both | 11 Nov 2026 |
| D32 | **Phase 7 "The program" before the pilot:** Phases 2-6 delivered tested packages without screens; Phase 7 assembles them into one Hub application with a local API and real screens. From Phase 7 a sprint is done only when the owner can install or open something and try it | 11 Nov 2026 |
| D33 | **Test path:** the Windows installer on the pharmacy PC plus a free test server on Oracle Cloud Always Free behind Cloudflare Tunnel (no open ports), updated after each merge, seed data only. **No paid hosting or plan upgrade before the launch**; the Phase 1 demo stays on Hostinger Premium as a showcase | 11 Nov 2026 |
| D34 | **Staff mobile app:** native Android and iOS apps (Capacitor, the same React code) on the stores under our company account, plus a PWA; **deferred until the desktop is fully mature** (Phase 10). Mobile is a paid add-on: the licence counts all approved devices (desktop and phone), the Hub refuses devices above the licence and the Cloud checks the subscription for remote access; desktop work and data are never locked | 11 Nov 2026 |
| D35 | **Desktop window shell: Electron** (ADR-0002 accepted by the owner) | 11 Nov 2026 |
| D36 | **Visual identity (Sprint 7.7):** the mark is an orange O holding a capsule, followed by "Pharmacy" in teal (the name stays "O Pharmacy", D30); the same mark is the app, tray and browser icon. The screens are light by default whatever the Windows setting, dark only when chosen on a device; teal `#1F7A93` for structure, orange for the one main action, 2px edges, bold labels and numbers, a teal table head, one colour per status. A side bar of quick places per permission with live counts, and an alert strip at the bottom (near expiry, shortages, requests ready to notify, low stock; each person sees only what their permissions allow; on or off and the months ahead are settings) | 12 Nov 2026 |
| D37 | **Version numbers:** `0.<phase>.<n>`: the third number counts updates and has no ceiling (0.7.9, 0.7.10, ...), the second changes only with the phase (0.8.0 = first pilot build), 1.0.0 only at the commercial launch on the owner's decision. Three numbers only (the installer and the update check need them); every change meant to reach the pharmacy raises the third number | 12 Nov 2026 |

## 3. Vision
A pharmacy runs its whole business in one Arabic-first system: sell, stock, buy, close the day, keep accounts, serve customers (including out-of-stock requests and orders from its own app), manage staff, and stay compliant - offline-safe, with AI help where it saves time.

## 4. The product package
| Product | Users | Runs on | Internet needed |
|---|---|---|---|
| **System** - sales, inventory, purchasing, accounts, contracts/insurance, reports | Cashier, pharmacist, manager, owner, accountant | Branch Hub + devices | No |
| **Operations** - customer requests, shortages, PO stages, tasks, attendance, closings, alerts, AI (YK base) | Staff, manager | Branch Hub + cloud | No inside the branch; yes for remote follow-up |
| **Customer App** (white-label per pharmacy) | The pharmacy's customers | Android + iPhone | Yes |
| **Customer Website** (same as the app, in the browser) | The pharmacy's customers | Cloud | Yes |
An order from the app/website reaches the cloud, is routed to the branch Hub, and becomes a customer request in Operations.

## 5. Editions **[DECIDED: D11, D14-D22]**
- **Single:** one branch, any number of internal stores and devices.
- **Chain:** 2+ branches, optional central warehouse and HQ: central master data, cross-branch stock visibility, inter-branch requests/transfers, central purchasing, consolidated reports.
- One codebase; the edition is a licence. Data is branch-scoped from day 1, so upgrading Single → Chain needs no migration.
- Chain rules: shared customers with one balance (D16), optional central warehouse (D17), quantities-only visibility across branches (D18), transfer workflow and approvers (D19), transfer accounting modes (D22); each branch keeps its Admin + Manager, the owner sees everything (D15).
- Full study: `docs/research/editions-single-vs-chain.md`.

## 6. Users and roles **[DECIDED: D23]**
Role templates: Owner (all branches), Branch Admin, Branch Manager, Pharmacist, Cashier, Storekeeper, Employee, Accountant, Delivery agent, Customer (app/website only). Platform side: our Super Admin and Support. A person can hold several roles; permissions are granular and adjustable per person (YK model). Finance, cost/profit and salary data are permission-gated (eStock shows cost and profit on the cashier screen - we do not by default). **[PHASE 0]** the detailed permission matrix (written from the role templates, YK's 93-permission catalogue and the eStock menus).

## 7. Functional scope (modules)
| # | Module | Content | Product | Source |
|---|---|---|---|---|
| 1 | Foundation | Identity, roles/permissions, devices, branches, internal stores, configuration engine, audit, event bus, licensing | all | YK + new |
| 2 | Master data | Items (units + conversion, barcodes, aliases, dosage, form, manufacturer, group, location, alternatives, drug/non-drug, service/stock), suppliers, customers (types, classes, regions, credit limit), contracts | System | eStock + YK |
| 3 | Inventory | Batches/expiry, FEFO, stock ledger, internal-store transfers, stocktake (ad-hoc, periodic), adjustments, cost adjustment, opening balances, expiry alerts | System | eStock + new |
| 4 | Purchasing | Reorder levels, purchase order, purchase invoice, bonus, tax, returns (with/without invoice), supplier prices and comparison, supplier statements | System | eStock + YK procurement |
| 5 | Sales / POS | Cashier session, sale types (cash, card, credit, held, home delivery), returns, item swap, discounts, customer balance, receipts, drawer closing | System | eStock + new |
| 6 | Pricing and promotions | State-fixed public/pharmacist prices per batch from the purchase invoice, old/new price handling, discounts, offers, price history | System | eStock + new |
| 7 | Contracts and insurance | Contract customers, coverage rules, copay split, approvals, claim batches, reconciliation | System | eStock (contracts) + new |
| 8 | Daily cash and accounts | Drawers, safes, banks, card accounts, cheques, cash in/out, chart of accounts, journal, income statement, financial position, shareholders/capital/profit distribution | System | eStock + YK closings |
| 9 | Compliance | ETA e-receipt, drug track and trace, controlled-drug register, recall by batch | System | new |
| 10 | Customer operations | Out-of-stock requests, shortages, notifications, reservations, home delivery, app/website orders | Operations | YK |
| 11 | Staff operations | Tasks, attendance, leave, deductions, incentives, advances, commissions, payroll, ranking | Operations | YK + eStock HR |
| 12 | Communication | WhatsApp, in-app alerts, push, SMS | Operations | YK |
| 13 | AI | Ops assistant, invoice audit, prescription reading, expiry/shortage insight | Operations | YK + new |
| 14 | Reporting | One report centre with filters, saved views, export (replaces about 77 separate eStock reports) | all | new |
| 15 | Chain | Cross-branch visibility, inter-branch requests/transfers, central purchasing, rebalancing, consolidated finance | System + Ops | new |
| 16 | Customer channel | White-label app (per-pharmacy builds on their own store accounts, D29) and website, catalogue, cart, prescription photo upload, order tracking | App + Website | new |
| 17 | Platform | Tenant onboarding, licences/editions, subscriptions, data import (eStock and others), remote support, updates | cloud | new |
Baseline of the eStock feature set: `docs/research/estock-inventory.md`.

## 8. Deployment topology **[DECIDED: D6, D7, D27]**
```
            Cloud (multi-tenant)
   HQ view - reports - backups - updates - licences
   customer app/website API - message routing between branches
                  ^  sync when online (queues, idempotent)
                  |
   Branch Hub ("Master" PC - Windows / macOS / Linux service)
   local database + application + print service
                  ^  Ethernet LAN (works without internet)
                  |
   Cashier / staff devices (desktop window to the Hub; local fallback queue)
```
- **Hub install (D27):** one installer per platform from our website - Windows (.exe/.msi), macOS (.pkg/.dmg, signed and notarised), Linux (.deb/.rpm or AppImage) → activation (pharmacy data + licence) → runs as a background service (Windows service / macOS launchd / Linux systemd) with the application, local database and print service → desktop icon that opens the app in its own window. Installers are code-signed on Windows and macOS from the commercial launch (D28); no app store for desktop.
- **Other devices:** a small installer that finds the Hub on the network and creates the icon (or open the Hub address once and install it as a PWA).
- **Hub failure:** the cloud holds a continuously synced copy; a new Hub is installed on any PC and pulls its data; meanwhile devices keep selling into their local queue.
- **Updates:** automatic from the cloud (no manual "Update System").
- **Printing:** the Hub's print service drives receipt printers, barcode-label printers and the cash drawer on all three platforms (ESC/POS and label languages over USB/network; a browser alone cannot print silently or open the drawer). Barcode scanners work as keyboards.

## 9. Data and sync principles
- **Stock and money as ledgers:** every sale, receipt, transfer, adjustment is an immutable movement with a UUID; balances are sums. No-Delete; corrections are new movements.
- **Sync = sending new movements** (outbox per Hub), idempotent, ordered per branch. Master data is cloud-authoritative and versioned; branches change only allowed fields.
- **Branch independence:** an outage in one branch affects no other branch. Cross-branch features need the internet and always show data age.
- **Batches and prices:** every receipt creates batches with expiry, cost, and (for medicines) the state public/pharmacist price from the invoice (D14); the sale takes stock nearest expiry first (D21) and sells each batch at its own price; non-drug prices are set by the pharmacy (D20).
- **Deletion:** a "delete" is a void/archive movement with who / when / reason (D13); nothing is physically removed.
- **Document numbers** carry the branch code (no collisions between offline branches) **[PHASE 0: check ETA numbering rules]**.

## 10. Technology **[DECIDED direction - validated by Phase 0 spikes]**
- **Backend (Cloud + Hub):** Node.js + TypeScript, one shared domain code base used by both.
- **System + Operations UI:** React + TypeScript, offline-capable, delivered as a cross-platform desktop window (Windows, macOS, Linux) and as a PWA from any browser.
- **Customer App:** React Native (Expo), one white-label base; per-pharmacy builds published on the pharmacy's own store accounts (D29).
- **Customer Website:** Next.js.
- **Settled by Phase 0 spikes (details in `docs/research/spike-*.md`):**
  - **Hub database: SQLite** (WAL, synchronous FULL, one writer per branch) through Node's built-in `node:sqlite` (experimental in Node 22: re-check on Node 24 LTS before Phase 2; better-sqlite3 failed to build on Windows CI). Safe-write proven on Windows, macOS, Linux CI (S1).
  - **Sync: custom ledger + outbox**, idempotency keys, transfers as an event chain through the cloud; 157 tests green on three OSes (S2).
  - **Cashier speed:** database layer far below 1 ms for barcode and search on 25k items (FTS5 trigram for Arabic mid-word search); targets set in `spike-s3-s4-results.md` (S4). Windows commit stalls (0.4-2 s) seen on the CI runner must be re-measured on a real PC in the pilot.
  - **Packaging:** Node single executable works (83/107/119 MB on Windows/macOS/Linux); Windows scheduled-task auto-start proven; launchd/systemd untested (S1).
  - **Printing:** the Arabic receipt is rendered as a raster image and sent as ESC/POS (drawer pulse, cut) and TSPL/ZPL labels; tested in CI by rendering only, **real printers pending (Friday kit)** (S3).
  - **Cloud database: PostgreSQL with Row-Level Security**, per-tenant keys, tested 13/13 on Linux and macOS; known limit and the stronger per-tenant-login tier documented (S6).
  - **UI:** Ribbon prototype accepted for review (S5).
- **Still open:** desktop-window shell: provisional Electron (ADR-0002, owner may veto); update logic and licences built in Sprint 2.6 (installer proof on real machines still open); real power-cut test, backend framework (decided in Sprint 2.4: Fastify, see docs/governance/adr-0001-backend-framework.md), sync library vs custom beyond two branches.

## 11. UI and UX **[DECIDED: Ribbon]**
- **Ribbon like Microsoft Word** instead of drop-down menus: tabs (e.g. المبيعات - المشتريات - الأصناف - المخازن - العملاء - الموردين - الحسابات - العمليات - شئون العاملين - التقارير - الإعدادات), each tab with labelled icon groups.
- Icon **names always shown** next to/under the icons; the ribbon can be **collapsed and expanded**; a **Quick Access Toolbar** for the user's most used actions; a **status bar** (user, branch, connection/sync state, shift).
- Keyboard first for the cashier: shortcuts for every main action, key tips like Word (Alt + letter), barcode focus always ready, speed at least equal to eStock.
- Ribbon tabs and groups follow permissions (a user sees only what they can do).
- **Desktop first (D31)**: the full Ribbon, keyboard and mouse. **Phone version (D31)** for owner, manager and staff: same code and permissions, a bottom bar for the most used screens plus a side drawer for the rest, camera barcode scanning, touch targets of at least 44 px, and the same offline and No-Delete rules. Prototype: S5 (v2).
- **Name (D30):** "O Pharmacy" in Latin letters everywhere, including Arabic screens.
- Arabic-first RTL, Arabic digits handling, light/dark themes, design system shared by System, Operations, Website (App uses the same tokens).
- One **report centre** instead of a menu entry per report.

## 12. Key non-functional requirements
- Full offline selling and operations inside the branch; zero selling downtime when the internet is down.
- Performance: instant barcode-to-line and catalogue search on ~25k items on ordinary pharmacy PCs. **[PHASE 0]** numeric targets set by spike 4 (cashier speed), measured against eStock.
- Integrity: ledgers, immutable audit trail, No-Delete.
- Security: role/permission matrix, device approval, session control, encrypted off-site backups, PII minimisation, tenant isolation with defence in depth (D25), security review before each release, external penetration test before commercial launch.
- Backups: continuous cloud sync + scheduled snapshots; restore tested; per-tenant export.
- Compliance by design: e-receipt and track-and-trace hooks part of the sale and stock models from day one.

## 13. Architecture principles (from YK, kept)
Modular monolith per deployable (Hub, Cloud) with module-owned data; UUID identity; transactional outbox events; shared state machines; branch isolation; configuration engine with no hardcoded business values; additive migrations; No-Delete; audit everything. Cloud tenancy: shared database with Row-Level Security, per-tenant keys, isolation tests and a dedicated tier (D25); the tenant context is set in one place and never trusted from the client.

## 14. Integrations
Egypt: ETA e-receipt (adapter: direct or approved provider, D26), EDA track and trace (pharmacy duties to be confirmed from decrees 475/2025 and 161/2025), WhatsApp, payment gateways/wallets, insurance/corporate portals, supplier ordering, GS1 barcodes, receipt/label printers, cash drawer. Later markets (KSA/UAE) out of scope.

## 15. Remaining decisions
**Settled in Phase 0 (spikes and research):** Hub local database and packaging on the three platforms; cloud database; sync engine; backend framework; cashier performance targets; ETA e-receipt requirements, numbering and approved-supplier route; EDA track-and-trace duties for pharmacies; detailed permission matrix.
**Withdrawn:** D-P7 (pilot after Phase 4), see D32.
**Later:** edition packaging and pricing (after competitor demos); logo and visual identity (near launch; the name is fixed by D30).
No owner decision blocks the start of Phase 0.

## 16. Out of scope (for now)
KSA/UAE compliance, B2B marketplace, manufacturing, hospital pharmacy.

## 17. Glossary
- **Hub:** the branch's main computer (like eStock's "Master"; Windows, Mac or Linux) running our service and local database; the branch works on it without internet.
- **O Pharmacy:** the product name (D30), always in Latin letters.
- **Cloud:** our servers: backups, updates, owner/HQ view, customer app/website, routing between branches.
- **Ledger:** a list of movements that are never edited or deleted; a balance is the sum of the movements.
- **Batch:** a quantity of one item with the same expiry and price, received on one invoice.
- **FEFO:** first expiry, first out - sell the nearest expiry first.
- **Tenant:** one customer of ours (a pharmacy or a chain) in the cloud.
- **Row-Level Security (RLS):** a database rule that only returns a tenant's own rows, even if the application code has a bug.
- **PWA:** a website that installs like an app and can work offline.
- **Ribbon:** the Word-style toolbar of tabs and labelled icon groups.
- **Spike:** a small throwaway prototype that answers a technical question before we build for real.
- **White-label:** the same app published under each pharmacy's own name and logo.
