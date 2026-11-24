# Development

## Requirements

Node.js 20 or newer, [pnpm](https://pnpm.io) (via `corepack enable`), and Docker.

```bash
pnpm install
```

## Run it with no accounts (demo mode)

```bash
pnpm demo
```

This creates `.env.local` from `.env.demo.example`, generates a throwaway key,
starts DynamoDB Local and a local S3 store with Docker, creates the table and
bucket, and starts the dev server on http://localhost:3000. Click **Dev Login**.
Every question gets the same canned answer (a table, a chart and follow-up
suggestions), which is enough to work on the UI.

Existing files are never overwritten. Delete `.env.local` and re-run to reset.

## Run it against your own Snowflake

1. Set up the sample data and agents: [snowflake-setup.md](snowflake-setup.md).
2. `cp .env.example .env.local` and fill in the `<...>` values.
3. Start the local stores and the app:

```bash
docker compose up -d
node bin/setup-local-dynamodb.js
node bin/setup-local-s3.js
pnpm dev
```

Sign-in uses Azure AD. For a local run without Azure AD, add `DEV_AUTH=true` and
`ALLOWED_AZURE_AD_GROUPS=local-dev` to `.env.local`; Snowflake stays real.

## Commands

| Command                                                         | What it does                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                                                      | Dev server with Turbopack.                                       |
| `pnpm lint`                                                     | ESLint. Must pass with no errors.                                |
| `pnpm typecheck`                                                | `tsc --noEmit`. Must pass.                                       |
| `pnpm test`                                                     | Unit tests (Vitest).                                             |
| `pnpm format` / `pnpm format:check`                             | Prettier.                                                        |
| `pnpm build`                                                    | Production build (standalone output).                            |
| `pnpm exec playwright test`                                     | End-to-end tests. Starts `next dev` and signs in with Dev Login. |
| `pnpm exec playwright test --grep-invert "@live\|@integration"` | The set that needs no external services.                         |

Tests tagged `@live` or `@integration` need a real Snowflake account and, for
a few, Azure AD credentials (`E2E_AUTH=azure`, `E2E_TEST_USER_EMAIL`,
`E2E_TEST_USER_PASSWORD`).

## Prompt and schema checks

`tests/prompt-qa` asks the live agent the sample questions and checks the
answers against the sample data. `tests/schema-qa` checks that the semantic model
matches the tables. Both need the sample dataset deployed and `.env.local`
pointing at it, and are separate Vitest configs:

```bash
pnpm exec vitest run --config vitest.config.prompt-qa.ts
pnpm exec vitest run --config vitest.config.schema-qa.ts
```

## Conventions

- TypeScript strict mode, explicit types on exported functions.
- Components in `app/components`; hooks and helpers in `lib/`.
- Every change needs a test. Unit tests sit next to the file as `*.test.ts`.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before opening a pull request.

## pnpm and Docker

`.npmrc` sets `node-linker=hoisted`. The standalone Docker image does not
preserve pnpm's internal symlinks, so a hoisted `node_modules` is what keeps
`serverExternalPackages` resolvable at runtime. Keep `.npmrc` copied in the
Dockerfile before `pnpm install`.

## Troubleshooting

| Symptom                                | Check                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| App exits at start listing config keys | A required key in `.env.local` is missing. The message names each one.                |
| JWT errors                             | The private key must be PKCS#8, and the public key must be set on the Snowflake user. |
| Dev Login button missing               | `DEV_AUTH=true` is not set, or `NODE_ENV` is `production`.                            |
| Saving a long conversation fails       | `CONVERSATION_S3_BUCKET` and the local S3 store (`docker compose up -d s3`).          |
| "Loading Isabel..." for a long time    | First request after start compiles pages. Wait, or check the server log.              |
