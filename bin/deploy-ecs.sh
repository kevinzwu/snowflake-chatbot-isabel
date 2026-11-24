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

# Configuration
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:?Set AWS_REGION}}"
AWS_PROFILE="${AWS_PROFILE:-default}"

# Parse arguments
ENVIRONMENT="${1:-staging}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(staging|production)$ ]]; then
    echo -e "${RED}Error: Invalid environment. Use: staging or production${NC}"
    echo "Usage: bin/deploy-ecs.sh [environment]"
    echo "Example: bin/deploy-ecs.sh staging"
    exit 1
fi

# Set cluster and service names based on environment
CLUSTER_NAME="isabel-$ENVIRONMENT"
SERVICE_NAME="isabel-$ENVIRONMENT-app"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}ECS Service Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo "Environment: $ENVIRONMENT"
echo "Cluster: $CLUSTER_NAME"
echo "Service: $SERVICE_NAME"
echo "Region: $AWS_REGION"
echo ""

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! AWS_PROFILE=$AWS_PROFILE aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS credentials for profile '$AWS_PROFILE' are not valid or expired.${NC}"
    echo "Please refresh your SAML credentials and try again."
    exit 1
fi

ACCOUNT_ID=$(AWS_PROFILE=$AWS_PROFILE aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}✓ AWS credentials valid (Account: $ACCOUNT_ID)${NC}"

# Check if cluster exists
echo ""
echo -e "${YELLOW}Checking if cluster exists...${NC}"
if ! AWS_PROFILE=$AWS_PROFILE aws ecs describe-clusters \
    --clusters $CLUSTER_NAME \
    --region $AWS_REGION \
    --query 'clusters[0].status' \
    --output text | grep -q "ACTIVE"; then
    echo -e "${RED}Error: Cluster '$CLUSTER_NAME' not found or not active${NC}"
    echo "Please create the cluster first using: bin/setup app $ENVIRONMENT"
    exit 1
fi
echo -e "${GREEN}✓ Cluster found and active${NC}"

# Check if service exists
echo ""
echo -e "${YELLOW}Checking if service exists...${NC}"
if ! AWS_PROFILE=$AWS_PROFILE aws ecs describe-services \
    --cluster $CLUSTER_NAME \
    --services $SERVICE_NAME \
    --region $AWS_REGION \
    --query 'services[0].status' \
    --output text | grep -q "ACTIVE"; then
    echo -e "${RED}Error: Service '$SERVICE_NAME' not found or not active${NC}"
    echo "Please create the service first using: bin/setup app $ENVIRONMENT"
    exit 1
fi
echo -e "${GREEN}✓ Service found and active${NC}"

# Get current task definition
echo ""
echo -e "${YELLOW}Getting current task definition...${NC}"
CURRENT_TASK_DEF=$(AWS_PROFILE=$AWS_PROFILE aws ecs describe-services \
    --cluster $CLUSTER_NAME \
    --services $SERVICE_NAME \
    --region $AWS_REGION \
    --query 'services[0].taskDefinition' \
    --output text)
echo "Current task definition: $CURRENT_TASK_DEF"

# Extract task definition family and revision
TASK_FAMILY=$(echo $CURRENT_TASK_DEF | sed 's/.*task-definition\/\([^:]*\).*/\1/')
CURRENT_REVISION=$(echo $CURRENT_TASK_DEF | sed 's/.*:\([0-9]*\)$/\1/')
echo "Task family: $TASK_FAMILY"
echo "Current revision: $CURRENT_REVISION"

# Get the current task definition JSON (without revision-specific fields)
echo ""
echo -e "${YELLOW}Retrieving task definition template...${NC}"
TASK_DEF_JSON=$(AWS_PROFILE=$AWS_PROFILE aws ecs describe-task-definition \
    --task-definition $CURRENT_TASK_DEF \
    --region $AWS_REGION \
    --query 'taskDefinition' \
    --output json)

# The environment tag is a moving pointer; the task definition pins its digest
ECR_REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
ECR_REPOSITORY="isabel"
IMAGE_TAG_URI="$ECR_REGISTRY/$ECR_REPOSITORY:$ENVIRONMENT"

