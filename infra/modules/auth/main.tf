locals {
  post_auth_name = "checkin-${var.env}-cognito-post-auth"

  routes = toset([
    "POST /api/admin/invites",
    "GET /api/admin/invites",
    "DELETE /api/admin/invites/{id}",
    "GET /api/admin/users",
    "GET /api/admin/users/{id}",
    "POST /api/admin/users/{id}/suspend",
    "POST /api/admin/users/{id}/reactivate",
    "POST /api/admin/users/{id}/revoke-sessions",
    "DELETE /api/admin/users/{id}",
    "GET /api/admin/executions",
    "GET /api/admin/audit",
    "GET /api/admin/audit/export",
  ])
}

# Logs hold only ids and statuses; AWS-managed encryption is enough.
# nosemgrep: terraform.aws.security.aws-cloudwatch-log-group-unencrypted.aws-cloudwatch-log-group-unencrypted
resource "aws_cloudwatch_log_group" "post_auth" {
  name              = "/aws/lambda/${local.post_auth_name}"
  retention_in_days = 30
}

resource "aws_iam_role" "post_auth" {
  name = local.post_auth_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "post_auth" {
  name = local.post_auth_name
  role = aws_iam_role.post_auth.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.post_auth.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "dynamodb:PutItem"
        Resource = var.audit_table_arn
      }
    ]
  })
}

resource "aws_lambda_function" "post_auth" {
  function_name = local.post_auth_name
  role          = aws_iam_role.post_auth.arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"
  timeout       = 15
  memory_size   = 256
  s3_bucket     = var.artifacts_bucket
  s3_key        = "${var.artifact_version}/cognito-post-auth.zip"

  # Only table names live here; no secrets.
  # nosemgrep: terraform.aws.security.aws-lambda-environment-unencrypted.aws-lambda-environment-unencrypted
  environment {
    variables = {
      TABLE_MAIN  = var.main_table_name
      TABLE_AUDIT = var.audit_table_name
    }
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.post_auth, aws_iam_role_policy.post_auth]
}

resource "aws_cognito_user_pool" "this" {
  name                     = "checkin-${var.env}-admin"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "ON"
  deletion_protection      = "ACTIVE"

  software_token_mfa_configuration {
    enabled = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length    = 14
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  lambda_config {
    post_authentication = aws_lambda_function.post_auth.arn
  }
}

resource "aws_lambda_permission" "post_auth" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.post_auth.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 2
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "checkin-${var.env}-admin"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["${var.web_url}/admin/callback"]
  logout_urls                          = ["${var.web_url}/admin"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 60
  id_token_validity                    = 60
  refresh_token_validity               = 60

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "minutes"
  }
}

resource "aws_cognito_managed_login_branding" "web" {
  client_id                   = aws_cognito_user_pool_client.web.id
  user_pool_id                = aws_cognito_user_pool.this.id
  use_cognito_provided_values = true
}

resource "aws_apigatewayv2_authorizer" "admin" {
  api_id           = var.api_id
  name             = "checkin-${var.env}-authorizer-admin"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://${aws_cognito_user_pool.this.endpoint}"
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_integration" "admin" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.api_admin_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin" {
  for_each           = local.routes
  api_id             = var.api_id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.admin.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.admin.id
}

resource "aws_lambda_permission" "api_admin" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.api_admin_arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
