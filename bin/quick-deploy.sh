#!/bin/bash
# Quick Docker Build & Deploy Script for Isabel
# This is a convenience wrapper around the docker-build.sh and deploy-ecs.sh scripts

set -e

# Public hostname of the deployment (staging is staging.$APP_DOMAIN)
APP_DOMAIN="${APP_DOMAIN:-isabel.example.com}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default values
ENVIRONMENT="${1:-staging}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_DEPLOY="${SKIP_DEPLOY:-false}"

# Help text
show_help() {
    echo -e "${BLUE}Isabel - Quick Build & Deploy${NC}"
    echo ""
    echo "Usage: $0 [environment] [options]"
    echo ""
    echo "Environments:"
    echo "  staging     Deploy to staging (default)"
    echo "  production  Deploy to production"
    echo "  qa          Deploy to QA"
    echo ""
    echo "Options (set as environment variables):"
    echo "  SKIP_BUILD=true   Skip Docker build, only deploy"
    echo "  SKIP_DEPLOY=true  Only build Docker image, skip deploy"
    echo ""
    echo "Examples:"
    echo "  $0                          # Build and deploy to staging"
    echo "  $0 production               # Build and deploy to production"
    echo "  SKIP_BUILD=true $0 staging  # Skip build, deploy staging"
    echo "  SKIP_DEPLOY=true $0 staging # Build only, no deploy"
    echo ""
}

if [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
    show_help
    exit 0
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(qa|staging|production)$ ]]; then
    echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'${NC}"
    show_help
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Isabel - Quick Deploy Script     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Environment:${NC} $ENVIRONMENT"
echo -e "${GREEN}Skip Build:${NC}  $SKIP_BUILD"
echo -e "${GREEN}Skip Deploy:${NC} $SKIP_DEPLOY"
echo ""

# Pre-flight checks
if [ "$SKIP_DEPLOY" != "true" ] && ! AWS_PROFILE="${AWS_PROFILE:-default}" ./bin/secrets.sh check "$ENVIRONMENT"; then
    echo -e "${RED}Error: secrets check failed for $ENVIRONMENT${NC}"
    exit 1
fi
echo -e "${YELLOW}Running pre-flight checks...${NC}"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from project root directory${NC}"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null && [ "$SKIP_BUILD" != "true" ]; then
    echo -e "${RED}Error: Docker is not installed or not in PATH${NC}"
    exit 1
fi

# Check AWS CLI
if ! command -v aws &> /dev/null && [ "$SKIP_DEPLOY" != "true" ]; then
    echo -e "${RED}Error: AWS CLI is not installed or not in PATH${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Pre-flight checks passed${NC}"
echo ""

# Build Docker image
if [ "$SKIP_BUILD" != "true" ]; then
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}Step 1: Building Docker Image${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo ""
    
    if ./bin/docker-build.sh "$ENVIRONMENT"; then
        echo ""
        echo -e "${GREEN}✓ Docker build completed successfully${NC}"
        echo ""
    else
        echo ""
        echo -e "${RED}✗ Docker build failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Skipping Docker build (SKIP_BUILD=true)${NC}"
    echo ""
fi

# Deploy to ECS
if [ "$SKIP_DEPLOY" != "true" ]; then
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}Step 2: Deploying to ECS${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo ""
    
    if ./bin/deploy-ecs.sh "$ENVIRONMENT"; then
        echo ""
        echo -e "${GREEN}✓ ECS deployment completed successfully${NC}"
        echo ""
    else
        echo ""
        echo -e "${RED}✗ ECS deployment failed${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Skipping ECS deployment (SKIP_DEPLOY=true)${NC}"
    echo ""
fi

# Success summary
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Deployment Complete! 🎉       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Show next steps
echo -e "${GREEN}Next Steps:${NC}"
echo ""

if [ "$ENVIRONMENT" = "staging" ]; then
    APP_URL="https://staging.${APP_DOMAIN}"
elif [ "$ENVIRONMENT" = "production" ]; then
    APP_URL="https://${APP_DOMAIN}"
else
    APP_URL="https://qa.${APP_DOMAIN}"
fi

echo -e "1. Wait 2-3 minutes for deployment to stabilize"
echo -e "2. Check application: ${BLUE}$APP_URL${NC}"
echo -e "3. Monitor logs:"
echo -e "   ${YELLOW}aws logs tail /ecs/isabel-$ENVIRONMENT --follow --profile ${AWS_PROFILE:-default}${NC}"
echo ""
echo -e "4. Check service status:"
echo -e "   ${YELLOW}aws ecs describe-services \\${NC}"
echo -e "   ${YELLOW}  --cluster isabel-$ENVIRONMENT \\${NC}"
echo -e "   ${YELLOW}  --services isabel-$ENVIRONMENT-app \\${NC}"
echo -e "   ${YELLOW}  --region ${AWS_REGION:-<region>} --profile ${AWS_PROFILE:-default}${NC}"
echo ""

if [ "$ENVIRONMENT" = "staging" ]; then
    echo -e "${GREEN}Tip:${NC} After testing in staging, deploy to production with:"
    echo -e "   ${YELLOW}$0 production${NC}"
    echo ""
fi
