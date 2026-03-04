#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 03-rebuild-app.sh  —  Pull latest images + rebuild webserver (on updates)
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
# WHEN TO RUN:
#   - After editing topolograph.js (the custom Country Filter UI code)
#   - After a new upstream Topolograph Docker image is released
#   - If the Country Filter panel is missing or JS changes aren't visible
#
# SKIP IF: You are doing a normal restart with no code changes.
#           Go directly to 04-start-app.sh in that case.
#
# WHAT HAPPENS:
#   1. docker compose pull  → fetches latest flask + mcp-server from Docker Hub
#   2. docker compose build --no-cache webserver
#                           → rebuilds the Nginx image from scratch
#                           → bakes in the latest topolograph.js bind mount
#                           → --no-cache ensures nothing is served from stale layers
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}═══ STEP 3 — Rebuild Topolograph (pull + build) ═══${RESET}"
echo ""

cd "$DOCKER_DIR"

echo -e "  ${CYAN}[3a] Pulling latest upstream images (flask, mcp-server)…${RESET}"
docker compose pull flask mcp-server 2>&1 | grep -E "Pulling|Pulled|up to date" | sed 's/^/     /'

echo ""
echo -e "  ${CYAN}[3b] Rebuilding webserver (Nginx + topolograph.js) with --no-cache…${RESET}"
docker compose build --no-cache webserver 2>&1 | grep -E "^#[0-9]|DONE|CACHED|ERROR" | tail -15 | sed 's/^/     /'

echo ""
echo -e "  ${GREEN}✅  Rebuild complete.${RESET}"
echo -e "  ${YELLOW}     What changed: the Country Filter panel code is now baked into the Nginx image.${RESET}"
echo ""
echo -e "  ${RESET}Next step → run: 04-start-app.sh${RESET}"
