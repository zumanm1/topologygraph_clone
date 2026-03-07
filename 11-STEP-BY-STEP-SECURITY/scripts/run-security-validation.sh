#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STEP_DIR="$PROJECT_ROOT/11-STEP-BY-STEP-SECURITY"
REPORT="$STEP_DIR/validation-report.txt"
mkdir -p "$STEP_DIR" "$STEP_DIR/scripts" "$STEP_DIR/screenshots"
exec > >(tee "$REPORT") 2>&1

ENV_FILE="$PROJECT_ROOT/.env"
[[ -f "$ENV_FILE" ]] || ENV_FILE="$PROJECT_ROOT/.env.example"
set -a; source "$ENV_FILE"; set +a

BASE_URL="${BASE_URL:-http://localhost:${TOPOLOGRAPH_PORT:-8081}}"
API_USER="${API_USER:-${TOPOLOGRAPH_WEB_API_USERNAME_EMAIL:-ospf@topolograph.com}}"
API_PASS="${API_PASS:-${TOPOLOGRAPH_WEB_API_PASSWORD:-ospf}}"
BOOTSTRAP_SECRET="${TOPOLOGRAPH_BOOTSTRAP_SECRET:-$API_PASS}"
GRAPH_TIME="${GRAPH_TIME:-${GRAPH_TIMES:-}}"
GRAPH_TIME="${GRAPH_TIME%%,*}"

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

if [[ -z "$GRAPH_TIME" ]]; then
  GRAPH_TIME="$(resolve_graph_time | tail -1 | tr -d '\r')"
fi

echo "[11-step] Base URL: $BASE_URL"
[[ "$(curl -s -o /tmp/11-login.html -w '%{http_code}' "$BASE_URL/login")" == "200" ]] || { echo "[11-step] ERROR: login page unreachable"; exit 1; }
echo "[11-step] Login page reachability: PASS"
[[ "$(curl -s -o /tmp/11-bootstrap-no-header.txt -w '%{http_code}' -X POST "$BASE_URL/create-default-credentials")" == "403" ]] || { echo "[11-step] ERROR: bootstrap without header was not rejected"; exit 1; }
echo "[11-step] Bootstrap missing-header rejection: PASS"
[[ "$(curl -s -o /tmp/11-bootstrap-ok.json -w '%{http_code}' -X POST -H "X-Topolograph-Bootstrap-Secret: $BOOTSTRAP_SECRET" "$BASE_URL/create-default-credentials")" == "200" ]] || { echo "[11-step] ERROR: bootstrap with valid secret failed"; exit 1; }
echo "[11-step] Bootstrap secret acceptance: PASS"
[[ "$(curl -s -o /tmp/11-layout-anon.txt -w '%{http_code}' "$BASE_URL/layout-api/layouts?graph_id=x&graph_time=y&view_mode=z")" == "401" ]] || { echo "[11-step] ERROR: anonymous layout-api access was not rejected"; exit 1; }
echo "[11-step] Anonymous layout-api rejection: PASS"

BASE_URL="$BASE_URL" API_USER="$API_USER" API_PASS="$API_PASS" GRAPH_TIME="$GRAPH_TIME" SCREENSHOT_DIR="$STEP_DIR/screenshots" \
  node "$PROJECT_ROOT/tests/validate-step11-security.cjs"

BASE_URL="$BASE_URL" API_USER="$API_USER" API_PASS="$API_PASS" GRAPH_TIME="$GRAPH_TIME" SCREENSHOT_DIR="$STEP_DIR/screenshots/layout-isolation" \
  node "$PROJECT_ROOT/tests/validate-layout-isolation.cjs"
