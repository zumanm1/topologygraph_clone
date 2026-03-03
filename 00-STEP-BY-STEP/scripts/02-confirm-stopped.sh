#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 02-confirm-stopped.sh  —  Verify Topolograph is fully offline
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}Step 2 — Confirming App is Offline${RESET}"
echo ""

# 1. Check containers
cd "$DOCKER_DIR"
RUNNING=$(docker compose ps --status running --format "{{.Name}}" 2>/dev/null | wc -l | tr -d ' ')

if [ "$RUNNING" -eq 0 ]; then
    echo -e "  ${GREEN}✅  Docker containers: NONE running${RESET}"
else
    echo -e "  ${RED}❌  $RUNNING container(s) still running:${RESET}"
    docker compose ps --status running
    exit 1
fi

# 2. Check HTTP port
if curl -s --max-time 2 http://localhost:8081 > /dev/null 2>&1; then
    echo -e "  ${RED}❌  http://localhost:8081 is still reachable!${RESET}"
    exit 1
else
    echo -e "  ${GREEN}✅  http://localhost:8081 : NOT reachable (expected)${RESET}"
fi

# 3. Check docker process list
echo ""
echo -e "  ${YELLOW}Container status:${RESET}"
docker compose ps 2>/dev/null
echo ""
echo -e "  ${GREEN}${BOLD}App is fully offline. Safe to rebuild or restart.${RESET}"
