output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "domain_url" {
  value = "https://${var.domain_prefix}.auth.us-east-1.amazoncognito.com"
}
