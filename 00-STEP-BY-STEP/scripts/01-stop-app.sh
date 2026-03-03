#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 01-stop-app.sh  —  Completely stop Topolograph (all Docker containers)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}Step 1 — Stopping Topolograph${RESET}"
echo -e "${CYAN}  Docker project: $DOCKER_DIR${RESET}"
echo ""

# Bring down all containers AND remove orphaned ones
cd "$DOCKER_DIR"
docker compose down --remove-orphans

echo ""
# Verify nothing is listening on port 8081
if curl -s --max-time 2 http://localhost:8081 > /dev/null 2>&1; then
    echo -e "  ${RED}❌  Port 8081 still responding — check for other processes.${RESET}"
    exit 1
fi

echo -e "  ${GREEN}✅  All containers stopped. App is fully offline.${RESET}"
echo ""
docker compose ps 2>/dev/null || true
