# Releases, updates and licences (Sprint 7.6)

## Where builds go
- Every merge to `main` builds the Windows installer (`app.yml`) and uploads it to two releases of this (private) repository: `test-build` (always the latest) and `v<version>`. Unsigned until the launch (D28).
- With the update channel set up, the same merge also publishes a **signed** update to the public repository `O-pharmacy-releases` (installers and manifests only, no source code): release `v<version>`, marked latest, with `O-Pharmacy-Setup.exe` and `manifest.txt`. Installed copies read `https://github.com/<owner>/O-pharmacy-releases/releases/latest/download/manifest.txt` every 6 hours and from the "البحث عن تحديث" button (About screen, or the tray icon). No web hosting is involved.
- A copy updates only to a **higher version**, so every change meant to reach the pharmacy bumps the version (desktop, web and Hub `package.json`, and `VERSION` in `apps/hub/src/server.ts`).

## One-time setup by the owner (done 12 Nov 2026)
Never paste any of these keys in the chat.
1. Create the public, empty repository `O-pharmacy-releases`.
2. In Termius (any Linux shell, for example the Hostinger session; nothing is stored there): `openssl genpkey -algorithm ed25519 -out update.key && cat update.key` -> copy the output into the secret **UPDATE_SIGNING_KEY** of this repository -> `rm update.key`. The key may be pasted with or without its BEGIN / END lines (`.github/scripts/pem.cjs` rebuilds the PEM; a wrong key fails the build with a clear message).
3. A fine-grained personal access token limited to `O-pharmacy-releases` with Contents: Read and write, saved as the secret **RELEASES_TOKEN**. It expires after a year: make a new one the same way and replace the secret.
4. Install the first build made after these secrets by hand once (`test-build`); after that it updates itself.
5. Licences: the same as step 2 with `licence.key` -> secret **LICENCE_SIGNING_KEY**.

Optional: the variable `UPDATE_BASE_URL` overrides where installed copies look for updates.

The public halves are derived from the secrets at build time; nothing secret is shipped. If a signing key is ever lost or leaked: make a new one, install the next build by hand once, and the old key stops working.

## Licences
- Test builds run without a licence. The pilot build sets `O_REQUIRE_LICENCE=1`.
- Issue: GitHub > Actions > **Issue a licence** > Run workflow (pharmacy number from About, edition, months, grace days). The code is in the run summary; paste it in About > Activate licence.
- States: valid, grace (after the end date, for the grace days), read-only (after grace: data readable and exportable, nothing new written), invalid (wrong pharmacy, bad signature). A pharmacy is never locked out of its data.

## Rollback
The app keeps the last installers it downloaded. If a new version fails to start twice, it re-installs the previous one by itself (core `shouldRollback`).
