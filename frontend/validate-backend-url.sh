#!/bin/sh
# FA responsibility: Min — frontend runtime configuration validation
set -eu

backend_url="${BACKEND_URL:-}"

if [ -z "$backend_url" ]; then
  echo "BACKEND_URL is required. Set an http:// or https:// origin, for example http://backend:3000." >&2
  exit 1
fi

case "$backend_url" in
  http://*|https://*)
    ;;
  *)
    echo "BACKEND_URL must be an http:// or https:// origin without a path." >&2
    exit 1
    ;;
esac

backend_origin="${backend_url#http://}"
backend_origin="${backend_origin#https://}"

if ! printf '%s\n' "$backend_url" |
  grep -Eq '^https?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]{1,5})?$'; then
  echo "BACKEND_URL must be a valid origin without credentials, whitespace, a path, query, or fragment." >&2
  exit 1
fi

backend_port=""
case "$backend_origin" in
  \[*\]:*)
    backend_port="${backend_origin##*:}"
    ;;
  \[*\])
    ;;
  *:*)
    backend_port="${backend_origin##*:}"
    ;;
esac

if [ -n "$backend_port" ] &&
  { [ "$backend_port" -lt 1 ] || [ "$backend_port" -gt 65535 ]; }; then
  echo "BACKEND_URL port must be between 1 and 65535." >&2
  exit 1
fi
