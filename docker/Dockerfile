# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-only
#
# Multi-stage build: compile the static site, then serve it with unprivileged nginx.
# The final image contains only nginx + the built files (no Node, no sources).

# ---- Stage 1: build ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src

# Install dependencies first (cached unless a package.json / lockfile changes).
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/plc-engine/package.json packages/plc-engine/
COPY packages/sim/package.json packages/sim/
COPY packages/factory/package.json packages/factory/
COPY packages/content/package.json packages/content/
RUN npm ci --no-audit --no-fund

# Then the sources + content (YAML is compiled into the bundle).
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
COPY content content
RUN npm run build

# ---- Stage 2: runtime -------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="ControlsLab" \
      org.opencontainers.image.description="Open-source industrial controls trainer (PLC + troubleshooting)" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/Installation-04/controlslab"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html

# nginx-unprivileged runs as uid 101 and listens on 8080.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
