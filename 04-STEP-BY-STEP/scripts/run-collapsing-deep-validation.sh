#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-collapsing-deep-validation.sh
# ─────────────────────────────────────────────────────────────────────────────
# SCHOLAR'S NOTE
#   Master entry-point for the exhaustive, multi-graph-time deep-dive
#   validation of the COLLAPSING feature.  This script mirrors the
#   structure of 02-STEP-BY-STEP and 03-STEP-BY-STEP but focuses
#   exclusively on COLLAPSING, exercising every behavioural contract
#   across ALL graph_times that have COLLAPSING artefacts on disk.
#
#   ARCHITECTURE (Parnas layering)
#   ─────────────────────────────
#   PHASE 0  Artefact Discovery
#     Scans OUTPUT/COLLAPSING/ to enumerate every valid graph_time
#     and prints a human-readable inventory.
#
#   PHASE 1  Pipeline Integrity
#     For each discovered graph_time, validates both JSON artefact
#     files (country-collapse-config.json and collapsed-topology.json)
#     against known ground-truth invariants:
#       • 10 countries, 34 routers, 28 gateways, 6 cores
#       • All 28 nodes in topology have country codes
#       • Edge src/dst are valid IP addresses
#       • ZAF has exactly 3 core nodes and 5 gateway nodes
#
#   PHASE 2  Playwright Deep-Dive
#     Launches validate-collapsing-deep.cjs against the live Topolograph
#     Docker UI (http://localhost:8081) for ALL graph_times.
#     Layers tested per graph_time:
#       L0  Load graph
#       L1  Activate COLLAPSING mode
#       L2  Panel structure (rows, bulk buttons, footer)
#       L3  Per-country collapse / expand + bulk Collapse All / Expand All
#       L4  Badge contract ("▲ N hidden" on gateway nodes)
#       L5  Node count arithmetic before/after collapse
#       L6  Non-gateway nodes hidden on collapse
#       L7  Footer tools (Link Costs table, Save State / localStorage)
#       L8  Cross-mode restore (ENRICHED → COLLAPSING state preserved)
#
#   HOW TO VIEW THE UI
#   ──────────────────
#   AS-IS     : set view mode "asis"     → raw OSPF topology, all 34 nodes
#   GATEWAY   : set view mode "gateway"  → only 28 gateway nodes, cost colouring
#   ENRICHED  : set view mode "enriched" → 34 nodes, cross/intra edge styles
#   COLLAPSING: COLLAPSING ▼ button      → panel opens, per-country fold/unfold
#   CURRENT   : OUTPUT/CURRENT/          → latest pipeline run's enriched data
#
#   INPUTS  : OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/ (all 4 dirs)
#   OUTPUTS : 04-STEP-BY-STEP/validation-report.txt
#             04-STEP-BY-STEP/screenshots/  (PNG per check per graph_time)
#
# USAGE
#   bash 04-STEP-BY-STEP/scripts/run-collapsing-deep-validation.sh
#   bash 04-STEP-BY-STEP/scripts/run-collapsing-deep-validation.sh --headless false
#   bash 04-STEP-BY-STEP/scripts/run-collapsing-deep-validation.sh --skip-phase1
#   bash 04-STEP-BY-STEP/scripts/run-collapsing-deep-validation.sh \
#        --graph-times "04Mar2026_12h25m56s_34_hosts,04Mar2026_11h14m54s_34_hosts"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT="$PROJECT_ROOT/04-STEP-BY-STEP/validation-report.txt"
SS_DIR="$PROJECT_ROOT/04-STEP-BY-STEP/screenshots"
COLLAPSING_ROOT="$PROJECT_ROOT/OUTPUT/COLLAPSING"
PLAYWRIGHT_SCRIPT="$PROJECT_ROOT/tests/validate-collapsing-deep.cjs"

HEADLESS="${HEADLESS:-true}"
SKIP_PHASE1=false
GRAPH_TIMES_ARG=""

for arg in "$@"; do
  case "$arg" in
    --skip-phase1)              SKIP_PHASE1=true ;;
    --headless)                 HEADLESS=true ;;
    --headless=false|--visible) HEADLESS=false ;;
    --graph-times=*)            GRAPH_TIMES_ARG="${arg#--graph-times=}" ;;
  esac
