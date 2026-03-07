#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-full-e2e-v2.sh — 06-STEP-BY-STEP DEEP VALIDATION
# ─────────────────────────────────────────────────────────────────────────────
#
# OVERVIEW
# ────────
# Deeper validation of the full OSPF Country Topology pipeline using the
# 54-router graph (ospf-database-3.txt + Load-hosts.txt with 34 entries
# → 20 UNK nodes).  Tests every pipeline stage PLUS all Sprint 3 features
# including the Excel export, ↺ Refresh fix, Apply Change + Matrix integration.
#
# PHASES
# ──────
# PHASE 0  Pre-Flight (10 checks)
#   • Docker webserver, input files (db2 + db3), host files
#   • standard host-file fixtures available for hostname-derived country tests
#   • Node.js + Playwright installed
#   • 54-host COLLAPSING artefacts exist
#   • UNK present in COLLAPSING config
#
# PHASE 1  JSON Artefact Integrity (dynamic, ~22 checks)
#   • Auto-detects expected node count from graph_time + COLLAPSING config
#   • IN-OUT: 54 nodes, 148 edges
#   • AS-IS: 54 nodes, 148 edges
#   • GATEWAY: 32 gateway nodes, ZAF 5 gw, UNK 4 gw
#   • ENRICHED: 11 countries (DJB DRC FRA GBR KEN LES MOZ POR TAN UNK ZAF)
#   • COLLAPSING: 11 ctry, 54 rtr, 32 gw, 22 core; UNK 4gw+16core
#   • CURRENT: gateway topology + country-core summary
#
# PHASE 2  Optional Fresh Pipeline Run
#   • --run-pipeline-db3: runs workflow.sh with ospf-database-3.txt
#
# PHASE 3  Playwright E2E (12 phases, 90+ checks)
#   • validate-full-e2e-v2.cjs
#
# USAGE
#   bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh
#   bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh --run-pipeline-db3
#   bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh --visible
#   bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh --skip-phase1
#   bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh \
#        --graph-time=05Mar2026_11h35m45s_54_hosts
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT="$PROJECT_ROOT/06-STEP-BY-STEP/validation-report.txt"
SS_DIR="$PROJECT_ROOT/06-STEP-BY-STEP/screenshots"
PLAYWRIGHT_SCRIPT="$PROJECT_ROOT/tests/validate-full-e2e-v2.cjs"
WORKFLOW="$PROJECT_ROOT/terminal-script/workflow.sh"

# ── Defaults ──────────────────────────────────────────────────────────────────
HEADLESS="${HEADLESS:-true}"
RUN_PIPELINE=false
SKIP_PHASE1=false
GRAPH_TIME_ARG=""
BASE_URL="${BASE_URL:-http://localhost:8081}"
API_USER="${API_USER:-ospf@topolograph.com}"
API_PASS="${API_PASS:-ospf}"

for arg in "$@"; do
  case "$arg" in
    --run-pipeline-db3)         RUN_PIPELINE=true ;;
    --skip-phase1)              SKIP_PHASE1=true ;;
    --visible|--headless=false) HEADLESS=false ;;
    --graph-time=*)             GRAPH_TIME_ARG="${arg#--graph-time=}" ;;
  esac
done

mkdir -p "$SS_DIR"

# ── Resolve latest 54-host graph_time ─────────────────────────────────────────
resolve_graph_time() {
  local inout="$PROJECT_ROOT/IN-OUT-FOLDER"
  if [ -n "$GRAPH_TIME_ARG" ]; then echo "$GRAPH_TIME_ARG"; return; fi
  local gt=""
  # Prefer _54_hosts entries
  for d in "$inout"/*_54_hosts/; do
    [ -f "$d/nodes.json" ] && gt="$(basename "$d")"
  done
  if [ -z "$gt" ]; then
    # Fall back to any entry
    for d in "$inout"/*/; do
      [ -f "$d/nodes.json" ] && gt="$(basename "$d")"
    done
  fi
  [ -n "$gt" ] && echo "$gt" || echo "05Mar2026_11h35m45s_54_hosts"
}
GRAPH_TIME="$(resolve_graph_time)"

