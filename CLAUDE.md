# CLAUDE.md - O-Pharmacy

Owner: Dr. Ahmed (Admin). Works from his phone, short on time. Reply in Egyptian Arabic (English technical terms); formal documents in English. Decide reasonably, state the decision in one line.

## Phase gate (always)
Read-only audit -> list decisions/blockers -> STOP -> his explicit "go" -> implement -> open PR -> STOP. Never start a feature, phase or patch on your own.

## Planning rule
Phase 0 produces documents only. No application code until ARD, ROADMAP and MASTERPLAN are approved by the owner.

## Direction (owner decisions, 10 Nov 2026 - see ARD §2)
All-in-one, commercial, Egypt first; Branch Hub (offline) + cloud; Node.js + TypeScript; React UI with a Word-style Ribbon; React Native white-label app per pharmacy; Next.js website; Single and Chain editions. Quality over speed.

## Inherited principles (from YK Pharmacy, to be confirmed in the ARD)
No-Delete (cancel/void/archive); additive migrations; UUID identities; outbox events; config engine (nothing hardcoded); branch isolation; audit trail; separators in text are "-" not middle dots.

## Never
Print or commit secrets, `.env`, passwords or tokens.
