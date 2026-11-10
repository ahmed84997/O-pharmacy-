# YK Integrated Pharmacy System - Competitor Research (v1.2, 10 Nov 2026)

Owner decisions (10 Nov 2026): (1) a full all-in-one system, (2) commercial product, (3) Egypt first, (4) rebuild an eStock-like system first as the initial vision and re-engineer every detail. v1.1 adds the two Egypt competitors he named (section 3b).

Status: DISCUSSION INPUT. No ARD / roadmap / masterplan decisions are taken here. Nothing in the YK-Pharmacy repo was changed.

## 1. Scope and method
- Goal: map who we would compete with if YK grows from an operations layer on top of eStock into an integrated pharmacy system, and which gaps/regulations shape the scope.
- Method: public web pages only (vendor sites, news, regulator pages). Vendor pages are marketing: every capability below is a CLAIM, not verified. No prices were found for any vendor (all push a demo).
- Not yet seen: the eStock screenshots from the owner (needed to define the integration boundary), vendor demos, real customer reviews.
- Not checked: EDA's official text of pharmacy obligations (the EDA page for 4 Mar 2026 gives no pharmacy technical requirements).

## 2. Market map (four tiers)
| Tier | Players found | What they sell |
|---|---|---|
| A. Pharmacy ERP/POS, regional | dawaTech (EG/KSA/JO), Dexef (EG/KSA/IQ), Daftra (EG/MENA), Juleb (KSA) | POS + inventory + purchasing + accounting + regulatory reporting |
| B. Horizontal ERP with pharmacy modules | Odoo (+ third-party pharmacy apps), LS Central via Novasoft (UAE), LogicERP, generic Indian ERPs | Configurable ERP, localization by partner |
| C. Marketplace / benefits platforms | Chefaa, Yodawy, MEDOC portal (corporate insurance claims) | Demand, e-prescription, insurance/PBM, commissions - not a pharmacy back office |
| D. The chains themselves | El Ezaby (350+ branches), Seif (80+), Roshdy, Misr, El-Kamal, Nour, Care | Reference customers / what a "big" pharmacy expects; likely run in-house or enterprise systems (unverified) |

