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

## Sprint 4.3 (migration `pos_0003`, `returns.ts`)
- **Return** (`sale.return`): `returnSale({ saleNo, sessionId, lines: [{ lineNo, qty, unitName?, batchId? }], reasonCode, condition?, refund })`. Goods go back to the batch they were sold from (last pick first unless a batch is named). `resellable` goes to the main store; `damaged` goes to a returns store (must exist) and is never sold. Refund = exact net price paid per pick (discount included); partial returns add up to the total exactly. Cash refund leaves the returner's open drawer; card refund needs its reference and cannot exceed what was paid by card. Works after the sale's session closed. A void is refused once anything was returned; an unfinished home delivery cannot be returned (mark it failed).
- **Swap** (`sale.swap`): `swap({ ..., newLines, payments? })`: returned goods are put back first, the refund value is credit against the new sale; the customer pays the difference or gets the difference back (refund method needed only then).
- `returnsOf` (own sales or all), `sessionReturns` (reviewers, for the drawer closing).

## Sprint 4.4 (migration `pos_0004`, `customers.ts`)
- **Customers** (`CustomerService`): `create` / `update` (`customer.create` / `customer.update`), phone normalised (Arabic digits become Latin, unique), `search` by name, phone or code, suspend / restore with a reason (never deleted). `setCreditLimit` (`customer.credit_limit.set`, reason required); a limit of 0 means no credit.
- **Account:** an append-only `customer_ledger` (a mistake is a correcting entry). Balance = sum (positive = the customer owes). `openingBalance` only on an empty account; `statement` with a running balance and a date range; `owing` = the collection list, biggest first.
- **Credit sale:** `createSale({ customerId, onCredit: true })`. What is not paid now goes on the account (needs `sale.credit.create`, an active customer and room under the limit; not together with delivery). Void reverses the ledger entry.
- **Customer payment:** `receivePayment` (cash or card with its reference) into the receiver's own open session; cash is added to the drawer's expected cash; never more than the balance.
- **Return to account:** `refund: { method: 'account' }` on a credit sale, up to what was charged to the account. It is stored in `credit_minor` of a `return` row (swap credit only exists on `swap` rows), which keeps the migration additive.

