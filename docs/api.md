# API

The backend is one HTTP API under `/api`, reached only through CloudFront. The full contract, with every schema and status code, is in [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1).

## View the spec

- Paste `docs/openapi.yaml` into <https://editor.swagger.io>.
- Or build a static HTML page: `npx @redocly/cli build-docs docs/openapi.yaml -o /tmp/api.html`.
- Lint it with `npx @redocly/cli@2.69.0 lint docs/openapi.yaml`. It passes the built-in recommended rules with no warnings.

## Components

Three Hono apps and one authorizer run on AWS Lambda behind one API Gateway HTTP API (payload format 2.0).

| Function | Serves | Source |
| --- | --- | --- |
| `api-public` | Public routes | `apps/functions/api-public/index.ts` |
| `api-user` | Student routes | `apps/functions/api-user/index.ts` |
| `api-admin` | Operator routes under `/api/admin/` | `apps/functions/api-admin/index.ts` |
| `authorizer-user` | Lambda authorizer for the student routes | `apps/functions/authorizer-user/index.ts` |

Public and student route keys live in `infra/modules/backend/main.tf`. Admin route keys live in `infra/modules/auth/main.tf`. See [architecture](architecture.md) and [infrastructure](infrastructure.md) for the wider picture.

## Base URL

Call the API on the CloudFront distribution URL. Paths keep the `/api` prefix. The web app and the API share that origin, so the API has no CORS configuration.

CloudFront routes `/api/*` to API Gateway over HTTPS only. It adds an `X-Origin-Verify` header that holds a shared secret. Every handler and the user authorizer compare it with `ORIGIN_SECRET` in constant time (`packages/core/http/origin.ts`).

The default `execute-api` endpoint stays enabled, but direct calls fail:

- Public routes return 403 `{"message":"Acesso negado."}`.
- Student routes return 401 or 403 from the gateway, because the header is an authorizer identity source.
- Admin routes return 401 from the JWT authorizer, or 403 `Acesso negado.` with a valid token.

CloudFront forwards all cookies and query strings. It forwards only these request headers: `X-Requested-With`, `Content-Type`, `User-Agent`, `CloudFront-Viewer-Address` and `Authorization` (`infra/modules/frontend/main.tf`).

Audit entries take the client IP from `CloudFront-Viewer-Address`, without the port. Without that header, they use the API Gateway source IP.

Locally, `scripts/local-api.ts` serves the same handlers on port 3000 and emulates the gateway. See [development](development.md).

## Authentication

| Audience | Routes | Credential | Checked by |
| --- | --- | --- | --- |
| public | `/api/health`, `/api/invites/check`, `/api/onboarding`, `/api/auth/login` | None | Origin check only |
| user | `/api/me`, `/api/auth/logout`, `/api/classes`, `/api/schedules`, `/api/executions` | `sid` cookie | REQUEST Lambda authorizer |
| admin | `/api/admin/*` | Cognito access token in `Authorization: Bearer <token>` | JWT authorizer, then `admin` group check in the handler |

### Student session

- `POST /api/onboarding` and `POST /api/auth/login` set the cookie `sid=<token>; Max-Age=34560000; Path=/api; HttpOnly; Secure; SameSite=Strict`.
- The token is 32 random bytes in base64url. The database stores only its SHA-256 hex digest as the session id (`packages/core/crypto/secret.ts`).
- The authorizer reads `sid`, loads the session and passes `userId` and `sessionId` to `api-user`.
- Identity sources are the `Cookie` and `X-Origin-Verify` headers. If either is missing, API Gateway returns 401 `Unauthorized` without calling the authorizer.
- A denied request (no `sid`, unknown session, wrong origin) gets 403 `Forbidden` from API Gateway.
- API Gateway caches each authorizer result for 60 s.
- Sessions have no server-side expiry. They end on logout, account deletion, suspension or an operator's session revoke. The cookie lasts 400 days.
- `GET /api/me` updates `lastSeenAt` and reissues the cookie when the last update is older than 24 h.
- `POST /api/auth/logout` and `DELETE /api/me` reply with `sid=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict`.