resolve_first_existing() {
  local candidate
  for candidate in "$@"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf '%s\n' ""
}

RESOLVED_OSPF_FILE="$(resolve_first_existing \
  "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-54-unk-test.txt" \
  "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3.txt" \
  "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt" \
  "$PROJECT_ROOT/INPUT-FOLDER/ospf-database.txt")"
RESOLVED_HOST_FILE="$(resolve_first_existing \
  "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt" \
  "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv" \
  "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt" \
  "$PROJECT_ROOT/INPUT-FOLDER/host-file.txt")"

# ── Header ────────────────────────────────────────────────────────────────────
{
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║   06-STEP-BY-STEP — DEEP END-TO-END VALIDATION REPORT               ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║   Date        : $(date '+%Y-%m-%d %H:%M:%S')"
echo "║   Graph time  : $GRAPH_TIME"
echo "║   OSPF file   : $(basename "${RESOLVED_OSPF_FILE:-unresolved}")"
echo "║   Host file   : $(basename "${RESOLVED_HOST_FILE:-unresolved}")"
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
  echo "  ❌ FAIL: Webserver NOT responding — is Docker running?" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0b. OSPF input files
FOUND_OSPF=0
for f in \
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-54-unk-test.txt" \
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3.txt" \
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt" \
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database.txt"; do
  if [ -f "$f" ]; then
    LINES=$(wc -l < "$f")
    echo "  ✅ PASS: Input file: $(basename "$f") (${LINES} lines)" | tee -a "$REPORT"
    FOUND_OSPF=1
  else
    echo "  ⚠  WARN: Input file missing: $f" | tee -a "$REPORT"
  fi
done
if [ "$FOUND_OSPF" -eq 0 ]; then
  echo "  ❌ FAIL: No usable OSPF input fixture found in INPUT-FOLDER" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0c. Host file (should have only 34 entries for UNK demo)
HOST_FILE="$RESOLVED_HOST_FILE"
if [ -f "$HOST_FILE" ]; then
  if [[ "$HOST_FILE" == *.csv ]]; then
    HOST_COUNT=$(tail -n +2 "$HOST_FILE" | wc -l | tr -d ' ')
  else
    HOST_COUNT=$(grep -v '^[[:space:]]*#' "$HOST_FILE" | grep -v '^[[:space:]]*$' | wc -l | tr -d ' ')
  fi
  echo "  ✅ PASS: $(basename "$HOST_FILE") exists ($HOST_COUNT router entries)" | tee -a "$REPORT"
  [ "$HOST_COUNT" -eq 34 ] && echo "  ✅ PASS: $(basename "$HOST_FILE") has exactly 34 entries (20 UNK routers unmapped)" | tee -a "$REPORT" \
    || echo "  ⚠  WARN: $(basename "$HOST_FILE") has $HOST_COUNT entries (expected 34 for UNK demo)" | tee -a "$REPORT"
else
  echo "  ❌ FAIL: No usable host file found in INPUT-FOLDER" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0d. Standard host-file fixtures for hostname-derived country tests
STD_HOST_CSV="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"
STD_HOST_TXT="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt"
if [ -f "$STD_HOST_CSV" ]; then
  CSV_ROWS=$(tail -n +2 "$STD_HOST_CSV" | wc -l | tr -d ' ')
  echo "  ✅ PASS: Load-hosts.csv exists ($CSV_ROWS router mappings)" | tee -a "$REPORT"
  [ "$CSV_ROWS" -ge 34 ] \
    && echo "  ✅ PASS: Load-hosts.csv provides $CSV_ROWS hostname mappings (≥34)" | tee -a "$REPORT" \
    || echo "  ⚠  WARN: Load-hosts.csv has $CSV_ROWS entries (expected ≥34)" | tee -a "$REPORT"
elif [ -f "$STD_HOST_TXT" ]; then
  TXT_ROWS=$(grep -v '^[[:space:]]*#' "$STD_HOST_TXT" | grep -v '^[[:space:]]*$' | wc -l | tr -d ' ')
  echo "  ✅ PASS: Load-hosts-3b.txt exists ($TXT_ROWS router mappings)" | tee -a "$REPORT"
  [ "$TXT_ROWS" -ge 34 ] \
    && echo "  ✅ PASS: Load-hosts-3b.txt provides $TXT_ROWS hostname mappings (≥34)" | tee -a "$REPORT" \
    || echo "  ⚠  WARN: Load-hosts-3b.txt has $TXT_ROWS entries (expected ≥34)" | tee -a "$REPORT"
else
  echo "  ⚠  WARN: No standard host-file fixture found (P7 will use inline fallback)" | tee -a "$REPORT"
fi

# 0e. Node.js
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version)"
  echo "  ✅ PASS: Node.js $NODE_VER" | tee -a "$REPORT"
