# S3 bucket for conversation message overflow.
#
# Conversations whose serialized messages exceed 350KB are written to this
# bucket by the app (lib/dynamodb/conversation-storage.ts) instead of being
# stored inline in DynamoDB (which has a 400KB item limit). The DynamoDB item
# retains only a `messageRef` pointer plus a truncated `searchText` index.
#
# Without this bucket + the CONVERSATION_S3_BUCKET env var (see ecs.tf), large
# conversations fail to save with a 500 error.

resource "aws_s3_bucket" "conversations" {
  bucket = "${local.name}-conversations"

  # Deliberate design trade-offs for this ephemeral, private overflow store:
  #   - Versioning off: objects carry user message content and are expired by
  #     lifecycle rules (90/180d) to honor the same retention/TTL guarantees as
  #     the DynamoDB records; retaining noncurrent versions would defeat that.
  #   - No cross-region replication / event notifications: single-region,
  #     regenerable-on-overflow data; matches the existing bucket conventions.
  #checkov:skip=CKV_AWS_21:Versioning intentionally disabled to honor conversation retention/TTL
  #checkov:skip=CKV_AWS_144:Cross-region replication not required for regenerable, TTL-expiring overflow data
  #checkov:skip=CKV2_AWS_62:Event notifications not required; cleanup handled via lifecycle + DynamoDB Streams (task 2.4)
  #checkov:skip=CKV_AWS_18:Server access logging out of scope; access is audited via the app + CloudTrail data events

  tags = {
    Name    = "${local.name}-conversations"
    Purpose = "Conversation message overflow storage"
  }
}

# Enforce TLS-only access to private conversation data (mirrors the lb_logs
# bucket's DenyInsecureConnections statement).
data "aws_iam_policy_document" "conversations_bucket_policy" {
  statement {
    sid    = "DenyInsecureConnections"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.conversations.arn,
      "${aws_s3_bucket.conversations.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "conversations" {
  bucket = aws_s3_bucket.conversations.id
  policy = data.aws_iam_policy_document.conversations_bucket_policy.json

  depends_on = [aws_s3_bucket_public_access_block.conversations]
}

# Block all public access — conversation data is private user content.
resource "aws_s3_bucket_public_access_block" "conversations" {
  bucket = aws_s3_bucket.conversations.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Server-side encryption using the AWS-managed KMS key (aws/s3).
# The app uploads objects with ServerSideEncryption: "aws:kms", so the bucket
# default must also be aws:kms to stay consistent. Bucket keys reduce KMS cost.
resource "aws_s3_bucket_server_side_encryption_configuration" "conversations" {
  bucket = aws_s3_bucket.conversations.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

# Lifecycle expiration mirrors the DynamoDB TTL policy:
#   - default (non-archived) conversations: 90 days
#   - archived conversations:              180 days
# The app tags objects with retention=default|archived on write and updates the
# tag on archive/unarchive (updateMessageLifecycleTag).
resource "aws_s3_bucket_lifecycle_configuration" "conversations" {
  bucket = aws_s3_bucket.conversations.id

  rule {
    id     = "expire-default"
    status = "Enabled"

    filter {
      tag {
        key   = "retention"
        value = "default"
      }
    }

    expiration {
      days = 90
    }
  }

  rule {
    id     = "expire-archived"
    status = "Enabled"

    filter {
      tag {
        key   = "retention"
        value = "archived"
      }
    }

    expiration {
      days = 180
    }
  }

  # Clean up incomplete multipart uploads to avoid silent storage cost.
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ECS task-role access to the conversations bucket.
# Scoped to exactly the actions the app performs:
#   - PutObject        (storeMessagesInS3)
#   - GetObject        (loadMessagesFromS3)
#   - PutObjectTagging (updateMessageLifecycleTag, archive/unarchive)
# DeleteObject is intentionally excluded — deletion is handled out-of-band by
# the cleanup Lambda (see openspec task 2.4), not the app task role.
resource "aws_iam_role_policy" "s3_conversations_access" {
  name = "S3ConversationsAccess"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConversationObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:PutObjectTagging"
        ]
        Resource = "${aws_s3_bucket.conversations.arn}/*"
      },
      {
        # Required for SSE-KMS uploads/downloads using the AWS-managed aws/s3 key.
        # Restricted to S3 usage in this region via the kms:ViaService condition.
        Sid    = "ConversationKmsAccess"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "s3.${data.aws_region.current.region}.amazonaws.com"
          }
        }
      }
    ]
  })
}
