output "checkin_worker_arn" {
  value = aws_lambda_function.worker.arn
}

output "scheduler_role_arn" {
  value = aws_iam_role.scheduler.arn
}

output "schedule_group_name" {
  value = aws_scheduler_schedule_group.this.name
}