else
  echo "  ❌ FAIL: Node.js not found" | tee -a "$REPORT"
  P0_FAIL=$((P0_FAIL+1))
fi

# 0f. Playwright
if [ -d "$PROJECT_ROOT/tests/node_modules/playwright" ] || \
   [ -d "$PROJECT_ROOT/tests/node_modules/playwright-core" ]; then
  echo "  ✅ PASS: Playwright found" | tee -a "$REPORT"
else
  echo "  ⚠  WARN: Playwright not found — installing..." | tee -a "$REPORT"
  cd "$PROJECT_ROOT/tests" && npm install 2>&1 | tail -3 | tee -a "$REPORT"
fi

# 0g. 54-host COLLAPSING artefacts
COL_54=""
for d in "$PROJECT_ROOT/OUTPUT/COLLAPSING"/*_54_hosts_COLLAPSING/; do
  [ -f "$d/COLLAPSING_country-collapse-config.json" ] && COL_54="$d"
done
[ -n "$COL_54" ] \
  && echo "  ✅ PASS: 54-host COLLAPSING artefact found: $(basename "$COL_54")" | tee -a "$REPORT" \
  || echo "  ❌ FAIL: No 54-host COLLAPSING artefact — run workflow.sh with ospf-database-3.txt" | tee -a "$REPORT"

# 0h. UNK in COLLAPSING config
if [ -n "$COL_54" ] && [ -f "$COL_54/COLLAPSING_country-collapse-config.json" ]; then
  if python3 -c "
import json, sys
cfg = json.load(open('$COL_54/COLLAPSING_country-collapse-config.json'))
unk = cfg['countries'].get('UNK', {})
print(f\"UNK: total={unk.get('total',0)} gw={unk.get('gateway_count',0)} core={unk.get('core_count',0)}\")
sys.exit(0 if unk.get('total',0) > 0 else 1)
" 2>/dev/null | tee -a "$REPORT"; then
    echo "  ✅ PASS: UNK present in COLLAPSING config with routers" | tee -a "$REPORT"
  else
    echo "  ⚠  WARN: UNK not found in COLLAPSING config — check ospf-database-3.txt" | tee -a "$REPORT"
  fi
fi

# 0i. IN-OUT for target graph_time
INOUT_DIR="$PROJECT_ROOT/IN-OUT-FOLDER/$GRAPH_TIME"
if [ -d "$INOUT_DIR" ] && [ -f "$INOUT_DIR/nodes.json" ]; then
  NODE_CNT=$(python3 -c "import json; print(len(json.load(open('$INOUT_DIR/nodes.json'))))" 2>/dev/null || echo "?")
  echo "  ✅ PASS: IN-OUT-FOLDER/$GRAPH_TIME exists ($NODE_CNT nodes)" | tee -a "$REPORT"
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
  echo "━━━ PHASE 1: JSON Artefact Integrity (54-router topology) ━━━" | tee -a "$REPORT"
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
    if cond: print(f"  ✅ PASS: {ok_msg}"); PASS += 1
    else:    print(f"  ❌ FAIL: {fail_msg}"); FAIL += 1
    return cond

# Dynamic expected values from graph_time + COLLAPSING config
m = re.search(r'_(\d+)_hosts', gt)
expected_hosts = int(m.group(1)) if m else None

col_cfg_path  = os.path.join(col, 'COLLAPSING_country-collapse-config.json')
col_topo_path = os.path.join(col, 'COLLAPSING_collapsed-topology.json')
col_cfg  = json.load(open(col_cfg_path))  if os.path.exists(col_cfg_path)  else None
col_topo = json.load(open(col_topo_path)) if os.path.exists(col_topo_path) else None

if col_cfg:
    s = col_cfg['summary']
    exp_countries, exp_routers, exp_gateways, exp_cores = \
        s['total_countries'], s['total_routers'], s['total_gateways'], s['total_cores']
    if expected_hosts is None: expected_hosts = exp_routers
else:
    exp_countries, exp_routers, exp_gateways, exp_cores = 11, 54, 32, 22
    if expected_hosts is None: expected_hosts = 54

print(f"  [detected] hosts={expected_hosts} gw={exp_gateways} countries={exp_countries} cores={exp_cores}")

# IN-OUT-FOLDER
print("  [1a] IN-OUT-FOLDER")
try:
    nodes = json.load(open(os.path.join(inout, 'nodes.json')))
    edges = json.load(open(os.path.join(inout, 'edges.json')))
    meta  = json.load(open(os.path.join(inout, 'meta.json')))
    chk(True, "IN-OUT files loaded", "N/A")
    chk(len(nodes) == expected_hosts, f"nodes: {len(nodes)} == {expected_hosts}", f"nodes: {len(nodes)} != {expected_hosts}")
    chk(len(edges) >= 100, f"edges: {len(edges)} >= 100", f"edges: {len(edges)} < 100")
    # Check CSV edges file too
    edges_csv = os.path.join(inout, 'edges.csv')
    chk(os.path.exists(edges_csv), "edges.csv present", "edges.csv missing")
except Exception as e:
    print(f"  ❌ FAIL: IN-OUT load error: {e}"); FAIL += 1

# AS-IS
print("  [1b] AS-IS")
try:
    an_file = os.path.join(asis, 'AS-IS_nodes.json')
    ae_file = os.path.join(asis, 'AS-IS_edges.json')
    if not os.path.exists(an_file):
        af = os.path.join(asis, 'AS-IS_original-topology-with-country.json')
        if not os.path.exists(af): af = os.path.join(asis, 'original-topology-with-country.json')
        d = json.load(open(af)); an, ae = d.get('nodes',[]), d.get('edges',[])
    else:
        an, ae = json.load(open(an_file)), json.load(open(ae_file))
    chk(len(an) == expected_hosts, f"AS-IS nodes: {len(an)} == {expected_hosts}", f"AS-IS nodes: {len(an)} != {expected_hosts}")
    chk(len(ae) >= 100, f"AS-IS edges: {len(ae)} >= 100", f"AS-IS edges: {len(ae)} < 100")
except Exception as e:
    print(f"  ❌ FAIL: AS-IS load error: {e}"); FAIL += 1

# GATEWAY
print("  [1c] GATEWAY")
try:
    gf = os.path.join(gw, 'GATEWAY_gateway-only-topology.json')
    if not os.path.exists(gf): gf = os.path.join(gw, 'gateway-only-topology.json')
    gw_data = json.load(open(gf))
    gn, ge = gw_data.get('nodes',[]), gw_data.get('edges',[])
    chk(len(gn) == exp_gateways, f"GATEWAY nodes: {len(gn)} == {exp_gateways}", f"GATEWAY nodes: {len(gn)} != {exp_gateways}")
    chk(len(ge) > 0, f"GATEWAY edges: {len(ge)}", "GATEWAY edges: 0")
    zaf_gw = [n for n in gn if n.get('country')=='ZAF']
    unk_gw = [n for n in gn if n.get('country')=='UNK']
    chk(len(zaf_gw) == 5, f"ZAF gateways: {len(zaf_gw)} == 5", f"ZAF gateways: {len(zaf_gw)} != 5")
    chk(len(unk_gw) >= 4, f"UNK gateways: {len(unk_gw)} >= 4 (hub routers)", f"UNK gateways: {len(unk_gw)} < 4")
except Exception as e:
    print(f"  ❌ FAIL: GATEWAY load error: {e}"); FAIL += 1

# ENRICHED
print("  [1d] ENRICHED")
try:
    cm = os.path.join(enrich, 'ENRICHED_country-mapping.csv')
    if not os.path.exists(cm): cm = os.path.join(enrich, 'country-mapping.csv')
    import csv
    with open(cm) as f: lines = [l.strip() for l in f if l.strip()]
    with open(cm, newline='') as f:
        rows = list(csv.DictReader(f))
    # country_code at index 2 (router_id,hostname,country_code,is_gateway)
    col_idx = 2
    if lines and 'router_id' in lines[0]:
        hdr = lines[0].split(',')
        for i, h in enumerate(hdr):
            if 'country' in h.lower(): col_idx = i; break
    countries = set(l.split(',')[col_idx].strip() for l in lines[1:] if len(l.split(',')) > col_idx)
    chk(len(countries) >= 11, f"ENRICHED countries: {len(countries)} >= 11 ({', '.join(sorted(countries))})", f"countries: {len(countries)} < 11")
    chk('UNK' in countries, "UNK present in ENRICHED country mapping", "UNK NOT in ENRICHED — push-to-ui.py may not classify unmapped")
    rows_by_id = {r.get('router_id','').strip(): r for r in rows}
    for rid, hostname, country in [
        ('12.12.12.2', 'ken-mob-r2', 'KEN'),
        ('13.13.13.1', 'drc-moa-r1', 'DRC'),
        ('18.18.18.4', 'zaf-mtz-r1', 'ZAF')
    ]:
        row = rows_by_id.get(rid, {})
        chk(row.get('hostname','').strip() == hostname and row.get('country_code','').strip().upper() == country,
            f"{rid}: hostname-derived country {country} from {hostname}",
            f"{rid}: expected hostname={hostname} country={country}, got {row}")
    ip_unk = rows_by_id.get('19.19.19.1', {})
    chk(ip_unk.get('country_code','').strip().upper() == 'UNK',
        "19.19.19.1 stays UNK when hostname is IP-like / absent",
        f"19.19.19.1 should be UNK, got {ip_unk}")
    chk(os.path.exists(os.path.join(enrich,'ENRICHED_original-topology-with-country.json'))
        or os.path.exists(os.path.join(enrich,'original-topology-with-country.json')),
        "ENRICHED topology JSON exists", "ENRICHED topology JSON missing")
except Exception as e:
    print(f"  ❌ FAIL: ENRICHED load error: {e}"); FAIL += 1

# COLLAPSING
print("  [1e] COLLAPSING")
try:
    if not col_cfg or not col_topo: raise FileNotFoundError("COLLAPSING files not found")
    s = col_cfg['summary']
    print(f"       {s['total_countries']} ctry | {s['total_routers']} rtr | {s['total_gateways']} gw | {s['total_cores']} core")
    chk(s['total_countries'] >= 11, f"{s['total_countries']} countries (>=11)", f"countries: {s['total_countries']} < 11")
    chk(s['total_routers'] == expected_hosts, f"{s['total_routers']} routers == {expected_hosts}", f"routers: {s['total_routers']} != {expected_hosts}")
    chk(s['total_gateways'] == exp_gateways, f"{s['total_gateways']} gateways == {exp_gateways}", f"gateways: {s['total_gateways']} != {exp_gateways}")
    chk(s['total_cores'] == exp_cores, f"{s['total_cores']} core nodes == {exp_cores}", f"cores: {s['total_cores']} != {exp_cores}")
    chk(len(col_topo['nodes']) == exp_gateways, f"collapsed topo: {len(col_topo['nodes'])} nodes == {exp_gateways}", f"topo: {len(col_topo['nodes'])} != {exp_gateways}")
    zaf = col_cfg['countries'].get('ZAF',{})
    zaf_c = zaf.get('core_count', len(zaf.get('core_ids', zaf.get('core_nodes',[]))))
    if isinstance(zaf_c, list): zaf_c = len(zaf_c)
    chk(zaf_c == 3, f"ZAF core nodes: {zaf_c} == 3", f"ZAF cores: {zaf_c} != 3")
    unk = col_cfg['countries'].get('UNK', {})
    unk_t = unk.get('total', 0)
    unk_g = unk.get('gateway_count', 0)
    unk_c = unk.get('core_count', 0)
    chk(unk_t == 20, f"UNK total: {unk_t} == 20", f"UNK total: {unk_t} != 20")
    chk(unk_g == 4,  f"UNK gateways: {unk_g} == 4 (hub routers)", f"UNK gateways: {unk_g} != 4")
    chk(unk_c == 16, f"UNK core: {unk_c} == 16 (leaf routers)", f"UNK core: {unk_c} != 16")
    print(f"       UNK: {unk_t} routers ({unk_g} gw hubs + {unk_c} core leaves) — cross-country OSPF adjacencies")
except Exception as e:
    print(f"  ❌ FAIL: COLLAPSING load error: {e}"); FAIL += 1

# CURRENT
print("  [1f] CURRENT")
try:
    cur_gw  = os.path.join(current, 'gateway-only-topology.json')
    cur_enr = os.path.join(current, 'country-core-summary.json')
    chk(os.path.exists(cur_gw),  "CURRENT gateway topology exists", "CURRENT gateway topology missing")
    chk(os.path.exists(cur_enr), "CURRENT country-core summary exists", "CURRENT country-core summary missing")
except Exception as e:
    print(f"  ❌ FAIL: CURRENT load error: {e}"); FAIL += 1

print(f"\n  PHASE 1 RESULT: {PASS} passed, {FAIL} failed")
if FAIL > 0: sys.exit(1)
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
  echo "━━━ PHASE 2: Fresh Pipeline Run ($(basename "$RESOLVED_OSPF_FILE")) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
  bash "$WORKFLOW" all \
    --ospf-file "$RESOLVED_OSPF_FILE" \
    --host-file "$RESOLVED_HOST_FILE" \
    --base-url  "$BASE_URL" \
    --user      "$API_USER" \
    --pass      "$API_PASS" 2>&1 | tee -a "$REPORT"
  GRAPH_TIME="$(resolve_graph_time)"
  echo "" | tee -a "$REPORT"
  echo "  ✅ PASS: Pipeline run complete — new graph_time: $GRAPH_TIME" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
  echo "━━━ PHASE 2 COMPLETE ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
else
  echo "━━━ PHASE 2: PIPELINE RUN SKIPPED (add --run-pipeline-db3 to trigger) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
fi

# ── PHASE 3: Playwright Full E2E ──────────────────────────────────────────────
echo "━━━ PHASE 3: Playwright E2E (12 phases, 90+ checks) ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

cd "$PROJECT_ROOT/tests"

GRAPH_TIMES="$GRAPH_TIME" \
HEADLESS="$HEADLESS" \
BASE_URL="$BASE_URL" \
API_USER="$API_USER" \
API_PASS="$API_PASS" \
  node validate-full-e2e-v2.cjs 2>&1 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "━━━ Screenshots: $SS_DIR/ ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# Grand summary
PASS_COUNT=$( { grep "✅ PASS" "$REPORT" || true; } | wc -l | tr -d ' ')
FAIL_COUNT=$( { grep "❌ FAIL" "$REPORT" || true; } | wc -l | tr -d ' ')
WARN_COUNT=$( { grep "⚠" "$REPORT" || true; } | wc -l | tr -d ' ')

echo "╔══════════════════════════════════════════════════════════════════════╗" | tee -a "$REPORT"
printf "║  TOTAL PASSED : %-55s║\n" "$PASS_COUNT" | tee -a "$REPORT"
printf "║  TOTAL FAILED : %-55s║\n" "$FAIL_COUNT" | tee -a "$REPORT"
printf "║  WARNINGS     : %-55s║\n" "$WARN_COUNT" | tee -a "$REPORT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "║  STATUS: ALL 06-STEP-BY-STEP CHECKS PASSED ✅                        ║" | tee -a "$REPORT"
else
  echo "║  STATUS: SOME CHECKS FAILED ❌ — review report above                ║" | tee -a "$REPORT"
fi
echo "╚══════════════════════════════════════════════════════════════════════╝" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
echo "  Full report : $REPORT" | tee -a "$REPORT"
echo "  Screenshots : $SS_DIR/" | tee -a "$REPORT"
echo "  Graph time  : $GRAPH_TIME" | tee -a "$REPORT"
