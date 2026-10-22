# Tecnofit Auto Check-in

Check-in automático em aulas do box Tecnofit. Acesso somente por convite.

O usuário conecta a conta Tecnofit, agenda uma aula (única ou semanal) e o sistema faz o check-in sozinho. A regra do Tecnofit libera o check-in 12 h antes da aula; o job roda em `aula − 11h59`, fuso `America/Sao_Paulo`.

## Arquitetura

- CloudFront + S3: SPA (`apps/web`) e proxy de `/api/*`.
- API Gateway HTTP API + Lambdas (`apps/functions/*`): `api-public`, `api-user`, `api-admin`, `authorizer-user`, worker de check-in. Acesso direto ao API Gateway devolve 403 (header `X-Origin-Verify`).
- DynamoDB: `checkin-<env>-main` e `checkin-<env>-audit` (PITR ligado).
- EventBridge Scheduler: um schedule por agendamento, grupo `checkin-<env>`.
- KMS: tokens Tecnofit cifrados (`alias/checkin-<env>-token`).
- Cognito: pool `checkin-<env>-admin` (MFA obrigatório) para o admin.
- Infra em Terraform (`infra/`), aplicado pelo HCP Terraform.

## Ambientes

| Ambiente | Workspace HCP | URL |
| --- | --- | --- |
| dev | `checkin-dev` | https://d3d4q56x093hg3.cloudfront.net |
| prod | `checkin-prod` | output `web_url` do workspace `checkin-prod` |

Org `ATS_org`, projeto `tecnofit-auto-checkin`, região `us-east-1`. Bootstrap (roles OIDC): workspace `checkin-bootstrap`.

Fluxo: PR (testes + plan) → merge em `main` faz deploy no dev → `promote.yml` leva um `sha` para prod com aprovação. Detalhes em [docs/runbook.md](docs/runbook.md).

## Desenvolvimento local

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

## Scripts de operação

Usam as credenciais AWS do shell. `CHECKIN_ENV` escolhe o ambiente (padrão `dev`).

```bash
TECNOFIT_EMAIL=... TECNOFIT_PASSWORD=... CHECKIN_ENV=dev npm run connect
CHECKIN_ENV=dev npm run invite -- --label "Fulano"
CHECKIN_ENV=dev npm run schedule -- classes --user <userId> --date YYYY-MM-DD
CHECKIN_ENV=dev npm run schedule -- add --user <userId> --class-name "<nome>" --start HH:mm --date YYYY-MM-DD [--weekdays 1,3,5] [--waiting-list]
CHECKIN_ENV=dev npm run schedule -- list --user <userId>
CHECKIN_ENV=dev npm run schedule -- remove --user <userId> --schedule <scheduleId>
npm run migrate
npm run migrate -- --apply
```

- `connect`: cria/atualiza perfil e conta Tecnofit de um usuário.
- `invite`: gera link `/convite#<token>` com expiração.
- `schedule`: lista aulas e gerencia agendamentos.
- `migrate`: copia usuários de dev para prod (simulação sem `--apply`); sempre usa dev como origem e prod como destino.

## Operação

[docs/runbook.md](docs/runbook.md): deploy, promoção, rollback, incidentes, restauração, rotação de segredo, alarmes, reset do admin e destruição de ambiente.
