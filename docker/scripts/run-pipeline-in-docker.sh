#!/usr/bin/env bash
# =============================================================================
# docker/scripts/run-pipeline-in-docker.sh
# HOST-SIDE helper — triggers the pipeline inside the `pipeline` container
# =============================================================================
#
# PURPOSE
# ───────
# Convenience wrapper called from the HOST to exec into the pipeline container.
# All arguments are forwarded to docker-pipeline.sh inside the container.
#
# USAGE (from project root on host):
#   bash docker/scripts/run-pipeline-in-docker.sh
#   bash docker/scripts/run-pipeline-in-docker.sh --ospf-file=ospf-database-3b.txt
#   bash docker/scripts/run-pipeline-in-docker.sh --dry-run
#   bash docker/scripts/run-pipeline-in-docker.sh --no-push
#
# PRE-REQUISITE:
#   docker compose up -d    (all containers must be running)
#
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo ""
echo "  → Triggering pipeline inside 'pipeline' container..."
echo ""

docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec pipeline \
  bash /app/docker/scripts/docker-pipeline.sh "$@"
