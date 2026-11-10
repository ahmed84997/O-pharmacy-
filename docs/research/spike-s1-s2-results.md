# Spike Results - S1 (Hub runtime) and S2 (offline sync) - v1.0

10 Nov 2026. Phase 0, Sprint 0.2. Code: `spikes/s1-hub`, `spikes/s2-sync` (throwaway, never shipped). Evidence: GitHub Actions run 42899350491 on `windows-latest`, `macos-latest` (Apple silicon) and `ubuntu-latest`, all green; plus local runs. Status: results for owner review; **S1 is partly done** (section 4 lists what is still open).

## 1. What was built and tested
**S2 - offline sync prototype (TypeScript, SQLite).** Hub per branch, tills ("devices") on the branch LAN, one cloud. Stock is an **immutable movement ledger** (UUID per row). Each branch Hub is the **single writer** for its own stock. Sync pushes unsynced rows to the cloud with an idempotent upsert and pulls transfer events about the branch. A transfer between branches is an event chain (requested, accepted, dispatched, received) with an **in-transit store** that must be empty after receipt; branches talk to each other only through the cloud. A fault-injecting link simulates: internet down, request applied but answer lost, duplicate delivery, Hub crash in the middle of a sale, till that cannot reach the Hub.

**157 tests per OS:** 7 named scenarios (offline selling then catch-up, lost answer, crash mid-sale, till queue replay, last unit sold by two tills, two offline branches with a transfer, out-of-order events) plus a **150-seed random fault storm** (3 branches, 2 items, 250 random steps each: sales, purchases, transfers, link flaps, lost answers, duplicates, crashes). After healing, every run must satisfy: cloud balance equals Hub balance for every branch and item; total stock equals purchases minus successful sales (nothing created or lost); movement counts match; no negative stock at any moment; transit empty after receipt; nothing left unsynced. The storm produced about 11,300 movements and 3,700 completed transfers.
**Are the tests able to fail?** Yes - three deliberate bugs (non-idempotent cloud insert, forgotten transit leg, no idempotency keys) made 146-151 of 157 tests fail.

**S1 - Hub runtime.** (a) **Crash durability:** a child process commits one two-row transaction at a time and is killed with SIGKILL at random moments, 30 times per run; after each kill the database is reopened and must pass the integrity check, contain every acknowledged commit, contain no half transaction, and the ledger must still sum to zero. (b) Commit speed. (c) A **single executable** (Node SEA, unsigned) containing a Hub with local DB and a LAN HTTP port.

## 2. Results
| | Windows (x64) | macOS (arm64) | Linux (x64) |
|---|---|---|---|
| S2 tests | 157 / 157 | 157 / 157 | 157 / 157 |
| Kill -9 durability, node:sqlite (built in) | 30 kills, 0 failures | 30 kills, 0 failures | 30 kills, 0 failures |
| Kill -9 durability, better-sqlite3 (native addon) | **could not install** (no prebuilt binary used, node-gyp found no usable Visual Studio) | 30 kills, 0 failures | 30 kills, 0 failures |
| Commit time, safe mode (synchronous=FULL), node:sqlite | **3.5 ms median, 6 ms p95** (255/s) | 0.09 ms median (about 10,000/s) | 0.24 ms median (about 3,200/s) |
| Commit time, relaxed mode (NORMAL) | 0.04 ms | 0.02 ms | 0.02 ms |
| Single executable built and ran | yes, 83 MB | yes, 107 MB | yes, 119 MB |
| SQLite version | 3.53.4 | 3.53.4 | 3.53.4 |

Notes: the CI runners are virtual machines, so timings are indicative only (Windows shows the real disk-flush cost; macOS and Linux runners flush cheaply). All numbers are from Node 22.23.4.

## 3. Findings and proposed decisions
1. **SQLite per Hub is viable** on all three systems with write-ahead logging and full-safety mode. Process crashes lose nothing that was acknowledged.
2. **Use the database built into Node (`node:sqlite`) for the Hub, not a native addon.** The addon failed to install on the Windows runner; the built-in one worked everywhere and also fits a single executable. Caveat: Node still labels it experimental in version 22 - confirm its status in Node 24 LTS before fixing the stack (open item). Fallback: better-sqlite3 with prebuilt binaries per OS, if Windows prebuilds are confirmed.
3. **Windows safe-mode commits cost about 3.5 ms.** One sale = one transaction (about 4 ms) is fine for the cashier; bulk work (imports, stocktake apply, sync batches) must be batched in one transaction. Never switch to relaxed mode for money or stock.
4. **The data rules in the ARD hold up:** single writer per branch, immutable movement rows with UUIDs, idempotency keys on every command, transfers as events with an in-transit store. Because the Hub serialises its own sales, two tills cannot oversell the last unit; the second is refused.
5. **Branches cannot hand over stock instantly:** every transfer step passes through the cloud (request, then dispatch, then receipt), so each step needs internet at both ends. The UX must show "waiting for the other branch to connect". Selling is never blocked.
6. **A single executable works unsigned on all three systems** but is large (83-119 MB, mostly the Node runtime). Acceptable for a downloaded installer; compression and delta updates can come later. This does not decide the desktop window shell (Electron or Tauri), which is still open.

## 4. Not proven yet (open S1 items - nothing here is assumed to work)
| Item | Why it is open |
|---|---|
| **Real power cut** (hard power-off of the machine) | Kill -9 tests only process crashes; the operating-system cache survives. Needs a VM hard stop or a physical test on the pharmacy PC. SQLite safe mode is designed for it but we have not seen it. |
| Installers, Windows service / macOS launchd / Linux systemd auto-start, restart after reboot | Only a console executable was tested. |
| Auto-update, activation (licence), code signing | Deferred or untested (D28 defers signing). |
| Desktop window shell (Electron vs Tauri) | Not built. |
| Real network: HTTPS between Hub and cloud, a till over the LAN | The prototype links components in-process; wire protocol, authentication and TLS are Phase 2. |
| Master-data conflicts (two branches edit the same item or price) | Stock has one writer by design; shared master data needs its own rule (central owner or versioned last-writer-wins). Decide in Phase 2 design. |
| Older/other targets: Windows 10 and 7, Intel Macs, Linux ARM, low-end PCs | Only current runner images were used. |
| Scale: months of data, 25k items, concurrent tills over the network | S4 and Phase 2. |

## 5. Decisions and questions for the owner
1. Approve `node:sqlite` as the Hub database direction (subject to the Node 24 check), with better-sqlite3 as the fallback.
2. Approve "transfers need internet at both ends" as the design.
3. What is the oldest Windows version and the weakest PC you must support at your pharmacy and for customers (for example Windows 7 or 10, 4 GB RAM)? This changes the runtime and shell choice.
4. Next step proposal: finish the open S1 items together with printing (S3) in **Sprint 0.3**, since both need real Windows machines and the pharmacy's printers. Say "go Sprint 0.3" after merging.
