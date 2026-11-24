resource "aws_lb" "main" {
  name               = substr(local.name, 0, 28)
  internal           = var.internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.public_subnet_ids
  idle_timeout       = var.alb_idle_timeout

  enable_deletion_protection = var.deletion_protection
  drop_invalid_header_fields = true

  dynamic "access_logs" {
    for_each = var.enable_lb_access_logs ? [1] : []

    content {
      bucket  = aws_s3_bucket.lb_logs[0].id
      prefix  = local.name
      enabled = true
    }
  }

  depends_on = [aws_s3_bucket_policy.lb_logs_policy]

  tags = { Name = local.name }
}

resource "aws_lb_target_group" "app" {
  name                 = "${substr(local.name, 0, 28)}-tg"
  port                 = 3000
  protocol             = "HTTP"
  vpc_id               = local.vpc_id
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 30
    timeout             = 10
    matcher             = "200-399"
    path                = var.alb_health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
  }

  tags = { Name = "${local.name}-tg" }
}

# With a domain: HTTPS on 443 and HTTP redirects to it.
resource "aws_lb_listener" "https" {
  count = local.use_domain ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.app[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = local.use_domain ? [1] : []

    content {
      type = "redirect"

      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  # Without a domain there is no certificate, so the demo serves plain HTTP.
  dynamic "default_action" {
    for_each = local.use_domain ? [] : [1]

    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.app.arn
    }
  }
}
