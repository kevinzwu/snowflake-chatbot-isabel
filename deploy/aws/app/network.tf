# VPC, subnets and security groups. The VPC is created only when vpc_id is null.
# Created subnets are all public and tasks get public IPs, which avoids a NAT
# gateway (about $32 a month). Tasks are still reachable only from the load
# balancer security group. Bring your own VPC with private subnets and NAT
# if you want tasks off the internet.

resource "aws_vpc" "main" {
  count = local.create_vpc ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = local.name }
}

# Lock down the VPC default security group: nothing should use it.
resource "aws_default_security_group" "default" {
  count = local.create_vpc ? 1 : 0

  vpc_id = aws_vpc.main[0].id
  tags   = { Name = "${local.name}-default-unused" }
}

resource "aws_internet_gateway" "main" {
  count = local.create_vpc ? 1 : 0

  vpc_id = aws_vpc.main[0].id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = local.create_vpc ? var.az_count : 0

  vpc_id                  = aws_vpc.main[0].id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  count = local.create_vpc ? 1 : 0

  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = local.create_vpc ? var.az_count : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  description = "Isabel load balancer"
  vpc_id      = local.vpc_id

  tags = { Name = "${local.name}-alb" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = toset(var.allowed_ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = "HTTP from allowed CIDRs"
  cidr_ipv4         = each.value
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each = local.use_domain ? toset(var.allowed_ingress_cidrs) : toset([])

  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from allowed CIDRs"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the app tasks"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "app" {
  name_prefix = "${local.name}-app-"
  description = "Isabel ECS tasks"
  vpc_id      = local.vpc_id

  tags = { Name = "${local.name}-app" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "From the load balancer"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
}

# Tasks call ECR, Secrets Manager, DynamoDB, S3, Snowflake and Azure AD.
resource "aws_vpc_security_group_egress_rule" "app_out" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
