# 0003. Synchronous Scheduler calls from the API

- Status: Accepted
- Date: 2026-10-21

## Context

Each schedule item has a matching EventBridge Scheduler schedule ([0002](0002-one-schedule-per-booking.md)). The original plan synced them through a DynamoDB Stream and a `schedule-sync` Lambda, with the table as the source of truth.

## Decision

- The API calls Scheduler directly through the domain functions in `packages/core/domain/schedules.ts` (`addSchedule`, `updateSchedule`, `removeSchedule`, `dropSchedule`).
- Each function writes DynamoDB first, then calls Scheduler. If the Scheduler call fails, it undoes the DynamoDB write.
- There is no DynamoDB Stream and no `schedule-sync` Lambda.

Reason: fewer moving parts. When Scheduler fails, the user sees the error at once and the item is rolled back.

## Consequences

- Any code path that changes a schedule's state must go through these functions. Suspending a user pauses schedules with `updateSchedule`; deleting a user removes them with `dropSchedule`.
- `api-user` and `api-admin` need Scheduler permissions and `iam:PassRole` where they create or update schedules.
- Writes from outside these functions (manual edits, a PITR restore) do not reach Scheduler. The runbook covers recreating schedules after a restore.
