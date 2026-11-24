#!/bin/bash
set -eo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:?Set AWS_REGION}}"
AWS_PROFILE="${AWS_PROFILE:-default}"
ECR_REPOSITORY="isabel"
IMAGE_NAME="isabel"

# Parse arguments
ENVIRONMENT="${1:-staging}"
BUILD_VERSION="${2:-$(date +%Y%m%d-%H%M%S)}"
PUSH_TO_ECR="${3:-true}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(staging|production)$ ]]; then
    echo -e "${RED}Error: Invalid environment. Use: staging or production${NC}"
    echo "Usage: bin/docker-build.sh [environment] [version] [push_to_ecr]"
    echo "Example: bin/docker-build.sh staging latest true"
    exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Docker Build & Push to ECR${NC}"
echo -e "${GREEN}========================================${NC}"
echo "Environment: $ENVIRONMENT"
echo "Version: $BUILD_VERSION"
echo ""

# Validate required files exist
echo -e "${YELLOW}Validating required files...${NC}"

if [ ! -f "Dockerfile" ]; then
    echo -e "${RED}Error: Dockerfile not found in current directory${NC}"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found in current directory${NC}"
    exit 1
fi

echo -e "${GREEN}✓ File validation complete${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! AWS_PROFILE=$AWS_PROFILE aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS credentials for profile '$AWS_PROFILE' are not valid or expired.${NC}"
    echo "Please refresh your SAML credentials and try again."
    exit 1
fi

ACCOUNT_ID=$(AWS_PROFILE=$AWS_PROFILE aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ AWS credentials valid (Account: $ACCOUNT_ID)${NC}"
ECR_REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Build the Docker image for linux/amd64 (AWS Fargate platform)
echo ""
echo -e "${YELLOW}Building Docker image for linux/amd64 platform...${NC}"
echo -e "${YELLOW}No build args or secrets: config is injected at runtime by ECS${NC}"
echo "Command: docker build --platform linux/amd64 -t $IMAGE_NAME:$BUILD_VERSION ."
echo ""

if docker build --platform linux/amd64 -t $IMAGE_NAME:$BUILD_VERSION . 2>&1 | tee /tmp/docker-build-$BUILD_VERSION.log; then
    echo -e "${GREEN}✓ Docker image built successfully${NC}"
else
    echo -e "${RED}Error: Docker build failed${NC}"
    echo -e "${RED}Check the build log: /tmp/docker-build-$BUILD_VERSION.log${NC}"
    exit 1
fi

# Tag the image for ECR
echo ""
echo -e "${YELLOW}Tagging image for ECR...${NC}"
docker tag $IMAGE_NAME:$BUILD_VERSION $ECR_REGISTRY/$ECR_REPOSITORY:$ENVIRONMENT
docker tag $IMAGE_NAME:$BUILD_VERSION $ECR_REGISTRY/$ECR_REPOSITORY:$BUILD_VERSION
docker tag $IMAGE_NAME:$BUILD_VERSION $ECR_REGISTRY/$ECR_REPOSITORY:latest
echo -e "${GREEN}✓ Image tagged:${NC}"
echo "  - $ECR_REGISTRY/$ECR_REPOSITORY:$ENVIRONMENT"
echo "  - $ECR_REGISTRY/$ECR_REPOSITORY:$BUILD_VERSION"
echo "  - $ECR_REGISTRY/$ECR_REPOSITORY:latest"

# Check image size
IMAGE_SIZE=$(docker images $IMAGE_NAME:$BUILD_VERSION --format "{{.Size}}")
IMAGE_ID=$(docker images $IMAGE_NAME:$BUILD_VERSION --format "{{.ID}}")
echo ""
echo -e "${GREEN}Image details:${NC}"
echo "  - Image ID: $IMAGE_ID"
echo "  - Image size: $IMAGE_SIZE"
echo ""

# Inspect image layers for debugging
echo -e "${YELLOW}Image layer information:${NC}"
docker history $IMAGE_NAME:$BUILD_VERSION --human=true --no-trunc=false | head -10 || true
echo ""

if [[ "$PUSH_TO_ECR" == "false" ]]; then
    echo ""
    echo -e "${YELLOW}Skipping push to ECR (push_to_ecr=false)${NC}"
    echo -e "${GREEN}Build completed successfully!${NC}"
    exit 0
fi

# Login to ECR
echo ""
echo -e "${YELLOW}Logging in to ECR...${NC}"
if AWS_PROFILE=$AWS_PROFILE aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY; then
    echo -e "${GREEN}✓ Successfully logged in to ECR${NC}"
else
    echo -e "${RED}Error: Failed to login to ECR${NC}"
    exit 1
fi

# Push the images to ECR
echo ""
echo -e "${YELLOW}Pushing images to ECR...${NC}"

echo "Pushing: $ECR_REGISTRY/$ECR_REPOSITORY:$ENVIRONMENT"
if docker push $ECR_REGISTRY/$ECR_REPOSITORY:$ENVIRONMENT; then
    echo -e "${GREEN}✓ Pushed environment tag${NC}"
else
    echo -e "${RED}Error: Failed to push environment tag${NC}"
    exit 1
fi

echo "Pushing: $ECR_REGISTRY/$ECR_REPOSITORY:$BUILD_VERSION"
if docker push $ECR_REGISTRY/$ECR_REPOSITORY:$BUILD_VERSION; then
    echo -e "${GREEN}✓ Pushed version tag${NC}"
else
    echo -e "${RED}Error: Failed to push version tag${NC}"
    exit 1
fi

echo "Pushing: $ECR_REGISTRY/$ECR_REPOSITORY:latest"
if docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest; then
    echo -e "${GREEN}✓ Pushed latest tag${NC}"
else
    echo -e "${RED}Error: Failed to push latest tag${NC}"
    exit 1
fi

# Get image digest
IMAGE_DIGEST=$(AWS_PROFILE=$AWS_PROFILE aws ecr describe-images \
    --repository-name $ECR_REPOSITORY \
    --image-ids imageTag=$ENVIRONMENT \
    --region $AWS_REGION \
    --query 'imageDetails[0].imageDigest' \
    --output text)

# Get image push timestamp
IMAGE_PUSHED=$(AWS_PROFILE=$AWS_PROFILE aws ecr describe-images \
    --repository-name $ECR_REPOSITORY \
    --image-ids imageTag=$ENVIRONMENT \
    --region $AWS_REGION \
    --query 'imageDetails[0].imagePushedAt' \
    --output text)

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Build and Push Completed Successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo "Image URI: $ECR_REGISTRY/$ECR_REPOSITORY:$ENVIRONMENT"
echo "Image Digest: $IMAGE_DIGEST"
echo "Build Version: $BUILD_VERSION"
echo "Pushed At: $IMAGE_PUSHED"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Deploy to ECS: bin/deploy-ecs.sh $ENVIRONMENT"
echo "2. Or run Terraform apply: bin/setup app $ENVIRONMENT"
echo ""
echo -e "${YELLOW}Verify image:${NC}"
echo "aws ecr describe-images --repository-name $ECR_REPOSITORY --image-ids imageTag=$ENVIRONMENT --profile ${AWS_PROFILE:-default}"
echo ""
