#!/usr/bin/env bash
# ==============================================================================
# fetch-from-api.sh
# Fetch the latest (or specified) graph from the Topolograph API and save the
# raw unmodified data to IN-OUT-FOLDER/{graph_time}/
#
# Usage:
#   ./fetch-from-api.sh [--base-url URL] [--user U] [--pass P]
#                       [--graph-time VALUE] [--output-dir PATH]
#
# Outputs (IN-OUT-FOLDER/{graph_time}/):
#   meta.json        — graph metadata (graph_time, timestamp, protocol, hosts)
#   nodes.json       — all nodes with all stored attributes (id, name, label, country, …)
#   edges.json       — all edges (src, dst, cost, …)
#   edges.csv        — edges in src,dst,cost CSV form (used by topology-country-tool.sh)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE_URL="${BASE_URL:-http://localhost:8081}"
AUTH_USER="${AUTH_USER:-ospf@topolograph.com}"
AUTH_PASS="${AUTH_PASS:-ospf}"
GRAPH_TIME="${GRAPH_TIME:-}"
INOUT_DIR="${INOUT_DIR:-$PROJECT_ROOT/IN-OUT-FOLDER}"

log() { echo "[fetch-from-api] $*" >&2; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-url)   BASE_URL="$2";   shift 2 ;;
      --user)       AUTH_USER="$2";  shift 2 ;;
      --pass)       AUTH_PASS="$2";  shift 2 ;;
      --graph-time) GRAPH_TIME="$2"; shift 2 ;;
      --output-dir) INOUT_DIR="$2";  shift 2 ;;
      *) echo "Unknown arg: $1"; exit 1 ;;
    esac
  done
}

main() {
  parse_args "$@"

  # ── 1. Discover graph_time if not provided ──────────────────────────────────
  if [[ -z "$GRAPH_TIME" ]]; then
    log "No --graph-time given; querying latest from $BASE_URL/api/graph/"
    GRAPH_TIME=$(curl -sf -u "$AUTH_USER:$AUTH_PASS" "$BASE_URL/api/graph/" \
      | python3 -c "
import sys, json
gs = json.load(sys.stdin)
if isinstance(gs, list) and gs:
    # Sort by timestamp descending and take the first
    gs_sorted = sorted(gs, key=lambda g: g.get('timestamp',''), reverse=True)
    print(gs_sorted[0].get('graph_time',''))
else:
    print('')
" 2>/dev/null || true)

    if [[ -z "$GRAPH_TIME" ]]; then
      echo "ERROR: Could not determine graph_time. Is Topolograph running? Try --graph-time <value>"
      exit 1
    fi
    log "Latest graph_time: $GRAPH_TIME"
  fi

  # ── 2. Create output directory ───────────────────────────────────────────────
  OUT_DIR="$INOUT_DIR/$GRAPH_TIME"
  mkdir -p "$OUT_DIR"
  log "Saving to: $OUT_DIR"

  # ── 3. Save meta ─────────────────────────────────────────────────────────────
  curl -sf -u "$AUTH_USER:$AUTH_PASS" "$BASE_URL/api/graph/$GRAPH_TIME" \
    > "$OUT_DIR/meta.json" 2>/dev/null \
    || (curl -sf -u "$AUTH_USER:$AUTH_PASS" "$BASE_URL/api/graph/" \
        | python3 -c "
import sys, json
gs = json.load(sys.stdin)
gt = '${GRAPH_TIME}'
match = next((g for g in gs if g.get('graph_time') == gt), {})
print(json.dumps(match, indent=2))
" > "$OUT_DIR/meta.json")
  log "  meta.json saved"

  # ── 4. Fetch nodes ────────────────────────────────────────────────────────────
  curl -sf -u "$AUTH_USER:$AUTH_PASS" \
    "$BASE_URL/api/diagram/$GRAPH_TIME/nodes" \
    > "$OUT_DIR/nodes.json"
  NODE_COUNT=$(python3 -c "import json; d=json.load(open('$OUT_DIR/nodes.json')); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo 0)
  log "  nodes.json saved ($NODE_COUNT nodes)"

  # ── 5. Fetch edges ────────────────────────────────────────────────────────────
  curl -sf -u "$AUTH_USER:$AUTH_PASS" \
    "$BASE_URL/api/diagram/$GRAPH_TIME/edges" \
    > "$OUT_DIR/edges.json"
  EDGE_COUNT=$(python3 -c "import json; d=json.load(open('$OUT_DIR/edges.json')); print(len(d) if isinstance(d,list) else 0)" 2>/dev/null || echo 0)
  log "  edges.json saved ($EDGE_COUNT edges)"

  # ── 6. Convert edges.json → edges.csv (src,dst,cost) ─────────────────────────
  #    edges.json format: [{"from":"1.1.1.1","to":"2.2.2.2","label":"10",...}, ...]
  python3 - "$OUT_DIR/edges.json" "$OUT_DIR/edges.csv" <<'PYEOF'
import sys, json, csv

edges_path, csv_path = sys.argv[1], sys.argv[2]
with open(edges_path) as f:
    edges = json.load(f)

with open(csv_path, 'w', newline='') as out:
    w = csv.writer(out)
    for e in edges:
        src = (e.get('from') or e.get('src') or e.get('source') or '')
        dst = (e.get('to')   or e.get('dst') or e.get('target') or '')
        # label holds the OSPF cost in Topolograph
        cost_raw = e.get('label') or e.get('cost') or e.get('link_cost') or '1'
        # label may be "10\n10" for bidirectional — take first number
        cost = str(cost_raw).split('\n')[0].split('/')[0].strip()
        try:
            cost = str(int(float(cost)))
        except Exception:
            cost = '1'
        if src and dst:
            w.writerow([src, dst, cost])
PYEOF
  log "  edges.csv saved"

  # ── 7. Emit graph_time for use by caller ─────────────────────────────────────
  echo "$GRAPH_TIME" > "$OUT_DIR/.graph_time"
  log "Done. graph_time=$GRAPH_TIME"
  echo "$GRAPH_TIME"
}

main "$@"
