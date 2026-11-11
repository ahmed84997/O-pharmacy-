# @o-pharmacy/inventory (Phase 3, Sprint 3.1)

Item master for the Hub. The module owns its tables (`inv_0001_items`, plugged into `Hub.open(..., MIGRATIONS)`); every write goes through `ItemService`, which checks the permission, validates, and writes data + audit entry + outbox event in ONE transaction.

- **Items:** kind drug / non_drug / service; Arabic name required; form, strength, active ingredient, manufacturer, group, location, reorder level; auto code `I-000001` or your own.
- **Units:** base unit first (factor 1), larger units with whole factors (strip 10, box 20). A factor never changes (database trigger): add a new unit instead. The ledger always counts in base units; `toBase()` converts.
- **Barcodes:** many per item, each bound to one unit; GTIN check digit validated; one barcode belongs to one item; never deleted, only switched off (and stays reserved). Scanning a GS1 Data Matrix returns the item, the unit, and batch / expiry / serial.
- **ETA:** `eta { type GS1 | EGS, code, tax taxable | exempt }` on the item. GS1 must be a valid GTIN. The EGS shape `EG-<9 digits>-<code>` follows vendor summaries and must be confirmed against ETA's technical guide before launch. Config `items.etaCodeRequired` (default off) makes it mandatory when e-receipt starts.
- **Prices:** a drug has no price on the item (state price comes per batch, D14; a database CHECK enforces it). Non-drug and service items have a free price in piasters (whole numbers), set only with `item.price.set` (D20).
- **No-Delete (D13):** suspend / archive / restore need a reason and are logged (who, when, why, from, to); nothing is ever deleted (triggers). Management sees them in `inactive()`.
- **Search:** Arabic-aware (alef variants, ya/alef maksura, ta marbuta/ha, diacritics, Arabic digits, case); name, English name, ingredient, code, barcode prefix. 25,000 items: about 7 ms per lookup (SQLite).
- **Alternatives:** same active ingredient, strength and form.
- **Permissions:** from the matrix: Pharmacist can create and edit items but not set non-drug prices, suspend or archive (those are optional grants); Cashier can only read.

## Batches (Sprint 3.2, `batches.ts`, migration `inv_0002_batches`)
- **Receive** (`purchase_invoice.create`): creates the batch and the stock movement in one transaction. Same lot + expiry + same prices adds to the batch; other prices raise `price-conflict` for management. A repeated delivery (same key) adds nothing. Expired batches are refused; near-expiry and cost-above-price come back as warnings.
- **Prices (D14):** a drug batch carries the state public price and the pharmacist price (pharmacist <= public); the item itself has no drug price. Non-drug prices stay on the item (D20) and are per its largest (retail) unit. Money is whole piasters per price unit, rounded half up once per pick.
- **Facts never change:** price, cost, lot, expiry (database triggers). A mistake is a new batch plus a stock adjustment, so every past sale stays explainable.
- **FEFO (D21):** `allocate(item, qtyBase)` takes nearest expiry first (ties: received first); expired and quarantined batches are never used; each pick keeps its own price; a chosen batch is allowed but never an expired, held or empty one; a shortage is reported (`missingBase`), never invented. Stock per batch is read from the ledger, so there is no second copy.
- **Expiry report** (`expiry.alerts.view`): within N days, nearest first, only batches with stock; value at cost only for those who may see cost (matrix rule 1).
- **Quarantine / release** (`recall.manage`): reason required, logged; the Phase 10 recall process builds on it.
- Expiry written as month/year means the last day of the month.

Decisions taken in this sprint: default unit for a barcode with no unit named = the largest unit (the retail pack); item kind never changes after creation (archive and create a new item); prices are integer piasters.
