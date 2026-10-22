# Runbook

Convenções: `<env>` é `dev` ou `prod`; região `us-east-1`; recursos com prefixo `checkin-<env>-`. Credenciais AWS do operador devem estar no shell.

## Deploy, promoção e rollback

**Dev (automático).** Merge em `main` dispara `deploy.yml`: build dos zips em `s3://$ARTIFACTS_BUCKET/<sha>/`, run no workspace `checkin-dev`, sync do SPA, invalidação do CloudFront e smoke tests (`/api/health`, headers de segurança, acesso direto ao API Gateway = 403).

```bash
gh run list --workflow deploy.yml --limit 5
gh run watch
```

**Prod (manual).** `promote.yml` só roda a partir de `main`, usa um `sha` que já passou pelo deploy (os zips precisam existir no bucket) e exige aprovação no Environment `prod` do GitHub.

```bash
git fetch origin main
gh workflow run promote.yml --ref main -f sha=$(git rev-parse origin/main)
gh run list --workflow promote.yml --limit 1
gh run watch
```

Aprove o run no GitHub (Environment `prod`). URL de prod:

- HCP: workspace `checkin-prod` → Outputs → `web_url`; ou
- `cd infra/envs/prod && terraform output web_url` (após `terraform login`).

**Rollback.** É um novo promote com um `sha` anterior. Os artefatos ficam 90 dias; passado esse prazo o job falha em "Check artifacts".

```bash
gh workflow run promote.yml --ref main -f sha=<sha-anterior>
```

Notas:

- Rollback só volta código e infra versionados; dados não voltam (ver PITR).
- `release.yml` tem os jobs `dev` e `prod` idênticos, mantidos à mão: qualquer mudança vai nos dois.
- `pr.yml` roda lint, typecheck, testes, build, e2e, `terraform validate`, Semgrep e plan especulativo do dev.

## Tecnofit mudou a API

Sintoma: alarme `checkin-<env>-checkin-failed` e execuções com erro `invalid_response` (resposta não bate com o schema zod).

1. Ver os logs do worker:
   ```bash
   aws logs tail /aws/lambda/checkin-<env>-checkin-worker --since 1h --region us-east-1
   ```
2. Capturar a resposta atual com um usuário real:
   ```bash
   CHECKIN_ENV=<env> npm run schedule -- classes --user <userId> --date <YYYY-MM-DD>
   ```
3. Ajustar o schema zod em `packages/core/tecnofit/client.ts` e os fixtures de teste (`tests/fixtures`).
4. `npm run test:unit && npm run test:integration`, abrir PR, merge (deploy no dev), validar no dev e então `promote.yml` com o `sha`.

Check-ins perdidos durante a falha não são refeitos sozinhos; avise os usuários afetados.

## Token inválido em massa

Sintoma: muitos usuários com conta `status = reconnect` (token Tecnofit expirou/foi revogado). O worker pula esses usuários até eles entrarem de novo no app.

Listar:

```bash
aws dynamodb scan --table-name checkin-<env>-main --region us-east-1 \
  --filter-expression 'begins_with(SK, :a) AND #status = :r' \
  --expression-attribute-names '{"#status":"status"}' \
  --expression-attribute-values '{":a":{"S":"ACCOUNT#"},":r":{"S":"reconnect"}}' \
  --projection-expression 'PK,SK'
```

Ação: avisar os usuários para entrar de novo no app com o login Tecnofit (a conta volta a `active`). Se a causa for mudança na API de login, veja a seção anterior.

## Restauração via PITR

As duas tabelas têm PITR. Não existe script de restauração em massa; o procedimento é manual.

1. Restaurar para uma tabela nova (nunca sobre a existente):
   ```bash
   aws dynamodb restore-table-to-point-in-time --region us-east-1 \
     --source-table-name checkin-<env>-main \
     --target-table-name checkin-<env>-main-restore \
     --restore-date-time <ISO-8601, ex. 2026-01-31T12:00:00Z>
   aws dynamodb describe-table --region us-east-1 --table-name checkin-<env>-main-restore --query Table.TableStatus
   ```
   Use `--use-latest-restorable-time` no lugar de `--restore-date-time` para o ponto mais recente.
2. Conferir o conteúdo (`aws dynamodb scan --table-name checkin-<env>-main-restore --select COUNT`, ou itens específicos com `get-item`/`query`).
3. Copiar os itens necessários para `checkin-<env>-main` (`scan` na restaurada, `put-item`/`batch-write-item` na original), só o que falta ou foi perdido.
4. Recriar os schedules do EventBridge: schedules vivem fora do DynamoDB e não voltam com o restore. A função `recreateSchedule` (`packages/core/domain/schedules.ts`) recria um schedule a partir da linha `schedule`, mas não há script que a chame em lote; escreva um script temporário com `tsx` baseado em `scripts/migrate.ts` (que usa `recreateSchedule` por usuário) ou recrie com `CHECKIN_ENV=<env> npm run schedule -- add ...`. Confira com `npm run schedule -- list --user <userId>` ou `aws scheduler list-schedules --group-name checkin-<env>`.
5. Apagar a tabela temporária (`aws dynamodb delete-table --table-name checkin-<env>-main-restore`); ela nasce sem deletion protection.

