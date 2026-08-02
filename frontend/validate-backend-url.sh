#!/bin/sh
# FA contribution owner: Kaung Min Khant
# Purpose: Validates runtime BACKEND_URL before Nginx renders or starts with an unsafe origin.
# Demo focus: Show that missing, credentialed, path-based, or invalid-port URLs fail closed.
set -eu

# Required-value and scheme checks stop immediately before Nginx configuration is generated.
# A valid value continues to strict origin-shape validation below.
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

# Strict origin validation rejects credentials, whitespace, paths, queries, and fragments.
# Demo focus: Use the container smoke test to show invalid configuration is rejected.
if ! printf '%s\n' "$backend_url" |
  grep -Eq '^https?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]{1,5})?$'; then
  echo "BACKEND_URL must be a valid origin without credentials, whitespace, a path, query, or fragment." >&2
  exit 1
fi

# Optional port extraction and range checking completes validation before Nginx starts.
# A valid origin leaves the standard entrypoint free to render the template and launch.
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
