#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-full-e2e-validation.sh
# ─────────────────────────────────────────────────────────────────────────────
#
# 05-STEP-BY-STEP — FULL END-TO-END VALIDATION
#
# OVERVIEW
# ────────
# This is the master entry-point for 05-STEP-BY-STEP, which covers the
# complete OSPF Country Topology pipeline from raw INPUT files through all
# five view modes, plus the three Sprint 3 features committed in af984c7.
#
# ARCHITECTURE (5 phases)
# ───────────────────────
# PHASE 0  Pre-Flight
#   • Docker webserver is up and responding on port 8081
#   • Required INPUT-FOLDER files exist (ospf database + host mapping)
#   • Node.js and Playwright are installed
#   • At least one COLLAPSING artefact exists on disk
#
# PHASE 1  Pipeline Integrity (existing artefacts)
#   • Validates the latest IN-OUT-FOLDER graph_time:
#       meta.json, nodes.json (34 routers), edges.json (≥100 edges)
#   • Validates all OUTPUT stage artefacts for the latest graph_time:
#       AS-IS   → nodes (34), edges (≥100)
#       GATEWAY → nodes (28), edges, ZAF has 5 gateways
#       ENRICHED → country-mapping.csv, ≥10 countries
#       COLLAPSING → config (10 ctry, 34 rtr, 28 gw, 6 core), topology (28 nodes)
#
# PHASE 2  Optional Fresh Pipeline Run
#   • When --run-pipeline flag is given, executes:
#       workflow.sh all --ospf-file INPUT-FOLDER/ospf-database-2.txt \
#                       --host-file INPUT-FOLDER/Load-hosts.txt
#   • Validates fresh artefacts after the run
#
# PHASE 3  Playwright UI — Full End-to-End
#   • Runs validate-full-e2e.cjs which covers:
#       AUTH, LOAD, P1 AS-IS, P2 ENRICHED, P3 GATEWAY, P4 CURRENT,
#       P5 COLLAPSING (panel + collapse + badge + cost agg + path overlay),
#       P6 UNK Highlight, P7 Hostname Upload, P8 Cost Matrix, P9 What-If
#   • 50+ checks across all 5 view modes and all 3 Sprint 3 features
#
# OUTPUTS
#   05-STEP-BY-STEP/validation-report.txt  — full tee'd log
#   05-STEP-BY-STEP/screenshots/           — auto-populated PNGs (01..17)
#
# USAGE
#   bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh
#   bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh --run-pipeline
#   bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh --skip-phase1
#   bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh --visible
#   bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh \
#        --graph-time 04Mar2026_12h25m56s_34_hosts
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT="$PROJECT_ROOT/05-STEP-BY-STEP/validation-report.txt"
SS_DIR="$PROJECT_ROOT/05-STEP-BY-STEP/screenshots"
PLAYWRIGHT_SCRIPT="$PROJECT_ROOT/tests/validate-full-e2e.cjs"
WORKFLOW="$PROJECT_ROOT/terminal-script/workflow.sh"

# ── Defaults ─────────────────────────────────────────────────────────────────
HEADLESS="${HEADLESS:-true}"
RUN_PIPELINE=false
SKIP_PHASE1=false
GRAPH_TIME_ARG=""
BASE_URL="${BASE_URL:-http://localhost:8081}"
API_USER="${API_USER:-ospf@topolograph.com}"
API_PASS="${API_PASS:-ospf}"

for arg in "$@"; do
  case "$arg" in
    --run-pipeline)             RUN_PIPELINE=true ;;
    --skip-phase1)              SKIP_PHASE1=true ;;
    --visible|--headless=false) HEADLESS=false ;;
    --graph-time=*)             GRAPH_TIME_ARG="${arg#--graph-time=}" ;;
    --graph-time)               ;;
  esac
done

mkdir -p "$SS_DIR"

