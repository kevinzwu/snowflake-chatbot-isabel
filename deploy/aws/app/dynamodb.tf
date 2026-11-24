# DynamoDB Tables for Chat History and Saved Queries

# Conversations Table - stores chat history per user
resource "aws_dynamodb_table" "conversations" {
  name         = "${local.name}-conversations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "conversationId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "conversationId"
    type = "S"
  }

  attribute {
    name = "updatedAt"
    type = "N"
  }

  attribute {
    name = "shareToken"
    type = "S"
  }

  # GSI for listing conversations sorted by updatedAt
  global_secondary_index {
    name            = "userId-updatedAt-index"
    hash_key        = "userId"
    range_key       = "updatedAt"
    projection_type = "ALL"
  }

  # Sparse GSI for cross-user share token lookup
  global_secondary_index {
    name            = "shareToken-index"
    hash_key        = "shareToken"
    projection_type = "ALL"
  }

  # TTL for auto-cleanup of non-archived conversations
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  # Explicit encryption-at-rest for audit compliance
  # Uses AWS-managed key (DEFAULT); switch to aws_kms_key for CMK if required
  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${local.name}-conversations"
  }
}

# Saved Queries Table - stores user-bookmarked queries
resource "aws_dynamodb_table" "saved_queries" {
  name         = "${local.name}-saved-queries"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "queryId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "queryId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  # Explicit encryption-at-rest for audit compliance
  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${local.name}-saved-queries"
  }
}

# User Profiles Table - stores user prompt profiles/harnesses
resource "aws_dynamodb_table" "user_profiles" {
  name         = "${local.name}-user-profiles"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "profileId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "profileId"
    type = "S"
  }

  attribute {
    name = "shareToken"
    type = "S"
  }

  # Sparse GSI for link-based profile sharing
  global_secondary_index {
    name            = "shareToken-index"
    hash_key        = "shareToken"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name = "${local.name}-user-profiles"
  }
}

# IAM Policy for DynamoDB access
resource "aws_iam_role_policy" "dynamodb_access" {
  name = "DynamoDBAccess"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem"
        ]
        Resource = [
          aws_dynamodb_table.conversations.arn,
          "${aws_dynamodb_table.conversations.arn}/index/*",
          aws_dynamodb_table.saved_queries.arn,
          aws_dynamodb_table.user_profiles.arn,
          "${aws_dynamodb_table.user_profiles.arn}/index/*"
        ]
      }
    ]
  })
}
