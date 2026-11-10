# Editions Study - Single Pharmacy vs Chain (Branches) - v1

10 Nov 2026. Status: discussion input for the ARD. Owner request: a full study of the two-edition model (like B-Connect ePlus vs eChain), especially how branches talk to each other (find an item in another branch, tell the customer, or request it from that branch). Facts are cited; everything else is design analysis.

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
| Master data (items, prices, suppliers, customers) | Local | **Central** catalogue, central price list (+ allowed branch overrides), shared customers and suppliers |
| Stock visibility | Own branch | **"متوفر فين؟"** across all branches, by batch/expiry, with freshness time |
| Inter-branch requests and transfers | - | Full workflow (section 4) |
| Purchasing | Branch | **Central purchasing** from aggregated shortages, central warehouse receipt and distribution, or branch purchase with central approval |
| Rebalancing | - | Slow movers / near-expiry moved to branches that sell them (AI suggestion later) |
| Finance | Branch accounts | Per-branch and **consolidated** P&L, central treasury, inter-branch transfer accounting |
| HR | Branch staff | Staff working in several branches, staff moves, attendance per branch |
| Reports | Branch | Consolidated + branch comparison |
| Roles | Admin, Manager, staff | + HQ / regional manager, branch-scoped permissions |
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
- **Central master data is cloud-authoritative**, pushed down to Hubs; branches may only change the fields the HQ allows (e.g. local price override within limits).
- **Customer credit across branches:** balances aggregate in the cloud; an offline branch uses the last known balance and its local limit; differences reconciled on sync and flagged.
- **Document numbers carry the branch code** so two offline branches never collide (check against ETA e-receipt numbering rules).
- **Central warehouse** = a branch of type warehouse with the same ledger rules.

## 6. Hard problems to solve in design (not blockers)
1. The same last pack reserved/sold in two places while one is offline → allow, flag, resolve by rule.
2. Price changes reaching an offline branch late → versioned price lists with effective time; the sale keeps the price it used.
3. Inter-branch accounting (does a transfer create a branch-to-branch balance?) → owner/accountant decision.
4. Permissions across branches (who can see another branch's stock, costs, sales) → role matrix.
5. Scale of the central view for big chains → aggregated read models in the cloud.

## 7. Packaging proposal **[OPEN - no competitor prices yet]**
- **Single** edition and **Chain** edition (per branch), same feature base.
- Add-ons: white-label **Customer App + Website** (owner decision: one app per pharmacy), Insurance/contracts, AI pack, extra devices.
- Pricing model to decide after competitor demos (per branch / per device / monthly vs yearly).

## 8. Recommendation for the roadmap
Build the **data model and sync for Chain from day 1** (branch scope, ledger, UUID messages), ship **Single first** (pilot at the owner's pharmacy), then switch on Chain features as a dedicated phase. This avoids a costly redesign later and matches the owner's "build it right, no rush" decision.

## 9. Questions for the owner
1. Can a branch change its own sale price, or only HQ?
2. Shared customers across branches (one customer file, one credit balance)?
3. Does a chain usually have a central warehouse in our target market?
4. Should staff of branch A see the cost and profit of branch B?
5. Transfer approval: automatic acceptance by the stock holder, or manager approval?

## Sources
- B-Connect: https://bconnect-egypt.com/
- Dexef: https://dexef.com/system-pharmacy
- Aumet chain: https://aumet.com/chain/
- LS Retail - Delmar & Attalla: https://www.lsretail.com/customers/delmar-attalla
- eStock: owner screenshots (docs/research/estock-inventory.md)
