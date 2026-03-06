#!/usr/bin/env bash
# =============================================================================
# docker/scripts/docker-e2e.sh
# OSPF Country Topology — Playwright E2E runner INSIDE the e2e-runner container
# =============================================================================
#
# PURPOSE
# ───────
# Runs the full 114-check Playwright E2E validation suite from inside the
# `e2e-runner` Docker container. The project root is bind-mounted at /app.
#
# USAGE — from HOST:
#   docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh
#   docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh --graph-time=05Mar2026_10h41m58s_54_hosts
#   docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh --skip-phase1
#
# USAGE — from inside the container:
#   bash /app/docker/scripts/docker-e2e.sh
#
# ENVIRONMENT (set by docker-compose.yml)
#   BASE_URL          → http://webserver:8081
#   TOPOLOGRAPH_PORT  → 8081
#
# =============================================================================
set -euo pipefail

PROJECT_ROOT="/app"
BASE_URL="${BASE_URL:-http://webserver:8081}"
GRAPH_TIME=""
SKIP_PHASE1=false
EXTRA_ARGS=""

# ── Parse args ────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --graph-time=*) GRAPH_TIME="${arg#*=}"; EXTRA_ARGS="$EXTRA_ARGS $arg" ;;
    --skip-phase1)  SKIP_PHASE1=true; EXTRA_ARGS="$EXTRA_ARGS --skip-phase1" ;;
    --run-pipeline-db3) EXTRA_ARGS="$EXTRA_ARGS --run-pipeline-db3" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      OSPF E2E Playwright Suite — Docker Container Runner      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Container  : e2e-runner"
echo "  Base URL   : $BASE_URL"
echo "  Graph time : ${GRAPH_TIME:-auto-detect}"
echo ""

# ── Pre-flight: ensure webserver is up ────────────────────────────────────────
echo "  Waiting for Topolograph webserver..."
MAX_WAIT=60
COUNT=0
until curl -sf -o /dev/null --connect-timeout 3 "${BASE_URL}/login"; do
  sleep 2
  COUNT=$((COUNT + 2))
  if [[ $COUNT -ge $MAX_WAIT ]]; then
    echo "  ❌ Topolograph not responding after ${MAX_WAIT}s at ${BASE_URL}"
    exit 1
  fi
  echo "  ⏳ Still waiting... (${COUNT}s)"
done
echo "  ✅ Topolograph responding at $BASE_URL"
echo ""

# ── Install Node.js deps if not already present ───────────────────────────────
TESTS_DIR="${PROJECT_ROOT}/tests"
if [[ ! -d "${TESTS_DIR}/node_modules" ]]; then
  echo "  Installing Node.js dependencies in tests/..."
  cd "$TESTS_DIR" && npm install
  cd "$PROJECT_ROOT"
  echo "  ✅ npm install complete"
fi

# ── Install Chromium if not already in playwright-browsers volume ─────────────
PLAYWRIGHT_BIN="${PLAYWRIGHT_BROWSERS_PATH:-/playwright-browsers}"
if [[ ! -d "$PLAYWRIGHT_BIN" ]] || [[ -z "$(ls -A "$PLAYWRIGHT_BIN" 2>/dev/null)" ]]; then
  echo "  First run — downloading Playwright Chromium browser..."
  echo "  (This only happens once; browser is cached in playwright-browsers volume)"
  cd /playwright-setup && npx playwright install chromium
  echo "  ✅ Chromium installed to $PLAYWRIGHT_BIN"
else
  echo "  ✅ Playwright Chromium already installed at $PLAYWRIGHT_BIN"
fi
echo ""

# ── Run E2E suite (12-phase, 114 checks) ──────────────────────────────────────
echo ""
echo "  Running: run-full-e2e-v2.sh (114 checks)"
echo ""

# Override BASE_URL in the script via env var so Playwright uses webserver hostname
export BASE_URL="$BASE_URL"

bash "${PROJECT_ROOT}/06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh" \
  $EXTRA_ARGS

echo ""
echo "  ✅ E2E suite complete."
echo ""
