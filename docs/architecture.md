# Architecture

Isabel is a chat front end for a Snowflake Cortex Agent. The agent turns
questions into SQL (Cortex Analyst) and text search (Cortex Search) over your
data; Isabel handles sign-in, streaming, history and presentation.

```
Browser ──(Azure AD sign-in)──► Next.js app on ECS Fargate ──► DynamoDB, S3
   │                                  │
   │  GET /api/jwt (every ~60 s)      └─ signs a 2-minute RS256 JWT with the
   │◄─────────────────────────────────   service user's private key
   │
   └──(JWT)──► Snowflake  /api/v2/.../agents/<AGENT>:run  ──► SSE stream
                              │
                              ├─ cortex_analyst_text_to_sql ─► semantic model ─► warehouse
                              └─ cortex_search ──────────────► Cortex Search service
```

## Request flow

1. The user signs in with Azure AD. NextAuth issues a session cookie (8 hours,
   JWT strategy). The middleware requires a session for every page and API route
   except a short public list, and checks that one of the user's Azure AD groups is
   in `ALLOWED_AZURE_AD_GROUPS` or `ADMIN_AZURE_AD_GROUPS`. With no groups
   configured it denies everyone.
2. The browser asks `/api/jwt` for a Snowflake JWT. The server signs it with the
   service user's private key. The key never reaches the browser.
3. The browser calls the Snowflake agent endpoint with that JWT and reads the
   server-sent event stream. `lib/agent-api/useAgentAPIQuery.ts` is the state
   machine: thinking, tool use, SQL results, charts and text arrive as separate events.
4. When the answer finishes, the conversation is saved through `/api/conversations`.

Because the browser calls Snowflake directly, the Content Security Policy allows
`connect-src https://*.snowflakecomputing.com`, and the Snowflake account must
allow cross-origin requests from the app's origin.

## Pieces

| Area              | Where                                                                 | Notes                                                             |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Chat UI           | `app/`, `app/components/`                                             | Next.js App Router, React 19, Tailwind.                           |
| Agent streaming   | `lib/agent-api/`                                                      | Event parsing, tool state, post-processing of answer text.        |
| Auth and groups   | `lib/auth-config.ts`, `lib/auth/`, `middleware.ts`                    | Azure AD, group authorization, session revocation.                |
| Snowflake JWT     | `lib/snowflake/jwt-generator.ts`                                      | Key-pair auth. Key from `SNOWFLAKE_RSA_KEY` or `.key/rsa_key.p8`. |
| Service accounts  | `lib/security/oauth-service-accounts.ts`, `app/api/v1/service-token/` | Azure AD client credentials.                                      |
| Rate limiting     | `lib/security/rate-limiter.ts`                                        | Sliding window, in memory, per container.                         |
| Upload validation | `lib/security/file-validator.ts`                                      | Type, size, magic bytes and content checks.                       |
| Storage           | `lib/dynamodb/`                                                       | Conversations, saved queries, profiles. Over 350 KB goes to S3.   |
| Runtime config    | `lib/config/app-config.ts`                                            | Zod-validated at start-up. Exits listing every bad key.           |
| Demo mode         | `lib/demo.ts`, `lib/demo/`, `app/api/mock-snowflake/`                 | Dev Login and canned answers. Never active in production.         |

## Data

Three DynamoDB tables, named `<name>-<environment>-conversations`, `-saved-queries`
and `-user-profiles`, all keyed by user. Conversations have a time-to-live. Message
bodies over 350 KB are gzipped to the S3 bucket `<name>-<environment>-conversations`
and the table keeps a pointer plus a search excerpt.

## Security

- Sign-in is Azure AD only; authorization is by group and fails closed.
- The Snowflake private key lives in Secrets Manager and only the server reads it.
- JWTs live two minutes. The Snowflake service user is key-pair only (no password)
  and its role should have read access only.
- Uploads are checked by type, size, magic bytes and content before extraction.
- Responses carry security headers; the CSP restricts where the page can connect.
- Demo flags (`DEV_AUTH`, `MOCK_SNOWFLAKE`) are ignored in production, and the
  server refuses to start if they are set there.
- Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).

## Deployment shape

ECS Fargate service behind an Application Load Balancer; secrets injected from
Secrets Manager by the task definition; DynamoDB and S3 for state. See
[deployment.md](deployment.md) and [deploy/aws/README.md](../deploy/aws/README.md).
