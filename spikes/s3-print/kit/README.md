# Printer test kit - O-Pharmacy Phase 0

**Purpose:** find out which printers and commands work in the pharmacy, before we build the real print service. It sends only fictional test data ("Model Pharmacy") to your printers.

## Steps (any Windows PC that has the printers installed, about 10 minutes)
1. Copy this whole folder to the PC. Open PowerShell in the folder (Shift + right-click, "Open PowerShell window here").
2. List printers: `powershell -ExecutionPolicy Bypass -File .\print-test.ps1 -List`
3. Receipt printer (80 mm): `powershell -ExecutionPolicy Bypass -File .\print-test.ps1 -Printer "<exact name>" -Test receipt80`
   - Arabic text must be readable, the numbers in the right order, and the paper must cut.
   - Then `-Test drawer` (the cash drawer should open) and `-Test driver` (prints through the normal Windows driver).
4. 58 mm printer, if any: `-Test receipt58`.
5. Label printer: try `-Test tspl`; if nothing sensible prints, `-Test zpl`. If the text looks like a black rectangle with white letters, run `-Test tspl-invert` and tell us which one was right. Run `-Test driver` too.
6. Network printer instead of USB: use `-Ip 192.168.1.50` in place of `-Printer`.
7. Fill in `RESULTS.md` and send it with photos of the prints and a photo of each printer's model label.

Nothing is installed, changed or sent over the internet. A bad file at worst prints garbage characters; turn the printer off and on.
