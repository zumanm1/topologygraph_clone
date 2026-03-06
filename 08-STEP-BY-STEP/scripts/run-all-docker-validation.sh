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

ENV_FILE="$PROJECT_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$PROJECT_ROOT/.env.example"
fi

set -a
source "$ENV_FILE"
set +a

HOST_BASE_URL="http://localhost:${TOPOLOGRAPH_PORT:-8081}"
INTERNAL_BASE_URL="http://webserver:${TOPOLOGRAPH_PORT:-8081}"

info "Project root: $PROJECT_ROOT"
info "Rebuilding all-Docker stack"

docker compose down

docker compose build

docker compose up -d

docker compose --profile test up -d e2e-runner

info "Validating bearer-token API security"
TOKEN_NAME="08-step-bearer-$(date +%s)"

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "$HOST_BASE_URL/"; then
    break
  fi
  sleep 1
done

if ! curl -sf -o /dev/null "$HOST_BASE_URL/"; then
  echo "[08-step] ERROR: modified app did not become ready at $HOST_BASE_URL"
  exit 1
fi

docker compose exec -T pipeline python3 - <<PYEOF
import re
import requests

base = "${INTERNAL_BASE_URL}"
email = "${TOPOLOGRAPH_WEB_API_USERNAME_EMAIL}"
password = "${TOPOLOGRAPH_WEB_API_PASSWORD}"
token_name = "${TOKEN_NAME}"

s = requests.Session()
r = s.get(f"{base}/login", timeout=15)
r.raise_for_status()
csrf = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', r.text)
payload = {"login": email, "password": password}
if csrf:
    payload["csrf_token"] = csrf.group(1)

r = s.post(f"{base}/login", data=payload, timeout=15, allow_redirects=True)
r.raise_for_status()

r = s.get(f"{base}/token_management/create_token", timeout=15)
r.raise_for_status()
csrf = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', r.text)
payload = {"token_name": token_name}
if csrf:
    payload["csrf_token"] = csrf.group(1)

r = s.post(f"{base}/token_management/create_token", data=payload, timeout=15, allow_redirects=True)
r.raise_for_status()
print(token_name)
PYEOF

BEARER_TOKEN="$(docker compose exec -T mongodb mongo "$MONGODB_DATABASE" -u "$MONGODB_USERNAME" -p "$MONGODB_PASSWORD" --quiet --eval "db.user_tokens.find({name:\"$TOKEN_NAME\"}).sort({_id:-1}).limit(1).forEach(function(doc){print(doc.token)})" | tail -1 | tr -d '\r')"

if [[ -z "$BEARER_TOKEN" ]]; then
  echo "[08-step] ERROR: bearer token was not created"
  exit 1
fi

CURL_STATUS="$(curl -s -o /tmp/08-step-bearer-graph.json -w "%{http_code}" -H "Authorization: Bearer $BEARER_TOKEN" "$HOST_BASE_URL/api/graph/")"

if [[ "$CURL_STATUS" != "200" ]]; then
  echo "[08-step] ERROR: bearer-authenticated /api/graph/ returned HTTP $CURL_STATUS"
  exit 1
fi

info "Bearer-token /api/graph/ validation: PASS"

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
