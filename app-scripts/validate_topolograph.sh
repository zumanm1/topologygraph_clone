#!/usr/bin/env bash
# Validate Topolograph is running and working. Run from repo root.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${TOPOLOGRAPH_BASE_URL:-http://localhost:8081}"
USER="ospf@topolograph.com"
PASS="ospf"
FAIL=0

echo "=== Topolograph validation ==="
echo ""

# 1) HTTP reachability
echo "1. HTTP reachability ($BASE)"
code=$(curl -s -o /tmp/tg_index.html -w "%{http_code}" "$BASE/" || echo "000")
if [ "$code" != "200" ]; then
  echo "   FAIL – HTTP $code (expected 200)"
  FAIL=1
else
  echo "   OK – HTTP 200"
fi

# 2) Response is Topolograph (not default nginx)
echo "2. App identity (Topolograph vs default nginx)"
if grep -qi "topolograph\|OSPF/OSPFv3/IS-IS.*topology" /tmp/tg_index.html 2>/dev/null; then
  echo "   OK – Topolograph page"
elif grep -qi "Welcome to nginx" /tmp/tg_index.html 2>/dev/null; then
  echo "   FAIL – Default Nginx page (wrong service on this port)"
  FAIL=1
else
  echo "   WARN – Unknown page content"
fi

# 3) Default credentials
echo "3. Default API credentials"
creds=$(curl -s -X POST "$BASE/create-default-credentials" 2>/dev/null || echo "{}")
if echo "$creds" | grep -q '"status".*"ok"'; then
  echo "   OK – Default credentials ready"
else
  echo "   WARN – $creds"
fi

# 4) API: graph upload (via Python script)
echo "4. API (graph upload)"
LSDB="${1:-$PROJECT_ROOT/INPUT-FOLDER/ospf-database.txt}"
if [ ! -f "$LSDB" ]; then
  echo "   SKIP – $LSDB not found"
else
  if LSDB_FILE="$LSDB" python3 "$SCRIPT_DIR/upload_and_validate.py" 2>/dev/null; then
    echo "   OK – Upload successful (see above for graph_time)"
  else
    echo "   FAIL – Upload or validation failed"
    FAIL=1
  fi
fi

# 5) Containers
echo "5. Docker containers"
for c in webserver flask mongodb mcp-server; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${c}$"; then
    echo "   OK – $c running"
  else
    echo "   FAIL – $c not running"
    FAIL=1
  fi
done

echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== All checks passed. Topolograph is working. ==="
  echo "   Login: $BASE  ($USER / $PASS)"
  exit 0
else
  echo "=== Some checks failed. See above. ==="
  exit 1
fi
