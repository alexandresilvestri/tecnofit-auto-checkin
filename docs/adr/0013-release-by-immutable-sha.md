# 0013. Immutable artifacts per sha, dev on merge, promote and rollback by sha

- Status: Accepted
- Date: 2026-09-16

## Context

Prod must run exactly what was tested in dev, and rolling back must be quick. The project has a single maintainer.

## Decision

- `deploy.yml` builds the Lambda zips once per push to `main` and uploads them to `s3://<artifacts-bucket>/<sha>/`. It then releases that sha to dev.
- `promote.yml` is dispatched by hand from `main` with a `sha`. It releases the same zips to prod.
- `release.yml` checks that the artifacts and `infra/envs/<env>` exist at the sha, applies HCP Terraform with `artifact_version = <sha>`, rebuilds the SPA from the sha and runs smoke tests.
- Rollback is a promote of an older sha.
- GitHub Actions reaches AWS through OIDC roles; there are no long-lived AWS keys.
- The `prod` GitHub Environment allows only `main` and has no required reviewer, by choice: with a single maintainer, dispatching `promote.yml` is the approval.

## Consequences

- A rollback target must be at or after commit `c98cfd4` (the first with `infra/envs/prod`) and at most 90 days old (artifact lifecycle).
- Rollback reverts code and versioned infra only; data does not revert.
- `release.yml` has two identical jobs, `dev` and `prod`, because `environment` cannot be conditionally absent. They must be edited together.
- Dispatching several promotes at once cancels the queued ones; run them one at a time.
- Accepted risk: no second person approves prod deploys.
- The rollback path was tested on 2026-09-19: promote a newer sha, roll back to `c98cfd4`, promote the newer sha again.

See [ci-cd.md](../ci-cd.md).
