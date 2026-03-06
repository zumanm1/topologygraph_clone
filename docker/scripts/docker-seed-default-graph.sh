#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="/app"
BASE_URL="${BASE_URL:-http://webserver:8081}"
API_USER="${API_USER:-ospf@topolograph.com}"
API_PASS="${API_PASS:-ospf}"
OSPF_FILE="${PROJECT_ROOT}/INPUT-FOLDER/ospf-database-54-unk-test.txt"
HOST_FILE="${PROJECT_ROOT}/INPUT-FOLDER/Load-hosts-54-unk-test.txt"

MAX_WAIT=90
COUNT=0
until curl -sf -o /dev/null --connect-timeout 3 "${BASE_URL}/login"; do
  sleep 2
  COUNT=$((COUNT + 2))
  if [[ $COUNT -ge $MAX_WAIT ]]; then
    echo "[seed] Topolograph not responding after ${MAX_WAIT}s at ${BASE_URL}"
    exit 1
  fi
  echo "[seed] Waiting for Topolograph... (${COUNT}s)"
done

echo "[seed] Topolograph responding at ${BASE_URL}"

GRAPH_COUNT="$({ python3 - <<'PY'
import os, requests, sys
base = os.environ['BASE_URL']
user = os.environ['API_USER']
password = os.environ['API_PASS']
try:
    r = requests.get(f"{base}/api/graph/", auth=(user, password), timeout=30)
    r.raise_for_status()
    data = r.json()
    print(len(data) if isinstance(data, list) else 0)
except Exception:
    print("0")
PY
} )"

if [[ "$GRAPH_COUNT" != "0" ]]; then
  echo "[seed] Existing graphs found in database: ${GRAPH_COUNT} — skipping seed"
  exit 0
fi

echo "[seed] No graphs found — loading packaged default graph and hostname fixture"
bash "${PROJECT_ROOT}/docker/scripts/docker-pipeline.sh" \
  --ospf-file="$(basename "$OSPF_FILE")" \
  --host-file="$(basename "$HOST_FILE")"

echo "[seed] Default graph seed complete"
