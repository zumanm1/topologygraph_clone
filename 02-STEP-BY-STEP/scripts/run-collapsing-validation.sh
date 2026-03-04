#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-collapsing-validation.sh
# ─────────────────────────────────────────────────────────────────────────────
# SCHOLAR'S NOTE
#   This is the master entry point for end-to-end validation of the COLLAPSING
#   feature.  It follows a two-phase approach:
#
#   PHASE 1 (Pipeline) — server-side artefacts
#     Upload ospf-database-2.txt via workflow.sh (AS-IS → GATEWAY → ENRICHED
#     → COLLAPSING), push country colours to the Topolograph UI, emit a
#     known graph_time for Phase 2.
#
#   PHASE 2 (Playwright) — browser-side UI/UX
#     Load the exact graph_time from Phase 1 into a headless Chromium browser,
#     verify all 15 behavioural contracts (B1–B15) of the COLLAPSING feature.
#
#   INPUT  : INPUT-FOLDER/ospf-database-2.txt
#   OUTPUTS: OUTPUT/AS-IS, OUTPUT/GATEWAY, OUTPUT/ENRICHED, OUTPUT/COLLAPSING
#            02-STEP-BY-STEP/screenshots/  (PNG per step)
#            02-STEP-BY-STEP/validation-report.txt
#
# USAGE
#   bash 02-STEP-BY-STEP/scripts/run-collapsing-validation.sh
#   bash 02-STEP-BY-STEP/scripts/run-collapsing-validation.sh --headless false
#   bash 02-STEP-BY-STEP/scripts/run-collapsing-validation.sh --skip-pipeline
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT="$PROJECT_ROOT/02-STEP-BY-STEP/validation-report.txt"
SS_DIR="$PROJECT_ROOT/02-STEP-BY-STEP/screenshots"
OSPF_FILE="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt"
HOST_FILE="$PROJECT_ROOT/INPUT-FOLDER/host-file-db2.txt"
WORKFLOW="$PROJECT_ROOT/terminal-script/workflow.sh"
PLAYWRIGHT_SCRIPT="$PROJECT_ROOT/tests/validate-collapsing-full.cjs"

HEADLESS="${HEADLESS:-true}"
SKIP_PIPELINE=false

# Parse args
for arg in "$@"; do
  case "$arg" in
    --skip-pipeline) SKIP_PIPELINE=true ;;
    --headless) HEADLESS=true ;;
    --headless=false|--visible) HEADLESS=false ;;
  esac
done

# ── Header ────────────────────────────────────────────────────────────────────
mkdir -p "$SS_DIR"
{
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   COLLAPSING FEATURE — END-TO-END VALIDATION REPORT             ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║   Date    : $(date '+%Y-%m-%d %H:%M:%S')                                   ║"
echo "║   Input   : INPUT-FOLDER/ospf-database-2.txt                    ║"
echo "║   Project : $PROJECT_ROOT"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
} | tee "$REPORT"

# ── PHASE 1: Pipeline ─────────────────────────────────────────────────────────
if [ "$SKIP_PIPELINE" = "false" ]; then
  echo "━━━ PHASE 1: Pipeline (AS-IS → GATEWAY → ENRICHED → COLLAPSING) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"

  if [ ! -f "$OSPF_FILE" ]; then
    echo "[ERROR] OSPF file not found: $OSPF_FILE" | tee -a "$REPORT"
    exit 1
  fi

  # Run full pipeline
  PIPELINE_OUTPUT=$(bash "$WORKFLOW" all \
    --ospf-file "$OSPF_FILE" \
    --host-file "$HOST_FILE" \
    2>&1)

  echo "$PIPELINE_OUTPUT" | tee -a "$REPORT"

  # Extract graph_time from pipeline output
  GRAPH_TIME=$(echo "$PIPELINE_OUTPUT" | grep "graph_time confirmed:" | tail -1 | awk '{print $NF}')

  if [ -z "$GRAPH_TIME" ]; then
    # Fallback: try from the COLLAPSING output line
    GRAPH_TIME=$(echo "$PIPELINE_OUTPUT" | grep "COLLAPSING output:" | tail -1 | awk -F'/' '{print $(NF-1)}' | sed 's/_COLLAPSING//')
  fi

  if [ -z "$GRAPH_TIME" ]; then
    echo "[ERROR] Could not extract graph_time from pipeline output" | tee -a "$REPORT"
    exit 1
  fi

  echo "" | tee -a "$REPORT"
  echo "━━━ PHASE 1 COMPLETE ━━━" | tee -a "$REPORT"
  echo "  graph_time : $GRAPH_TIME" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"

  # Validate pipeline output files exist
  echo "── Pipeline artefact verification ──" | tee -a "$REPORT"
  for STAGE in AS-IS GATEWAY ENRICHED COLLAPSING; do
    DIR="$PROJECT_ROOT/OUTPUT/$STAGE/${GRAPH_TIME}_${STAGE}"
    if [ -d "$DIR" ] && [ "$(ls -A "$DIR" 2>/dev/null)" ]; then
      echo "  ✅ OUTPUT/$STAGE/${GRAPH_TIME}_${STAGE}/ — $(ls "$DIR" | wc -l | tr -d ' ') files" | tee -a "$REPORT"
    else
      echo "  ❌ OUTPUT/$STAGE/${GRAPH_TIME}_${STAGE}/ — MISSING or empty" | tee -a "$REPORT"
    fi
  done
  echo "" | tee -a "$REPORT"

  # COLLAPSING JSON integrity check
  echo "── COLLAPSING JSON integrity ──" | tee -a "$REPORT"
  GT_VAL="$GRAPH_TIME" PROJECT_VAL="$PROJECT_ROOT" python3 << 'PYEOF' | tee -a "$REPORT"
