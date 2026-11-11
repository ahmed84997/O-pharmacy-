# @o-pharmacy/pos (Phase 4, Sprint 4.1)

Cashier sessions and the sale core for the Hub. Migration `pos_0001_sales` plugs in after the inventory migrations: `Hub.open(branch, path, clock, [...MIGRATIONS, ...POS_MIGRATIONS])`.

- **Session** (`cashier_session.open` / `.close`): one open session per terminal and per person; opening float in piasters. The cashier counts the drawer without seeing the expected amount; only reviewers (`drawer.close.review`) get expected and difference back; a difference needs a note. `sessionSummary` is for reviewers.
- **Cash sale** (`sale.create`): one transaction. FEFO (D21): nearest expiry first, each batch at its own price (D14); money in whole piasters, rounded half up once per batch pick; change; a batch spread over several sellable stores is drawn from each; a chosen batch is honoured; held, expired and returns-store stock is never sold. Non-drugs sell at the item price (per largest unit); services take no stock; the pharmacist price needs `sale.discount`; with config `sale.allowNegativeStock` non-drugs may be sold below zero (a drug price needs a batch). A repeated key sells nothing twice; any refusal writes nothing.
- **Void** (`sale.void`, management, reason required): only while the sale's session is open; every movement is reversed; nothing is deleted. After the session closes, a return is the way (Sprint 4.3).
- **Reading:** `sale.view_own` / `sale.view_all` (the cashier template does not include either by default); cost and profit per sale only with `stock.cost.view`.
- Next: invoice types (card, credit, held, home delivery), discounts, held bills (4.2).
