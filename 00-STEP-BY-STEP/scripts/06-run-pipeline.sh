#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 06-run-pipeline.sh  —  Upload OSPF file + run full pipeline
#                        (same as start.sh option [1] but scriptable)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'

DEFAULT_OSPF="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-54-unk-test.txt"
[[ ! -f "$DEFAULT_OSPF" ]] && DEFAULT_OSPF="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3.txt"
[[ ! -f "$DEFAULT_OSPF" ]] && DEFAULT_OSPF="$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt"
[[ ! -f "$DEFAULT_OSPF" ]] && DEFAULT_OSPF="$PROJECT_ROOT/INPUT-FOLDER/ospf-database.txt"
DEFAULT_HOST="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.csv"
[[ ! -f "$DEFAULT_HOST" ]] && DEFAULT_HOST="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt"
[[ ! -f "$DEFAULT_HOST" ]] && DEFAULT_HOST="$PROJECT_ROOT/INPUT-FOLDER/Load-hosts-3b.txt"
[[ ! -f "$DEFAULT_HOST" ]] && DEFAULT_HOST="$PROJECT_ROOT/INPUT-FOLDER/host-file.txt"

OSPF_FILE="${1:-$DEFAULT_OSPF}"
HOST_FILE="${2:-$DEFAULT_HOST}"
BASE_URL="${BASE_URL:-http://localhost:8081}"

echo ""
echo -e "${BOLD}Step 6 — Run Full Pipeline${RESET}"
echo -e "  OSPF file : ${CYAN}$(basename "$OSPF_FILE")${RESET}"
echo -e "  Host file : ${CYAN}$(basename "$HOST_FILE")${RESET}"
echo -e "  App URL   : ${CYAN}$BASE_URL${RESET}"
echo ""

[[ ! -f "$OSPF_FILE" ]] && { echo "❌  OSPF file not found: $OSPF_FILE"; exit 1; }
[[ ! -f "$HOST_FILE" ]] && { echo "❌  Host file not found: $HOST_FILE"; exit 1; }

bash "$PROJECT_ROOT/terminal-script/workflow.sh" all \
    --ospf-file "$OSPF_FILE" \
    --host-file "$HOST_FILE" \
    --base-url  "$BASE_URL"

echo ""
echo -e "  ${GREEN}${BOLD}✅  Pipeline complete!${RESET}"
echo -e "  ${CYAN}Open → $BASE_URL/upload-ospf-isis-lsdb${RESET}"
