# 0008. Reconnect through login

- Status: Accepted
- Date: 2026-09-03

## Context

A stored Tecnofit token can stop working, for example after a password change. Tecnofit then answers 401. The user must give their credentials again so the app gets a fresh token.

## Decision

- A Tecnofit 401 sets the account status to `reconnect`. Both the worker and `api-user` do this.
- The Account page button `Reconectar` logs the user out and sends them to `/login`.
- Login validates the credentials against Tecnofit, encrypts the fresh token and sets the status back to `ok`.
- There is no dedicated reconnect route.

Reason: login already renews the Tecnofit token. Reusing it keeps `kms:Encrypt` out of `api-user`.

## Consequences

- While the account is in `reconnect`, the worker records runs as `skipped`.
- Login updates the account for the box (`empresa_id`) in the fresh token, and fails if no account exists for that box. A user who switched box needs `npm run connect`.
