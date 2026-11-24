# Use the official Node.js 20 LTS image for better compatibility
FROM node:20.20.2-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Install essential build tools and OpenSSL for JWT generation
RUN apk add --no-cache \
    libc6-compat \
    openssl \
    openssl-dev \
    python3 \
    make \
    g++
WORKDIR /app

# Skip Playwright browser download in Docker builds (not needed for production)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  if [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Install OpenSSL for build-time operations
RUN apk add --no-cache openssl openssl-dev

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variable to skip telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# No build args: all environment-specific config is read at runtime from the
# environment (injected by ECS from AWS Secrets Manager), so one image serves
# every environment.

# Build the application
# Note: node_modules is already copied from deps stage. Use npx to run the build
# script directly, avoiding corepack's attempt to re-download pnpm (which fails
# behind corporate TLS-intercepting proxies).
RUN npx next build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Install runtime dependencies: wget for healthcheck, openssl for JWT operations, curl for debugging
RUN apk add --no-cache \
    wget \
    curl \
    openssl \
    openssl-dev \
    ca-certificates \
    tzdata && \
    update-ca-certificates

# Create user and group for running the application
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir -p .next && \
    chown -R nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Credentials and config are never baked into the image. ECS injects them from
# AWS Secrets Manager (see deploy/aws/app/templates/containers.json.tpl).
# Locally: docker run --env-file .env.local -p 3000:3000 <image>

# Ensure proper permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Enhanced health check with longer start period for Next.js + Snowflake initialization
# start-period=120s matches ECS service health_check_grace_period to prevent premature failures
# This prevents AWS Config cost spikes from task churn during deployments
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]