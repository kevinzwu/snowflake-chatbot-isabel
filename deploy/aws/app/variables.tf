# ── Identity ──────────────────────────────────────────────────────────────

variable "name" {
  description = "Resource name prefix. Resources are named <name>-<environment>; secrets live under <name>/<environment>/."
  type        = string
  default     = "isabel"
}

variable "environment" {
  description = "Environment name (for example staging or production)."
  type        = string
  default     = "staging"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.environment))
    error_message = "environment must be 2-16 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "region" {
  description = "AWS region to deploy to."
  type        = string
}

# ── Network ───────────────────────────────────────────────────────────────

variable "vpc_id" {
  description = "Existing VPC to deploy into. null creates a new VPC."
  type        = string
  default     = null
}

variable "public_subnet_ids" {
  description = "Subnets for the load balancer when vpc_id is set. Ignored when the VPC is created."
  type        = list(string)
  default     = null
}

variable "private_subnet_ids" {
  description = "Subnets for the ECS tasks when vpc_id is set. Ignored when the VPC is created."
  type        = list(string)
  default     = null
}

variable "vpc_cidr" {
  description = "CIDR of the VPC that is created when vpc_id is null."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones (and subnets) to use when the VPC is created."
  type        = number
  default     = 2
}

variable "assign_public_ip" {
  description = "Give ECS tasks a public IP so they can reach ECR, Snowflake and Azure AD without a NAT gateway. null means true for a created VPC and false for an existing one."
  type        = bool
  default     = null
}

variable "internal" {
  description = "Make the load balancer internal (reachable only from inside the VPC)."
  type        = bool
  default     = false
}

variable "allowed_ingress_cidrs" {
  description = "CIDR blocks allowed to reach the load balancer."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ── Domain and TLS ────────────────────────────────────────────────────────

variable "domain_name" {
  description = "Public hostname for the app, for example isabel.example.com. null serves plain HTTP on the load balancer DNS name (demo only)."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone that contains domain_name. Required when domain_name is set; used for the ACM validation records and the alias record."
  type        = string
  default     = null

  validation {
    condition     = var.domain_name == null || var.route53_zone_id != null
    error_message = "route53_zone_id is required when domain_name is set."
  }
}

# ── IAM ───────────────────────────────────────────────────────────────────

variable "permissions_boundary_arn" {
  description = "Permissions boundary policy ARN for the IAM roles. null attaches none."
  type        = string
  default     = null
}

variable "iam_role_path" {
  description = "Path for the IAM roles."
  type        = string
  default     = "/"
}

# ── Secrets ───────────────────────────────────────────────────────────────

variable "secret_recovery_window_days" {
  description = "Recovery window when a secret is deleted. 0 deletes immediately (useful for throwaway demos)."
  type        = number
  default     = 7
}

# ── Compute ───────────────────────────────────────────────────────────────

variable "image_tag" {
  description = "Image tag to run. null uses the environment name, which is what bin/deploy.sh pushes."
  type        = string
  default     = null
}

variable "task_count" {
  type    = number
  default = 1
}

variable "task_cpu" {
  type    = number
  default = 1024
}

variable "task_memory" {
  type    = number
  default = 2048
}

variable "task_storage" {
  description = "Ephemeral storage per task, in GiB."
  type        = number
  default     = 30
}

variable "container_cpu" {
  type    = number
  default = 512
}

variable "container_memory" {
  type    = number
  default = 1024
}

variable "container_memory_soft_limit" {
  type    = number
  default = 512
}

variable "enable_execute_command" {
  description = "Allow `aws ecs execute-command` into running tasks."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ── Load balancer ─────────────────────────────────────────────────────────

variable "alb_idle_timeout" {
  description = "Seconds. Long, because agent responses stream."
  type        = number
  default     = 300
}

variable "alb_health_check_path" {
  type    = string
  default = "/api/health"
}

variable "enable_lb_access_logs" {
  description = "Create a bucket and write load balancer access logs to it."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Protect the load balancer from deletion."
  type        = bool
  default     = false
}
