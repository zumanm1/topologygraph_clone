#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run-features-validation.sh
# ─────────────────────────────────────────────────────────────────────────────
# SCHOLAR'S NOTE
#   Master entry-point for end-to-end validation of the Multi-Mode Enhancement
#   Sprint features (HOT-F0, AS-F1/F3/F4, GW-F1/F2/F4, EN-F1/F4/F5,
#   CL-F1/F3/F4) implemented in topolograph-docker/init/topolograph.js and
#   terminal-script/push-to-ui.py.
#
#   Architecture mirrors 02-STEP-BY-STEP (Parnas layering principle):
#
#   PHASE 1 (Pipeline)  — re-run workflow.sh to produce a fresh graph with
#                         known data, then push country colours + dual labels
#                         via push-to-ui.py (HOT-F0 in action).
#   PHASE 2 (Playwright)— load that graph in a headless Chromium, exercise
#                         every new UI feature, take screenshots at each step.
#
#   INPUT  : INPUT-FOLDER/ospf-database-2.txt
#            INPUT-FOLDER/host-file-db2.txt
#            INPUT-FOLDER/collapse-preferences.json   (CL-F1 defaults)
#   OUTPUTS: OUTPUT/  (pipeline artefacts)
#            03-STEP-BY-STEP/screenshots/  (PNG per feature check)
#            03-STEP-BY-STEP/validation-report.txt
#
# USAGE
#   bash 03-STEP-BY-STEP/scripts/run-features-validation.sh
#   bash 03-STEP-BY-STEP/scripts/run-features-validation.sh --headless false
#   bash 03-STEP-BY-STEP/scripts/run-features-validation.sh --skip-pipeline
#   bash 03-STEP-BY-STEP/scripts/run-features-validation.sh --skip-pipeline --graph-time 04Mar2026_11h14m54s_34_hosts
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT="$PROJECT_ROOT/03-STEP-BY-STEP/validation-report.txt"
SS_DIR="$PROJECT_ROOT/03-STEP-BY-STEP/screenshots"
OSPF_FILE="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt"
HOST_FILE="$PROJECT_ROOT/INPUT-FOLDER/host-file-db2.txt"
PREFS_FILE="$PROJECT_ROOT/INPUT-FOLDER/collapse-preferences.json"
WORKFLOW="$PROJECT_ROOT/terminal-script/workflow.sh"
PLAYWRIGHT_SCRIPT="$PROJECT_ROOT/tests/validate-features-full.cjs"

HEADLESS="${HEADLESS:-true}"
SKIP_PIPELINE=false
GRAPH_TIME="${GRAPH_TIME:-}"

# Parse args
for arg in "$@"; do
  case "$arg" in
    --skip-pipeline)            SKIP_PIPELINE=true ;;
    --headless)                 HEADLESS=true ;;
    --headless=false|--visible) HEADLESS=false ;;
    --graph-time=*)             GRAPH_TIME="${arg#--graph-time=}" ;;
    --graph-time)               ;;   # handled by next iteration (simplified)
  esac
done

# ── Header ────────────────────────────────────────────────────────────────────
mkdir -p "$SS_DIR"
{
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   MULTI-MODE FEATURES — END-TO-END VALIDATION REPORT            ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║   Date      : $(date '+%Y-%m-%d %H:%M:%S')                                 ║"
echo "║   Sprint    : HOT-F0, AS-F1/3/4, GW-F1/2/4, EN-F1/4/5, CL-F1/3/4  ║"
echo "║   Input     : INPUT-FOLDER/ospf-database-2.txt                  ║"
echo "║   Project   : $PROJECT_ROOT"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
} | tee "$REPORT"

