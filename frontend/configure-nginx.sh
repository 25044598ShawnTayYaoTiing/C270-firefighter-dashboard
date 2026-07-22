#!/bin/sh
set -eu

backend_url="${BACKEND_URL:-http://backend:3000}"
sed "s|__BACKEND_URL__|${backend_url}|g" \
  /etc/nginx/backend.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"
