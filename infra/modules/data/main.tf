# SSE uses the AWS-managed key; the only secret (Tecnofit JWT) is already encrypted with its own CMK.
# nosemgrep: terraform.aws.security.aws-dynamodb-table-unencrypted.aws-dynamodb-table-unencrypted
resource "aws_dynamodb_table" "main" {
  name         = "checkin-${var.env}-main"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

# The audit table holds no secrets; AWS-managed SSE is enough.
# nosemgrep: terraform.aws.security.aws-dynamodb-table-unencrypted.aws-dynamodb-table-unencrypted
resource "aws_dynamodb_table" "audit" {
  name         = "checkin-${var.env}-audit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  deletion_protection_enabled = true

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_root = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
  role_arn     = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/checkin-${var.env}"
}

resource "aws_kms_key" "token" {
  description         = "checkin-${var.env} tecnofit token encryption"
  enable_key_rotation = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountRoot"
        Effect    = "Allow"
        Principal = { AWS = local.account_root }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "TokenUseOnlyByApp"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
        Resource  = "*"
        Condition = {
          StringNotLike = {
            "aws:PrincipalArn" = concat(
              ["${local.role_arn}-checkin-worker", "${local.role_arn}-api-public", "${local.role_arn}-api-user"],
              var.operator_arns,
            )
          }
        }
      },
      {
        Sid       = "KeyAdminOnlyByOwners"
        Effect    = "Deny"
        Principal = "*"
        Action = [
          "kms:PutKeyPolicy",
          "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion",
          "kms:DisableKey",
          "kms:DisableKeyRotation",
          "kms:CreateGrant",
          "kms:TagResource",
          "kms:UntagResource",
        ]
        Resource = "*"
        Condition = {
          StringNotLike = {
            "aws:PrincipalArn" = concat(
              ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/checkin-hcp-terraform-${var.env}", local.account_root],
              var.operator_arns,
            )
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "token" {
  name          = "alias/checkin-${var.env}-token"
  target_key_id = aws_kms_key.token.key_id
}