### Operator token

- The admin web app gets the access token from the Cognito admin pool with the authorization code flow and PKCE (`apps/web/src/admin/auth.ts`).
- The JWT authorizer checks the issuer (`https://cognito-idp.us-east-1.amazonaws.com/<admin-pool-id>`) and the audience (the web app client id). A missing, invalid or expired token gets 401 `Unauthorized`.
- Access tokens last 60 minutes.
- The handler then requires `admin` in the `cognito:groups` claim. The claim may arrive as an array or as a string such as `"[admin other]"`; both forms work.
- A token without the group gets 403 `{"message":"Acesso negado."}`.
- Audit entries record the token `sub` as the operator id.

## CSRF rule

Public `POST` routes and every student route except `GET` and `HEAD` require the header `X-Requested-With: fetch`. Without it, the handler returns 403 `{"message":"Requisição inválida."}` before doing any work. The origin check runs before this rule.

A cross-site HTML form cannot set custom headers. The `SameSite=Strict` cookie is a second guard. Admin routes do not need the header, because they authenticate with a bearer token instead of a cookie.

`apps/web/src/api.ts` sends the header on every request.

## Errors

Every error body is JSON `{"message": "<text>"}`. Handler messages are pt-BR. Gateway messages are English. Each handler maps domain errors to a status and message in its `mapError` function.

### Common errors

| Status | `message` | English gloss | Cause |
| --- | --- | --- | --- |
| 400 | `Requisição inválida.` | Invalid request. | Body, query or path parameter failed its zod schema; malformed cursor; audit period out of range |
| 401 | `Unauthorized` | – | API Gateway: no `Cookie` header (student) or bad bearer token (admin) |
| 403 | `Forbidden` | – | API Gateway: student authorizer denied the request |
| 403 | `Acesso negado.` | Access denied. | Wrong `X-Origin-Verify`, or admin token without the `admin` group |
| 403 | `Requisição inválida.` | Invalid request. | Missing `X-Requested-With: fetch` |
| 404 | `Not Found` | – | API Gateway: no route matches the method and path |
| 429 | `Too Many Requests` | – | API Gateway throttling |
| 500 | `Erro inesperado.` | Unexpected error. | Any unmapped error |
| 502 | `Tecnofit indisponível. Tente novamente em instantes.` | Tecnofit unavailable. Try again shortly. | Tecnofit unreachable, timed out or returned an invalid body; any other Tecnofit error on user routes, only 5xx on public routes |

Route-specific errors and their messages are in [`openapi.yaml`](openapi.yaml).

The web client shows `message` as-is, with one exception. It replaces 429 `Too Many Requests` with `Muitas tentativas. Tente novamente em instantes.` ("Too many attempts. Try again shortly.") in `apps/web/src/api.ts`.

## Throttling

API Gateway stage limits in `infra/modules/backend/main.tf`:

| Routes | Rate (requests/s) | Burst |
| --- | --- | --- |
| Every route (stage default) | 20 | 40 |
| `POST /api/invites/check`, `POST /api/onboarding`, `POST /api/auth/login` | 5 | 10 |

Each limit covers one route for all clients together, not one client. Over the limit, API Gateway returns 429 `{"message":"Too Many Requests"}`.

The application adds its own limits:

- Login counts failures per e-mail for 15 minutes from the first failure. At five, logins for that e-mail get 429 until the window ends. A successful login resets the count.
- Onboarding counts Tecnofit credential rejections per invite. At five, the invite becomes `burned`.
- Invites expire 15 minutes after creation.

## Pagination

Only `GET /api/executions` paginates.

