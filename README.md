# OSPF Topology Graph Visualizer

A containerized OSPF network topology visualization and analysis platform with country-level aggregation, shortest path analysis, and interactive what-if scenario modeling.

## Features

- **OSPF Database Parser** - Import OSPF link-state database outputs
- **Dynamic Hostname Mapping** - Upload hostname-to-IP mappings via web UI
- **Country-Level Visualization** - Automatic country classification and color-coding
- **Network Topology Views** - AS-IS, Gateway-only, Enriched, and Collapsed modes
- **Layout Persistence** - Save and restore node positions per user/graph/view
- **Interactive UI** - Drag-and-drop, zoom, pan, filter, and collapse controls
- **Analysis Suite** - Six dedicated analysis pages under the Analysis navbar menu (see below)

## Analysis Suite

All six pages are accessible via **Navbar → Analysis** after login:

| Page | URL | What it does |
|------|-----|--------------|
| 🗺 **Cost Matrix** | `/cost-matrix` | Country-to-country reachability matrix with per-cell detail drawer. Click any cell to see full FWD and REV hop tables: router labels, country chips, per-hop link cost, cumulative cost, and country-chain summary. Supports Router View / Country View toggle and per-cell CSV export. |
| ⚡ **What-If Analysis** | `/what-if` | Model a single link cost change and instantly see which paths shift. Animated topology highlights old and new routes simultaneously. |
| 🛤 **K-Path Explorer** | `/path-explorer` | Enumerate up to K shortest paths between any two gateways using Yen's algorithm. Displays full hop sequences with cost breakdown. |
| 📋 **Change Planner** | `/change-planner` | Multi-row change plan (one row per link). Click **Analyse Impact** to compute before/after costs for every affected country pair. Click any row in the impact table to expand a **4-panel detail view**: Before FWD, Before REV, After FWD, After REV — each showing the full hop table (router, country chip, link cost, cumulative cost) and a country-chain summary strip. |
| 💥 **Impact Lab** | `/impact-lab` | Sweep a single link across a cost range and plot how many country pairs are affected at each cost level. |
| 🔀 **Topology Diff** | `/topo-diff` | Side-by-side diff of two graph snapshots. Highlights added, removed, and cost-changed links. |

### Hostname format required for country detection

All six analysis pages derive country, city, and router-role metadata from **A-type hostnames** in the form:

```
{country}-{city}-{metro}-{role}{num}
Examples: can-tor-kem-r1   fra-par-mar-r2   usa-nyc-man-r1
```

Nodes without A-type hostnames appear as `UNK` in the analysis pages. Upload a hostname-mapping CSV to apply labels before running analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  7 Core Services (Docker Compose)                      │
├─────────────────────────────────────────────────────────┤
│  webserver    → Nginx reverse proxy (port 8081)        │
│  flask        → Topolograph API + patched UI           │
│  mongodb      → Persistent graph storage               │
│  pipeline     → OSPF processing automation             │
│  layout-api   → Layout persistence service (FastAPI)   │
│  layout-db    → PostgreSQL layout storage              │
│  mcp-server   → AI/LLM Model Context Protocol          │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Git
- 4GB RAM minimum
- Ports 8081, 27018, 8001 available

### Installation

```bash
# Clone repository
git clone https://github.com/zumanm1/topologygraph_clone.git
cd topologygraph_clone

# Build and start all services
docker compose build
docker compose up -d

# Wait for initialization (30 seconds)
sleep 30

# Verify services
docker ps
curl -s http://localhost:8081/__security/health
```

**Note:** The repository includes a `.env` file with safe defaults. For production use, modify passwords in `.env` before running `docker compose up`.

### Access Application

Open browser to: **http://localhost:8081**

**Default credentials:**
- Email: `ospf@topolograph.com`
- Password: `ospf`

## How It Works

### 1. Data Upload Workflow

The application uses a **dynamic hostname upload workflow** - no static hostname mappings are stored in the repository.

```bash
# Upload OSPF database via Web UI
1. Navigate to http://localhost:8081
2. Click "Upload OSPF Database"
3. Select your OSPF database text file
4. Optionally upload hostname mapping CSV

# Or use the pipeline container
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh \
  --ospf-file=INPUT-FOLDER/ospf-database-54-unk-test.txt
```

### 2. Hostname Mapping Format

Create a CSV file with device IP to hostname mappings:

```csv
device_ip_address,device_name
9.9.9.1,can-tor-kem-r1
10.10.10.1,usa-nyc-man-r1
11.11.11.1,gbr-lon-wst-r1
```

**Hostname format:** `country-city-metro-router`
- `country`: 3-letter ISO code (e.g., USA, GBR, CAN, FRA)
- `city`: City abbreviation
- `metro`: Metro/district area
- `router`: Router identifier

**Without hostname mapping:** Nodes appear as "UNK" (unknown) country classification.

### 3. Processing Pipeline

