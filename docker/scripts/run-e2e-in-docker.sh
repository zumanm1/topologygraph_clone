#!/usr/bin/env bash
# =============================================================================
# docker/scripts/run-e2e-in-docker.sh
# HOST-SIDE helper — triggers the Playwright suite inside the `e2e-runner`
# =============================================================================
#
# PURPOSE
# ───────
# Convenience wrapper called from the HOST to exec into the e2e-runner container.
# All arguments are forwarded to docker-e2e.sh inside the container.
#
# USAGE (from project root on host):
#   bash docker/scripts/run-e2e-in-docker.sh
#   bash docker/scripts/run-e2e-in-docker.sh --graph-time=05Mar2026_10h41m58s_54_hosts
#   bash docker/scripts/run-e2e-in-docker.sh --skip-phase1
#
# PRE-REQUISITE:
#   docker compose up -d    (all containers must be running)
#   # Also run pipeline first so graph_time exists in IN-OUT-FOLDER
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo "  → Triggering E2E suite inside 'e2e-runner' container..."
echo ""

docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec e2e-runner \
  bash /app/docker/scripts/docker-e2e.sh "$@"
