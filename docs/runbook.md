# Runbook

Conventions: `<env>` is `dev` or `prod`. The region is `us-east-1`. Resources use the prefix `checkin-<env>-`, except the shared bootstrap resources (`checkin-artifacts-*`, `checkin-github-deploy`, `checkin-hcp-terraform-<env>`). The operator's AWS credentials must be loaded in the shell.

## Deploy, promotion and rollback

Pipeline details: [ci-cd.md](ci-cd.md).

**Dev (automatic).** A push to `main` triggers `deploy.yml`. It builds the zips into `s3://$ARTIFACTS_BUCKET/<sha>/` and runs the `checkin-dev` workspace. Then it syncs the SPA and invalidates `/index.html` in CloudFront. Last, it runs smoke tests: `/api/health`, security headers, and denied direct access to API Gateway.

```bash
gh run list --workflow deploy.yml --limit 5
gh run watch
```

**Prod (manual).** `promote.yml` runs only from `main`. It takes a `sha` that `deploy.yml` already built, so the zips must exist in the bucket. Approval model: [ci-cd.md](ci-cd.md#prod-approval-model).

```bash
git fetch origin main
gh workflow run promote.yml --ref main -f sha=$(git rev-parse origin/main)
gh run list --workflow promote.yml --limit 1
gh run watch
```

Prod URL: https://checkin.alexandresilvestri.com.br, also served at https://dquf6r20z50xs.cloudfront.net. The `web_url` output returns the CloudFront domain. To check it:

- HCP: workspace `checkin-prod` → Outputs → `web_url`; or
- locally, after `terraform login`:
  ```bash
  export TF_CLOUD_ORGANIZATION=ATS_org
  cd infra/envs/prod && terraform init && terraform output web_url
  ```

**Rollback.** A rollback is a new promote with an earlier `sha`. Valid targets: [ci-cd.md](ci-cd.md#rollback-window).

```bash
gh workflow run promote.yml --ref main -f sha=<previous-sha>
```

A rollback does not revert data; see [ci-cd.md](ci-cd.md#release-steps). To recover data, see "PITR restore".

The KMS key policy has its own rollback caveat; see [infrastructure.md](infrastructure.md#kms-key). So does the prod custom domain; see [infrastructure.md](infrastructure.md#custom-domain).

## Initial prod setup

Run once, before the first promote. Bootstrap and IAM background: [infrastructure.md](infrastructure.md).

1. Re-apply the bootstrap from the repo root:
   ```bash
   export TF_CLOUD_ORGANIZATION=ATS_org
   cd infra/bootstrap && terraform init && terraform apply -var hcp_org=ATS_org -var hcp_project=tecnofit-auto-checkin
   ```
   Warning: any other `hcp_project` (the default is "Default Project") breaks the trust of the dev role. The expected plan has no destroy or replace. Additions: the prod role, its `checkin-prod-iam` policy and PowerUser attachment, and the `checkin-dev-deny-prod` policy on the dev role. In-place changes: the trust and policy of `checkin-github-deploy`. Outputs gain `hcp_prod_role_arn`.
2. In HCP Terraform, create the `checkin-prod` workspace in org `ATS_org`, project `tecnofit-auto-checkin`. Use the API-driven workflow, the Terraform version in [infrastructure.md](infrastructure.md#pinned-versions) and working directory `envs/prod`. Do not use `infra/envs/prod`: the upload sends the `infra` folder. Environment variables: `TFC_AWS_PROVIDER_AUTH=true` and `TFC_AWS_RUN_ROLE_ARN=<hcp_prod_role_arn output>`.
3. In GitHub: Settings → Environments → `prod` → Deployment branches and tags = "Selected branches and tags", with the branch rule `main`. Add no required reviewer; see [ci-cd.md](ci-cd.md#prod-approval-model). Create the Environment before the first promote; otherwise GitHub creates it without protection.
4. Run the first promote and confirm the SNS subscription email. Then create the prod admin with the `admin-create-user` and `admin-add-user-to-group` commands from "Admin reset". Use the prod `admin_user_pool_id`.

## Sentry

Prod Lambdas and the SPA report errors to Sentry; see [architecture.md](architecture.md#observability). To set it up or change a DSN:

1. In HCP workspace `checkin-prod`, set the Terraform variables `sentry_dsn_api` and `sentry_dsn_web`; see [infrastructure.md](infrastructure.md#hcp-terraform). Do this before promoting a sha that declares them, or the run fails on a missing variable.
2. In GitHub, set the Actions secret `SENTRY_AUTH_TOKEN` (Sentry organization auth token) and the Actions variable `SENTRY_ORG`. Without them, the prod build skips the source map upload.
3. Promote. The DSNs reach the Lambdas, the SPA build and the CSP.

To turn Sentry off, set both variables to an empty string and promote.

## Dev to prod migration

One-shot. Run a dry run first, then apply. Ops scripts: [development.md](development.md).

```bash
npm run migrate
npm run migrate -- --apply
```

Repeat `--apply` until no `FAILED` lines remain. Never run it again after that: dev becomes the staging environment, and its test users would move to prod.

## Tecnofit changed its API

Symptom: the `checkin-<env>-checkin-failed` alarm fires. Executions fail with `invalid_response`, meaning the response does not match the zod schema. Client and schemas: [tecnofit-integration.md](tecnofit-integration.md).

1. Read the worker logs:
   ```bash
   aws logs tail /aws/lambda/checkin-<env>-checkin-worker --since 1h --region us-east-1
   ```
2. Reproduce with a real user. The command calls the Tecnofit class list. On a schema mismatch, it fails with the zod error, which lists the mismatched fields.
   ```bash
   CHECKIN_ENV=<env> npm run schedule -- classes --user <userId> --date <YYYY-MM-DD>
   ```
3. Update the zod schema in `packages/core/tecnofit/client.ts` and the test fixtures (`tests/fixtures/tecnofit`).
4. Run `npm run test:unit && npm run test:integration` (integration tests need moto: `npm run moto:up`). Open a PR and merge it, which deploys dev. Validate in dev, then run `promote.yml` with the `sha`.

Check-ins lost during the failure are not retried automatically. Tell the affected users.

## Many invalid tokens

Symptom: many users have an account with `status = reconnect`, because their Tecnofit token expired or was revoked. The worker skips these users until they log in to the app again. Item layout: [data-model.md](data-model.md).

List them:

```bash
aws dynamodb scan --table-name checkin-<env>-main --region us-east-1 \
  --filter-expression 'begins_with(SK, :a) AND #status = :r' \
  --expression-attribute-names '{"#status":"status"}' \
  --expression-attribute-values '{":a":{"S":"ACCOUNT#"},":r":{"S":"reconnect"}}' \
  --projection-expression 'PK,SK'
```

Action: ask the users to log in to the app again with their Tecnofit credentials. The account then returns to `ok`. If the cause is a change in the login API, see the previous section.

## PITR restore

Both tables (`checkin-<env>-main` and `checkin-<env>-audit`) have PITR. No bulk restore script exists; the procedure is manual.

1. Restore into a new table, never over the existing one:
   ```bash
   aws dynamodb restore-table-to-point-in-time --region us-east-1 \
     --source-table-name checkin-<env>-main \
     --target-table-name checkin-<env>-main-restore \
     --restore-date-time <ISO-8601, e.g. 2026-01-31T12:00:00Z>
   aws dynamodb describe-table --region us-east-1 --table-name checkin-<env>-main-restore --query Table.TableStatus
   ```
   For the most recent point, use `--use-latest-restorable-time` instead of `--restore-date-time`.
2. Check the content (`aws dynamodb scan --table-name checkin-<env>-main-restore --select COUNT`, or specific items with `get-item`/`query`).
3. Copy the needed items into `checkin-<env>-main` (`scan` on the restored table, `put-item`/`batch-write-item` on the original). Copy only what is missing or lost.
4. Recreate the EventBridge schedules. They live outside DynamoDB and do not come back with the restore.
   - `recreateSchedule` (`packages/core/domain/schedules.ts`) recreates one schedule from a `schedule` row. No script calls it in bulk.
   - Option 1: write a temporary `tsx` script based on `scripts/migrate.ts`. Its `migrateUser` (`packages/core/domain/migrate.ts`) calls `recreateSchedule` for each row.
   - Option 2: recreate them with `CHECKIN_ENV=<env> npm run schedule -- add ...`. `add` creates a new row, so do not copy the old row for that schedule.
   - Check with `aws scheduler list-schedules --region us-east-1 --group-name checkin-<env>`. `CHECKIN_ENV=<env> npm run schedule -- list --user <userId>` shows only the DynamoDB rows.
5. Delete the temporary table (`aws dynamodb delete-table --table-name checkin-<env>-main-restore`). It is created without deletion protection.

## Origin secret rotation

The secret is `random_password.origin` (`module.backend.random_password.origin`). CloudFront sends it in the `X-Origin-Verify` header, and the Lambdas check it. Changing the value updates CloudFront and the Lambdas in the same apply. Background: [infrastructure.md](infrastructure.md).

Through HCP (preferred). These steps come from the HCP documentation and are not validated. Workspace `checkin-<env>` → New run → under "Replace", select `module.backend.random_password.origin` → Start run → confirm the apply.

Locally (alternative, after `terraform login`). `<current-sha>` is the sha deployed in that environment:

```bash
cd infra/envs/<env>
export TF_CLOUD_ORGANIZATION=ATS_org
terraform init
terraform apply -replace=module.backend.random_password.origin -var artifact_version=<current-sha>
```

Warning: a local apply on prod bypasses the branch rule of the GitHub `prod` Environment. Use it only with explicit intent.

Expected: a short window of 403 responses on `/api/*` until CloudFront propagates the new configuration (a few minutes). Check it, with `WEB_URL` set to the `web_url` output:

```bash
curl -s "$WEB_URL/api/health"
```

If the 403 lasts more than ~15 min, check that the apply finished on the Lambdas and on the distribution.

## KMS key access

Key policy, principals and accepted risks: [infrastructure.md](infrastructure.md#kms-key).

Reset to the default policy, for example after promoting a sha before `7c12141`:

```bash
KEY=$(aws kms describe-key --region us-east-1 --key-id alias/checkin-<env>-token --query KeyMetadata.Arn --output text)
aws kms put-key-policy --region us-east-1 --key-id "$KEY" --policy-name default --policy '{"Version":"2012-10-17","Statement":[{"Sid":"Enable IAM User Permissions","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::<account-id>:root"},"Action":"kms:*","Resource":"*"}]}'
```

To add an operator: add the ARN to `operator_arns` in the `module "data"` block of `infra/envs/<env>/main.tf`. Open a PR, merge it (dev) and promote (prod).

KMS `AccessDenied` in a Lambda's logs: check that the role name still follows `checkin-<env>-<function>`, because the policy builds the ARNs by convention. Then compare with the applied policy:

```bash
KEY=$(aws kms describe-key --region us-east-1 --key-id alias/checkin-<env>-token --query KeyMetadata.Arn --output text)
aws kms get-key-policy --region us-east-1 --key-id "$KEY" --policy-name default --output text
```

## Alarms

All alarms notify the SNS topic `checkin-<env>-alarms` (email). The period is 5 minutes.

| Alarm | Fires when | What to do |
| --- | --- | --- |
| `checkin-<env>-checkin-failed` | a check-in ends with `status = failed` | Read the worker logs. `invalid_response`: see "Tecnofit changed its API". Many accounts in `reconnect`: see "Many invalid tokens". |
| `checkin-<env>-worker-errors` | an error (exception) in the worker | `aws logs tail /aws/lambda/checkin-<env>-checkin-worker --since 1h`; fix and promote. Roll back if the last deploy caused it. |
| `checkin-<env>-api-5xx` | a 5xx in API Gateway | Read the Lambda logs `/aws/lambda/checkin-<env>-api-public`, `-api-user`, `-api-admin`. Roll back if it matches a deploy. |
| `checkin-<env>-api-public-errors`, `-api-user-errors`, `-api-admin-errors`, `-authorizer-user-errors` | an error in the matching Lambda | `aws logs tail /aws/lambda/checkin-<env>-<function> --since 1h`. |
| `checkin-<env>-login-failed` | more than 20 failed logins (401) in 5 min, each failure counted once | Possible brute force or a Tecnofit login change. Check the `api-public` logs. |

Test the notification:

```bash
aws cloudwatch set-alarm-state --alarm-name checkin-<env>-api-5xx --state-value ALARM --state-reason teste --region us-east-1
```

Confirm the SNS email subscription once per environment.

## Admin reset

The pool is `checkin-<env>-admin`. It has no self sign-up (users are created only through the Cognito admin API) and requires TOTP MFA. The pool ID is the `admin_user_pool_id` output of the `checkin-<env>` workspace in HCP.

```bash
POOL=<admin_user_pool_id>
```

Password:

```bash
aws cognito-idp admin-reset-user-password --region us-east-1 \
  --user-pool-id $POOL --username <email>
```

Lost MFA: the reliable fix is to delete the user and recreate it with the two commands below.

```bash
aws cognito-idp admin-delete-user --region us-east-1 --user-pool-id $POOL --username <email>

aws cognito-idp admin-create-user --region us-east-1 --user-pool-id $POOL --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --region us-east-1 --user-pool-id $POOL --username <email> --group-name admin
```

The temporary password arrives by email. The first login asks for a new password and the TOTP setup.

Unvalidated alternative: `aws cognito-idp admin-set-user-mfa-preference --region us-east-1 --user-pool-id $POOL --username <email> --software-token-mfa-settings Enabled=false,PreferredMfa=false`.

## Destroying an environment

Destroying deletes the data irreversibly. The KMS key enters scheduled deletion (30-day default waiting period). Without the key, the encrypted tokens cannot be recovered. Back up first if needed (see "PITR restore").

1. Turn off the protections, because they block the destroy:
   - DynamoDB: `deletion_protection_enabled = false` on both tables in `infra/modules/data/main.tf`.
   - Cognito: `deletion_protection = "INACTIVE"` in `infra/modules/auth/main.tf`.

   These modules are shared: the change reaches dev and prod on each one's next apply. Revert it (turn the protections back on) right after the destroy, or before applying to the other environment.
2. Apply the change to the environment (PR → merge → dev; prod through `promote.yml`) and confirm the apply.
3. Empty the SPA bucket. `web_bucket` is in the outputs of the `checkin-<env>` workspace in HCP:
   ```bash
   aws s3 rm s3://<web_bucket> --recursive
   ```
4. In HCP: workspace `checkin-<env>` → Settings → Destruction and Deletion → Queue destroy plan → confirm.
5. The destroy also removes the schedule group `checkin-<env>`, which deletes all its schedules.
6. If needed, remove the HCP workspace and the GitHub Environment (Settings → Environments).
