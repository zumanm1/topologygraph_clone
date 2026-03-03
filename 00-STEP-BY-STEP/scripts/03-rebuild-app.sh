#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 03-rebuild-app.sh  —  Pull latest images + rebuild webserver (run on updates)
# ─────────────────────────────────────────────────────────────────────────────
# When to run:
#   - After pulling new code from git (topolograph.js changes)
#   - After upstream Topolograph releases a new Docker image
#   - If the UI looks stale / JS changes not reflected
#
# SKIP this script if you just want a normal restart with no code changes.
# Use 04-start-app.sh directly in that case.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}Step 3 — Rebuilding Topolograph (pull + build)${RESET}"
echo ""

cd "$DOCKER_DIR"

# ── Pull latest upstream images (flask, mongodb, mcp-server) ─────────────────
echo -e "  ${CYAN}Pulling latest upstream images…${RESET}"
docker compose pull flask mcp-server 2>&1 | tail -5

# ── Rebuild webserver (Nginx) with --no-cache ─────────────────────────────────
echo ""
echo -e "  ${CYAN}Rebuilding webserver (Nginx) from Dockerfile…${RESET}"
docker compose build --no-cache webserver 2>&1 | grep -E "^#|Step|DONE|ERROR|Successfully" | tail -20

echo ""
echo -e "  ${GREEN}✅  Rebuild complete. Run 04-start-app.sh to start.${RESET}"
