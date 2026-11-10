# Editions Study - Single Pharmacy vs Chain (Branches) - v1.1

10 Nov 2026. v1.1 records the owner's chain decisions (section 9). Status: discussion input for the ARD. Owner request: a full study of the two-edition model (like B-Connect ePlus vs eChain), especially how branches talk to each other (find an item in another branch, tell the customer, or request it from that branch). Facts are cited; everything else is design analysis.

## 1. What the market does
| Vendor | Editions / chain features (as published) |
|---|---|
| B-Connect (Egypt) | **ePlus** = POS for a single pharmacy; **eChain** = integrated system for chains and central warehouses. No feature list published. |
| Dexef | Editions ONE / POS / Smart / ERP; multi-warehouse and inter-branch transfers; ERP edition = unlimited branches. |
| Aumet | Chain module: inter-branch transfers, central purchasing (demand combined across branches), unified stock visibility, central pricing/roles/settings, chain analytics; offline POS. Markets listed: KSA, Jordan, France (Egypt not listed). |
| LS Retail at Delmar & Attalla (Egypt) | 20 stores, 120 POS terminals in Cairo; old system could not link branches; benefits reported: stock redistribution between branches, insurance control, home delivery with promotions, loyalty; big-bang go-live after simulations. |
| eStock (current) | Inside one branch only: internal stores, transfers between stores, "print what is available in other stores". No cross-branch features seen. |

Conclusion: the two-edition split is the market norm; chain buyers expect transfers, central purchasing, unified visibility, central pricing and consolidated reports.

## 2. Principle: one product, two licences
- **One codebase, one database design.** The edition is a licence flag, not a fork.
- Every record is **branch-scoped from day 1** (already a YK principle), so a Single pharmacy that opens a second branch upgrades by licence - **no data migration**.
- Single = 1 branch (with any number of internal stores and devices). Chain = 2+ branches, optional **central warehouse** (a branch of type "warehouse", no POS) and an **HQ** view.

## 3. Feature split
| Area | Single | Chain adds |
|---|---|---|
| Sales/POS, inventory, purchasing, returns | Yes | Branch-level settings under central rules |
| Internal stores inside the branch + transfers between them | Yes | - |
| Operations (customer requests, shortages, PO stages, tasks, attendance) | Yes | Requests and shortages can be routed to other branches |
| Master data (items, suppliers, customers) | Local | **Central** catalogue, shared customers (one balance in every branch) and suppliers |
| Prices | Public and pharmacist prices are fixed by the state and arrive on the purchase invoice; stored **per batch** (old price / new price can coexist) | Same rule in every branch; each branch's Admin and Manager run their branch (discounts etc.) |
| Stock visibility | Own branch | **"متوفر فين؟"** across all branches, by batch/expiry, with freshness time |
| Inter-branch requests and transfers | - | Full workflow (section 4) |
| Purchasing | Branch | **Central purchasing** from aggregated shortages, central warehouse receipt and distribution, or branch purchase with central approval |
| Rebalancing | - | Slow movers / near-expiry moved to branches that sell them (AI suggestion later) |
| Finance | Branch accounts | Per-branch and **consolidated** P&L, central treasury, inter-branch transfer accounting |
| HR | Branch staff | Staff working in several branches, staff moves, attendance per branch |
| Reports | Branch | Consolidated + branch comparison |
| Roles | Admin, Manager, staff | + Chain owner (access to everything); every branch keeps its own Admin + Branch Manager |
| Promotions, loyalty, contracts/insurance | Branch | Central definitions, used in every branch; claims per branch |
| Customer app (white-label) | One pharmacy | Customer picks a branch or the nearest; order routed to the branch that has the stock |

## 4. Inter-branch workflow (the core of the Chain edition)
### 4.1 Find it
From the cashier screen, the shortage notebook, or a customer request: «🔎 متوفر فين؟» lists branches with quantity, nearest expiry, and **last update time** (from the cloud). If a branch is offline, its numbers show as stale with the time of its last sync.

### 4.2 Three ways to serve the customer
1. **Send the customer:** reserve the quantity at branch B for X hours, message the customer with B's address/map (WhatsApp/app). Reservation expires automatically.
2. **Transfer to my branch:** branch A requests, B dispatches, A receives, the customer is notified (YK "ready to notify" flow).
3. **B delivers:** B's delivery takes it to the customer (YK `out_for_delivery`).