echo ""
echo -e "${YELLOW}Checking for new image in ECR...${NC}"
# Verify the image exists in ECR
if ! AWS_PROFILE=$AWS_PROFILE aws ecr describe-images \
    --repository-name $ECR_REPOSITORY \
    --image-ids imageTag=$ENVIRONMENT \
    --region $AWS_REGION > /dev/null 2>&1; then
    echo -e "${RED}Error: Image '$IMAGE_TAG_URI' not found in ECR${NC}"
    echo "Please build and push the image first: bin/docker-build.sh $ENVIRONMENT"
    exit 1
fi
IMAGE_DIGEST=$(AWS_PROFILE=$AWS_PROFILE aws ecr describe-images \
    --repository-name $ECR_REPOSITORY \
    --image-ids imageTag=$ENVIRONMENT \
    --region $AWS_REGION \
    --query 'imageDetails[0].imageDigest' \
    --output text)
NEW_IMAGE_URI="$ECR_REGISTRY/$ECR_REPOSITORY@$IMAGE_DIGEST"
echo -e "${GREEN}✓ Image found in ECR: $IMAGE_TAG_URI${NC}"
echo "  Pinned to: $NEW_IMAGE_URI"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: 'jq' command not found${NC}"
    echo "Please install jq: brew install jq"
    exit 1
fi

