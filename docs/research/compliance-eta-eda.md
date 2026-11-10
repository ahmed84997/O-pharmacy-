# Compliance Research - ETA e-receipt and EDA track and trace - v1.0

10 Nov 2026. Phase 0, Sprint 0.1. Status: research input for the ARD (D26) and Roadmap Phase 4 / Phase 10. Every claim carries a source tag: **[OFFICIAL]** government or regulator text, **[PRESS]** news report, **[VENDOR]** a company selling compliance software or services (treat as unverified). Items not found are listed in section 5 - they are not assumed.

## 1. Summary
| Topic | What we know | What we do not know yet |
|---|---|---|
| ETA e-receipt | Mandatory for the health sector (pharmacies included) in Greater Cairo and Alexandria from 15 Mar 2025 [PRESS]. Each sale gets a UUID, is sent to ETA in real time (24 h window), and the printed copy carries a QR [VENDOR]. | Offline rules, numbering, approved-provider route, penalties, whether small pharmacies outside Cairo/Alexandria are now covered. |
| EDA track and trace | National system established by EDA Decision 475/2025 [PRESS quoting the Gazette]. Phase 1 (imported drugs from 1 Feb 2026) puts the duty on importers, manufacturers and distribution centres [OFFICIAL]. 2D Data Matrix on every secondary pack [OFFICIAL]. | Any duty on pharmacies at dispensing (scan, report, verify). No pharmacy API is published. |

Bottom line for the design: ETA is a **hard requirement we must be ready for at the first real pharmacy (Phase 4/7)**. EDA is a **watch item**: build the data fields and scanning ability early so we are not redesigning when the pharmacy phase is published.

## 2. ETA e-receipt
### 2.1 Facts
- Legal base: Unified Tax Procedures Law No. 206 of 2020; e-receipt rolled out in phases [PRESS, 2022 article quoting ETA].
- Phase 7, sub-phase 1: **health, personal care and telecom** sectors in Greater Cairo and Alexandria, mandatory from **15 March 2025**, under Finance Minister Decision 38 of 2024. The article lists 3,193 facilities in scope: hospitals, clinics, laboratories, radiology centres and pharmacies [PRESS: alborsaanews, 13 Mar 2025]. Taxpayers register on the incentive-program portal "Fatortak - Hemayetak wa Gayezatak".
- History: in Nov 2022 the Pharmacists Syndicate asked for an exemption (small businesses, price-controlled goods, about 15,000 items some taxable and some not). ETA answered that joining is mandatory; pharmacies serving only end consumers could request postponement; the dates then were 15 Apr 2023 (Greater Cairo, Alexandria) and 15 Jul 2024 (other governorates) [PRESS: elbalad, 25 Nov 2022 - dates may have changed].
- Technical shape (vendor summaries of the ETA process): register the ERP/POS as a connected system to get API credentials; register and activate **each POS by serial number**, linked to the taxpayer registration number and the **branch**; each POS authenticates to ETA for a token; unregistered or blocked devices are rejected; each receipt has a **UUID**, duplicates must be blocked; submission is real time, with a **24 hour** window and a "late submission" process beyond it; no electronic signature on receipts (unlike e-invoices); the printed customer copy carries an **ETA QR** linking to the receipt record; goods and services must be **coded** [VENDOR: Petra/Pharmacare, Flick Network; Flick cites ETA Decision 281/2025 without reproducing it].

### 2.2 Design consequences (proposed, for owner approval with ARD v1.1)
1. **Adapter, two routes (D26 stands):** direct to ETA, or via an approved provider; one internal interface so the sale flow never depends on the route.
2. **Sale line data:** every item needs an **ETA item code** field (and the taxable/exempt flag) in master data - add to the Phase 3 item model, not later.
3. **Sale document:** a UUID is generated on the Hub at sale time (works offline); the ETA submission is an **outbox message** with retry and a **24 h deadline clock**.
4. **Offline:** the Hub keeps selling; the receipt queue is drained when the internet returns; a visible alert when any receipt is close to its 24 h limit (this is a product feature, not just a log).
5. **Device registry:** each cashier terminal is a registered POS (serial, branch, activation state) in Foundation, so a new terminal cannot sell until activated.
6. **Printed receipt:** reserve space for the QR; sample receipt from the owner's pharmacy still needed (Sprint 0.3).
7. **Void/return:** ETA has return and cancel documents; our No-Delete rule (D13) matches, but the exact document types must be confirmed from the ETA SDK before Phase 4.
8. **Becoming an approved supplier** (D26 aim): requirements not found - see open items.

