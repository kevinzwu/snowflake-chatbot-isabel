terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Partial configuration: bucket, key and region come from
  # `terraform init -backend-config=backend.hcl` (see backend.hcl.example).
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}

# Credentials and profile come from the environment (AWS_PROFILE, AWS_ACCESS_KEY_ID, ...).
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}
