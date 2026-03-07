#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STEP_DIR="$PROJECT_ROOT/11-STEP-BY-STEP-SECURITY"
REPORT="$STEP_DIR/validation-report.txt"
COMPOSE_CMD=(docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml")
mkdir -p "$STEP_DIR" "$STEP_DIR/scripts" "$STEP_DIR/screenshots"
exec > >(tee "$REPORT") 2>&1

ENV_FILE="$PROJECT_ROOT/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$PROJECT_ROOT/.env.example"
set -a; source "$ENV_FILE"; set +a

BASE_URL="${BASE_URL:-http://localhost:${TOPOLOGRAPH_PORT:-8081}}"
DOCKER_BASE_URL="${DOCKER_BASE_URL:-http://webserver:${TOPOLOGRAPH_PORT:-8081}}"
API_USER="${API_USER:-${TOPOLOGRAPH_WEB_API_USERNAME_EMAIL:-ospf@topolograph.com}}"
API_PASS="${API_PASS:-${TOPOLOGRAPH_WEB_API_PASSWORD:-ospf}}"
BOOTSTRAP_SECRET="${TOPOLOGRAPH_BOOTSTRAP_SECRET:-$API_PASS}"
GRAPH_TIME="${GRAPH_TIME:-${GRAPH_TIMES:-}}"
GRAPH_TIME="${GRAPH_TIME%%,*}"

resolve_graph_time() {
  find "$PROJECT_ROOT/IN-OUT-FOLDER" -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
    [[ -f "$dir/nodes.json" ]] && basename "$dir"
  done | sort | awk '/_54_hosts$/ { v=$0 } END { if (v) print v }'
}

if [[ -z "$GRAPH_TIME" ]]; then
  GRAPH_TIME="$(resolve_graph_time | tail -1 | tr -d '\r')"
  if [[ -z "$GRAPH_TIME" ]]; then
    GRAPH_TIME="$(find "$PROJECT_ROOT/IN-OUT-FOLDER" -mindepth 1 -maxdepth 1 -type d | while read -r dir; do [[ -f "$dir/nodes.json" ]] && basename "$dir"; done | sort | tail -1 | tr -d '\r')"
  fi
fi

echo "[11-step] Base URL: $BASE_URL"
"${COMPOSE_CMD[@]}" --profile test up -d e2e-runner >/dev/null
[[ "$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE_URL" sh -lc 'curl -s -o /tmp/11-login.html -w "%{http_code}" "$BASE_URL/login"')" == "200" ]] || { echo "[11-step] ERROR: login page unreachable"; exit 1; }
echo "[11-step] Login page reachability: PASS"
[[ "$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE_URL" sh -lc 'curl -s -o /tmp/11-bootstrap-no-header.txt -w "%{http_code}" -X POST "$BASE_URL/create-default-credentials"')" == "403" ]] || { echo "[11-step] ERROR: bootstrap without header was not rejected"; exit 1; }
echo "[11-step] Bootstrap missing-header rejection: PASS"
[[ "$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE_URL" TOPOLOGRAPH_BOOTSTRAP_SECRET="$BOOTSTRAP_SECRET" sh -lc 'curl -s -o /tmp/11-bootstrap-ok.json -w "%{http_code}" -X POST -H "X-Topolograph-Bootstrap-Secret: $TOPOLOGRAPH_BOOTSTRAP_SECRET" "$BASE_URL/create-default-credentials"')" == "200" ]] || { echo "[11-step] ERROR: bootstrap with valid secret failed"; exit 1; }
echo "[11-step] Bootstrap secret acceptance: PASS"
[[ "$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$DOCKER_BASE_URL" sh -lc 'curl -s -o /tmp/11-layout-anon.txt -w "%{http_code}" "$BASE_URL/layout-api/layouts?graph_id=x&graph_time=y&view_mode=z"')" == "401" ]] || { echo "[11-step] ERROR: anonymous layout-api access was not rejected"; exit 1; }
echo "[11-step] Anonymous layout-api rejection: PASS"

"${COMPOSE_CMD[@]}" exec -T e2e-runner env \
  BASE_URL="$DOCKER_BASE_URL" \
  API_USER="$API_USER" \
  API_PASS="$API_PASS" \
  GRAPH_TIME="$GRAPH_TIME" \
  SCREENSHOT_DIR="/app/11-STEP-BY-STEP-SECURITY/screenshots" \
  node /app/tests/validate-step11-security.cjs

"${COMPOSE_CMD[@]}" exec -T e2e-runner env \
  BASE_URL="$DOCKER_BASE_URL" \
  API_USER="$API_USER" \
  API_PASS="$API_PASS" \
  GRAPH_TIME="$GRAPH_TIME" \
  SCREENSHOT_DIR="/app/11-STEP-BY-STEP-SECURITY/screenshots/layout-isolation" \
  node /app/tests/validate-layout-isolation.cjs
