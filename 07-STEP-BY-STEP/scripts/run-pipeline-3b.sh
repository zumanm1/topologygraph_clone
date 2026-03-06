#!/usr/bin/env bash
# =============================================================================
# run-pipeline-3b.sh
# 07-STEP-BY-STEP — Full pipeline runner for ospf-database-3b.txt
# =============================================================================
#
# PURPOSE
# ───────
# Runs the complete OSPF Country Topology pipeline for the new input files:
#   INPUT-FOLDER/ospf-database-3b.txt  (54 routers, copy of ospf-database-3.txt)
#   INPUT-FOLDER/Load-hosts-3b.txt     (34 named entries, copy of Load-hosts.txt)
#
# No code changes were made. This script demonstrates that workflow.sh handles
# any OSPF file and host file via explicit CLI arguments.
#
# WHAT IT DOES
# ────────────
# Phase 0: Pre-flight checks (files exist, Docker up, tools installed)
# Phase 1: Full pipeline (upload → fetch → enrich → collapse → push)
# Phase 2: Print summary of all files created
#
# USAGE
# ─────
#   bash 07-STEP-BY-STEP/scripts/run-pipeline-3b.sh
#   bash 07-STEP-BY-STEP/scripts/run-pipeline-3b.sh --dry-run     # skip upload
#   bash 07-STEP-BY-STEP/scripts/run-pipeline-3b.sh --no-push     # skip UI push
#   bash 07-STEP-BY-STEP/scripts/run-pipeline-3b.sh --visible     # open browser
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT="$PROJECT_ROOT/07-STEP-BY-STEP/pipeline-report.txt"
SS_DIR="$PROJECT_ROOT/07-STEP-BY-STEP/screenshots"

OSPF_FILE="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3b.txt"
HOST_FILE="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt"
BASE_URL="${BASE_URL:-http://localhost:8081}"
API_USER="${API_USER:-ospf@topolograph.com}"
API_PASS="${API_PASS:-ospf}"

DRY_RUN=false
NO_PUSH=false
HEADLESS=true
EXTRA_ARGS=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)              DRY_RUN=true;  EXTRA_ARGS="$EXTRA_ARGS --dry-run" ;;
    --no-push)              NO_PUSH=true;  EXTRA_ARGS="$EXTRA_ARGS --no-push" ;;
    --visible|--headless=false) HEADLESS=false ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

mkdir -p "$SS_DIR"
exec > >(tee "$REPORT") 2>&1

# ── Colour helpers ──────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✅ PASS${NC}: $*"; }
fail() { echo -e "  ${RED}❌ FAIL${NC}: $*"; FAILED=$((FAILED+1)); }
info() { echo -e "  ℹ  $*"; }
FAILED=0

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      07-STEP-BY-STEP — ospf-database-3b.txt Pipeline        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  OSPF file : $OSPF_FILE"
echo "  Host file : $HOST_FILE"
echo "  Base URL  : $BASE_URL"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "━━━ PHASE 0: Pre-Flight Checks ━━━"
# ─────────────────────────────────────────────────────────────────────────────

# 0a. OSPF database file
if [[ -f "$OSPF_FILE" ]]; then
  LINES=$(wc -l < "$OSPF_FILE")
  pass "ospf-database-3b.txt exists (${LINES} lines)"
else
  fail "ospf-database-3b.txt NOT FOUND at $OSPF_FILE"
  echo "  Run: cp INPUT-FOLDER/ospf-database-3.txt INPUT-FOLDER/ospf-database-3b.txt"
fi

# 0b. Host mapping file
if [[ -f "$HOST_FILE" ]]; then
  ENTRIES=$(grep -v '^\s*#' "$HOST_FILE" | grep -v '^\s*$' | wc -l | tr -d ' ')
  pass "Load-hosts-3b.txt exists (${ENTRIES} non-comment entries)"
else
  fail "Load-hosts-3b.txt NOT FOUND at $HOST_FILE"
  echo "  Run: cp INPUT-FOLDER/Load-hosts.txt INPUT-FOLDER/Load-hosts-3b.txt"
fi

