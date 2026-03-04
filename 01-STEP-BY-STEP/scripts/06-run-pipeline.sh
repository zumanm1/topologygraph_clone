#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 06-run-pipeline.sh  —  Upload OSPF file + run full country-enrichment pipeline
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS RUNS:
#   terminal-script/workflow.sh all
#     Step 1: POST /api/graphs           → upload OSPF LSDB → Topolograph parses it
#     Step 2: GET  /api/diagram/{gt}/... → fetch nodes, edges, meta → IN-OUT-FOLDER/
#     Step 3: topology-country-tool.sh   → assign countries + detect gateways
#     Step 4: push-to-ui.py             → PATCH each node with colour + country
#
# OUTPUT FILE NAMING (new self-identifying convention):
#   OUTPUT/AS-IS/{graph_time}_AS-IS/
#     AS-IS_nodes.json          ← raw node list (id, label, x, y, group)
#     AS-IS_edges.json          ← raw edge list (from, to, cost)
#     AS-IS_meta.json           ← graph metadata (areas, protocol, vendor)
#     AS-IS_ospf-database.txt   ← exact copy of the OSPF source file
#
#   OUTPUT/GATEWAY/{graph_time}_GATEWAY/
#     GATEWAY_gateway-only-topology.yaml   ← only border routers + cross-country links
#     GATEWAY_gateway-only-topology.json
#     GATEWAY_country-core-summary.yaml    ← per-country gateway count + neighbours
#     GATEWAY_country-core-summary.json
#
#   OUTPUT/ENRICHED/{graph_time}_ENRICHED/
#     ENRICHED_country-mapping.csv                  ← router_id, hostname, country, is_gateway
#     ENRICHED_country-palette.json                 ← {ZAF: {background:"#FF8C42",...}, ...}
#     ENRICHED_original-topology-with-country.yaml  ← all 34 routers + country + colour
#     ENRICHED_original-topology-with-country.json
#
# WHY THE NAMING?
#   Each file prefix (AS-IS_ / GATEWAY_ / ENRICHED_) and subfolder suffix
#   (_AS-IS / _GATEWAY / _ENRICHED) makes every file self-identifying.
#   You can move a single file out of its folder and still know which
#   pipeline stage produced it and what it contains.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'

OSPF_FILE="${1:-$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt}"
HOST_FILE="${2:-$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt}"
BASE_URL="${BASE_URL:-http://localhost:8081}"

echo ""
echo -e "${BOLD}═══ STEP 6 — Run Full Pipeline ═══${RESET}"
echo -e "  OSPF file : ${CYAN}$(basename "$OSPF_FILE")${RESET}"
echo -e "  Host file : ${CYAN}$(basename "$HOST_FILE")${RESET}"
echo -e "  App URL   : ${CYAN}$BASE_URL${RESET}"
echo ""

[[ ! -f "$OSPF_FILE" ]] && { echo -e "  ${RED}❌  OSPF file not found: $OSPF_FILE${RESET}"; exit 1; }
[[ ! -f "$HOST_FILE" ]] && { echo -e "  ${RED}❌  Host file not found: $HOST_FILE${RESET}"; exit 1; }

bash "$PROJECT_ROOT/terminal-script/workflow.sh" all \
    --ospf-file "$OSPF_FILE" \
    --host-file "$HOST_FILE" \
    --base-url  "$BASE_URL"

echo ""
echo -e "  ${GREEN}${BOLD}✅  Pipeline complete!${RESET}"
echo -e "  ${CYAN}  Open → $BASE_URL/upload-ospf-isis-lsdb${RESET}"
echo -e "  ${CYAN}  Then select the new graph_time from the dropdown.${RESET}"
echo ""
echo -e "  ${RESET}Next step → run: 07-show-outputs.sh${RESET}"
