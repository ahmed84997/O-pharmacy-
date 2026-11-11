# @o-pharmacy/pos (Phase 4, Sprint 4.1)

Cashier sessions and the sale core for the Hub. Migration `pos_0001_sales` plugs in after the inventory migrations: `Hub.open(branch, path, clock, [...MIGRATIONS, ...POS_MIGRATIONS])`.

- **Session** (`cashier_session.open` / `.close`): one open session per terminal and per person; opening float in piasters. The cashier counts the drawer without seeing the expected amount; only reviewers (`drawer.close.review`) get expected and difference back; a difference needs a note. `sessionSummary` is for reviewers.
- **Cash sale** (`sale.create`): one transaction. FEFO (D21): nearest expiry first, each batch at its own price (D14); money in whole piasters, rounded half up once per batch pick; change; a batch spread over several sellable stores is drawn from each; a chosen batch is honoured; held, expired and returns-store stock is never sold. Non-drugs sell at the item price (per largest unit); services take no stock; the pharmacist price needs `sale.discount`; with config `sale.allowNegativeStock` non-drugs may be sold below zero (a drug price needs a batch). A repeated key sells nothing twice; any refusal writes nothing.
- **Void** (`sale.void`, management, reason required): only while the sale's session is open; every movement is reversed; nothing is deleted. After the session closes, a return is the way (Sprint 4.3).
- **Reading:** `sale.view_own` / `sale.view_all` (the cashier template does not include either by default); cost and profit per sale only with `stock.cost.view`.

## Sprint 4.2 (migration `pos_0002`)
- **Payments:** `payments: [{ method: 'cash', amountMinor }, { method: 'card', amountMinor, ref }]` (or `cashMinor` for one cash payment). Card needs its approval reference and cannot exceed the total; cash over the due amount comes back as change. The drawer expects the float plus cash payments only; card and cash-on-delivery are not in it.
- **Discounts:** `discountBp` per line or per sale (basis points), rounded half up per batch pick. Needs `sale.discount`; above config `sale.cashierDiscountMaxPct` also needs `sale.discount.override` (manager). Profit is after the discount.
- **Held bills** (`sale.hold` / `sale.resume`): `holdBill`, `resumeBill`, `createSale({ fromHold })`, `cancelHold` (reason). No stock is reserved; prices and stock are read again at sale time. A session cannot close while a held bill is open.
- **Home delivery:** `createSale({ delivery: { name, phone, address, feeMinor } })`; what is not paid now is cash on delivery. `setDeliveryStatus(out_for_delivery, agent)`, `collectDelivery` (cash goes into the collector's open session, change returned), `deliveries`. A failed delivery voids the sale (stock back) while the session is open.
- **Credit sales** come with customers and balances in Sprint 4.4.
