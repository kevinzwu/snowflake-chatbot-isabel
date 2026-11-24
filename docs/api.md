# API

Isabel has two kinds of callers: people in a browser, and automation using the
service account API. Both end up calling Snowflake Cortex Agents with a
short-lived key-pair JWT.

## Interactive users

Sign in with Azure AD (NextAuth). The browser then calls `GET /api/jwt` about
once a minute to get a Snowflake JWT and calls the Snowflake agent endpoint
directly with it, which streams the answer as server-sent events.

| Endpoint                              | Method         | Auth            | Purpose                                                              |
| ------------------------------------- | -------------- | --------------- | -------------------------------------------------------------------- |
| `/api/health`                         | GET            | none            | Load balancer health check.                                          |
| `/api/auth/*`                         | GET, POST      | none            | NextAuth routes.                                                     |
| `/api/jwt`                            | GET            | session + group | Snowflake JWT for the signed-in user (30 per minute).                |
| `/api/conversations`                  | GET, POST, ... | session + group | Chat history. Large conversations overflow to S3.                    |
| `/api/saved-queries`, `/api/profiles` | GET, POST, ... | session + group | Saved prompts and user profiles.                                     |
| `/api/shared/[shareToken]`            | GET            | session + group | Read a shared conversation.                                          |
| `/api/feedback`                       | POST           | session + group | Thumbs up or down on an answer, sent to Snowflake.                   |
| `/api/v1/extract-text`                | POST           | session + group | Text from an uploaded PDF, CSV, DOCX or image (10 MB, 5 per minute). |
| `/api/v1/service-token`               | POST           | Azure AD bearer | Service accounts. See below.                                         |

Unauthenticated calls to protected routes return `401`; signed-in users outside
the allowed groups get `403`. Rate limits are per user and held in memory, so
they apply per container.

## Service account API

`POST /api/v1/service-token` exchanges an Azure AD client-credentials token for
a Snowflake JWT, for scheduled jobs and integrations that have no browser.

What Isabel checks: the token signature against your tenant's JWKS, that the
issuer is your tenant, that the audience is Isabel's own app registration, and
that the calling client ID is in the `OAUTH_SERVICE_ACCOUNTS` allowlist and
enabled. Each client is limited to 10 requests a minute. Every call is logged
with the client ID.

### Set up a client

1. In Azure AD, expose an application permission (app role) on Isabel's app
   registration, for example `application.access_as_service`.
2. Register the calling application, give it a client secret, add that
   application permission under **API permissions**, and grant admin consent.
3. Allowlist it in the `oauth-service-accounts` secret:

```json
[
  {
    "clientId": "00000000-0000-0000-0000-000000000000",
    "name": "Nightly report job",
    "scopes": ["snowflake:read"],
    "enabled": true
  }
]
```

`scopes` is recorded for audit. Real access is whatever the Snowflake role of the
app's service user (`ISABEL_APP_ROLE`) can do, which should be read-only.

### Call it

```bash
TENANT_ID=<your tenant id>
ISABEL_APP_ID=<Isabel's app registration client id>

OAUTH_TOKEN=$(curl -s -X POST "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
  -d grant_type=client_credentials \
  -d client_id="${CLIENT_ID}" \
  -d client_secret="${CLIENT_SECRET}" \
  -d scope="api://${ISABEL_APP_ID}/.default" | jq -r .access_token)

curl -s -X POST "https://isabel.example.com/api/v1/service-token" \
  -H "Authorization: Bearer ${OAUTH_TOKEN}"
# {"token":"eyJ...","expiresAt":1707699480,"serviceAccountId":"Nightly report job","scopes":["snowflake:read"]}
```

The JWT lasts two minutes. Use it against the agent endpoint:

```bash
curl -N -X POST "https://<account>.snowflakecomputing.com/api/v2/databases/ISABEL_SAMPLE/schemas/SECURITY/agents/ISABEL:run" \
  -H "Authorization: Bearer ${SNOWFLAKE_JWT}" \
  -H "X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"How many open host vulnerabilities are there by severity?"}]}]}'
```

The orchestration model is set on the agent object, not in the request body.

### Errors

| Status | Meaning                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| 401    | Missing, malformed, expired or wrongly signed token; wrong issuer or audience. |
| 403    | The client is not in `OAUTH_SERVICE_ACCOUNTS`, or is disabled.                 |
| 429    | More than 10 requests a minute. `Retry-After` says when to retry.              |
| 405    | Anything but `POST`.                                                           |
