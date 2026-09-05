#!/bin/sh
# Renders nginx.conf.template with runtime env, then starts nginx.
# NGINX_PORT defaults to Render's $PORT, falling back to 80 locally.
set -e
export NGINX_PORT="${PORT:-80}"
export API_HOST="${API_HOST:-api}"
export API_PORT="${API_PORT:-3000}"
export RESOLVER=$(awk '$1=="nameserver" && $2 !~ /:/ {print $2; exit}' /etc/resolv.conf)
# Fall back to Docker's embedded DNS when no IPv4 nameserver is listed.
# (Must be a single IPv4 address: nginx parses colons as host:port, so a
# raw IPv6 nameserver or a space-separated list crashes nginx on boot.)
if [ -z "$RESOLVER" ]; then RESOLVER="127.0.0.11"; fi
envsubst '$NGINX_PORT $API_HOST $API_PORT $RESOLVER' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
