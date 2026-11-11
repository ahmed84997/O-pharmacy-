# ADR-0002 - Desktop window shell: Electron (accepted)

Date: 11 Nov 2026 (Sprint 2.6). Status: **accepted by the owner on 11 Nov 2026 (ARD D35)**; still reversible at low cost (see Consequences).

## Context
D27 requires Windows, macOS and Linux. ARD section 7: the Hub runs as a background service (database, sync, print service); the user opens "O Pharmacy" from a desktop icon in its own window. The window only shows the React Ribbon UI served by the local Hub.

## Options
| | Electron | Tauri 2 | Browser app-mode (no shell) |
|---|---|---|---|
| Web engine | Bundled Chromium, identical on all 3 OS | System WebView: WebView2 (Win), WKWebView (macOS), WebKitGTK (Linux) | The user's installed browser |
| Arabic RTL, Ribbon CSS, printing | One engine to test | Three engines; WebKitGTK on Linux is the weakest | Depends on user's browser version |
| Node (Hub code, node:sqlite, Fastify) | Same runtime as the Hub, can host it | Rust shell; Node must ship as a separate sidecar (we already ship one in S1) | Not applicable |
| Installer size | About 100-150 MB | About 10-20 MB plus the Node sidecar | Smallest |
| Auto-update | Our signed-manifest logic (this sprint) or electron-updater | Built-in updater plugin or ours | Ours only |
| Risk | Size, memory | Rendering differences, Rust toolchain for the team | Pharmacy PCs with old or missing browsers |

## Decision
**Electron**, as a thin window: the Hub stays a separate background service (survives window close and PC login changes); the window loads the Hub's local address. Reasons: one rendering engine across three operating systems (Arabic, Ribbon and receipt printing are the product's core risk), one language (TypeScript) and one runtime for the team, and no extra sidecar. The installer size (S1 already measured 83-119 MB for the Hub alone) is acceptable for a downloaded installer on pharmacy PCs.

## Consequences
- Because the window is thin and talks only HTTP to the Hub, switching to Tauri later means replacing the shell, not the product.
- The update logic (signed manifest, SHA-256, staged rollout, rollback) is shell independent and already built in `packages/core`.
- Still to prove on real machines (next step): installer per OS, Windows service / launchd / systemd registration, first activation with the licence, update install and rollback.
