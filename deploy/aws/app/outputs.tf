output "app_url" {
  description = "Where users open the app. Set this as NEXTAUTH_URL's host and as the Azure AD redirect URI base."
  value       = local.app_url
}

output "azure_ad_redirect_uri" {
  description = "Register this redirect URI on the Azure AD app registration."
  value       = "${local.app_url}/api/auth/callback/azure-ad"
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_zone_id" {
  value = aws_lb.main.zone_id
}

output "ecr_repository_url" {
  description = "Push the image here (bin/deploy.sh does this)."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "cloudwatch_log_group" {
  value = aws_cloudwatch_log_group.ecs.name
}

output "secret_names" {
  description = "Secret containers to fill with bin/secrets.sh. Terraform never sets their values."
  value       = sort([for secret in aws_secretsmanager_secret.app : secret.name])
}

output "dynamodb_conversations_table" {
  value = aws_dynamodb_table.conversations.name
}

output "dynamodb_saved_queries_table" {
  value = aws_dynamodb_table.saved_queries.name
}

output "conversations_s3_bucket" {
  description = "CONVERSATION_S3_BUCKET"
  value       = aws_s3_bucket.conversations.id
}
