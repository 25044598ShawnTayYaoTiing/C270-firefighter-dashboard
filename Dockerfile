FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Keep documentation, tests, and the frontend build files out of the backend image.
# Copy directories separately so their runtime-relative paths remain intact.
COPY --chown=node:node app.js ./app.js
COPY --chown=node:node config ./config
COPY --chown=node:node controllers ./controllers
COPY --chown=node:node helpers ./helpers
COPY --chown=node:node middleware ./middleware
COPY --chown=node:node models ./models
COPY --chown=node:node public ./public
COPY --chown=node:node routes ./routes
COPY --chown=node:node services ./services
COPY --chown=node:node views ./views

ENV PORT=3000
EXPOSE 3000

USER node

CMD ["npm", "start"]
