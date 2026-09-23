# Tecnofit Auto Check-in

Automatic check-in for classes at a Tecnofit box. Invite-only access.

The user connects their Tecnofit account, schedules a class (one-off or weekly) and the system checks in on its own. Tecnofit opens check-in 12 h before the class; the job runs at `class − 11h59`, timezone `America/Sao_Paulo`.

## Architecture

- CloudFront + S3: SPA (`apps/web`) and `/api/*` proxy.
- API Gateway HTTP API + Lambdas (`apps/functions/*`): `api-public`, `api-user`, `api-admin`, `authorizer-user`, check-in worker. Direct access to API Gateway returns 403 (`X-Origin-Verify` header).
- DynamoDB: `checkin-<env>-main` and `checkin-<env>-audit` (PITR enabled).
- EventBridge Scheduler: one schedule per booking, group `checkin-<env>`.
- KMS: encrypted Tecnofit tokens (`alias/checkin-<env>-token`).
- Cognito: pool `checkin-<env>-admin` (MFA required) for the admin.
- Infra in Terraform (`infra/`), applied by HCP Terraform.

## Environments

| Environment | HCP workspace | URL |
| --- | --- | --- |
| dev | `checkin-dev` | https://d3d4q56x093hg3.cloudfront.net |
| prod | `checkin-prod` | https://dquf6r20z50xs.cloudfront.net |

Org `ATS_org`, project `tecnofit-auto-checkin`, region `us-east-1`. Bootstrap (OIDC roles): workspace `checkin-bootstrap`.

Flow: PR (tests + plan) → merge into `main` deploys to dev → `promote.yml`, triggered manually from `main`, takes a `sha` to prod. Details in [docs/runbook.md](docs/runbook.md).

## Local development

Node >= 24 (`.nvmrc`).

```bash
npm ci
npm run moto:up
npm run test:unit
npm run test:integration
npm run e2e
npm run lint
npm run typecheck
npm run build
npm run web:dev
```

## Operations scripts

Use the shell's AWS credentials. `CHECKIN_ENV` selects the environment (default `dev`).

```bash
TECNOFIT_EMAIL=... TECNOFIT_PASSWORD=... CHECKIN_ENV=dev npm run connect
CHECKIN_ENV=dev npm run invite -- --label "John Doe"
CHECKIN_ENV=dev npm run schedule -- classes --user <userId> --date YYYY-MM-DD
CHECKIN_ENV=dev npm run schedule -- add --user <userId> --class-name "<name>" --start HH:mm --date YYYY-MM-DD [--weekdays 1,3,5] [--waiting-list]
CHECKIN_ENV=dev npm run schedule -- list --user <userId>
CHECKIN_ENV=dev npm run schedule -- remove --user <userId> --schedule <scheduleId>
npm run migrate
npm run migrate -- --apply
```

- `connect`: creates/updates a user's profile and Tecnofit account.
- `invite`: generates a `/convite#<token>` link with expiry.
- `schedule`: lists classes and manages bookings.
- `migrate`: copies users from dev to prod (dry run without `--apply`); always uses dev as source and prod as target.

## Operations

[docs/runbook.md](docs/runbook.md): deploy, promotion, rollback, incidents, restore, secret rotation, alarms, admin reset and environment teardown.
