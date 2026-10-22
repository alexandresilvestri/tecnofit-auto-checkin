terraform {
  required_version = "= 1.15.9"

  cloud {
    workspaces {
      name = "checkin-bootstrap"
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
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "artifacts" {
  bucket = "checkin-artifacts-${data.aws_caller_identity.current.account_id}-us-east-1"
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-90d"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }
  }
}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "hcp" {
  url            = "https://app.terraform.io"
  client_id_list = ["aws.workload.identity"]
}

resource "aws_iam_role" "github_deploy" {
  name = "checkin-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = ["repo:${var.github_repo}:ref:refs/heads/main", "repo:${var.github_repo}:environment:prod"]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "put-artifacts"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.artifacts.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = [aws_s3_bucket.artifacts.arn, "arn:aws:s3:::checkin-*-web-*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::checkin-*-web-*/*"
      },
      {
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"
      },
    ]
  })
}

resource "aws_iam_role" "hcp_dev" {
  name = "checkin-hcp-terraform-dev"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.hcp.arn }
      Condition = {
        StringEquals = {
          "app.terraform.io:aud" = "aws.workload.identity"
        }
        StringLike = {
          "app.terraform.io:sub" = "organization:${var.hcp_org}:project:${var.hcp_project}:workspace:checkin-dev:run_phase:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "hcp_dev_power_user" {
  role       = aws_iam_role.hcp_dev.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "hcp_dev_iam" {
  name = "checkin-dev-iam"
  role = aws_iam_role.hcp_dev.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      # Terraform must manage the dev roles and their inline policies; scoped to role/checkin-dev-*.
      # nosemgrep: terraform.lang.security.iam.no-iam-priv-esc-funcs.no-iam-priv-esc-funcs, terraform.lang.security.iam.no-iam-resource-exposure.no-iam-resource-exposure
      Action = [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:UpdateRole",
        "iam:DeleteRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:ListInstanceProfilesForRole",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:PassRole"
      ]
      Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/checkin-dev-*"
    }]
  })
}

resource "aws_iam_role_policy" "hcp_dev_deny_prod" {
  name = "checkin-dev-deny-prod"
  role = aws_iam_role.hcp_dev.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DenyProdByName"
        Effect   = "Deny"
        Action   = "*"
        Resource = "arn:aws:*:*:*:*checkin-prod*"
      },
      {
        Sid       = "DenyProdByTag"
        Effect    = "Deny"
        Action    = "*"
        Resource  = "*"
        Condition = { StringEquals = { "aws:ResourceTag/Env" = "prod" } }
      },
      {
        Sid    = "DenyArtifactWrites"
        Effect = "Deny"
        Action = [
          "s3:PutObject*",
          "s3:DeleteObject*",
          "s3:PutBucket*",
          "s3:PutLifecycleConfiguration",
        ]
        Resource = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
      },
    ]
  })
}

resource "aws_iam_role" "hcp_prod" {
  name = "checkin-hcp-terraform-prod"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.hcp.arn }
      Condition = {
        StringEquals = {
          "app.terraform.io:aud" = "aws.workload.identity"
        }
        StringLike = {
          "app.terraform.io:sub" = "organization:${var.hcp_org}:project:${var.hcp_project}:workspace:checkin-prod:run_phase:*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "hcp_prod_power_user" {
  role       = aws_iam_role.hcp_prod.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "hcp_prod_iam" {
  name = "checkin-prod-iam"
  role = aws_iam_role.hcp_prod.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      # Terraform must manage the prod roles and their inline policies; scoped to role/checkin-prod-*.
      # nosemgrep: terraform.lang.security.iam.no-iam-priv-esc-funcs.no-iam-priv-esc-funcs, terraform.lang.security.iam.no-iam-resource-exposure.no-iam-resource-exposure
      Action = [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:UpdateRole",
        "iam:DeleteRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:ListInstanceProfilesForRole",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:PassRole"
      ]
      Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/checkin-prod-*"
    }]
  })
}
