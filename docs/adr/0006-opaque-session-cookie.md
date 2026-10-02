# 0006. Opaque session cookie with a Lambda authorizer

- Status: Accepted
- Date: 2026-10-20

## Context

Users log in with their Tecnofit e-mail and password, validated against Tecnofit on every login. There is no extra app password, and each login renews the stored Tecnofit token. The app then needs a session that is simple and can be revoked at once. A self-issued JWT is hard to revoke.

## Decision

- The session token is 32 random bytes in cookie `sid` (`HttpOnly; Secure; SameSite=Strict; Path=/api`, 400-day `Max-Age`). DynamoDB stores only its SHA-256.
- A Lambda REQUEST authorizer (`authorizer-user`) resolves the session. API Gateway caches the result for 60 s.
- Sessions have no server-side expiry. They end on logout, admin revocation, suspension or account deletion. `GET /api/me` reissues the cookie at most once per 24 h.
- CSRF protection: `SameSite=Strict` plus a required `X-Requested-With: fetch` header on state-changing routes.
- Five failed logins for one e-mail lock it until 15 minutes after the first failure.

## Consequences

- Revoking a session deletes one item. The admin panel shows each session's `lastSeenAt` and IP and can revoke them.
- When Tecnofit is down, existing sessions keep the app usable; only login fails.
- Accepted risk: a stolen cookie gives indefinite access to that user's app (not to the Tecnofit token) until it is revoked.
- A revoked session can stay authorized for up to 60 s because of the authorizer cache.
- Session items have no TTL.
