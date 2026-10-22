variable "env" {
  type = string
}

variable "api_endpoint" {
  type = string
}

variable "auth_domain_prefix" {
  type = string
}

variable "origin_secret" {
  type      = string
  sensitive = true
}
