# 07-STEP-BY-STEP — Complete Walkthrough
## From New OSPF File to Fully Enriched Graph in the Web UI

> **Learning objective**: Understand every step the system takes when you
> introduce a brand-new OSPF database file and a new hostname mapping file.
> By the end you will be able to run this pipeline for any future OSPF file
> without assistance.

---

## Prerequisites

Before starting, confirm the following are available:

```bash
# 1. Docker is running
docker ps | grep flask       # must show the Topolograph flask container

# 2. Node.js ≥ 18
node --version               # must print v18.x or higher

# 3. Playwright installed
ls tests/node_modules/playwright 2>/dev/null || echo "run: cd tests && npm install"

# 4. Python 3 with requests
python3 -c "import requests; print('OK')"

# 5. Your two new input files exist
ls INPUT-FOLDER/ospf-database-3b.txt   # OSPF LSDB text
ls INPUT-FOLDER/Load-hosts-3b.txt      # hostname mapping
```

If Playwright is not installed:
```bash
cd tests && npm install && npx playwright install chromium && cd ..
```

---

## Overview: The Six Stages

```
STAGE 0 ─ Prepare INPUT-FOLDER
STAGE 1 ─ Upload OSPF file → Topolograph (Web UI or API)
STAGE 2 ─ Fetch raw graph → IN-OUT-FOLDER  (automatic)
STAGE 3 ─ Enrich topology → OUTPUT/        (automatic)
STAGE 4 ─ Push colours → Topolograph UI    (automatic)
STAGE 5 ─ Explore the graph in the browser
```

Stages 1–4 are executed by a **single command**.
Stages 0 and 5 require you to act directly.

---

## STAGE 0 — Prepare INPUT-FOLDER

Your two input files are already in place:

```
INPUT-FOLDER/
├── ospf-database-3b.txt   ← 2768 lines, 54 routers (copy of ospf-database-3.txt)
└── Load-hosts-3b.txt      ← 56 lines, 34 named entries (copy of Load-hosts.txt)
```

### Understanding the host file format

Open `INPUT-FOLDER/Load-hosts-3b.txt` in any text editor. It looks like this:

```
# Lines starting with # are comments and are ignored
# Format: <router-IP>   <hostname>

1.1.1.1     zaf-cpt-r1
1.1.1.2     zaf-cpt-r2
1.1.1.3     zaf-jhb-r3
...
9.9.9.1     les-mar-r1
...
# Routers NOT listed here will be classified as country=UNK (grey)
```

**How country codes are derived from hostnames:**

| Hostname prefix | Country Code | Colour |
|-----------------|-------------|--------|
| `zaf-` | ZAF | orange |
| `drc-` | DRC | teal |
| `moz-` | MOZ | blue |
| `ken-` | KEN | green |
| `tan-` | TAN | yellow |
| `les-` | LES | purple |
| `djb-` | DJB | red |
| `gbr-` | GBR | blue-2 |
| `fra-` | FRA | orange-2 |
| `por-` | POR | green-2 |
| (not in file) | UNK | grey |

With 34 entries in `Load-hosts-3b.txt` and 54 routers in the OSPF file,
**20 routers will be classified as UNK** (the 19.x, 20.x, 21.x, 22.x
IP ranges which have no hostname entry).

---

## STAGE 1–4 — Run the Full Pipeline (One Command)

This is the core command. Run it from the project root:

```bash
bash terminal-script/workflow.sh all \
  --ospf-file INPUT-FOLDER/ospf-database-3b.txt \
  --host-file INPUT-FOLDER/Load-hosts-3b.txt
```

### What happens, line by line

#### Step 1 — Upload OSPF file

```
[workflow] STEP: Upload OSPF database → Topolograph
[workflow] File: /path/to/INPUT-FOLDER/ospf-database-3b.txt
[workflow] Uploaded. graph_time=05Mar2026_18h30m00s_54_hosts
```

The script sends the entire content of `ospf-database-3b.txt` to:
```
POST http://localhost:8081/api/graphs
Body: [{ "lsdb_output": "<file contents>",
         "vendor_device": "Cisco",
         "igp_protocol": "ospf" }]
```

Topolograph parses the LSDB, builds a graph, and returns a `graph_time`
timestamp. This timestamp becomes the **key** for every subsequent step.
Write it down — you can use it to reload the graph at any time.

