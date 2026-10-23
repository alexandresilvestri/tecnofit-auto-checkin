# 0004. Single-table DynamoDB with ElectroDB and a separate audit table

- Status: Accepted
- Date: 2026-09-01

## Context

The app stores users, Tecnofit accounts, schedules, executions, invites, sessions and login failures. Every read goes through a known key: a user, a schedule, a session, a date. It also keeps an audit trail of human actions that the app itself must not be able to change.

## Decision

- **Main table** `checkin-<env>-main` holds every entity except audit events, in a single-table design with generic keys `PK`/`SK`, `GSI1PK`/`GSI1SK`, `GSI2PK`/`GSI2SK` and TTL attribute `ttl`.
- **ElectroDB** models the entities as typed schemas over that table (`packages/core/db/entities.ts`).
- **Audit table** `checkin-<env>-audit` is insert-only for the application. No application role can update or delete an event. Events expire after 365 days: enough trail without keeping personal data forever.
- Both tables use on-demand capacity, point-in-time recovery and deletion protection.

## Consequences

- Entities are typed, and every read is a get or a query. [data-model.md](../data-model.md) lists the access patterns.
- Audit integrity is enforced by IAM, not by convention.
- ElectroDB adds `__edb_e__` and `__edb_v__` attributes; raw items are easier to read through ElectroDB.
- The key schema is defined twice: in Terraform (`infra/modules/data/main.tf`) and in `packages/core/db/table.ts` for local runs and tests.