# ── Resolve latest graph_time ─────────────────────────────────────────────────
resolve_graph_time() {
  local inout="$PROJECT_ROOT/IN-OUT-FOLDER"
  if [ -n "$GRAPH_TIME_ARG" ]; then
    echo "$GRAPH_TIME_ARG"; return
  fi
  # Pick latest dir that has nodes.json
  local gt=""
  for d in "$inout"/*/; do
    [ -f "$d/nodes.json" ] && gt="$(basename "$d")"
  done
  if [ -z "$gt" ]; then
    echo "04Mar2026_12h25m56s_34_hosts"
  else
    echo "$gt"
  fi
}
GRAPH_TIME="$(resolve_graph_time)"

# ── Header ────────────────────────────────────────────────────────────────────
{
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║   05-STEP-BY-STEP — FULL END-TO-END VALIDATION REPORT               ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║   Date        : $(date '+%Y-%m-%d %H:%M:%S')                                     ║"
echo "║   Graph time  : $GRAPH_TIME"
echo "║   Headless    : $HEADLESS"
echo "║   Run pipeline: $RUN_PIPELINE"
echo "║   Project     : $PROJECT_ROOT"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
} | tee "$REPORT"

# ── PHASE 0: Pre-flight ───────────────────────────────────────────────────────
echo "━━━ PHASE 0: Pre-Flight Checks ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

P0_FAIL=0

# 0a. Docker webserver
if curl -s --max-time 5 "$BASE_URL/login" | grep -q "login\|Topolograph\|ospf" 2>/dev/null; then
  echo "  ✅ PASS: Webserver responding at $BASE_URL" | tee -a "$REPORT"
else
  echo "  ❌ FAIL: Webserver NOT responding at $BASE_URL — is Docker running?" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0b. Input files
for f in \
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt" \
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt" \
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"; do
  if [ -f "$f" ]; then
    echo "  ✅ PASS: Input file exists: $(basename "$f")" | tee -a "$REPORT"
  else
    echo "  ⚠  WARN: Input file not found: $f" | tee -a "$REPORT"
  fi
done

# 0c. Node.js
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version)"
  echo "  ✅ PASS: Node.js $NODE_VER found" | tee -a "$REPORT"
else
  echo "  ❌ FAIL: Node.js not found — cannot run Playwright tests" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0d. Playwright
if [ -d "$PROJECT_ROOT/tests/node_modules/playwright" ] || \
   [ -d "$PROJECT_ROOT/tests/node_modules/playwright-core" ]; then
  echo "  ✅ PASS: Playwright found in tests/node_modules" | tee -a "$REPORT"
else
  echo "  ⚠  WARN: Playwright not found in tests/node_modules — will try to install" | tee -a "$REPORT"
  cd "$PROJECT_ROOT/tests" && npm install 2>&1 | tail -5 | tee -a "$REPORT"
fi

# 0e. COLLAPSING artefacts exist
COL_ROOT="$PROJECT_ROOT/OUTPUT/COLLAPSING"
COL_COUNT=0
if [ -d "$COL_ROOT" ]; then
  for d in "$COL_ROOT"/*/; do
    [ -f "$d/COLLAPSING_country-collapse-config.json" ] && COL_COUNT=$((COL_COUNT+1))
  done
fi
if [ "$COL_COUNT" -gt 0 ]; then
  echo "  ✅ PASS: $COL_COUNT COLLAPSING artefact director(y|ies) found" | tee -a "$REPORT"
else
  echo "  ❌ FAIL: No COLLAPSING artefacts found — run workflow.sh first" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0f. IN-OUT-FOLDER has the target graph_time
INOUT_DIR="$PROJECT_ROOT/IN-OUT-FOLDER/$GRAPH_TIME"
if [ -d "$INOUT_DIR" ] && [ -f "$INOUT_DIR/nodes.json" ]; then
  echo "  ✅ PASS: IN-OUT-FOLDER/$GRAPH_TIME exists with nodes.json" | tee -a "$REPORT"
else
  echo "  ⚠  WARN: IN-OUT-FOLDER/$GRAPH_TIME/nodes.json not found" | tee -a "$REPORT"
fi

if [ "$P0_FAIL" -gt 0 ]; then
  echo "" | tee -a "$REPORT"
  echo "  ❌ PHASE 0 FAILED ($P0_FAIL critical failure(s)) — aborting." | tee -a "$REPORT"
  exit 1
fi

echo "" | tee -a "$REPORT"
echo "  PHASE 0: ALL PRE-FLIGHT CHECKS PASSED ✅" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── PHASE 1: JSON Artefact Integrity ─────────────────────────────────────────
if [ "$SKIP_PHASE1" = "false" ]; then
  echo "━━━ PHASE 1: JSON Artefact Integrity ━━━" | tee -a "$REPORT"
  echo "  Graph time: $GRAPH_TIME" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"

  GT="$GRAPH_TIME" PROJECT="$PROJECT_ROOT" python3 << 'PYEOF' | tee -a "$REPORT"
import json, sys, os, re
gt      = os.environ['GT']
proj    = os.environ['PROJECT']
inout   = os.path.join(proj, 'IN-OUT-FOLDER', gt)
asis    = os.path.join(proj, 'OUTPUT', 'AS-IS',    gt + '_AS-IS')
gw      = os.path.join(proj, 'OUTPUT', 'GATEWAY',  gt + '_GATEWAY')
enrich  = os.path.join(proj, 'OUTPUT', 'ENRICHED', gt + '_ENRICHED')
col     = os.path.join(proj, 'OUTPUT', 'COLLAPSING', gt + '_COLLAPSING')
current = os.path.join(proj, 'OUTPUT', 'CURRENT')

PASS, FAIL = 0, 0

def chk(cond, ok_msg, fail_msg):
    global PASS, FAIL
    if cond:
        print(f"  ✅ PASS: {ok_msg}")
        PASS += 1
    else:
        print(f"  ❌ FAIL: {fail_msg}")
        FAIL += 1
    return cond

# ── Derive expected counts dynamically from graph_time + COLLAPSING config ───
m = re.search(r'_(\d+)_hosts', gt)
expected_hosts = int(m.group(1)) if m else None

# Pre-load COLLAPSING config to get dynamic expected values
col_cfg_path  = os.path.join(col, 'COLLAPSING_country-collapse-config.json')
col_topo_path = os.path.join(col, 'COLLAPSING_collapsed-topology.json')
col_cfg  = json.load(open(col_cfg_path))  if os.path.exists(col_cfg_path)  else None
col_topo = json.load(open(col_topo_path)) if os.path.exists(col_topo_path) else None

if col_cfg:
    s = col_cfg['summary']
    exp_countries = s['total_countries']
    exp_routers   = s['total_routers']
    exp_gateways  = s['total_gateways']
    exp_cores     = s['total_cores']
    if expected_hosts is None:
        expected_hosts = exp_routers
else:
    exp_countries, exp_routers, exp_gateways, exp_cores = 10, 34, 28, 6
    if expected_hosts is None:
        expected_hosts = 34

print(f"  [detected] expected_hosts={expected_hosts}  "
      f"gateways={exp_gateways}  countries={exp_countries}  cores={exp_cores}")

# ── IN-OUT-FOLDER ────────────────────────────────────────────────────────────
print("  [1a] IN-OUT-FOLDER")
try:
    meta  = json.load(open(os.path.join(inout, 'meta.json')))
    nodes = json.load(open(os.path.join(inout, 'nodes.json')))
    edges = json.load(open(os.path.join(inout, 'edges.json')))
    chk(True, f"IN-OUT files loaded (meta.json, nodes.json, edges.json)", "N/A")
    chk(len(nodes) == expected_hosts,
        f"IN-OUT nodes: {len(nodes)} == {expected_hosts}",
        f"IN-OUT nodes: {len(nodes)} != {expected_hosts}")
    chk(len(edges) >= 100, f"IN-OUT edges: {len(edges)} >= 100", f"IN-OUT edges: {len(edges)} < 100")
except Exception as e:
    print(f"  ❌ FAIL: IN-OUT-FOLDER load error: {e}")
    FAIL += 1

# ── AS-IS ────────────────────────────────────────────────────────────────────
print("  [1b] AS-IS")
try:
    # AS-IS stores nodes and edges as flat lists in separate files
    an_file = os.path.join(asis, 'AS-IS_nodes.json')
    ae_file = os.path.join(asis, 'AS-IS_edges.json')
    if not os.path.exists(an_file):
        # fallback: combined topology JSON
        af = os.path.join(asis, 'AS-IS_original-topology-with-country.json')
        if not os.path.exists(af):
            af = os.path.join(asis, 'original-topology-with-country.json')
        asis_data = json.load(open(af))
        an = asis_data.get('nodes', [])
        ae = asis_data.get('edges', [])
    else:
        an = json.load(open(an_file))
        ae = json.load(open(ae_file))
    chk(len(an) == expected_hosts,
        f"AS-IS nodes: {len(an)} == {expected_hosts}",
        f"AS-IS nodes: {len(an)} != {expected_hosts}")
    chk(len(ae) >= 100, f"AS-IS edges: {len(ae)} >= 100", f"AS-IS edges: {len(ae)} < 100")
except Exception as e:
    print(f"  ❌ FAIL: AS-IS load error: {e}")
    FAIL += 1

# ── GATEWAY ──────────────────────────────────────────────────────────────────
print("  [1c] GATEWAY")
try:
    gf = os.path.join(gw, 'GATEWAY_gateway-only-topology.json')
    if not os.path.exists(gf):
        gf = os.path.join(gw, 'gateway-only-topology.json')
    gw_data = json.load(open(gf))
    gn = gw_data.get('nodes', [])
    ge = gw_data.get('edges', [])
    chk(len(gn) == exp_gateways,
        f"GATEWAY nodes: {len(gn)} == {exp_gateways}",
        f"GATEWAY nodes: {len(gn)} != {exp_gateways}")
    chk(len(ge) > 0, f"GATEWAY edges: {len(ge)}", f"GATEWAY edges: 0")
    zaf_gw = [n for n in gn if n.get('country') == 'ZAF']
    chk(len(zaf_gw) == 5, f"ZAF gateway nodes: {len(zaf_gw)} == 5", f"ZAF gateway: {len(zaf_gw)} != 5")
except Exception as e:
    print(f"  ❌ FAIL: GATEWAY load error: {e}")
    FAIL += 1

# ── ENRICHED ─────────────────────────────────────────────────────────────────
print("  [1d] ENRICHED")
try:
    cm = os.path.join(enrich, 'ENRICHED_country-mapping.csv')
    if not os.path.exists(cm):
        cm = os.path.join(enrich, 'country-mapping.csv')
    with open(cm) as f:
        lines = [l.strip() for l in f if l.strip() and not l.startswith('#')]
    # country_code is at column index 2 (router_id,hostname,country_code,is_gateway)
    country_col = 2
    if lines and lines[0].startswith('router_id,'):
        hdr = lines[0].split(',')
        for i, h in enumerate(hdr):
            if 'country' in h.lower(): country_col = i; break
    countries = set(l.split(',')[country_col].strip() for l in lines[1:] if len(l.split(',')) > country_col)
    chk(len(countries) >= 10,
        f"ENRICHED countries: {len(countries)} >= 10 ({', '.join(sorted(countries))})",
        f"ENRICHED countries: {len(countries)} < 10")
    chk(os.path.exists(os.path.join(enrich, 'ENRICHED_original-topology-with-country.json'))
        or os.path.exists(os.path.join(enrich, 'original-topology-with-country.json')),
        "ENRICHED topology JSON exists", "ENRICHED topology JSON missing")
except Exception as e:
    print(f"  ❌ FAIL: ENRICHED load error: {e}")
    FAIL += 1

# ── COLLAPSING ───────────────────────────────────────────────────────────────
print("  [1e] COLLAPSING")
try:
    if col_cfg is None or col_topo is None:
        raise FileNotFoundError("COLLAPSING config or topology JSON not found")
    s = col_cfg['summary']
    print(f"       config: {s['total_countries']} ctry | {s['total_routers']} rtr | "
          f"{s['total_gateways']} gw | {s['total_cores']} core")
    chk(s['total_countries'] >= 10,
        f"{s['total_countries']} countries (>=10)",
        f"countries: {s['total_countries']} < 10")
    chk(s['total_routers'] == expected_hosts,
        f"{s['total_routers']} routers == {expected_hosts}",
        f"routers: {s['total_routers']} != {expected_hosts}")
    chk(s['total_gateways'] > 0,
        f"{s['total_gateways']} gateways > 0",
        "gateways: 0 — pipeline error")
    chk(s['total_cores'] > 0,
        f"{s['total_cores']} core nodes > 0",
        "cores: 0 — pipeline error")
    chk(len(col_topo['nodes']) == s['total_gateways'],
        f"collapsed topology nodes: {len(col_topo['nodes'])} == {s['total_gateways']}",
        f"topo nodes: {len(col_topo['nodes'])} != {s['total_gateways']}")
    # ZAF cores in config — key can be 'core_nodes' or 'core_ids' or 'core_count'
    zaf_cfg = col_cfg['countries'].get('ZAF', {})
    zaf_cores = zaf_cfg.get('core_count', len(zaf_cfg.get('core_ids', zaf_cfg.get('core_nodes', []))))
    if isinstance(zaf_cores, list): zaf_cores = len(zaf_cores)
    chk(zaf_cores == 3, f"ZAF core nodes: {zaf_cores} == 3", f"ZAF core nodes: {zaf_cores} != 3")
    # UNK country — if present, validate it has routers properly classified
    if 'UNK' in col_cfg['countries']:
        unk = col_cfg['countries']['UNK']
        unk_total = unk.get('total', 0)
        unk_gw    = unk.get('gateway_count', 0)
        unk_core  = unk.get('core_count', 0)
        chk(unk_total > 0,
            f"UNK present: total={unk_total} gw={unk_gw} core={unk_core}",
            "UNK entry in COLLAPSING config has total=0")
        print(f"       UNK: {unk_total} routers ({unk_gw} gw + {unk_core} core) — unmapped, treated as country group")
except Exception as e:
    print(f"  ❌ FAIL: COLLAPSING load error: {e}")
    FAIL += 1

# ── CURRENT ──────────────────────────────────────────────────────────────────
print("  [1f] CURRENT (OUTPUT/CURRENT/)")
try:
    cur_gw  = os.path.join(current, 'gateway-only-topology.json')
    cur_enr = os.path.join(current, 'country-core-summary.json')
    chk(os.path.exists(cur_gw),  "CURRENT gateway topology exists",    "CURRENT gateway topology missing")
    chk(os.path.exists(cur_enr), "CURRENT country-core summary exists", "CURRENT country-core summary missing")
except Exception as e:
    print(f"  ❌ FAIL: CURRENT load error: {e}")
    FAIL += 1

print("")
print(f"  PHASE 1 RESULT: {PASS} passed, {FAIL} failed")
if FAIL > 0:
    sys.exit(1)
PYEOF

  echo "" | tee -a "$REPORT"
  echo "━━━ PHASE 1 COMPLETE ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
else
  echo "━━━ PHASE 1: SKIPPED (--skip-phase1) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
fi

# ── PHASE 2: Optional Fresh Pipeline Run ──────────────────────────────────────
if [ "$RUN_PIPELINE" = "true" ]; then
  echo "━━━ PHASE 2: Fresh Pipeline Run ━━━" | tee -a "$REPORT"
  echo "  Running: workflow.sh all ..." | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"

  if [ ! -f "$WORKFLOW" ]; then
    echo "  ❌ FAIL: workflow.sh not found at $WORKFLOW" | tee -a "$REPORT"
  else
    OSPF_FILE="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt"
    HOST_FILE="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt"

    bash "$WORKFLOW" all \
      --ospf-file "$OSPF_FILE" \
      --host-file "$HOST_FILE" \
      --base-url  "$BASE_URL" \
      --user      "$API_USER" \
      --pass      "$API_PASS" 2>&1 | tee -a "$REPORT"

    # Refresh GRAPH_TIME after fresh run
    GRAPH_TIME="$(resolve_graph_time)"
    echo "" | tee -a "$REPORT"
    echo "  ✅ PASS: Pipeline run complete — new graph_time: $GRAPH_TIME" | tee -a "$REPORT"
  fi

  echo "" | tee -a "$REPORT"
  echo "━━━ PHASE 2 COMPLETE ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
else
  echo "━━━ PHASE 2: PIPELINE RUN SKIPPED (add --run-pipeline to trigger) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
fi

# ── PHASE 3: Playwright Full E2E ──────────────────────────────────────────────
echo "━━━ PHASE 3: Playwright Full E2E (9 phases, 50+ checks) ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

if [ ! -f "$PLAYWRIGHT_SCRIPT" ]; then
  echo "  ❌ FAIL: Playwright script not found: $PLAYWRIGHT_SCRIPT" | tee -a "$REPORT"
  exit 1
fi

cd "$PROJECT_ROOT/tests"

GRAPH_TIMES="$GRAPH_TIME" \
HEADLESS="$HEADLESS" \
BASE_URL="$BASE_URL" \
API_USER="$API_USER" \
API_PASS="$API_PASS" \
  node validate-full-e2e.cjs 2>&1 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "━━━ Screenshots saved to: $SS_DIR/ ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── Grand summary ─────────────────────────────────────────────────────────────
PASS_COUNT=$( { grep "✅ PASS" "$REPORT" 2>/dev/null || true; } | wc -l | tr -d ' ')
FAIL_COUNT=$( { grep "❌ FAIL" "$REPORT" 2>/dev/null || true; } | wc -l | tr -d ' ')

echo "╔══════════════════════════════════════════════════════════════════════╗" | tee -a "$REPORT"
printf "║  TOTAL: %-3s PASSED  |  %-3s FAILED%-35s║\n" "$PASS_COUNT" "$FAIL_COUNT" "" | tee -a "$REPORT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "║  STATUS: ALL 05-STEP-BY-STEP CHECKS PASSED ✅                        ║" | tee -a "$REPORT"
else
  echo "║  STATUS: SOME CHECKS FAILED ❌ — review report above                ║" | tee -a "$REPORT"
fi
echo "╚══════════════════════════════════════════════════════════════════════╝" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
echo "  Full report : $REPORT" | tee -a "$REPORT"
echo "  Screenshots : $SS_DIR/" | tee -a "$REPORT"
echo "  Graph time  : $GRAPH_TIME" | tee -a "$REPORT"
