#!/bin/bash
set -e

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
    echo "Usage: bin/deploy-agent.sh [environment]"
    echo "Example: bin/deploy-agent.sh staging"
    exit 1
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Isabel - Cortex Agent Deployment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Environment: ${ENVIRONMENT}${NC}"
echo -e "${GREEN}Timestamp: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""

# ─── Config and credentials from AWS Secrets Manager ─────────────────────────
# Same source the ECS task uses: <prefix>/<env>/app-config plus the credential
# secrets. Nothing is read from .env.local or .key/.
AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:?Set AWS_REGION}}"
SECRETS_PREFIX="${SECRETS_PREFIX:-isabel}"
export AWS_PROFILE

get_secret() {
    aws secretsmanager get-secret-value \
        --secret-id "${SECRETS_PREFIX}/${ENVIRONMENT}/$1" \
        --region "$AWS_REGION" \
        --query SecretString \
        --output text
}

app_config() {
    jq -r --arg k "$1" '.[$k] // ""' <<< "$APP_CONFIG"
}

echo -e "${YELLOW}Reading ${SECRETS_PREFIX}/${ENVIRONMENT}/* from Secrets Manager...${NC}"
if ! APP_CONFIG=$(get_secret app-config) \
    || ! SNOWFLAKE_ACCOUNT=$(get_secret snowflake-account) \
    || ! SNOWFLAKE_USER=$(get_secret snowflake-user) \
    || ! SNOWFLAKE_RSA_PASSPHRASE=$(get_secret snowflake-rsa-passphrase) \
    || ! SNOWFLAKE_RSA_KEY=$(get_secret rsa-key); then
    echo -e "${RED}Error: could not read secrets. Run: bin/secrets.sh check ${ENVIRONMENT}${NC}"
    exit 1
fi

SNOWFLAKE_URL=$(app_config SNOWFLAKE_URL)
DATABASE=$(app_config SNOWFLAKE_DATABASE)
SCHEMA=$(app_config SNOWFLAKE_SCHEMA)
WAREHOUSE=$(app_config SNOWFLAKE_WAREHOUSE)
AGENT_NAME=$(app_config AGENT_NAME)
OPUS_AGENT_NAME=$(app_config OPUS_AGENT_NAME)
HAIKU_AGENT_NAME=$(app_config HAIKU_AGENT_NAME)
SEMANTIC_MODEL_PATH=$(app_config SEMANTIC_MODEL_PATH)
SEARCH_SERVICE_PATH=$(app_config SEARCH_SERVICE_PATH)

for var in SNOWFLAKE_URL DATABASE SCHEMA WAREHOUSE AGENT_NAME SEMANTIC_MODEL_PATH SEARCH_SERVICE_PATH; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}Error: ${var} is empty in ${SECRETS_PREFIX}/${ENVIRONMENT}/app-config${NC}"
        exit 1
    fi
done

# The app reads the model from SEMANTIC_MODEL_PATH, so stage it to exactly that path
STAGE_PATH="${SEMANTIC_MODEL_PATH%/*}"
SEMANTIC_MODEL_STAGE_FILE="${SEMANTIC_MODEL_PATH##*/}"

case "$SNOWFLAKE_RSA_PASSPHRASE" in
    NO_PASSPHRASE|EMPTY) SNOWFLAKE_RSA_PASSPHRASE="" ;;
esac

# Write the key to a private temp file (snowsql needs a path); removed on exit
RSA_KEY_PATH=$(mktemp)
trap 'rm -f "$RSA_KEY_PATH"' EXIT
chmod 600 "$RSA_KEY_PATH"
# Normalize like lib/snowflake/jwt-generator.ts: PEM, base64 PEM, or literal \n
SNOWFLAKE_RSA_KEY="$SNOWFLAKE_RSA_KEY" RSA_KEY_PATH="$RSA_KEY_PATH" node -e "
let key = process.env.SNOWFLAKE_RSA_KEY;
if (!key.startsWith('-----BEGIN')) key = Buffer.from(key, 'base64').toString('utf-8');
require('fs').writeFileSync(process.env.RSA_KEY_PATH, key.replace(/\\\\n/g, '\n'), { mode: 0o600 });
"
unset SNOWFLAKE_RSA_KEY

