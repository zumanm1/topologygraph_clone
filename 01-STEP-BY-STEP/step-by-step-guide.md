# OSPF Country Topology — Step-by-Step Visual Guide  (v01)

**App version:** Topolograph 2.57.2
**Date:** 2026-03-03
**Graph used:** `03Mar2026_20h05m03s_34_hosts` (34 routers, 10 countries)
**Output naming:** NEW self-identifying convention — `_AS-IS` / `_GATEWAY` / `_ENRICHED`

> **How to read this guide:**
> - Every step has a matching screenshot in `screenshots/`
> - Backend actions are shown as the actual terminal commands and API calls
> - Deeper teaching notes explain the *why*, not just the *what*
> - This guide supersedes `00-STEP-BY-STEP/step-by-step-guide.md`

---

## UNDERSTANDING THE SYSTEM BEFORE YOU START

```
┌──────────────────────────────────────────────────────────────────┐
│              OSPF COUNTRY TOPOLOGY ARCHITECTURE                   │
│                                                                   │
│  Cisco router                                                     │
│  "show ip ospf database detail"                                   │
│       │  ospf-database-2.txt (raw LSDB)                          │
│       ▼                                                           │
│  ┌─────────────────────────────┐                                  │
│  │   Topolograph (Docker)      │  ← Web UI + REST API            │
│  │   Flask + MongoDB + Nginx   │    http://localhost:8081         │
│  └──────────┬──────────────────┘                                  │
│             │  POST /api/graphs → graph_time created              │
│             │  GET  /api/diagram/{gt}/nodes+edges                 │
│             ▼                                                     │
│  ┌─────────────────────────────┐                                  │
│  │   Terminal Pipeline         │  ← topology-country-tool.sh     │
│  │   + Load-hosts.txt          │    maps router IP → country     │
│  └──────────┬──────────────────┘                                  │
│             │  Produces 3 output folders                          │
│             ▼                                                     │
│  OUTPUT/AS-IS/{gt}_AS-IS/       ← audit trail (raw)              │
│  OUTPUT/GATEWAY/{gt}_GATEWAY/   ← border routers only            │
│  OUTPUT/ENRICHED/{gt}_ENRICHED/ ← full enrichment                │
│             │                                                     │
│             │  push-to-ui.py reads ENRICHED_country-mapping.csv  │
│             │  PATCHes each node: country + colour + tooltip      │
│             ▼                                                     │
│  Topolograph Web UI shows coloured topology                       │
│  Country Filter panel lets you show/hide by country               │
└──────────────────────────────────────────────────────────────────┘
```

**The graph_time key:** `03Mar2026_20h05m03s_34_hosts`
This is the unique identifier for one topology snapshot. Every API call, output folder, and file uses it. Think of it as a "commit hash" for a network state.

---

## PART A — LIFECYCLE: Stop → Rebuild → Start

---

### STEP A1 — Stop the App Completely

**Screenshot:** `screenshots/01-A1-stop-confirmed.png`

**What you do:**
```bash
docker compose down --remove-orphans
```

**What happens (in shutdown order):**
1. `webserver` (Nginx) stops → HTTP immediately returns connection refused
2. `flask` (Gunicorn) stops → REST API goes offline
3. `mcp-server` stops → port 8000 closes
4. `mongodb` stops → database connection closed
5. Docker networks `frontend` and `backend` are removed
6. **MongoDB DATA IS PRESERVED** — graph data lives in Docker volumes, not containers

**Deeper teaching point:**
`--remove-orphans` cleans up any containers that were started but are no longer defined
in docker-compose.yml — for example, old one-shot containers like `flask-create-creds`.
Without it, ghost containers can accumulate over time.

**Script:** `scripts/01-stop-app.sh`

---

### STEP A2 — Confirm the App is Off

**Screenshot:** `screenshots/02-A2-confirm-stopped.png`

**What you do:**
```bash
docker compose ps      # → empty table (no containers listed)
curl -s http://localhost:8081   # → curl: (7) Failed to connect
```

**Expected state:**
```
NAME    IMAGE   COMMAND   SERVICE   CREATED   STATUS    PORTS
(empty — no containers running)
```

**Why confirm before rebuilding?**
Docker's build cache operates on image layers. If an old container from the same
image is still running, the build process won't rebuild shared layers — your
topolograph.js changes may silently not be included in the new image.

**Script:** `scripts/02-confirm-stopped.sh`

