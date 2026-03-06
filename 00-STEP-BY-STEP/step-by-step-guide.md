# OSPF Country Topology — Step-by-Step Visual Guide

**App version:** Topolograph 2.57.2
**Date:** 2026-03-03
**Graph used:** `03Mar2026_17h30m46s_34_hosts` (34 routers, 10 countries)

> Each step has a matching screenshot in the `screenshots/` folder.
> Backend actions are shown as terminal commands with their output.

---

## PART A — LIFECYCLE: Stop → Rebuild → Start

---

### STEP A1 — Stop the App Completely

**What you do:**
```bash
docker compose down --remove-orphans
```

**What happens (backend):**
- Docker stops all 4 containers in reverse dependency order
- Networks are removed
- MongoDB data is preserved in Docker volumes (not deleted)

**Terminal output you will see:**
```
Container webserver  Stopped
Container flask      Stopped
Container mcp-server Stopped
Container mongodb    Stopped
Network frontend  Removed
```

**Script:** `00-STEP-BY-STEP/scripts/01-stop-app.sh`

---

### STEP A2 — Confirm the App is Off

**What you do:**
```bash
docker compose ps
curl -s http://localhost:8081
```

**Expected result:**
- `docker compose ps` → empty table (no containers)
- `curl` → connection refused or times out

**Script:** `00-STEP-BY-STEP/scripts/02-confirm-stopped.sh`

---

### STEP A3 — Rebuild (only when code has changed)

**When to run this:** After editing `topolograph.js`, or after a new upstream image is released.

**What you do:**
```bash
docker compose build --no-cache flask webserver pipeline  # rebuild patched images from scratch
```

**Backend actions:**
1. Docker rebuilds the patched `flask`, `webserver`, and `pipeline` images from the repo
2. `--no-cache` forces Docker to execute all image layers fresh
3. The rebuilt images contain the current repo's Docker customisations

**Script:** `00-STEP-BY-STEP/scripts/03-rebuild-app.sh`

---

### STEP A4 — Start the App

**What you do:**
```bash
docker compose up -d
```

**What happens (backend):**
1. MongoDB starts first (dependency)
2. Flask (Gunicorn/Python) starts — connects to MongoDB
3. `flask-create-creds-from-env` one-shot container runs — creates REST API user
4. Nginx webserver starts — proxies `/` → Flask, serves static JS/CSS
5. MCP server starts

**Wait:** ~10–15 seconds until `http://localhost:8081` responds

**Script:** `00-STEP-BY-STEP/scripts/04-start-app.sh`

---

### STEP A5 — Confirm the App is Running

**What you do:**
```bash
docker compose ps
curl -u ospf@topolograph.com:ospf http://localhost:8081/api/graph/
```

**Expected:**
```
NAME        STATUS     PORTS
pipeline    Up
flask       Up         5000/tcp
webserver   Up         0.0.0.0:8081->8081/tcp
mongodb     Up         0.0.0.0:27017->27017/tcp
mcp-server  Up         0.0.0.0:8000->8000/tcp
```
API returns JSON list of graphs (HTTP 200).

**Script:** `00-STEP-BY-STEP/scripts/05-confirm-running.sh`

---

## PART B — FULL WORKFLOW: Input → Countries → Colours → Output

---

### STEP B1 — Open the App

**URL:** `http://localhost:8081/upload-ospf-isis-lsdb`

**Screenshot:** `screenshots/01-A1-home-upload-page.png`

**What you see:**
- Navbar: Upload LSDB | Create topology | Devices | HOW TO | API
- Main area: File upload control for OSPF/IS-IS LSDB files
- Dropdown: previously uploaded graphs

**Teaching point:**
This page has two purposes: (1) upload new OSPF data, (2) load and visualise existing graphs.

---

### STEP B2 — Select the OSPF File

**Screenshot:** `screenshots/02-A2-ospf-file-selected.png`

**What you do in the UI:**
1. Click "Choose file" (or drag and drop)
2. Navigate to `INPUT-FOLDER/ospf-database-2.txt`
3. The filename appears next to the button

**What this file contains:**
Raw OSPF Link State Database output captured from a Cisco router — the "show ip ospf database detail" command output. This is the source of truth for the network topology.

**Key fields in the OSPF file:**
```
Link ID         ADV Router      Age  Seq#       Checksum  Link count
9.9.9.1         9.9.9.1          ...  (router LSA)
```

---

### STEP B3 — Upload (Backend: POST /api/graphs)

**Screenshot:** `screenshots/03-A3-after-file-upload.png`

