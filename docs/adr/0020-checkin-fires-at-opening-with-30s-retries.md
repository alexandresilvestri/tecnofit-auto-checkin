# 0020. Check-in fires at the opening and retries every 30 s

- Status: Accepted
- Date: 2026-10-15

## Context

[ADR 0001](0001-checkin-fires-at-class-minus-11h59.md) fired the job at class − 11h59, 1 min after Tecnofit opens check-in. The worker then retried every 300 to 500 ms for 90 s. The user wants the first try at the opening itself, not 1 min later.

In prod, EventBridge Scheduler started the worker about 9.5 s after the scheduled minute.

## Decision

- The job fires at class time minus 720 minutes (12 h), in `America/Sao_Paulo`, on the minute check-in opens. Example: a 17:15 class fires at 05:15.
- There is no earlier fire with a wait inside the worker.
- After a failed try, the worker waits for the next 30 s mark, counted from the start of the run, and tries again. It stops after 4 retries (about 2 min). Failed `listEvents` calls use the same 4 retries.
- The 30 s pace avoids hammering Tecnofit.
- The worker derives the class slot from `scheduledTime + 720 min`. The rule stays fixed for every box, as in ADR 0001.

## Consequences

- The first POST lands a few seconds after the opening, because of the Scheduler delay and the cold start.
- If the first try fails, the next one comes up to 30 s later. A popular class can fill in that time.
- A class before 12:00 fires on the previous day. A 07:00 class fires at 19:00 the day before.
- A one-off booking is refused unless the class starts more than 12 h from now.
- The worker Lambda timeout goes from 120 s to 180 s.
- Schedules created before this change still fire at class − 11h59 and were not migrated. The worker derives a slot 1 min off, so they fail with `window_mismatch` until the user deletes and recreates them.
