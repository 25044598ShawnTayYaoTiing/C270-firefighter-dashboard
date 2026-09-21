# FA contribution owner: Kaung Min Khant
# Purpose: Packages static assets behind a pinned Nginx gateway with validated
# runtime backend routing and a container-local health check.
# Demo focus: Explain runtime BACKEND_URL templating, port 80, and the healthy JSON response.

# The pinned Nginx image receives only static assets, gateway configuration, and validation logic.
# Its standard entrypoint validates BACKEND_URL before rendering the configuration.
FROM nginx:1.31.6-alpine@sha256:adad2ae9204d0fd7a34f40299bc838c3782be1293b10005eac4315ff5a1abf4e

COPY public /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY frontend/validate-backend-url.sh /docker-entrypoint.d/05-validate-backend-url.sh

RUN chmod +x /docker-entrypoint.d/05-validate-backend-url.sh

# The frontend runtime exposes Nginx and proves its own health before receiving traffic.
# Demo focus: Show that the probe checks the exact {"status":"ok"} contract.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/health | grep -q '"status":"ok"' || exit 1
