# Current Pharmacy Receipt - Analysis - v1.0

11 Nov 2026. Source: a photo of a delivery-order receipt printed by the owner's pharmacy today (29 Sep 2026 sale), sent by the owner on 11 Nov. **The photo itself is not stored in the repository or the Project because it shows a real customer's phone number and address**; this document keeps only the layout and the lessons. All names and numbers below are fictional placeholders.

## 1. What the receipt contains (top to bottom)
1. Handwritten greeting at the very top, then the printed wish "نتمنى لكم الشفاء العاجل" (a rubber stamp or pre-printed header, partly cut in the photo).
2. Pharmacy name (with the pharmacist's name) and two phone numbers.
3. **Handwritten by staff:** customer name and the delivery person's name, written in the blank space under the header.
4. Header block, right-aligned label and value pairs: customer name/code, invoice number, seller, notes, phone, mobile, address, delivery agent ("مندوب التوصيل / توصيل").
5. **Boxed table** with four columns: item name, unit (علبة, شريط, أنبوبة), quantity, **total price of the line** (no unit price).
6. **Boxed totals:** gross total, amount required (net after discount), paid in cash, paid by card, remaining (shown as a negative number when unpaid).
7. Invoice date and time (dd/mm/yyyy hh:mm AM/PM), then a **barcode** of the invoice number.
8. Footer policy: exchange and return within 14 days, except fridge medicines and consumables, with the original invoice.

## 2. Observations (facts from the photo)
- The sum of the eight lines equals the printed gross total exactly, and the amount required is about 3.0 percent lower: a **discount that is not printed as a line**. The customer cannot see why the two numbers differ.
- Staff type **price remarks inside the item name** ("new price", "different price") on three lines: the system has no field for "price changed since the last batch" (our D14 batch prices solve this properly).
- The remaining amount is printed with a minus sign for an unpaid delivery order; paid cash and card are both 0.00.
- Numbers use Western digits; separators on the date are "/".
- **No expiry date, batch, unit price, cashier name or tax identification is printed, and no QR code is visible.** We cannot tell from the photo whether an ETA e-receipt is submitted separately, so compliance question 1 is still open (see `compliance-eta-eda.md` section 4).
- Handwriting is needed for the customer and the delivery person: the system has the fields (customer, delivery agent) but the printed layout leaves them blank or hard to read.

## 3. Design consequences (proposed for the demo and Phase 4)
1. Keep the **familiar structure** (boxed table, same four columns first, boxed totals, barcode, return policy) so staff and customers recognise it; improve inside it.
2. Print **the discount as its own row** and the amount required after it; print the remaining with a clear label ("باقي على العميل") instead of a bare minus.
3. Print customer name and delivery agent automatically for delivery orders; no handwriting needed. Phone and address print only on the delivery copy, **never on the customer's counter copy of a normal sale** (privacy).
4. Add optional columns by setting: unit price, expiry (useful for returns and fridge items), batch.
5. Replace remarks typed into item names with a **line flag** "price changed" (from batch prices, D14) that can print as a small note.
6. Reserve the **ETA QR** area (D26) and an invoice barcode that the POS can scan for returns (return within 14 days).
7. Policy footer and header text are **configuration**, per pharmacy and per language.
8. Digits: Western or Arabic-Indic digits as a pharmacy setting (current practice is Western digits; the owner's earlier rule about separators applies to Arabic-Indic digits).
9. Width: 80 mm roll, about 72 mm printable; our S3 sample renders at 576 dots and will be re-laid out to mirror this structure.

## 4. Next step (needs owner approval)
Re-render the sample receipt in the kit with this structure (boxed table, discount row, delivery fields, barcode, QR placeholder, Western digits) so the pharmacy sees the same look first when it tests printers. Not started: awaiting the owner's "go".
