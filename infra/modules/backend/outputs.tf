output "checkin_worker_arn" {
  value = aws_lambda_function.worker.arn
}

output "scheduler_role_arn" {
  value = aws_iam_role.scheduler.arn
}

output "schedule_group_name" {
  value = aws_scheduler_schedule_group.this.name
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_execution_arn" {
  value = aws_apigatewayv2_api.this.execution_arn
}

output "api_admin_arn" {
  value = aws_lambda_function.api["api-admin"].arn
}

output "api_admin_invoke_arn" {
  value = aws_lambda_function.api["api-admin"].invoke_arn
}

output "origin_secret" {
  value     = random_password.origin.result
  sensitive = true
}
