# FA contribution owner: Kaung Khant Thein
# Purpose: Builds a minimal production backend with locked dependencies and a
# pinned distroless, non-root Node.js runtime.
# Demo focus: Explain the two stages, reduced runtime contents, and /health probe.

# Dependency stage installs exactly the production packages recorded in package-lock.json.
# The next stage copies only this resolved dependency tree into the runtime image.
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage removes package managers and shells, then runs as the distroless non-root user.
# Demo focus: Point out the pinned digest and that build tooling never reaches production.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=dependencies --chown=65532:65532 /app/node_modules ./node_modules

# Runtime application assembly copies only backend-required files with non-root ownership.
# Documentation, tests, and frontend build tooling remain outside the image.
# Demo focus: Show the explicit allowlist rather than a broad repository COPY.
COPY --chown=65532:65532 app.js ./app.js
COPY --chown=65532:65532 config ./config
COPY --chown=65532:65532 controllers ./controllers
COPY --chown=65532:65532 helpers ./helpers
COPY --chown=65532:65532 middleware ./middleware
COPY --chown=65532:65532 models ./models
COPY --chown=65532:65532 public ./public
COPY --chown=65532:65532 routes ./routes
COPY --chown=65532:65532 services ./services
COPY --chown=65532:65532 views ./views

# Runtime contract exposes the API port, enforces non-root execution, and probes /health.
# A healthy result is consumed by Compose and ECS before dependent traffic proceeds.
# Demo focus: Show user 65532 and the bounded HTTP health check.
EXPOSE 3000

USER 65532

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["app.js"]
