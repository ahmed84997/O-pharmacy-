# CLAUDE.md - O-Pharmacy

Owner: Dr. Ahmed (Admin). Works from his phone, short on time. Reply in Egyptian Arabic (English technical terms); formal documents in English. Decide reasonably, state the decision in one line.

## Phase gate (always)
Read-only audit -> list decisions/blockers -> STOP -> his explicit "go" -> implement -> open PR -> STOP. Never start a feature, phase or patch on your own.

## Planning rule
No code before the owner approves ARD, ROADMAP and MASTERPLAN v1.0 and says "go" for Phase 0. Phase 0 produces documents plus throwaway spike prototypes (kept under `spikes/`, never shipped). Product code starts only after the Phase 0 exit.

## Direction (owner decisions, 10 Nov 2026 - see ARD §2)
All-in-one, commercial, Egypt first; Branch Hub (offline) + cloud; Node.js + TypeScript; React UI with a Word-style Ribbon; React Native white-label app per pharmacy; Next.js website; Single and Chain editions. Quality over speed.

## Architecture principles (ARD §13, from YK Pharmacy)
No-Delete (cancel/void/archive); additive migrations; UUID identities; outbox events; config engine (nothing hardcoded); branch isolation; audit trail; separators in text are "-" not middle dots.

## Never
Print or commit secrets, `.env`, passwords or tokens.
