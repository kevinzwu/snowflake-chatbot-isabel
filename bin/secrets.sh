#!/bin/bash
# Manage the AWS Secrets Manager secrets the ECS task reads.
#
#   bin/secrets.sh check <env>          Verify every secret exists and app-config is complete
#   bin/secrets.sh set <env> <name>     Write a secret value read from stdin
#
# Examples:
#   bin/secrets.sh check staging
#   openssl rand -base64 32 | bin/secrets.sh set staging nextauth-secret
#   bin/secrets.sh set staging app-config < app-config.staging.json
#
# Environment: AWS_PROFILE, AWS_REGION (default: from AWS_DEFAULT_REGION or your AWS profile), SECRETS_PREFIX (default isabel)
# Values are never echoed or passed as command-line arguments.

set -euo pipefail

PREFIX="${SECRETS_PREFIX:-isabel}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

CREDENTIAL_SECRETS=(
  rsa-key
  snowflake-rsa-passphrase
  snowflake-account
  snowflake-user
  nextauth-secret
  azure-ad-client-id
  azure-ad-client-secret
  azure-ad-tenant-id
  oauth-service-accounts
  allowed-azure-ad-groups
  admin-azure-ad-groups
)

# Keys of the <prefix>/<env>/app-config JSON secret. Must match
# deploy/aws/app/templates/containers.json.tpl and lib/config/app-config.ts.
APP_CONFIG_REQUIRED=(
  SNOWFLAKE_URL
  SNOWFLAKE_DATABASE
  SNOWFLAKE_SCHEMA
  SNOWFLAKE_WAREHOUSE
  AGENT_NAME
  SEMANTIC_MODEL_PATH
  SEARCH_SERVICE_PATH
)
# Must be present (ECS fails to start on a missing JSON key) but may be "".
APP_CONFIG_OPTIONAL=(
  OPUS_AGENT_NAME
  HAIKU_AGENT_NAME
  SUPPORT_URL
  SUGGESTED_QUERIES
  MIP_LABEL_ID
  MIP_TENANT_ID
  MIP_LABEL_NAME
)

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

aws_sm() {
  if [ -n "$REGION" ]; then aws secretsmanager "$@" --region "$REGION"; else aws secretsmanager "$@"; fi
}

validate_env() {
  [[ "${1:-}" =~ ^(qa|staging|production)$ ]] || {
    echo "Error: environment must be qa, staging or production" >&2
    exit 1
  }
}

cmd_check() {
  local env=$1 failed=0 name
  command -v jq >/dev/null || { echo "Error: jq is required" >&2; exit 1; }

  for name in "${CREDENTIAL_SECRETS[@]}" app-config; do
    if aws_sm describe-secret --secret-id "$PREFIX/$env/$name" >/dev/null 2>&1; then
      echo "ok       $PREFIX/$env/$name"
    else
      echo "MISSING  $PREFIX/$env/$name"
      failed=1
    fi
  done

  local config
  if config=$(aws_sm get-secret-value --secret-id "$PREFIX/$env/app-config" \
      --query SecretString --output text 2>/dev/null); then
    local required optional problems
    required=$(printf '%s\n' "${APP_CONFIG_REQUIRED[@]}" | jq -R . | jq -s .)
    optional=$(printf '%s\n' "${APP_CONFIG_OPTIONAL[@]}" | jq -R . | jq -s .)
    # Prints only key names, never values
    if ! problems=$(jq -r --argjson req "$required" --argjson opt "$optional" '
        if type != "object" then "app-config is not a JSON object" else
          ([$req[] as $k | select((.[$k] // "") | tostring | length == 0) | "app-config.\($k) is missing or empty"]
          + [$opt[] as $k | select(has($k) | not) | "app-config.\($k) is missing (use \"\" if unused)"]
          + [select((.SUGGESTED_QUERIES // "") != "" and
                    ((.SUGGESTED_QUERIES | try fromjson catch null) | type != "array"))
             | "app-config.SUGGESTED_QUERIES is not a JSON array"]
          )[]
        end' <<<"$config" 2>/dev/null); then
      problems="app-config is not valid JSON"
    fi
    if [ -n "$problems" ]; then
      echo "$problems"
      failed=1
    fi
  fi

  if [ "$failed" -ne 0 ]; then
    echo "Secrets check FAILED for $env" >&2
    exit 1
  fi
  echo "Secrets check passed for $env"
}

cmd_set() {
  local env=$1 name=${2:-}
  [ -n "$name" ] || usage
  local valid=0 n
  for n in "${CREDENTIAL_SECRETS[@]}" app-config; do
    [ "$n" = "$name" ] && valid=1
  done
  [ "$valid" -eq 1 ] || { echo "Error: unknown secret '$name'" >&2; exit 1; }
  [ -t 0 ] && echo "Reading value for $PREFIX/$env/$name from stdin (Ctrl-D to finish)..." >&2

  local path
  # Global so the EXIT trap can still see it after the function returns
  SECRET_TMP=$(mktemp)
  trap 'rm -f "$SECRET_TMP"' EXIT
  local tmp=$SECRET_TMP
  chmod 600 "$tmp"
  # Command substitution strips the trailing newline that `echo` adds
  printf '%s' "$(cat)" >"$tmp"
  [ -s "$tmp" ] || { echo "Error: empty value" >&2; exit 1; }
  path=$tmp
  command -v cygpath >/dev/null && path=$(cygpath -w "$tmp")

  local id="$PREFIX/$env/$name"
  if aws_sm describe-secret --secret-id "$id" >/dev/null 2>&1; then
    aws_sm put-secret-value --secret-id "$id" --secret-string "file://$path" >/dev/null
    echo "Updated $id"
  else
    aws_sm create-secret --name "$id" --secret-string "file://$path" >/dev/null
    echo "Created $id"
  fi
}

case "${1:-}" in
  check) validate_env "${2:-}"; cmd_check "$2" ;;
  set) validate_env "${2:-}"; cmd_set "$2" "${3:-}" ;;
  *) usage ;;
esac
