# 0010. Admin through Cognito with TOTP MFA, wired in the `auth` module

- Status: Accepted
- Date: 2026-09-14

## Context

The admin account is the most sensitive in the system. It creates invites, suspends and deletes users, and reads the audit trail. There is a single admin.

## Decision

- A Cognito user pool `checkin-<env>-admin` with TOTP MFA required, no self sign-up and a 14-character minimum password. Admins belong to group `admin`.
- The SPA signs in with the authorization code flow and PKCE through Cognito managed login.
- An API Gateway JWT authorizer validates the access token. `api-admin` also checks the `admin` group.
- A post-authentication trigger (`cognito-post-auth`) audits `admin.login`.
- In Terraform, the admin routes, the JWT authorizer and the Cognito resources live in `infra/modules/auth`, not in `backend`. The app client callback needs the CloudFront URL, and `frontend` depends on the backend API, so placing them in `backend` creates a cycle. The env computes the Cognito domain prefix so the CSP can name it without depending on `auth`.

## Consequences

- MFA protects the most sensitive account, and admin auth stays separate from user sessions.
- The HTTP API JWT authorizer passes array claims as strings such as `"[admin x]"`. The group check accepts both forms.
- The pool has deletion protection, and its case-insensitive username setting is immutable. Teardown needs deletion protection turned off by hand.
- The owner creates the admin user with the AWS CLI after the first deploy ([runbook](../runbook.md)).
