# 0017. LGPD consent with a versioned text

- Status: Accepted
- Date: 2026-09-08

## Context

The app processes personal data (e-mail, name, box, IP) and third-party credentials (Tecnofit tokens). Under the LGPD (Brazil's data protection law) the operator acts as data controller and must show what each user agreed to.

## Decision

- Onboarding shows a pt-BR consent text from `apps/web/src/consent.ts`. The user must tick a checkbox before signing up.
- The text has a `CONSENT_VERSION` date string. The SPA sends it as `consentVersion`, and the audit event `invite.redeemed` stores it.
- Any change to the text needs a new version. Version `2026-10-21` became `2026-10-22` when self-deletion was added.
- The text states retention: executions 90 days, audit 365 days, sessions until logout, revocation or deletion, invites 7 days after expiry.
- Users can delete their own account (`DELETE /api/me`, confirmed by typing `EXCLUIR`). Admin deletion removes the same operational data.

## Consequences

- The audit trail records which text version each user accepted.
- The server checks only the version format, not that it equals the current version.
- Audit events outlive account deletion until their 365-day TTL.
