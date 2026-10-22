output "artifacts_bucket" {
  value = aws_s3_bucket.artifacts.bucket
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "hcp_dev_role_arn" {
  value = aws_iam_role.hcp_dev.arn
}

output "hcp_prod_role_arn" {
  value = aws_iam_role.hcp_prod.arn
}
