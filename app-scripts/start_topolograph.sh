#!/usr/bin/env bash
# Start Topolograph locally via Docker. Run from repo root or this script's dir.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT/topolograph-docker"

echo "Pulling images..."
docker compose pull

echo "Starting Topolograph (flask, mongodb, webserver, mcp-server)..."
docker compose up -d

echo "Waiting for Topolograph to be reachable at http://localhost:8081 ..."
BASE_URL="${TOPOLOGRAPH_BASE_URL:-http://localhost:8081}"
for i in {1..60}; do
  if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/" | grep -q 200; then
    echo "Topolograph is up at $BASE_URL"
    exit 0
  fi
  sleep 5
done
echo "Timeout waiting for Topolograph. Check: docker compose -f $PROJECT_ROOT/topolograph-docker/docker-compose.yml logs -f"
exit 1
