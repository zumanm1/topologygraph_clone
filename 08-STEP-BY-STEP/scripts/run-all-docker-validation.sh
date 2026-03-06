#!/usr/bin/env bash
# =============================================================================
# 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
# All-Docker rebuild + pipeline + deep E2E validation
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT="$PROJECT_ROOT/08-STEP-BY-STEP/validation-report.txt"

OSPF_FILE="${OSPF_FILE:-ospf-database-54-unk-test.txt}"
HOST_FILE="${HOST_FILE:-Load-hosts-54-unk-test.txt}"

mkdir -p "$PROJECT_ROOT/08-STEP-BY-STEP"
mkdir -p "$PROJECT_ROOT/08-STEP-BY-STEP/scripts"

exec > >(tee "$REPORT") 2>&1

info() { echo "[08-step] $*"; }

info "Project root: $PROJECT_ROOT"
info "Rebuilding all-Docker stack"

docker compose down

docker compose build

docker compose up -d

docker compose --profile test up -d e2e-runner

info "Running Docker-native 07-equivalent pipeline validation"
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh \
  --ospf-file="$OSPF_FILE" \
  --host-file="$HOST_FILE"

GRAPH_TIME="$(ls -1 "$PROJECT_ROOT/IN-OUT-FOLDER" | grep '_54_hosts' | sort | tail -1)"

if [[ -z "$GRAPH_TIME" ]]; then
  echo "[08-step] ERROR: could not resolve latest 54-host graph_time"
  exit 1
fi

info "Resolved graph_time: $GRAPH_TIME"
info "Running Docker-native 06-equivalent deep validation"
docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh \
  --graph-time="$GRAPH_TIME"

info "Running hostname-mapping page regression check"
bash "$PROJECT_ROOT/08-STEP-BY-STEP/scripts/check-hostname-mapping-page.sh"

info "All-Docker validation complete"
info "graph_time=$GRAPH_TIME"
