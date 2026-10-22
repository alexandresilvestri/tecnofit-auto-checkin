# 0018. Dependency update policy

- Status: Accepted
- Date: 2026-10-21

## Context

Dependencies change often. The AWS SDK v3 publishes almost daily and must stay in sync across three `package.json` files. Picking up a compromised release right after it is published is a supply-chain risk.

## Decision

- `.github/dependabot.yml` covers npm, GitHub Actions, Terraform and the Docker Compose file in `tests/`.
- Each ecosystem runs weekly with a 7-day cooldown. Minor and patch updates come in one grouped PR per ecosystem; majors get their own PRs.
- Dependabot does not update images in workflow `services:`/`container:` (moto, Semgrep), the Terraform core version or the root `compose.yml`. These are bumped by hand. When moto changes in `tests/docker-compose.yml`, `pr.yml` changes in the same PR.
- `TF_API_TOKEN` is also stored as a Dependabot secret, because the `plan` job needs it and Actions secrets are not available to Dependabot runs.

## Consequences

- Less PR noise, and the cooldown lowers the chance of installing a compromised release.
- Manually bumped versions can lag behind.

See [ci-cd.md](../ci-cd.md).
