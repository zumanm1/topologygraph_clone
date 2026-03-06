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
GRAPH_TIME="$(docker compose exec -T \
  -e OSPF_FILE="$OSPF_FILE" \
  -e API_USER="$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  -e API_PASS="$TOPOLOGRAPH_WEB_API_PASSWORD" \
  e2e-runner node - <<'NODE'
const { chromium } = require('playwright');

const BASE_URL = 'http://webserver:8081';
const OSPF_FILE = `/app/INPUT-FOLDER/${process.env.OSPF_FILE || ''}`;
const API_USER = process.env.API_USER || 'ospf@topolograph.com';
const API_PASS = process.env.API_PASS || 'ospf';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.fill('#login', API_USER);
  await page.fill('#password', API_PASS);
  await Promise.race([
    page.press('#password', 'Enter'),
    page.click('input[type="submit"], button[type="submit"]').catch(() => {}),
  ]);
  await page.waitForTimeout(1500);

  await page.goto(`${BASE_URL}/upload-ospf-isis-lsdb`, { waitUntil: 'networkidle', timeout: 30000 });
  const before = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  await page.click('#Cisco').catch(() => {});
  await page.evaluate(() => {
    const wrap = document.getElementById('devinputGroupFile02');
    if (wrap) wrap.removeAttribute('hidden');
    const input = document.getElementById('inputOSPFFileID');
    if (input) { input.style.display = 'block'; input.removeAttribute('hidden'); }
  });
  await page.locator('#inputOSPFFileID').setInputFiles(OSPF_FILE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }),
    page.locator('input[name="upload_files_btn"]').click(),
  ]);

  const after = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  const created = after.filter(v => !before.includes(v));
  const graphTime = created.length ? created[0] : after[0] || '';
  console.log(graphTime);
  await browser.close();
})().catch(err => {
  console.error(err.message || String(err));
  process.exit(1);
});
NODE
)"

GRAPH_TIME="$(printf '%s\n' "$GRAPH_TIME" | tail -1 | tr -d '\r')"

docker compose exec pipeline bash /app/terminal-script/workflow.sh enrich-existing \
  --graph-time "$GRAPH_TIME" \
  --ospf-file "/app/INPUT-FOLDER/$OSPF_FILE" \
  --host-file "/app/INPUT-FOLDER/$HOST_FILE" \
  --base-url  "http://webserver:8081" \
  --user      "$TOPOLOGRAPH_WEB_API_USERNAME_EMAIL" \
  --pass      "$TOPOLOGRAPH_WEB_API_PASSWORD"

if [[ -z "$GRAPH_TIME" ]]; then
  echo "[08-step] ERROR: could not resolve latest 54-host graph_time"
  exit 1
fi

info "Resolved graph_time: $GRAPH_TIME"
info "Running Docker-native 06-equivalent deep validation"
docker compose exec e2e-runner bash /app/docker/scripts/docker-e2e.sh \
  --graph-time="$GRAPH_TIME"

info "Running hostname-derived country-code regression check"
docker compose exec -T -e GRAPH_TIME="$GRAPH_TIME" e2e-runner \
  node /app/tests/validate-country-derivation.cjs

info "Running layout-persistence regression check"
docker compose exec -T -e GRAPH_TIME="$GRAPH_TIME" e2e-runner \
  node /app/tests/validate-layout-persistence.cjs

info "Running hostname-mapping page regression check"
bash "$PROJECT_ROOT/08-STEP-BY-STEP/scripts/check-hostname-mapping-page.sh"

info "All-Docker validation complete"
info "graph_time=$GRAPH_TIME"
