# apps - the O Pharmacy program (Phase 7)

The packages under `packages/` hold the business rules; these apps put them together into a program (D32).

| App | What it is |
|---|---|
| `hub` | The Hub application: opens one Hub with every module's tables (`compose.ts`), the local API (Fastify, ADR-0001) that every screen talks to, people and roles, devices, sessions, the Ribbon per permission, test data. Bundled into one file (`npm run build` -> `dist/hub.mjs`) that runs on plain Node 22+. |
| `web` | The screens (React, the Ribbon from the Phase 1 demo and the S5 prototype). Built into `dist/` and served by the Hub. |
| `desktop` | The Windows window (Electron, ADR-0002 / D35). Starts the bundled Hub and shows the screens. Installer built in CI (`app.yml`), unsigned until the launch (D28). |

## Three gates on every request
1. **Known device**: each PC, browser or phone registers once and keeps an id and a secret (stored hashed in the Hub).
2. **Approved device**: a new device waits until someone with `device.approve` approves it (the first device is approved when the owner sets the pharmacy up). Revoked stays revoked.
3. **Session**: a person logs in on that device (scrypt passwords, lockout after 5 wrong tries for 15 minutes, 12-hour sessions bound to the device). Each action then checks its own permission in its module.

People are never deleted (deactivate with a reason); a temporary password from a manager must be changed at first login; only an owner gives or removes the owner role, and the pharmacy always keeps one active owner. Every change is in `people_events`, `device_events` and the audit chain.

## Run locally
```
cd apps/hub && npm ci && npm run build
cd ../web && npm ci && npm run build
O_WEB_DIR=../web/dist O_TEST_MODE=1 node ../hub/dist/hub.mjs   # http://127.0.0.1:4870
```
Settings (environment): `O_DATA_DIR`, `O_PORT` (4870), `O_HOST` (127.0.0.1), `O_WEB_DIR`, `O_TEST_MODE=1` (allows loading test data into an empty database), `O_TEST_STAFF_SECRET` (password of the test staff accounts), `O_BRANCH_ID`.

## Where to try it (D33)
- **Pharmacy PC**: the installer from the `test-build` release (Actions builds it on every merge).
- **Test server**: Oracle Cloud Always Free behind a Cloudflare quick tunnel, deployed on every merge (`deploy-test.yml`, setup in `docs/governance/test-server.md`).

## Desktop housekeeping (Sprint 7.6)
- The window hides to the tray; the Hub keeps serving the other devices. Start with Windows, network access, restore and update are in the tray menu.
- Daily database backups by the Hub (`<data>/backups`, 14 kept), restore by the desktop (the current data is kept beside, never deleted).
- Signed auto-update and licences: `docs/governance/release-and-updates.md`. User guide: `docs/guides/getting-started.md`.
