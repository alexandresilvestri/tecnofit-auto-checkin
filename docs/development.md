# Development

How to install, run, test and build the project, plus the operations scripts. For the system design, see [architecture.md](architecture.md).

## Prerequisites

- **Node 24.** `.nvmrc` pins `24` and `package.json` requires `>=24`. npm workspaces and `package-lock.json` manage dependencies.
- **Docker with Compose.** Needed for the local stack (`docker compose up`) and for moto in integration tests (`npm run moto:up`).
- **System `zip`.** `scripts/build-functions.mjs` calls it to package each Lambda.
- **Playwright Chromium.** Needed for e2e tests. Install it once with `npx playwright install chromium`.
- **AWS credentials.** Needed only for the operations scripts. Local development and tests use fake credentials.
- **Tecnofit account.** The local stack talks to the real Tecnofit API, so onboarding and login need real Tecnofit credentials.

## Install

```bash
npm ci
```

This installs every workspace: `packages/*`, `apps/functions/*` and `apps/web`.

## Full local stack

```bash
docker compose up
```

Open http://localhost:5173. The API listens on http://localhost:3000.

| Service | Image | Host port | Role |
| --- | --- | --- | --- |
| `moto` | `motoserver/moto` | none | In-memory AWS (DynamoDB, KMS, Scheduler), reachable only as `moto:5000` inside the network |
| `deps` | `node:24-slim` | none | Runs `npm install --no-save --no-audit --no-fund` into named volumes, then exits |
| `api` | `node:24-slim` | 3000 | Runs `npx tsx watch scripts/local-api.ts` |
| `web` | `node:24-slim` | 5173 | Runs the Vite dev server; proxies `/api` and `/cognito` to `http://api:3000` |

`scripts/local-api.ts` is a small gateway that runs the real Lambda handlers on moto:

- On start it creates tables `checkin-local-main` and `checkin-local-audit`, a KMS key with alias `alias/checkin-local-token` and schedule group `checkin-local`.
- It routes public paths to `api-public`, `/api/admin/*` to `api-admin` and everything else to `authorizer-user` plus `api-user`.
- It injects `X-Origin-Verify` with the local secret, so handlers pass the origin check.
- It fakes Cognito under `/cognito/*`. Login returns at once, and admin requests get `admin` group claims. The SPA uses this because compose sets `VITE_COGNITO_DOMAIN=/cognito`.
- Admin requests still need an `Authorization` header; the SPA sends the fake token.
- `tsx watch` restarts the gateway when an imported file changes.

A typical first run: open http://localhost:5173/admin, create an invite, open the link, and onboard with a real Tecnofit account.

Limits of the local stack:

- **Tecnofit is real.** Onboarding, login, class lists and schedule creation call `rest.tecnofit.com.br`.
- **The worker never fires.** moto Scheduler stores schedules but does not invoke targets. History and admin executions stay empty.
- **Data is in memory.** Restarting `moto` wipes all data. `api` restarts with it and recreates the resources. Existing `sid` cookies then stop working.
- **moto has no host port.** It never clashes with the moto from `npm run moto:up`, and integration tests cannot wipe local data.
- **Containers run as root.** `node_modules` and `apps/web/node_modules` live in their own named volumes (`node_modules`, `web_node_modules`). This keeps root-owned files out of the host tree.
- **No resource limits** are set in `compose.yml`.

## Running pieces without the full stack

- `npm run moto:up` starts moto from `tests/docker-compose.yml` on host port 5000. Integration tests use it. Stop it with `docker compose -f tests/docker-compose.yml down`.
- `npm run web:dev` starts Vite on port 5173. It proxies `/api` and `/cognito` to `API_URL`, default `http://localhost:3000`. Without a server on that port, API calls fail.
- `npm run web:build` writes the SPA to `apps/web/dist`. `npm -w apps/web run preview` serves that build.

