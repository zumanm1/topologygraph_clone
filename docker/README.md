# Docker Infrastructure — OSPF Country Topology

This folder contains the Docker build files and helper scripts for the
fully containerised OSPF Country Topology stack.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  docker-compose.yml  (project root)                             │
│                                                                 │
│  CORE SERVICES (5)          ROLE                                │
│  ─────────────────────────  ──────────────────────────────────  │
│  mongodb          [EXISTING] MongoDB 4.2 — persistent DB        │
│  flask            [PATCHED]  Topolograph Flask + Sprint 3 JS    │
│  mcp-server       [EXISTING] AI/LLM Model Context Protocol      │
│  webserver        [EXISTING] Nginx reverse proxy (port 8081)    │
│  pipeline         [NEW ★]    bash + Python pipeline runner       │
│                                                                 │
│  TEST-ONLY (--profile test)                                     │
│  e2e-runner                  Playwright 1.58.2 (114 checks)     │
└─────────────────────────────────────────────────────────────────┘
```

The single **new** container is `pipeline`. It runs `workflow.sh all` —
uploading OSPF data, fetching the graph, enriching with country info,
generating collapsing config, and pushing colours to the Topolograph UI.

---

## Quick Start

```bash
# 1. Copy environment config
cp .env.example .env          # edit passwords if needed

# 2. Build custom images (flask, webserver, pipeline)
docker compose build

# 3. Start all 5 core services
docker compose up -d

# 4. Verify containers are up
docker ps
#  NAMES       STATUS        PORTS
#  pipeline    Up X seconds
#  webserver   Up X seconds  0.0.0.0:8081->8081/tcp
#  flask       Up X seconds  5000/tcp
#  mongodb     Up X seconds  0.0.0.0:27017->27017/tcp
#  mcp-server  Up X seconds  0.0.0.0:8000->8000/tcp

# 5. Run the pipeline
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh

# 6. Open browser
#    http://localhost:8081/
#    Login: ospf@topolograph.com / ospf
```

---

## Folder Structure

```
docker/
  pipeline/
    Dockerfile            python:3.11-slim + bash + gawk + curl + jq + requests + pyyaml
  flask/
    Dockerfile            FROM vadims06/topolograph:latest + patched JS + navbar
  webserver/
    Dockerfile            nginx:latest + envsubst
    templates/
      app.conf.template   Nginx upstream config (flask:5000, mcp-server:8000)
    start-nginx.sh        envsubst + nginx startup
  e2e-runner/
    Dockerfile            node:18-slim + Playwright (browser at runtime)
    package-bootstrap.json
  scripts/
    docker-pipeline.sh    Run pipeline INSIDE the pipeline container
    docker-e2e.sh         Run E2E suite INSIDE the e2e-runner container
    run-pipeline-in-docker.sh  HOST wrapper for docker compose exec pipeline
    run-e2e-in-docker.sh       HOST wrapper for docker compose exec e2e-runner
  README.md               This file
```

---

## Running the Pipeline

```bash
# Default (ospf-database-3.txt + Load-hosts.txt)
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh

# With different OSPF file
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh \
  --ospf-file=ospf-database-3b.txt

# Dry run (skip upload)
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --dry-run

# Skip UI push
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --no-push
```

Or use the host-side wrapper:
```bash
bash docker/scripts/run-pipeline-in-docker.sh
```

### Output files (on host)

The project root is bind-mounted into the pipeline container at `/app`,
so all output files land on the host:

```
IN-OUT-FOLDER/{graph_time}/
  meta.json, nodes.json, edges.json, edges.csv          (4 files)

OUTPUT/AS-IS/{graph_time}_AS-IS/
  AS-IS_nodes.json, AS-IS_edges.json, AS-IS_meta.json
  AS-IS_ospf-database.txt                               (4 files)

OUTPUT/GATEWAY/{graph_time}_GATEWAY/
  GATEWAY_gateway-only-topology.json/.yaml
  GATEWAY_country-core-summary.json/.yaml               (4 files)

OUTPUT/ENRICHED/{graph_time}_ENRICHED/
  ENRICHED_country-mapping.csv
  ENRICHED_country-palette.json
  ENRICHED_original-topology-with-country.json/.yaml   (4 files)

OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/
  COLLAPSING_country-collapse-config.json
  COLLAPSING_collapsed-topology.json/.yaml             (3 files)

TOTAL: 19 files + 54 PATCH calls to Topolograph API
```

---

## Running E2E Tests (114 Checks)

```bash
# Build the test image
docker compose --profile test build e2e-runner

# Start the e2e-runner container
docker compose --profile test up -d e2e-runner

# Run the full 114-check Playwright suite
docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh

# With a specific graph_time
docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh \
  --graph-time=06Mar2026_06h29m38s_54_hosts
```

**First run**: Chromium (~180MB) is downloaded into the `playwright-browsers`
Docker volume. Subsequent runs use the cached binary (no re-download).

---

## Environment Variables (.env)

| Variable | Default | Purpose |
|----------|---------|---------|
| `TOPOLOGRAPH_PORT` | `8081` | External port for Nginx webserver |
| `MCP_PORT` | `8000` | External port for MCP server |
| `MONGODB_DATABASE` | `admin` | MongoDB database name |
| `MONGODB_USERNAME` | `admin` | MongoDB root username |
| `MONGODB_PASSWORD` | `myadminpassword` | **Change this in production** |
| `TOPOLOGRAPH_WEB_API_USERNAME_EMAIL` | `ospf@topolograph.com` | API / UI login email |
| `TOPOLOGRAPH_WEB_API_PASSWORD` | `ospf` | API / UI login password |
| `TOPOLOGRAPH_WEB_API_AUTHORISED_NETWORKS` | `127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | API allow-list |

---

## Networking

All core services share the `frontend` Docker network. Inside this network:

| Hostname | Port | Reachable by |
|----------|------|-------------|
| `flask` | 5000 | webserver, pipeline, e2e-runner |
| `webserver` | 8081 | pipeline, e2e-runner (via `BASE_URL`) |
| `mongodb` | 27017 | flask |
| `mcp-server` | 8000 | webserver (via Nginx proxy) |

The `pipeline` container uses `BASE_URL=http://webserver:8081` (not localhost)
to reach the Topolograph API. This is set automatically by docker-compose.yml.

---

## Validation Results

| Test | Result |
|------|--------|
| Pipeline 19-file output | ✅ 19/19 files created |
| Playwright E2E (114 checks) | ✅ 114 PASS / 0 FAIL / 2 WARN (expected) |
| All 5 containers healthy | ✅ Verified with `docker ps` |
| Flask patched (Sprint 3) | ✅ topolograph.js + base.html baked in |