> **Why graph_time?** It's a human-readable timestamp (date + time + node
> count) that uniquely identifies each uploaded graph. Multiple uploads of
> the same file get different graph_times because they happen at different
> moments. This lets you keep a full history of uploads.

#### Step 2 — Fetch raw graph to IN-OUT-FOLDER

```
[fetch-from-api] Saving to: IN-OUT-FOLDER/05Mar2026_18h30m00s_54_hosts
[fetch-from-api]   meta.json saved
[fetch-from-api]   nodes.json saved (54 nodes)
[fetch-from-api]   edges.json saved (148 edges)
[fetch-from-api]   edges.csv saved
[fetch-from-api] Done. graph_time=05Mar2026_18h30m00s_54_hosts
```

Three REST API calls:
```
GET /api/graph/{graph_time}              → meta.json
GET /api/diagram/{graph_time}/nodes     → nodes.json (54 entries)
GET /api/diagram/{graph_time}/edges     → edges.json (148 entries)
```
Then a Python one-liner converts `edges.json` → `edges.csv`.

This creates your permanent snapshot of the **raw, unmodified** graph.

#### Step 3 — Run terminal pipeline (country enrichment)

```
[workflow] Edge source: OSPF file (ospf-database-3b.txt)
[topology-tool] Done. Files written to: OUTPUT/.tmp_work_05Mar2026_18h30m00s_54_hosts
  - country-mapping.csv
  - gateway-only-topology.json/.yaml
  - country-core-summary.json/.yaml
  - original-topology-with-country.json/.yaml
```

The `topology-country-tool.sh` script does the heavy lifting:

**Sub-step 3a — Parse OSPF file (awk)**
```
awk scans ospf-database-3b.txt for:
  "Advertising Router: X.X.X.X"   → each router
  "point-to-point"                 → each link type
  "Neighboring Router ID: Y.Y.Y.Y" → link destination
  "TOS 0 Metrics: 100"             → link cost
```

**Sub-step 3b — Load host map**
```
Reads Load-hosts-3b.txt
Normalises to: router_id, hostname
Auto-detects format: TXT (space-separated)
```

**Sub-step 3c — Build enriched model**
```
For each router in edge list:
  Look up router_id in host map
  If found:  country = first 3 chars of hostname, UPPERCASE
  If not found: country = UNK
  If router has neighbours in >1 country: is_gateway = true
  Else: is_gateway = false (core router)
```

**Sub-step 3d — Write outputs**
```
AS-IS:    copy nodes.json, edges.json, meta.json from IN-OUT-FOLDER
GATEWAY:  write gateway-only-topology (32 nodes, ~90 edges)
ENRICHED: write country-mapping.csv + original-topology-with-country.*
```

#### Step 4 — Generate COLLAPSING stage

```
[collapse-config] Country split: 11 countries, 54 total, 32 gateways, 22 cores
[collapse-config] Wrote COLLAPSING_country-collapse-config.json
[collapse-config] Collapsed topology: 32 gateway nodes, 90 gateway edges
[collapse-config] Wrote COLLAPSING_collapsed-topology.json
```

`generate-collapse-config.py` reads the ENRICHED output and produces:
- A **config JSON** describing which nodes are gateways vs cores per country
- A **collapsed topology JSON** used by vis.js in COLLAPSING view mode

#### Step 5 — Push colours to Topolograph UI

```
[push-to-ui] 54 routers mapped to countries
[push-to-ui] Countries: DJB:2 | DRC:4 | FRA:3 | GBR:3 | KEN:2 | LES:3 | MOZ:4 | POR:3 | TAN:2 | UNK:20 | ZAF:8
[push-to-ui] 54 nodes in graph
[push-to-ui] Patched: 54 OK  |  0 FAILED  |  0 skipped
```

One PATCH call per node:
```
PATCH /api/diagram/{graph_time}/nodes/{node_id}
Body: {
  "color": { "background": "#FF8C42", "border": "#CC6D28", ... },
  "country": "ZAF",
  "is_gateway": true,
  "hostname": "zaf-jhb-gw1",
  "label": "zaf-jhb-gw1\n1.1.1.3",
  "title": "<b>zaf-jhb-gw1</b><br>IP: 1.1.1.3<br>Country: ZAF<br>Gateway: Yes"
}
```

