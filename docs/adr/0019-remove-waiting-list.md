# 0019. Waiting list removed, schedule edits limited to pause

- Status: Accepted
- Date: 2026-10-22

## Context

[ADR 0009](0009-limited-schedule-edits.md) let a schedule join Tecnofit's waiting list when the class was full, through `allowWaitingList`. Nobody uses the option.

## Decision

- The app never asks for the waiting list. The worker always sends `requestWaitingList: false`, and a full class fails with `full`.
- `allowWaitingList` is gone from the API, the `schedule` entity, the CLI and the web app.
- `PATCH /api/schedules/{id}` changes only `active` (pause or resume).
- Class, time and days still cannot change. To change them, the user deletes the schedule and creates a new one, as in ADR 0009.

## Consequences

- Schedules created with the option on stop joining the waiting list. Their stored `allowWaitingList` attribute is ignored.
- The `waitlisted` execution status stays, so that older executions still display. They expire with the 90-day TTL.
- During a release, the backend changes before the web app. A stale tab that sends `allowWaitingList` gets a 400 until it reloads.
