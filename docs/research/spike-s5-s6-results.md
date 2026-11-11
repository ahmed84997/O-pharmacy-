# Spike results - Sprint 0.4 (S6 tenant isolation, S5 Ribbon UI) - v1.0

11 Nov 2026. Prototypes live in `spikes/s6-tenancy` and `spikes/s5-ribbon` and are never shipped. CI: `.github/workflows/spikes.yml`, PR #6.

## S6 - Tenant isolation (D25)
**Question:** can one cloud PostgreSQL database hold many pharmacies so that one can never read or change another's data, even through a bug in our code?

**Result: proven on Linux and macOS CI (PostgreSQL 18.6, 13 of 13 tests each) and locally.** Windows is not run: PostgreSQL refuses to start as the Windows runner's administrator account (a runner artefact; the cloud database is not a Windows component).

| # | What the test proves |
|---|---|
| 0 | The application role is not a superuser, has no BYPASSRLS and owns nothing |
| 1-2 | Each tenant sees only its rows; with no tenant context: zero rows, no writes |
| 3-4 | Cross-tenant UPDATE and DELETE touch nothing; moving a row to another tenant is rejected |
| 5-6 | Composite foreign keys and unique keys include `tenant_id` (a barcode can repeat across pharmacies without leaking) |
| 7 | A pooled connection never carries one request's tenant into the next (`SET LOCAL` inside the transaction) |
| 8 | `FORCE ROW LEVEL SECURITY` stops the owner and owner-run views from leaking |
| 9 | The application role cannot switch RLS off or rewrite policies |
| 10 | Per-tenant keys (HKDF + AES-256-GCM, tenant bound as authenticated data): another tenant's key or a copied ciphertext cannot decrypt |
| 11 | **Known limit:** if an attacker can run arbitrary SQL, a settable tenant context lets them choose another tenant |
| 12 | **Stronger tier:** a dedicated login per tenant, the database derives the tenant from the login, injected SQL cannot change it |

**Mutation checks:** removing FORCE, using a session-level SET and dropping the composite key each make the matching test fail, so the tests are not vacuous. Removing WITH CHECK did not fail because it defaults to USING (not a test weakness).

**Findings / design consequences**
1. Standard tier (RLS + SET LOCAL) is enough against our own bugs and normal SQL injection in the app layer. It is **not** enough if an attacker obtains arbitrary SQL execution: that is the known limit.
2. Stronger tier (per-tenant login roles with a SECURITY DEFINER `login_tenant()`) closes that gap at the cost of one connection pool per tenant. Proposal: Standard for Single edition SaaS, Stronger for Chain or on request. **Owner decision needed (D-S6).**
3. Every table carries `tenant_id` and composite keys from Phase 2 on; migrations are additive.
4. The Hub (SQLite) holds one pharmacy only, so isolation there is by file, not RLS.

**Open:** external penetration test (Phase 11), connection-pool sizing for the stronger tier, tenant key rotation and backup/restore per tenant, master-data conflicts across branches.

## S5 - Ribbon UI prototype
**Question:** does a Word-style Arabic RTL Ribbon feel right for a pharmacy system, on a desktop and on a phone?

**Built (single HTML file, no installation):** `spikes/s5-ribbon/index.html`, published privately: https://claude.ai/artifact/V4cqiyNDdiLMM38WEWg4un
- Tabs and groups, collapse/expand (Ctrl+F1 or double-click a tab), Quick Access bar.
- **Key tips:** press Alt, letters appear; mapped by physical key so they work on the Arabic keyboard layout.
- Role switcher (owner, manager, pharmacist, cashier): the Ribbon shows only what the role may do (matrix v0.1).
- Mock screens: sale, items, shortages, deleted items (D13). Offline toggle shows the Hub banner.
- Phone (under 760 px): bottom bar (sale, items, shortages, deleted) plus a side drawer for everything else; dark-first colours (teal, orange, dark blue). **Version 2 (11 Nov):** desktop first, effective phone layout (D31), brand shown as "O Pharmacy" in English (D30).

**How to test (2 minutes):** open the link, switch roles, press Alt, collapse the Ribbon, toggle offline, shrink the window or open on the phone.

**Not proven:** real keyboard-first cashier speed, screen readers, user testing with the pharmacists (Phase 1 demo is where that happens).

**Owner decisions:** (1) Ribbon tab order and names; (2) keep Alt key tips as a standard feature; (3) phone layout: bottom bar plus drawer is in v2, confirm.

## Sprint 0.4 summary
S6 isolation proven (known limit and stronger tier documented). S5 prototype ready for the owner's hands-on review. Compliance, printing on real printers (Friday kit) and Hub on real hardware remain the open Phase 0 risks.
