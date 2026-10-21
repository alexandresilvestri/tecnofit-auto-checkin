terraform {
  required_version = "= 1.15.9"

  cloud {
    workspaces {
      name = "checkin-dev"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.69.1"
    }
  }
}

provider "aws" {
  region = "sa-east-1"

  default_tags {
    tags = {
      Project = "checkin"
      Env     = "dev"
    }
  }
}

data "aws_caller_identity" "current" {}

module "backend" {
  source           = "../../modules/backend"
  env              = "dev"
  artifacts_bucket = "checkin-artifacts-${data.aws_caller_identity.current.account_id}"
  artifact_version = var.artifact_version
  main_table_name  = module.data.main_table_name
  main_table_arn   = module.data.main_table_arn
  token_key_arn    = module.data.token_key_arn
}

module "data" {
  source = "../../modules/data"
  env    = "dev"
}
