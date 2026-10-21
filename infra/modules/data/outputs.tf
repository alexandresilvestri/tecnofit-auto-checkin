output "main_table_name" {
  value = aws_dynamodb_table.main.name
}

output "main_table_arn" {
  value = aws_dynamodb_table.main.arn
}

output "audit_table_name" {
  value = aws_dynamodb_table.audit.name
}

output "audit_table_arn" {
  value = aws_dynamodb_table.audit.arn
}

output "token_key_arn" {
  value = aws_kms_key.token.arn
}
