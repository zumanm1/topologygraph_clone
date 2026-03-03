#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 07-show-outputs.sh  —  List and describe the 3 pipeline output folders
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}Step 7 — Pipeline Output Files${RESET}"
echo ""

for folder in AS-IS GATEWAY ENRICHED; do
    DIR="$PROJECT_ROOT/OUTPUT/$folder"
    echo -e "  ${CYAN}${BOLD}OUTPUT/$folder/${RESET}"
    if [ -d "$DIR" ]; then
        SUBDIRS=$(ls "$DIR" 2>/dev/null | head -5)
        if [ -z "$SUBDIRS" ]; then
            echo -e "    ${YELLOW}(empty — run pipeline first)${RESET}"
        else
            for gt in $SUBDIRS; do
                echo -e "    ${GREEN}→ $gt/${RESET}"
                ls "$DIR/$gt/" 2>/dev/null | sed 's/^/        /'
            done
        fi
    else
        echo -e "    ${YELLOW}(folder not yet created)${RESET}"
    fi
    echo ""
done

echo -e "${BOLD}Folder descriptions:${RESET}"
echo -e "  ${CYAN}AS-IS/${RESET}     — Raw unmodified graph (nodes.json + edges.json + meta.json)"
echo -e "  ${CYAN}GATEWAY/${RESET}   — Gateway-only topology (YAML/JSON, countries collapsed)"
echo -e "  ${CYAN}ENRICHED/${RESET}  — All routers + country label + colour metadata (YAML/JSON + CSV)"
echo ""
