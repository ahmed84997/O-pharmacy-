# O Pharmacy - Phase 1 demo (clickable, no backend)

Desktop first, good on the phone (D31). Name shown as "O Pharmacy" (D30). Browser-only data that resets on reload; no network calls after load (the font is the only external file).

- `npm ci && npm run dev` - run locally; `npm test` - business-logic tests; `npm run build` - one self-contained `dist/index.html`.
- `src/domain.ts` pure logic (FEFO, sale, void, hold, purchase, shortages); `src/seed.ts` deterministic seed data (generic drug names, fictional people); `src/ribbon.ts` the Ribbon definition; screens in `src/*.tsx`.

## Sprint 1.1 scope (done)
Ribbon shell (tabs, collapse, Quick Access, Alt key tips on the Arabic keyboard, role switcher, phone bottom bar and drawer), seed data, **screen 1 sale invoice**, **screen 2 purchase invoice**, plus simple items list, shortage notebook, invoice log with void, and the management-only deleted view.

## Sprint 1.2 scope (done)
Customers (add, edit, limit and suspend by management, statement), cash receipt, item card (drug price locked, alternatives, batches), shortages to a prefilled purchase draft, card layout on phone for tables.

## Sprint 1.3 scope (in PR)
Report-centre sample (sales by day / type / user, expiry window, shortages; filters, in-memory saved views, CSV copy as mock export; cost and profit for owner and manager only), Chain preview (other-branch availability with data age, transfer request: requested - accepted - dispatched - received, stock arrives only on received), restore from the deleted view (voided invoices and suspended items, management only), and an in-demo feedback panel (screen auto-captured, text, priority, copy all as a markdown table).

## Not in the demo
Returns, delivery, drawer close, stocktake, suppliers screen, price comparison, accounts: they open a "soon" page. They belong to later phases.
