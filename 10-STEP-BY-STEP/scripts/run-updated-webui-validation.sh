#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT="$PROJECT_ROOT/10-STEP-BY-STEP/validation-report.txt"

mkdir -p "$PROJECT_ROOT/10-STEP-BY-STEP/screenshots/full-e2e"
mkdir -p "$PROJECT_ROOT/10-STEP-BY-STEP/screenshots/host-import"
mkdir -p "$PROJECT_ROOT/10-STEP-BY-STEP/screenshots/all-views"
mkdir -p "$PROJECT_ROOT/10-STEP-BY-STEP/screenshots/features"
mkdir -p "$PROJECT_ROOT/10-STEP-BY-STEP/screenshots/layout"
mkdir -p "$PROJECT_ROOT/10-STEP-BY-STEP/screenshots/walkthrough"

exec > >(tee "$REPORT") 2>&1

info() { echo "[10-step] $*"; }
fail() { echo "[10-step] ERROR: $*"; exit 1; }

ENV_FILE="$PROJECT_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$PROJECT_ROOT/.env.example"
fi
set -a
source "$ENV_FILE"
set +a

BASE_URL_HOST="http://localhost:${TOPOLOGRAPH_PORT:-8081}"
BASE_URL_DOCKER="http://webserver:${TOPOLOGRAPH_PORT:-8081}"
HEADLESS_VALUE="${HEADLESS:-true}"

resolve_latest_graph_time() {
  find "$PROJECT_ROOT/IN-OUT-FOLDER" -mindepth 1 -maxdepth 1 -type d -name '*_54_hosts' -exec basename {} \; | sort | tail -1
}

info "Project root: $PROJECT_ROOT"
info "Ensuring core stack is running"
docker compose up -d flask webserver pipeline >/tmp/10-step-up.log 2>&1 || { cat /tmp/10-step-up.log; fail "could not start docker services"; }
info "Ensuring e2e-runner is running"
docker compose --profile test up -d e2e-runner >/tmp/10-step-e2e-up.log 2>&1 || { cat /tmp/10-step-e2e-up.log; fail "could not start e2e-runner"; }

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "$BASE_URL_HOST/login"; then
    break
  fi
  sleep 1
done
curl -sf -o /dev/null "$BASE_URL_HOST/login" || fail "web UI not responding at $BASE_URL_HOST"
info "Web UI responding at $BASE_URL_HOST"

info "Uploading packaged OSPF fixture through the Web UI"
GRAPH_TIME="$(docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  OSPF_FILE="/app/INPUT-FOLDER/ospf-database-54-unk-test.txt" \
  node /app/tests/upload-ospf-fixture-and-resolve-graph-time.cjs | tail -1 | tr -d '\r')"

[[ -n "$GRAPH_TIME" ]] || fail "could not resolve graph_time after Web UI upload"

info "Running enrich-existing pipeline for graph_time=$GRAPH_TIME"
docker compose exec -T pipeline bash /app/terminal-script/workflow.sh enrich-existing \
  --graph-time "$GRAPH_TIME" \
  --ospf-file /app/INPUT-FOLDER/ospf-database-54-unk-test.txt \
  --host-file /app/INPUT-FOLDER/Load-hosts.csv \
  --base-url "$BASE_URL_DOCKER" \
  --user "$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  --pass "$TOPOLOGRAPH_WEB_API_PASSWORD"

LATEST_GRAPH_TIME="$(resolve_latest_graph_time)"
[[ -n "$LATEST_GRAPH_TIME" ]] || fail "could not find latest 54-host graph_time in IN-OUT-FOLDER"
GRAPH_TIME="$LATEST_GRAPH_TIME"
info "Resolved graph_time: $GRAPH_TIME"

info "Artifact validation"
GRAPH_TIME="$GRAPH_TIME" node "$PROJECT_ROOT/tests/validate-step10-artifacts.cjs"

info "Web UI host import validation"
docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  HEADLESS="$HEADLESS_VALUE" \
  SCREENSHOT_DIR="/app/10-STEP-BY-STEP/screenshots/host-import" \
  node /app/tests/validate-webui-country-import.cjs

info "All four view filters validation"
docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  HEADLESS="$HEADLESS_VALUE" \
  SCREENSHOT_DIR="/app/10-STEP-BY-STEP/screenshots/all-views" \
  node /app/tests/validate-country-filter-all-views.cjs

info "Full deep updated E2E validation"
docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  HEADLESS="$HEADLESS_VALUE" \
  GRAPH_TIMES="$GRAPH_TIME" \
  SCREENSHOT_DIR="/app/10-STEP-BY-STEP/screenshots/full-e2e" \
  node /app/tests/validate-full-e2e-v2.cjs

info "Feature surface validation"
docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  HEADLESS="$HEADLESS_VALUE" \
  GRAPH_TIME="$GRAPH_TIME" \
  SCREENSHOT_DIR="/app/10-STEP-BY-STEP/screenshots/features" \
  node /app/tests/validate-features-full.cjs

info "Layout and export validation"
docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  GRAPH_TIME="$GRAPH_TIME" \
  SCREENSHOT_DIR="/app/10-STEP-BY-STEP/screenshots/layout" \
  node /app/tests/validate-layout-persistence.cjs

info "Updated user walkthrough"
docker compose exec -T e2e-runner env \
  BASE_URL="$BASE_URL_DOCKER" \
  API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  HEADLESS="$HEADLESS_VALUE" \
  SCREENSHOT_DIR="/app/10-STEP-BY-STEP/screenshots/walkthrough" \
  node /app/tests/validate-step10-user-journey.cjs

info "Step 10 validation complete"
info "graph_time=$GRAPH_TIME"
info "report=$REPORT"
