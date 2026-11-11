# O Pharmacy - Phase 1 demo (clickable, no backend)

Desktop first, good on the phone (D31). Name shown as "O Pharmacy" (D30). Browser-only data that resets on reload; no network calls after load (the font is the only external file).

- `npm ci && npm run dev` - run locally; `npm test` - business-logic tests; `npm run build` - one self-contained `dist/index.html`.
- `src/domain.ts` pure logic (FEFO, sale, void, hold, purchase, shortages); `src/seed.ts` deterministic seed data (generic drug names, fictional people); `src/ribbon.ts` the Ribbon definition; screens in `src/*.tsx`.

## Sprint 1.1 scope (done)
Ribbon shell (tabs, collapse, Quick Access, Alt key tips on the Arabic keyboard, role switcher, phone bottom bar and drawer), seed data, **screen 1 sale invoice**, **screen 2 purchase invoice**, plus simple items list, shortage notebook, invoice log with void, and the management-only deleted view.

## Not yet (Sprint 1.2 and 1.3)
Customer list, cash receipt, report centre sample, branch switcher, restore from deleted view, item card form, purchase table card layout on phone.