After all 54 PATCHes complete, the graph in Topolograph is fully enriched.

### Final workflow output

```
╔══════════════════════════════════════════════════════════════╗
║               WORKFLOW COMPLETE                              ║
╠══════════════════════════════════════════════════════════════╣
║  graph_time : 05Mar2026_18h30m00s_54_hosts                   ║
╠══════════════════════════════════════════════════════════════╣
║  OUTPUT FOLDERS:                                             ║
║  AS-IS      → OUTPUT/AS-IS/05Mar2026_18h30m00s_54_hosts_AS-IS/    ║
║  GATEWAY    → OUTPUT/GATEWAY/05Mar2026_18h30m00s_54_hosts_GATEWAY/ ║
║  ENRICHED   → OUTPUT/ENRICHED/05Mar2026_18h30m00s_54_hosts_ENRICHED/ ║
║  COLLAPSING → OUTPUT/COLLAPSING/05Mar2026_18h30m00s_54_hosts_COLLAPSING/ ║
╚══════════════════════════════════════════════════════════════╝
```

---

## STAGE 5 — Explore the Graph in the Web UI

Open your browser: **http://localhost:8081/**

### Step 5a — Login

| Field | Value |
|-------|-------|
| Email | `ospf@topolograph.com` |
| Password | `ospf` |

### Step 5b — Load your graph

Navigate to **Upload LSDB** (top navbar) or stay on the home page.

In the **"Choose one out of N saved graphs"** dropdown, select your
`graph_time`: `05Mar2026_18h30m00s_54_hosts`

Click **"Load dynamic graph"**.

The graph will render with 54 coloured nodes.

### Step 5c — Explore the five view modes

The toolbar buttons control which nodes are visible:

| Button | View Mode | What You See |
|--------|-----------|-------------|
| AS-IS | All routers, raw IP labels | 54 grey nodes |
| ENRICHED | All routers, country colours | 54 coloured nodes (10 colours + grey UNK) |
| GATEWAY | Border routers only | 32 coloured nodes, 22 cores hidden |
| CURRENT | Currently selected topology | Depends on last selection |
| COLLAPSING | Country-collapse panel | Collapse ZAF or any country to a single node |

### Step 5d — Use the Analysis features (navbar)

Click **"Analysis"** in the top navbar (added in the previous session):

**🗺 Cost Matrix**
- Click "Analysis → Cost Matrix"
- A 11×11 heat-map opens (one row/column per country)
- Hover a cell to see the Dijkstra shortest path
- Click a cell to highlight that path on the graph
- Click ⬇ Excel to download the matrix as an Excel file
- Click ↺ to rebuild the matrix after a What-If change

**⚡ What-If Analysis**
- Click "Analysis → What-If Analysis"
- Select any edge from the dropdown (74 edges available)
- Change the cost (e.g. from 100 to 1)
- Click "Run Analysis" — see how many country-pairs are affected + Risk score
- Click "Apply Change" — the vis.js graph updates live
- The Cost Matrix auto-refreshes (↺ verified by E2E tests in 06-STEP-BY-STEP)

### Step 5e — Upload hostname CSV (optional, in-UI)

Navigate to **Devices → Hostnames** (top navbar).

You can update node labels directly in the UI by:
1. Selecting the graph_time from the dropdown
2. Clicking **Load hosts**
3. Editing hostname fields manually, OR
4. Clicking **CSV Import hosts** and uploading `Input-FOLDER/Load-hosts-3b.txt`
5. Clicking **Update hostnames on the graph**

---

## Alternative: Re-Enrich an Already-Uploaded Graph

If you uploaded the file via the web UI manually (not via `workflow.sh`),
use the `enrich-existing` sub-command to skip the upload step:

```bash
# Find the graph_time of your manually-uploaded graph
# (shown in the Upload LSDB dropdown)

bash terminal-script/workflow.sh enrich-existing \
  --graph-time 05Mar2026_18h30m00s_54_hosts \
  --host-file  INPUT-FOLDER/Load-hosts-3b.txt
```

