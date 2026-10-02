# Tecnofit integration

The app talks to the Tecnofit REST API to log users in, read the class agenda and check in. Every call goes through `packages/core/tecnofit/client.ts`. No other module sends HTTP requests to Tecnofit.

Related docs: [architecture](architecture.md), [data model](data-model.md), [runbook](runbook.md).

## Client basics

The client is a thin `fetch` wrapper with fixed host, headers and timeout. It validates every response body with zod.

| Item | Value |
|---|---|
| Base URL | `https://rest.tecnofit.com.br` (constant `HOST`; no environment override) |
| `User-Agent` | `Tecnofit Box/43.7.5 (Android 13; WayDroid x86_64 Device; waydroid_x86_64; x86_64)` on every request |
| `Authorization` | `Bearer <JWT>` on every call except `POST /auth` |
| `Content-Type` | `application/json`, only on requests with a body |
| Method | `POST` when the call has a body, otherwise `GET` |
| Timeout | 5 seconds per request (`AbortSignal.timeout(5000)`) |
| Retries | none |

Response schemas are zod objects. Unknown fields are ignored. A missing or mistyped field fails validation.

## Endpoints

The client exposes five functions, one per endpoint.

| Function | Method | Path | Auth |
|---|---|---|---|
| `login` | `POST` | `/auth` | none |
| `getMe` | `GET` | `/aluno/eu` | Bearer |
| `listEvents` | `GET` | `/v2/{empresaId}/crossfit/wod/{date}/programs/calendar/events?realtime=2` | Bearer |
| `getEvent` | `GET` | `/v2/{empresaId}/crossfit/wod/{date}/programs/{classId}/calendar/events/{eventId}` | Bearer |
| `checkIn` | `POST` | `/v2/{empresaId}/crossfit/wod/{date}/programs/{classId}/calendar/events/{eventId}/check-in` | Bearer |

Path parameters:

- `empresaId`: Tecnofit company (box) id, a number. It comes from the JWT claim `empresa_id`.
- `date`: class date, `YYYY-MM-DD`.
- `classId` and `eventId`: `classId` and `id` of an event returned by `listEvents`.

### `POST /auth`

Exchanges the user's Tecnofit email and password for a JWT.

Request body:

```json
{ "email": "<email>", "password": "<password>" }
```

