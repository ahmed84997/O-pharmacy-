# Phase 1 Demo Specification - "eStock-like" - v0.1 PROPOSAL

10 Nov 2026. Phase 0, Sprint 0.1. Status: **proposal for owner approval** (the Phase 0 exit requires an approved demo specification). Source screens: `docs/research/estock-inventory.md`. Layout rules: ARD section 11 (Ribbon).

## 1. Purpose
Let the owner and two or three pharmacist testers **see and click** the vision, then give the "his way" change list. The demo proves the look, the speed of use and the workflows. It does not prove sync, printing, hardware or security (those are Phase 0 spikes).

## 2. Form and delivery
- A **web page opened from a link**, **desktop first and good on the phone (D31)**. Arabic, right-to-left, IBM Plex Sans Arabic, dark theme with the teal/orange tokens carried over from YK for now.
- **No backend, no login to a real system, no real data.** All data is in the browser and resets on reload ("Reset demo" button). Nothing is shared between visitors.
- **Ribbon shell** (D12): tabs, groups with icon + label, collapse/expand, Quick Access bar, key tips; on the phone a bottom bar (sale, items, shortages, deleted) plus a side drawer. Built in React so the same shell is reused in the product.
- No installer in Phase 1 (the installer is Phase 2 and the pilot Phase 7).
- A visible "DEMO - not a real system" strip on every screen.

## 3. Screens in scope (from Roadmap Phase 1)
| # | Screen | Working in the demo | Static / mock |
|---|---|---|---|
| 1 | **Sale invoice** (cashier) | Add line by barcode or name search, FEFO batch pick (nearest expiry), quantity/unit change, discounts, invoice types (cash, card, credit, held, home delivery), customer pick with balance, totals, hold and resume, void with reason, "save" creates the invoice in the list | Receipt printing (shows a preview only), ETA QR placeholder |
| 2 | **Purchase invoice** | Supplier pick, add lines with batch, expiry, buy price, state-fixed public price, bonus, totals, margin; "save" adds batches to stock | Supplier statements |
| 3 | **Item list / item card** | Search, filters (drug/non-drug, suspended), add/edit card with units and conversion, barcodes, price rules (drug fixed, non-drug free), alternatives | Import |
| 4 | **Customer list** | Search, filters, add/edit, balance, credit limit, suspend | Statements |
| 5 | **Shortage notebook** | Add from item or from a "no stock" sale attempt, filters, "available in other stores/branches" (quantities only), convert to a draft purchase order | Supplier ordering |
| 6 | **Cash receipt** (توريد نقدية) | Customer payment against balance, updates balance | Bank/safe accounts |
| 7 | **Report centre (sample)** | One screen with filters, grouping, saved view, export button (mock) over 3 sample reports: sales by day, expiry in 90 days, shortages | The other ~74 reports |
| 8 | **Deleted-items view** (D13) | Management-only list of voided invoices, archived items, removed lines with who/when/why and Restore | - |
| 9 | **Role switcher** | Switch between Owner, Manager, Pharmacist, Cashier, Storekeeper to see how screens and buttons change (cost/profit hidden for Cashier; deleted view hidden for staff) | - |
| 10 | **Branch switcher (Chain preview)** | Two sample branches; "available in other branch" lookup and a transfer request card | Full transfer workflow (Phase 8) |

Not in the demo: stocktake, sales return screen, contracts/insurance, drawer closing, settings, payroll/HR, customer app, anything needing screens the owner has not yet sent (list in `estock-inventory.md` section 7). The demo may add a placeholder card for each so testers can say what they expect.

## 4. "His way" improvements to show (each is a proposal the testers accept or reject)
1. Cashier screen shows **no cost or profit** unless the role has the grant (eStock shows both).
2. **Batch and expiry chosen automatically (FEFO)**, with one key to change batch.
3. A "no stock" attempt offers **one-click add to shortages** and shows quantities in other stores/branches.
4. **One report centre** instead of many separate report windows.
5. **Void with reason** instead of delete; deleted items visible to management only (D13).
6. Keyboard-first cashier flow (barcode, quantity, Enter, F-keys), with the key tips shown in the ribbon.
7. A day-end summary card (sales, returns, voids, cash difference) at the top of the sales tab.

## 5. Seed data
- **About 250 items** (the generator produced 250; more can be added on request), mixed drug and non-drug, each with 1-3 batches (different expiries, some within 90 days, some expired), units (box/strip), barcodes, a few with alternatives. Names are **generic active-ingredient names plus strength** (no brand marketing claims) so we do not misuse trade names; prices are plausible and fictional.
- 40 customers (cash, credit with balances and limits, one contract customer), 15 suppliers, 2 branches, 2 internal stores.
- About 150 past invoices over 30 days, enough for the sample reports and the shortage average-sales column.
- A few deliberate traps: an item with zero stock, an expired batch, a customer over the credit limit, an item suspended.
- No real patient, customer or supplier data. If the owner wants his own item names later, he supplies them and we load them only inside his private copy.

## 6. Non-functional targets for the demo
- Opens in under 3 seconds on a mid-range phone on mobile data; works offline after first load (a free way to feel the "offline" promise, no sync implied).
- Barcode-to-line response under 100 ms on 300 items (the 25k-item test is spike S4).
- Arabic digits and separators follow the owner's rule: separators are "-", never a middle dot.
- Accessible contrast and keyboard operation on desktop; touch targets at least 44 px on phone.

## 7. Acceptance (what "done" means)
1. The owner can complete, on a PC and again on his phone, in under 10 minutes on each: make a cash sale with 3 lines, hold one sale and resume it, void one invoice with a reason, add a shortage from a no-stock attempt, record a purchase invoice, record a customer payment, and open the deleted-items view.
2. Role switcher changes visible data as in section 4 item 1 and the matrix (`permission-matrix.md`).
3. Every Ribbon behaviour in D12 works (collapse, expand, Quick Access, key tips; phone bottom bar and side menu). Every screen is checked on desktop and phone, and any screen left out of the phone version is listed for the owner's approval (D31). The product name appears as "O Pharmacy" in Latin letters everywhere (D30).
4. Each testers' feedback is captured in a **change list** (table: screen, what he expects, priority) kept in `docs/specs/demo-feedback.md`; the list becomes the input to Phase 2/3 design.
5. No real data, no network calls after load, no secrets in the page.

## 8. Plan inside Phase 1 (indicative, no dates)
Ribbon shell (reuse of spike S5) - seed data generator - screens 1-2 (the heart) - screens 3-6 - 7-10 - owner test round - change list - Phase 1 report and doc updates. Sprints are defined at the start of Phase 1 from Phase 0 estimates.

## 9. Decisions needed from the owner
1. Approve the screen list (section 3), or add/remove screens.
2. Approve generic drug names in seed data (instead of trade names).
3. Who are the 2-3 pharmacist testers, and which devices do they use (PC, phone, both)?
4. Send the missing eStock screens when convenient: add-item form, stocktake, sales return, contracts, drawer closing, settings; and the printed receipt photo.