eStock (our current system of record): **e-Stock Pharmacy Ver 1.8.4 Full by Modern Soft Company** (from the owner's screenshots, 10 Nov 2026) - Windows desktop, Master PC + connected PCs, ~156 menu entries (about 77 reports). Full inventory: `estock-inventory.md`. (The Indian 'eStock ERP' listing found online is a different product.)

## 3. Competitor profiles (claims as published)
**dawaTech** - closest all-in-one competitor. Products: ERP (POS, inventory, purchasing, accounting, regulatory reporting), dawaOrder (B2B ordering, "up to 15%" savings claim), dawaSearch (consumer stock search), AI agents (pharmacist: interaction check at POS; inventory: expiry/shortage/slow-mover with one-click transfer/order/discount; accountant: receivables/aging). Integrations: SFDA, Wasfaty, Rasid, NPHIES, ZATCA, EDA, JFDA; Tabby, Tamara, Geidea, Paymob, WhatsApp; Talabat, HungerStation, Jahez, InstaShop; Salla, Shopify. Chains: testimonial from Al-Kamah (12 branches). Case-study page returned 404. Pricing: none.
**Dexef** - editions ONE / POS / Smart / ERP; alternative-drug linking for out-of-stock items, batch/expiry alerts, multi-warehouse + inter-branch transfers, QR invoices. Insurance not mentioned on the page. Direct sales EG/KSA/IQ. 30-day trial, 3-month refund.
**Daftra** - cloud ERP; insurance companies + coverage rules + automatic discounts; per-cashier shift sessions; offline POS; patient files; per-branch and consolidated reports; AI for invoice matching and expense extraction (overlaps our invoice audit). Egypt ETA detail is thin on the page.
**Juleb (KSA)** - ERP + POS offline mode + Juleb Rx (e-prescription) + Wasfaty; ZATCA/Fatoora, RSD, GS1; Salla/Shopify/HungerStation/Geidea. "Advanced forecasting" only as a caption.
**Odoo** - inventory with lots/expiry, POS with promotions, pricelists (B2B), multi-pharmacy. Page does not mention Egypt localization; local e-receipt/ETA support comes from third-party vendors (e.g. an ERPNext/Odoo ETA e-receipt app seen in search - unverified).
**Novasoft / LS Central (UAE)** - insurance e-claims in the UAE (Daman, Tawuniya, ADNIC etc.; pre-auth at counter, copay split, daily claim batches, 30-45 day reconciliation); controlled-drug rules; 8-12 weeks for a 10-branch rollout. Article says insurance is 40-70% of UAE pharmacy revenue.
**Chefaa** (~4.5M monthly users, 1,600+ pharmacies, commission from 5%, 8 Saudi cities) and **Yodawy** (PBM + e-prescription gateway, USD 34.5M raised) - estimates from Ken Research, a promotional summary; treat as indicative. **MEDOC portal** - corporate-insurance approvals/claims for pharmacies; states it is not a POS/inventory/CRM.


## 3b. Egypt competitors named by the owner (added 10 Nov 2026)
**B-Connect (Electronic Information System Co., SAE, founded 2004)** - site: bconnect-egypt.com. Products: **ePlus** (POS for a single pharmacy) and **eChain** (integrated system for pharmacy chains and central warehouses). Claims "35% of the pharmacies market share in Egypt" and 16,000 pharmacies on its technology (self-reported, unverified; if even partly true it is THE incumbent). Partners listed: SAP, Huawei, Fawry, PaySky, Odoo, AWS, Supply Chain Junction. Page gives no module list, no pricing, demo by contact. Not checked: whether eStock is theirs (unknown), their ETA e-receipt and insurance support, customer reviews. LinkedIn page blocked to our fetcher.
**Titan / تيتان (pharmacy management program)** - the only match found is "Titan" by Laberdo Software (pharorg.com), NOT a company called "Titan Soft Tech"; the identity is UNCONFIRMED, ask the owner which one he means. Claims: drug databases for Arab countries, patient history with interaction/contraindication detection, hundreds of reports (expiry, shortage, staff monitoring), alternatives search at dispensing, ZATCA e-invoicing support, runs on low-spec Windows, Android app link. Editions, multi-branch, insurance, pricing: not stated. Appears small / desktop-first (the page itself says it is not a commercial company). Unverified.
Implication: Egypt has a very large incumbent (B-Connect, chains + warehouses + single POS) and a long tail of small desktop programs. A commercial all-in-one entering Egypt competes on switching cost, compliance (ETA e-receipt, track and trace, insurance) and workflow depth, not on a missing POS.

## 3c. Chain-capable systems seen (added v1.2)
- **Aumet (chain module):** inter-branch transfers, central purchasing, unified stock visibility, central pricing/roles, offline POS; markets KSA, Jordan, France (Egypt not listed).
- **LS Retail at Delmar & Attalla (Egypt):** 20 stores, 120 POS terminals; stock redistribution between branches, insurance control, delivery and loyalty reported as benefits.
Details and the editions analysis: `editions-single-vs-chain.md`.

## 4. Capability matrix: market vs YK today
Legend: Y = claimed by at least one competitor; YK = built in YK V1.0.1 (from repo handoff); gap = not in YK.
| Capability | Market | YK today |
|---|---|---|
| POS / cashier sessions | Y (all) | gap (eStock owns it) |
| Inventory, batches, expiry, transfers | Y (all) | gap by design (`external_ref` only) |
| Purchasing / PO | Y | partial: PO follow-up by stages, receipt, entry, shelving, returns; no ownership of stock/price |
| Invoice reading / matching with AI | Daftra (claim) | YES - receipt vs eStock entry audit, notes, alerts |
| Out-of-stock customer requests + shortages workflow | not seen on any vendor page | YES - core of YK (requests, items state machine, notification, delivery) |
| Staff tasks, attendance, closings, cash, ranking | not seen as pharmacy-vendor features | YES |
| WhatsApp customer messaging | dawaTech lists WhatsApp | built, dormant (go-live deferred; Meta onboarding blocker noted) |
| Insurance / claims | Daftra, Novasoft, MEDOC | gap |
| Accounting / profit per branch | Y | gap (finance is Admin-only inside YK; no ledger of pharmacy) |
| Regulatory reporting (EDA, SFDA...) | dawaTech claim | gap |
| e-receipt / e-invoice | Y (KSA ZATCA; Egypt ETA via partners) | gap |
| Delivery platforms / e-commerce / BNPL | dawaTech, Juleb | partial: home delivery state only |
| Multi-branch | Y | data model ready, behaviour = Phase 13 |
| AI assistants | dawaTech agents; Daftra | YES (ops assistant, digest, prescription photo read, invoice audit) |

## 5. Regulatory drivers (shape the scope)
**Egypt**
- E-receipt (ETA): applies to VAT-registered entities issuing sales receipts incl. retail; needs ETA-approved POS/software, real-time submission, QR, Class 2+ certificate, 5-year logs; fines up to EGP 50,000 per violation; no fixed national deadline on the page we read (check ETA). Source: Wafeq (secondary).
- Pharmaceutical track & trace: phase 1 launched 4 Mar 2026 (imported narcotics first, chains El Ezaby and Esaaf reported as started). Pharmacies scan the data-matrix code per pack (Mada Masr). Decrees 475/2025 and 161/2025 cover serialization; one commentary (Maven) covers manufacturers/distributors only. EDA's 4 Mar page gives pharmacies no technical interface. => Dispensing-point requirements UNKNOWN; must be read from the decrees/EDA before scoping.
- Universal Health Insurance and the Unified Procurement Authority are changing who pays and who buys; effect on private pharmacies not established in this research.
- Market signals: shortages (~500 items, down from ~1,000 peak), e-pharmacy compliance with Decree 238/2023 reportedly only ~30%, National Digital Health Strategy 2025-2029 (Ken Research - indicative).
**KSA**: ZATCA phase 2, SFDA RSD, Wasfaty, NPHIES (dawaTech/Juleb list all). **UAE**: insurer e-claims dominate (Novasoft); Shafafiya/Malaffi/DHA details NOT verified.

## 6. Preliminary observations (analysis, not facts)
1. Tier A competes on breadth + compliance + integrations. A full ERP is a crowded, regulation-heavy race with established regional players.
2. YK's strongest, rarest assets are operational: out-of-stock requests, shortage handling, PO stage tracking, staff accountability, AI invoice audit. None of the vendor pages we read describe an equivalent request-to-delivery workflow (absence on marketing pages is weak evidence; verify in demos).
3. The competitors' AI is moving toward inventory/expiry/interaction checks and invoice matching; YK already has the last one.
4. The biggest unknown is the eStock boundary: how much of POS/inventory/accounting we can read or must own to be a "complete system" without breaking the `external_ref` rule.
5. Insurance and e-receipt/track-and-trace are the features that decide whether a pharmacy can switch systems at all.

## 7. Decisions needed before the ARD / roadmap
DECIDED by the owner on 10 Nov 2026: (1) full all-in-one system, (2) commercial, (3) Egypt first, (4) start with an eStock-like demo and rebuild every detail his way.
Still open: (a) the eStock screenshots; (b) which Titan he means; (c) the demo's data source (screens only vs real data); (d) build-vs-integrate for compliance (e-receipt provider, track and trace, insurance); (e) the new system lives in a NEW repo/product - the YK ops platform's eStock-boundary rule stays untouched, with YK as the first integrated module (needs his confirmation).

## 8. Next research (if approved)
- Read EDA decrees 475/2025 and 161/2025 for dispensing-point duties; ETA e-receipt deadlines for pharmacies.
- Book dawaTech and Dexef demos; get real pricing.
- Study the owner's eStock screenshots, list modules/fields, define the integration/CSV boundary.
- Chain-side interviews (El Ezaby-size needs) - optional.

## 9. Sources
- dawaTech: https://dawatech.com (case-study page 404)
- Dexef: https://dexef.com/system-pharmacy
- Daftra: https://www.daftra.com/برنامج-إدارة-الصيدليات/
- Juleb: https://juleb.com/blog/best-pharmacy-management-system-in-Saudi-Arabia/en
- Novasoft (UAE): https://novasoft-website.pages.dev/blog/pharmacy-erp-uae-insurance-daman/
- Odoo pharmacy: https://odoo.com/industries/pharmacy
- MEDOC: https://medoc.care/en/blog/medoc-pharmacy-portal-in-egypt
- LogicERP chain guide: https://www.logicerp.com/blog/how-to-manage-multi-store-pharmacy-chains-with-pharma-retail-erp-software-a-complete-guide/
- Wafeq e-receipt: https://www.wafeq.com/en-eg/tax-and-reporting/e-receipt-system
- EDA track & trace launch (4 Mar 2026): https://edaegypt.gov.eg/en/media-center/news/eda-chairman-launches-the-first-phase-of-the-pharmaceutical-track-and-trace-system-at-giza-ambulance-pharmacy/
- Mada Masr: https://www.madamasr.com/en/?p=393230
- Maven (decrees 475/2025, 161/2025): https://www.mavenrs.com/blog/egypt-pharmaceutical-serialization-track-and-trace-compliance-2026
- Ken Research (e-pharmacy): https://kenresearch-articles.blogspot.com/2026/05/egypt-e-pharmacy-market-at-usd-59m.html
- Shore Africa (chains): https://shore.africa/2026/02/14/largest-pharmacy-chains-egypt
- B-Connect: https://bconnect-egypt.com/ - United Group page: https://unitedgroup-ho.com/b-connect/
- Titan (Laberdo): https://www.pharorg.com/phye/
- Aumet chain: https://aumet.com/chain/
- LS Retail - Delmar & Attalla: https://www.lsretail.com/customers/delmar-attalla
