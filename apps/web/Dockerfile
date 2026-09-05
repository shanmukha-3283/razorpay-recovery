# ---- Builder: compile the Vite app to static assets ----
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @razorpay-recovery/web...

COPY apps/web apps/web

# VITE_API_URL is baked at build time. Default points at the public API so
# Render deploys (which can't take build args via Blueprint) work with zero
# dashboard configuration; override with --build-arg for other environments.
# Leave empty (VITE_API_URL=) to fall back to same-origin "/api" served
# through the nginx /api proxy (local compose path).
ARG VITE_API_URL=https://razorpay-recovery-api-0qtm.onrender.com/api
ENV VITE_API_URL=${VITE_API_URL}
# Token baked at build time so the dashboard always sends a bearer the API
# recognizes; Render doesn't inject VITE_* into the docker build env, so the
# value is pinned here to match the API service's DASHBOARD_API_TOKEN.
ARG VITE_DASHBOARD_API_TOKEN=8a95b442efd3855a4191568b9a51f145
ENV VITE_DASHBOARD_API_TOKEN=${VITE_DASHBOARD_API_TOKEN}
RUN pnpm --filter @razorpay-recovery/web build

# ---- Runtime: nginx serving static assets + /api reverse proxy ----
# The entrypoint renders nginx.conf.template with API_HOST/API_PORT and
# NGINX_PORT (Render injects PORT), so the same image works locally
# (api:3000, :80) and on Render (private service host + assigned port).
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["/docker-entrypoint.sh"]