## Common commands

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run web:dev
```

Every script is defined in `package.json`. The sections below cover tests, build and the operations scripts.

## Tests

Vitest runs unit and integration tests as two projects in `vitest.config.ts`. Playwright runs e2e tests.

### Unit

```bash
npm run test:unit
```

- Files: `tests/unit/**/*.test.ts`. No Docker or network needed.
- AWS SDK clients are stubbed with `aws-sdk-client-mock`. Tecnofit HTTP is mocked with `msw`. Some core modules are replaced with `vi.mock`.
- They cover core helpers, the Tecnofit client, every Lambda handler (`tests/unit/functions`) and the SPA's API client and PKCE login (`tests/unit/web`).

### Integration

```bash
npm run moto:up
npm run test:integration
```

- Files: `tests/integration/**/*.test.ts`. They run one file at a time with a 20 s test timeout.
- They call real DynamoDB, KMS and Scheduler APIs on moto at `MOTO_ENDPOINT` (default `http://localhost:5000`).
- `tests/integration/setup/aws.ts` resets moto through `/moto-api/reset` and creates tables with `packages/core/db/table.ts`.
- Tecnofit is mocked with `msw`. Some Scheduler failure cases use `aws-sdk-client-mock`.
- They cover the entities, audit, crypto and the domain modules, including `runCheckin`.

### End-to-end

```bash
npx playwright install chromium
npm run web:build
npm run e2e
```

- Files: `tests/e2e/user.spec.ts` and `tests/e2e/admin.spec.ts`.
- Playwright starts `vite preview` on port 4173 and runs Chromium against the built SPA. Build the SPA first.
- Outside CI, Playwright reuses a server already running on port 4173.
- Every API call is mocked with `page.route`. Unmocked paths return 500 with `not mocked`.
- The admin spec seeds `admin_token` and `admin_exp` in `sessionStorage`, so no Cognito is involved.
- They cover the main user flows (onboarding, schedules, history, login) and admin flows (invites, suspend, audit).

### Fixtures

- `tests/fixtures/tecnofit/*.json` hold sample Tecnofit responses: `/aluno/eu`, the events list, event detail and check-in.
- `tests/fixtures/tecnofit/jwt.ts` exports `fakeJwt`, which builds an unsigned JWT with Tecnofit-style claims.

## E2E-facing strings

E2E tests select elements by role, label and visible text. Treat these as a contract when changing the UI.

- Keep labels, button names, headings and link names, for example `Criar conta`, `Buscar aulas`, `Carregar mais` and `Confirmar suspender`.
- Keep roles: `article` cards, `alert` errors, `status` notices, `dialog`, table `cell`s.
- Keep exact strings, for example `Check-in feito · 1 tentativa`, `Falhou (lotada) · 3 tentativas` and `Nenhum agendamento.`.
- Playwright locators are strict. A second element with the same accessible name, such as another link named `Novo`, breaks a test.
- Keep badge texts asserted by the specs, such as `Ativo` and `Pausado`.

## Lint and typecheck

```bash
npm run lint
npm run typecheck
```

- ESLint uses the flat config `eslint.config.js`: `@eslint/js` recommended plus `typescript-eslint` recommended. It ignores `dist` and `apps/web/dist`.
- The root `tsconfig.json` covers `apps`, `packages`, `tests`, `scripts` and `vitest.config.ts`, excluding `apps/web`.
- `apps/web/tsconfig.json` covers the SPA with DOM types and `react-jsx`.
- Both configs are strict and `noEmit`, with `moduleResolution: bundler`.

## Build

```bash
npm run build
npm run web:build
```

- `scripts/build-functions.mjs` loops over every folder in `apps/functions`.
- esbuild bundles `apps/functions/<name>/index.ts` as ESM for `node24` into `dist/functions/<name>/index.mjs`. A banner adds `createRequire` for CommonJS dependencies.
- `zip -X -j` packs it into `dist/functions/<name>.zip`. Lambda runs it with handler `index.handler`.
- `vite build` writes the SPA to `apps/web/dist`. `assetsInlineLimit: 0` keeps every asset a separate file, since the CSP blocks `data:` URIs.
- Build-time variables `VITE_COGNITO_DOMAIN` and `VITE_COGNITO_CLIENT_ID` configure admin login.

How artifacts reach AWS is described in [ci-cd.md](ci-cd.md).

## Code conventions

