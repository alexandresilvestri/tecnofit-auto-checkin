# Tecnofit Auto Check-in

Automatic check-in for classes at a Tecnofit box. Invite-only access.

The user connects their Tecnofit account, schedules a class (one-off or weekly) and the system checks in on its own. Tecnofit opens check-in 12 h before the class; the job runs at `class − 11h59`, timezone `America/Sao_Paulo`.

<img width="1058" height="913" alt="image" src="https://github.com/user-attachments/assets/a0c47960-3fd7-49f7-b08c-7401b8c52a32" />

## Environments

| Environment | HCP workspace | URL |
| --- | --- | --- |
| dev | `checkin-dev` | https://d3d4q56x093hg3.cloudfront.net |
| prod | `checkin-prod` | https://checkin.alexandresilvestri.com.br |

Org `ATS_org`, project `tecnofit-auto-checkin`, region `us-east-1`. Bootstrap (OIDC roles): workspace `checkin-bootstrap`.

Flow: PR (tests + plan) → merge into `main` deploys to dev → `promote.yml`, triggered manually from `main`, takes a `sha` to prod. Details in [docs/ci-cd.md](docs/ci-cd.md).

## Quickstart

Node >= 24 (`.nvmrc`) and Docker.

```bash
npm ci
docker compose up
```

Web at http://localhost:5173, API at http://localhost:3000. Tests, scripts and local limits are in [docs/development.md](docs/development.md).

## Documentation

| Document | Covers |
| --- | --- |
| [Architecture](docs/architecture.md) | Components, request path, security model, check-in flow, user lifecycle |
| [API](docs/api.md) | Auth, errors, throttling, routes; full contract in [openapi.yaml](docs/openapi.yaml) |
| [Data model](docs/data-model.md) | DynamoDB tables, entities, keys, access patterns; diagram in [data-model.dbml](docs/data-model.dbml) |
| [Tecnofit integration](docs/tecnofit-integration.md) | Tecnofit endpoints the client calls, errors, retries |
| [Infrastructure](docs/infrastructure.md) | Terraform roots and modules, HCP Terraform, IAM, KMS, CloudFront, Cognito, alarms |
| [CI/CD](docs/ci-cd.md) | Workflows, release and promotion, rollback, Dependabot |
| [Development](docs/development.md) | Local stack, tests, scripts, conventions, operations scripts |
| [Runbook](docs/runbook.md) | Deploy, promotion, rollback, incidents, restore, secret rotation, alarms, admin reset, teardown |
| [Decisions](docs/adr/README.md) | Architecture decision records |

## License

[MIT](LICENSE)
