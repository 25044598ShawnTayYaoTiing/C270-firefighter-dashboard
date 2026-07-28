FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:a2723a2817c5b01b8e7b98d567bc8b5a6b0e713e25bfb0a82b6ade4b9db06f50 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=dependencies --chown=65532:65532 /app/node_modules ./node_modules

# Keep documentation, tests, and the frontend build files out of the backend image.
# Copy directories separately so their runtime-relative paths remain intact.
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

EXPOSE 3000

USER 65532

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["app.js"]
