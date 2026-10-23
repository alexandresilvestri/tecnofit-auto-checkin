# 0001. Check-in fires at class − 11h59, with a fixed rule

- Status: Superseded by [0020](0020-checkin-fires-at-opening-with-30s-retries.md)
- Date: 2026-10-21

## Context

Tecnofit opens check-in exactly 12 h before any class. Popular classes fill within seconds of opening, so the job must run right after that moment. The original plan fired 2 min before opening and learned a per-box opening offset from observed behaviour.

## Decision

- The job fires at class time minus 719 minutes (11 h 59 min), in `America/Sao_Paulo` (`packages/core/domain/time.ts`). Example: a 17:15 class fires at 05:16.
- Firing 1 min after opening avoids errors at the exact opening second.
- The rule is fixed. There is no per-box offset learning: the rule is the same for every box, and learning it would only add state.
- The worker derives the class slot from the schedule's fire time: `scheduledTime + 719 min`.

## Consequences

- When class − 719 min crosses midnight, weekly cron weekdays shift back one day. A 07:00 class fires at 19:01 the day before.
- A one-off booking is refused unless the class starts more than 11 h 59 min from now.
- If Tecnofit changes its opening rule, `FIRE_BEFORE_CLASS_MIN` and existing schedules must change.

See [architecture.md](../architecture.md#check-in-flow).