This runs Steps 2–5 only (no upload). Useful when:
- You uploaded via the web UI
- You changed `Load-hosts-3b.txt` and want to re-enrich without re-uploading
- You want to try a different host file on the same graph

---

## Promoting the Host File to Canonical (Optional)

If you want `Load-hosts-3b.txt` to become the new default host file
(so you don't have to pass `--host-file` every time):

```bash
bash terminal-script/save-load-hosts.sh --from INPUT-FOLDER/Load-hosts-3b.txt
```

This copies `Load-hosts-3b.txt` → `Load-hosts.txt` (after making a
`.bak` backup of the previous canonical file). After this, running:

```bash
bash terminal-script/workflow.sh all \
  --ospf-file INPUT-FOLDER/ospf-database-3b.txt
```

(no `--host-file` needed — picks up `Load-hosts.txt` automatically)

---

## Running the Full E2E Validation (06-STEP-BY-STEP Reference)

After the pipeline runs, you can validate the UI with the Playwright
test suite. Reference the 06-STEP-BY-STEP documentation for the full
test architecture. For this session's graph_time:

```bash
# Phase 0 (pre-flight) + Phase 1 (JSON integrity) + Phase 3 (Playwright)
bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh \
  --graph-time=05Mar2026_18h30m00s_54_hosts

# Or run a fresh pipeline THEN validate:
bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh --run-pipeline-db3
```

Expected result: **114/114 checks pass, 0 failures**.

See `06-STEP-BY-STEP/docs/HOW-TO-REPEAT.md` for the complete test
breakdown, screenshot list, and troubleshooting guide.

---

## Troubleshooting

### "No --ospf-file provided; skipping upload"
You ran `workflow.sh all` without `--ospf-file` and `ospf-database-3b.txt`
is not in the auto-detect chain. Solution: always pass the flag explicitly
when using a non-default filename.

### "0 nodes loaded" in the UI
The graph uploaded but the Playwright test or page shows 0 nodes. Usually
means the graph_time dropdown selection did not trigger. Hard-reload the
page (`Cmd+Shift+R`) and select the graph_time manually.

### "54 nodes but country colours missing"
`push-to-ui.py` did not run (e.g. used `--no-push`). Re-run:
```bash
python3 terminal-script/push-to-ui.py \
  --graph-time 05Mar2026_18h30m00s_54_hosts
```

### "UNK nodes showing wrong count"
The host file used during `topology-country-tool.sh` determines UNK count.
With 34 entries in `Load-hosts-3b.txt` and 54 routers, expect exactly 20 UNK.
If the count is wrong, check which host file was actually used:
```bash
grep "Edge source\|host.file" workflow.log 2>/dev/null
```

### "Cost Matrix shows empty UNK row"
Known behaviour: UNK hub routers connect to named-country gateways but the
Dijkstra APSP may not compute costs to/from UNK if UNK gateways are
treated as leaf nodes. This is a WARN (not FAIL) in E2E tests. The UNK
filter and highlight still work correctly.

---

## Quick Reference Card

```bash
# ─── Full pipeline for new OSPF + host file ──────────────────────
bash terminal-script/workflow.sh all \
  --ospf-file INPUT-FOLDER/ospf-database-3b.txt \
  --host-file INPUT-FOLDER/Load-hosts-3b.txt

# ─── Re-enrich existing graph (new host file only) ───────────────
bash terminal-script/workflow.sh enrich-existing \
  --graph-time <YOUR_GRAPH_TIME> \
  --host-file  INPUT-FOLDER/Load-hosts-3b.txt

# ─── Promote host file to canonical ──────────────────────────────
bash terminal-script/save-load-hosts.sh \
  --from INPUT-FOLDER/Load-hosts-3b.txt

# ─── Run E2E validation ───────────────────────────────────────────
bash 06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh \
  --graph-time=<YOUR_GRAPH_TIME>

# ─── Show current canonical host file ────────────────────────────
bash terminal-script/save-load-hosts.sh --show

# ─── Manual colour push (if workflow was run with --no-push) ─────
python3 terminal-script/push-to-ui.py \
  --graph-time <YOUR_GRAPH_TIME>

# ─── Fetch raw graph manually (if already uploaded via web UI) ───
bash terminal-script/fetch-from-api.sh \
  --graph-time <YOUR_GRAPH_TIME>
```