---

### STEP A3 — Rebuild (only when code has changed)

**Screenshot:** `screenshots/03-A3-rebuild-complete.png`

**When to run this:** After editing `topolograph.js`, or after a new upstream release.
**When to skip:** Plain restart with no code changes → go directly to Step A4.

**What you do:**
```bash
docker compose build --no-cache flask webserver pipeline   # rebuild patched images from scratch
```

**Why `--no-cache` matters:**
Without it, Docker reuses cached image layers. The Nginx layer that copies
`topolograph.js` into the image would be served from cache — the file on disk
may have changed, but the image would still contain the OLD version.
`--no-cache` forces every layer to execute fresh, including the COPY step.

**What gets baked into the webserver image:**
```
Dockerfile context:
  docker/
    flask/Dockerfile             → patched Flask image
    webserver/templates/         → Nginx config
    webserver/start-nginx.sh     → entrypoint script
    pipeline/Dockerfile          → pipeline runtime image
```

**Script:** `scripts/03-rebuild-app.sh`

---

### STEP A4 — Start the App

**Screenshot:** `screenshots/04-A4-start-confirmed.png`

**What you do:**
```bash
docker compose up -d
```

**Startup dependency chain:**
```
mongodb ──────────────────────────────► starts first
                                         ↓
flask  ──── depends_on: mongodb ────► starts when MongoDB is ready
                                         ↓
webserver ── depends_on: flask ─────► starts when Flask is ready
                                         ↓
pipeline ─── depends_on: webserver ─► waits for the app and runs on demand
                                         ↓
mcp-server ─────────────────────────► starts independently
```

**The `-d` flag:** "detached" — containers run in the background, your terminal is returned.

**Wait time:** ~10–15 seconds. The webserver starts quickly, but Flask + MongoDB
need a few seconds to complete their handshake.

**Script:** `scripts/04-start-app.sh`

---

### STEP A5 — Confirm the App is Running

**Screenshot:** `screenshots/05-A5-running-confirmed.png`

**What you do:**
```bash
docker compose ps
curl -u ospf@topolograph.com:ospf http://localhost:8081/api/graph/
```

**Expected container status:**
```
NAME         STATUS      PORTS
pipeline     Up
flask        Up          5000/tcp
webserver    Up          0.0.0.0:8081->8081/tcp
mongodb      Up          0.0.0.0:27017->27017/tcp
mcp-server   Up          0.0.0.0:8000->8000/tcp
```

**API response:** JSON array of saved graphs (HTTP 200).

**Understanding the port layout:**
- `:8081` → Nginx (public-facing, proxies everything)
- `:5000` → Flask (internal only, not exposed outside Docker network)
- `:27017` → MongoDB (exposed for local development/inspection)
- `:8000` → MCP server (model context protocol)

**Script:** `scripts/05-confirm-running.sh`

---

## PART B — FULL WORKFLOW: Input → Countries → Colours → Output

---

### STEP B1 — Open the Upload Page

**Screenshot:** `screenshots/06-B1-home-upload-page.png`

**URL:** `http://localhost:8081/upload-ospf-isis-lsdb`

**What you see:**
- Navbar: **Upload LSDB** | Create topology | Devices | HOW TO | API
- File upload control with vendor selector (Cisco / Juniper / etc.)
- Dropdown: previously uploaded graph snapshots

**Teaching point — this page has two roles:**
1. **Upload role:** Submit a new OSPF LSDB file → Topolograph parses and stores it
2. **Visualise role:** Select an existing graph from the dropdown → click Load

The same page handles both because Topolograph was designed as a single-purpose
network analysis tool — upload and visualisation are tightly coupled.

---

### STEP B2 — Select the OSPF File

**Screenshot:** `screenshots/07-B2-file-selected.png`

**What you do in the UI:**
1. Click "Cisco" radio button (vendor selection)
2. Click "Choose File"
3. Navigate to `INPUT-FOLDER/ospf-database-2.txt`
4. Filename appears next to the button

**What is in ospf-database-2.txt?**
This is the raw output of `show ip ospf database detail` on a Cisco router.
It contains all OSPF Link State Advertisements (LSAs) — the building blocks
of the topology. Topolograph parses these LSAs using TextFSM templates to
extract router IDs, interfaces, costs, and adjacencies.

**Key structure inside the file:**
```
Link ID         ADV Router      Age    Seq#       Checksum
18.18.18.1      18.18.18.1      ...    (Router LSA — declares adjacencies)
```

