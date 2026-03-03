#!/usr/bin/env bash
# ==============================================================================
# workflow.sh  –  Master orchestrator for the OSPF Country Topology Pipeline
# ==============================================================================
#
# FLOW:
#   1. (Optional) Upload a new OSPF LSDB file → Topolograph web app
#   2. Fetch the raw (unmodified) graph → IN-OUT-FOLDER/{graph_time}/
#   3. Run the terminal topology pipeline → 3 structured output folders:
#         OUTPUT/AS-IS/{graph_time}/    ← original graph, nothing changed
#         OUTPUT/GATEWAY/{graph_time}/  ← gateway-only, countries collapsed
#         OUTPUT/ENRICHED/{graph_time}/ ← original + country / colour enrichment
#   4. Push country colours + metadata back to the Topolograph UI
#
# Usage:
#   ./workflow.sh all [options]
#   ./workflow.sh enrich-existing --graph-time <value> [options]
#   ./workflow.sh help
#
# Options:
#   --ospf-file  <path>    OSPF database text file to upload (triggers upload step)
#   --host-file  <path>    Host mapping file (txt or csv). Default: host-file.txt
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
OSPF_FILE="${OSPF_FILE:-}"
HOST_FILE="${HOST_FILE:-$PROJECT_ROOT/INPUT-FOLDER/host-file.txt}"
GRAPH_TIME="${GRAPH_TIME:-}"
COUNTRIES_FILTER="${COUNTRIES_FILTER:-}"
NO_PUSH="${NO_PUSH:-false}"
DRY_RUN="${DRY_RUN:-false}"
CMD="${1:-help}"

INOUT_DIR="$PROJECT_ROOT/IN-OUT-FOLDER"
OUTPUT_ASIS="$PROJECT_ROOT/OUTPUT/AS-IS"
OUTPUT_GATEWAY="$PROJECT_ROOT/OUTPUT/GATEWAY"
OUTPUT_ENRICHED="$PROJECT_ROOT/OUTPUT/ENRICHED"

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
  OUTPUT/AS-IS/{graph_time}/    — original graph, zero modification
  OUTPUT/GATEWAY/{graph_time}/  — gateway-only topology, countries collapsed
  OUTPUT/ENRICHED/{graph_time}/ — all routers + country label + colour metadata
EOF
}

# ── Step 1: Upload OSPF file (optional) ───────────────────────────────────────
step_upload_ospf() {
  [[ -n "$OSPF_FILE" ]] || { log "No --ospf-file provided; skipping upload."; return; }
  [[ -f "$OSPF_FILE" ]] || { echo "ERROR: OSPF file not found: $OSPF_FILE"; exit 1; }

  step "Upload OSPF database → Topolograph"
  log "File: $OSPF_FILE"

  GRAPH_TIME=$(python3 - <<PYEOF
import requests, json, sys

base = "${BASE_URL}"
auth = ("${AUTH_USER}", "${AUTH_PASS}")
ospf_path = "${OSPF_FILE}"

# Ensure credentials exist
requests.post(f"{base}/create-default-credentials", auth=auth, timeout=10)

with open(ospf_path) as f:
    lsdb_text = f.read()

r = requests.post(f"{base}/api/graphs",
    json=[{"lsdb_output": lsdb_text, "vendor_device": "Cisco", "igp_protocol": "ospf"}],
    auth=auth, timeout=120)
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
  local asis_out="$OUTPUT_ASIS/$GRAPH_TIME"
  mkdir -p "$asis_out"
  cp "$inout_gt/nodes.json" "$asis_out/nodes.json"
  cp "$inout_gt/edges.json" "$asis_out/edges.json"
  cp "$inout_gt/meta.json"  "$asis_out/meta.json"
  # Also save the OSPF source file if it was provided
  [[ -n "$OSPF_FILE" && -f "$OSPF_FILE" ]] && cp "$OSPF_FILE" "$asis_out/ospf-database.txt"
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
  local gw_out="$OUTPUT_GATEWAY/$GRAPH_TIME"
  local en_out="$OUTPUT_ENRICHED/$GRAPH_TIME"
  mkdir -p "$gw_out" "$en_out"

  # GATEWAY files
  for f in gateway-only-topology.yaml gateway-only-topology.json \
            country-core-summary.yaml  country-core-summary.json \
            gateway-only-topology.filtered.yaml \
            gateway-only-topology.filtered.json \
            country-core-summary.filtered.yaml \
            country-core-summary.filtered.json; do
    [[ -f "$tmp_work/$f" ]] && cp "$tmp_work/$f" "$gw_out/"
  done
  log "GATEWAY output: $gw_out"

  # ENRICHED files
  for f in original-topology-with-country.yaml original-topology-with-country.json \
            country-mapping.csv; do
    [[ -f "$tmp_work/$f" ]] && cp "$tmp_work/$f" "$en_out/"
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
  python3 - "$edges_csv" "$nodes_json" "$HOST_FILE" "$out_dir" <<'PYEOF'
import sys, json, csv, os

edges_csv, nodes_json_path, host_file, out_dir = sys.argv[1:]
os.makedirs(out_dir, exist_ok=True)

# Load host map
host_map = {}
with open(host_file) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        # Try CSV (comma-separated) then whitespace
        if ',' in line:
            parts = line.split(',', 1)
        else:
            parts = line.split(None, 1)
        if len(parts) >= 2:
            host_map[parts[0].strip()] = parts[1].strip()

# Determine country from hostname prefix (first 3 chars, upper)
def country_of(rid):
    h = host_map.get(rid, '')
    return h[:3].upper() if h else 'UNK'

# Load edges
edges = []
with open(edges_csv, newline='') as f:
    for row in csv.reader(f):
        if len(row) >= 3:
            edges.append({'src': row[0], 'dst': row[1], 'cost': int(float(row[2]))})

# Determine gateway nodes (cross-country links)
gw = set()
for e in edges:
    if country_of(e['src']) != country_of(e['dst']):
        gw.add(e['src']); gw.add(e['dst'])

# All routers
all_rids = sorted({e['src'] for e in edges} | {e['dst'] for e in edges})

# country-mapping.csv
with open(os.path.join(out_dir, 'country-mapping.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['router_id','hostname','country_code','is_gateway'])
    for rid in all_rids:
        w.writerow([rid, host_map.get(rid, rid), country_of(rid),
                    str(rid in gw).lower()])

print(f"[_run_from_csv] Generated outputs in {out_dir}")
PYEOF
}

# ── Step 4: Push colours → Topolograph UI ─────────────────────────────────────
step_push_to_ui() {
  if [[ "$NO_PUSH" == "true" ]]; then
    log "Skipping UI push (--no-push)."
    return
  fi

  step "Push country colours → Topolograph UI"

  local en_out="$OUTPUT_ENRICHED/$GRAPH_TIME"
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
  printf  "║  AS-IS    → OUTPUT/AS-IS/%-37s║\n"    "$GRAPH_TIME/"
  printf  "║  GATEWAY  → OUTPUT/GATEWAY/%-35s║\n"  "$GRAPH_TIME/"
  printf  "║  ENRICHED → OUTPUT/ENRICHED/%-34s║\n" "$GRAPH_TIME/"
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
      step_upload_ospf      # uploads if --ospf-file given, else skips
      step_fetch_raw        # always fetches from API → IN-OUT-FOLDER
      step_terminal_pipeline
      step_push_to_ui
      print_summary
      ;;

    enrich-existing)
      parse_args "$@"
      # Don't upload, don't fetch (graph already in Topolograph + local OSPF/host files)
      step_fetch_raw
      step_terminal_pipeline
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
