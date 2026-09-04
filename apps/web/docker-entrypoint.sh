#!/bin/sh
# Renders nginx.conf.template with runtime env, then starts nginx.
# NGINX_PORT defaults to Render's $PORT, falling back to 80 locally.
set -e
export NGINX_PORT="${PORT:-80}"
export API_HOST="${API_HOST:-api}"
export API_PORT="${API_PORT:-3000}"
export RESOLVER=$(awk 'BEGIN{ORS=" "} $1=="nameserver" {print $2}' /etc/resolv.conf)
envsubst '$NGINX_PORT $API_HOST $API_PORT $RESOLVER' \
  < /etc/nginx/conf.d/default.conf.template \
  > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
