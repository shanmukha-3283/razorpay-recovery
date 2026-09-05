# ---- Builder: install workspace deps and compile the API ----
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# Workspace manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @razorpay-recovery/api...

# Build only the API (tsconfig.build.json excludes tests).
COPY apps/api apps/api
RUN pnpm --filter @razorpay-recovery/api build

# ---- Runtime: production dependencies + compiled output only ----
FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --prod --frozen-lockfile --filter @razorpay-recovery/api... \
  && pnpm store prune

COPY --from=builder /repo/apps/api/dist ./apps/api/dist
# Migration SQL must ship with the image so first boot on a fresh database
# can self-initialize (runMigrations resolves ../../migrations from dist/db).
COPY apps/api/src/db/migrations ./apps/api/migrations
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health > /dev/null 2>&1 || exit 1
CMD ["./apps/api/docker-entrypoint.sh"]
