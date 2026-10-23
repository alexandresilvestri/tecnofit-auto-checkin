# 0015. Local environment on moto with the real Lambda handlers

- Status: Accepted
- Date: 2026-09-28

## Context

Developers want `docker compose up` to run the whole app. LocalStack Community does not support API Gateway v2 (HTTP API), which the app uses.

## Decision

- `compose.yml` runs moto, a dependency installer, an API gateway and Vite.
- The gateway (`scripts/local-api.ts`) routes requests to the real Lambda handlers. The AWS SDK reaches moto through `AWS_ENDPOINT_URL`. On start it creates the tables, the KMS key and the schedule group.
- Admin login is bypassed: the gateway fakes Cognito under `/cognito/*` and injects admin claims.
- The Tecnofit API is the real one, not a mock.
- moto has no host port.

## Consequences

- Handlers need no local-only code; they stay driven by environment variables.
- The local moto never clashes with the moto that integration tests start on port 5000.
- The check-in worker never fires locally: moto's Scheduler does not invoke targets.
- moto keeps data in memory, so restarting it wipes the data.
- When infra routes change, the gateway routing must change too.
- Containers run as root. `apps/web/node_modules` has its own volume to keep root-owned files out of the host tree.

See [development.md](../development.md).
