# O-Pharmacy - Architecture and Requirements Document (ARD)

Version 0.3 DRAFT - 10 Nov 2026. Owner: Dr. Ahmed. Status: in discussion, nothing is approved for build. **[DECIDED]** = owner decision; **[OPEN]** = needs a decision; **[ASSUMPTION]** = my inference, to confirm.

Change log: v0.1 (10 Nov) first draft - v0.2 (10 Nov) adds the deployment topology (Cloud + Branch Hub), installer, the 4-product package, the technology choice, editions, Ribbon UI, white-label app, and the eStock inventory - v0.3 (10 Nov) adds No-Delete UX (D13) and the chain decisions D14-D22, roles D23 and the code name D24.

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
| D14 | Public and pharmacist prices are state-fixed and come on the purchase invoice; prices are stored **per batch** (old and new price can coexist); no branch price setting | 10 Nov 2026 |
| D15 | Each branch has its own Admin and Branch Manager; the chain owner has access to everything | 10 Nov 2026 |
| D16 | Customers are shared across branches with **one balance usable in any branch** | 10 Nov 2026 |
| D17 | Central warehouse is **optional** | 10 Nov 2026 |
| D18 | Branch staff see only the **available quantities** of other branches | 10 Nov 2026 |
| D19 | Inter-branch transfer workflow (request → accept → dispatch → in transit → receive); accepted at the holding branch by its Manager, storekeeper or an employee with the permission | 10 Nov 2026 |
| D20 | Non-drug items have **free pricing**, set by the pharmacy (in a chain, by the branch Admin / Manager) | 10 Nov 2026 |
| D21 | Stock is sold **nearest expiry first (FEFO)**, also when old and new prices coexist | 10 Nov 2026 |
| D22 | Transfers: default stock move at cost with no branch-to-branch debt; a chain setting makes the receiving branch owe the sender (cost or cost + margin, settled periodically); branch reports always show value transferred in / out | 10 Nov 2026 |
| D23 | Roles (templates): Owner, Branch Admin, Branch Manager, Pharmacist, Cashier, Storekeeper, Employee, Accountant, Delivery agent, Customer (app); platform: Super Admin, Support. **One person can hold several roles** (e.g. Admin = Manager in a small pharmacy; pharmacist who is also the cashier); permissions adjustable per person | 10 Nov 2026 |
| D24 | **"O-Pharmacy" is the code name** until the commercial name and brand identity are chosen near launch | 10 Nov 2026 |

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

## 5. Editions **[DECIDED: two editions; details OPEN]**
- **Single:** one branch, any number of internal stores and devices.
- **Chain:** 2+ branches, optional central warehouse and HQ: central master data, cross-branch stock visibility, inter-branch requests/transfers, central purchasing, consolidated reports.
- One codebase; the edition is a licence. Data is branch-scoped from day 1, so upgrading Single → Chain needs no migration.
- Chain rules decided: D14-D22. Full study: `docs/research/editions-single-vs-chain.md`.

## 6. Users and roles **[DECIDED: D23]**
Role templates: Owner (all branches), Branch Admin, Branch Manager, Pharmacist, Cashier, Storekeeper, Employee, Accountant, Delivery agent, Customer (app/website only). Platform side: our Super Admin and Support. A person can hold several roles; permissions are granular and adjustable per person (YK model). Finance, cost/profit and salary data are permission-gated (eStock shows cost and profit on the cashier screen - we do not by default). **[OPEN]** the detailed permission matrix.

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
| 16 | Customer channel | White-label app and website, catalogue, cart, prescription photo upload, order tracking | App + Website | new |
| 17 | Platform | Tenant onboarding, licences/editions, subscriptions, data import (eStock and others), remote support, updates | cloud | new |
Baseline of the eStock feature set: `docs/research/estock-inventory.md`.

## 8. Deployment topology **[DECIDED in principle]**
```
            Cloud (multi-tenant)
   HQ view - reports - backups - updates - licences
   customer app/website API - message routing between branches
                  ^  sync when online (queues, idempotent)
                  |
   Branch Hub ("Master" PC, Windows service)
   local database + application + print service
                  ^  Ethernet LAN (works without internet)
                  |
   Cashier / staff devices (desktop window to the Hub; local fallback queue)
```
- **Hub install:** one Windows installer from our website → activation (pharmacy data + licence) → runs as a Windows service (application + local database + print service) → desktop icon that opens the app in its own window.
- **Other devices:** a small installer that finds the Hub on the network and creates the icon (or open the Hub address once and install it as a PWA).
- **Hub failure:** the cloud holds a continuously synced copy; a new Hub is installed on any PC and pulls its data; meanwhile devices keep selling into their local queue.
- **Updates:** automatic from the cloud (no manual "Update System").
- **Printing:** the Hub's print service drives receipt printers, barcode-label printers and the cash drawer (a browser alone cannot print silently or open the drawer). Barcode scanners work as keyboards.

