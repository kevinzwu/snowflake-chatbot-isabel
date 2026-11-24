# Configuration

Isabel is configured entirely through environment variables. Locally they come
from `.env.local` (copy `.env.example`). In AWS they come from Secrets Manager
through the ECS task definition. The app validates its non-secret config at
startup and exits with every bad key listed, so a missing value fails the
deploy rather than a request.

## Non-secret app config

Stored together as one JSON secret, `<name>/<environment>/app-config`, with one
key per variable below. `NEXTAUTH_URL` is the exception: Terraform sets it on
the task from the load balancer or domain.

| Key                   | Required | Description                                                                               |
| --------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `SNOWFLAKE_URL`       | yes      | Account URL, `https://<account>.snowflakecomputing.com`. Absolute, no trailing path.      |
| `SNOWFLAKE_DATABASE`  | yes      | Database that holds the agents, semantic model stage and search service.                  |
| `SNOWFLAKE_SCHEMA`    | yes      | Schema in that database.                                                                  |
| `SNOWFLAKE_WAREHOUSE` | yes      | Warehouse the agent's SQL runs on.                                                        |
| `AGENT_NAME`          | yes      | Default agent (the "Sonnet" choice in the model selector).                                |
| `OPUS_AGENT_NAME`     | no       | Agent for the "Opus" choice. Leave empty to hide it.                                      |
| `HAIKU_AGENT_NAME`    | no       | Agent for the "Haiku" choice. Leave empty to hide it.                                     |
| `SEMANTIC_MODEL_PATH` | yes      | `@DATABASE.SCHEMA.STAGE/file.yaml`                                                        |
| `SEARCH_SERVICE_PATH` | yes      | `DATABASE.SCHEMA.SERVICE` of the Cortex Search service.                                   |
| `SUGGESTED_QUERIES`   | no       | JSON array of strings shown as starter prompts. Empty uses the built-in sample questions. |
| `SUPPORT_URL`         | no       | If set, a help link appears in the page header.                                           |
| `MIP_LABEL_ID`        | no       | Microsoft Purview label ID embedded in Excel exports. Needs `MIP_TENANT_ID` too.          |
| `MIP_TENANT_ID`       | no       | Tenant ID for the label.                                                                  |
| `MIP_LABEL_NAME`      | no       | Display name of the label. Default `Confidential`.                                        |
| `NEXTAUTH_URL`        | yes      | Public base URL of the app. Also the base of share links.                                 |

## Credentials

Each is its own secret, `<name>/<environment>/<key>`, and its own environment
variable locally.

| Secret                     | Environment variable       | Description                                                                          |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `rsa-key`                  | `SNOWFLAKE_RSA_KEY`        | PKCS#8 private key of the Snowflake service user. PEM, base64 PEM, or PEM with `\n`. |
| `snowflake-rsa-passphrase` | `SNOWFLAKE_RSA_PASSPHRASE` | Key passphrase. Empty if the key is not encrypted.                                   |
| `snowflake-account`        | `SNOWFLAKE_ACCOUNT`        | `<ORGANIZATION>-<ACCOUNT>` identifier, used as the JWT issuer.                       |
| `snowflake-user`           | `SNOWFLAKE_USER`           | Service user name, for example `ISABEL_APP`.                                         |
| `nextauth-secret`          | `NEXTAUTH_SECRET`          | Session signing secret. `openssl rand -base64 32`.                                   |
| `azure-ad-client-id`       | `AZURE_AD_CLIENT_ID`       | Azure AD app registration used for sign-in.                                          |
| `azure-ad-client-secret`   | `AZURE_AD_CLIENT_SECRET`   | Its client secret.                                                                   |
| `azure-ad-tenant-id`       | `AZURE_AD_TENANT_ID`       | Directory (tenant) ID.                                                               |
| `allowed-azure-ad-groups`  | `ALLOWED_AZURE_AD_GROUPS`  | Comma-separated group object IDs allowed to sign in.                                 |
| `admin-azure-ad-groups`    | `ADMIN_AZURE_AD_GROUPS`    | Comma-separated group IDs with admin rights.                                         |
| `oauth-service-accounts`   | `OAUTH_SERVICE_ACCOUNTS`   | JSON array of allowlisted service clients, or `[]`. See [api.md](api.md).            |

Locally you can also set `SNOWFLAKE_RSA_KEY_PATH` (default `.key/rsa_key.p8`)
instead of `SNOWFLAKE_RSA_KEY`. `SNOWFLAKE_CORTEX_API_URL` optionally points
image text extraction at a different host.

Authorization is fail-closed: if neither group list is set, nobody can sign in.

## Managing the secrets

`bin/secrets.sh` creates, reads and checks them without echoing values or putting
them on a command line.

```bash
export AWS_PROFILE=<profile> AWS_REGION=<region>
export SECRETS_PREFIX=isabel                      # default; must match Terraform var.name

bin/secrets.sh set staging snowflake-account < value.txt
bin/secrets.sh set staging app-config < app-config.json
bin/secrets.sh check staging                      # all 11 credentials and every app-config key
```

`SECRETS_PREFIX` defaults to `isabel`. `AWS_REGION` falls back to
`AWS_DEFAULT_REGION` or your profile's region.

## Local-only variables

| Variable                                     | Description                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `DYNAMODB_LOCAL`, `DYNAMODB_ENDPOINT`        | Use DynamoDB Local (`docker compose`) instead of AWS.                          |
| `CONVERSATION_S3_BUCKET`, `S3_ENDPOINT`      | Overflow bucket for conversations over 350 KB, and its local endpoint.         |
| `S3_LOCAL_ACCESS_KEY`, `S3_LOCAL_SECRET_KEY` | Static credentials for the local S3 store. Required when `S3_ENDPOINT` is set. |
| `DEV_AUTH`, `MOCK_SNOWFLAKE`                 | Demo mode. See below.                                                          |

## Demo mode

`DEV_AUTH=true` replaces Azure AD with a "Dev Login" button that signs in one
local user in the group `local-dev` (put it in `ALLOWED_AZURE_AD_GROUPS`).
`MOCK_SNOWFLAKE=true` serves canned agent answers from `/api/mock-snowflake`;
point `SNOWFLAKE_URL` at `http://localhost:3000/api/mock-snowflake`.

Both are ignored when `NODE_ENV=production`, and the server refuses to start if
either is set there. `pnpm demo` sets everything up; see
[development.md](development.md).