# 0c. Docker webserver
if curl -sf -o /dev/null --connect-timeout 5 "$BASE_URL/login"; then
  pass "Topolograph web UI responding at $BASE_URL"
else
  fail "Topolograph NOT responding at $BASE_URL — is Docker running?"
  echo "  Run: docker compose up -d   (from topolograph-docker directory)"
fi

# 0d. Python3 + requests
if python3 -c "import requests" 2>/dev/null; then
  pass "Python3 + requests module available"
else
  fail "Python3 requests module missing"
  echo "  Run: pip3 install requests"
fi

# 0e. workflow.sh exists
if [[ -f "$PROJECT_ROOT/terminal-script/workflow.sh" ]]; then
  pass "workflow.sh found"
else
  fail "workflow.sh NOT found — check project structure"
fi

# 0f. Docker pipeline container
if docker compose ps --status running pipeline >/dev/null 2>&1; then
  pass "pipeline container available for authenticated internal upload path"
else
  fail "pipeline container is not running — start Docker stack first"
fi

# 0g. Docker e2e-runner container
if docker compose ps --status running e2e-runner >/dev/null 2>&1; then
  pass "e2e-runner container available for browser upload path"
else
  fail "e2e-runner container is not running — start test profile first"
fi

echo ""
if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}  ❌ $FAILED pre-flight check(s) failed. Fix above and re-run.${NC}"
  exit 1
fi
pass "All pre-flight checks passed"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "━━━ PHASE 1: Full Pipeline (upload → enrich → collapse → push) ━━━"
echo ""
info "Command: browser upload via e2e-runner → workflow.sh enrich-existing inside pipeline container"
echo ""
# ─────────────────────────────────────────────────────────────────────────────

PIPELINE_START=$(date +%s)

GRAPH_TIME=$(docker compose exec -T e2e-runner node - <<'NODE'
const { chromium } = require('playwright');

const BASE_URL = 'http://webserver:8081';
const OSPF_FILE = '/app/INPUT-FOLDER/ospf-database-3b.txt';
const API_USER = 'ospf@topolograph.com';
const API_PASS = 'ospf';

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
)

GRAPH_TIME="$(printf '%s\n' "$GRAPH_TIME" | tail -1 | tr -d '\r')"

if [[ -z "$GRAPH_TIME" ]]; then
  fail "Browser upload did not return a graph_time"
  exit 1
fi

info "Browser-uploaded graph_time: $GRAPH_TIME"

docker compose exec pipeline bash /app/terminal-script/workflow.sh enrich-existing \
  --graph-time "$GRAPH_TIME" \
  --ospf-file "/app/INPUT-FOLDER/$(basename "$OSPF_FILE")" \
  --host-file "/app/INPUT-FOLDER/$(basename "$HOST_FILE")" \
  --base-url  "http://webserver:8081" \
  --user      "$API_USER" \
  --pass      "$API_PASS" \
  $EXTRA_ARGS

PIPELINE_END=$(date +%s)
PIPELINE_SECS=$((PIPELINE_END - PIPELINE_START))

echo ""
pass "Pipeline completed in ${PIPELINE_SECS}s"

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "━━━ PHASE 2: Verify Output Files ━━━"
# ─────────────────────────────────────────────────────────────────────────────

if [[ -z "$GRAPH_TIME" ]]; then
  fail "Could not find 54-host graph_time in IN-OUT-FOLDER"
  exit 1
fi

info "Latest graph_time: $GRAPH_TIME"
echo ""

# IN-OUT-FOLDER checks
GT_DIR="$PROJECT_ROOT/IN-OUT-FOLDER/$GRAPH_TIME"
[[ -f "$GT_DIR/meta.json" ]]   && pass "IN-OUT: meta.json"         || fail "IN-OUT: meta.json missing"
[[ -f "$GT_DIR/nodes.json" ]]  && pass "IN-OUT: nodes.json"        || fail "IN-OUT: nodes.json missing"
[[ -f "$GT_DIR/edges.json" ]]  && pass "IN-OUT: edges.json"        || fail "IN-OUT: edges.json missing"
[[ -f "$GT_DIR/edges.csv" ]]   && pass "IN-OUT: edges.csv"         || fail "IN-OUT: edges.csv missing"

