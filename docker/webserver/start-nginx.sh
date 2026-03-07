#!/bin/sh

# Substitute environment variables in nginx config
INTERNAL_BASIC_AUTH=$(printf '%s:%s' "${TOPOLOGRAPH_WEB_API_USERNAME_EMAIL}" "${TOPOLOGRAPH_WEB_API_PASSWORD}" | base64 | tr -d '\n')
export INTERNAL_BASIC_AUTH
envsubst '${TOPOLOGRAPH_PORT} ${MCP_PORT} ${INTERNAL_BASIC_AUTH}' < /etc/nginx/conf.d/app.conf.template > /etc/nginx/conf.d/app.conf

# Start nginx
nginx -g "daemon off;"
