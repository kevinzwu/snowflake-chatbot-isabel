resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}

locals {
  container_definitions = templatefile("${path.module}/templates/containers.json.tpl", {
    log_group                   = local.name
    aws_region                  = data.aws_region.current.region
    environment                 = var.environment
    image_uri                   = "${aws_ecr_repository.app.repository_url}:${local.image_tag}"
    container_cpu               = var.container_cpu
    container_memory            = var.container_memory
    container_memory_soft_limit = var.container_memory_soft_limit
    app_url                     = local.app_url
    conversation_s3_bucket      = aws_s3_bucket.conversations.id
    secret_arns                 = { for key, secret in aws_secretsmanager_secret.app : key => secret.arn }
  })
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-app"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  container_definitions    = local.container_definitions

  ephemeral_storage {
    size_in_gib = var.task_storage
  }
}

resource "aws_ecs_service" "app" {
  name                   = "${local.name}-app"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.app.arn
  desired_count          = var.task_count
  launch_type            = "FARGATE"
  enable_execute_command = var.enable_execute_command

  # Time ECS waits before it counts ALB health checks: Next.js start-up plus the
  # first Snowflake connection. Too short and healthy tasks get restarted.
  health_check_grace_period_seconds = 120

  network_configuration {
    security_groups  = [aws_security_group.app.id]
    subnets          = local.private_subnet_ids
    assign_public_ip = local.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.id
    container_name   = "nextjs"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_lb_listener.http,
    aws_lb_listener.https,
    aws_iam_role_policy.ecs_execution,
  ]
}
