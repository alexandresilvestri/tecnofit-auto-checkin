# Runbook

Convenções: `<env>` é `dev` ou `prod`; região `us-east-1`; recursos com prefixo `checkin-<env>-`. Credenciais AWS do operador devem estar no shell.

## Deploy, promoção e rollback

**Dev (automático).** Merge em `main` dispara `deploy.yml`: build dos zips em `s3://$ARTIFACTS_BUCKET/<sha>/`, run no workspace `checkin-dev`, sync do SPA, invalidação do CloudFront e smoke tests (`/api/health`, headers de segurança, acesso direto ao API Gateway negado).

```bash
gh run list --workflow deploy.yml --limit 5
gh run watch
```

**Prod (manual).** `promote.yml` só roda a partir de `main` e usa um `sha` que já passou pelo deploy (os zips precisam existir no bucket). Não há aprovação: o Environment `prod` só restringe a branch a `main`, porque "Required reviewers" não está disponível em repositório privado no plano gratuito do GitHub. Disparar o workflow é a aprovação.

```bash
git fetch origin main
gh workflow run promote.yml --ref main -f sha=$(git rev-parse origin/main)
gh run list --workflow promote.yml --limit 1
gh run watch
```

URL de prod: https://dquf6r20z50xs.cloudfront.net. Para conferir:

- HCP: workspace `checkin-prod` → Outputs → `web_url`; ou
- local, após `terraform login`:
  ```bash
  export TF_CLOUD_ORGANIZATION=ATS_org
  cd infra/envs/prod && terraform init && terraform output web_url
  ```

**Rollback.** É um novo promote com um `sha` anterior. O alvo precisa ser um sha de merge em `main` igual ou posterior ao merge da Fase 5 (antes dele não existe `infra/envs/prod` e o job falha em "Check environment exists at sha") e ter no máximo 90 dias (passado o prazo o job falha em "Check artifacts").

```bash
gh workflow run promote.yml --ref main -f sha=<sha-anterior>
```

Primeiro teste de rollback: fazer mais um commit em `main` → promover esse sha → promover o sha do merge da Fase 5 (rollback) → promover de novo o sha mais novo.

Notas:

- Rollback só volta código e infra versionados; dados não voltam (ver PITR).
- `release.yml` tem os jobs `dev` e `prod` idênticos, mantidos à mão: qualquer mudança vai nos dois.
- `pr.yml` roda lint, typecheck, testes, build, e2e, `terraform validate`, Semgrep e plan especulativo do dev.

## Setup inicial de prod

Uma vez, antes do primeiro promote.

1. Reaplicar o bootstrap a partir da raiz do repo:
   ```bash
   export TF_CLOUD_ORGANIZATION=ATS_org
   cd infra/bootstrap && terraform init && terraform apply -var hcp_org=ATS_org -var hcp_project=tecnofit-auto-checkin
   ```
   Atenção: passar outro `hcp_project` (o padrão é "Default Project") quebra a confiança do dev. O plano esperado só tem adições (role, policies e attachment de prod) e mudanças in-place (trust/policy do `github-deploy`, outputs existentes); nenhum destroy/replace.
2. No HCP Terraform, criar o workspace `checkin-prod` na org `ATS_org`, projeto `tecnofit-auto-checkin`: workflow API-driven, Terraform 1.15.9, working directory `envs/prod` (não `infra/envs/prod`: o upload envia a pasta `infra`). Variáveis de ambiente: `TFC_AWS_PROVIDER_AUTH=true` e `TFC_AWS_RUN_ROLE_ARN=<output hcp_prod_role_arn>`.
3. No GitHub: Settings → Environments → `prod` → Deployment branches and tags = "Selected branches and tags" com a regra de branch `main` (o subject OIDC `environment:prod` não carrega branch). Required reviewers só existe em planos pagos para repositório privado; se o plano permitir, adicione o dono e deixe "Prevent self-review" desmarcado. Criar antes do primeiro promote; senão o GitHub cria o Environment sem proteção.
4. Fazer o primeiro promote, confirmar o e-mail da assinatura SNS e criar o admin de prod (os 2 comandos Cognito de "Reset do admin", com o `admin_user_pool_id` de prod).

## Migração dev → prod

One-shot. Dry-run primeiro, depois aplicar:

```bash
npm run migrate
npm run migrate -- --apply
```

Repetir `--apply` até não haver linhas `FAILED`. Nunca rodar de novo depois: o dev vira homologação e seus usuários de teste seriam movidos para prod.

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
3. Ajustar o schema zod em `packages/core/tecnofit/client.ts` e os fixtures de teste (`tests/fixtures/tecnofit`).
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

Ação: avisar os usuários para entrar de novo no app com o login Tecnofit (a conta volta a `ok`). Se a causa for mudança na API de login, veja a seção anterior.

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
4. Recriar os schedules do EventBridge: schedules vivem fora do DynamoDB e não voltam com o restore. A função `recreateSchedule` (`packages/core/domain/schedules.ts`) recria um schedule a partir da linha `schedule`, mas não há script que a chame em lote; escreva um script temporário com `tsx` baseado em `scripts/migrate.ts` (que usa `recreateSchedule` por usuário) ou recrie com `CHECKIN_ENV=<env> npm run schedule -- add ...`. Confira com `npm run schedule -- list --user <userId>` ou `aws scheduler list-schedules --region us-east-1 --group-name checkin-<env>`.
5. Apagar a tabela temporária (`aws dynamodb delete-table --table-name checkin-<env>-main-restore`); ela nasce sem deletion protection.