---

### STEP B3 — Upload (Backend: POST /api/graphs)

**Screenshot:** `screenshots/08-B3-after-upload.png`

**What you do:** Click "Load hosts" button

**Backend API call made:**
```http
POST http://localhost:8081/api/graphs
Authorization: Basic ospf@topolograph.com:ospf
Content-Type: application/json

[{
  "lsdb_output": "<full contents of ospf-database-2.txt>",
  "vendor_device": "Cisco",
  "igp_protocol": "ospf"
}]
```

**Response:**
```json
{"graph_time": "03Mar2026_20h05m03s_34_hosts", "nodes": 34, "edges": 108}
```

**What Topolograph does internally:**
1. Parses all Router LSAs using TextFSM → extracts router IDs + adjacencies
2. Builds a NetworkX graph (Python) — nodes are routers, edges are OSPF links
3. Stores the graph in MongoDB `graphs` collection with `graph_time` as key
4. Returns the `graph_time` — this is now the snapshot identifier for everything

**Deeper teaching point:**
`graph_time` is a human-readable timestamp string, not a UUID. The format is:
`DDMmmYYYY_HHhMMmSSs_NN_hosts`  e.g.  `03Mar2026_20h05m03s_34_hosts`
The `_34_hosts` suffix is the node count appended automatically.

---

### STEP B4 — Select Graph from Dropdown

**Screenshot:** `screenshots/09-B4-graph-selected.png`

**What you do:**
1. In the `<select id="dynamic_graph_time">` dropdown, choose the graph_time
2. The most recent entry is at the top
3. Each entry shows: date, time, node count

**Why the dropdown matters:**
Topolograph stores ALL uploaded graphs. If you ran the pipeline 20 times,
you have 20 snapshots. The dropdown lets you reload any historical state.
This is powerful for: comparing topologies before/after a network change.

---

### STEP B5 — Load the Graph (vis.js renders)

**Screenshot:** `screenshots/10-B5-graph-raw-rendered.png`

**What you do:** Click "Load dynamic graph" (`<input type="submit">`)

**What happens in the browser:**
```javascript
// Topolograph makes two AJAX calls:
GET /api/diagram/{graph_time}/nodes  → array of 34 node objects
GET /api/diagram/{graph_time}/edges  → array of 108 edge objects

// vis.js Network library initialises:
var nodes = new vis.DataSet(nodeData);
var edges = new vis.DataSet(edgeData);
var network = new vis.Network(container, {nodes, edges}, options);

// Physics simulation: Barnes-Hut algorithm positions nodes organically
```

**What you see:**
- 34 nodes as dots (grey at this point)
- 108 edges as lines with cost labels
- The graph is draggable, zoomable, pannable

**Teaching point — why grey?**
At this stage the nodes have their raw `color` from Topolograph's default palette.
The country colours are injected by the pipeline's `push-to-ui.py` step — they
were `PATCH`ed into the database when the pipeline ran. If you load a graph that
has already been enriched, the colours will already be correct.

---

### STEP B6 — Country Colours Applied (pipeline already pushed them)

**Screenshot:** `screenshots/11-B6-graph-with-country-colours.png`

**What the pipeline did (terminal — runs automatically via workflow.sh):**
```bash
# Step 1: topology-country-tool.sh assigned countries from Load-hosts.txt
# Step 2: push-to-ui.py called PATCH for each of 34 nodes

PATCH http://localhost:8081/api/diagram/03Mar2026_20h05m03s_34_hosts/nodes/1
Authorization: Basic ospf@topolograph.com:ospf
{
  "country":    "ZAF",
  "is_gateway": false,
  "hostname":   "zaf-cpt-r1",
  "color": {"background":"#FF8C42","border":"#CC6D28",
            "highlight":{"background":"#FFB380","border":"#FF8C42"},
            "hover":    {"background":"#FFB380","border":"#FF8C42"}},
  "title":  "<b>zaf-cpt-r1</b><br/>Country: <b>ZAF</b><br/>Gateway: false",
  "group":  "ZAF"
}
```

**How countries are determined (from Load-hosts.txt):**
```
18.18.18.1  →  zaf-cpt-r1  →  ZAF  (first 3 chars, uppercased)
15.15.15.1  →  gbr-lon-r1  →  GBR
16.16.16.1  →  fra-par-r1  →  FRA
```

