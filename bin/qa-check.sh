#!/usr/bin/env bash
set -euo pipefail

# Public hostname of the deployment (staging is staging.$APP_DOMAIN)
APP_DOMAIN="${APP_DOMAIN:-isabel.example.com}"

# Post-deployment QA check for Isabel
# Usage: bin/qa-check.sh <environment>
# Environments: local, qa, staging, production

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

ENVIRONMENT="${1:-}"

if [[ -z "$ENVIRONMENT" ]]; then
  echo "Usage: bin/qa-check.sh <environment>"
  echo ""
  echo "Environments:"
  echo "  local       http://localhost:3000"
  echo "  staging     https://staging.${APP_DOMAIN}"
  echo "  production  https://${APP_DOMAIN} (smoke only)"
  exit 1
fi

case "$ENVIRONMENT" in
  local)
    export E2E_BASE_URL="http://localhost:3000"
    ;;
  staging)
    export E2E_BASE_URL="https://staging.${APP_DOMAIN}"
    ;;
  production)
    export E2E_BASE_URL="https://${APP_DOMAIN}"
    ;;
  *)
    echo "Error: Unknown environment '$ENVIRONMENT'"
    echo "Valid environments: local, staging, production"
    exit 1
    ;;
esac

export E2E_ENVIRONMENT="$ENVIRONMENT"

cd "$PROJECT_DIR"

echo "======================================"
echo "Isabel QA Check"
echo "Environment: $ENVIRONMENT"
echo "URL: $E2E_BASE_URL"
echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "======================================"
echo ""

# Step 1: Smoke tests (gate)
echo "=== Step 1: Smoke Tests (gate) ==="
if ! npx playwright test --grep @smoke; then
  echo ""
  echo "❌ SMOKE TESTS FAILED — aborting QA check"
  echo "The application may not be running or is unhealthy."
  exit 1
fi
echo "✅ Smoke tests passed"
echo ""

# Step 2: API tests
echo "=== Step 2: API Endpoint Tests ==="
npx playwright test --grep @api || true
echo ""

# Step 3: Full suite (except production — smoke only)
if [[ "$ENVIRONMENT" == "production" ]]; then
  echo "=== Production: Skipping full suite (smoke-only policy) ==="
  echo "✅ Production QA check complete (smoke tests only)"
else
  echo "=== Step 3: Full E2E Suite ==="
  npx playwright test || true
fi

echo ""
echo "======================================"
echo "QA Check Complete"
echo "View report: npm run test:e2e:report"
echo "======================================"