- **ESM everywhere.** Every package sets `"type": "module"`.
- **Raw TypeScript core.** `@checkin/core` exports `./*.ts` directly, with no build step. Import it as `@checkin/core/domain/schedules`. esbuild, `tsx` and Vitest compile it on the fly.
- **Relative imports in core** use the `.js` suffix.
- **Pinned versions.** External dependencies use exact versions, without `^` or `~`. Workspaces depend on `@checkin/core` as `*`.
- **zod at boundaries.** Request bodies, query strings and path params, Tecnofit responses, the worker event and audit metadata are all validated with zod.
- **Hono handlers.** HTTP Lambdas use Hono with `@hono/aws-lambda`. A middleware checks the origin header, then the CSRF header or the admin group, and logs each request.
- **Error mapping.** Domain errors are `Error` subclasses with a `name`. Each handler's `mapError` maps them to an HTTP status and a pt-BR message.
- **Safe logs.** Logs record ids, routes, statuses and error names, never error messages or tokens.
- **Injected dependencies.** Domain functions take a `deps` object (`entities`, `kms`, `scheduler`, `now`, `sleep`, `random`). Tests swap these freely.
- **Data access.** ElectroDB entities in `packages/core/db/entities.ts`. `isConditionalFailure` detects failed conditions.
- **Language.** User-facing strings are pt-BR. Code, logs and audit action names are English.
- **No comments.** TypeScript source has no comments. Terraform comments exist only to justify `nosemgrep` suppressions.

## Operations scripts

The scripts in `scripts/` run with `tsx` against a real environment.

- They use the shell's AWS credentials and region `us-east-1`.
- `CHECKIN_ENV` selects the environment; the default is `dev`. `migrate` ignores it.
- `scripts/env.ts` derives resource names from the environment and reads the account id from STS.
- Scripts that encrypt or decrypt Tecnofit tokens need the caller in the KMS key's `operator_arns`, such as `<operator-user>`. This applies to `connect`, `schedule classes`, `schedule add` and `migrate`.
- Scripts write directly to DynamoDB and Scheduler. Only `invite` and `migrate` write audit events.

### `connect`

```bash
TECNOFIT_EMAIL=... TECNOFIT_PASSWORD=... CHECKIN_ENV=dev npm run connect
```

Logs in to Tecnofit and prints the `userId`. It creates a profile if none exists for the e-mail. It then writes the account with a freshly encrypted token and status `ok`. It skips the invite and consent steps.

### `invite`

```bash
CHECKIN_ENV=dev npm run invite -- --label "John Doe"
```

Prints a `https://<distribution>/convite#<token>` link and its expiry time in `America/Sao_Paulo`. `--label` is optional. The script finds the CloudFront distribution by its comment `checkin-<env>`. It records `invite.created` with actor type `cli`.

### `schedule`

```bash
CHECKIN_ENV=dev npm run schedule -- classes --user <userId> --date YYYY-MM-DD
CHECKIN_ENV=dev npm run schedule -- add --user <userId> --class-name "<name>" --start HH:mm --date YYYY-MM-DD [--weekdays 1,3,5] [--waiting-list]
CHECKIN_ENV=dev npm run schedule -- list --user <userId>
CHECKIN_ENV=dev npm run schedule -- remove --user <userId> --schedule <scheduleId>
```

- `classes` lists the day's classes with occupancy.
- `add` without `--weekdays` books the class once on `--date`. With `--weekdays`, it books weekly; `--date` is then the date used to confirm the class exists.
- Weekdays are numbers from `0` (Sunday) to `6` (Saturday).
- `--waiting-list` allows joining the waiting list when the class is full.
- `add` prints the new `scheduleId` and its Scheduler expression.
- `list` and `remove` show and delete a user's schedules.

### `migrate`

```bash
npm run migrate
npm run migrate -- --apply
```

