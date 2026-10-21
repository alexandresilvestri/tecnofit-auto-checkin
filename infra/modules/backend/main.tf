locals {
  worker_name = "checkin-${var.env}-checkin-worker"
}

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

  environment {
    variables = {
      TABLE_MAIN = var.main_table_name
    }
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
