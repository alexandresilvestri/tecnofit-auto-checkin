# 0007. Invite-only onboarding

- Status: Accepted
- Date: 2026-09-01

## Context

The app automates a private Tecnofit API. Its use may breach Tecnofit's terms, which could get user accounts blocked. The owner wants full control over who joins. An open login would also let anyone test Tecnofit passwords through the app.

## Decision

- An invite unlocks exactly one sign-up. Only registered users can log in, even with valid Tecnofit credentials.
- The invite token is 32 random bytes, delivered in the URL fragment (`/convite#<token>`). The database stores only its SHA-256 as `inviteId`.
- An invite expires 15 min after creation. Redeeming it is atomic: a transaction marks it used only while it is still pending and unexpired.
- An invite is burned after 5 failed Tecnofit logins. The admin can label and revoke pending invites.
- Invites come from the admin panel or `npm run invite`.

## Consequences

- The user list stays closed and the volume low.
- Only registered users reach Tecnofit through the login route, which is also rate-limited.
- Every new user needs an admin action.
- A leaked invite works for at most 15 min and only once; the admin can revoke it or suspend the resulting user.
- E-mail uniqueness at onboarding is checked with an index query, not enforced atomically.