**Country palette (10 countries, 34 routers):**
| Code | Country        | Colour     | Count |
|------|----------------|------------|-------|
| ZAF  | South Africa   | #FF8C42 🟠 | 8     |
| DRC  | D.R. Congo     | #4ECDC4 🩵 | 4     |
| MOZ  | Mozambique     | #45B7D1 🔵 | 4     |
| GBR  | United Kingdom | #4D96FF 💙 | 3     |
| FRA  | France         | #F77F00 🟡 | 3     |
| LES  | Lesotho        | #C77DFF 🟣 | 3     |
| POR  | Portugal       | #06D6A0 💚 | 3     |
| KEN  | Kenya          | #6BCB77 🟢 | 2     |
| TAN  | Tanzania       | #FFD93D 💛 | 2     |
| DJB  | Djibouti       | #FF6B6B 🔴 | 2     |

---

### STEP B7 — Country Filter Panel

**Screenshot:** `screenshots/12-B7-country-filter-panel-open.png`

**What you do:** Click **"🌍 Country Filter"** button (top-right of diagram)

**What appears:**
```
┌────────────────────────────────────┐
│  🌍 Country Filter            [✕]  │
│                                    │
│  [Select All]  [Select None]       │
│                                    │
│  ☑ DJB (2)   ☑ DRC (4)           │
│  ☑ FRA (3)   ☑ GBR (3)           │
│  ☑ KEN (2)   ☑ LES (3)           │
│  ☑ MOZ (4)   ☑ POR (3)           │
│  ☑ TAN (2)   ☑ ZAF (8)           │
│                                    │
│  Mode: [Show Only] [Exclude]       │
│  [Apply]                [Reset]    │
└────────────────────────────────────┘
```

**How this panel was built:**
The Country Filter panel is custom code added to `topolograph.js`. It is
NOT part of the upstream Topolograph application. It was engineered for this
pipeline. When a graph is loaded, `buildCountryFilterPanel()` scans all nodes
for their `country` property and dynamically generates the checkbox list.

**Important:** This panel operates 100% in the browser. No API calls are
made when you check/uncheck countries. Only [Apply] and [Reset] trigger
JavaScript that calls `nodes.update([...])` on the vis.js DataSet.

---

### STEP B8 — Filter: Show Only ZAF

**Screenshot:** `screenshots/13-B8-filter-show-only-ZAF.png`

**What you do:**
1. Click [Select None] — uncheck all 10 countries
2. Check ✓ ZAF only
3. Click [Show Only] mode button
4. Click [Apply]

**What happens in the browser (JavaScript):**
```javascript
const updates = nodes.get().map(n => ({
  id: n.id,
  hidden: n.country !== 'ZAF'   // hide everything that isn't ZAF
}));
nodes.update(updates);
network.fit();  // re-centre the view on visible nodes
```

**Result:** Only the 8 South African routers remain visible:
```
zaf-cpt-r1   zaf-cpt-r2   zaf-prs-r1   zaf-mtz-r1
zaf-mtb-r1   zaf-jnb-r1   zaf-jnb-r2   zaf-mtb-r2
```

**Backend action:** None. Pure client-side. No server call.

---

### STEP B9 — Filter: Exclude DRC

**Screenshot:** `screenshots/14-B9-filter-exclude-DRC.png`

**What you do:**
1. Click [Select None]
2. Check ✓ DRC only
3. Click [Exclude] mode button
4. Click [Apply]

**What happens in the browser:**
```javascript
const updates = nodes.get().map(n => ({
  id: n.id,
  hidden: n.country === 'DRC'   // hide only DRC
}));
nodes.update(updates);
```

**Result:** 4 DRC routers are hidden, 30 others remain visible.

**Teaching point — when to use Exclude vs Show Only:**
- **Show Only** → you want to focus on ONE group in isolation
- **Exclude** → you want to see everything EXCEPT one noisy group
Both modes produce complementary views of the same data.

---

### STEP B10 — Reset Filter

**Screenshot:** `screenshots/15-B10-filter-reset.png`

**What you do:** Click [Reset]

**What happens:**
```javascript
const updates = nodes.get().map(n => ({ id: n.id, hidden: false }));
nodes.update(updates);   // un-hide all nodes
// Reset mode buttons to default
```

**Result:** All 34 nodes visible, all colours restored, mode reset to "Show All."

---

