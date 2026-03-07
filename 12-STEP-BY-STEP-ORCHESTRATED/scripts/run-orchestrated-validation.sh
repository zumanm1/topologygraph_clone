#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STEP_DIR="$PROJECT_ROOT/12-STEP-BY-STEP-ORCHESTRATED"
REPORT="$STEP_DIR/validation-report.txt"
mkdir -p "$STEP_DIR" "$STEP_DIR/scripts"
exec > >(tee "$REPORT") 2>&1

ENV_FILE="$PROJECT_ROOT/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$PROJECT_ROOT/.env.example"
set -a; source "$ENV_FILE"; set +a

BASE_URL="${BASE_URL:-http://localhost:${TOPOLOGRAPH_PORT:-8081}}"
API_USER="${API_USER:-${TOPOLOGRAPH_WEB_API_USERNAME_EMAIL:-ospf@topolograph.com}}"
API_PASS="${API_PASS:-${TOPOLOGRAPH_WEB_API_PASSWORD:-ospf}}"
GRAPH_TIME="${GRAPH_TIME:-${GRAPH_TIMES:-}}"
GRAPH_TIME="${GRAPH_TIME%%,*}"
RUN_STEP08="${RUN_STEP08:-true}"
INCLUDE_STEP10="${INCLUDE_STEP10:-false}"
RUN_STEP11="${RUN_STEP11:-true}"

info() { echo "[12-step] $*"; }
fail() { echo "[12-step] ERROR: $*"; exit 1; }

enabled() {
  case "${1:-}" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_graph_time() {
  PROJECT_ROOT="$PROJECT_ROOT" python3 - <<'PYEOF'
import os
from pathlib import Path
root = Path(os.environ['PROJECT_ROOT'])
inout = root / 'IN-OUT-FOLDER'
if not inout.exists():
    print('')
    raise SystemExit(0)
dirs = sorted([p.name for p in inout.iterdir() if p.is_dir() and (p / 'nodes.json').exists()])
d54 = [d for d in dirs if '_54_hosts' in d]
print((d54[-1] if d54 else (dirs[-1] if dirs else '')))
PYEOF
}

info "Project root: $PROJECT_ROOT"
info "Base URL: $BASE_URL"
info "Step 08 enabled: $RUN_STEP08"
info "Step 10 enabled: $INCLUDE_STEP10"
info "Step 11 enabled: $RUN_STEP11"

if ! enabled "$RUN_STEP08" && ! enabled "$INCLUDE_STEP10" && ! enabled "$RUN_STEP11"; then
  fail "all suites are disabled; enable at least one of RUN_STEP08, INCLUDE_STEP10, or RUN_STEP11"
fi

if enabled "$RUN_STEP08"; then
  info "Running Step 08 all-docker validation"
  BASE_URL="$BASE_URL" API_USER="$API_USER" API_PASS="$API_PASS" GRAPH_TIME="$GRAPH_TIME" \
    bash "$PROJECT_ROOT/08-STEP-BY-STEP/scripts/run-all-docker-validation.sh"
fi

if [[ -z "$GRAPH_TIME" ]]; then
  GRAPH_TIME="$(resolve_graph_time | tail -1 | tr -d '\r')"
fi

if [[ -n "$GRAPH_TIME" ]]; then
  info "Resolved orchestrator graph_time: $GRAPH_TIME"
else
  info "No graph_time resolved at orchestrator level"
fi

if enabled "$INCLUDE_STEP10"; then
  info "Running Step 10 updated web UI validation"
  BASE_URL="$BASE_URL" API_USER="$API_USER" API_PASS="$API_PASS" GRAPH_TIME="$GRAPH_TIME" \
    bash "$PROJECT_ROOT/10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh"
fi

if enabled "$RUN_STEP11"; then
  info "Running Step 11 security validation"
  BASE_URL="$BASE_URL" API_USER="$API_USER" API_PASS="$API_PASS" GRAPH_TIME="$GRAPH_TIME" \
    bash "$PROJECT_ROOT/11-STEP-BY-STEP-SECURITY/scripts/run-security-validation.sh"
fi

info "Orchestrated validation complete"
info "report=$REPORT"
info "step08_report=$PROJECT_ROOT/08-STEP-BY-STEP/validation-report.txt"
info "step10_report=$PROJECT_ROOT/10-STEP-BY-STEP/validation-report.txt"
info "step11_report=$PROJECT_ROOT/11-STEP-BY-STEP-SECURITY/validation-report.txt"