## 3. EDA track and trace (EPTTS)
### 3.1 Facts
- **EDA Decision 475/2025** (Al-Waqa'i Al-Misriyya issue 176, supplement, 11 Aug 2025) creates the national electronic system for human and biologic medicines: a secure programme that records each pack from production or import, through storage and distribution, until it is **dispensed to a patient**, exported or destroyed [PRESS: almasdar]. The marketing-licence holder is defined broadly; the text we could read sets no specific pharmacy duty.
- **Decision 161/2025** covers standardised data structures for commercial secondary packaging [VENDOR: Maven; unverified].
- **EPTTS Phase 1 Technical FAQ** [OFFICIAL, EDA document EDREX:NP.CIP.009, document control shows v1.5 dated 2026-04-08 while the cover shows v2.0 dated 19/04/2026 - confirm the current version]:
  - Applies to shipments dated on or after **1 February 2026**; covers all products made locally or imported.
  - The **importer** is legally accountable for commissioning, aggregation, shipping and receiving reports; distribution centres cannot serialise or reprint barcodes.
  - Serialisation is at **secondary packaging = the smallest saleable unit dispensed to patients**.
  - Code: **Data Matrix ECC 200** encoding GTIN (AI 01), serial (21), expiry YYMMDD (17), batch (10); if only month and year are known the last day of the month is used; human-readable text next to the code.
  - Reporting in Phase 1 is by **manual CSV upload; no API**; XML/API integration and alignment with EPCIS 2.0 are planned for later phases.
- Rollout reported by the press: pilot in about **3,000 pharmacies** from early 2026; mandatory for imported drugs from 1 Feb 2026; for all locally manufactured drugs from **1 Aug 2026** [PRESS: cairo24]. That article does not say whether the pharmacist must scan at dispensing.
- A headline (not read in full) says a Pharmacy Division member called the cost of applying track and trace to pharmacies "zero" [PRESS: almalnews].

### 3.2 Design consequences (proposed)
1. **Item master:** store **GTIN(s)** per item/pack (many GTINs per item already exist for barcodes - eStock calls them barcodes).
2. **Receiving:** the purchase invoice screen must be able to capture **batch, expiry and (optionally) serial** by scanning a Data Matrix; parse GS1 application identifiers 01/10/17/21 on the Hub. Make serial capture a **configuration**, off by default, so we do not slow the pharmacy before it is required.
3. **Stock ledger:** allow an optional serial per movement line (nullable column from day 1; adding it later is expensive).
4. **POS:** hardware matters - a **2D imager barcode reader** is needed to read Data Matrix; a laser reader cannot. Add to the Phase 0 printing/hardware test (S3/S4) and to the supported-hardware list.
5. **Outbox adapter:** same pattern as ETA: events (receive, dispense, return, destroy) are queued and sent through an EDA adapter - built only when EDA publishes the pharmacy interface; until then the adapter exports CSV.
6. **Roadmap:** Phase 10 stays as is, but items 1-4 are pulled into Phases 3-4 as cheap preparation. If EDA publishes a pharmacy deadline, Phase 10 moves earlier (already stated in the Roadmap).

## 4. Owner questions (answers shorten the research)
1. Does your pharmacy already issue ETA e-receipts today, and through which program (eStock itself, or a provider)? Which governorate?
2. Was your pharmacy one of the pilot pharmacies for EDA track and trace, and do the staff scan a code at sale today?
3. Which barcode reader do you use (laser or 2D imager)? A photo of the model label is enough.

## 5. Open items (not found - not assumed)
| # | Item | Why it matters | How we close it |
|---|---|---|---|
| 1 | ETA offline issuing rules and exact numbering | Hub design | ETA developer portal / SDK documentation (not reachable from our sandbox - owner or accountant to share, or a registered test account) |
| 2 | Approved-provider list and approved-supplier requirements | D26 route and aim | ETA site; contact ETA |
| 3 | Current coverage outside Cairo/Alexandria and any small-pharmacy relief | Customer segment | ETA announcements |
| 4 | Penalties and late-submission limits | Alerting design | ETA decision text |
| 5 | EDA duties and deadline for pharmacies; pharmacy-side interface | Phase 10 timing | EDA site and syndicate circulars; owner's pilot experience |
| 6 | Current version of the EPTTS document | Data format | EDA site |

## 6. Sources
- alborsaanews, 13 Mar 2025, phase 7 of the e-receipt: https://www.alborsaanews.com/2025/03/13/1875125 [PRESS]
- elbalad, 25 Nov 2022, syndicate and ETA dispute: https://www.elbalad.news/5541494 [PRESS, dated]
- almasdar, Decision 475/2025: https://www.almasdar.com/159575 [PRESS]
- EDA, EPTTS Phase 1 technical FAQ: https://www.edaegypt.gov.eg/media/paif1cpf/egyptian-track-trace-for-pharmaceutical-eptts-technical-faq-phase-1-_2026.pdf and https://www.edaegypt.gov.eg/media/fs1folht/egyptian-track-trace-for-pharmaceutical-eptts-technical-faq-v3_20262.pdf [OFFICIAL]
- cairo24, pharmacy pilot: https://www.cairo24.com/2352273 [PRESS]
- Pharmacare (Petra Software) e-receipt guide: https://pharmacare-phms.com/ar/ [VENDOR]
- Flick Network, Egypt B2C e-receipt: https://www.flick.network/en-eg/egypt-b2c-e-receipt-mandate [VENDOR]
- Maven Regulatory, Egypt serialisation: https://www.mavenrs.com/egypt-pharmaceutical-serialization-track-and-trace-compliance-2026 [VENDOR]
- rfxcel, Egypt code format: https://rfxcel.com/egypt-track-trace-requirements/ [VENDOR]
