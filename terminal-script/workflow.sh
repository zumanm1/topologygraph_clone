#!/usr/bin/env bash
# ==============================================================================
# workflow.sh  –  Master orchestrator for the OSPF Country Topology Pipeline
# ==============================================================================
#
# FLOW:
#   1. (Optional) Upload a new OSPF LSDB file → Topolograph web app
#   2. Fetch the raw (unmodified) graph → IN-OUT-FOLDER/{graph_time}/
#   3. Run the terminal topology pipeline → 3 structured output folders:
#         OUTPUT/AS-IS/{graph_time}_AS-IS/       ← original graph, nothing changed
#         OUTPUT/GATEWAY/{graph_time}_GATEWAY/   ← gateway-only, countries collapsed
#         OUTPUT/ENRICHED/{graph_time}_ENRICHED/ ← original + country / colour enrichment
#   4. Push country colours + metadata back to the Topolograph UI
#
# Usage:
#   ./workflow.sh all [options]
#   ./workflow.sh enrich-existing --graph-time <value> [options]
#   ./workflow.sh help
#
# Options:
#   --ospf-file  <path>    OSPF database text file to upload (triggers upload step)
#   --host-file  <path>    Host mapping file (txt or csv).
#                          Default: INPUT-FOLDER/Load-hosts.txt  (falls back to host-file.txt)
#   --graph-time <value>   Use an existing graph (skip upload). Auto-detect if omitted.
#   --base-url   <url>     Topolograph URL.  Default: http://localhost:8081
#   --user       <name>    API username.     Default: ospf@topolograph.com
#   --pass       <pw>      API password.     Default: ospf
#   --countries  <list>    Comma-separated country codes for filtered outputs (ZAF,DRC,…)
#   --no-push             Skip the UI push step (colour patching)
#   --dry-run             Perform a dry-run of the UI push (no actual PATCH calls)
#
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:8081}"
AUTH_USER="${AUTH_USER:-ospf@topolograph.com}"
AUTH_PASS="${AUTH_PASS:-ospf}"
resolve_default_ospf_file() {
  local candidates=(
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-54-unk-test.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/ospf-database.txt"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf '%s\n' ""
}

resolve_default_host_file() {
  local candidates=(
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt"
    "$PROJECT_ROOT/INPUT-FOLDER/host-file.txt"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf '%s\n' "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"
}

if [[ -z "${OSPF_FILE:-}" ]]; then
  OSPF_FILE="$(resolve_default_ospf_file)"
fi
if [[ -z "${HOST_FILE:-}" ]]; then
  HOST_FILE="$(resolve_default_host_file)"
fi
GRAPH_TIME="${GRAPH_TIME:-}"
COUNTRIES_FILTER="${COUNTRIES_FILTER:-}"
NO_PUSH="${NO_PUSH:-false}"
DRY_RUN="${DRY_RUN:-false}"
CMD="${1:-help}"

INOUT_DIR="$PROJECT_ROOT/IN-OUT-FOLDER"
OUTPUT_ASIS="$PROJECT_ROOT/OUTPUT/AS-IS"
OUTPUT_GATEWAY="$PROJECT_ROOT/OUTPUT/GATEWAY"
OUTPUT_ENRICHED="$PROJECT_ROOT/OUTPUT/ENRICHED"
OUTPUT_COLLAPSING="$PROJECT_ROOT/OUTPUT/COLLAPSING"

log()  { echo "[workflow] $*"; }
step() { echo; echo "══════════════════════════════════════════════════════════"; echo "[workflow] STEP: $*"; echo "══════════════════════════════════════════════════════════"; }

# ── Arg parsing ───────────────────────────────────────────────────────────────
parse_args() {
  shift || true  # remove CMD
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ospf-file)   OSPF_FILE="$2";        shift 2 ;;
      --host-file)   HOST_FILE="$2";        shift 2 ;;
      --graph-time)  GRAPH_TIME="$2";       shift 2 ;;
      --base-url)    BASE_URL="$2";         shift 2 ;;
      --user)        AUTH_USER="$2";        shift 2 ;;
      --pass)        AUTH_PASS="$2";        shift 2 ;;
      --countries)   COUNTRIES_FILTER="$2"; shift 2 ;;
      --no-push)     NO_PUSH="true";        shift 1 ;;
      --dry-run)     DRY_RUN="true";        shift 1 ;;
      *) echo "Unknown arg: $1"; usage; exit 1 ;;
    esac
  done
}

