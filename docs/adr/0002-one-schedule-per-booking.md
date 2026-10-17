# 0002. One EventBridge Scheduler schedule per booking, no retries, idempotent claim

- Status: Accepted
- Date: 2026-10-21

## Context

Each booking must fire at an exact minute ([0020](0020-checkin-fires-at-opening-with-30s-retries.md)). A check-in that arrives late loses the spot. A duplicate invocation must not check in twice.

## Decision

- Every booking gets its own EventBridge Scheduler schedule, named after `scheduleId`, in group `checkin-<env>`. This fires exactly per class, with no table scan.
- Weekly bookings use `cron(...)`; one-off bookings use `at(...)` with `ActionAfterCompletion: DELETE`. Timezone `America/Sao_Paulo`, flexible time window off.
- Scheduler retries and Lambda async retries are both 0, with a 60 s maximum event age. A retry outside the window would arrive too late for the spot. Retries happen only inside one worker run: up to 4, 30 s apart ([0020](0020-checkin-fires-at-opening-with-30s-retries.md)).
- The worker claims the run with a conditional create of the execution item (`SCHEDULE#<id>` / `EXEC#<classDate>`). A duplicate invocation finds the item and stops.
- Application code creates schedules at runtime; Terraform creates only the group and the invoke role.

## Consequences

- A failed check-in is not retried. It is recorded on the execution item and raises the `checkin-failed` alarm.
- If the worker is killed after the claim (timeout or crash), the execution stays `running`. Nothing sweeps it.
- A one-off schedule deletes itself after firing. `GET /api/schedules` deletes its item once the run ends, or right away if it was paused. Until then, the item shows as finished.
- Schedules are not in Terraform state. A restore or migration must recreate them from the items ([runbook](../runbook.md)).