# One spec for every agent. Only models.orchestration differs per agent.
SPEC_FILE="examples/agent.json"
SEMANTIC_MODEL_FILE="examples/semantic_model.yaml"
OPUS_MODEL="${OPUS_MODEL:-claude-opus-5-5}"
HAIKU_MODEL="${HAIKU_MODEL:-claude-haiku-5-5}"

echo -e "${GREEN}Agent Name:${NC} $AGENT_NAME"
echo -e "${GREEN}Opus Agent Name:${NC} ${OPUS_AGENT_NAME:-N/A}"
echo -e "${GREEN}Haiku Agent Name:${NC} ${HAIKU_AGENT_NAME:-N/A}"
echo -e "${GREEN}Spec File:${NC} $SPEC_FILE"
echo -e "${GREEN}Semantic Model:${NC} $SEMANTIC_MODEL_FILE"
echo -e "${GREEN}Snowflake Account:${NC} $SNOWFLAKE_ACCOUNT"
echo -e "${GREEN}Snowflake User:${NC} $SNOWFLAKE_USER"
echo ""

# ─── Validate required files ─────────────────────────────────────────────────
if [ ! -f "$SPEC_FILE" ]; then
    echo -e "${RED}Error: Agent spec file not found: ${SPEC_FILE}${NC}"
    exit 1
fi

if [ ! -f "$SEMANTIC_MODEL_FILE" ]; then
    echo -e "${RED}Error: Semantic model file not found: ${SEMANTIC_MODEL_FILE}${NC}"
    exit 1
fi

if [ "$(basename "$SEMANTIC_MODEL_FILE")" != "$SEMANTIC_MODEL_STAGE_FILE" ]; then
    echo -e "${RED}Error: ${SEMANTIC_MODEL_FILE} would be staged as $(basename "$SEMANTIC_MODEL_FILE"), but app-config SEMANTIC_MODEL_PATH expects ${SEMANTIC_MODEL_STAGE_FILE}${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All required files found${NC}"
echo ""

# ─── Generate JWT via Node.js (standalone — no TS imports needed) ──────────────
echo -e "${YELLOW}Step 1: Generating Snowflake JWT...${NC}"