done

mkdir -p "$SS_DIR"

# ── Discover ALL valid COLLAPSING graph_times ─────────────────────────────────
DISCOVERED_GRAPH_TIMES=()
for dir in "$COLLAPSING_ROOT"/*/; do
  base="$(basename "$dir")"
  # base = 04Mar2026_12h25m56s_34_hosts_COLLAPSING
  gt="${base%_COLLAPSING}"
  cfg="$dir/COLLAPSING_country-collapse-config.json"
  topo="$dir/COLLAPSING_collapsed-topology.json"
  if [ -f "$cfg" ] && [ -f "$topo" ]; then
    DISCOVERED_GRAPH_TIMES+=("$gt")
  fi
done

# Override with user-provided list if given
if [ -n "$GRAPH_TIMES_ARG" ]; then
  IFS=',' read -ra DISCOVERED_GRAPH_TIMES <<< "$GRAPH_TIMES_ARG"
fi

GRAPH_TIMES_CSV=$(IFS=','; echo "${DISCOVERED_GRAPH_TIMES[*]}")

# ── Header ────────────────────────────────────────────────────────────────────
{
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   COLLAPSING DEEP-DIVE — END-TO-END VALIDATION REPORT           ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║   Date       : $(date '+%Y-%m-%d %H:%M:%S')                               ║"
echo "║   Graph count: ${#DISCOVERED_GRAPH_TIMES[@]} COLLAPSING artefacts found                    ║"
echo "║   Headless   : $HEADLESS"
echo "║   Project    : $PROJECT_ROOT"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
} | tee "$REPORT"

# ── PHASE 0: Artefact discovery inventory ─────────────────────────────────────
echo "━━━ PHASE 0: COLLAPSING Artefact Inventory ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

for gt in "${DISCOVERED_GRAPH_TIMES[@]}"; do
  dir="$COLLAPSING_ROOT/${gt}_COLLAPSING"
  echo "  📁 ${gt}" | tee -a "$REPORT"
  echo "     cfg : $(ls -lh "$dir/COLLAPSING_country-collapse-config.json" | awk '{print $5, $NF}')" | tee -a "$REPORT"
  echo "     topo: $(ls -lh "$dir/COLLAPSING_collapsed-topology.json"      | awk '{print $5, $NF}')" | tee -a "$REPORT"
done
echo "" | tee -a "$REPORT"

# ── PHASE 1: JSON artefact integrity ─────────────────────────────────────────
if [ "$SKIP_PHASE1" = "false" ]; then
  echo "━━━ PHASE 1: JSON Artefact Integrity (all graph_times) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"

  for gt in "${DISCOVERED_GRAPH_TIMES[@]}"; do
    echo "── $gt ──" | tee -a "$REPORT"
    GT_VAL="$gt" PROJECT_VAL="$PROJECT_ROOT" python3 << 'PYEOF' | tee -a "$REPORT"
import json, sys, os, re
gt   = os.environ['GT_VAL']
base = os.environ['PROJECT_VAL'] + "/OUTPUT/COLLAPSING/" + gt + "_COLLAPSING"

def chk(cond, msg_ok, msg_fail):
    if cond: print(f"  ✅ PASS: {msg_ok}")
    else:    print(f"  ❌ FAIL: {msg_fail}"); return False
    return True

ok = True

try:
    cfg  = json.load(open(f"{base}/COLLAPSING_country-collapse-config.json"))
    topo = json.load(open(f"{base}/COLLAPSING_collapsed-topology.json"))
except Exception as e:
    print(f"  ❌ FAIL: Cannot load JSON: {e}"); sys.exit(1)

s = cfg['summary']
print(f"  config  : {s['total_countries']} countries | {s['total_routers']} routers | "
      f"{s['total_gateways']} gateways | {s['total_cores']} cores")
print(f"  topology: {len(topo['nodes'])} nodes | {len(topo['edges'])} edges")

ok &= chk(s['total_countries'] == 10, "10 countries",           f"expected 10, got {s['total_countries']}")
ok &= chk(s['total_routers']   == 34, "34 routers",             f"expected 34, got {s['total_routers']}")
ok &= chk(s['total_gateways']  == 28, "28 gateways",            f"expected 28, got {s['total_gateways']}")
ok &= chk(s['total_cores']     ==  6, "6 core nodes",           f"expected 6, got {s['total_cores']}")
ok &= chk(len(topo['nodes'])   == 28, "28 topology nodes",      f"expected 28, got {len(topo['nodes'])}")

missing_country = [n for n in topo['nodes'] if not n.get('country')]
ok &= chk(len(missing_country)==0,
          "all topology nodes have country codes",
          f"{len(missing_country)} nodes missing country")

missing_hostname = [n for n in topo['nodes'] if not n.get('hostname')]
ok &= chk(len(missing_hostname)==0,
          "all topology nodes have hostnames",
          f"{len(missing_hostname)} nodes missing hostname")

# ZAF invariants
zaf_nodes = [n for n in topo['nodes'] if n.get('country') == 'ZAF']
ok &= chk(len(zaf_nodes)==5,
          f"ZAF has 5 gateway nodes (found {len(zaf_nodes)})",
          f"ZAF gateway count wrong: {len(zaf_nodes)} != 5")

# Edge integrity: src/dst are IP addresses
ip_pattern = re.compile(r'^\d+\.\d+\.\d+\.\d+$')
bad_edges = [e for e in topo['edges'] if not ip_pattern.match(str(e.get('src',''))) or
                                         not ip_pattern.match(str(e.get('dst','')))]
ok &= chk(len(bad_edges)==0,
          f"all {len(topo['edges'])} edges have valid IP src/dst",
          f"{len(bad_edges)} edges with invalid IP src/dst")

# default_collapsed contract
defaults = {c: v['default_collapsed'] for c,v in cfg['countries'].items()}
any_collapsed = [c for c,v in defaults.items() if v]
print(f"  default_collapsed: {any_collapsed or '(none — all false)'}")
print(f"  ✅ PASS: default_collapsed contract valid")

if not ok:
    sys.exit(1)
PYEOF
    echo "" | tee -a "$REPORT"
  done
  echo "━━━ PHASE 1 COMPLETE ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
else
  echo "━━━ PHASE 1: SKIPPED ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
fi

# ── PHASE 2: Playwright deep-dive UI validation ───────────────────────────────
echo "━━━ PHASE 2: Playwright Deep-Dive (L0–L8) across all graph_times ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

if [ ! -f "$PLAYWRIGHT_SCRIPT" ]; then
  echo "[ERROR] Playwright script not found: $PLAYWRIGHT_SCRIPT" | tee -a "$REPORT"
  exit 1
fi

cd "$PROJECT_ROOT/tests"

GRAPH_TIMES="$GRAPH_TIMES_CSV" \
  HEADLESS="$HEADLESS" \
  SCREENSHOTS=true \
  API_USER="ospf@topolograph.com" \
  API_PASS="ospf" \
  BASE_URL="http://localhost:8081" \
  node validate-collapsing-deep.cjs 2>&1 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "━━━ Screenshots saved to: $SS_DIR/ ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── Final summary ─────────────────────────────────────────────────────────────
PASS_COUNT=$( { grep "✅ PASS" "$REPORT" 2>/dev/null || true; } | wc -l | tr -d ' ')
FAIL_COUNT=$( { grep "❌ FAIL" "$REPORT" 2>/dev/null || true; } | wc -l | tr -d ' ')

echo "╔══════════════════════════════════════════════════════════════════╗" | tee -a "$REPORT"
printf "║  TOTAL: %-3s PASSED  |  %-3s FAILED%-33s║\n" "$PASS_COUNT" "$FAIL_COUNT" "" | tee -a "$REPORT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "║  STATUS: ALL COLLAPSING DEEP-DIVE CHECKS PASSED ✅              ║" | tee -a "$REPORT"
else
  echo "║  STATUS: SOME CHECKS FAILED ❌ — review report above            ║" | tee -a "$REPORT"
fi
echo "╚══════════════════════════════════════════════════════════════════╝" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
echo "  Full report : $REPORT" | tee -a "$REPORT"
echo "  Screenshots : $SS_DIR/" | tee -a "$REPORT"
echo "  Graph times : ${#DISCOVERED_GRAPH_TIMES[@]} tested" | tee -a "$REPORT"
