#!/usr/bin/env bash
# =============================================================================
# 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
# All-Docker rebuild + pipeline + deep E2E validation
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT="$PROJECT_ROOT/08-STEP-BY-STEP/validation-report.txt"
COMPOSE_CMD=(docker compose --project-directory "$PROJECT_ROOT" -f "$PROJECT_ROOT/docker-compose.yml")

resolve_default_host_file() {
  local candidates=(
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-54-unk-test.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/host-file.txt"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      basename "$candidate"
      return 0
    fi
  done
  printf '%s\n' 'Load-hosts.csv'
}

OSPF_FILE="${OSPF_FILE:-ospf-database-54-unk-test.txt}"
HOST_FILE="${HOST_FILE:-$(resolve_default_host_file)}"

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

wait_for_docker_app() {
  local max_wait=90
  local waited=0
  local code="000"
  # Wait for /login — requires full Flask app registration (stricter than just '/')
  while [[ "$waited" -lt "$max_wait" ]]; do
    code=$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$INTERNAL_BASE_URL" sh -lc 'curl -s -o /tmp/08-ready.html -w "%{http_code}" "$BASE_URL/login" || echo "000"' 2>/dev/null || echo "000")
    if [[ "$code" == "200" ]]; then
      # Extra stabilisation sleep so Flask finishes registering all routes
      sleep 5
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

info "Project root: $PROJECT_ROOT"
info "Rebuilding all-Docker stack"

"${COMPOSE_CMD[@]}" down

"${COMPOSE_CMD[@]}" build

"${COMPOSE_CMD[@]}" up -d

"${COMPOSE_CMD[@]}" --profile test up -d e2e-runner

info "Validating bearer-token API security"
TOKEN_NAME="08-step-bearer-$(date +%s)"

if ! wait_for_docker_app; then
  echo "[08-step] ERROR: modified app did not become ready at $INTERNAL_BASE_URL"
  exit 1
fi

BEARER_TOKEN="$("${COMPOSE_CMD[@]}" exec -T pipeline python3 - <<PYEOF
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
match = re.search(r'(sk-[A-Za-z0-9_\-]+)', r.text)
print(match.group(1) if match else '')
PYEOF
)"
BEARER_TOKEN="$(printf '%s' "$BEARER_TOKEN" | tail -1 | tr -d '\r')"

if [[ -z "$BEARER_TOKEN" ]]; then
  echo "[08-step] ERROR: bearer token was not created"
  exit 1
fi

CURL_STATUS="$("${COMPOSE_CMD[@]}" exec -T e2e-runner env BASE_URL="$INTERNAL_BASE_URL" BEARER_TOKEN="$BEARER_TOKEN" sh -lc 'curl -s -o /tmp/08-step-bearer-graph.json -w "%{http_code}" -H "Authorization: Bearer $BEARER_TOKEN" "$BASE_URL/api/graph/"')"

if [[ "$CURL_STATUS" != "200" ]]; then
  echo "[08-step] ERROR: bearer-authenticated /api/graph/ returned HTTP $CURL_STATUS"
  exit 1
fi

info "Bearer-token /api/graph/ validation: PASS"

info "Running Docker-native 07-equivalent pipeline validation"
GRAPH_TIME="$("${COMPOSE_CMD[@]}" exec -T \
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
  await page.locator('input[name="upload_files_btn"]').click();
  await page.waitForFunction(
    (previous) => {
      const options = Array.from(document.querySelectorAll('#dynamic_graph_time option')).map((o) => o.value);
      return options.length > 0 && options.join('|') !== previous;
    },
    before.join('|'),
    { timeout: 120000 }
  );

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

"${COMPOSE_CMD[@]}" exec pipeline bash /app/terminal-script/workflow.sh enrich-existing \
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
"${COMPOSE_CMD[@]}" exec e2e-runner bash /app/docker/scripts/docker-e2e.sh \
  --graph-time="$GRAPH_TIME"

# Regression checks need a fresh graph — the deep E2E run mutates the existing
# graph_time via What-If cost changes and hostname rewrites, so reusing it causes
# null-country failures. Upload a new graph specifically for these checks.
info "Uploading fresh graph for regression checks"
REGRESSION_GRAPH_TIME="$("${COMPOSE_CMD[@]}" exec -T \
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
  await page.locator('input[name="upload_files_btn"]').click();
  await page.waitForFunction(
    (previous) => {
      const options = Array.from(document.querySelectorAll('#dynamic_graph_time option')).map((o) => o.value);
      return options.length > 0 && options.join('|') !== previous;
    },
    before.join('|'),
    { timeout: 120000 }
  );
  const after = await page.$$eval('#dynamic_graph_time option', opts => opts.map(o => o.value));
  const created = after.filter(v => !before.includes(v));
  console.log(created.length ? created[0] : after[0] || '');
  await browser.close();
})().catch(err => { console.error(err.message || String(err)); process.exit(1); });
NODE
)"
REGRESSION_GRAPH_TIME="$(printf '%s\n' "$REGRESSION_GRAPH_TIME" | tail -1 | tr -d '\r')"
if [[ -z "$REGRESSION_GRAPH_TIME" ]]; then
  echo "[08-step] WARN: could not upload fresh regression graph — reusing deep-E2E graph_time"
  REGRESSION_GRAPH_TIME="$GRAPH_TIME"
fi
info "Regression graph_time: $REGRESSION_GRAPH_TIME"

info "Running hostname-derived country-code regression check"
"${COMPOSE_CMD[@]}" exec -T -e GRAPH_TIME="$REGRESSION_GRAPH_TIME" e2e-runner \
  node /app/tests/validate-country-derivation.cjs

info "Running layout-persistence regression check"
"${COMPOSE_CMD[@]}" exec -T -e GRAPH_TIME="$REGRESSION_GRAPH_TIME" e2e-runner \
  node /app/tests/validate-layout-persistence.cjs

info "Running hostname-mapping page regression check"
bash "$PROJECT_ROOT/08-STEP-BY-STEP/scripts/check-hostname-mapping-page.sh"

info "All-Docker validation complete"
info "graph_time=$GRAPH_TIME"
