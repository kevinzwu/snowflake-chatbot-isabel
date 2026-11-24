# S3 bucket for load balancer access logs
resource "aws_s3_bucket" "lb_logs" {
  count  = var.enable_lb_access_logs ? 1 : 0
  bucket = local.lb_logs_bucket_name

  tags = {
    Name    = local.lb_logs_bucket_name
    Purpose = "LoadBalancer Access Logs"
  }
}

# S3 bucket versioning
resource "aws_s3_bucket_versioning" "lb_logs_versioning" {
  count  = var.enable_lb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.lb_logs[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

# S3 bucket server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "lb_logs_encryption" {
  count  = var.enable_lb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.lb_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 bucket public access block
resource "aws_s3_bucket_public_access_block" "lb_logs_pab" {
  count  = var.enable_lb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.lb_logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Data source to get the AWS Elastic Load Balancing Service Account
data "aws_elb_service_account" "lb" {}

# IAM policy document for S3 bucket policy
data "aws_iam_policy_document" "s3_lb_logs_policy" {
  count = var.enable_lb_access_logs ? 1 : 0

  # Allow ELB service account to write logs
  statement {
    sid    = "AllowELBServiceAccount"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.lb.arn]
    }

    actions = [
      "s3:PutObject"
    ]

    resources = [
      "arn:aws:s3:::${local.lb_logs_bucket_name}/*"
    ]
  }

  # Allow ELB to check bucket location
  statement {
    sid    = "AllowELBServiceAccountGetBucketAcl"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.lb.arn]
    }

    actions = [
      "s3:GetBucketAcl"
    ]

    resources = [
      "arn:aws:s3:::${local.lb_logs_bucket_name}"
    ]
  }

  # Deny all other access
  statement {
    sid    = "DenyInsecureConnections"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = [
      "s3:*"
    ]

    resources = [
      "arn:aws:s3:::${local.lb_logs_bucket_name}",
      "arn:aws:s3:::${local.lb_logs_bucket_name}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

# S3 bucket policy
resource "aws_s3_bucket_policy" "lb_logs_policy" {
  count  = var.enable_lb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.lb_logs[0].id
  policy = data.aws_iam_policy_document.s3_lb_logs_policy[0].json

  depends_on = [aws_s3_bucket_public_access_block.lb_logs_pab]
}