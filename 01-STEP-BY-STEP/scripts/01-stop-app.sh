#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 01-stop-app.sh  —  Completely stop Topolograph (all Docker containers)
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS DOES:
#   Sends a graceful shutdown to all 4 containers:
#     flask, webserver, mongodb, mcp-server
#   Networks are also removed. MongoDB data is preserved in Docker volumes.
#
# WHEN TO RUN:
#   - Before a rebuild (you edited topolograph.js or updated Docker images)
#   - When you want a completely clean state
#   - To confirm the app is fully offline before diagnosing issues
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}═══ STEP 1 — Stop Topolograph ═══${RESET}"
echo -e "${CYAN}  Docker project: $DOCKER_DIR${RESET}"
echo ""

cd "$DOCKER_DIR"
docker compose down --remove-orphans

echo ""

# Verify port 8081 is no longer answering
if curl -s --max-time 2 http://localhost:8081 > /dev/null 2>&1; then
    echo -e "  ${RED}❌  Port 8081 still responding — another process may be running.${RESET}"
    exit 1
fi

echo -e "  ${GREEN}✅  All containers stopped. App is fully offline.${RESET}"
echo ""
docker compose ps 2>/dev/null || true
echo ""
echo -e "  ${CYAN}Next step → run: 02-confirm-stopped.sh${RESET}"
