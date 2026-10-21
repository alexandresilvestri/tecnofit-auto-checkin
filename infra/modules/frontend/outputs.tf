output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}
