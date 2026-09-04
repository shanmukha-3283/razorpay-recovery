# ---- Builder: compile the Vite app to static assets ----
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @razorpay-recovery/web...

COPY apps/web apps/web

# VITE_API_URL is baked at build time. Leave unset (default "/api") so the
# browser uses same-origin requests served through the nginx /api proxy.
# Override with --build-arg VITE_API_URL=https://<host>/api when needed.
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @razorpay-recovery/web build

# ---- Runtime: nginx serving static assets + /api reverse proxy ----
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