**What you do:** Click "Load hosts" button

**Backend action:**
```
POST http://localhost:8081/api/graphs
Body: [{"lsdb_output": "<file contents>", "vendor_device": "Cisco", "igp_protocol": "ospf"}]
Auth: Basic ospf@topolograph.com:ospf
```

**Response:**
```json
{"graph_time": "03Mar2026_17h30m46s_34_hosts", "nodes": 34, "edges": 108}
```

**What Topolograph does internally:**
1. Parses the OSPF LSA entries using TextFSM templates
2. Builds a graph (nodes = routers, edges = OSPF adjacencies with costs)
3. Stores in MongoDB `graphs` collection
4. Returns `graph_time` — the unique identifier for this topology snapshot

---

### STEP B4 — Select Graph from Dropdown

**Screenshot:** `screenshots/04-A4-graph-selected-in-dropdown.png`

**What you do:**
1. In the `<select>` dropdown, choose the graph_time: `03Mar2026_17h30m46s_34_hosts`
2. Each entry shows: date, time, number of hosts

**Teaching point:**
`graph_time` is the primary key for everything in this pipeline. Every output file, every API call, every PATCH uses this identifier. Think of it as a "snapshot ID."

---

### STEP B5 — Load the Graph (vis.js renders)

**Screenshot:** `screenshots/05-A5-graph-raw-rendered.png`

**What you do:** Click "Load dynamic graph"

**What happens in the browser:**
1. AJAX call: `GET /api/diagram/{graph_time}/nodes` and `/edges`
2. vis.js Network library creates a physics-simulation force graph
3. 34 nodes appear as dots, 108 edges as lines with cost labels
4. Nodes are initially grey — no country data applied yet

**Teaching point:**
At this stage the topology is mathematically correct but visually unlabelled. You can already drag nodes, zoom, and pan. The country enrichment happens next.

---

### STEP B6 — Country Colours Applied (after pipeline push)

**Screenshot:** `screenshots/06-A6-graph-with-country-colours.png`

**What the pipeline did (terminal — already run):**
```bash
./terminal-script/workflow.sh all \
  --ospf-file INPUT-FOLDER/ospf-database-2.txt \
  --host-file INPUT-FOLDER/Load-hosts.txt
```

**How countries are assigned:**
1. `Load-hosts.txt` maps router IP → hostname
   ```
   18.18.18.1   zaf-cpt-r1
   18.18.18.2   zaf-cpt-r2
   15.15.15.1   gbr-lon-r1
   ```
2. First 3 characters of hostname = country code (ZAF, GBR, FRA…)
3. `push-to-ui.py` calls `PATCH /api/diagram/{gt}/nodes/{id}` for each router
4. Each node gets: `country`, `color.background`, `shape="dot"`, `size=14`

**Country palette (10 countries):**
| Country | Code | Colour |
|---------|------|--------|
| South Africa | ZAF | #2ecc71 (green) |
| United Kingdom | GBR | #3498db (blue) |
| France | FRA | #e74c3c (red) |
| Portugal | POR | #e67e22 (orange) |
| Tanzania | TAN | #9b59b6 (purple) |
| Kenya | KEN | #1abc9c (teal) |
| Mozambique | MOZ | #f39c12 (yellow) |
| DR Congo | DRC | #e91e63 (pink) |
| Lesotho | LES | #00bcd4 (cyan) |
| Djibouti | DJB | #ff5722 (deep orange) |

---

### STEP B7 — Country Filter Panel

**Screenshot:** `screenshots/07-A7-country-filter-panel.png`

**What you do:** Click **"🌍 Country Filter"** button (top-right of diagram)

**What appears:**
- List of all 10 countries with checkboxes
- Mode buttons: [Show Only] [Exclude]
- Action buttons: [Select All] [Select None] [Apply] [Reset]

**Teaching point:**
The Country Filter panel is custom code added to `topolograph.js`. It operates entirely in the browser — no server calls. It reads the `country` property injected into each vis.js node and shows/hides nodes accordingly.

---

### STEP B8 — Filter: Show Only ZAF

**Screenshot:** `screenshots/08-A8-filter-show-only-ZAF.png`

**What you do:**
1. Click [Select None] — uncheck all countries
2. Check ✓ ZAF only
3. Click [Show Only] mode
4. Click [Apply]

**Result:** Only South Africa's 8 routers remain visible:
```
zaf-cpt-r1, zaf-cpt-r2, zaf-prs-r1, zaf-mtz-r1,
zaf-mtb-r1, zaf-jnb-r1, zaf-jnb-r2, zaf-mtb-r2
```

