# Releases, updates and licences (Sprint 7.6)

## Where builds go
- Every merge to `main` builds the Windows installer (`app.yml`) and uploads it to two GitHub releases: `test-build` (always the latest) and `v<version>` (one per version). Unsigned until the launch (D28).
- With the update channel set up, the same merge also publishes a **signed** update to `<UPDATE_BASE_URL>/manifest.txt` and `O-Pharmacy-Setup.exe` (through the existing restricted demo upload key). Installed copies check it every 6 hours.

## One-time setup by the owner (about 10 minutes, Termius + GitHub app)
Never paste any of these keys in the chat.
1. In Termius (any Linux/macOS shell): `openssl genpkey -algorithm ed25519 -out update.key && cat update.key` -> copy all lines into the GitHub secret **UPDATE_SIGNING_KEY** -> `rm update.key`.
2. Same for licences: `openssl genpkey -algorithm ed25519 -out licence.key && cat licence.key` -> secret **LICENCE_SIGNING_KEY** -> `rm licence.key`.
3. GitHub > Settings > Secrets and variables > Actions > **Variables** > `UPDATE_BASE_URL` = the demo address followed by `/updates` (for example `https://demo.example.com/updates`).
4. Run "O Pharmacy app" once (Actions > Run workflow) or merge anything: the next installer carries the public keys and the update address. Install that build once by hand; after that it updates itself.

The public halves are derived from the secrets at build time; nothing secret is shipped. If a signing key is ever lost or leaked: make a new one (step 1 or 2), install the next build by hand once, and the old key stops working.

## Licences
- Test builds run without a licence. The pilot build sets `O_REQUIRE_LICENCE=1`.
- Issue: GitHub > Actions > **Issue a licence** > Run workflow (pharmacy number from About, edition, months, grace days). The code is in the run summary; paste it in About > Activate licence.
- States: valid, grace (after the end date, for the grace days), read-only (after grace: data readable and exportable, nothing new written), invalid (wrong pharmacy, bad signature). A pharmacy is never locked out of its data.

## Rollback
The app keeps the last installers it downloaded. If a new version fails to start twice, it re-installs the previous one by itself (core `shouldRollback`).
