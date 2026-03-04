#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 02-confirm-stopped.sh  —  Verify Topolograph is fully offline
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS CHECKS:
#   1. No Docker containers are in "running" state
#   2. http://localhost:8081 does NOT respond
#
# WHY THIS MATTERS:
#   Before rebuilding, you must be certain the old containers are gone.
#   Running "docker compose build" while containers are live can cause
#   stale image caches and race conditions.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}═══ STEP 2 — Confirm App is Offline ═══${RESET}"
echo ""

cd "$DOCKER_DIR"
RUNNING=$(docker compose ps --status running --format "{{.Name}}" 2>/dev/null | wc -l | tr -d ' ')

if [ "$RUNNING" -eq 0 ]; then
    echo -e "  ${GREEN}✅  Docker containers: NONE running${RESET}"
else
    echo -e "  ${RED}❌  $RUNNING container(s) still running:${RESET}"
    docker compose ps --status running
    exit 1
fi

if curl -s --max-time 2 http://localhost:8081 > /dev/null 2>&1; then
    echo -e "  ${RED}❌  http://localhost:8081 is still reachable — unexpected!${RESET}"
    exit 1
else
    echo -e "  ${GREEN}✅  http://localhost:8081 : NOT reachable (correct)${RESET}"
fi

echo ""
echo -e "  ${YELLOW}Full container status:${RESET}"
docker compose ps 2>/dev/null
echo ""
echo -e "  ${GREEN}${BOLD}App is fully offline. Safe to rebuild or restart.${RESET}"
echo ""
echo -e "  ${RESET}If you have code changes → run: 03-rebuild-app.sh${RESET}"
echo -e "  ${RESET}If no changes needed    → run: 04-start-app.sh${RESET}"
