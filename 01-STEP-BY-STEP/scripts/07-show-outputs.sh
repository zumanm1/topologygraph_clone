#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 07-show-outputs.sh  —  List and describe the 3 pipeline output folders
# Part of: 01-STEP-BY-STEP teaching guide
# ─────────────────────────────────────────────────────────────────────────────
#
# ── OUTPUT FILE NAMING (self-identifying convention) ─────────────────────────
#
#   Every output file carries two labels:
#     1. Subfolder suffix  :  {graph_time}_AS-IS  /  _GATEWAY  /  _ENRICHED
#     2. File prefix       :  AS-IS_  /  GATEWAY_  /  ENRICHED_
#
#   WHY: If you extract a single file from its folder, the prefix tells you:
#     - which pipeline stage produced it      (AS-IS / GATEWAY / ENRICHED)
#     - what graph_time it belongs to         (from the subfolder name)
#   No ambiguity. No need for a README inside the folder.
#
# ── THE THREE PIPELINE STAGES ────────────────────────────────────────────────
#
#   AS-IS   → "What Topolograph holds right now"
#     Exact copy of the raw API response.  No modification.  Audit trail.
#     Files: AS-IS_nodes.json  AS-IS_edges.json  AS-IS_meta.json  AS-IS_ospf-database.txt
#
#   GATEWAY → "The skeleton of how countries are interconnected"
#     Only routers that cross country boundaries (border routers).
#     Countries are collapsed to single nodes. Good for high-level topology maps.
#     Files: GATEWAY_gateway-only-topology.yaml/json  GATEWAY_country-core-summary.yaml/json
#
#   ENRICHED → "The full enriched topology — what you push back to the UI"
#     All 34 routers with country code, hostname, colour metadata.
#     This is what push-to-ui.py reads to PATCH each node in Topolograph.
#     Files: ENRICHED_country-mapping.csv
#            ENRICHED_country-palette.json
#            ENRICHED_original-topology-with-country.yaml/json
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RESET='\033[0m'

OUTPUT_DIR="$PROJECT_ROOT/OUTPUT"

echo ""
echo -e "${BOLD}═══ STEP 7 — Pipeline Output Files ═══${RESET}"
echo ""

# ── Helper: print one folder ─────────────────────────────────────────────────
show_folder() {
    local stage="$1"          # AS-IS / GATEWAY / ENRICHED
    local colour="$2"         # ANSI colour
    local description="$3"
    local dir="$OUTPUT_DIR/$stage"

    echo -e "  ${colour}${BOLD}OUTPUT/$stage/${RESET}"
    echo -e "  ${YELLOW}$description${RESET}"

    if [ ! -d "$dir" ] || [ -z "$(ls "$dir" 2>/dev/null)" ]; then
        echo -e "    ${YELLOW}(empty — run 06-run-pipeline.sh first)${RESET}"
        echo ""
        return
    fi

    # Show subfolders newest-first
    local count=0
    for gt_dir in $(ls -t "$dir" 2>/dev/null); do
        echo -e "    ${GREEN}▶ ${gt_dir}/${RESET}"
        ls "$dir/$gt_dir/" 2>/dev/null | sort | sed 's/^/        /'
        ((count++))
        [ $count -ge 3 ] && break   # show at most 3 snapshots
    done
    if [ $count -eq 0 ]; then
        echo -e "    ${YELLOW}(empty — run 06-run-pipeline.sh first)${RESET}"
    fi
    echo ""
}

show_folder "AS-IS"   "$CYAN"  "Raw unmodified graph snapshot from Topolograph API (audit trail)"
show_folder "GATEWAY" "$BLUE"  "Gateway-only topology: border routers + cross-country links only"
show_folder "ENRICHED" "$GREEN" "Full topology + country codes + colours (pushed to Topolograph UI)"

# ── File-by-file key ─────────────────────────────────────────────────────────
echo -e "${BOLD}File Reference:${RESET}"
echo ""
echo -e "  ${CYAN}AS-IS_ prefix files:${RESET}"
echo "    AS-IS_nodes.json        → 34 routers: id, label, x, y, group, color"
echo "    AS-IS_edges.json        → 108 edges:  from, to, cost (OSPF metric)"
echo "    AS-IS_meta.json         → {areas, protocol:'ospf', vendor:'Cisco'}"
echo "    AS-IS_ospf-database.txt → original OSPF 'show ip ospf database detail' output"
echo ""
echo -e "  ${BLUE}GATEWAY_ prefix files:${RESET}"
echo "    GATEWAY_gateway-only-topology.yaml/json  → border routers only"
echo "    GATEWAY_country-core-summary.yaml/json   → per-country: gateway count + neighbours"
echo ""
echo -e "  ${GREEN}ENRICHED_ prefix files:${RESET}"
echo "    ENRICHED_country-mapping.csv                 → router_id, hostname, country, is_gateway"
echo "    ENRICHED_country-palette.json                → {ZAF:{background:'#FF8C42',...}, ...}"
echo "    ENRICHED_original-topology-with-country.yaml → all 34 routers + country + colour"
echo "    ENRICHED_original-topology-with-country.json → same, JSON format"
echo ""
echo -e "  ${RESET}Next step → open http://localhost:8081/upload-ospf-isis-lsdb${RESET}"