if ! JWT_TOKEN=$(RSA_KEY_PATH="$RSA_KEY_PATH" \
    SNOWFLAKE_ACCOUNT="$SNOWFLAKE_ACCOUNT" \
    SNOWFLAKE_USER="$SNOWFLAKE_USER" \
    SNOWFLAKE_RSA_PASSPHRASE="$SNOWFLAKE_RSA_PASSPHRASE" \
    node -e "
const crypto = require('crypto');
const fs = require('fs');

// Read RSA key
const rsaKeyBuf = fs.readFileSync(process.env.RSA_KEY_PATH);
const passphrase = process.env.SNOWFLAKE_RSA_PASSPHRASE || '';

// Parse the private key
let privateKey;
const keyStr = rsaKeyBuf.toString();
if (keyStr.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
  privateKey = crypto.createPrivateKey({ key: rsaKeyBuf, format: 'pem', passphrase });
} else {
  privateKey = crypto.createPrivateKey({ key: rsaKeyBuf, format: 'pem' });
}

// Calculate public key fingerprint (SHA256:base64)
const publicKey = crypto.createPublicKey(privateKey);
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
const sha256 = crypto.createHash('sha256').update(publicKeyDer).digest('base64');
const fingerprint = 'SHA256:' + sha256;

// Build JWT (manual — avoids jsonwebtoken dependency in script context)
const account = process.env.SNOWFLAKE_ACCOUNT.toUpperCase();
const user = process.env.SNOWFLAKE_USER.toUpperCase();
const qualifiedUsername = account + '.' + user;
const now = Math.floor(Date.now() / 1000);

const header = { alg: 'RS256', typ: 'JWT' };
const payload = {
  iss: qualifiedUsername + '.' + fingerprint,
  sub: qualifiedUsername,
  iat: now,
  exp: now + 3600,
};

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

const headerB64 = base64url(header);
const payloadB64 = base64url(payload);
const signingInput = headerB64 + '.' + payloadB64;

const sign = crypto.createSign('RSA-SHA256');
sign.update(signingInput);
const signature = sign.sign(privateKey, 'base64url');

process.stdout.write(signingInput + '.' + signature);
" 2>&1); then
    echo -e "${RED}Error: JWT generation failed${NC}"
    echo "$JWT_TOKEN"
    exit 1
fi

echo -e "${GREEN}✓ JWT generated successfully${NC}"
echo ""

# ─── Helper: Execute SQL via Snowflake REST API ──────────────────────────────
execute_sql() {
    local sql_statement="$1"
    local description="$2"

    echo -e "${YELLOW}  Executing: ${description}${NC}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "${SNOWFLAKE_URL}/api/v2/statements" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "User-Agent: Isabel/1.0" \
        -H "Authorization: Bearer ${JWT_TOKEN}" \
        -H "X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT" \
        -d "{
            \"statement\": $(echo "$sql_statement" | jq -Rs .),
            \"timeout\": 60,
            \"database\": \"${DATABASE}\",
            \"schema\": \"${SCHEMA}\",
            \"warehouse\": \"${WAREHOUSE}\"
        }")

    local http_code
    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')

    if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
        local status
        status=$(echo "$body" | jq -r '.status // "unknown"')
        if [[ "$status" == "failed" ]]; then
            local error_msg
            error_msg=$(echo "$body" | jq -r '.message // "Unknown error"')
            echo -e "${RED}  ✗ SQL execution failed: ${error_msg}${NC}"
            return 1
        fi
        echo -e "${GREEN}  ✓ ${description} - success${NC}"
        return 0
    else
        local error_msg
        error_msg=$(echo "$body" | jq -r '.message // "Unknown error"' 2>/dev/null || echo "$body")
        echo -e "${RED}  ✗ HTTP ${http_code}: ${error_msg}${NC}"
        return 1
    fi
}

# ─── Step 2: Upload semantic model to Snowflake stage ─────────────────────────
echo -e "${YELLOW}Step 2: Uploading semantic model to Snowflake stage...${NC}"

if command -v snowsql &> /dev/null; then
    echo -e "${GREEN}  ✓ SnowSQL found — uploading via PUT${NC}"

    # Build SnowSQL connection args using key-pair auth
    SNOWSQL_ARGS=(
        --accountname "${SNOWFLAKE_ACCOUNT}"
        --username "${SNOWFLAKE_USER}"
        --private-key-path "${RSA_KEY_PATH}"
        --dbname "${DATABASE}"
        --schemaname "${SCHEMA}"
        -o friendly=false
        -o timing=false
        -o output_format=plain
    )

    # Add passphrase if set
    if [ -n "${SNOWFLAKE_RSA_PASSPHRASE:-}" ]; then
        export SNOWSQL_PRIVATE_KEY_PASSPHRASE="${SNOWFLAKE_RSA_PASSPHRASE}"
    fi

    PUT_SQL="PUT file://${PWD}/${SEMANTIC_MODEL_FILE} ${STAGE_PATH}/ AUTO_COMPRESS=FALSE OVERWRITE=TRUE;"

    if snowsql "${SNOWSQL_ARGS[@]}" -q "${PUT_SQL}" 2>&1; then
        echo -e "${GREEN}  ✓ Semantic model staged to ${STAGE_PATH}/${SEMANTIC_MODEL_STAGE_FILE}${NC}"
    else
        echo -e "${RED}  ✗ PUT failed — check SnowSQL auth and stage permissions${NC}"
        exit 1
    fi
elif command -v snow &> /dev/null; then
    echo -e "${GREEN}  ✓ Snowflake CLI found — uploading via stage copy${NC}"

    if snow stage copy "file://${PWD}/${SEMANTIC_MODEL_FILE}" "${STAGE_PATH}/" --overwrite 2>&1; then
        echo -e "${GREEN}  ✓ Semantic model staged to ${STAGE_PATH}/${SEMANTIC_MODEL_STAGE_FILE}${NC}"
    else
        echo -e "${RED}  ✗ Stage copy failed — check Snowflake CLI auth and stage permissions${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}  ⚠ Neither SnowSQL nor Snowflake CLI found — skipping semantic model upload${NC}"
    echo -e "${YELLOW}  To stage manually: PUT file://${PWD}/${SEMANTIC_MODEL_FILE} ${STAGE_PATH}/ AUTO_COMPRESS=FALSE OVERWRITE=TRUE${NC}"
    echo -e "${YELLOW}  Install SnowSQL or Snowflake CLI to enable automatic staging${NC}"
fi
echo ""

# ─── Step 3: Create or replace the Cortex Agents ─────────────────────────────
# The spec is the same for all agents; app-config supplies the warehouse, the
# staged semantic model and the search service. A model argument overrides
# models.orchestration, and an empty one keeps the model in the spec.
deploy_agent() {
    local agent_name="$1" model="$2" comment="$3" spec

    spec=$(jq --arg w "$WAREHOUSE" --arg sm "$SEMANTIC_MODEL_PATH" --arg ss "$SEARCH_SERVICE_PATH" --arg m "$model" '
        .tool_resources.analyst1.execution_environment.warehouse = $w
        | .tool_resources.analyst1.semantic_model_file = $sm
        | .tool_resources.search1.search_service = $ss
        | if $m != "" then .models.orchestration = $m else . end' "$SPEC_FILE")

    echo -e "${YELLOW}Creating/updating Cortex Agent '${agent_name}' ($(jq -r '.models.orchestration' <<< "$spec"))...${NC}"

    local sql="CREATE OR REPLACE AGENT ${DATABASE}.${SCHEMA}.${agent_name}
  COMMENT = '${comment} (${ENVIRONMENT})'
  FROM SPECIFICATION
\$\$
${spec}
\$\$;"

    if ! execute_sql "$sql" "CREATE OR REPLACE AGENT ${agent_name}"; then
        echo -e "${RED}✗ Agent '${agent_name}' deployment failed${NC}"
        echo -e "${YELLOW}Troubleshooting:${NC}"
        echo "  1. Verify Snowflake credentials (SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER)"
        echo "  2. Check that the role has CREATE AGENT privilege on ${DATABASE}.${SCHEMA}"
        echo "  3. Verify the semantic model is staged at ${STAGE_PATH}/${SEMANTIC_MODEL_STAGE_FILE}"
        echo "  4. Check Snowflake connectivity: curl -s ${SNOWFLAKE_URL}/api/v2/statements"
        exit 1
    fi
    echo -e "${GREEN}✓ Agent '${agent_name}' deployed${NC}"
    echo ""
}

echo -e "${YELLOW}Step 3: Creating/updating Cortex Agents...${NC}"
deploy_agent "$AGENT_NAME" "" "Isabel agent"

if [ -n "$OPUS_AGENT_NAME" ]; then
    deploy_agent "$OPUS_AGENT_NAME" "$OPUS_MODEL" "Isabel agent, deeper reasoning"
else
    echo -e "${YELLOW}Skipping Opus agent (OPUS_AGENT_NAME is empty)${NC}"
fi

if [ -n "$HAIKU_AGENT_NAME" ]; then
    deploy_agent "$HAIKU_AGENT_NAME" "$HAIKU_MODEL" "Isabel agent, low cost"
else
    echo -e "${YELLOW}Skipping Haiku agent (HAIKU_AGENT_NAME is empty)${NC}"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Agent Deployment Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Environment:${NC} $ENVIRONMENT"
echo -e "${GREEN}Agent:${NC} ${DATABASE}.${SCHEMA}.${AGENT_NAME}"
if [ -n "$OPUS_AGENT_NAME" ]; then
echo -e "${GREEN}Opus Agent:${NC} ${DATABASE}.${SCHEMA}.${OPUS_AGENT_NAME}"
fi
if [ -n "$HAIKU_AGENT_NAME" ]; then
echo -e "${GREEN}Haiku Agent:${NC} ${DATABASE}.${SCHEMA}.${HAIKU_AGENT_NAME}"
fi
echo -e "${GREEN}Spec File:${NC} $SPEC_FILE"
echo -e "${GREEN}Semantic Model:${NC} ${STAGE_PATH}/${SEMANTIC_MODEL_STAGE_FILE}"
echo ""
echo -e "${GREEN}Agents accessible at:${NC}"
echo "  ${SNOWFLAKE_URL}/api/v2/databases/${DATABASE}/schemas/${SCHEMA}/agents/${AGENT_NAME}:run"
if [ -n "$OPUS_AGENT_NAME" ]; then
echo "  ${SNOWFLAKE_URL}/api/v2/databases/${DATABASE}/schemas/${SCHEMA}/agents/${OPUS_AGENT_NAME}:run"
fi
if [ -n "$HAIKU_AGENT_NAME" ]; then
echo "  ${SNOWFLAKE_URL}/api/v2/databases/${DATABASE}/schemas/${SCHEMA}/agents/${HAIKU_AGENT_NAME}:run"
fi
echo ""
