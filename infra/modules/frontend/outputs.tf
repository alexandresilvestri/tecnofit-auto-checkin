output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_urls" {
  value = [for host in concat([aws_cloudfront_distribution.web.domain_name], tolist(aws_cloudfront_distribution.web.aliases)) : "https://${host}"]
}