### STEP B11 — Output Files: AS-IS Stage

**Screenshot:** `screenshots/16-B11-outputs-asis.png`

**Location:** `OUTPUT/AS-IS/03Mar2026_20h05m03s_34_hosts_AS-IS/`

**Files with AS-IS_ prefix:**
```
AS-IS_nodes.json         (2.5 KB)   → 34 routers: id, label, x, y, group, color
AS-IS_edges.json         (9.2 KB)   → 108 edges: from, to, cost (OSPF metric), label
AS-IS_meta.json          (386 B)    → {areas:[0,1], protocol:"ospf", vendor:"Cisco"}
AS-IS_ospf-database.txt  (60 KB)    → exact copy of the uploaded OSPF LSDB file
```

**Teaching point — AS-IS is your audit trail:**
Before any enrichment happens, before any country codes are assigned,
this folder captures exactly what Topolograph parsed from your OSPF file.
If you ever question whether the topology is correct, compare AS-IS_nodes.json
with your actual network documentation. This is ground truth.

**How files are named (self-identifying):**
- Subfolder: `03Mar2026_20h05m03s_34_hosts_AS-IS` → you know it's the AS-IS stage
- Files: `AS-IS_nodes.json` → you know it's an AS-IS file even outside its folder

---

### STEP B12 — Output Files: GATEWAY Stage

**Screenshot:** `screenshots/17-B12-outputs-gateway.png`

**Location:** `OUTPUT/GATEWAY/03Mar2026_20h05m03s_34_hosts_GATEWAY/`

**Files with GATEWAY_ prefix:**
```
GATEWAY_gateway-only-topology.yaml   (4.6 KB)  → border routers + links
GATEWAY_gateway-only-topology.json   (6.7 KB)  → same, JSON format
GATEWAY_country-core-summary.yaml    (2.0 KB)  → per-country stats
GATEWAY_country-core-summary.json    (2.9 KB)  → same, JSON format
```

**What is a gateway router?**
A router that has at least one OSPF adjacency (link) to a router in a
**different country**. These are the "border" or "edge" routers of each
country's OSPF domain.

**Example from GATEWAY_country-core-summary.yaml:**
```yaml
ZAF:
  gateway_count: 2
  connected_to: [GBR, POR, MOZ]
GBR:
  gateway_count: 1
  connected_to: [FRA, ZAF]
```

**Use case for the GATEWAY output:**
Feed it into a network management system (NMS) or monitoring tool to
automatically detect and alert on cross-country link failures. Only
gateway routers need to be monitored for inter-country reachability.

---

### STEP B13 — Output Files: ENRICHED Stage

**Screenshot:** `screenshots/18-B13-outputs-enriched.png`

**Location:** `OUTPUT/ENRICHED/03Mar2026_20h05m03s_34_hosts_ENRICHED/`

**Files with ENRICHED_ prefix:**
```
ENRICHED_country-mapping.csv                  (1.1 KB)  → router_id, hostname, country, is_gateway
ENRICHED_country-palette.json                 (2.7 KB)  → full colour spec per country
ENRICHED_original-topology-with-country.yaml  (9.0 KB)  → all 34 routers enriched
ENRICHED_original-topology-with-country.json  (13 KB)   → same, JSON format
```

**ENRICHED_country-mapping.csv structure:**
```csv
router_id,hostname,country_code,is_gateway
18.18.18.1,zaf-cpt-r1,ZAF,false
18.18.18.2,zaf-cpt-r2,ZAF,true
15.15.15.1,gbr-lon-r1,GBR,true
...
```

**ENRICHED_country-palette.json structure:**
```json
{
  "graph_time": "03Mar2026_20h05m03s_34_hosts",
  "palette": {
    "ZAF": {
      "background": "#FF8C42", "border": "#CC6D28",
      "highlight": {"background": "#FFB380", "border": "#FF8C42"},
      "hover":     {"background": "#FFB380", "border": "#FF8C42"}
    },
    ...
  },
  "countries": ["DJB","DRC","FRA","GBR","KEN","LES","MOZ","POR","TAN","ZAF"]
}
```

**Teaching point — ENRICHED is the richest output:**
This is what you would import into a spreadsheet, a monitoring system, a
CMDB (Configuration Management Database), or a reporting tool. The CSV gives
you a clean, structured view of which routers belong to which country and which
are border gateways — all derived automatically from the OSPF LSDB.

---