**Backend action:** None — this is pure client-side JavaScript in the browser.

---

### STEP B9 — Filter: Exclude DRC

**What you do:**
1. Click [Select None]
2. Check ✓ DRC only
3. Click [Exclude] mode
4. Click [Apply]

**Result:** All 30 non-DRC routers are visible; the 4 DRC routers are hidden.

**Teaching point:**
Exclude mode is the inverse of Show Only. It is useful when you want to see the full picture but filter out a noisy cluster.

---

### STEP B10 — Reset Filter

**What you do:** Click [Reset]

**Result:** All 34 nodes restored, all colours visible, mode reset to "Show All."

---

### STEP B11 — View AS-IS Output Files

**Screenshot:** `screenshots/09-A11-output-asis-diagram.png`

**Location:** `OUTPUT/AS-IS/03Mar2026_17h30m46s_34_hosts/`

**Files:**
```
nodes.json          ← 34 routers with id, label, x, y, group, color
edges.json          ← 108 adjacencies with from, to, cost, label
meta.json           ← {areas: [0,1], protocol: "ospf", vendor: "Cisco"}
ospf-database.txt   ← original OSPF source file (exact copy of input)
```

**Teaching point:**
AS-IS is your audit trail. It is the unmodified graph exactly as Topolograph parsed it. Before any country enrichment. Use it to verify the topology is correct.

---

### STEP B12 — View GATEWAY Output Files

**Location:** `OUTPUT/GATEWAY/03Mar2026_17h30m46s_34_hosts/`

**Files:**
```
gateway-only-topology.yaml    ← only routers that connect countries
gateway-only-topology.json
country-core-summary.yaml     ← per-country: gateway count, connected countries
country-core-summary.json
```

**What a gateway router is:**
A router that has at least one OSPF adjacency to a router in a **different country**. These are the "border routers" of each country's OSPF domain.

**Example from country-core-summary.yaml:**
```yaml
ZAF:
  gateway_count: 2
  connected_to: [GBR, POR, MOZ]
GBR:
  gateway_count: 1
  connected_to: [FRA, ZAF]
```

---

### STEP B13 — View ENRICHED Output Files

**Location:** `OUTPUT/ENRICHED/03Mar2026_17h30m46s_34_hosts/`

**Files:**
```
original-topology-with-country.yaml   ← all 34 routers + country + colour
original-topology-with-country.json
country-mapping.csv                   ← router_id, hostname, country, is_gateway
country-palette.json                  ← {ZAF: "#2ecc71", GBR: "#3498db", ...}
```

**Teaching point:**
ENRICHED is the output most useful for further automation. `country-mapping.csv` can be imported into spreadsheets, NMS tools, or monitoring systems. `original-topology-with-country.json` can feed downstream network analysis tools.

---

### STEP B14 — Host Mapping Management

**Screenshot:** `screenshots/10-A12-host-mapping-page.png`

**URL:** `http://localhost:8081/ospf-host-to-dns-mapping`

**What you see:**
A table of router IP → hostname mappings stored in Topolograph's MongoDB.

**To update host mappings:**
- Upload a new CSV via this page's file input
- Or run: `./terminal-script/save-load-hosts.sh --from <file>`

---

### STEP B15 — REST API Documentation

**Screenshot:** `screenshots/11-A13-api-swagger-docs.png`

**URL:** `http://localhost:8081/api/ui/`

**Key endpoints shown:**
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/graphs | Upload new OSPF LSDB |
| GET | /api/graph/ | List all graphs |
| GET | /api/diagram/{gt}/nodes | Get all nodes for a graph |
| PATCH | /api/diagram/{gt}/nodes/{id} | Update a node (colour, country…) |
| GET | /api/diagram/{gt}/edges | Get all edges |

---

## QUICK COMMAND CHEATSHEET

```bash
# Start everything (interactive launcher)
./start.sh

# Stop
docker compose down

# Start (after stopping)
docker compose up -d

# Rebuild (after code changes)
docker compose build --no-cache flask webserver pipeline
docker compose up -d

# Run pipeline directly
./terminal-script/workflow.sh all \
  --ospf-file INPUT-FOLDER/ospf-database-2.txt \
  --host-file INPUT-FOLDER/Load-hosts.txt

# Show output files
./00-STEP-BY-STEP/scripts/07-show-outputs.sh

# Health check
./00-STEP-BY-STEP/scripts/05-confirm-running.sh
```

---

*Generated by the OSPF Country Topology pipeline. Screenshots in `screenshots/`.*