```
OSPF Database → Parse → Enrich → Gateway Filter → Country Collapse → Visualize
     ↓              ↓         ↓           ↓              ↓              ↓
  Raw LSAs    Topology   Country    Core Links    Aggregated      Interactive
              Graph      Metadata    Only          View            UI
```

**Output folders** (generated on-demand, gitignored):
- `IN-OUT-FOLDER/` - Session data (nodes, edges, metadata)
- `OUTPUT/AS-IS/` - Raw topology
- `OUTPUT/GATEWAY/` - Gateway-only topology
- `OUTPUT/ENRICHED/` - Country-enriched topology
- `OUTPUT/COLLAPSING/` - Collapsed country views

### 4. Visualization Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **AS-IS** | Full router-level topology | Detailed network view |
| **Gateway** | Inter-country gateway links only | Core network backbone |
| **Enriched** | Country colors + metadata | Geographic analysis |
| **Collapsed** | Country-level aggregation | High-level overview |

### 5. Key Features

**Shortest Path Analysis**
- SPF (Dijkstra) algorithm for path calculations
- Cost matrix between all country pairs
- Minimum cost path selection (not sum)

**Analysis Suite** (Navbar → Analysis)
- Cost Matrix with FWD/REV hop-table detail drawer
- What-If Analysis with animated topology diff
- K-Path Explorer (Yen's K-shortest paths)
- Change Planner with 4-panel before/after impact detail
- Impact Lab (cost-sweep across a range)
- Topology Diff (snapshot comparison)

**Layout Persistence**
- Per-user, per-graph, per-view-mode
- Auto-save on node drag
- Restore on graph load
- PostgreSQL backend

## Test Data

The repository includes test input files in `INPUT-FOLDER/`:

```
INPUT-FOLDER/
  ospf-database-54-unk-test.txt    # 54-router test topology
  Load-hosts-metro-level.csv       # Sample hostname mappings
```

**Test topology:** 54 routers across 9 countries (CAN, USA, GBR, FRA, DEU, JPN, AUS, BRA, IND)

## Validation

Run the full validation suite:

```bash
# Build test container
docker compose --profile test build e2e-runner

# Start test container
docker compose --profile test up -d e2e-runner

# Run 127-check Playwright suite
docker compose exec -T e2e-runner bash /app/docker/scripts/docker-e2e.sh
```

**Validation coverage:**
- ✅ 127 Playwright E2E checks (core topology + analysis pages)
- ✅ 23 Change Planner path-detail checks (tests/29-change-planner-path-detail.cjs)
- ✅ 21 Cost Matrix detail-drawer checks (tests/28-cost-matrix-detail-drawer.cjs)
- ✅ 19 Layout persistence checks
- ✅ 17 Security validation checks
- ✅ 11 Country derivation checks

## Configuration

Environment variables in `.env`:

```bash
# Web UI
TOPOLOGRAPH_PORT=8081
TOPOLOGRAPH_WEB_API_USERNAME_EMAIL=ospf@topolograph.com
TOPOLOGRAPH_WEB_API_PASSWORD=ospf

# Database
MONGODB_DATABASE=admin
MONGODB_USERNAME=admin
MONGODB_PASSWORD=myadminpassword

# Layout Service
LAYOUT_DB_NAME=topolograph_layouts
LAYOUT_DB_USER=layout_user
LAYOUT_DB_PASSWORD=layout_password
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/__security/health` | GET | Health check |
| `/__security/upload-ospf` | POST | Upload OSPF database |
| `/__security/upload-hosts` | POST | Upload hostname mapping |
| `/__security/session-diagram/<graph_time>/nodes` | GET | Get topology nodes |
| `/__security/session-diagram/<graph_time>/edges` | GET | Get topology edges |
| `/layout-api/layouts` | GET/POST | Layout persistence |

## Troubleshooting

**Containers not starting:**
```bash
docker compose logs flask
docker compose logs webserver
```

**Reset everything:**
```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

**Check service health:**
```bash
curl http://localhost:8081/__security/health
docker ps --format "table {{.Names}}\t{{.Status}}"
```

## Development

**Rebuild after code changes:**
```bash
docker compose down
docker compose build
docker compose up -d
```

**View logs:**
```bash
docker compose logs -f flask
docker compose logs -f webserver
docker compose logs -f layout-api
```

**Run pipeline manually:**
```bash
docker compose exec pipeline bash
cd /app
bash docker/scripts/docker-pipeline.sh
```

## Documentation

- `docker/README.md` - Docker infrastructure details
- `READ2-INTSTAL.txt` - Full installation guide (fresh machine to running app)
- `DOCS/LOCAL_TOPOLOGRAPH_ACCESS.md` - Login URL and credential reference
- `DOCS/VALIDATION_AND_ARCHITECTURE.md` - Architecture deep-dive and validation commands
- `DOCS/api-token-guide.md` - Bearer token usage for API calls
- `AFRICAN-HOSTNAME-CLEANUP-COMPLETE.md` - Cleanup documentation

## License

See repository for license information.

## Credits

Built on [Topolograph](https://github.com/vadims06/topolograph) by Vadim Semenov.