## 9. Data and sync principles
- **Stock and money as ledgers:** every sale, receipt, transfer, adjustment is an immutable movement with a UUID; balances are sums. No-Delete; corrections are new movements.
- **Sync = sending new movements** (outbox per Hub), idempotent, ordered per branch. Master data is cloud-authoritative and versioned; branches change only allowed fields.
- **Branch independence:** an outage in one branch affects no other branch. Cross-branch features need the internet and always show data age.
- **Document numbers** carry the branch code (no collisions between offline branches) **[check ETA numbering rules]**.

## 10. Technology **[DECIDED direction - validated by Phase 0 spikes]**
- **Backend (Cloud + Hub):** Node.js + TypeScript, one shared domain code base used by both.
- **System + Operations UI:** React + TypeScript, installable (PWA / desktop window), offline-capable.
- **Customer App:** React Native (Expo), white-label builds per pharmacy for Android and iPhone.
- **Customer Website:** Next.js.
- **[OPEN - spike]:** Hub local database (e.g. PostgreSQL vs SQLite), cloud database, Windows packaging of the Hub as a service, sync engine (custom ledger sync vs an existing library), framework choice on the backend.

## 11. UI and UX **[DECIDED: Ribbon]**
- **Ribbon like Microsoft Word** instead of drop-down menus: tabs (e.g. المبيعات - المشتريات - الأصناف - المخازن - العملاء - الموردين - الحسابات - العمليات - شئون العاملين - التقارير - الإعدادات), each tab with labelled icon groups.
- Icon **names always shown** next to/under the icons; the ribbon can be **collapsed and expanded**; a **Quick Access Toolbar** for the user's most used actions; a **status bar** (user, branch, connection/sync state, shift).
- Keyboard first for the cashier: shortcuts for every main action, key tips like Word (Alt + letter), barcode focus always ready, speed at least equal to eStock.
- Ribbon tabs and groups follow permissions (a user sees only what they can do).
- Phones/tablets (owner, manager, staff): the ribbon becomes a side menu / bottom bar.
- Arabic-first RTL, Arabic digits handling, light/dark themes, design system shared by System, Operations, Website (App uses the same tokens).
- One **report centre** instead of a menu entry per report.

## 12. Key non-functional requirements
- Full offline selling and operations inside the branch; zero selling downtime when the internet is down.
- Performance: instant barcode-to-line and catalogue search on ~25k items on ordinary pharmacy PCs. **[OPEN]** numeric targets.
- Integrity: ledgers, immutable audit trail, No-Delete.
- Security: role/permission matrix, device approval, session control, encrypted off-site backups, PII minimisation, tenant isolation.
- Backups: continuous cloud sync + scheduled snapshots; restore tested; per-tenant export.
- Compliance by design: e-receipt and track-and-trace hooks part of the sale and stock models from day one.

## 13. Architecture principles (from YK, kept)
Modular monolith per deployable (Hub, Cloud) with module-owned data; UUID identity; transactional outbox events; shared state machines; branch isolation; configuration engine with no hardcoded business values; additive migrations; No-Delete; audit everything. **[OPEN]** tenancy model in the cloud - one database with `tenant_id` + branch scope **[ASSUMPTION]** vs database per tenant.

## 14. Integrations
Egypt: ETA e-receipt (direct API or approved provider **[OPEN]**), EDA track and trace (pharmacy duties to be confirmed from decrees 475/2025 and 161/2025), WhatsApp, payment gateways/wallets, insurance/corporate portals, supplier ordering, GS1 barcodes, receipt/label printers, cash drawer. Later markets (KSA/UAE) out of scope.

## 15. Open decisions
Tenancy model; Hub database and packaging; sync engine; e-receipt route; detailed permission matrix; performance targets; edition packaging and pricing; product and brand name.

## 16. Out of scope (for now)
KSA/UAE compliance, B2B marketplace, manufacturing, hospital pharmacy.