# ── PHASE 1: Pipeline ─────────────────────────────────────────────────────────
if [ "$SKIP_PIPELINE" = "false" ]; then
  echo "━━━ PHASE 1: Pipeline (AS-IS → GATEWAY → ENRICHED → COLLAPSING) ━━━" | tee -a "$REPORT"
  echo "" | tee -a "$REPORT"

  for req_file in "$OSPF_FILE" "$HOST_FILE"; do
    if [ ! -f "$req_file" ]; then
      echo "[ERROR] Required file not found: $req_file" | tee -a "$REPORT"
      exit 1
    fi
  done

  # Run full pipeline
  PIPELINE_OUTPUT=$(bash "$WORKFLOW" all \
    --ospf-file "$OSPF_FILE" \
    --host-file "$HOST_FILE" \
    2>&1)

  echo "$PIPELINE_OUTPUT" | tee -a "$REPORT"

  # Extract graph_time
  GRAPH_TIME=$(echo "$PIPELINE_OUTPUT" | grep "graph_time confirmed:" | tail -1 | awk '{print $NF}')
  if [ -z "$GRAPH_TIME" ]; then
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

  # Artefact verification
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

  # CL-F1 pipeline: check collapse-preferences.json was honoured
  echo "── CL-F1 pipeline: collapse-preferences verification ──" | tee -a "$REPORT"
  if [ -f "$PREFS_FILE" ]; then
    GT_VAL="$GRAPH_TIME" PROJECT_VAL="$PROJECT_ROOT" python3 << 'PYEOF' | tee -a "$REPORT"
import json, os, sys
gt   = os.environ['GT_VAL']
base = os.environ['PROJECT_VAL'] + "/OUTPUT/COLLAPSING/" + gt + "_COLLAPSING"
prefs_path = os.environ['PROJECT_VAL'] + "/INPUT-FOLDER/collapse-preferences.json"

try:
    cfg = json.load(open(f"{base}/COLLAPSING_country-collapse-config.json"))
    prefs = json.load(open(prefs_path))
    expected_collapsed = [c.upper() for c in prefs.get('collapse_by_default', [])]
    ok = True
    for code in expected_collapsed:
        cc = cfg.get('countries', {}).get(code, {})
        if cc.get('default_collapsed') is True:
            print(f"  ✅ CL-F1: {code} has default_collapsed=true in collapse-config.json")
        else:
            print(f"  ❌ CL-F1: {code} does NOT have default_collapsed=true"); ok=False
    if not expected_collapsed:
        print("  ℹ  collapse-preferences.json collapse_by_default is empty — nothing to check")
    if not ok:
        sys.exit(1)
except Exception as e:
    print(f"  ❌ CL-F1 pipeline check failed: {e}"); sys.exit(1)
PYEOF
  else
    echo "  ⚠  collapse-preferences.json not found at $PREFS_FILE — CL-F1 pipeline check skipped" | tee -a "$REPORT"
  fi
  echo "" | tee -a "$REPORT"

else
  if [ -z "$GRAPH_TIME" ]; then
    GRAPH_TIME="04Mar2026_11h14m54s_34_hosts"
    echo "━━━ PHASE 1: SKIPPED — using default graph_time=$GRAPH_TIME ━━━" | tee -a "$REPORT"
  else
    echo "━━━ PHASE 1: SKIPPED — using provided graph_time=$GRAPH_TIME ━━━" | tee -a "$REPORT"
  fi
  echo "" | tee -a "$REPORT"
fi

# ── PHASE 2: Playwright ───────────────────────────────────────────────────────
echo "━━━ PHASE 2: Playwright Feature Validation (F0–F20) ━━━" | tee -a "$REPORT"
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
  node validate-features-full.cjs 2>&1 | tee -a "$REPORT"

echo "" | tee -a "$REPORT"
echo "━━━ Screenshots saved to: $SS_DIR/ ━━━" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"

# ── Final summary ──────────────────────────────────────────────────────────────
PASS_COUNT=$( { grep "✅ PASS" "$REPORT" 2>/dev/null || true; } | wc -l | tr -d ' ')
FAIL_COUNT=$( { grep "❌ FAIL" "$REPORT" 2>/dev/null || true; } | wc -l | tr -d ' ')

echo "╔══════════════════════════════════════════════════════════════════╗" | tee -a "$REPORT"
printf "║  TOTAL: %-3s PASSED  |  %-3s FAILED%-33s║\n" "$PASS_COUNT" "$FAIL_COUNT" "" | tee -a "$REPORT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "║  STATUS: ALL FEATURE CHECKS PASSED ✅                           ║" | tee -a "$REPORT"
else
  echo "║  STATUS: SOME CHECKS FAILED ❌ — review validation-report.txt   ║" | tee -a "$REPORT"
fi
echo "╚══════════════════════════════════════════════════════════════════╝" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
echo "  Full report: $REPORT" | tee -a "$REPORT"
echo "  Screenshots: $SS_DIR/" | tee -a "$REPORT"
