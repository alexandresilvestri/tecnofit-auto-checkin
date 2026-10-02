# 0011. CloudFront origin secret header

- Status: Accepted
- Date: 2026-10-22

## Context

The API Gateway `execute-api` endpoint is public. The app reads the client IP from `CloudFront-Viewer-Address` for audit events and sessions. A direct caller could set that header and forge the IP.

## Decision

- CloudFront adds a secret `X-Origin-Verify` header to every request it sends to the API origin. The value is a 48-character Terraform `random_password`.
- Every API Lambda and the user authorizer compare it in constant time (`packages/core/http/origin.ts`). The authorizer also uses it as an identity source.
- The release smoke test asserts that a direct call to the API returns 403.

## Consequences

- Client IPs in audit events and sessions come only through CloudFront.
- Direct calls get 403 on public routes and 401 on routes behind the user authorizer or the JWT authorizer.
- The `execute-api` endpoint stays enabled; only the header blocks it.
- Rotating the secret needs a Terraform replace and a CloudFront propagation window ([runbook](../runbook.md)).
- The first deploy of the header caused a few minutes of 401/403 in the UI while CloudFront propagated.
