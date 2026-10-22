data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

resource "random_password" "origin" {
  length  = 48
  special = false
}

locals {
  worker_name = "checkin-${var.env}-checkin-worker"

  api_functions = {
    api-public = {
      env = {
        ORIGIN_SECRET = random_password.origin.result
        TABLE_MAIN    = var.main_table_name
        TABLE_AUDIT   = var.audit_table_name
        KMS_KEY_ID    = var.token_key_arn
      }
      statements = [
        {
          Effect   = "Allow"
          Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:ConditionCheckItem"]
          Resource = [var.main_table_arn, "${var.main_table_arn}/index/*"]
        },
        {
          Effect   = "Allow"
          Action   = "dynamodb:PutItem"
          Resource = var.audit_table_arn
        },
        {
          Effect   = "Allow"
          Action   = "kms:Encrypt"
          Resource = var.token_key_arn
          Condition = {
            "ForAnyValue:StringEquals" = {
              "kms:EncryptionContextKeys" = "userId"
            }
          }
        }
      ]
    }
    api-user = {
      env = {
        ORIGIN_SECRET      = random_password.origin.result
        TABLE_MAIN         = var.main_table_name
        TABLE_AUDIT        = var.audit_table_name
        SCHEDULE_GROUP     = aws_scheduler_schedule_group.this.name
        WORKER_ARN         = aws_lambda_function.worker.arn
        SCHEDULER_ROLE_ARN = aws_iam_role.scheduler.arn
      }
      statements = [
        {
          Effect   = "Allow"
          Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"]
          Resource = [var.main_table_arn, "${var.main_table_arn}/index/*"]
        },
        {
          Effect   = "Allow"
          Action   = "dynamodb:PutItem"
          Resource = var.audit_table_arn
        },
        {
          Effect   = "Allow"
          Action   = "kms:Decrypt"
          Resource = var.token_key_arn
          Condition = {
            "ForAnyValue:StringEquals" = {
              "kms:EncryptionContextKeys" = "userId"
            }
          }
        },
        {
          Effect   = "Allow"
          Action   = ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule"]
          Resource = "arn:aws:scheduler:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:schedule/checkin-${var.env}/*"
        },
        {
          Effect   = "Allow"
          Action   = "iam:PassRole"
          Resource = aws_iam_role.scheduler.arn
          Condition = {
            StringEquals = {
              "iam:PassedToService" = "scheduler.amazonaws.com"
            }
          }
        }
      ]
    }
    api-admin = {
      env = {
        ORIGIN_SECRET      = random_password.origin.result
        TABLE_MAIN         = var.main_table_name
        TABLE_AUDIT        = var.audit_table_name
        SCHEDULE_GROUP     = aws_scheduler_schedule_group.this.name
        WORKER_ARN         = aws_lambda_function.worker.arn
        SCHEDULER_ROLE_ARN = aws_iam_role.scheduler.arn
      }
      statements = [
        {
          Effect   = "Allow"
          Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchWriteItem"]
          Resource = [var.main_table_arn, "${var.main_table_arn}/index/*"]
        },
        {
          Effect   = "Allow"
          Action   = ["dynamodb:PutItem", "dynamodb:Query"]
          Resource = [var.audit_table_arn, "${var.audit_table_arn}/index/*"]
        },
        {
          Effect   = "Allow"
          Action   = ["scheduler:UpdateSchedule", "scheduler:DeleteSchedule"]
          Resource = "arn:aws:scheduler:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:schedule/checkin-${var.env}/*"
        },
        {
          Effect   = "Allow"
          Action   = "iam:PassRole"
          Resource = aws_iam_role.scheduler.arn
          Condition = {
            StringEquals = {
              "iam:PassedToService" = "scheduler.amazonaws.com"
            }
          }
        }
      ]
    }
    authorizer-user = {
      env = {
        ORIGIN_SECRET = random_password.origin.result
        TABLE_MAIN    = var.main_table_name
        TABLE_AUDIT   = var.audit_table_name
      }
      statements = [
        {
          Effect   = "Allow"
          Action   = "dynamodb:GetItem"
          Resource = var.main_table_arn
        }
      ]
    }
  }

  routes = {
    "GET /api/health"            = "api-public"
    "POST /api/invites/check"    = "api-public"
    "POST /api/onboarding"       = "api-public"
    "POST /api/auth/login"       = "api-public"
    "GET /api/me"                = "api-user"
    "POST /api/auth/logout"      = "api-user"
    "GET /api/classes"           = "api-user"
    "GET /api/schedules"         = "api-user"
    "POST /api/schedules"        = "api-user"
    "PATCH /api/schedules/{id}"  = "api-user"
    "DELETE /api/schedules/{id}" = "api-user"
    "GET /api/executions"        = "api-user"
    "DELETE /api/me"             = "api-user"
  }
}

# Logs hold only ids and statuses; AWS-managed encryption is enough.
# nosemgrep: terraform.aws.security.aws-cloudwatch-log-group-unencrypted.aws-cloudwatch-log-group-unencrypted
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.worker_name}"
  retention_in_days = 30
}

