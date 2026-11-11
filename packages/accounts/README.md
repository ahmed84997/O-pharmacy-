# @o-pharmacy/accounts (Phase 6)

Money accounts, the ledger and cheques. Taken from the YK-Managment ledger (cash, Vodafone Cash, bank, Telda, custody) and made generic. Needs the hub; it reads the POS `day_closings` table only if it exists.

## Sprint 6.1 (migration `acc_0001_accounts_ledger`)
- **`AccountService`**: money accounts are data, not code. The Admin adds, renames and switches accounts off (kinds: cash, wallet, bank, custody, other). An account that holds money or has pending cheques cannot be switched off; accounts are never deleted; the kind and the opening balance never change. Ledger categories (in, out, transfer) work the same way; `seedDefaults` adds a starting set.
- **`LedgerService`**: `post` (in, out, transfer between any two accounts), `void` (reason, money goes back), `list`, `statement` (opening, lines with a running balance, closing). Amounts are whole piasters (YK used decimals). Cash, wallet and custody accounts cannot go below zero; a bank may overdraw. An entry never changes and is never deleted; idempotent by key.
- **`ChequeService`**: received and issued cheques, pending to cleared / bounced / cancelled on the shared state machine. Clearing posts the ledger entry in the same transaction; bounce and cancel need a reason; `due` lists what is coming in and going out and what is late.
- **`InboxService`**: the "from the pharmacy" waiting list. `feedClosings` turns each closed POS day into two proposals (counted cash, card sales); nothing reaches the ledger until the Admin approves and picks account and category; each proposal has a stable reference so it is never posted twice.
- **Permissions (no new ones):** `ledger.post` (Owner, Branch Admin) to change, `ledger.view` (also Accountant) to read, `bank_cheque.manage` for cheques.

## Sprint 6.2 (migration `acc_0002_chart_journal`)
- **`BooksService`**: a chart of accounts (asset, liability, equity, income, expense; code, type and parent never change; `seedChart` adds a starting chart), a journal where every entry balances in whole piasters (a mistake is reversed, never edited), `map` (money accounts, ledger categories and the opening-balance equity to chart accounts) and `journaliseLedger` (opening balances and posted ledger entries become journal entries; a voided one is reversed; unmapped or closed-period items are reported, not guessed).
- **Statements** (`statements.view`): `trialBalance`, `incomeStatement`, `balanceSheet` (assets = liabilities + equity, with the profit not yet closed into equity).
- **Periods**: `closePeriod` (`period.close`; the month must be over and every ledger entry of it journalised) stops posting, voiding and journalising into that month in both the ledger and the journal; `reopenPeriod` (`period.reopen`, reason) keeps a log. No new permission.
