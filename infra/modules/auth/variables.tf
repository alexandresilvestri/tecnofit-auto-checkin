variable "env" {
  type = string
}

variable "domain_prefix" {
  type = string
}

variable "web_urls" {
  type = list(string)
}

variable "artifacts_bucket" {
  type = string
}

variable "artifact_version" {
  type = string
}

variable "api_id" {
  type = string
}

variable "api_execution_arn" {
  type = string
}

variable "api_admin_arn" {
  type = string
}

variable "api_admin_invoke_arn" {
  type = string
}

variable "main_table_name" {
  type = string
}

variable "audit_table_name" {
  type = string
}

variable "audit_table_arn" {
  type = string
}