# Update the image in the container definitions
echo ""
echo -e "${YELLOW}Creating new task definition with updated image...${NC}"
NEW_TASK_DEF=$(echo "$TASK_DEF_JSON" | jq --arg IMAGE "$NEW_IMAGE_URI" \
    'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt) |
     .containerDefinitions[0].image = $IMAGE')

if [ -z "$NEW_TASK_DEF" ] || [ "$NEW_TASK_DEF" == "null" ]; then
    echo -e "${RED}Error: Failed to create new task definition JSON${NC}"
    echo "Task definition JSON might be malformed"
    exit 1
fi

# Write to temporary file to avoid shell escaping issues
TEMP_TASK_DEF="/tmp/task-def-${ENVIRONMENT}-$$.json"
echo "$NEW_TASK_DEF" > "$TEMP_TASK_DEF"

echo "Task definition written to: $TEMP_TASK_DEF"
echo "Validating JSON..."
if ! jq empty "$TEMP_TASK_DEF" 2>/dev/null; then
    echo -e "${RED}Error: Generated task definition is not valid JSON${NC}"
    echo "Contents:"
    cat "$TEMP_TASK_DEF"
    rm -f "$TEMP_TASK_DEF"
    exit 1
fi

# Register the new task definition using file
echo "Registering new task definition..."
NEW_TASK_DEF_ARN=$(AWS_PROFILE=$AWS_PROFILE aws ecs register-task-definition \
    --cli-input-json "file://$TEMP_TASK_DEF" \
    --region $AWS_REGION \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text 2>&1)

# Clean up temp file
rm -f "$TEMP_TASK_DEF"

# Check if registration was successful
if [[ "$NEW_TASK_DEF_ARN" != arn:aws:ecs:* ]]; then
    echo -e "${RED}Error: Failed to register new task definition${NC}"
    echo "Error message: $NEW_TASK_DEF_ARN"
    echo ""
    echo "Debugging information:"
    echo "Task family: $TASK_FAMILY"
    echo "Current revision: $CURRENT_REVISION"
    echo -e "${RED}The service was NOT updated.${NC}"
    exit 1
else
    NEW_REVISION=$(echo $NEW_TASK_DEF_ARN | sed 's/.*:\([0-9]*\)$/\1/')
    echo -e "${GREEN}✓ New task definition registered${NC}"
    echo "New task definition: $NEW_TASK_DEF_ARN"
    echo "New revision: $NEW_REVISION"
fi

# Update the service to use the new task definition
echo ""
echo -e "${YELLOW}Updating ECS service to use new task definition...${NC}"

DEPLOYMENT_ID=$(AWS_PROFILE=$AWS_PROFILE aws ecs update-service \
    --cluster $CLUSTER_NAME \
    --service $SERVICE_NAME \
    --task-definition $NEW_TASK_DEF_ARN \
    --force-new-deployment \
    --region $AWS_REGION \
    --query 'service.deployments[0].id' \
    --output text)

echo -e "${GREEN}✓ Service updated with new task definition${NC}"
echo "Deployment ID: $DEPLOYMENT_ID"
echo ""
echo -e "${BLUE}Summary:${NC}"
echo "  Old revision: $CURRENT_REVISION"
echo "  New revision: $NEW_REVISION"
echo "  Image: $NEW_IMAGE_URI"

echo "  Image digest: $IMAGE_DIGEST"

# Monitor deployment
echo ""
echo -e "${YELLOW}Monitoring deployment (this may take a few minutes)...${NC}"
echo -e "${BLUE}Press Ctrl+C to stop monitoring (deployment will continue in background)${NC}"
echo ""

MAX_WAIT=600  # 10 minutes
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Get deployment status and service details
    SERVICE_INFO=$(AWS_PROFILE=$AWS_PROFILE aws ecs describe-services \
        --cluster $CLUSTER_NAME \
        --services $SERVICE_NAME \
        --region $AWS_REGION \
        --query 'services[0]' \
        --output json)
    
    # Extract deployment info
    DEPLOYMENT_STATUS=$(echo "$SERVICE_INFO" | jq -r ".deployments[] | select(.id==\"$DEPLOYMENT_ID\") | \"\(.status) \(.runningCount) \(.desiredCount) \(.rolloutState // \"NONE\")\"")
    
    STATUS=$(echo $DEPLOYMENT_STATUS | awk '{print $1}')
    RUNNING=$(echo $DEPLOYMENT_STATUS | awk '{print $2}')
    DESIRED=$(echo $DEPLOYMENT_STATUS | awk '{print $3}')
    ROLLOUT_STATE=$(echo $DEPLOYMENT_STATUS | awk '{print $4}')
    
    # Get all deployments count
    DEPLOYMENTS_COUNT=$(echo "$SERVICE_INFO" | jq '.deployments | length')
    
    # Check for failure indicators
    FAILED_TASKS=$(echo "$SERVICE_INFO" | jq -r '.events[:10][] | select(.message | contains("failed") or contains("stopped") or contains("error") or contains("unable")) | .message' | head -1)
    CIRCUIT_BREAKER=$(echo "$SERVICE_INFO" | jq -r '.deployments[] | select(.id=="'$DEPLOYMENT_ID'") | .rolloutState' 2>/dev/null)
    
    echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} Status: $STATUS | Running: $RUNNING/$DESIRED | Active deployments: $DEPLOYMENTS_COUNT | Rollout: $ROLLOUT_STATE"
    
    # Check for deployment failure - circuit breaker triggered
    if [[ "$CIRCUIT_BREAKER" == "FAILED" ]]; then
        echo ""
        echo -e "${RED}========================================${NC}"
        echo -e "${RED}Deployment FAILED - Circuit Breaker Triggered${NC}"
        echo -e "${RED}========================================${NC}"
        echo ""
        echo -e "${RED}Recent error events:${NC}"
        AWS_PROFILE=$AWS_PROFILE aws ecs describe-services \
            --cluster $CLUSTER_NAME \
            --services $SERVICE_NAME \
            --region $AWS_REGION \
            --query 'services[0].events[:10].[createdAt, message]' \
            --output table
        echo ""
        echo -e "${YELLOW}Check CloudWatch logs for details:${NC}"
        echo "aws logs tail /ecs/$CLUSTER_NAME --follow --profile ${AWS_PROFILE:-default}"
        exit 1
    fi
    
    # Check for task failures
    if [[ -n "$FAILED_TASKS" ]]; then
        echo -e "${YELLOW}⚠ Warning: ${FAILED_TASKS}${NC}"
    fi
    
    # Check if deployment is complete (only one deployment and desired count reached)
    if [[ "$DEPLOYMENTS_COUNT" == "1" ]] && [[ "$RUNNING" == "$DESIRED" ]] && [[ "$STATUS" == "PRIMARY" ]]; then
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Deployment Completed Successfully!${NC}"
        echo -e "${GREEN}========================================${NC}"
        
        # Get service URL
        echo ""
        echo -e "${YELLOW}Service details:${NC}"
        AWS_PROFILE=$AWS_PROFILE aws ecs describe-services \
            --cluster $CLUSTER_NAME \
            --services $SERVICE_NAME \
            --region $AWS_REGION \
            --query 'services[0].[serviceName, status, runningCount, desiredCount]' \
            --output table
        
        echo ""
        echo -e "${YELLOW}Recent events:${NC}"
        AWS_PROFILE=$AWS_PROFILE aws ecs describe-services \
            --cluster $CLUSTER_NAME \
            --services $SERVICE_NAME \
            --region $AWS_REGION \
            --query 'services[0].events[:5].[createdAt, message]' \
            --output table
        
        # Cleanup old task definitions (keep last 5 revisions)
        echo ""
        echo -e "${YELLOW}Cleaning up old task definitions...${NC}"
        echo "Keeping the last 5 revisions, deregistering older ones..."
        
        # Get all task definition revisions for this family
        ALL_REVISIONS=$(AWS_PROFILE=$AWS_PROFILE aws ecs list-task-definitions \
            --family-prefix $TASK_FAMILY \
            --status ACTIVE \
            --region $AWS_REGION \
            --query 'taskDefinitionArns' \
            --output text | tr '\t' '\n' | sort -t: -k2 -n)
        
        REVISION_COUNT=$(echo "$ALL_REVISIONS" | wc -l | tr -d ' ')
        REVISIONS_TO_DELETE=$((REVISION_COUNT - 5))
        
        if [ $REVISIONS_TO_DELETE -gt 0 ]; then
            echo "Found $REVISION_COUNT revisions, will delete oldest $REVISIONS_TO_DELETE"
            
            DELETED_COUNT=0
            for TASK_DEF_ARN in $ALL_REVISIONS; do
                if [ $DELETED_COUNT -ge $REVISIONS_TO_DELETE ]; then
                    break
                fi
                
                REVISION_NUM=$(echo $TASK_DEF_ARN | sed 's/.*:\([0-9]*\)$/\1/')
                echo -n "  Deregistering revision $REVISION_NUM... "
                
                if AWS_PROFILE=$AWS_PROFILE aws ecs deregister-task-definition \
                    --task-definition $TASK_DEF_ARN \
                    --region $AWS_REGION > /dev/null 2>&1; then
                    echo -e "${GREEN}✓${NC}"
                    DELETED_COUNT=$((DELETED_COUNT + 1))
                else
                    echo -e "${RED}✗${NC}"
                fi
            done
            
            echo -e "${GREEN}✓ Cleaned up $DELETED_COUNT old task definition(s)${NC}"
        else
            echo "Only $REVISION_COUNT revision(s) exist, no cleanup needed (keeping last 5)"
        fi
        
        # Health check verification
        echo ""
        echo -e "${YELLOW}Verifying application health...${NC}"
        
        # Determine the health check URL based on environment
        case $ENVIRONMENT in
            production)
                HEALTH_URL="https://${APP_DOMAIN}/api/health"
                ;;
            staging)
                HEALTH_URL="https://staging.${APP_DOMAIN}/api/health"
                ;;
            qa)
                HEALTH_URL="https://qa.${APP_DOMAIN}/api/health"
                ;;
        esac
        
        echo "Testing: $HEALTH_URL"
        HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -k --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
        
        if [ "$HEALTH_RESPONSE" == "200" ]; then
            echo -e "${GREEN}✓ Health check passed (HTTP $HEALTH_RESPONSE)${NC}"
        else
            echo -e "${YELLOW}⚠ Health check returned HTTP $HEALTH_RESPONSE${NC}"
            echo "  (This may be normal if DNS hasn't propagated or health endpoint is not implemented)"
        fi
        
        # Final summary
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}Deployment Summary${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
        echo -e "${BLUE}Task Definition:${NC} $TASK_FAMILY:$NEW_REVISION"
        echo -e "${BLUE}Application URL:${NC} $HEALTH_URL"
        echo -e "${BLUE}Running Tasks:${NC} $RUNNING/$DESIRED"
        echo ""
        
        exit 0
    fi
    
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Deployment Timeout After $MAX_WAIT Seconds${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "Deployment is still in progress. This may indicate an issue."
echo ""
echo -e "${YELLOW}Check the deployment status:${NC}"
echo "AWS_PROFILE=$AWS_PROFILE aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION --query 'services[0].events[:10]'"
echo ""
echo -e "${YELLOW}Check CloudWatch logs:${NC}"
echo "aws logs tail /ecs/$CLUSTER_NAME --follow --profile ${AWS_PROFILE:-default}"
echo ""
echo -e "${YELLOW}AWS Console:${NC}"
echo "https://console.aws.amazon.com/ecs/home?region=$AWS_REGION#/clusters/$CLUSTER_NAME/services/$SERVICE_NAME/deployments"
echo ""

exit 1
