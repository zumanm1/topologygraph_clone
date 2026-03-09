# Docker Infrastructure — OSPF Country Topology

This folder contains the Docker build files and helper scripts for the
fully containerised OSPF Country Topology stack.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  docker-compose.yml  (project root)                             │
│                                                                 │
│  CORE SERVICES (7 total)                                        │
│  ─────────────────────────  ──────────────────────────────────  │
│  mongodb          [EXISTING] MongoDB 4.2 — persistent DB        │
│  flask            [PATCHED]  Topolograph Flask + Sprint 3 JS    │
│  mcp-server       [EXISTING] AI/LLM Model Context Protocol      │
│  webserver        [EXISTING] Nginx reverse proxy (port 8081)    │
│  pipeline         [NEW]      bash + Python pipeline runner       │
│  layout-api       [NEW]      FastAPI layout-persistence service  │
│  layout-db        [NEW]      PostgreSQL — per-user layout store  │
│                                                                 │
│  TEST-ONLY (--profile test)                                     │
│  e2e-runner                  Playwright (127 checks)            │
└─────────────────────────────────────────────────────────────────┘
```

New containers are `pipeline`, `layout-api`, and `layout-db`.
`pipeline` runs `workflow.sh all` — uploading OSPF data, fetching the
graph, enriching with country info, generating collapsing config, and
pushing colours to the Topolograph UI.
`layout-api` provides a FastAPI service for per-user, per-graph-time,
per-view-mode vis.js node position persistence backed by `layout-db`
(PostgreSQL, keyed by `owner_login + graph_id + graph_time + view_mode`).

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/zumanm1/topologygraph_clone.git
cd topologygraph_clone

# 2. Build and start all services
docker compose build
docker compose up -d

# 3. Wait for initialization
sleep 30

# 4. Verify services are running
docker ps
curl -s http://localhost:8081/__security/health

# 5. Open browser
#    http://localhost:8081/
#    Login: ospf@topolograph.com / ospf
```

### Optional: Run Validation Tests

```bash
# Start test container
docker compose --profile test up -d e2e-runner

# Run full E2E validation (127 checks)
docker compose exec -T e2e-runner bash /app/docker/scripts/docker-e2e.sh
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
# Using test fixtures from INPUT-FOLDER
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh \
  --ospf-file=INPUT-FOLDER/ospf-database-54-unk-test.txt \
  --host-file=INPUT-FOLDER/Load-hosts-metro-level.csv

# Without hostname mapping (nodes appear as UNK)
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh \
  --ospf-file=INPUT-FOLDER/ospf-database-54-unk-test.txt

# Dry run (skip upload)
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --dry-run

# Skip UI push
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh --no-push
```

Or use the host-side wrapper:
```bash
bash docker/scripts/run-pipeline-in-docker.sh
```

**Note:** The application uses a dynamic hostname upload workflow. Upload OSPF database and hostname mappings via the Web UI at http://localhost:8081 for interactive use.

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

## Running E2E Tests (127 Checks)

```bash
# Build the test image
docker compose --profile test build e2e-runner

# Start the e2e-runner container
docker compose --profile test up -d e2e-runner

# Run the full 127-check Playwright suite
docker compose exec -T e2e-runner bash /app/docker/scripts/docker-e2e.sh

# With a specific graph_time
docker compose exec -T e2e-runner bash /app/docker/scripts/docker-e2e.sh \
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
| `LAYOUT_DB_NAME` | `topolograph_layouts` | PostgreSQL database name for layout-db |
| `LAYOUT_DB_USER` | `layout_user` | PostgreSQL username for layout-api |
| `LAYOUT_DB_PASSWORD` | `layout_password` | **Change this in production** |
| `TOPOLOGRAPH_BOOTSTRAP_SECRET` | *(same as API password)* | One-time secret for credential bootstrap |
| `TOKEN_HASH_SECRET` | *(same as API password)* | HMAC secret for API bearer tokens |

---

## Networking

All core services share the `frontend` Docker network. Inside this network:

| Hostname | Port | Reachable by |
|----------|------|-------------|
| `flask` | 5000 | webserver, pipeline, e2e-runner |
| `webserver` | 8081 | pipeline, e2e-runner (via `BASE_URL`) |
| `mongodb` | 27017 | flask |
| `mcp-server` | 8000 | webserver (via Nginx proxy) |
| `layout-api` | 8090 | webserver (proxied at `/layout-api/*`) |
| `layout-db` | 5432 | layout-api only (backend network) |

The `pipeline` container uses `BASE_URL=http://webserver:8081` (not localhost)
to reach the Topolograph API. This is set automatically by docker-compose.yml.

---

## Validation Results

| Test | Result |
|------|--------|
| Pipeline 19-file output | ✅ 19/19 files created |
| Playwright deep E2E (127 checks) | ✅ 127 PASS / 0 FAIL / 0 WARN |
| Country-derivation regression (11 checks) | ✅ 11 PASS / 0 FAIL |
| Layout-persistence regression (19 checks) | ✅ 19 PASS / 0 FAIL (AUTO-LOAD / NAV-RELOAD / BTN-LOAD) |
| Security validation — Step 11 (17 checks) | ✅ 17 PASS / 0 FAIL / 0 WARN |
| Layout isolation — Step 11 (14 checks) | ✅ 14 PASS / 0 FAIL |
| All 7 core containers healthy | ✅ Verified with `docker compose ps` |
| Flask patched (Sprint 3 + layout-persistence) | ✅ topolograph.js + layout-persistence.js + base.html baked in |

### Run all validation suites

```bash
# Canonical full rebuild + deep E2E + regression checks
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh

# Security + layout-isolation (can run against live stack, no rebuild)
bash 11-STEP-BY-STEP-SECURITY/scripts/run-security-validation.sh

# Orchestrated: Steps 08 + 11 in sequence (canonical end-to-end)
bash 12-STEP-BY-STEP-ORCHESTRATED/scripts/run-orchestrated-validation.sh

# Web UI user-journey + feature-surface validation
bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```