usage() {
  cat <<'EOF'
Usage:
  ./workflow.sh all              [options]   # full pipeline (upload if --ospf-file)
  ./workflow.sh enrich-existing  [options]   # enrich graph already in Topolograph
  ./workflow.sh help

Options:
  --ospf-file  <path>   OSPF LSDB file to upload (triggers upload step)
  --host-file  <path>   Host mapping file (default: INPUT-FOLDER/host-file.txt)
  --graph-time <value>  Use existing graph instead of latest
  --base-url   <url>    Topolograph URL (default: http://localhost:8081)
  --user / --pass       API credentials
  --countries  <list>   Comma-separated filter (e.g. ZAF,DRC,GBR)
  --no-push             Skip colour-push to Topolograph UI
  --dry-run             Dry-run the UI push step

Output folders:
  OUTPUT/AS-IS/{graph_time}_AS-IS/           — original graph, zero modification
  OUTPUT/GATEWAY/{graph_time}_GATEWAY/       — gateway-only topology, countries collapsed
  OUTPUT/ENRICHED/{graph_time}_ENRICHED/     — all routers + country label + colour metadata
  OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/ — gateway/core split + collapsed topology JSON
EOF
}

# ── Step 1: Upload OSPF file (optional) ───────────────────────────────────────
step_upload_ospf() {
  [[ -n "$OSPF_FILE" ]] || { log "No --ospf-file provided; skipping upload."; return; }
  [[ -f "$OSPF_FILE" ]] || { echo "ERROR: OSPF file not found: $OSPF_FILE"; exit 1; }

  step "Upload OSPF database → Topolograph"
  log "File: $OSPF_FILE"

  GRAPH_TIME=$(python3 - <<PYEOF
import json, re, sys
import requests

base = "${BASE_URL}"
auth = ("${AUTH_USER}", "${AUTH_PASS}")
ospf_path = "${OSPF_FILE}"

# Ensure credentials exist
requests.post(f"{base}/create-default-credentials", auth=auth, timeout=10)

s = requests.Session()
r = s.get(f"{base}/login", timeout=15)
r.raise_for_status()
csrf = re.search(r'name="csrf_token"[^>]*value="([^"]+)"', r.text)
payload = {"login": auth[0], "password": auth[1]}
if csrf:
    payload["csrf_token"] = csrf.group(1)

r = s.post(f"{base}/login", data=payload, timeout=15, allow_redirects=True)
r.raise_for_status()

with open(ospf_path) as f:
    lsdb_text = f.read()

r = s.post(f"{base}/api/graphs",
    json=[{"lsdb_output": lsdb_text, "vendor_device": "Cisco", "igp_protocol": "ospf"}],
    timeout=120)
r.raise_for_status()
data = r.json()
gt = data.get("graph_time", "")
print(gt)
PYEOF
)
  log "Uploaded. graph_time=$GRAPH_TIME"
}

# ── Step 2: Fetch raw graph → IN-OUT-FOLDER ───────────────────────────────────
step_fetch_raw() {
  step "Fetch raw graph → IN-OUT-FOLDER"
  GRAPH_TIME=$(bash "$SCRIPT_DIR/fetch-from-api.sh" \
    --base-url  "$BASE_URL" \
    --user      "$AUTH_USER" \
    --pass      "$AUTH_PASS" \
    ${GRAPH_TIME:+--graph-time "$GRAPH_TIME"} \
    --output-dir "$INOUT_DIR")
  log "graph_time confirmed: $GRAPH_TIME"
}

# ── Step 3: Run terminal topology pipeline ─────────────────────────────────────
step_terminal_pipeline() {
  step "Run terminal topology pipeline"

  local inout_gt="$INOUT_DIR/$GRAPH_TIME"
  local tmp_work="$PROJECT_ROOT/OUTPUT/.tmp_work_$GRAPH_TIME"
  mkdir -p "$tmp_work"

  # ── 3a: Copy AS-IS (raw unmodified graph files from IN-OUT-FOLDER) ───────────
  # Subfolder suffix _AS-IS makes it instantly clear which pipeline stage
  # produced the folder even when viewed outside its parent directory.
  local asis_out="$OUTPUT_ASIS/${GRAPH_TIME}_AS-IS"
  mkdir -p "$asis_out"
  cp "$inout_gt/nodes.json" "$asis_out/AS-IS_nodes.json"
  cp "$inout_gt/edges.json" "$asis_out/AS-IS_edges.json"
  cp "$inout_gt/meta.json"  "$asis_out/AS-IS_meta.json"
  # Also save the OSPF source file if it was provided
  [[ -n "$OSPF_FILE" && -f "$OSPF_FILE" ]] && cp "$OSPF_FILE" "$asis_out/AS-IS_ospf-database.txt"
  log "AS-IS output: $asis_out"

  # ── 3b: Choose edge source for terminal tool ───────────────────────────────
  # Prefer the OSPF raw file (gives full LSDB).
  # Fall back to edges.csv fetched from API.
  local ospf_src="${OSPF_FILE:-$inout_gt/ospf_source.txt}"
  local use_from="from-file"

  if [[ -n "$OSPF_FILE" && -f "$OSPF_FILE" ]]; then
    log "Edge source: OSPF file ($OSPF_FILE)"
    use_from="from-file"
  elif [[ -f "$inout_gt/edges.csv" ]]; then
    log "Edge source: API edges.csv (no local OSPF file)"
    # Wrap edges.csv as a synthetic OSPF stub file understood by the tool
    # Actually we use the from-api code path but feed the CSV directly:
    use_from="csv"
  else
    echo "ERROR: No OSPF file and no edges.csv in IN-OUT-FOLDER. Cannot run pipeline."
    exit 1
  fi

  # ── 3c: Run topology-country-tool.sh → tmp dir ─────────────────────────────
  local COUNTRIES_ARG=""
  [[ -n "$COUNTRIES_FILTER" ]] && COUNTRIES_ARG="--countries $COUNTRIES_FILTER"

  if [[ "$use_from" == "from-file" ]]; then
    OUTPUT_DIR="$tmp_work" \
    HOST_FILE="$HOST_FILE" \
    OSPF_FILE="$OSPF_FILE" \
      bash "$SCRIPT_DIR/topology-country-tool.sh" from-file \
        --host-file "$HOST_FILE" \
        --ospf-file "$OSPF_FILE" \
        --output-dir "$tmp_work" \
        $COUNTRIES_ARG
  else
    # CSV mode: create synthetic OSPF-like content from edges.csv
    _run_from_csv "$inout_gt/edges.csv" "$inout_gt/nodes.json" "$tmp_work"
  fi

  # ── 3d: Distribute outputs to structured folders ───────────────────────────
  # Both the subfolder suffix and file prefix carry the pipeline-stage label,
  # so any individual file is self-identifying without needing folder context.
  local gw_out="$OUTPUT_GATEWAY/${GRAPH_TIME}_GATEWAY"
  local en_out="$OUTPUT_ENRICHED/${GRAPH_TIME}_ENRICHED"
  mkdir -p "$gw_out" "$en_out"

  # GATEWAY files  (prefix: GATEWAY_)
  for f in gateway-only-topology.yaml gateway-only-topology.json \
            country-core-summary.yaml  country-core-summary.json; do
    [[ -f "$tmp_work/$f" ]] && cp "$tmp_work/$f" "$gw_out/GATEWAY_$f"
  done
  # Filtered variants keep their .filtered. infix AND the GATEWAY_ prefix
  for f in gateway-only-topology.filtered.yaml gateway-only-topology.filtered.json \
            country-core-summary.filtered.yaml  country-core-summary.filtered.json; do
    [[ -f "$tmp_work/$f" ]] && cp "$tmp_work/$f" "$gw_out/GATEWAY_$f"
  done
  log "GATEWAY output: $gw_out"

  # ENRICHED files  (prefix: ENRICHED_)
  for f in original-topology-with-country.yaml original-topology-with-country.json \
            country-mapping.csv; do
    [[ -f "$tmp_work/$f" ]] && cp "$tmp_work/$f" "$en_out/ENRICHED_$f"
  done
  log "ENRICHED output: $en_out"

  # Clean up tmp
  rm -rf "$tmp_work"
}

# Helper: run pipeline from API-fetched CSV (no local OSPF file)
_run_from_csv() {
  local edges_csv="$1"
  local nodes_json="$2"
  local out_dir="$3"

  log "Building enriched model from API CSV …"
  python3 - "$PROJECT_ROOT" "$edges_csv" "$nodes_json" "$HOST_FILE" "$out_dir" <<'PYEOF'
import csv
import os
import sys

project_root, edges_csv, nodes_json_path, host_file, out_dir = sys.argv[1:]
sys.path.insert(0, os.path.join(project_root, "terminal-script"))
from country_code_utils import build_enriched_rows, parse_host_file

os.makedirs(out_dir, exist_ok=True)
host_map = parse_host_file(host_file)

edges = []
with open(edges_csv, newline='', encoding='utf-8') as f:
    for row in csv.reader(f):
        if len(row) >= 3:
            edges.append((row[0].strip(), row[1].strip(), int(float(row[2]))))

node_rows, _edge_rows = build_enriched_rows(host_map, edges)

with open(os.path.join(out_dir, 'country-mapping.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['router_id', 'hostname', 'country_code', 'is_gateway'])
    w.writerows(node_rows)

print(f"[_run_from_csv] Generated outputs in {out_dir}")
PYEOF
}

# ── Step 4: Generate COLLAPSING stage outputs ──────────────────────────────────
step_generate_collapse_config() {
  step "Generate COLLAPSING stage — gateway/core split + collapsed topology"

  local en_out="$OUTPUT_ENRICHED/${GRAPH_TIME}_ENRICHED"
  local as_out="$OUTPUT_ASIS/${GRAPH_TIME}_AS-IS"
  local co_out="$OUTPUT_COLLAPSING/${GRAPH_TIME}_COLLAPSING"
  mkdir -p "$co_out"

  if [[ ! -d "$en_out" ]]; then
    log "WARNING: ENRICHED dir not found ($en_out) — skipping COLLAPSING stage"
    return
  fi
  if [[ ! -d "$as_out" ]]; then
    log "WARNING: AS-IS dir not found ($as_out) — skipping COLLAPSING stage"
    return
  fi

  python3 "$SCRIPT_DIR/generate-collapse-config.py" \
    --enriched-dir "$en_out" \
    --asis-dir     "$as_out" \
    --output-dir   "$co_out" \
    --graph-time   "$GRAPH_TIME"

  log "COLLAPSING output: $co_out"
}

# ── Step 5: Push colours → Topolograph UI ─────────────────────────────────────
step_push_to_ui() {
  if [[ "$NO_PUSH" == "true" ]]; then
    log "Skipping UI push (--no-push)."
    return
  fi

  step "Push country colours → Topolograph UI"

  local en_out="$OUTPUT_ENRICHED/${GRAPH_TIME}_ENRICHED"
  local dry_flag=""
  [[ "$DRY_RUN" == "true" ]] && dry_flag="--dry-run"

  python3 "$SCRIPT_DIR/push-to-ui.py" \
    --graph-time   "$GRAPH_TIME" \
    --enriched-dir "$en_out" \
    --base-url     "$BASE_URL" \
    --user         "$AUTH_USER" \
    --pass         "$AUTH_PASS" \
    $dry_flag

  log "UI push complete."
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
  echo
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║               WORKFLOW COMPLETE                              ║"
  echo "╠══════════════════════════════════════════════════════════════╣"
  printf  "║  graph_time : %-47s║\n" "$GRAPH_TIME"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  OUTPUT FOLDERS:                                             ║"
  printf  "║  AS-IS    → OUTPUT/AS-IS/%-37s║\n"    "${GRAPH_TIME}_AS-IS/"
  printf  "║  GATEWAY  → OUTPUT/GATEWAY/%-35s║\n"  "${GRAPH_TIME}_GATEWAY/"
  printf  "║  ENRICHED   → OUTPUT/ENRICHED/%-32s║\n"   "${GRAPH_TIME}_ENRICHED/"
  printf  "║  COLLAPSING → OUTPUT/COLLAPSING/%-30s║\n" "${GRAPH_TIME}_COLLAPSING/"
  echo "╠══════════════════════════════════════════════════════════════╣"
  echo "║  NEXT STEPS:                                                 ║"
  echo "║  1. Open http://localhost:8081/                               ║"
  echo "║  2. Select the graph from the dropdown                       ║"
  echo "║  3. Use the 🌍 Country Filter panel (top-right)              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
}

# ── Entry point ───────────────────────────────────────────────────────────────
main() {
  case "$CMD" in
    help|-h|--help)
      usage ;;

    all)
      parse_args "$@"
      step_upload_ospf           # uploads if --ospf-file given, else skips
      step_fetch_raw             # always fetches from API → IN-OUT-FOLDER
      step_terminal_pipeline
      step_generate_collapse_config
      step_push_to_ui
      print_summary
      ;;

    enrich-existing)
      parse_args "$@"
      # Don't upload, don't fetch (graph already in Topolograph + local OSPF/host files)
      step_fetch_raw
      step_terminal_pipeline
      step_generate_collapse_config
      step_push_to_ui
      print_summary
      ;;

    *)
      echo "Unknown command: $CMD"
      usage
      exit 1
      ;;
  esac
}

main "$@"