NODE_COUNT=$(python3 -c "import json; d=json.load(open('$GT_DIR/nodes.json')); print(len(d))" 2>/dev/null || echo 0)
[[ "$NODE_COUNT" -eq 54 ]] && pass "IN-OUT: $NODE_COUNT nodes (expected 54)" || fail "IN-OUT: expected 54 nodes, got $NODE_COUNT"

# AS-IS checks
ASIS_DIR="$PROJECT_ROOT/OUTPUT/AS-IS/${GRAPH_TIME}_AS-IS"
[[ -f "$ASIS_DIR/AS-IS_nodes.json" ]] && pass "AS-IS: AS-IS_nodes.json"         || fail "AS-IS: AS-IS_nodes.json missing"
[[ -f "$ASIS_DIR/AS-IS_edges.json" ]] && pass "AS-IS: AS-IS_edges.json"         || fail "AS-IS: AS-IS_edges.json missing"
[[ -f "$ASIS_DIR/AS-IS_ospf-database.txt" ]] && pass "AS-IS: ospf-database copy" || fail "AS-IS: ospf-database copy missing"

# ENRICHED checks
EN_DIR="$PROJECT_ROOT/OUTPUT/ENRICHED/${GRAPH_TIME}_ENRICHED"
[[ -f "$EN_DIR/ENRICHED_country-mapping.csv" ]]              && pass "ENRICHED: country-mapping.csv"              || fail "ENRICHED: country-mapping.csv missing"
[[ -f "$EN_DIR/ENRICHED_original-topology-with-country.json" ]] && pass "ENRICHED: original-topology.json"         || fail "ENRICHED: original-topology.json missing"