- A page holds up to 20 items, newest class date first.
- The response `cursor` is an opaque string, or `null` on the last page.
- Send it back as `?cursor=<value>` to get the next page. It may have up to 2048 characters.
- A malformed cursor returns 400 `Requisição inválida.`.

The other lists return everything in one response: invites, users and executions by date. `GET /api/admin/users/{id}` embeds the latest 20 executions and the latest 50 audit entries that target the user.

`GET /api/admin/audit` returns at most 1000 entries, newest first. It sets `truncated: true` when more entries matched. The period runs from `from` to `to` inclusive and must span 1 to 31 days.

## Formats

- Dates are `YYYY-MM-DD`. Times are 24-hour `HH:mm`. Both use `America/Sao_Paulo`.
- `nextClass` is `YYYY-MM-DD HH:mm` in `America/Sao_Paulo`.
- `createdAt`, `lastSeenAt`, `usedAt` and audit `at` are ISO 8601 timestamps in UTC.
- Invite `expiresAt` is epoch milliseconds.
- Weekdays are integers from 0 (Sunday) to 6 (Saturday).
- Audit `from` and `to` are whole days at UTC−03:00.
- Enum values are in [data-model.md](data-model.md#entities) and in the `openapi.yaml` schemas, such as `ExecutionStatus`, `WorkerErrorCode` and `AuditAction`.

## Routes

| Method | Path | Audience | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | public | Health check |
| `POST` | `/api/invites/check` | public | Check whether an invite token is still usable |
| `POST` | `/api/onboarding` | public | Redeem an invite, create the account and open a session |
| `POST` | `/api/auth/login` | public | Log in with Tecnofit credentials and open a session |
| `GET` | `/api/me` | user | Name, box and Tecnofit account status |
| `POST` | `/api/auth/logout` | user | End the current session |
| `DELETE` | `/api/me` | user | Delete own account and data |
| `GET` | `/api/classes` | user | List the box's classes on a date |
| `GET` | `/api/schedules` | user | List own schedules with next class and last result |
| `POST` | `/api/schedules` | user | Create a weekly or one-off schedule |
| `PATCH` | `/api/schedules/{id}` | user | Pause or resume |
| `DELETE` | `/api/schedules/{id}` | user | Delete a schedule |
| `GET` | `/api/executions` | user | Page through own check-in results |
| `POST` | `/api/admin/invites` | admin | Create an invite |
| `GET` | `/api/admin/invites` | admin | List invites |
| `DELETE` | `/api/admin/invites/{id}` | admin | Revoke a pending invite |
| `GET` | `/api/admin/users` | admin | List users |
| `GET` | `/api/admin/users/{id}` | admin | User detail: account, schedules, executions, sessions, audit |
| `POST` | `/api/admin/users/{id}/suspend` | admin | Suspend a user (reason required) |
| `POST` | `/api/admin/users/{id}/reactivate` | admin | Reactivate a suspended user |
| `POST` | `/api/admin/users/{id}/revoke-sessions` | admin | Delete all sessions of a user |
| `DELETE` | `/api/admin/users/{id}` | admin | Delete a user (reason required in the JSON body) |
| `GET` | `/api/admin/executions` | admin | All executions on a class date |
| `GET` | `/api/admin/audit` | admin | Query the audit log |
| `GET` | `/api/admin/audit/export` | admin | Download the audit query as CSV (audited) |

## Known limitations

- Student handlers trust the authorizer context and do not reload the session. With the 60 s authorizer cache, a deleted session can still pass for up to 60 s.
- Throttling limits are shared by all clients of a route.
- The audit CSV export holds at most 1000 rows and has no truncation marker.
- The `execute-api` endpoint is reachable; only the origin secret blocks direct calls.

## Add a route

Follow the checklist in [development.md](development.md#adding-an-api-route).

See also: [README](../README.md), [Tecnofit integration](tecnofit-integration.md), [runbook](runbook.md), [architecture decisions](adr/README.md).