import json, sys, os
gt   = os.environ['GT_VAL']
base = os.environ['PROJECT_VAL'] + "/OUTPUT/COLLAPSING/" + gt + "_COLLAPSING"

try:
    cfg  = json.load(open(f"{base}/COLLAPSING_country-collapse-config.json"))
    topo = json.load(open(f"{base}/COLLAPSING_collapsed-topology.json"))
    s = cfg['summary']
    print(f"  config  : {s['total_countries']} countries | {s['total_routers']} routers | {s['total_gateways']} gateways | {s['total_cores']} cores")
    print(f"  topology: {len(topo['nodes'])} gateway nodes | {len(topo['edges'])} gateway edges")

    # Assertions
    ok = True
    if s['total_routers'] != 34:
        print(f"  ❌ Expected 34 routers, got {s['total_routers']}"); ok=False
    else:
        print(f"  ✅ 34 routers confirmed")
    if s['total_countries'] != 10:
        print(f"  ❌ Expected 10 countries, got {s['total_countries']}"); ok=False
    else:
        print(f"  ✅ 10 countries confirmed")
    if s['total_gateways'] != 28:
        print(f"  ❌ Expected 28 gateways, got {s['total_gateways']}"); ok=False
    else:
        print(f"  ✅ 28 gateways confirmed")
    if s['total_cores'] != 6:
        print(f"  ❌ Expected 6 core nodes, got {s['total_cores']}"); ok=False
    else:
        print(f"  ✅ 6 core nodes confirmed (ZAF:3, GBR:1, FRA:1, POR:1)")
    missing_country = [n for n in topo['nodes'] if not n.get('country')]
    if missing_country:
        print(f"  ❌ {len(missing_country)} gateway nodes missing country"); ok=False
    else:
        print(f"  ✅ All 28 gateway nodes have country codes")
    if not ok:
        sys.exit(1)
except Exception as e:
    print(f"  ❌ COLLAPSING JSON check failed: {e}"); sys.exit(1)
PYEOF

  echo "" | tee -a "$REPORT"
else
  # Use provided or default graph_time
  GRAPH_TIME="${GRAPH_TIME:-04Mar2026_11h14m54s_34_hosts}"
  echo "━━━ PHASE 1: SKIPPED — using graph_time=$GRAPH_TIME ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"
fi

# ── PHASE 2: Playwright UI Validation ────────────────────────────────────────
echo "━━━ PHASE 2: Playwright UI/UX Validation (B1–B15) ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

if [ ! -f "$PLAYWRIGHT_SCRIPT" ]; then
  echo "[ERROR] Playwright script not found: $PLAYWRIGHT_SCRIPT" | tee -a "$REPORT"
  exit 1
fi

cd "$PROJECT_ROOT/tests"

GRAPH_TIME="$GRAPH_TIME" \
  HEADLESS="$HEADLESS" \
  SCREENSHOTS=true \
  API_USER="ospf@topolograph.com" \
  API_PASS="ospf" \
  BASE_URL="http://localhost:8081" \
  node validate-collapsing-full.cjs 2>&1 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "━━━ Screenshots saved to: $SS_DIR/ ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── Final summary ──────────────────────────────────────────────────────────
PASS_COUNT=$(grep -c "✅ PASS" "$REPORT" 2>/dev/null || echo 0)
FAIL_COUNT=$(grep -c "❌ FAIL" "$REPORT" 2>/dev/null || echo 0)

echo "╔══════════════════════════════════════════════════════════════════╗" | tee -a "$REPORT"
printf "║  TOTAL: %-3s PASSED  |  %-3s FAILED%-33s║\n" "$PASS_COUNT" "$FAIL_COUNT" "" | tee -a "$REPORT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "║  STATUS: ALL COLLAPSING CHECKS PASSED ✅                        ║" | tee -a "$REPORT"
else
  echo "║  STATUS: SOME CHECKS FAILED ❌ — review report above            ║" | tee -a "$REPORT"
fi
echo "╚══════════════════════════════════════════════════════════════════╝" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
echo "  Full report saved to: $REPORT" | tee -a "$REPORT"