## Rotação do segredo de origem

O segredo é `random_password.origin` (`module.backend.random_password.origin`). O CloudFront o envia no header `X-Origin-Verify` e as Lambdas o validam. Trocar o valor atualiza CloudFront e Lambdas na mesma aplicação.

Pelo HCP (preferido; descrito a partir da documentação do HCP, não validado): workspace `checkin-<env>` → New run → em "Replace" selecione `module.backend.random_password.origin` → Start run → confirmar o apply.

Local (alternativa, após `terraform login`):

```bash
cd infra/envs/<env>
export TF_CLOUD_ORGANIZATION=ATS_org
terraform init
terraform apply -replace=module.backend.random_password.origin -var artifact_version=<sha atual>
```

Atenção: um apply local em prod ignora a restrição de branch do Environment `prod` do GitHub; use só com intenção explícita.

Esperado: janela curta de respostas 403 em `/api/*` até o CloudFront propagar a nova configuração (alguns minutos). Verificar:

```bash
curl -s "$WEB_URL/api/health"
```

Se persistir 403 por mais de ~15 min, confira se o apply terminou nas Lambdas e na distribuição.

## Acesso direto ao API Gateway

Chamadas diretas ao `execute-api` são negadas: rotas com authorizer (user/admin) respondem 401 do API Gateway e as demais 403.

## Alarmes

Todos notificam o tópico SNS `checkin-<env>-alarms` (e-mail). Janela de 5 min.

| Alarme | Quando dispara | O que fazer |
| --- | --- | --- |
| `checkin-<env>-checkin-failed` | check-in com `status = failed` | Ver logs do worker; `invalid_response` = ver "Tecnofit mudou a API"; muitos `reconnect` = "Token inválido em massa". |
| `checkin-<env>-worker-errors` | erro (exceção) no worker | `aws logs tail /aws/lambda/checkin-<env>-checkin-worker --since 1h`; corrigir e promover; rollback se foi o último deploy. |
| `checkin-<env>-api-5xx` | 5xx no API Gateway | Logs das Lambdas `/aws/lambda/checkin-<env>-api-public`, `-api-user`, `-api-admin`; rollback se coincide com deploy. |
| `checkin-<env>-api-public-errors`, `-api-user-errors`, `-api-admin-errors`, `-authorizer-user-errors` | erro na Lambda correspondente | `aws logs tail /aws/lambda/checkin-<env>-<função> --since 1h`. |
| `checkin-<env>-login-failed` | mais de 20 logins com falha (401), cada falha contada uma vez, em 5 min | Possível força bruta ou mudança no login Tecnofit; checar logs de `api-public`. |

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

MFA perdido: a correção confiável é apagar o usuário e recriá-lo com os 2 comandos abaixo.

```bash
aws cognito-idp admin-delete-user --region us-east-1 --user-pool-id $POOL --username <email>

aws cognito-idp admin-create-user --region us-east-1 --user-pool-id $POOL --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --region us-east-1 --user-pool-id $POOL --username <email> --group-name admin
```

A senha temporária chega por e-mail; o primeiro login pede nova senha e o cadastro do TOTP.

Alternativa não validada: `aws cognito-idp admin-set-user-mfa-preference --region us-east-1 --user-pool-id $POOL --username <email> --software-token-mfa-settings Enabled=false,PreferredMfa=false`.

## Destruir um ambiente

Destruir apaga os dados de forma irreversível: a chave KMS entra em exclusão agendada (período de espera) e, sem ela, os tokens cifrados não podem ser recuperados. Faça backup antes se precisar (ver PITR).

1. Desligar as proteções (bloqueiam o destroy):
   - DynamoDB: `deletion_protection_enabled = false` nas duas tabelas em `infra/modules/data/main.tf`.
   - Cognito: `deletion_protection = "INACTIVE"` em `infra/modules/auth/main.tf`.

   Esses módulos são compartilhados: a mudança vale para dev e prod no próximo apply de cada um. Reverta (reative as proteções) logo depois do destroy, ou antes de aplicar no outro ambiente.
2. Aplicar a mudança no ambiente (PR → merge → dev; prod via `promote.yml`) e confirmar o apply.
3. Esvaziar o bucket do SPA (`web_bucket` está nos outputs do workspace `checkin-<env>` no HCP):
   ```bash
   aws s3 rm s3://<web_bucket> --recursive
   ```
4. No HCP: workspace `checkin-<env>` → Settings → Destruction and Deletion → Queue destroy plan → confirmar.
5. O grupo de schedules `checkin-<env>` é removido junto e apaga todos os schedules dele.
6. Remover o workspace no HCP e o Environment em Settings → Environments do GitHub, se for o caso.
