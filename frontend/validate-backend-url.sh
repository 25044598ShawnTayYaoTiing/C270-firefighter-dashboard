#!/bin/sh
set -eu

backend_url="${BACKEND_URL:-}"

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

case "$backend_origin" in
  ""|*/*|*\?*|*\#*)
    echo "BACKEND_URL must be an origin without a path, query, or fragment." >&2
    exit 1
    ;;
esac