resource "aws_iam_role" "worker" {
  name = local.worker_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "worker" {
  name = local.worker_name
  role = aws_iam_role.worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.worker.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = [var.main_table_arn, "${var.main_table_arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = var.token_key_arn
        Condition = {
          "ForAnyValue:StringEquals" = {
            "kms:EncryptionContextKeys" = "userId"
          }
        }
      }
    ]
  })
}

resource "aws_lambda_function" "worker" {
  function_name = local.worker_name
  role          = aws_iam_role.worker.arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"
  timeout       = 120
  memory_size   = 256
  s3_bucket     = var.artifacts_bucket
  s3_key        = "${var.artifact_version}/checkin-worker.zip"

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

  depends_on = [aws_cloudwatch_log_group.worker, aws_iam_role_policy.worker]
}

resource "aws_lambda_function_event_invoke_config" "worker" {
  function_name                = aws_lambda_function.worker.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 60
}

resource "aws_scheduler_schedule_group" "this" {
  name = "checkin-${var.env}"
}

resource "aws_iam_role" "scheduler" {
  name = "checkin-${var.env}-scheduler-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "checkin-${var.env}-scheduler-invoke"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.worker.arn
    }]
  })
}

# Logs hold only routes, statuses and error names; AWS-managed encryption is enough.
# nosemgrep: terraform.aws.security.aws-cloudwatch-log-group-unencrypted.aws-cloudwatch-log-group-unencrypted
resource "aws_cloudwatch_log_group" "api" {
  for_each          = local.api_functions
  name              = "/aws/lambda/checkin-${var.env}-${each.key}"
  retention_in_days = 30
}

resource "aws_iam_role" "api" {
  for_each = local.api_functions
  name     = "checkin-${var.env}-${each.key}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api" {
  for_each = local.api_functions
  name     = "checkin-${var.env}-${each.key}"
  role     = aws_iam_role.api[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.api[each.key].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      }
    ], each.value.statements)
  })
}

resource "aws_lambda_function" "api" {
  for_each      = local.api_functions
  function_name = "checkin-${var.env}-${each.key}"
  role          = aws_iam_role.api[each.key].arn
  runtime       = "nodejs24.x"
  handler       = "index.handler"
  timeout       = 15
  memory_size   = 256
  s3_bucket     = var.artifacts_bucket
  s3_key        = "${var.artifact_version}/${each.key}.zip"

  # Holds table names, the KMS key ARN and the origin secret (CloudFront-to-API shared header); acceptable: encrypted at rest by the Lambda default key and never logged.
  # nosemgrep: terraform.aws.security.aws-lambda-environment-unencrypted.aws-lambda-environment-unencrypted
  environment {
    variables = each.value.env
  }

  tracing_config {
    mode = "Active"
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.api]
}

resource "aws_apigatewayv2_api" "this" {
  name          = "checkin-${var.env}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "api" {
  for_each               = toset(values(local.routes))
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "user" {
  api_id                            = aws_apigatewayv2_api.this.id
  name                              = "checkin-${var.env}-authorizer-user"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.api["authorizer-user"].invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.Cookie", "$request.header.X-Origin-Verify"]
  authorizer_result_ttl_in_seconds  = 60
}

resource "aws_apigatewayv2_route" "api" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.api[each.value].id}"
  authorization_type = each.value == "api-user" ? "CUSTOM" : "NONE"
  authorizer_id      = each.value == "api-user" ? aws_apigatewayv2_authorizer.user.id : null
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = 20
    throttling_burst_limit = 40
  }

  dynamic "route_settings" {
    for_each = toset(["POST /api/invites/check", "POST /api/onboarding", "POST /api/auth/login"])
    content {
      route_key              = route_settings.value
      throttling_rate_limit  = 5
      throttling_burst_limit = 10
    }
  }

  depends_on = [aws_apigatewayv2_route.api]
}

resource "aws_lambda_permission" "api" {
  for_each      = aws_apigatewayv2_integration.api
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["authorizer-user"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.user.id}"
}

resource "aws_sns_topic" "alarms" {
  name = "checkin-${var.env}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_log_metric_filter" "checkin_failed" {
  name           = "checkin-${var.env}-checkin-failed"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.message = \"checkin\" && $.status = \"failed\" }"

  metric_transformation {
    name          = "CheckinFailed"
    namespace     = "Checkin/${var.env}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "login_failed" {
  name           = "checkin-${var.env}-login-failed"
  log_group_name = aws_cloudwatch_log_group.api["api-public"].name
  pattern        = "{ $.message = \"request\" && $.route = \"/api/auth/login\" && $.status = 401 }"

  metric_transformation {
    name          = "LoginFailed"
    namespace     = "Checkin/${var.env}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "checkin-${var.env}-worker-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.worker.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "checkin_failed" {
  alarm_name          = "checkin-${var.env}-checkin-failed"
  namespace           = "Checkin/${var.env}"
  metric_name         = "CheckinFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.checkin_failed]
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "checkin-${var.env}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.this.id, Stage = "$default" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  for_each            = local.api_functions
  alarm_name          = "checkin-${var.env}-${each.key}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.api[each.key].function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "login_failed" {
  alarm_name          = "checkin-${var.env}-login-failed"
  namespace           = "Checkin/${var.env}"
  metric_name         = "LoginFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.login_failed]
}
