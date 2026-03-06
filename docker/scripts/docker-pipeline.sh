#!/usr/bin/env bash
# =============================================================================
# docker/scripts/docker-pipeline.sh
# OSPF Country Topology — Pipeline runner INSIDE the pipeline container
# =============================================================================
#
# PURPOSE
# ───────
# Runs the full OSPF pipeline from inside the `pipeline` Docker container.
# The project root is bind-mounted at /app so all outputs land on the host.
#
# USAGE — from HOST:
#   docker compose exec pipeline bash docker/scripts/docker-pipeline.sh
#   docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --ospf-file=ospf-database-54-unk-test.txt --host-file=Load-hosts-54-unk-test.txt
#   docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --dry-run
#   docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --no-push
#
# USAGE — from inside the container:
#   bash /app/docker/scripts/docker-pipeline.sh
#
# ENVIRONMENT (set by docker-compose.yml)
#   BASE_URL   → http://webserver:8081    (internal Docker network)
#   API_USER   → ospf@topolograph.com
#   API_PASS   → ospf
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="/app"   # bind-mount inside container

# ── Defaults ──────────────────────────────────────────────────────────────────
OSPF_FILE="${PROJECT_ROOT}/INPUT-FOLDER/ospf-database-54-unk-test.txt"
HOST_FILE="${PROJECT_ROOT}/INPUT-FOLDER/Load-hosts-54-unk-test.txt"
BASE_URL="${BASE_URL:-http://webserver:8081}"
API_USER="${API_USER:-ospf@topolograph.com}"
API_PASS="${API_PASS:-ospf}"
EXTRA_ARGS=""

# ── Parse args ────────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --ospf-file=*)  OSPF_FILE="${PROJECT_ROOT}/INPUT-FOLDER/${arg#*=}" ;;
    --host-file=*)  HOST_FILE="${PROJECT_ROOT}/INPUT-FOLDER/${arg#*=}" ;;
    --base-url=*)   BASE_URL="${arg#*=}" ;;
    --dry-run)      EXTRA_ARGS="$EXTRA_ARGS --dry-run" ;;
    --no-push)      EXTRA_ARGS="$EXTRA_ARGS --no-push" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        OSPF Pipeline — Docker Container Runner               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Container : pipeline"
echo "  OSPF file : $OSPF_FILE"
echo "  Host file : $HOST_FILE"
echo "  Base URL  : $BASE_URL"
echo ""

# ── Pre-flight: wait for webserver ────────────────────────────────────────────
echo "  Waiting for Topolograph webserver..."
MAX_WAIT=60
COUNT=0
until curl -sf -o /dev/null --connect-timeout 3 "${BASE_URL}/login"; do
  sleep 2
  COUNT=$((COUNT + 2))
  if [[ $COUNT -ge $MAX_WAIT ]]; then
    echo "  ❌ Topolograph not responding after ${MAX_WAIT}s at ${BASE_URL}"
    echo "     Is 'docker compose up -d' running?"
    exit 1
  fi
  echo "  ⏳ Still waiting... (${COUNT}s)"
done
echo "  ✅ Topolograph responding at $BASE_URL"
echo ""

# ── Run the pipeline ──────────────────────────────────────────────────────────
echo "  Running: workflow.sh all"
echo ""

bash "${PROJECT_ROOT}/terminal-script/workflow.sh" all \
  --ospf-file "$OSPF_FILE" \
  --host-file "$HOST_FILE" \
  --base-url  "$BASE_URL" \
  --user      "$API_USER" \
  --pass      "$API_PASS" \
  $EXTRA_ARGS

echo ""
echo "  ✅ Pipeline complete. Output files in:"
echo "     /app/IN-OUT-FOLDER/"
echo "     /app/OUTPUT/"
echo ""
