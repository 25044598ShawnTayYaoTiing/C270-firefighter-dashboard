# FA contribution owner: Kaung Khant Thein
# Purpose: Builds a minimal production backend with locked dependencies and a
# pinned distroless, non-root Node.js runtime.
# Demo focus: Explain the two stages, reduced runtime contents, and /health probe.

# Dependency stage installs exactly the production packages recorded in package-lock.json.
# The next stage copies only this resolved dependency tree into the runtime image.
FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage removes package managers and shells, then runs as the distroless non-root user.
# Demo focus: Point out the pinned digest and that build tooling never reaches production.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167 AS runtime

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
