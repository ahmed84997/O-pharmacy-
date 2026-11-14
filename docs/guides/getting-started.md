# O Pharmacy 0.7.6 - Getting started (Phase 7 test build)

This is the first complete test build of O Pharmacy: the whole program on one Windows PC, with the other devices of the pharmacy connecting to it through the browser. It is a **test build**: use test data, not real data, until the pilot (Phase 8).

## 1. Install
1. On the pharmacy PC, sign in to GitHub and open the release **O Pharmacy 0.7.6 (test)** (`Releases` in the repository) or the `test-build` release.
2. Download `O-Pharmacy-Setup-0.7.6.exe` (about 100 MB) and run it.
3. Windows SmartScreen warns because the file is not signed yet (signing comes with the commercial launch, D28): **More info > Run anyway**.
4. O Pharmacy opens by itself. A desktop icon is created. The program also starts with Windows (it can be switched off, section 6).

## 2. First run
The app first asks how this PC works: **Primary** (the first PC: it holds the pharmacy's data) or **Cashier** (joins the primary, see section 4). On the primary:
1. Enter the pharmacy name and the owner's account (your name, a username in English, a password). This PC becomes the first approved device.
2. On the home page press **Load test data** (only offered on an empty database in test builds): about 185 items with batches, expiry dates and state prices, 6 suppliers, 25 customers, a cash box and a bank, an insurance contract (member `M-1001`), and pay profiles.
3. **Administration > Users and permissions**: add the staff you want to try with (cashier, pharmacist, storekeeper, manager, accountant). Each gets a temporary password and must change it at first login. Extra permissions (for example returns for a cashier) are chosen per person.
4. **Administration > Settings > Printers**: add the receipt printer exactly as Windows names it (Windows printer), or its IP (network printer), or "on screen only".

## 3. What to try (the Ribbon, top of the screen)
| Tab | Try |
|---|---|
| Home / Sales | Open a cashier session, sell (scan or type, F2 search, F9 to save), cash, card or both, discount, hold a bill, home delivery, insurance sale (member pays the copay, the rest goes to the insurer's account, the claim is created). Receipt prints and shows on screen. Returns and swaps, sales history, void (management), deliveries, close the session (blind count), review and close the day. |
| Stock | Item card (batches, prices, stock per store, movement card, supplier price comparison), new item, quarantine a batch, expiry and low stock, stores and transfers, adjustments (approved by someone else), blind stocktake, eStock import (dry run first). |
| Purchasing | Supplier invoice (lot, expiry, bonus, cost, state price), purchase orders, returns to supplier, suppliers. |
| Customers | Credit limit, opening balance, payment into the drawer, statement. |
| Operations | Customer requests and the shortage notebook (each step the lifecycle allows), notifying customers (ready message, WhatsApp link), handovers, order stages, tasks, attendance and leave, alerts. |
| Accounts | Cash and bank ledger, closed days waiting to be recorded, cheques, chart of accounts and mapping, journal, trial balance, income statement, balance sheet, month closing, contracts and claims (batches, reconciliation into the bank). |
| Staff | Payroll: salaries, bonuses and deductions, preview, approve the month, pay (taken out of the chosen account). |
| Reports | 13 reports with filters, saved and shared views, Excel (CSV). |

The `Alt` key shows the key tips on the Ribbon; `Ctrl+F1` folds it.

## 4. Other devices in the pharmacy
1. On the primary: right-click the O Pharmacy icon next to the clock > **Allow devices on the network**. Windows asks once to allow the program through the firewall: press **Yes**.
2. On a cashier PC: install O Pharmacy and choose **Cashier** at the first run. It searches the network and lists the primary; press **Connect**. If it is not found, type the address shown in the primary's **About** (for example `192.168.1.20`). A PC that was already set up as a primary by mistake: tray menu > **This PC becomes a cashier** (its data is kept, not deleted). A phone or another browser can still open the address directly.
3. Each cashier prints on its own printers: in **Settings > Printers** add a printer of type **Each device's printer**, then on every cashier PC choose its receipt and label printers under **This PC's printers** (this works in the app, not in a browser).
4. The new device waits for approval: approve it in **Administration > Devices**. Nobody can log in on a device that is not approved.
5. The primary must stay on. Closing the window keeps O Pharmacy running in the background; **Exit** (tray menu) stops it for everyone.

## 5. Backups
- A full copy of the database is made every day by itself; the last 14 days are kept in the data folder (tray menu > **Open data folder**). **About > Backup now** makes one at any time.
- **Restore** (tray menu): choose a copy; the current data is kept beside it (`before-restore-...`), nothing is deleted.
- Copy the backups folder to a USB stick or a cloud folder from time to time.

## 6. Updates and the licence
- With the update channel set up (owner actions), O Pharmacy checks for a new version every 6 hours. Outside working hours it offers to install; **Check for update** in the tray menu installs at any time. The update is signed and checked before it runs; if the new version does not start twice, the previous one is put back.
- Until then, install a newer build over the old one: the data stays.
- Test builds do not need a licence. The pilot build will ask for one: **About** shows the pharmacy number; the licence is issued from GitHub (Actions > Issue a licence) and pasted in **About > Activate licence**. An expired licence never locks the data: the program becomes read-only (reports and exports keep working) until it is renewed.

## 7. Known limits of this build
- Windows only (macOS and Linux before the launch, D27). Unsigned (D28).
- O Pharmacy runs while a Windows user is signed in (it starts with Windows from the tray). Running as a Windows service without anyone signed in is not done yet.
- The ETA e-receipt is built but switched off until the pharmacy's registration data arrives (owner actions 12).
- The AI assistant is built but has no provider yet (owner decision).
- Real printers, the barcode reader and the cash drawer need the test at the pharmacy (owner actions 1).

## 8. Reporting a problem
Send a screenshot and what you pressed. The program's log is in the data folder's sibling `logs/hub.log` (tray menu > Open data folder, one level up).
