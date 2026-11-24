data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: used by ECS itself to pull the image, write logs and inject secrets.
resource "aws_iam_role" "ecs_execution" {
  name                 = "${local.name}-exec"
  path                 = var.iam_role_path
  assume_role_policy   = data.aws_iam_policy_document.ecs_assume_role.json
  permissions_boundary = var.permissions_boundary_arn
}

data "aws_iam_policy_document" "ecs_execution" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
  }

  statement {
    sid       = "ReadSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for secret in aws_secretsmanager_secret.app : secret.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution" {
  name   = "ExecPolicy"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution.json
}

# Task role: used by the running app. DynamoDB and S3 access are attached in
# dynamodb.tf and conversations-bucket.tf.
resource "aws_iam_role" "ecs_task" {
  name                 = "${local.name}-task"
  path                 = var.iam_role_path
  assume_role_policy   = data.aws_iam_policy_document.ecs_assume_role.json
  permissions_boundary = var.permissions_boundary_arn
}

data "aws_iam_policy_document" "ecs_exec_channel" {
  statement {
    sid = "EcsExecChannel"
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_exec_channel" {
  count = var.enable_execute_command ? 1 : 0

  name   = "EcsExecChannel"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_exec_channel.json
}
