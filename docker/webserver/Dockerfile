# =============================================================================
# docker/webserver/Dockerfile
# OSPF Country Topology — Nginx reverse-proxy container
# =============================================================================
#
# PURPOSE
# ───────
# Nginx reverse proxy that sits in front of the patched Flask app.
# Identical to topolograph-docker/webserver/Dockerfile — reproduced here
# so this project's docker-compose.yml is fully self-contained.
#
# ENVIRONMENT VARIABLES (set by docker-compose.yml / .env)
# ──────────────────────────────────────────────────────────
#   TOPOLOGRAPH_PORT   — external port nginx listens on (default 8081)
#   MCP_PORT           — MCP server port for routing /mcp/* (default 8000)
#
# =============================================================================

FROM nginx:latest

LABEL maintainer="OSPF Country Topology Webserver"
LABEL description="Nginx reverse proxy for Topolograph Flask app"

# Install envsubst (for runtime config templating)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gettext-base && \
    ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log && \
    mkdir -p /run/nginx && \
    rm -f /etc/nginx/conf.d/default.conf && \
    rm -rf /var/lib/apt/lists/*

COPY templates/app.conf.template /etc/nginx/conf.d/app.conf.template
COPY start-nginx.sh /start-nginx.sh
RUN chmod +x /start-nginx.sh

EXPOSE 8081
CMD ["/start-nginx.sh"]
