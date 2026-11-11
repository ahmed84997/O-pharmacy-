# ADR-0001 - Backend framework: Fastify

Date: 11 Nov 2026 (Sprint 2.4). Status: decided (technical decision inside the approved Node.js + TypeScript direction; no owner action needed).

## Context
The Cloud needs an HTTP API for Hub sync, device authentication and later the Customer App and Website. ARD left the framework open until Phase 2.

## Decision
**Fastify 5** with `pg` (node-postgres), no ORM at this stage.

## Why
- TypeScript-first, JSON-schema validation built in (the ingest endpoint rejects bad ids, oversize batches and extra fields).
- Small plugin model and hooks: device authentication is one hook; tenant context is one helper (`withTenant`) around every query.
- Fast and light on plain Node `http`, so the same code can run in the Hub's single executable if the Hub needs a local API.
- Raw SQL with `pg` keeps Row-Level Security visible and testable (S6); an ORM would hide the tenant context that must never be skipped.

## Alternatives considered
Hono (very light, less mature server plugin ecosystem for our needs), NestJS (heavier, more ceremony than a modular monolith needs), Express (no built-in validation, slower, older design).

## Consequences
Revisit only if the API grows far beyond sync (then add a query builder, still not an ORM that bypasses `withTenant`).
