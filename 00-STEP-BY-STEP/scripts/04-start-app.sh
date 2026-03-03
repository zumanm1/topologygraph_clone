#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 04-start-app.sh  —  Start Topolograph and wait until ready
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
BASE_URL="${BASE_URL:-http://localhost:8081}"

echo ""
echo -e "${BOLD}Step 4 — Starting Topolograph${RESET}"
echo ""

cd "$DOCKER_DIR"

# ── Start all containers in detached mode ─────────────────────────────────────
echo -e "  ${CYAN}Starting containers…${RESET}"
docker compose up -d 2>&1 | grep -E "Started|Created|Running|Error" | sed 's/^/  /'

# ── Wait for HTTP readiness ────────────────────────────────────────────────────
echo ""
echo -n "  Waiting for $BASE_URL to respond "
for i in $(seq 1 30); do
    if curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
        echo -e " ${GREEN}✅${RESET}"
        break
    fi
    echo -n "."; sleep 1
done

if ! curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
    echo -e "\n  ${RED}❌  App did not respond after 30s. Check: docker compose logs${RESET}"
    exit 1
fi

echo ""
echo -e "  ${GREEN}${BOLD}✅  Topolograph is running!${RESET}"
echo -e "  ${CYAN}  Web UI   → $BASE_URL${RESET}"
echo -e "  ${CYAN}  API docs → $BASE_URL/api/ui/${RESET}"
echo -e "  ${CYAN}  Upload   → $BASE_URL/upload-ospf-isis-lsdb${RESET}"
echo ""
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