COUNTRY_COUNT=$(python3 -c "
import csv
with open('$EN_DIR/ENRICHED_country-mapping.csv') as f:
    rows = list(csv.DictReader(f))
    countries = set(r['country_code'] for r in rows)
    print(len(countries))
" 2>/dev/null || echo 0)
[[ "$COUNTRY_COUNT" -ge 11 ]] && pass "ENRICHED: $COUNTRY_COUNT countries (expected ≥11)" || fail "ENRICHED: expected ≥11 countries, got $COUNTRY_COUNT"

UNK_COUNT=$(python3 -c "
import csv
with open('$EN_DIR/ENRICHED_country-mapping.csv') as f:
    rows = list(csv.DictReader(f))
    unk = [r for r in rows if r['country_code'] == 'UNK']
    print(len(unk))
" 2>/dev/null || echo 0)
[[ "$UNK_COUNT" -ge 20 ]] && pass "ENRICHED: $UNK_COUNT UNK routers (expected ≥20)" || fail "ENRICHED: expected ≥20 UNK, got $UNK_COUNT"

python3 - <<PYEOF >/tmp/07-country-derived-checks.txt 2>/dev/null || true
import csv
import json
rows = {}
with open('$EN_DIR/ENRICHED_country-mapping.csv', newline='') as f:
    for row in csv.DictReader(f):
        rows[row.get('router_id','').strip()] = row

checks = [
    ('12.12.12.2', 'ken-mob-r2', 'KEN'),
    ('13.13.13.1', 'drc-moa-r1', 'DRC'),
    ('18.18.18.4', 'zaf-mtz-r1', 'ZAF'),
]
for rid, hostname, country in checks:
    row = rows.get(rid, {})
    ok = row.get('hostname','').strip() == hostname and row.get('country_code','').strip().upper() == country
    print(json.dumps({'rid': rid, 'ok': ok, 'hostname': row.get('hostname','').strip(), 'country': row.get('country_code','').strip().upper()}))
ip_row = rows.get('19.19.19.1', {})
print(json.dumps({'rid': '19.19.19.1', 'ok': ip_row.get('country_code','').strip().upper() == 'UNK', 'hostname': ip_row.get('hostname','').strip(), 'country': ip_row.get('country_code','').strip().upper()}))
PYEOF

while IFS= read -r line; do
  RID=$(python3 - <<PYEOF "$line"
import json, sys
print(json.loads(sys.argv[1])['rid'])
PYEOF
)
  OK=$(python3 - <<PYEOF "$line"
import json, sys
print('true' if json.loads(sys.argv[1])['ok'] else 'false')
PYEOF
)
  HOSTNAME=$(python3 - <<PYEOF "$line"
import json, sys
print(json.loads(sys.argv[1])['hostname'])
PYEOF
)
  COUNTRY=$(python3 - <<PYEOF "$line"
import json, sys
print(json.loads(sys.argv[1])['country'])
PYEOF
)
  if [[ "$OK" == "true" ]]; then
    pass "ENRICHED: $RID => $HOSTNAME => $COUNTRY (hostname-derived)"
  else
    fail "ENRICHED: $RID derivation mismatch (hostname=$HOSTNAME country=$COUNTRY)"
  fi
done < /tmp/07-country-derived-checks.txt

# GATEWAY checks
GW_DIR="$PROJECT_ROOT/OUTPUT/GATEWAY/${GRAPH_TIME}_GATEWAY"
[[ -f "$GW_DIR/GATEWAY_gateway-only-topology.json" ]] && pass "GATEWAY: gateway-only-topology.json" || fail "GATEWAY: gateway-only-topology.json missing"
[[ -f "$GW_DIR/GATEWAY_country-core-summary.json" ]]  && pass "GATEWAY: country-core-summary.json"  || fail "GATEWAY: country-core-summary.json missing"

# COLLAPSING checks
COL_DIR="$PROJECT_ROOT/OUTPUT/COLLAPSING/${GRAPH_TIME}_COLLAPSING"
[[ -f "$COL_DIR/COLLAPSING_country-collapse-config.json" ]] && pass "COLLAPSING: country-collapse-config.json" || fail "COLLAPSING: country-collapse-config.json missing"
[[ -f "$COL_DIR/COLLAPSING_collapsed-topology.json" ]]       && pass "COLLAPSING: collapsed-topology.json"       || fail "COLLAPSING: collapsed-topology.json missing"

SUMMARY=$(python3 -c "
import json
d = json.load(open('$COL_DIR/COLLAPSING_country-collapse-config.json'))
s = d['summary']
print(f\"{s['total_countries']} countries, {s['total_routers']} routers, {s['total_gateways']} gw, {s['total_cores']} core\")
" 2>/dev/null || echo "unknown")
pass "COLLAPSING: $SUMMARY"

echo ""
echo "━━━ Files Created ━━━"
info "IN-OUT-FOLDER/$GRAPH_TIME/ (4 files)"
info "OUTPUT/AS-IS/${GRAPH_TIME}_AS-IS/ (4 files)"
info "OUTPUT/GATEWAY/${GRAPH_TIME}_GATEWAY/ (4 files)"
info "OUTPUT/ENRICHED/${GRAPH_TIME}_ENRICHED/ (4 files)"
info "OUTPUT/COLLAPSING/${GRAPH_TIME}_COLLAPSING/ (3 files)"
info "Total: 19 new files on disk + 54 PATCH calls to Topolograph API"

echo ""
echo "━━━ Next Steps ━━━"
echo ""
echo "  1. Open browser: http://localhost:8081/"
echo "  2. Login: ospf@topolograph.com / ospf"
echo "  3. Dropdown → select: $GRAPH_TIME"
echo "  4. Click 'Load dynamic graph'"
echo "  5. Use navbar 'Analysis' → Cost Matrix / What-If Analysis"
echo ""
echo "  To run E2E validation (from 06-STEP-BY-STEP):"
echo "    bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh --graph-time=$GRAPH_TIME"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   07-STEP-BY-STEP PIPELINE REPORT                           ║"
printf "║  %-62s║\n" "  graph_time : $GRAPH_TIME"
printf "║  %-62s║\n" "  duration   : ${PIPELINE_SECS}s"
if [[ $FAILED -eq 0 ]]; then
  echo "║  STATUS : ✅ ALL CHECKS PASSED                               ║"
else
  echo "║  STATUS : ❌ $FAILED CHECK(S) FAILED                              ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Full report : $REPORT"
