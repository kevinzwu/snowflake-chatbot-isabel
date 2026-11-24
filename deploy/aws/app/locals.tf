locals {
  name = "${var.name}-${var.environment}"

  create_vpc = var.vpc_id == null
  vpc_id     = local.create_vpc ? aws_vpc.main[0].id : var.vpc_id

  public_subnet_ids  = local.create_vpc ? aws_subnet.public[*].id : var.public_subnet_ids
  private_subnet_ids = local.create_vpc ? aws_subnet.public[*].id : var.private_subnet_ids

  assign_public_ip = coalesce(var.assign_public_ip, local.create_vpc)

  use_domain = var.domain_name != null
  image_tag  = coalesce(var.image_tag, var.environment)

  # What users type into the browser, and what NextAuth must redirect back to.
  app_url = local.use_domain ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"

  secrets_prefix = "${var.name}/${var.environment}"

  lb_logs_bucket_name = "${local.name}-lb-logs-${data.aws_caller_identity.current.account_id}"
}

check "network_inputs" {
  assert {
    condition     = local.create_vpc || (var.public_subnet_ids != null && var.private_subnet_ids != null)
    error_message = "When vpc_id is set, public_subnet_ids and private_subnet_ids are required."
  }
}
