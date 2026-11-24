#!/bin/bash
set -e

# Public hostname of the deployment (staging is staging.$APP_DOMAIN)
APP_DOMAIN="${APP_DOMAIN:-isabel.example.com}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
ENVIRONMENT="${1:-staging}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(staging|production)$ ]]; then
    echo -e "${RED}Error: Invalid environment. Use: staging or production${NC}"
    echo "Usage: bin/deploy.sh [environment]"
    echo "Example: bin/deploy.sh staging"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    Isabel - Complete Deployment    ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo ""
echo -e "${GREEN}Environment: ${ENVIRONMENT}${NC}"
echo -e "${GREEN}Timestamp: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

# Generate version tag
VERSION=$(date +%Y%m%d-%H%M%S)

# Step 0: Verify every secret and app-config key exists for this environment
if ! AWS_PROFILE="${AWS_PROFILE:-default}" ./bin/secrets.sh check "$ENVIRONMENT"; then
    echo -e "${RED}✗ Secrets check failed — fix with bin/secrets.sh set $ENVIRONMENT <name>${NC}"
    exit 1
fi

# Step 1: Deploy Cortex Agent
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1/3: Deploying Cortex Agent${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if ./bin/deploy-agent.sh "$ENVIRONMENT"; then
    echo ""
    echo -e "${GREEN}✓ Cortex Agent deployment completed successfully${NC}"
else
    echo -e "${RED}✗ Cortex Agent deployment failed — aborting before Docker build${NC}"
    exit 1
fi

# Step 2: Apply Terraform Infrastructure
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2/4: Terraform Infrastructure${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TF_DIR="deploy/aws/app"

if [ ! -f "$TF_DIR/backend.hcl" ] || [ ! -f "$TF_DIR/${ENVIRONMENT}.tfvars" ]; then
    echo -e "${YELLOW}⚠ Skipping Terraform: $TF_DIR/backend.hcl or $TF_DIR/${ENVIRONMENT}.tfvars is missing${NC}"
    echo -e "${YELLOW}  Copy backend.hcl.example and example.tfvars (see deploy/aws/README.md)${NC}"
else
    (
      cd "$TF_DIR"
      terraform init -reconfigure -backend-config=backend.hcl -input=false
      terraform plan -var-file="${ENVIRONMENT}.tfvars" -out="tfplan.${ENVIRONMENT}"
    )
    read -r -p "Apply this plan? [y/N] " CONFIRM
    if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
        (cd "$TF_DIR" && terraform apply "tfplan.${ENVIRONMENT}")
        echo -e "${GREEN}✓ Terraform apply completed successfully${NC}"
    else
        echo -e "${YELLOW}⚠ Terraform apply skipped — continuing with deploy${NC}"
    fi
fi

# Step 3: Build and Push Docker Image
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3/4: Building and Pushing Docker Image${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if ./bin/docker-build.sh "$ENVIRONMENT" "$VERSION"; then
    echo ""
    echo -e "${GREEN}✓ Docker build and push completed successfully${NC}"
else
    echo -e "${RED}✗ Docker build failed${NC}"
    exit 1
fi

# Wait a moment for ECR to process
echo ""
echo -e "${YELLOW}Waiting 5 seconds for ECR to process...${NC}"
sleep 5

# Step 4: Deploy to ECS
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 4/4: Deploying to ECS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if ./bin/deploy-ecs.sh "$ENVIRONMENT"; then
    echo ""
    echo -e "${GREEN}✓ ECS deployment completed successfully${NC}"
else
    echo -e "${RED}✗ ECS deployment failed${NC}"
    exit 1
fi

# Summary
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Deployment Summary               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Environment:${NC} $ENVIRONMENT"
echo -e "${GREEN}Version:${NC} $VERSION"
echo -e "${GREEN}Image:${NC} ${AWS_ACCOUNT_ID:-<account-id>}.dkr.ecr.${AWS_REGION:-<region>}.amazonaws.com/isabel:$ENVIRONMENT"
echo ""

# Environment-specific URLs
case $ENVIRONMENT in
    production)
        echo -e "${GREEN}Application URL:${NC} https://${APP_DOMAIN}"
        echo -e "${GREEN}AWS Console:${NC} https://console.aws.amazon.com/ecs/home?region=${AWS_REGION:-<region>}#/clusters/isabel-production/services/isabel-production-app/deployments"
        ;;
    staging)
        echo -e "${GREEN}Application URL:${NC} https://staging.${APP_DOMAIN}"
        echo -e "${GREEN}AWS Console:${NC} https://console.aws.amazon.com/ecs/home?region=${AWS_REGION:-<region>}#/clusters/isabel-staging/services/isabel-staging-app/deployments"
        ;;
    qa)
        echo -e "${GREEN}Application URL:${NC} https://qa.${APP_DOMAIN}"
        echo -e "${GREEN}AWS Console:${NC} https://console.aws.amazon.com/ecs/home?region=${AWS_REGION:-<region>}#/clusters/isabel-qa/services/isabel-qa-app/deployments"
        ;;
esac

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Monitor the deployment in AWS Console (link above)"
echo "2. Test the application at the URL above"
echo "3. Check CloudWatch logs if issues occur:"
echo "   aws logs tail /ecs/isabel-$ENVIRONMENT --follow --profile ${AWS_PROFILE:-default}"
echo ""
