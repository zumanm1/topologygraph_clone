#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 05-confirm-running.sh  —  Health-check all containers + endpoints
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
# CHECKS:
#   ✅  flask       container running
#   ✅  webserver   container running
#   ✅  mongodb     container running
#   ✅  mcp-server  container running
#   ✅  Web UI      HTTP 200
#   ✅  REST API    HTTP 200 (authenticated)
#   ℹ   Graph count in database
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../../topolograph-docker" && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; RESET='\033[0m'
BASE_URL="${BASE_URL:-http://localhost:8081}"
AUTH_USER="${AUTH_USER:-ospf@topolograph.com}"
AUTH_PASS="${AUTH_PASS:-ospf}"

echo ""
echo -e "${BOLD}═══ STEP 5 — Confirm App is Running ═══${RESET}"
echo ""

cd "$DOCKER_DIR"

PASS=0; FAIL=0

check() {
    local label="$1"; local ok="$2"
    if [ "$ok" = "true" ]; then
        echo -e "  ${GREEN}✅  $label${RESET}"; ((PASS++))
    else
        echo -e "  ${RED}❌  $label${RESET}"; ((FAIL++))
    fi
}

# 1. Container health
for name in flask webserver mongodb mcp-server; do
    STATUS=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
    check "Container [$name] → $STATUS" "$( [ "$STATUS" = "running" ] && echo true || echo false )"
done

echo ""

# 2. Web UI
HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE_URL" 2>/dev/null || echo "000")
check "Web UI  ($BASE_URL) → HTTP $HTTP" "$( [ "$HTTP" = "200" ] && echo true || echo false )"

# 3. REST API
API=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
    -u "$AUTH_USER:$AUTH_PASS" "$BASE_URL/api/graph/" 2>/dev/null || echo "000")
check "REST API (/api/graph/) → HTTP $API" "$( [ "$API" = "200" ] && echo true || echo false )"

# 4. Graph count
GRAPHS=$(curl -s --max-time 5 -u "$AUTH_USER:$AUTH_PASS" "$BASE_URL/api/graph/" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "?")
echo -e "  ${CYAN}ℹ  Graphs in database: $GRAPHS${RESET}"

echo ""
if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}All checks passed ($PASS/$((PASS+FAIL))). App is fully operational.${RESET}"
    echo ""
    echo -e "  ${RESET}Next step → run: 06-run-pipeline.sh${RESET}"
else
    echo -e "  ${RED}${BOLD}$FAIL check(s) FAILED. Check docker compose logs.${RESET}"
    exit 1
fi
