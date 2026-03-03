#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# save-load-hosts.sh
# Promotes any host file (txt or csv) to the canonical Load-hosts.txt/csv.
#
# Usage:
#   ./save-load-hosts.sh --from <path-to-host-file>
#   ./save-load-hosts.sh --from-ui --graph-time <graph_time> [--base-url <url>]
#   ./save-load-hosts.sh --show
#
# Options:
#   --from <path>              Promote a local file to canonical Load-hosts.txt
#   --from-ui                  Fetch hostname mapping from Topolograph UI (API)
#   --graph-time <value>       Graph time used with --from-ui
#   --base-url <url>           Topolograph URL (default: http://localhost:8081)
#   --user <name>              API user  (default: ospf@topolograph.com)
#   --pass <pw>                API pass  (default: ospf)
#   --show                     Print current Load-hosts.txt and exit
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INPUT_DIR="$PROJECT_ROOT/INPUT-FOLDER"
LOAD_TXT="$INPUT_DIR/Load-hosts.txt"
LOAD_CSV="$INPUT_DIR/Load-hosts.csv"

BASE_URL="${BASE_URL:-http://localhost:8081}"
AUTH_USER="${AUTH_USER:-ospf@topolograph.com}"
AUTH_PASS="${AUTH_PASS:-ospf}"
MODE=""
SOURCE_FILE=""
GRAPH_TIME=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)       MODE="file";    SOURCE_FILE="$2"; shift 2 ;;
    --from-ui)    MODE="ui";                        shift   ;;
    --graph-time) GRAPH_TIME="$2";                  shift 2 ;;
    --base-url)   BASE_URL="$2";                    shift 2 ;;
    --user)       AUTH_USER="$2";                   shift 2 ;;
    --pass)       AUTH_PASS="$2";                   shift 2 ;;
    --show)       MODE="show";                      shift   ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
txt_to_csv() {
  # Converts space-separated txt (skip # comments) to CSV with header
  local src="$1" dst="$2"
  echo "device_ip_address,device_name" > "$dst"
  grep -v '^\s*#' "$src" | grep -v '^\s*$' | \
    awk '{if(NF>=2) printf "%s,%s\n", $1, $2}' >> "$dst"
}

csv_to_txt() {
  # Converts CSV to txt format (skip header)
  local src="$1" dst="$2"
  {
    echo "# Load-hosts.txt — generated from $(basename "$src")"
    echo "# Format: <router_id> <hostname>"
    echo ""
    tail -n +2 "$src" | awk -F, '{if(NF>=2) printf "%-15s %s\n", $1, $2}'
  } > "$dst"
}

save_both() {
  # $1 = source file (txt or csv), both formats will be written
  local src="$1"
  # Detect format
  if head -1 "$src" | grep -q ','; then
    # CSV → convert to txt, copy csv
    csv_to_txt "$src" "$LOAD_TXT"
    cp "$src" "$LOAD_CSV"
  else
    # TXT → copy txt, convert to csv
    cp "$src" "$LOAD_TXT"
    txt_to_csv "$src" "$LOAD_CSV"
  fi
  local lines
  lines=$(grep -v '^\s*#' "$LOAD_TXT" | grep -v '^\s*$' | wc -l | tr -d ' ')
  echo "✅  Saved canonical host file ($lines entries):"
  echo "    TXT → $LOAD_TXT"
  echo "    CSV → $LOAD_CSV"
}

# ── Mode: show ────────────────────────────────────────────────────────────────
if [[ "$MODE" == "show" ]]; then
  if [[ -f "$LOAD_TXT" ]]; then
    echo "─── $LOAD_TXT ───"
    cat "$LOAD_TXT"
  else
    echo "Load-hosts.txt not found at: $LOAD_TXT"
    exit 1
  fi
  exit 0
fi

# ── Mode: from local file ─────────────────────────────────────────────────────
if [[ "$MODE" == "file" ]]; then
  [[ -z "$SOURCE_FILE" ]] && { echo "ERROR: --from requires a file path"; exit 1; }
  [[ ! -f "$SOURCE_FILE" ]] && { echo "ERROR: File not found: $SOURCE_FILE"; exit 1; }
  echo "Promoting '$SOURCE_FILE' → Load-hosts.txt / Load-hosts.csv ..."
  # Back up existing files
  [[ -f "$LOAD_TXT" ]] && cp "$LOAD_TXT" "${LOAD_TXT}.bak" && echo "  (backed up existing txt → Load-hosts.txt.bak)"
  [[ -f "$LOAD_CSV" ]] && cp "$LOAD_CSV" "${LOAD_CSV}.bak"
  save_both "$SOURCE_FILE"
  exit 0
fi

# ── Mode: from UI (Topolograph hostname API) ──────────────────────────────────
if [[ "$MODE" == "ui" ]]; then
  [[ -z "$GRAPH_TIME" ]] && { echo "ERROR: --from-ui requires --graph-time <value>"; exit 1; }
  command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 required for --from-ui"; exit 1; }
  echo "Fetching hostname mapping from Topolograph UI for graph_time=$GRAPH_TIME ..."

  TMP_CSV=$(mktemp /tmp/topo-hosts-XXXXXX.csv)
  python3 - "$BASE_URL" "$GRAPH_TIME" "$AUTH_USER" "$AUTH_PASS" "$TMP_CSV" <<'PYEOF'
import sys, requests, csv
base_url, graph_time, user, pw, out_csv = sys.argv[1:]
r = requests.get(f"{base_url}/api/diagram/{graph_time}/nodes", auth=(user, pw), timeout=15)
r.raise_for_status()
nodes = r.json()
with open(out_csv, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['device_ip_address', 'device_name'])
    for n in nodes:
        rid  = n.get('name') or n.get('label') or str(n.get('id', ''))
        name = n.get('label') or rid
        if rid and rid != name:   # only write if hostname differs from router_id
            w.writerow([rid, name])
        elif rid:
            w.writerow([rid, rid])
print(f"Fetched {len(nodes)} nodes → {out_csv}")
PYEOF

  [[ -f "$LOAD_TXT" ]] && cp "$LOAD_TXT" "${LOAD_TXT}.bak"
  [[ -f "$LOAD_CSV" ]] && cp "$LOAD_CSV" "${LOAD_CSV}.bak"
  save_both "$TMP_CSV"
  rm -f "$TMP_CSV"
  exit 0
fi

# ── No mode: print help ───────────────────────────────────────────────────────
cat <<'EOF'
save-load-hosts.sh — promote a host file to canonical Load-hosts.txt/csv

Usage:
  ./save-load-hosts.sh --from <path>                       # promote local file
  ./save-load-hosts.sh --from-ui --graph-time <graph_time> # fetch from UI API
  ./save-load-hosts.sh --show                              # print current file

Examples:
  # Make host-file-db2.txt the canonical host file:
  ./terminal-script/save-load-hosts.sh --from INPUT-FOLDER/host-file-db2.txt

  # Fetch hostnames from Topolograph UI for a specific graph:
  ./terminal-script/save-load-hosts.sh --from-ui --graph-time 03Mar2026_12h00m00s_34_hosts

  # Show what's currently saved:
  ./terminal-script/save-load-hosts.sh --show
EOF
exit 0
