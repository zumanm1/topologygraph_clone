#!/usr/bin/env bash
# Validate Topolograph is running and working. Run from repo root.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE="${TOPOLOGRAPH_BASE_URL:-http://localhost:8081}"
DOCKER_BASE="${TOPOLOGRAPH_DOCKER_BASE_URL:-http://webserver:${TOPOLOGRAPH_PORT:-8081}}"
USER="ospf@topolograph.com"
PASS="ospf"
FAIL=0
GRAPH_TIME=""
COMPOSE_CMD=(docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml")

ensure_test_runner() {
  "${COMPOSE_CMD[@]}" --profile test up -d e2e-runner >/dev/null
}

ensure_playwright_runtime() {
  "${COMPOSE_CMD[@]}" exec -T e2e-runner bash -lc '
    set -e
    if [[ ! -d /app/tests/node_modules ]]; then
      cd /app/tests && npm install >/dev/null 2>&1
    fi
    if [[ ! -d "${PLAYWRIGHT_BROWSERS_PATH:-/playwright-browsers}" ]] || [[ -z "$(ls -A "${PLAYWRIGHT_BROWSERS_PATH:-/playwright-browsers}" 2>/dev/null)" ]]; then
      cd /playwright-setup && npx playwright install chromium >/dev/null 2>&1
    fi
  '
}

wait_for_docker_app() {
  local max_wait=60
  local waited=0
  local code="000"
  while [ "$waited" -lt "$max_wait" ]; do
    code=$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE" sh -lc 'curl -s -o /tmp/tg_ready.html -w "%{http_code}" "$BASE_URL/login" || echo "000"' 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

resolve_default_host_file() {
  local candidates=(
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-54-unk-test.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/host-file.txt"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf '%s\n' ""
}

enrich_uploaded_graph() {
  local graph_time="$1"
  local host_file="$2"
  [ -n "$graph_time" ] || return 1
  [ -n "$host_file" ] || return 1
  [ -f "$host_file" ] || return 1
  "${COMPOSE_CMD[@]}" exec -T pipeline bash /app/terminal-script/workflow.sh enrich-existing \
    --graph-time "$graph_time" \
    --host-file "/app/INPUT-FOLDER/$(basename "$host_file")" \
    --base-url "$DOCKER_BASE" \
    --user "$USER" \
    --pass "$PASS"
}

echo "=== Topolograph validation ==="
echo ""

ensure_test_runner

echo "0. Docker app readiness ($DOCKER_BASE)"
if wait_for_docker_app; then
  echo "   OK – Docker web app is ready"
else
  echo "   FAIL – Docker web app did not become ready in time"
  FAIL=1
fi

# 1) HTTP reachability
echo "1. HTTP reachability ($BASE)"
code=$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE" sh -lc 'curl -s -o /tmp/tg_index.html -w "%{http_code}" "$BASE_URL/" || echo "000"')
if [ "$code" != "200" ]; then
  echo "   FAIL – HTTP $code (expected 200)"
  FAIL=1
else
  echo "   OK – HTTP 200"
fi

# 2) Response is Topolograph (not default nginx)
echo "2. App identity (Topolograph vs default nginx)"
if "${COMPOSE_CMD[@]}" exec -T e2e-runner sh -lc 'grep -qi "topolograph\|OSPF/OSPFv3/IS-IS.*topology" /tmp/tg_index.html' 2>/dev/null; then
  echo "   OK – Topolograph page"
elif "${COMPOSE_CMD[@]}" exec -T e2e-runner sh -lc 'grep -qi "Welcome to nginx" /tmp/tg_index.html' 2>/dev/null; then
  echo "   FAIL – Default Nginx page (wrong service on this port)"
  FAIL=1
else
  echo "   WARN – Unknown page content"
fi

# 3) Default credentials
echo "3. Default API credentials"
BOOTSTRAP_SECRET="${TOPOLOGRAPH_BOOTSTRAP_SECRET:-${PASS:-ospf}}"
creds=$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE" TOPOLOGRAPH_BOOTSTRAP_SECRET="$BOOTSTRAP_SECRET" sh -lc 'curl -s -X POST -H "X-Topolograph-Bootstrap-Secret: $TOPOLOGRAPH_BOOTSTRAP_SECRET" "$BASE_URL/create-default-credentials" 2>/dev/null || echo "{}"')
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
  if "${COMPOSE_CMD[@]}" exec -T e2e-runner sh -lc 'cat > /tmp/validate-topolograph-lsdb.txt' < "$LSDB"; then
    upload_output=$("${COMPOSE_CMD[@]}" exec -T e2e-runner env \
      BASE_URL="$DOCKER_BASE" \
      API_USER="$USER" \
      API_PASS="$PASS" \
      TOPOLOGRAPH_BOOTSTRAP_SECRET="$BOOTSTRAP_SECRET" \
      LSDB_FILE="/tmp/validate-topolograph-lsdb.txt" \
      python3 /app/app-scripts/upload_and_validate.py 2>&1 || true)
    printf '%s\n' "$upload_output"
    GRAPH_TIME=$(printf '%s\n' "$upload_output" | sed -n 's/^  graph_time: //p' | tail -1)
  else
    upload_output=""
  fi
  if printf '%s\n' "$upload_output" | grep -q 'OK – Upload successful'; then
    echo "   OK – Upload successful (see above for graph_time)"
  else
    echo "   FAIL – Upload or validation failed"
    FAIL=1
  fi
  HOST_MAP_FILE="$(resolve_default_host_file)"
  if [ -n "$GRAPH_TIME" ] && [ -n "$HOST_MAP_FILE" ]; then
    echo "   Enriching graph with $(basename "$HOST_MAP_FILE")"
    ENRICH_LOG="$(mktemp)"
    if enrich_uploaded_graph "$GRAPH_TIME" "$HOST_MAP_FILE" >"$ENRICH_LOG" 2>&1; then
      echo "   OK – Graph enriched with hostname mapping"
    else
      cat "$ENRICH_LOG"
      echo "   FAIL – Graph enrichment failed"
      FAIL=1
    fi
    rm -f "$ENRICH_LOG"
  elif [ -n "$GRAPH_TIME" ]; then
    echo "   WARN – No host mapping file found; smoke test will use raw graph"
  fi
fi

# 5) Containers
echo "5. Docker containers"
for c in webserver flask mongodb mcp-server layout-api layout-db pipeline e2e-runner; do
  if "${COMPOSE_CMD[@]}" ps --status running --services 2>/dev/null | grep -qx "$c"; then
    echo "   OK – $c running"
  else
    echo "   FAIL – $c not running"
    FAIL=1
  fi
done

echo "6. Dockerized browser smoke test"
ensure_playwright_runtime
if smoke_output=$("${COMPOSE_CMD[@]}" exec -T e2e-runner env \
  BASE_URL="$DOCKER_BASE" \
  API_USER="$USER" \
  API_PASS="$PASS" \
  GRAPH_TIME="$GRAPH_TIME" \
  node /app/tests/validate-sprint3-smoke.cjs 2>&1); then
  printf '%s\n' "$smoke_output"
  echo "   OK – Dockerized Playwright smoke test passed"
else
  printf '%s\n' "$smoke_output"
  echo "   FAIL – Dockerized Playwright smoke test failed"
  FAIL=1
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== All checks passed. Topolograph is working. ==="
  echo "   Login: $BASE  ($USER / $PASS)"
  exit 0
else
  echo "=== Some checks failed. See above. ==="
  exit 1
fi
