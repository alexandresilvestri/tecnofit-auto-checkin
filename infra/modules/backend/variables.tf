variable "env" {
  type = string
}

variable "artifacts_bucket" {
  type = string
}

variable "artifact_version" {
  type = string
}

variable "main_table_name" {
  type = string
}

variable "main_table_arn" {
  type = string
}

variable "token_key_arn" {
  type = string
}

variable "audit_table_name" {
  type = string
}

variable "audit_table_arn" {
  type = string
}

variable "alarm_email" {
  type = string
}