## Rotação do segredo de origem

O segredo é `random_password.origin` (`module.backend.random_password.origin`). O CloudFront o envia no header `X-Origin-Verify` e as Lambdas o validam. Trocar o valor atualiza CloudFront e Lambdas na mesma aplicação.

Pelo HCP: workspace `checkin-<env>` → New run → marque "Replace" no recurso `module.backend.random_password.origin` → Plan and apply → confirmar.

Ou local (após `terraform login`, `cd infra/envs/<env>`, com `artifact_version` definido como no release):

```bash
terraform init
terraform apply -replace=module.backend.random_password.origin
```

Esperado: janela curta de respostas 403 em `/api/*` até o CloudFront propagar a nova configuração (alguns minutos). Verificar:

```bash
curl -s "$WEB_URL/api/health"
```

Se persistir 403 por mais de ~15 min, confira se o apply terminou nas Lambdas e na distribuição.

## Alarmes

Todos notificam o tópico SNS `checkin-<env>-alarms` (e-mail). Janela de 5 min.

| Alarme | Quando dispara | O que fazer |
| --- | --- | --- |
| `checkin-<env>-checkin-failed` | check-in com `status = failed` | Ver logs do worker; `invalid_response` = ver "Tecnofit mudou a API"; muitos `reconnect` = "Token inválido em massa". |
| `checkin-<env>-worker-errors` | erro (exceção) no worker | `aws logs tail /aws/lambda/checkin-<env>-checkin-worker --since 1h`; corrigir e promover; rollback se foi o último deploy. |
| `checkin-<env>-api-5xx` | 5xx no API Gateway | Logs das Lambdas `/aws/lambda/checkin-<env>-api-public`, `-api-user`, `-api-admin`; rollback se coincide com deploy. |
| `checkin-<env>-api-public-errors`, `-api-user-errors`, `-api-admin-errors`, `-authorizer-user-errors` | erro na Lambda correspondente | `aws logs tail /aws/lambda/checkin-<env>-<função> --since 1h`. |
| `checkin-<env>-login-failed` | mais de 20 logins com 401 em 5 min | Possível força bruta ou mudança no login Tecnofit; checar logs de `api-public`. |

Testar o envio:

```bash
aws cloudwatch set-alarm-state --alarm-name checkin-<env>-api-5xx --state-value ALARM --state-reason teste --region us-east-1
```

A assinatura do e-mail no SNS precisa ser confirmada uma vez por ambiente.

## Reset do admin

O pool é `checkin-<env>-admin` (só admin cria usuários, MFA TOTP obrigatório). ID do pool: output `admin_user_pool_id` do workspace `checkin-<env>` no HCP.

```bash
POOL=<admin_user_pool_id>
```

Senha:

```bash
aws cognito-idp admin-reset-user-password --region us-east-1 \
  --user-pool-id $POOL --username <email>
```

MFA perdido: tentar redefinir o dispositivo (o usuário cadastra um novo no próximo login):

```bash
aws cognito-idp admin-set-user-mfa-preference --region us-east-1 \
  --user-pool-id $POOL --username <email> \
  --software-token-mfa-settings Enabled=false,PreferredMfa=false
```

Se não resolver, apagar e recriar o usuário (2 comandos de criação):

```bash
aws cognito-idp admin-delete-user --region us-east-1 --user-pool-id $POOL --username <email>

aws cognito-idp admin-create-user --region us-east-1 --user-pool-id $POOL --username <email> \
  --user-attributes Name=email,Value=<email> Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
aws cognito-idp admin-set-user-password --region us-east-1 --user-pool-id $POOL --username <email> \
  --password '<senha com 14+ caracteres, maiúscula, minúscula, número e símbolo>' --permanent
```

No primeiro login o app pede o cadastro do MFA. Não conferi estes comandos contra uma conta real; valide em dev antes de usar em prod.

## Destruir um ambiente

Destruir apaga os dados. Faça um backup se precisar (ver PITR) antes.

1. Desligar as proteções (elas bloqueiam o destroy):
   - DynamoDB: `deletion_protection_enabled = false` nas duas tabelas em `infra/modules/data/main.tf`.
   - Cognito: `deletion_protection = "INACTIVE"` em `infra/modules/auth/main.tf`.
2. Aplicar essa mudança no ambiente (PR → merge → dev; para prod, `promote.yml`) e confirmar que o apply passou.
3. No HCP: workspace `checkin-<env>` → Settings → Destruction and Deletion → Queue destroy plan → confirmar.
4. O grupo de schedules `checkin-<env>` é removido junto e apaga todos os schedules dele.
5. Se o bucket do SPA ou o state tiverem objetos, esvazie e repita se o destroy falhar.
6. Para remover também o workspace e o ambiente do GitHub, faça-o manualmente no HCP e em Settings → Environments.
