# O-Pharmacy - Masterplan

Version 0.2 DRAFT - 10 Nov 2026. Business and product plan. Facts come from `docs/research/` (vendor claims are unverified); everything else is marked **[ASSUMPTION]** or **[OPEN]**.

Change log: v0.1 first draft - v0.2 adds the 4-product package, two editions, white-label app, the Hub install model, the eStock baseline and the owner's "no rush" principle.

## 1. Mission
Give Egyptian pharmacies one modern, Arabic-first package that runs the whole business, keeps selling when the internet is down, and fixes the daily operational mess (shortages, customer requests, purchases, staff discipline) that classic programs ignore - plus the pharmacy's own app for its customers.

## 2. The package
1. **System** - sales/POS, inventory, purchasing, accounts, contracts/insurance, reports.
2. **Operations** - customer requests, shortages, PO stages, tasks, attendance, alerts, AI (built from the proven YK base).
3. **Customer App** - white-label, one per pharmacy.
4. **Customer Website** - the app in the browser.
Editions: **Single pharmacy** and **Chain**.

## 3. Market position
- **Incumbents:** B-Connect (ePlus / eChain) claims about 35% of Egyptian pharmacies (16,000, self-reported); eStock by Modern Soft (the owner's current program); a long tail of desktop programs (e.g. Titan by Laberdo); regional ERPs (dawaTech, Dexef, Daftra).
- **What they look like (eStock as the reference):** desktop app, menu-heavy (~156 menu entries, about half reports), manual updates, local backups, no e-receipt or track-and-trace visible, thin ordering, no customer channel.
- **Our wedge [ASSUMPTION]:** familiar eStock-like workflows (short training) + modern Ribbon UI + offline-safe Hub + cloud (auto-updates, backups, remote view) + the YK operations depth + the pharmacy's own customer app + compliance-ready.
- **Main risk:** switching cost and trust; pharmacies change systems rarely. Answer: free import from eStock/other programs, side-by-side pilot, local support.

## 4. Target customer (Egypt first)
- Phase A: the owner's own pharmacy (pilot, Single edition).
- Phase B [ASSUMPTION]: independent pharmacies (Single) and small/medium chains of 2-20 branches (Chain). Very large chains (hundreds of branches) are not the first target.

## 5. Product strategy
1. Rebuild the eStock feature baseline, then improve every detail the owner's way.
2. Differentiate with Operations (YK), AI and the customer app.
3. Offline-first architecture: Branch Hub + cloud.
4. Compliance-ready (ETA e-receipt, track and trace, insurance) as rules become mandatory.
5. Quality over speed: no fixed launch date until Phase 0 is done.

## 6. Business model **[OPEN]**
Per-branch subscription by edition (Single / Chain) plus add-ons (Customer App + Website, insurance, AI, extra devices), setup/import fee, training. Competitor prices are not public; collect them in Phase 0 demos. White-label app publishing per pharmacy has its own cost (store accounts, builds) to price in.

## 7. Go-to-market [ASSUMPTION - to discuss]
Pilot at the owner's pharmacy → case study → 3-5 friendly pharmacies → referrals and pharmacist communities → sales and support team. The eStock import service and the customer app are the main sales hooks.

## 8. Governance
Owner decides; Claude drafts and builds. Phase gate on every step. Documents live in the O-Pharmacy repo (`docs/`) and the "O-Pharmacy" Claude Project; ARD / Roadmap / Masterplan are versioned and updated in the same PR as any change that affects them.

## 9. Risks
| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope is very large | 4 products + 2 editions, regulated | Phases, demo first, pilot before selling |
| Offline/sync correctness | Stock and money must never drift | Ledger design, Phase 0 spike, reconciliation tools |
| Windows Hub reliability | The branch depends on one PC | Cloud copy, quick re-install, device fallback queue |
| Printing hardware variety | Many printer models in pharmacies | Print service with tested drivers list |
| Compliance unknowns | Could change the sale/stock design | Read decrees/ETA rules in Phase 0 |
| Incumbent lock-in | Switching cost | Import tools, side-by-side pilot |
| White-label app overhead | One store listing per pharmacy | Automated build pipeline, priced add-on |
| Owner time | Doctor with several jobs | Small steps, short reports, decisions batched |
| Security/data loss | Trust is the product | Audits, backups, tenant isolation |

## 10. Success metrics [ASSUMPTION - set numbers in Phase 0]
Pilot: a month of closed days with no unexplained differences; zero selling downtime; cashier speed at least eStock's. Commercial: live pharmacies, churn, import time per pharmacy, support tickets per branch, app orders per pharmacy.

## 11. Immediate next steps
1. Owner creates the empty private GitHub repo `O-Pharmacy`; Claude pushes the documents.
2. Owner answers the open questions (editions study §9, ARD §15).
3. Owner sends the missing eStock screens (inventory §7).
4. Approve the Phase 0 plan → start the spikes.
