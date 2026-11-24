# Secret containers only. Terraform creates the names; the values are set out
# of band with bin/secrets.sh, so no secret value ever enters Terraform state.
#
#   SECRETS_PREFIX=<name> AWS_REGION=<region> bin/secrets.sh set <environment> <key>
#
# Keep this list in step with CREDENTIAL_SECRETS in bin/secrets.sh.

locals {
  secret_keys = toset([
    "rsa-key",
    "snowflake-rsa-passphrase",
    "snowflake-account",
    "snowflake-user",
    "nextauth-secret",
    "azure-ad-client-id",
    "azure-ad-client-secret",
    "azure-ad-tenant-id",
    "oauth-service-accounts",
    "allowed-azure-ad-groups",
    "admin-azure-ad-groups",
    "app-config",
  ])
}

# Default AWS-managed key: the roles below are granted GetSecretValue and the
# key policy needs no change. Use a customer-managed key if your policy needs one.
resource "aws_secretsmanager_secret" "app" {
  for_each = local.secret_keys

  name                    = "${local.secrets_prefix}/${each.key}"
  description             = "Isabel ${var.environment}: ${each.key}"
  recovery_window_in_days = var.secret_recovery_window_days
}
