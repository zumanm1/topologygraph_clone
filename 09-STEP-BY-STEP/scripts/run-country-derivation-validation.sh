#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT="$PROJECT_ROOT/09-STEP-BY-STEP/validation-report.txt"

mkdir -p "$PROJECT_ROOT/09-STEP-BY-STEP"
mkdir -p "$PROJECT_ROOT/09-STEP-BY-STEP/scripts"
mkdir -p "$PROJECT_ROOT/09-STEP-BY-STEP/screenshots"

exec > >(tee "$REPORT") 2>&1

info() { echo "[09-step] $*"; }

resolve_graph_time() {
  local inout="$PROJECT_ROOT/IN-OUT-FOLDER"
  local gt="${GRAPH_TIME:-}"
  if [[ -n "$gt" ]]; then echo "$gt"; return; fi
  for d in "$inout"/*_54_hosts/; do
    [[ -f "$d/nodes.json" ]] && gt="$(basename "$d")"
  done
  if [[ -n "$gt" ]]; then echo "$gt"; return; fi
  echo ""
}

GRAPH_TIME="$(resolve_graph_time)"

info "Project root: $PROJECT_ROOT"
info "Graph time: ${GRAPH_TIME:-<none>}"

if [[ -z "$GRAPH_TIME" ]]; then
  echo "[09-step] ERROR: could not resolve a graph_time from IN-OUT-FOLDER"
  exit 1
fi

info "Running terminal hostname-derivation regression"
bash "$PROJECT_ROOT/terminal-script/test-topology-country-tool.sh"

info "Running browser hostname-derivation regression"
docker compose exec -T -e GRAPH_TIME="$GRAPH_TIME" e2e-runner \
  node /app/tests/validate-country-derivation.cjs

info "Running browser WebUI upload/import country-derivation regression"
docker compose exec -T e2e-runner \
  node /app/tests/validate-webui-country-import.cjs

info "09-step country-derivation validation complete"
info "Screenshots: $PROJECT_ROOT/09-STEP-BY-STEP/screenshots"
