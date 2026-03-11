#!/usr/bin/env bash
# =============================================================================
# 13-STEP-BY-STEP — OSPF Path Analysis Suite E2E Validation
# =============================================================================
# Validates PRD-08 → PRD-13: K-Path Explorer, Change Planner, Impact Lab,
# Topology Diff — using real OSPF data with A/B/C-type hostnames.
#
# Upload sequence (within the test):
#   1. ospf-database-54-unk-test.txt   → 84-node OSPF graph
#   2. Load-hosts-metro-level.csv      → A-type hostname mapping (can-tor-kem-r1, etc.)
#
# Usage:
#   bash 13-STEP-BY-STEP/scripts/run-path-analysis-validation.sh
#   BASE_URL=http://localhost:8081 bash 13-STEP-BY-STEP/scripts/run-path-analysis-validation.sh
#
# Environment variables (all optional — defaults from .env):
#   BASE_URL       Web UI base URL (default: http://localhost:8081)
#   API_USER       Login email     (default: from .env TOPOLOGRAPH_WEB_API_USERNAME_EMAIL)
#   API_PASS       Login password  (default: from .env TOPOLOGRAPH_WEB_API_PASSWORD)
#   HEADLESS       true/false      (default: true)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STEP_DIR="$PROJECT_ROOT/13-STEP-BY-STEP"
REPORT="$STEP_DIR/validation-report.txt"
SCREENSHOT_DIR="$STEP_DIR/screenshots"
COMPOSE_CMD=(docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml")

mkdir -p "$STEP_DIR" "$STEP_DIR/scripts" "$SCREENSHOT_DIR"
exec > >(tee "$REPORT") 2>&1

# ── Load environment ──────────────────────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$PROJECT_ROOT/.env.example"
set -a; source "$ENV_FILE"; set +a

BASE_URL="${BASE_URL:-http://localhost:${TOPOLOGRAPH_PORT:-8081}}"
DOCKER_BASE_URL="${DOCKER_BASE_URL:-http://webserver:${TOPOLOGRAPH_PORT:-8081}}"
API_USER="${API_USER:-${TOPOLOGRAPH_WEB_API_USERNAME_EMAIL:-ospf@topolograph.com}}"
API_PASS="${API_PASS:-${TOPOLOGRAPH_WEB_API_PASSWORD:-ospf}}"
HEADLESS="${HEADLESS:-true}"

info() { echo "[13-step] $*"; }
fail() { echo "[13-step] ERROR: $*"; exit 1; }

info "Project root:   $PROJECT_ROOT"
info "Base URL:       $BASE_URL"
info "Docker URL:     $DOCKER_BASE_URL"
info "API user:       $API_USER"
info "Screenshot dir: $SCREENSHOT_DIR"

# ── Validate input files exist ────────────────────────────────────────────────
OSPF_FILE="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-54-unk-test.txt"
CSV_FILE="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-metro-level.csv"
[[ -f "$OSPF_FILE" ]] || fail "OSPF input file not found: $OSPF_FILE"
[[ -f "$CSV_FILE"  ]] || fail "Hostname CSV not found: $CSV_FILE"
info "OSPF file:      $OSPF_FILE ($(wc -l < "$OSPF_FILE") lines)"
info "Hostname CSV:   $CSV_FILE ($(wc -l < "$CSV_FILE") rows)"

# ── Ensure Docker stack is up ─────────────────────────────────────────────────
info "Ensuring core stack is running"
"${COMPOSE_CMD[@]}" up -d flask webserver pipeline >/tmp/13-step-up.log 2>&1 \
  || { cat /tmp/13-step-up.log; fail "could not start docker services"; }

info "Starting e2e-runner container"
"${COMPOSE_CMD[@]}" --profile test up -d e2e-runner >/tmp/13-step-e2e-up.log 2>&1 \
  || { cat /tmp/13-step-e2e-up.log; fail "could not start e2e-runner"; }

# ── Wait for web UI ───────────────────────────────────────────────────────────
info "Waiting for web UI at $DOCKER_BASE_URL"
max_wait=60; waited=0; code="000"
while [[ "$waited" -lt "$max_wait" ]]; do
  code=$("${COMPOSE_CMD[@]}" exec -T e2e-runner \
    env BASE_URL="$DOCKER_BASE_URL" \
    sh -lc 'curl -s -o /tmp/13-login.html -w "%{http_code}" "$BASE_URL/login" 2>/dev/null || echo 000' \
    2>/dev/null || echo "000")
  [[ "$code" == "200" ]] && break
  sleep 3; waited=$((waited + 3))
done
[[ "$code" == "200" ]] || fail "Web UI not responding at $DOCKER_BASE_URL after ${max_wait}s"
info "Web UI responding (HTTP 200)"

# ── Run the E2E test suite ────────────────────────────────────────────────────
info "Running 23-path-analysis-suite-e2e.cjs"
info "This uploads ospf-database-54-unk-test.txt, applies Load-hosts-metro-level.csv,"
info "then validates all 5 pages (Main, K-Path Explorer, Change Planner, Impact Lab, Topo Diff)"

"${COMPOSE_CMD[@]}" exec -T e2e-runner \
  env \
    BASE_URL="$DOCKER_BASE_URL" \
    API_USER="$API_USER" \
    API_PASS="$API_PASS" \
    SCREENSHOT_DIR="/app/13-STEP-BY-STEP/screenshots" \
    HEADLESS="$HEADLESS" \
  node /app/tests/23-path-analysis-suite-e2e.cjs

info "Path Analysis Suite E2E validation complete"
info "Report:      $REPORT"
info "Screenshots: $SCREENSHOT_DIR"