Copies every user from dev to prod, then deletes them from dev. Without `--apply` it only prints users with schedule and execution counts. The procedure is in [runbook.md](runbook.md#dev-to-prod-migration).

> **Warning:** `migrate` was a one-shot prod cutover. Dev is now the staging environment. Do not run it again.

## Adding an API route

1. **Handler.** Add the route to `api-public`, `api-user` or `api-admin` under `apps/functions`. Validate body, query and params with zod, and return 400 `Requisição inválida.` on failure. Map new domain errors in `mapError`. Check: `npm run typecheck`.
2. **Domain.** Put logic in `packages/core/domain/*` with a `deps` parameter. Write an audit event for state changes, adding the action to `AUDIT_ACTIONS` in `packages/core/audit/audit.ts`.
3. **Route key.** Add public and user routes to `local.routes` in `infra/modules/backend/main.tf`. Routes mapped to `api-user` get the `authorizer-user` authorizer; the others get none. Add admin routes to `local.routes` in `infra/modules/auth/main.tf`. Use `{id}` where Hono uses `:id`. Check: the key matches the Hono method and path.
4. **Throttling.** For the stricter 5/10 limit, add the route key to the `route_settings` list on the stage in `infra/modules/backend/main.tf`.
5. **Permissions.** Extend the Lambda's IAM `statements` in `infra/modules/backend/main.tf` if it needs new AWS actions.
6. **Headers.** If the route needs a new request header, add it to the CloudFront origin request policy in `infra/modules/frontend/main.tf`. Paths need no CloudFront change, because `/api/*` covers every API path.
7. **Local gateway.** Add public paths to the `PUBLIC` set in `scripts/local-api.ts`. Paths under `/api/admin/` go to `api-admin`; all others pass the user authorizer. Check: call the route on the local API.
8. **Web client.** Call it through `apps/web/src/api.ts` for public and user routes (sends `X-Requested-With`) or `apps/web/src/admin/api.ts` for admin routes (sends the bearer token). Check: `npm run typecheck`.
9. **Docs.** Document the route in [openapi.yaml](openapi.yaml): schemas that mirror the zod schema, and every status with its message. Add it to the route table in [api.md](api.md#routes). Check: lint the spec as in [api.md](api.md#view-the-spec).
10. **Tests.** Add a handler test in `tests/unit/functions`: success, 400 on invalid input, each mapped error and the 403 guard (CSRF or admin group). Add an integration test for new domain logic, and e2e mocks if the UI calls the route. Check: `npm run test:unit`.

## Adding a Lambda

1. **Folder.** Create `apps/functions/<name>/index.ts` exporting `handler`, plus a `package.json` named `@checkin/<name>` with pinned dependencies. Run `npm install` to update the lockfile.
2. **Build.** `scripts/build-functions.mjs` picks up the new folder and produces `dist/functions/<name>.zip`. The deploy workflow uploads every zip.
3. **API-style function.** Add an entry to `local.api_functions` in `infra/modules/backend/main.tf`. The entry key must equal the folder name, because it sets the zip key. The `for_each` resources create its log group, role, policy, function and error alarm.
4. **Other functions.** Declare the log group, role, policy and function explicitly, as the worker does, with `s3_key = "${var.artifact_version}/<name>.zip"`.
5. **Role name.** Name the role `checkin-<env>-<name>`. The HCP role can only manage roles with that prefix.
6. **KMS.** If it uses the token key, add its role to the `TokenUseOnlyByApp` statement in `infra/modules/data/main.tf`.
7. **Release check.** The release workflow requires `<sha>/<name>.zip` for every folder in `apps/functions`. Deploy a sha before promoting it.
8. **Local and tests.** Wire HTTP handlers into `scripts/local-api.ts`. Add a unit test in `tests/unit/functions`.

## Adding infrastructure

Keep `infra/envs/dev/main.tf` and `infra/envs/prod/main.tf` identical except for the environment name. Every change goes through a PR. Merging deploys dev; prod needs a promote. See [ci-cd.md](ci-cd.md).

### Add an environment variable

1. Add it to the `env` map of the function in `local.api_functions`, or to the `environment` block of the worker or the post-auth function.
2. If the value comes from another module, add a module variable and wire it in both env roots.
3. For local development, add it to the `api` service in `compose.yml`.

### Add a resource

1. Put it in the module that owns its concern. Name it `checkin-${var.env}-<name>`.
2. Default tags apply automatically through the provider.
3. If CI or operators need a value, add a module output and an env root output in both environments.
4. Check that the HCP roles can create it. `PowerUserAccess` excludes most IAM actions. Other IAM changes go in `infra/bootstrap/main.tf`, which an operator applies locally.
5. `DenyProdByName` lists specific services. For a service outside that list, only `DenyProdByTag` keeps the dev role away from prod resources.
6. If Semgrep flags the resource and the exception is deliberate, add a `nosemgrep` comment as described in [infrastructure.md](infrastructure.md#semgrep-exceptions).
