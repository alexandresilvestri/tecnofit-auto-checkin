# 0012. Region us-east-1 and Node.js 24 runtime

- Status: Accepted
- Date: 2026-09-04

## Context

The original plan used `sa-east-1` for lower latency to Tecnofit during contested check-ins. It also targeted the Node.js 22 Lambda runtime.

## Decision

- All resources run in `us-east-1`, for lower cost. The move happened on 2026-09-04.
- Lambdas use `nodejs24.x`. The Node.js 22 runtime is deprecated on 2027-04-30.

## Consequences

- The latency advantage of `sa-east-1` is given up.
- With AWS provider v6, changing the provider region does not move existing resources, because state stores the region per resource. A region move needs a destroy or `-replace`.
- Bucket names carry the region, such as `checkin-artifacts-<account-id>-us-east-1`.
- The build targets Node 24 (`scripts/build-functions.mjs`), and local development needs Node 24 (`.nvmrc`).