### 4.3 Transfer request states
`requested` → `accepted` / `partially_accepted` / `rejected` (with reason) → `dispatched` (leaves B's stock, enters **in transit**) → `received` (enters A's stock; differences recorded) → `closed`; or `cancelled` before dispatch. SLA timers and alerts like YK (late acceptance, late dispatch, late receipt). Every step audited, No-Delete.
Transfer value at **cost** (not sale price); batch and expiry travel with the stock.

### 4.4 Request reasons
Customer waiting (linked to a customer request), shortage, rebalancing (HQ-initiated), expiry rescue.

## 5. Architecture under offline (fits the Hub design)
- **Each branch Hub owns its own stock ledger.** The cloud aggregates for visibility and routes messages between branches; it never edits a branch's stock directly.
- **Transfers are messages, not distributed transactions:** B's dispatch is a movement in B's ledger; "in transit" is tracked in the cloud; A's receipt is a movement in A's ledger. Each message has a UUID and is idempotent, so a branch that comes back online just sends its queue.
- **Visibility needs the internet** (the branch's own work does not). The UI always shows data age.
- **Central master data is cloud-authoritative**, pushed down to Hubs; branches may only change the fields the chain owner allows. Prices are not a branch decision: they come from the purchase invoice per batch (state-fixed public/pharmacist prices).
- **Customer credit across branches (DECIDED: one balance usable in any branch):** balances aggregate in the cloud; an offline branch uses the last known balance and its local limit; differences reconciled on sync and flagged.
- **Document numbers carry the branch code** so two offline branches never collide (check against ETA e-receipt numbering rules).
- **Central warehouse** = a branch of type warehouse with the same ledger rules.

## 6. Hard problems to solve in design (not blockers)
1. The same last pack reserved/sold in two places while one is offline → allow, flag, resolve by rule.
2. Official price changes: the new price arrives with the new batch on the purchase invoice; old-price stock keeps its price; the cashier screen shows which batch/price is sold (owner rule: nearest expiry first - FEFO).
3. Inter-branch accounting → decided (C10): stock move at cost by default, branch-to-branch balance as a setting.
4. Permissions across branches (who can see another branch's stock, costs, sales) → role matrix.
5. Scale of the central view for big chains → aggregated read models in the cloud.

## 7. Packaging proposal **[OPEN - no competitor prices yet]**
- **Single** edition and **Chain** edition (per branch), same feature base.
- Add-ons: white-label **Customer App + Website** (owner decision: one app per pharmacy), Insurance/contracts, AI pack, extra devices.
- Pricing model to decide after competitor demos (per branch / per device / monthly vs yearly).

## 8. Recommendation for the roadmap
Build the **data model and sync for Chain from day 1** (branch scope, ledger, UUID messages), ship **Single first** (pilot at the owner's pharmacy), then switch on Chain features as a dedicated phase. This avoids a costly redesign later and matches the owner's "build it right, no rush" decision.

## 9. Owner decisions (10 Nov 2026)
| # | Topic | Decision |
|---|---|---|
| C1 | Prices | Public and pharmacist prices are fixed by the state and come on the purchase invoice; no branch price setting. Stored per batch. |
| C2 | Branch administration | Each branch has its own Admin and Branch Manager who manage their branch. |
| C3 | Customers | A customer appears in every branch; **one balance usable in any branch**. |
| C4 | Central warehouse | **Optional** (a "warehouse" branch with no POS). |
| C5 | Visibility | Branch staff see the **available quantities** in other branches only; the Branch Manager sees his branch's numbers; the **chain owner has access to everything**. |
| C6 | Transfers | The workflow in section 4 (request → accept → dispatch → in transit → receive, differences recorded). |
| C7 | Who accepts a transfer request at the holding branch | Branch Manager, storekeeper, or a regular employee (by permission). The chain owner can move stock directly. |

| C8 | Non-drug items (cosmetics, supplements...) | **Free pricing**, set by the pharmacy (in a chain, by each branch's Admin / Manager). |
| C9 | Selling order when a batch has old and new prices | **Nearest expiry first (FEFO)**. |
| C10 | Accounting of transfers | Default **stock move at cost, no branch-to-branch debt** (one owner). Setting for chains with partners: the receiving branch **owes** the sending branch (at cost or cost + margin), settled periodically. In both modes every branch report shows the value transferred in / out. |

Nothing open on chain rules for now.

## Sources
- B-Connect: https://bconnect-egypt.com/
- Dexef: https://dexef.com/system-pharmacy
- Aumet chain: https://aumet.com/chain/
- LS Retail - Delmar & Attalla: https://www.lsretail.com/customers/delmar-attalla
- eStock: owner screenshots (docs/research/estock-inventory.md)
