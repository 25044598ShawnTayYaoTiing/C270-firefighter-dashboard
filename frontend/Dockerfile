# FA responsibility: Min — frontend Dockerisation
FROM nginx:1.31.3-alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752

COPY public /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY frontend/validate-backend-url.sh /docker-entrypoint.d/05-validate-backend-url.sh

RUN chmod +x /docker-entrypoint.d/05-validate-backend-url.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/health | grep -q '"status":"ok"' || exit 1
