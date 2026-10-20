# Data model

The app keeps all state in two DynamoDB tables. The main table holds seven entities in a single-table design. The audit table holds only the audit log.

- Entity definitions (ElectroDB): `packages/core/db/entities.ts`
- Table definitions (Terraform): `infra/modules/data/main.tf`
- Key and GSI schema for local runs: `packages/core/db/table.ts`, used by `scripts/local-api.ts`
- Diagram source: [`data-model.dbml`](data-model.dbml)

Related docs: [architecture](architecture.md), [API](api.md), [Tecnofit integration](tecnofit-integration.md), [infrastructure](infrastructure.md), [runbook](runbook.md).

## Tables

Both tables use the same key schema and settings, listed in [infrastructure.md](infrastructure.md#dynamodb). Only their contents and access rules differ.

| Table | Entities |
|---|---|
| `checkin-<env>-main` | `profile`, `account`, `schedule`, `execution`, `invite`, `session`, `loginFail` |
| `checkin-<env>-audit` | `audit` |

### Audit table access

No application role can update or delete audit items. The per-function grants are in [infrastructure.md](infrastructure.md#lambda).

## Key schema

Every key attribute is a DynamoDB string (`S`). Entities fill them from the templates in `entities.ts`.

| Attribute | Role |
|---|---|
| `PK` | Table partition key |
| `SK` | Table sort key |
| `GSI1PK` | `GSI1` partition key |
| `GSI1SK` | `GSI1` sort key |
| `GSI2PK` | `GSI2` partition key |
| `GSI2SK` | `GSI2` sort key |

Templates use ElectroDB syntax: `USER#${userId}` stores the literal `USER#` followed by the `userId` value. An entity writes only the GSI keys its model defines.

Shared partitions:

- `PK = USER#${userId}` holds the user's `profile`, `account` and `schedule` items.
- `GSI1PK = USER#${userId}` holds the user's `execution` and `session` items.
- `GSI2PK = ENTITY#USER` holds every profile. `GSI2PK = ENTITY#INVITE` holds every invite.

ElectroDB separates entities in a shared partition by sort key prefix and by its identifier attributes.

## Entities

Types are DynamoDB types. Timestamps named `createdAt`, `usedAt`, `lastSeenAt` and `at` are ISO 8601 strings in UTC. `classDate`, `day`, `date` and `startTime` use the `America/Sao_Paulo` time zone (`TZ` in `packages/core/domain/time.ts`).

### profile

One item per user: identity and status. `redeemInvite` (`packages/core/domain/invites.ts`) creates it at onboarding. The operator script `scripts/connect.ts` can also create it.

| Key | Template |
|---|---|
| PK | `USER#${userId}` |
| SK | `PROFILE` |
| GSI1 (`byEmail`) | `EMAIL#${tecnofitEmail}` / `PROFILE` |
| GSI2 (`byCreated`) | `ENTITY#USER` / `${createdAt}` |
| TTL | none |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `userId` | string | yes | `u_<uuid>` |
| `name` | string | yes | `customer.name` from Tecnofit `GET /aluno/eu` |
| `tecnofitEmail` | string | yes | Login email, trimmed and lowercased by `normalizeEmail` |
| `tecnofitUserId` | number | yes | JWT claim `user_id` |
| `status` | enum | yes | `active`, `suspended` |
| `createdAt` | string | yes | ISO 8601 |

`suspendUser` and `reactivateUser` (`packages/core/domain/users.ts`) switch `status`.

### account

The user's Tecnofit connection: encrypted token, box name and connection state. Onboarding creates it. `loginUser` (`packages/core/domain/sessions.ts`) refreshes it.

| Key | Template |
|---|---|
| PK | `USER#${userId}` |
| SK | `ACCOUNT#${empresaId}` |
| GSI1 | none |
| GSI2 | none |
| TTL | none |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `userId` | string | yes | Owner |
| `empresaId` | string | yes | JWT claim `empresa_id`, stored as a string |
| `tokenEnc` | string | yes | Tecnofit JWT encrypted with KMS, base64. See [token storage](tecnofit-integration.md#token-storage) |
| `tokenExp` | number | yes | JWT claim `exp`, epoch seconds |
| `boxName` | string | yes | Company name from `GET /aluno/eu`; falls back to `empresaId` |
| `status` | enum | yes | `ok`, `reconnect` |

`status` becomes `reconnect` when Tecnofit answers 401. The worker (`runCheckin` in `packages/core/domain/checkin.ts`) and `withToken` (`packages/core/domain/schedules.ts`) set it. A successful `loginUser` sets it back to `ok`.

### schedule

A recurring or one-off check-in rule. Each item pairs with an EventBridge Scheduler schedule named after `scheduleId` in the group `checkin-<env>`. A `once` schedule deletes itself after firing; its item stays.

| Key | Template |
|---|---|
| PK | `USER#${userId}` |
| SK | `SCHEDULE#${scheduleId}` |
| GSI1 | none |
| GSI2 | none |
| TTL | none |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `userId` | string | yes | Owner |
| `scheduleId` | string | yes | `s_<uuid>` |
| `empresaId` | string | yes | Copied from the account |
| `className` | string | yes | Tecnofit event `name` |
| `startTime` | string | yes | `HH:MM` |
| `kind` | enum | yes | `weekly`, `once` |
| `weekdays` | list of number | `weekly` only | `1` (Monday) to `6` (Saturday) |
| `date` | string | `once` only | `YYYY-MM-DD` |
| `active` | boolean | yes | `false` disables the EventBridge schedule |
| `pausedBySuspension` | boolean | no | `true` while a suspension paused the schedule |

`addSchedule`, `updateSchedule` and `removeSchedule` in `packages/core/domain/schedules.ts` write it.

### execution

One check-in run for one schedule and one class date. The worker creates and finishes it in `runCheckin`.

| Key | Template |
|---|---|
| PK | `SCHEDULE#${scheduleId}` |
| SK | `EXEC#${classDate}` |
| GSI1 (`byUser`) | `USER#${userId}` / `EXEC#${classDate}#${scheduleId}` |
| GSI2 (`byDate`) | `EXECDATE#${classDate}` / `${status}#${userId}` |
| TTL | claim time + 90 days |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `scheduleId` | string | yes | Parent schedule |
| `classDate` | string | yes | `YYYY-MM-DD` |
| `userId` | string | yes | Owner |
| `className` | string | no | Copied from the schedule at claim time |
| `startTime` | string | no | Copied from the schedule at claim time |
| `status` | enum | yes | `running`, `success`, `waitlisted`, `failed`, `skipped` |
| `checkInId` | string | no | Tecnofit check-in id |
| `attempts` | number | yes | `POST .../check-in` calls made |
| `latencyMs` | number | no | Milliseconds from the scheduled fire time to the accepted check-in |
| `error` | string | no | Failure code, see below |
| `ttl` | number | yes | Epoch seconds |

Status values:

- `running`: claimed, not finished.
- `success`: checked in, or already checked in.
- `waitlisted`: Tecnofit placed the user on the waiting list. Only older executions have it ([ADR 0019](adr/0019-remove-waiting-list.md)).
- `failed`: see `error`.
- `skipped`: profile `suspended` or account `reconnect`.

`error` values written by `runCheckin`:

| Code | Meaning |
|---|---|
| `window_mismatch` | The fire time does not match the schedule's start time, date or weekdays |
| `class_not_found` | No event with that name and start on the agenda |
| `full` | The class is full |
| `timeout` | No result after the worker's last retry |
| `unauthorized` | Tecnofit rejected the token. The account becomes `reconnect` |
| `invalid_response` | Tecnofit returned a body that failed validation |
| `unexpected` | Any other error. The worker records it and rethrows |

Cases where `runCheckin` writes no item are in [tecnofit-integration.md](tecnofit-integration.md#check-in-worker).

### invite

A single-use onboarding invite. `createInvite` (`packages/core/domain/invites.ts`) creates it from the admin API or `scripts/invite.ts`.

| Key | Template |
|---|---|
| PK | `INVITE#${inviteId}` |
| SK | `META` |
| GSI1 | none |
| GSI2 (`byCreated`) | `ENTITY#INVITE` / `${createdAt}` |
| TTL | `expiresAt` + 7 days |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `inviteId` | string | yes | SHA-256 hex of the invite token. The token itself is not stored |
| `label` | string | no | Free text |
| `status` | enum | yes | `pending`, `used`, `expired`, `revoked`, `burned` |
| `expiresAt` | number | yes | Epoch milliseconds, creation + 15 minutes |
| `attempts` | number | yes | Credential rejections during redeem |
| `createdBy` | string | yes | `cli` or the admin's Cognito `sub` |
| `usedBy` | string | no | `userId` created by the redeem |
| `usedAt` | string | no | ISO 8601 |
| `createdAt` | string | yes | ISO 8601 |
| `ttl` | number | yes | Epoch seconds |

`expired` is never stored. `listInvites` returns it for `pending` invites past `expiresAt`. `burned` is set after 5 credential rejections.

### session

A web session. The `sid` cookie carries a random token. The item stores only its hash.

| Key | Template |
|---|---|
| PK | `SESSION#${sessionId}` |
| SK | `META` |
| GSI1 (`byUser`) | `USER#${userId}` / `SESSION#${createdAt}` |
| GSI2 | none |
| TTL | none |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `sessionId` | string | yes | SHA-256 hex of the cookie token |
| `userId` | string | yes | Owner |
| `createdAt` | string | yes | ISO 8601 |
| `lastSeenAt` | string | yes | ISO 8601, refreshed at most once per 24 hours |
| `ip` | string | yes | Client IP |
| `userAgent` | string | yes | Client User-Agent |

`packages/core/domain/sessions.ts` creates, resolves, touches and revokes single sessions. `revokeUserSessions` (`packages/core/domain/users.ts`) revokes all sessions of a user.

### loginFail

A failed-login counter per email. `loginUser` locks the email after 5 failures.

| Key | Template |
|---|---|
| PK | `LOGINFAIL#${email}` |
| SK | `META` |
| GSI1 | none |
| GSI2 | none |
| TTL | first failure + 15 minutes |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | Normalized login email |
| `count` | number | yes | Failures in the current window |
| `ttl` | number | yes | Epoch seconds, set once per window |

### audit

One audit event. `writeAudit` (`packages/core/audit/audit.ts`) is the only writer. This entity lives in the audit table.

| Key | Template |
|---|---|
| PK | `DAY#${day}` |
| SK | `${at}#${eventId}` |
| GSI1 (`byActor`) | `ACTOR#${actorId}` / `${at}` |
| GSI2 (`byTarget`) | `TARGET#${targetId}` / `${at}` |
| TTL | write time + 365 days |

| Attribute | Type | Required | Notes |
|---|---|---|---|
| `day` | string | yes | `YYYY-MM-DD` of `at` |
| `at` | string | yes | ISO 8601 |
| `eventId` | string | yes | Random UUID |
| `actorType` | enum | yes | `user`, `anonymous`, `system`, `cli`, `admin` |
| `actorId` | string | yes | `userId`, admin Cognito `sub`, `anonymous`, `system` or `cli` |
| `action` | string | yes | One of `AUDIT_ACTIONS` in `audit.ts` |
| `targetType` | string | no | `invite`, `user` or `schedule` |
| `targetId` | string | no | Id of the target |
| `result` | enum | yes | `success`, `denied`, `error` |
| `ip` | string | no | Client IP |
| `userAgent` | string | no | Client User-Agent |
| `metadata` | map | no | Strict keys: `consentVersion`, `reason`, `label`, `filter` (max 500 chars) |
| `ttl` | number | yes | Epoch seconds |

## Access patterns

Every read is a `GetItem` or a `Query`. No code path scans.

| Operation | Key or index used | Code path |
|---|---|---|
| Get a profile | `PK = USER#${userId}`, `SK = PROFILE` | `runCheckin`, `requireProfile`, `migrateUser`; `apps/functions/api-user/index.ts`, `apps/functions/api-admin/index.ts` |
| Find a profile by email | `GSI1`, `GSI1PK = EMAIL#${tecnofitEmail}` | `redeemInvite`, `loginUser`, `scripts/connect.ts` |
| List all users | `GSI2`, `GSI2PK = ENTITY#USER` (descending in `api-admin`) | `apps/functions/api-admin/index.ts`, `scripts/migrate.ts` |
| Get an account | `PK = USER#${userId}`, `SK = ACCOUNT#${empresaId}` | `runCheckin` |
| Get a user's first account | `PK = USER#${userId}`, `SK` begins with `ACCOUNT#`, limit 1 | `withToken`; `api-user` `/api/me`; `api-admin` user detail |
| List a user's accounts | same, all pages | `deleteUser`, `migrateUser` |
| Get a schedule | `PK = USER#${userId}`, `SK = SCHEDULE#${scheduleId}` | `runCheckin`, `updateSchedule`, `removeSchedule` |
| List a user's schedules | `PK = USER#${userId}`, `SK` begins with `SCHEDULE#` | `listSchedules`, `deleteUser` |
| Claim an execution | create `PK = SCHEDULE#${scheduleId}`, `SK = EXEC#${classDate}` | `runCheckin` |
| Last execution of a schedule | `PK = SCHEDULE#${scheduleId}`, descending, limit 1 | `api-user` `GET /api/schedules` |
| A user's executions, paged | `GSI1`, `GSI1PK = USER#${userId}`, `GSI1SK` begins with `EXEC#`, descending, 20 per page | `listExecutions` |
| All of a user's executions | same, all pages | `deleteUser`, `migrateUser`, `scripts/migrate.ts` |
| Executions on a date | `GSI2`, `GSI2PK = EXECDATE#${classDate}` | `listExecutionsByDate` |
| Get an invite | `PK = INVITE#${inviteId}`, `SK = META` | `checkInvite`, `redeemInvite`, `revokeInvite` |
| List invites, newest first | `GSI2`, `GSI2PK = ENTITY#INVITE`, descending | `listInvites` |
| Resolve a session cookie | `PK = SESSION#${sessionId}`, `SK = META` | `resolveSession` in `apps/functions/authorizer-user/index.ts` |
| List a user's sessions | `GSI1`, `GSI1PK = USER#${userId}`, `GSI1SK` begins with `SESSION#` | `revokeUserSessions`; `api-admin` user detail |
| Read a login failure counter | `PK = LOGINFAIL#${email}`, `SK = META` | `loginUser` |
| Audit events of a day | audit table, `PK = DAY#${day}`, descending | `queryAudit` |
| Audit events of an actor | audit `GSI1`, `GSI1PK = ACTOR#${actorId}`, `GSI1SK` between two instants | `queryAudit` |
| Audit events of a target | audit `GSI2`, `GSI2PK = TARGET#${targetId}`, `GSI2SK` between two instants, or latest 50 | `queryAudit`; `api-admin` user detail |

`queryAudit` accepts at most 31 days and returns at most 1000 items, with a `truncated` flag.

## Transactions and conditional writes

ElectroDB adds existence conditions by method:

| Method | Condition added |
|---|---|
| `create` | `attribute_not_exists(PK) AND attribute_not_exists(SK)` |
| `patch` | `attribute_exists(PK) AND attribute_exists(SK)` |
| `put`, `update`, `delete` | none |

`isConditionalFailure` in `entities.ts` detects a failed condition (`ConditionalCheckFailedException`).

### Idempotent execution claim

`runCheckin` claims a class with a `create` of its execution item. A second invocation for the same schedule and class date fails that condition and makes no Tecnofit call.

`runCheckin` then patches the outcome onto the same item. The patch always sets `userId`, because `GSI2SK` is built from `status` and `userId`. The full walk is in [tecnofit-integration.md](tecnofit-integration.md#check-in-worker).

### Invite redeem

`redeemInvite` commits onboarding in one DynamoDB transaction through `entities.service`. That ElectroDB `Service` groups `invite`, `profile`, `account` and `session`.

1. Patch the invite to `used`, with `usedBy` and `usedAt`. Condition: `status = pending AND expiresAt > now`.
2. Create the profile.
3. Create the account.
4. Create the first session.

If DynamoDB cancels the transaction, none of the four writes applies. The request then fails with `InviteInvalid`.

### Other conditional writes

Conditions below are in addition to the method's existence check.

| Write | Method and expression | Code path |
|---|---|---|
| Revoke an invite | `patch`, `status = pending` | `revokeInvite` |
| Burn an invite after 5 rejections | `patch`, `status = pending` | `redeemInvite` |
| Count a redeem rejection | `patch`, atomic `ADD attempts 1` | `redeemInvite` |
| Refresh `lastSeenAt` | `patch`, `lastSeenAt` older than 24 hours | `touchSession` |
| Count a failed login | `update` (upsert), `ADD count 1` and `SET ttl = if_not_exists(ttl, now + 15 min)` | `loginUser` |

## Retention

TTL removes four entities. Code paths remove the rest.

| Entity | Removed by | When |
|---|---|---|
| `execution` | TTL | 90 days after the claim |
| `invite` | TTL | 7 days after `expiresAt` |
| `loginFail` | TTL; `loginUser` | 15 minutes after the first failure, or on a successful login |
| `audit` | TTL | 365 days after the event |
| `profile`, `account` | `deleteUser` | User self-deletion or admin deletion |
| `schedule` | `removeSchedule`, `deleteUser` | Schedule removal or user deletion |
| `session` | `revokeSession`, `revokeUserSessions` | Logout, admin revocation, suspension or user deletion |

`deleteUser` (`packages/core/domain/users.ts`) removes the user's schedules, executions, accounts, profile and sessions. It does not touch the redeemed invite, `loginFail` items or audit events. `migrateUser` (`packages/core/domain/migrate.ts`) also calls it on the source environment.

Point-in-time recovery covers both tables. See the [runbook](runbook.md) for restores.

## ElectroDB notes

- Service name `checkin`. Every entity model has version `1`.
- ElectroDB writes `__edb_e__` (entity name) and `__edb_v__` (`1`) on every item. It reads them to tell which entity owns an item.
- Every key sets `casing: "none"`, so key values keep their case. ElectroDB's default would lowercase them.
- Emails are normalized in code (`normalizeEmail`) before every write and lookup.
- An update that changes one composite attribute of an index must also pass the others.
- A missing optional composite still produces a key. Audit events without `targetId` get `GSI2PK = TARGET#`.
- `listExecutions` pages with ElectroDB cursors. An invalid cursor raises `InvalidCursor`.

## Viewing the diagram

Paste [`data-model.dbml`](data-model.dbml) into <https://dbdiagram.io>. Its `Ref`s are logical, because DynamoDB enforces no foreign keys.

## Facts worth knowing

- Emails are stored in plaintext inside keys: `LOGINFAIL#<email>` and the profile index `EMAIL#<email>`.
- The email index does not enforce uniqueness. `redeemInvite` checks for an existing profile with a query before its transaction.
- Accounts are keyed by `empresaId`, but each user has one account in practice. Onboarding and `scripts/connect.ts` create one, from the JWT `empresa_id`.
- `loginUser` patches the account at the `empresa_id` of the new JWT. The patch fails if no account exists for that `empresaId`.
- `tokenExp` is written but no code reads it. An expired token shows up as a Tecnofit 401.
- `loginUser` treats a `loginFail` item with `ttl <= now` as expired and deletes it. It does not wait for TTL deletion.
- Removing a schedule keeps its executions until their TTL.
