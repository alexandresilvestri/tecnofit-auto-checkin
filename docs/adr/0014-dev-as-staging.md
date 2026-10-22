# 0014. Dev becomes staging after a one-shot migration

- Status: Accepted
- Date: 2026-10-22

## Context

The real users were already in dev before prod existed.

## Decision

- Create prod and move the real users from dev to prod once, with `npm run migrate` (dry run) and `npm run migrate -- --apply`.
- For each user, the migration re-encrypts the token with the prod key and creates the prod schedules disabled. It then writes the profile, which marks the user as migrated, enables the active schedules and deletes the user from dev last.
- After the migration, dev is staging and holds no real users.

## Consequences

- The script always copies dev to prod; the direction is fixed.
- A rerun does not copy a user whose prod profile exists; it only finishes enabling schedules and deleting the dev user.
- The migration must never run again now that dev is staging.
