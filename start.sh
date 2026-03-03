#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start.sh  —  OSPF Country Topology  |  Interactive Launcher
# ─────────────────────────────────────────────────────────────────────────────
# Presents the user with a choice:
#   [1] Run pipeline with DEFAULT files  (ospf-database-2.txt + Load-hosts.txt)
#   [2] Specify custom OSPF / host files before running
#   [3] Open the Topolograph web UI only (no pipeline)
#   [4] Exit
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT_DIR="$SCRIPT_DIR/INPUT-FOLDER"
TERM_DIR="$SCRIPT_DIR/terminal-script"
DOCKER_DIR="$SCRIPT_DIR/topolograph-docker"
BASE_URL="${BASE_URL:-http://localhost:8081}"

# Defaults
DEFAULT_OSPF="$INPUT_DIR/ospf-database-2.txt"
DEFAULT_HOST="$INPUT_DIR/Load-hosts.txt"
# Fall back to host-file.txt if Load-hosts.txt doesn't exist yet
[[ ! -f "$DEFAULT_HOST" ]] && DEFAULT_HOST="$INPUT_DIR/host-file.txt"

# ── Colours ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

print_banner() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}${BOLD}║       OSPF Country Topology Pipeline  —  Launcher           ║${RESET}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

check_app_running() {
  curl -s --max-time 2 "$BASE_URL" > /dev/null 2>&1
}

ensure_app_running() {
  if check_app_running; then
    echo -e "  ${GREEN}✅  Topolograph is already running  →  $BASE_URL${RESET}"
  else
    echo -e "  ${YELLOW}⚡  Starting Topolograph (Docker)...${RESET}"
    if [[ -f "$DOCKER_DIR/docker-compose.yml" ]]; then
      (cd "$DOCKER_DIR" && docker compose up -d --quiet-pull 2>&1 | tail -3)
      echo -n "  Waiting for app to be ready "
      for i in $(seq 1 20); do
        if check_app_running; then echo -e " ${GREEN}✅${RESET}"; break; fi
        echo -n "."; sleep 1
      done
      check_app_running || { echo -e "\n  ${RED}❌  App did not start. Check Docker.${RESET}"; exit 1; }
    else
      echo -e "  ${RED}❌  docker-compose.yml not found at $DOCKER_DIR${RESET}"
      exit 1
    fi
  fi
}

pick_file() {
  local prompt="$1" default="$2" varname="$3"
  echo -e "  ${BOLD}$prompt${RESET}"
  echo -e "  Default: ${CYAN}$default${RESET}"
  echo -n "  Press Enter to use default, or type a new path: "
  read -r input
  if [[ -z "$input" ]]; then
    eval "$varname=\"$default\""
  else
    eval "$varname=\"$input\""
  fi
  local val
  val=$(eval echo "\$$varname")
  if [[ ! -f "$val" ]]; then
    echo -e "  ${RED}❌  File not found: $val${RESET}"
    exit 1
  fi
  echo -e "  ${GREEN}✓  Using: $val${RESET}"
}

run_pipeline() {
  local ospf_file="$1" host_file="$2"
  echo ""
  echo -e "${BOLD}Running pipeline...${RESET}"
  echo -e "  OSPF file : ${CYAN}$(basename "$ospf_file")${RESET}"
  echo -e "  Host file : ${CYAN}$(basename "$host_file")${RESET}"
  echo ""
  bash "$TERM_DIR/workflow.sh" all \
    --ospf-file "$ospf_file" \
    --host-file "$host_file" \
    --base-url  "$BASE_URL"
}

# ── Main ──────────────────────────────────────────────────────────────────────
print_banner

# Show current defaults
echo -e "  ${BOLD}Current defaults:${RESET}"
echo -e "    OSPF file  →  ${CYAN}$(basename "$DEFAULT_OSPF")${RESET}  $([ -f "$DEFAULT_OSPF" ] && echo '✅' || echo '❌ NOT FOUND')"
echo -e "    Host file  →  ${CYAN}$(basename "$DEFAULT_HOST")${RESET}  $([ -f "$DEFAULT_HOST" ] && echo '✅' || echo '❌ NOT FOUND')"
echo ""
echo -e "  ${BOLD}What would you like to do?${RESET}"
echo ""
echo -e "  ${GREEN}[1]${RESET}  Run pipeline with DEFAULT files  (recommended)"
echo -e "  ${YELLOW}[2]${RESET}  Choose custom OSPF / host files, then run pipeline"
echo -e "  ${CYAN}[3]${RESET}  Start the app and open the Web UI only  (no pipeline)"
echo -e "  ${RED}[4]${RESET}  Exit"
echo ""
echo -n "  Your choice [1-4]: "
read -r choice

case "$choice" in

  1)
    echo ""
    echo -e "  ${GREEN}→ Using default files${RESET}"
    # Validate defaults exist
    [[ ! -f "$DEFAULT_OSPF" ]] && { echo -e "  ${RED}❌  OSPF file not found: $DEFAULT_OSPF${RESET}"; exit 1; }
    [[ ! -f "$DEFAULT_HOST" ]] && { echo -e "  ${RED}❌  Host file not found: $DEFAULT_HOST${RESET}"; exit 1; }
    ensure_app_running
    run_pipeline "$DEFAULT_OSPF" "$DEFAULT_HOST"
    echo ""
    echo -e "  ${GREEN}${BOLD}✅  Pipeline complete!${RESET}"
    echo -e "  ${CYAN}Open the Web UI → $BASE_URL/upload-ospf-isis-lsdb${RESET}"
    ;;

  2)
    echo ""
    OSPF_FILE="" HOST_FILE=""
    pick_file "OSPF database file:"  "$DEFAULT_OSPF" OSPF_FILE
    pick_file "Host mapping file:"   "$DEFAULT_HOST" HOST_FILE
    ensure_app_running
    run_pipeline "$OSPF_FILE" "$HOST_FILE"
    echo ""
    echo -e "  ${GREEN}${BOLD}✅  Pipeline complete!${RESET}"
    echo -e "  ${CYAN}Open the Web UI → $BASE_URL/upload-ospf-isis-lsdb${RESET}"
    ;;

  3)
    echo ""
    ensure_app_running
    echo ""
    echo -e "  ${CYAN}${BOLD}Topolograph Web UI is ready:${RESET}"
    echo -e "  ${CYAN}  Upload LSDB  →  $BASE_URL/upload-ospf-isis-lsdb${RESET}"
    echo -e "  ${CYAN}  Hostnames    →  $BASE_URL/ospf-host-to-dns-mapping${RESET}"
    echo -e "  ${CYAN}  API docs     →  $BASE_URL/api${RESET}"
    echo ""
    echo -e "  ${YELLOW}Tip:${RESET} After uploading via the UI, run the enrichment pipeline:"
    echo -e "       ${BOLD}./terminal-script/workflow.sh enrich-existing --graph-time <value>${RESET}"
    ;;

  4)
    echo -e "  ${YELLOW}Exiting.${RESET}"
    exit 0
    ;;

  *)
    echo -e "  ${RED}Invalid choice. Exiting.${RESET}"
    exit 1
    ;;
esac
