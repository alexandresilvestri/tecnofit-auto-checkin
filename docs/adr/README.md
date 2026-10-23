# Architecture decision records

Each record states one decision: its context, what was decided and what follows from it. Records describe decisions already in effect.

| ADR | Decision | Date |
| --- | --- | --- |
| [0001](0001-checkin-fires-at-class-minus-11h59.md) | Check-in fires at class − 11h59, with a fixed rule | 2026-10-21 |
| [0002](0002-one-schedule-per-booking.md) | One Scheduler schedule per booking, no retries, idempotent claim | 2026-10-21 |
| [0003](0003-synchronous-scheduler-calls.md) | Synchronous Scheduler calls from the API | 2026-10-21 |
| [0004](0004-single-table-dynamodb-and-audit-table.md) | Single-table DynamoDB with ElectroDB and a separate audit table | 2026-10-20 |
| [0005](0005-kms-token-encryption.md) | Tecnofit token encrypted with KMS, bound to the user | 2026-10-21 |
| [0006](0006-opaque-session-cookie.md) | Opaque session cookie with a Lambda authorizer | 2026-10-20 |
| [0007](0007-invite-only-onboarding.md) | Invite-only onboarding | 2026-10-20 |
| [0008](0008-reconnect-through-login.md) | Reconnect through login | 2026-10-21 |
| [0009](0009-limited-schedule-edits.md) | Schedule edits limited to pause and waiting list | 2026-10-21 |
| [0010](0010-admin-cognito-mfa.md) | Admin through Cognito with TOTP MFA, wired in the `auth` module | 2026-10-22 |
| [0011](0011-cloudfront-origin-secret.md) | CloudFront origin secret header | 2026-10-22 |
| [0012](0012-region-and-runtime.md) | Region us-east-1 and Node.js 24 runtime | 2026-10-21 |
| [0013](0013-release-by-immutable-sha.md) | Immutable artifacts per sha, dev on merge, promote and rollback by sha | 2026-10-22 |
| [0014](0014-dev-as-staging.md) | Dev becomes staging after a one-shot migration | 2026-10-22 |
| [0015](0015-local-environment-on-moto.md) | Local environment on moto with the real Lambda handlers | 2026-10-22 |
| [0016](0016-frontend-without-router-or-ui-library.md) | Frontend without a router or UI library, under a strict CSP | 2026-10-22 |
| [0017](0017-lgpd-consent-versioning.md) | LGPD consent with a versioned text | 2026-10-21 |
| [0018](0018-dependency-update-policy.md) | Dependency update policy | 2026-10-21 |
| [0019](0019-remove-waiting-list.md) | Waiting list removed, schedule edits limited to pause | 2026-10-22 |

## Adding a record

1. Copy the template below into `NNNN-short-title.md`, using the next number.
2. Write the context and the reason as they were stated. Never guess a reason.
3. To replace a decision, add a new record and set the old one's status to `Superseded by NNNN`.
4. Add the record to the table above.

```markdown
# NNNN. Title

- Status: Accepted
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```
