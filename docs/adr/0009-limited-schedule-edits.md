# 0009. Schedule edits limited to pause and waiting list

- Status: Superseded by [0019](0019-remove-waiting-list.md)
- Date: 2026-10-21

## Context

A schedule names a class, a start time and either weekdays or a date. Creating one checks the class against the Tecnofit agenda and creates a Scheduler schedule with a matching expression.

## Decision

- `PATCH /api/schedules/{id}` changes only `active` (pause or resume) and `allowWaitingList`.
- Class, time and days cannot change. To change them, the user deletes the schedule and creates a new one.

Reason: changing class, time or days would require revalidating against the Tecnofit agenda and recreating the Scheduler schedule. Delete and create is simpler.

## Consequences

- The update path never touches the schedule expression.
- A one-off schedule whose fire time has passed shows as finished (`Encerrado`) and cannot be resumed. The API answers 409 `Este agendamento já foi executado.` (this schedule already ran).
