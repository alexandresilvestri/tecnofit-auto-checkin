# 0005. Tecnofit token encrypted with KMS, bound to the user

- Status: Accepted
- Date: 2026-10-21

## Context

The app needs each user's Tecnofit JWT to check in on their behalf. That JWT is valid for about 5 years. A leak would give access to a third party's Tecnofit account. The original plan used envelope encryption.

## Decision

- The Tecnofit password is never stored or logged. It exists only in memory during onboarding and login.
- The JWT is encrypted with KMS `Encrypt`/`Decrypt` directly, not envelope encryption: the token fits the 4 KB KMS limit, so envelope adds nothing. Key: `alias/checkin-<env>-token`, with rotation on.
- Every call uses encryption context `{userId}`. The Lambda IAM policies require that context key.
- Only three roles use the key: `api-public` encrypts at onboarding and login; `api-user` and `checkin-worker` decrypt. `api-admin` has no KMS access.
- Since commit `ab0f4c4` (2026-10-22) each environment's key has an explicit key policy. Only those roles and the listed operators can use the key. Only the env's HCP Terraform role, the account root and the operators can administer it. The dev HCP role also has a policy that denies access to prod resources.

## Consequences

- A ciphertext copied to another user's item fails to decrypt.
- Operator scripts that touch tokens (`connect`, `schedule classes`, `schedule add`, `migrate`) need the caller in `operator_arns`.
- Accepted risk: the dev HCP role could still create new `checkin-dev-*` roles to work around the isolation.
- The key policy is computed: promoting a sha before `ab0f4c4` does not reset it ([runbook](../runbook.md)).
