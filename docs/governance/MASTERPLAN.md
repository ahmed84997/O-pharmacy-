# O Pharmacy - Masterplan

Version 1.1 - 11 Nov 2026. Status: **v1.0 approved; v1.1 for owner approval**. Business and product plan. Facts come from `docs/research/` (vendor claims are unverified); decisions D1-D31 are in `ARD.md` §2; items marked **[ASSUMPTION]** or **[LATER]** are not decided.

Change log: v1.1 - product name "O Pharmacy" in English (D30), desktop-first with an effective phone version (D31), Phase 0 findings in risks, effort estimates (see ROADMAP) - v0.1 first draft - v0.2 4-product package, two editions, white-label app, Hub install model - v1.0 candidate: aligned with ARD v1.0 (chain rules, roles, security, e-receipt, code name).

## 1. Mission
Give Egyptian pharmacies one modern, Arabic-first package that runs the whole business, keeps selling when the internet is down, and fixes the daily operational mess (shortages, customer requests, purchases, staff discipline) that classic programs ignore - plus the pharmacy's own app for its customers.

## 2. The package (D8)
1. **System** - sales/POS, inventory, purchasing, accounts, contracts/insurance, reports.
2. **Operations** - customer requests, shortages, PO stages, tasks, attendance, alerts, AI (built from the proven YK base, D5).
3. **Customer App** - white-label, one per pharmacy (D9).
4. **Customer Website** - the app in the browser.
Editions (D11): **Single pharmacy** and **Chain**. Product name: **O Pharmacy**, always in Latin letters, also inside Arabic screens (D30); logo and identity come near launch.

## 3. Market position
- **Incumbents:** B-Connect (ePlus / eChain) claims about 35% of Egyptian pharmacies (16,000, self-reported); eStock by Modern Soft (the owner's current program); a long tail of desktop programs (e.g. Titan by Laberdo); regional ERPs (dawaTech, Dexef, Daftra).
- **What eStock looks like:** Windows desktop, menu-heavy (156 menu entries, 77 of them reports), manual updates, local backups, no e-receipt or track-and-trace visible, thin ordering, no customer channel.
- **Our edge [ASSUMPTION - to prove in the pilot]:**
  1. Familiar eStock-like workflows → short training.
  2. Modern Ribbon UI (D12), desktop first with an effective phone version (D31), and one report centre.
  3. Offline-safe branch Hub + cloud: auto-updates, off-site backups, remote view (D6, D7); runs on Windows, Mac and Linux (D27) where most local programs are Windows-only.
  4. Operations depth from YK + AI.
  5. The pharmacy's own customer app.
  6. Anti-theft by design: nothing is really deleted, every deletion is visible to management (D13).
  7. Security as a selling point: defence-in-depth cloud isolation (D25).
  8. Compliance-ready: ETA e-receipt (D26), track and trace.
- **Main risk:** switching cost and trust. Answer: free import from eStock/other programs, side-by-side pilot, local support.

## 4. Target customer (Egypt first, D3)
- Phase A: the owner's own pharmacy (pilot, Single edition).
- Phase B [ASSUMPTION]: independent pharmacies (Single) and small/medium chains of 2-20 branches (Chain). The product fits both a small pharmacy where one person is Admin, Manager, pharmacist and cashier, and a chain with separate roles (D23).

## 5. Product strategy
1. Rebuild the eStock feature baseline, then improve every detail the owner's way (D4).
2. Differentiate with Operations, AI and the customer app.
3. Offline-first architecture (Hub + cloud).
4. Pharmacy-correct pricing: state-fixed medicine prices per batch, FEFO selling, free non-drug prices (D14, D20, D21).
5. Quality over speed: no launch date before Phase 0 estimates (D10).

## 6. Business model **[LATER]**
Per-branch subscription by edition plus add-ons (Customer App + Website, insurance, AI, extra devices, dedicated server tier), setup/import fee, training. Competitor prices are not public; collect them in Phase 0 demos. Customer app (D29): we prepare each pharmacy's build from our white-label base; the pharmacy publishes it on its own App Store / Google Play accounts and pays their fees; we charge for the build and its updates.

## 7. Go-to-market [ASSUMPTION - to discuss before Phase 12]
Pilot at the owner's pharmacy → case study → 3-5 friendly pharmacies → referrals and pharmacist communities → sales and support team. The eStock import service and the customer app are the main sales hooks.

## 8. Governance
Owner decides; Claude drafts and builds. Phase gate on every step. Documents live in the O-Pharmacy repo (`docs/`) and the "O-Pharmacy" Claude Project; ARD / Roadmap / Masterplan are versioned and updated in the same PR as any change that affects them.

## 9. Risks
| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope is very large | 4 products + 2 editions, regulated | Phases, demo first, pilot before selling |
| Offline/sync correctness | Stock and money must never drift | Ledger design, spike S2, reconciliation tools |
| Hub reliability on 3 platforms | The branch depends on one computer; 3 OSes triple the test matrix | Cloud copy, quick re-install, device fallback queue, one shared code base, CI on all three (S1) |
| Code-signing costs | Windows certificate, Apple Developer ID | Deferred to the commercial launch (D28); part of the price |
| Printing hardware variety | Many printer models | Print service with a tested printer list (S3); real printers tested with the Friday kit |
| Windows disk stalls | 0.4-2 s commit stalls seen on the CI runner (S4) | Re-measure on a real PC in the pilot; keep writes short, one writer per branch |
| Experimental `node:sqlite` | Built in but marked experimental in Node 22 | Re-check on Node 24 LTS before Phase 2; wrapper keeps the driver replaceable |
| Phone scope creep | D31 asks for an effective phone version too | Phone screens listed per phase, cashier operation stays desktop |
| Tenant data leak | Fatal for trust | RLS, per-tenant keys, isolation tests, dedicated tier, pen test (D25, S6) |
| Compliance unknowns | Could change the sale/stock design | Phase 0 research on ETA and EDA rules |
| Incumbent lock-in | Switching cost | Import tools, side-by-side pilot |
| White-label app overhead | One build and store listing per pharmacy | Automated build pipeline; listings on the pharmacy's own accounts (D29); priced add-on |
| Owner time | Doctor with several jobs | Small steps, short reports, decisions batched |

## 10. Success metrics [ASSUMPTION - numbers set after Phase 0]
Pilot: a month of closed days with no unexplained differences; zero selling downtime; cashier speed at least eStock's. Commercial: live pharmacies, churn, import time per pharmacy, support tickets per branch, app orders per pharmacy.

## 11. Next steps
1. Owner reviews ARD, Roadmap and Masterplan v1.1 and the effort estimates (decision D-P7: pilot after Phase 4?).
2. Owner runs the printer test kit at the pharmacy (Friday 13 Nov) and answers the compliance questions.
3. Owner approves the Phase 1 demo specification, then says "go" for Phase 1.
4. Owner sends the missing eStock screens when convenient (receipt received).
