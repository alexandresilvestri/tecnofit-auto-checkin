output "checkin_worker_arn" {
  value = module.backend.checkin_worker_arn
}

output "scheduler_role_arn" {
  value = module.backend.scheduler_role_arn
}

output "schedule_group_name" {
  value = module.backend.schedule_group_name
}

output "main_table_name" {
  value = module.data.main_table_name
}

output "main_table_arn" {
  value = module.data.main_table_arn
}

output "audit_table_name" {
  value = module.data.audit_table_name
}

output "audit_table_arn" {
  value = module.data.audit_table_arn
}

output "token_key_arn" {
  value = module.data.token_key_arn
}

output "web_bucket" {
  value = module.frontend.web_bucket
}

output "distribution_id" {
  value = module.frontend.distribution_id
}

output "web_url" {
  value = module.frontend.web_url
}
