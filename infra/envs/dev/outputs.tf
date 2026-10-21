output "checkin_worker_arn" {
  value = module.backend.checkin_worker_arn
}

output "scheduler_role_arn" {
  value = module.backend.scheduler_role_arn
}

output "schedule_group_name" {
  value = module.backend.schedule_group_name
}
