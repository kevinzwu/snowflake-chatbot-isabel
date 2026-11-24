# Isabel

Chat interface for security vulnerability management, built on Snowflake Cortex
Agents. Next.js 16 (App Router), React 19, TypeScript, Tailwind. Apache-2.0.

Flow: browser, Azure AD sign-in, the app signs a short-lived Snowflake JWT, the
browser streams the Cortex Agent's answer over SSE. Details in `docs/architecture.md`.

## After every change

Run these and fix failures before calling the task done:

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
```

pnpm is required (`corepack enable`). `.npmrc` uses `node-linker=hoisted` so the
Docker standalone output resolves modules; keep it copied before `pnpm install`
in the Dockerfile.

## Run it

```bash
pnpm demo    # no accounts: Dev Login and canned answers (see .env.demo.example)
pnpm dev     # against your own Snowflake (.env.local from .env.example)
```

`docs/development.md` has the full command list and troubleshooting.

## Layout

```
app/                  Next.js routes and UI (app/components, app/api)
lib/agent-api/        Cortex Agent streaming: useAgentAPIQuery.ts is the state machine
lib/auth/, lib/auth-config.ts, middleware.ts   Sign-in, groups, route protection
lib/snowflake/        Key-pair JWT generation
lib/security/         Rate limiting, service-account OAuth, file validation
lib/dynamodb/         Conversations, saved queries, profiles (S3 overflow over 350 KB)
lib/config/app-config.ts   Zod-validated runtime config, checked at start-up
lib/demo.ts, lib/demo/, app/api/mock-snowflake/   Demo mode
examples/             Sample dataset, semantic model and agent specification
bin/                  Deploy, secrets and local-setup scripts
deploy/aws/           Terraform (bootstrap/ and app/)
docs/                 Documentation
e2e/, tests/          Playwright, security tests, live prompt and schema checks
```

## Configuration

All settings are environment variables, validated at start-up
(`lib/config/app-config.ts`); the app exits listing every bad key. Reference:
`docs/configuration.md`. Deployed environments read them from AWS Secrets Manager
(`<name>/<env>/...`, managed with `bin/secrets.sh`). Never hardcode secrets,
account IDs, hostnames or regions.

## Conventions

- TypeScript strict mode; explicit return types on exported functions; prefer `unknown` to `any`.
- Functional components; Server Components by default, `"use client"` only when needed.
- Early returns; small functions; no abstraction until the third repetition.
- Tests next to the code as `*.test.ts(x)`. Name them "should ..."; Arrange, Act, Assert.
  Security-sensitive paths (auth, validation, rate limits) need full coverage.
- Validate input at boundaries, fail closed on missing authorization config, and log security events.
- Do not add comments or type annotations to code you did not change.
- In examples and tests use `example.com` and the documentation IP ranges
  (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24). No real names, accounts or hosts.

## Demo mode safety

`DEV_AUTH` and `MOCK_SNOWFLAKE` are honored only when `NODE_ENV !== "production"`
(`lib/demo.ts`), and `instrumentation-node.ts` exits if either is set in
production. Do not weaken that. `middleware.ts` exposes `/api/mock-snowflake`
without a session only while the mock is enabled.

## Semantic model and agents

Every dimension in `examples/semantic_model.yaml` needs an `expr`. Keep the
descriptions in the semantic model and in `examples/agent.json` in step when
you add tables. `bin/deploy-agent.sh` creates the agents from `examples/agent.json`.

## AWS

Terraform is in `deploy/aws/` (see its README). Use `AWS_PROFILE` and `AWS_REGION`
from the environment; scripts take no hardcoded profile or region. Never run
`terraform apply` or create billable resources without the owner's go-ahead.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