| Response field | Type | Use |
|---|---|---|
| `token` | string | The JWT. The client decodes its claims, see [JWT claims](#jwt-claims) |

`login` returns `{ token, userId, empresaId, exp }`.

### `GET /aluno/eu`

Returns the logged-in customer and their companies. `getMe` returns the `customer` object.

| Response field | Type | Use |
|---|---|---|
| `customer.id` | number | Validated only |
| `customer.name` | string | Stored as `profile.name` |
| `customer.email` | string | Validated only |
| `customer.companies[].id` | number | Matched against the JWT `empresa_id` |
| `customer.companies[].name` | string | Stored as `account.boxName` for the matching company |
| `customer.companies[].customerStatus` | string | Validated only |
| `customer.companies[].hasAccess` | boolean | Validated only |

If no company matches, `boxName` falls back to the `empresa_id` as a string.

### `GET .../calendar/events?realtime=2`

Lists the classes (events) of one day. `listEvents` returns the `events` array.

| Response field | Type | Use |
|---|---|---|
| `events[].id` | number | `eventId` in later paths |
| `events[].classId` | number | `classId` in later paths |
| `events[].name` | string | Matched against `schedule.className` |
| `events[].start` | string | `YYYY-MM-DD HH:MM`; matched against the class date and `startTime` |
| `events[].count` | number | Attendees so far |
| `events[].capacity` | number | Class capacity |
| `events[].checkInId` | number or null | Non-null when the user is already checked in |

### `GET .../calendar/events/{eventId}`

Reads one event's attendance and the user's check-in state. `getEvent` returns `{ count, capacity, checkedIn, onTimeToCheckIn }`.

| Response field | Type | Use |
|---|---|---|
| `event.attendance.count` | number | Returned as `count` |
| `event.attendance.capacity` | number | Returned as `capacity` |
| `event.checkIn` | any or null | `checkedIn` is `true` when not null |
| `event.onTimeToCheckIn` | boolean | Returned as `onTimeToCheckIn` |

### `POST .../calendar/events/{eventId}/check-in`

Checks the user in, or asks for a waiting-list spot.

Request body:

```json
{ "checkIn": { "requestWaitingList": false } }
```

| Response field | Type | Use |
|---|---|---|
| `id` | number | Stored as `execution.checkInId` |
| `waitingList` | boolean | `true` gives the execution status `waitlisted` |

## JWT claims

`login` decodes the JWT payload without checking its signature. It base64url-decodes the second segment and parses it as JSON.

| Claim | Type | Stored as |
|---|---|---|
| `user_id` | number | `profile.tecnofitUserId` |
| `empresa_id` | number | `account.empresaId` (as a string) and the `{empresaId}` path segment |
| `exp` | number | `account.tokenExp` (epoch seconds) |

A token that is not a JWT, or lacks one of these claims, raises `TecnofitInvalidResponse`.

## Error mapping

The client maps every failure to one of three error classes.

| Condition | Error | `status` |
|---|---|---|
| `fetch` rejects: network error, DNS error or the 5 s timeout | `TecnofitError`, message `Tecnofit unreachable` | `503` |
| HTTP 401 | `TecnofitUnauthorized` (subclass of `TecnofitError`) | `401` |
| Any other non-2xx status | `TecnofitError` | the HTTP status |
| Body is not JSON | `TecnofitInvalidResponse`, message `Tecnofit body is not JSON` | none |
| Body fails the zod schema | `TecnofitInvalidResponse`, with the zod message | none |
| JWT not decodable, or claims missing | `TecnofitInvalidResponse` | none |
| Body read fails for another reason | the original error, rethrown | none |

On a non-2xx status the client reads and discards the body before throwing.

`isCredentialRejection(err)` is true for a `TecnofitError` with status 400 to 499. Login and onboarding use it to tell wrong credentials from outages.

How callers turn these errors into HTTP statuses, in their `mapError`:

- `api-public`: a credential rejection becomes `InvalidCredentials` and 401. A 5xx `TecnofitError` or a `TecnofitInvalidResponse` becomes 502.
- `api-user`: `TecnofitUnauthorized` becomes 409. Any other `TecnofitError` or a `TecnofitInvalidResponse` becomes 502.

The response messages are in [api.md](api.md#common-errors) and [openapi.yaml](openapi.yaml).

## Timeouts and retries

The client never retries, and API handlers make one attempt per request. Only the check-in worker retries, inside its deadline. The deadline, Scheduler retries and Lambda timeout are in [architecture.md](architecture.md#check-in-flow).

## How the app uses the client

### Onboarding

`redeemInvite` (`packages/core/domain/invites.ts`) connects a new user.

1. Check that the invite is pending and that no profile has this email.
2. Call `login` with the email and password from the onboarding form.
3. On a credential rejection, add 1 to the invite's `attempts`. At 5 the invite becomes `burned`.
4. Generate a `userId`. In parallel, call `getMe` and encrypt the JWT.
5. Write invite, profile, account and session in one transaction. See [data model](data-model.md#invite-redeem).

### Login and reconnect

`loginUser` (`packages/core/domain/sessions.ts`) logs a user in and refreshes the stored token.

1. Check the `loginFail` counter and look up the profile by email.
2. Call `login`. A credential rejection counts as a failed login.
3. Encrypt the new JWT and patch the account: `tokenEnc`, `tokenExp` and `status = ok`.
4. Create a session.

Logging in again is how a user leaves the `reconnect` state. `scripts/connect.ts` also resets it. `loginUser` does not call `getMe`.

### Class list and schedule creation

`withToken` (`packages/core/domain/schedules.ts`) decrypts the token of the user's first account. On `TecnofitUnauthorized` it sets the account to `reconnect` and rethrows.

- `listClasses` calls `listEvents` for a date. It keeps events whose `start` falls on that date. It returns `name`, `time`, `count` and `capacity`, sorted by time.
- `addSchedule` calls `listEvents` for the reference date. It requires an event with the same `name` and `start = <date> <startTime>`. Otherwise it raises `ClassNotFound`.

### Check-in worker

`runCheckin` (`packages/core/domain/checkin.ts`) performs the check-in. EventBridge Scheduler invokes it; timing is in [architecture.md](architecture.md#check-in-flow).

1. Load the schedule, profile and account. Return `noop` if the schedule is missing or inactive, or the profile or account is missing.
2. Add 719 minutes to the fire time (`classSlotFor`) to get the class date and time.
3. Claim the execution keyed by `(scheduleId, classDate)` with a conditional create. See [data model](data-model.md#idempotent-execution-claim).
   - A suspended profile or a `reconnect` account is claimed as `skipped`, and the run stops.
   - Otherwise the claim is `running`.
   - If the item already exists, the invocation is a duplicate and returns `noop`.
4. Fail with `window_mismatch` if the slot does not match the schedule's start time, date or weekdays.
5. Decrypt the token and start the 90 s deadline.
6. Call `listEvents` until it succeeds, with a 300 to 500 ms random pause between tries. A 401 or an invalid response stops the run. Past the deadline the run fails with `timeout`.
7. Find the event with `name = className` and `start = <classDate> <startTime>`. If none matches, fail with `class_not_found`.
8. If the event's `checkInId` is not null, finish with `success` and that id.
9. Call `checkIn` in a loop until the deadline, with the same random pause between tries. Each call adds 1 to `attempts`.
10. After a failed `checkIn`, call `getEvent` at most once every 2 seconds:
    - `checkedIn` is true: finish with `success`.
    - The class is full and `onTimeToCheckIn` is true, with `allowWaitingList` off: fail with `full`.
    - The class is full and `onTimeToCheckIn` is true, with `allowWaitingList` on: retry at once with `requestWaitingList: true`.
11. A successful `checkIn` finishes with `success` or `waitlisted`, the check-in id and `latencyMs`.
12. Past the deadline, the run fails with `timeout`.

During the loop, only a 401 stops the run. Other `checkIn` and `getEvent` errors lead to another try.

| Error during the run | Execution result | Side effect |
|---|---|---|
| `TecnofitUnauthorized` | `failed`, `error = unauthorized` | Account set to `reconnect` |
| `TecnofitInvalidResponse` from `listEvents` | `failed`, `error = invalid_response` | none |
| Any other unexpected error | `failed`, `error = unexpected` | The Lambda invocation fails |

### Operator script

`scripts/connect.ts` (`npm run connect`) connects an account without an invite. It reads `TECNOFIT_EMAIL` and `TECNOFIT_PASSWORD` from the environment. It calls `login` and `getMe`, creates the profile if missing, and writes the account.

## Token storage

The app stores the Tecnofit JWT encrypted and never stores the password.

- The password goes only into the `POST /auth` body.
- `encryptToken` (`packages/core/crypto/token.ts`) encrypts the JWT with KMS. The encryption context is `{ userId }`.
- The ciphertext is stored base64-encoded in `account.tokenEnc`.
- `decryptToken` must pass the same `userId` as encryption context.
- The key and its policy are in [infrastructure.md](infrastructure.md#kms-key).
- `migrateUser` (`packages/core/domain/migrate.ts`) decrypts with the source key and re-encrypts with the target key.

## Test fixtures

Sample response bodies live in `tests/fixtures/tecnofit`. Tests serve them with msw at the real host.

| File | Endpoint or use |
|---|---|
| `aluno-eu.json` | `GET /aluno/eu` |
| `events.json` | `GET .../calendar/events?realtime=2` |
| `event-detail.json` | `GET .../calendar/events/{eventId}` |
| `check-in.json` | `POST .../check-in` |
| `jwt.ts` | `fakeJwt(payload)` builds an unsigned JWT with the given claims |

The fixtures include fields the client does not read, such as `teacher`, `end` and `waitingListDateLimit`.

Tests that use them:

- `tests/unit/tecnofit/client.test.ts`: paths, query string, headers, request bodies, error mapping and the timeout.
- `tests/integration/checkin-worker.test.ts`, `sessions.test.ts`, `invites.test.ts`, `schedules.test.ts` and `users.test.ts` in `tests/integration`.

### When Tecnofit changes its API

Follow [runbook.md](runbook.md#tecnofit-changed-its-api).
