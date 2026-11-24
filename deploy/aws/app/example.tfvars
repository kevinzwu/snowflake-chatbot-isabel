# Copy to <environment>.tfvars (gitignored) and edit.
#   terraform plan -var-file=staging.tfvars
# Everything below except `region` is optional; the values shown are the defaults
# unless a comment says otherwise.

region      = "us-east-1"
name        = "isabel"
environment = "staging"

# ── Domain (optional) ─────────────────────────────────────────────────────
# Unset: the load balancer serves plain HTTP on its own DNS name. Demo only.
# Set both to get a DNS-validated ACM certificate, HTTPS and an alias record.
# domain_name     = "isabel.example.com"
# route53_zone_id = "Z0123456789ABCDEFGHIJ"

# ── Network (optional) ────────────────────────────────────────────────────
# Unset: a VPC is created. Set all three to use an existing one.
# vpc_id             = "vpc-0123456789abcdef0"
# public_subnet_ids  = ["subnet-aaaa", "subnet-bbbb"]   # load balancer
# private_subnet_ids = ["subnet-cccc", "subnet-dddd"]   # ECS tasks
# internal           = false                            # true: reachable only inside the VPC
# allowed_ingress_cidrs = ["203.0.113.0/24"]            # default is open to the internet

# ── IAM (optional) ────────────────────────────────────────────────────────
# permissions_boundary_arn = "arn:aws:iam::123456789012:policy/YourBoundary"
# iam_role_path            = "/"

# ── Sizing ────────────────────────────────────────────────────────────────
# task_count  = 1
# task_cpu    = 1024
# task_memory = 2048

# ── Cleanup ───────────────────────────────────────────────────────────────
# secret_recovery_window_days = 0   # delete secrets immediately on destroy
# deletion_protection         = true