### STEP B14 — Host Mapping Page

**Screenshot:** `screenshots/19-B14-host-mapping-page.png`

**URL:** `http://localhost:8081/ospf-host-to-dns-mapping`

**What you see:**
A table showing all router IPs → hostnames stored in Topolograph's MongoDB.

**Why this page matters:**
The host file is the bridge between the raw OSPF topology (IP addresses) and
human-readable network identity (hostnames → countries). Without it, all nodes
would be labelled with raw IPs and assigned country "UNK" (Unknown).

**To update host mappings:**
Upload a CSV via this page's file input, or edit `INPUT-FOLDER/Load-hosts.txt`
and re-run the pipeline. The mapping takes effect on the next pipeline run.

---

### STEP B15 — REST API Documentation

**Screenshot:** `screenshots/20-B15-api-swagger-docs.png`

**URL:** `http://localhost:8081/api/ui/`

**Key endpoints (interactive Swagger UI):**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST   | /api/graphs | Upload new OSPF LSDB → creates graph_time |
| GET    | /api/graph/ | List all graphs for current user |
| GET    | /api/diagram/{gt}/nodes | Get all 34 nodes for a graph |
| PATCH  | /api/diagram/{gt}/nodes/{id} | Update node (colour, country, title…) |
| GET    | /api/diagram/{gt}/edges | Get all 108 edges |
| GET    | /api/diagram/{gt}/meta | Get graph metadata |

**The PATCH endpoint is the key integration point:**
Everything the pipeline pushes (country colours, hostnames, gateway flags)
goes through this PATCH endpoint. You could extend the pipeline to push
additional metadata — MPLS labels, latency data, monitoring status — by
adding more fields to the PATCH payload in `push-to-ui.py`.

---

## QUICK COMMAND CHEATSHEET

```bash
# ── Full lifecycle ────────────────────────────────────────────────────────────
bash 01-STEP-BY-STEP/scripts/01-stop-app.sh
bash 01-STEP-BY-STEP/scripts/02-confirm-stopped.sh
bash 01-STEP-BY-STEP/scripts/03-rebuild-app.sh   # skip if no code changes
bash 01-STEP-BY-STEP/scripts/04-start-app.sh
bash 01-STEP-BY-STEP/scripts/05-confirm-running.sh
bash 01-STEP-BY-STEP/scripts/06-run-pipeline.sh
bash 01-STEP-BY-STEP/scripts/07-show-outputs.sh

# ── Pipeline only (app already running) ──────────────────────────────────────
./terminal-script/workflow.sh all \
  --ospf-file INPUT-FOLDER/ospf-database-2.txt \
  --host-file INPUT-FOLDER/Load-hosts.txt

# ── Health check ─────────────────────────────────────────────────────────────
bash 01-STEP-BY-STEP/scripts/05-confirm-running.sh

# ── Interactive launcher ─────────────────────────────────────────────────────
./start.sh          # menu: [1] default files / [2] custom / [3] UI only

# ── Verify output files (new naming) ─────────────────────────────────────────
ls OUTPUT/AS-IS/*_AS-IS/
ls OUTPUT/GATEWAY/*_GATEWAY/
ls OUTPUT/ENRICHED/*_ENRICHED/
```

---

## COMPARISON: 00-STEP-BY-STEP vs 01-STEP-BY-STEP

| Feature | 00-STEP-BY-STEP | 01-STEP-BY-STEP |
|---------|----------------|----------------|
| Output folder suffix | None (`/03Mar2026_17h30m46s_34_hosts/`) | `_AS-IS` / `_GATEWAY` / `_ENRICHED` |
| Output file prefix | None (`nodes.json`) | `AS-IS_` / `GATEWAY_` / `ENRICHED_` |
| Self-identifying files | ❌ Need folder context | ✅ File carries its own identity |
| push-to-ui.py reads | `country-mapping.csv` | `ENRICHED_country-mapping.csv` |
| palette written as | `country-palette.json` | `ENRICHED_country-palette.json` |
| Architecture diagram | ❌ Not included | ✅ Included at top |
| API calls shown | Partial | ✅ Every backend call documented |
| JavaScript internals | Not shown | ✅ vis.js code snippets included |

---

*Generated by the OSPF Country Topology pipeline v01. Screenshots in `screenshots/`.*
*For questions: see `aa-how-to-use-the-app.txt` or run `scripts/05-confirm-running.sh`.*
