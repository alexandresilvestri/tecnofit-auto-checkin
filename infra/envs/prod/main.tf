terraform {
  required_version = "= 1.15.9"

  cloud {
    workspaces {
      name = "checkin-prod"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.69.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.7.2"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project = "checkin"
      Env     = "prod"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  artifacts_bucket   = "checkin-artifacts-${data.aws_caller_identity.current.account_id}-us-east-1"
  auth_domain_prefix = "checkin-prod-${data.aws_caller_identity.current.account_id}"
}

data "aws_acm_certificate" "web" {
  domain = "*.alexandresilvestri.com.br"
}

module "auth" {
  source               = "../../modules/auth"
  env                  = "prod"
  domain_prefix        = local.auth_domain_prefix
  web_urls             = module.frontend.web_urls
  artifacts_bucket     = local.artifacts_bucket
  artifact_version     = var.artifact_version
  api_id               = module.backend.api_id
  api_execution_arn    = module.backend.api_execution_arn
  api_admin_arn        = module.backend.api_admin_arn
  api_admin_invoke_arn = module.backend.api_admin_invoke_arn
  main_table_name      = module.data.main_table_name
  audit_table_name     = module.data.audit_table_name
  audit_table_arn      = module.data.audit_table_arn
  sentry_dsn           = var.sentry_dsn_api
}

module "backend" {
  source           = "../../modules/backend"
  env              = "prod"
  artifacts_bucket = local.artifacts_bucket
  artifact_version = var.artifact_version
  main_table_name  = module.data.main_table_name
  main_table_arn   = module.data.main_table_arn
  audit_table_name = module.data.audit_table_name
  audit_table_arn  = module.data.audit_table_arn
  token_key_arn    = module.data.token_key_arn
  alarm_email      = "airtontunni@gmail.com"
  sentry_dsn       = var.sentry_dsn_api
}

module "data" {
  source        = "../../modules/data"
  env           = "prod"
  operator_arns = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/alexandresilvestri"]
}

module "frontend" {
  source             = "../../modules/frontend"
  env                = "prod"
  api_endpoint       = module.backend.api_endpoint
  auth_domain_prefix = local.auth_domain_prefix
  origin_secret      = module.backend.origin_secret
  domain             = "checkin.alexandresilvestri.com.br"
  certificate_arn    = data.aws_acm_certificate.web.arn
  sentry_dsn         = var.sentry_dsn_web
}
