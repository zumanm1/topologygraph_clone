#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 04-start-app.sh  —  Start Topolograph and wait until ready
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
# WHAT HAPPENS (in order):
#   1. MongoDB starts first  — all graph data is persisted here
#   2. Flask (Gunicorn)      — REST API and web server backend
#   3. flask-create-creds    — one-shot container that creates ospf@topolograph.com
#   4. Nginx (webserver)     — proxies / → Flask, serves static JS/CSS
#   5. MCP server            — model-context-protocol server on port 8000
#
# WAIT TIME: ~10–15 seconds until http://localhost:8081 responds with HTTP 200.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; RESET='\033[0m'
BASE_URL="${BASE_URL:-http://localhost:8081}"

echo ""
echo -e "${BOLD}═══ STEP 4 — Start Topolograph ═══${RESET}"
echo ""

cd "$DOCKER_DIR"

echo -e "  ${CYAN}Starting containers (detached)…${RESET}"
docker compose up -d 2>&1 | grep -E "Started|Created|Running|Error" | sed 's/^/  /'

echo ""
echo -n "  Waiting for $BASE_URL "
for i in $(seq 1 30); do
    if curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
        echo -e " ${GREEN}✅${RESET}"
        break
    fi
    echo -n "."; sleep 1
done

if ! curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
    echo -e "\n  ${RED}❌  App did not respond in 30s. Run: docker compose logs${RESET}"
    exit 1
fi

echo ""
echo -e "  ${GREEN}${BOLD}✅  Topolograph is running!${RESET}"
echo ""
echo -e "  ${CYAN}  Web UI      → $BASE_URL${RESET}"
echo -e "  ${CYAN}  Upload LSDB → $BASE_URL/upload-ospf-isis-lsdb${RESET}"
echo -e "  ${CYAN}  API docs    → $BASE_URL/api/ui/${RESET}"
echo -e "  ${CYAN}  Hosts page  → $BASE_URL/ospf-host-to-dns-mapping${RESET}"
echo ""
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo -e "  ${RESET}Next step → run: 05-confirm-running.sh${RESET}"
