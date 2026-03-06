# Folder & File Reference
## Every directory and file the pipeline creates — what it is and what's in it

This document is a complete reference map of the file system after a full
`workflow.sh all` run with `ospf-database-3b.txt` + `Load-hosts-3b.txt`.

---

## Top-Level Structure

```
OSPF-DATABASE-TEST/
├── INPUT-FOLDER/                   ← your source files (you manage this)
├── IN-OUT-FOLDER/                  ← raw API snapshots (auto-created)
├── OUTPUT/                         ← enriched pipeline outputs (auto-created)
│   ├── AS-IS/
│   ├── ENRICHED/
│   ├── GATEWAY/
│   └── COLLAPSING/
├── terminal-script/                ← the pipeline scripts
├── tests/                          ← Playwright test suites
├── 05-STEP-BY-STEP/                ← 34-router validation (historical)
├── 06-STEP-BY-STEP/                ← 54-router deep validation (current)
└── 07-STEP-BY-STEP/                ← this session's documentation
```

---

## INPUT-FOLDER/ — Your Source Files

You own and manage this folder. Nothing is auto-created here.

```
INPUT-FOLDER/
├── ospf-database-3b.txt     ← NEW: 54-router OSPF LSDB (copy of ospf-database-3.txt)
├── ospf-database-3.txt      ← previous default: 54 routers
├── ospf-database-2.txt      ← 34-router graph (for 05-STEP-BY-STEP tests)
├── ospf-database.txt        ← original legacy file
│
├── Load-hosts-3b.txt        ← NEW: hostname map (copy of Load-hosts.txt)
├── Load-hosts.txt           ← canonical hostname map (34 entries)
├── Load-hosts.csv           ← same as above, CSV format
│
├── collapse-preferences.json ← which countries are collapsed by default in UI
└── host-mapping-e2e.csv     ← legacy enriched fixture; no longer the canonical source for automatic country derivation
```

### `ospf-database-3b.txt` — Format Explained

This is the raw output of `show ip ospf database detail` from a Cisco router.
The pipeline reads it with `awk` looking for these patterns:

```
        OSPF Router with ID (1.1.1.1) (Process ID 100)

                Router Link States (Area 0)

  LS age: 123
  Options: 0x22
  LS Type: Router Links
  Link State ID: 1.1.1.1
  Advertising Router: 1.1.1.1       ← identifies this router
  ...
    Link connected to: a Stub Network
    Link connected to: a Point-to-Point link
      Neighboring Router ID: 2.2.2.2   ← link destination
      TOS 0 Metrics: 100               ← link cost
```

### `Load-hosts-3b.txt` — Format Explained

Space-separated, one entry per line. Comments start with `#`.

```
# router_id   hostname
1.1.1.1       zaf-cpt-r1      ← ZAF country (token before first dash = zaf)
1.1.1.2       zaf-cpt-r2
...
9.9.9.1       les-mar-r1      ← LES country
...
# 19.x, 20.x, 21.x, 22.x NOT listed → classified as UNK
```

The pipeline extracts the country code from the hostname token before the
first dash, then takes the first three letters and uppercases them:

- `zaf-cpt-r1` → `ZAF`
- `ken-mob-r2` → `KEN`
- `drc-gom-r1` → `DRC`
- `19.19.19.1` → `UNK` (IP-like hostname)

---

## IN-OUT-FOLDER/ — Raw API Snapshots

Created by `fetch-from-api.sh`. One sub-folder per pipeline run.
These files are **never modified** — they are the permanent record
of exactly what Topolograph stored for each graph_time.

```
IN-OUT-FOLDER/
└── 05Mar2026_18h30m00s_54_hosts/    ← graph_time (your 3b run)
    ├── meta.json
    ├── nodes.json
    ├── edges.json
    └── edges.csv
```

### `meta.json`
```json
{
  "graph_time": "05Mar2026_18h30m00s_54_hosts",
  "timestamp": "2026-03-05T18:30:00.000Z",
  "igp_protocol": "ospf",
  "vendor": "Cisco",
  "hosts": 54
}
```

### `nodes.json`
Array of 54 objects — one per router as stored by Topolograph:
```json
[
  {
    "id": "1.1.1.1",
    "label": "1.1.1.1",
    "title": "",
    "group": "",
    "color": { "background": "#97C2FC", "border": "#2B7CE9" }
  },
  ...
]
```
At this stage, labels are raw IP addresses and colours are the Topolograph
default (light blue). Country enrichment happens later (push-to-ui.py).

### `edges.json`
Array of 148 objects — one per directed OSPF adjacency:
```json
[
  { "from": "1.1.1.1", "to": "2.2.2.2", "label": "100", "cost": 100 },
  { "from": "2.2.2.2", "to": "1.1.1.1", "label": "100", "cost": 100 },
  ...
]
```

### `edges.csv`
Simple 3-column CSV derived from edges.json:
```csv
src,dst,cost
1.1.1.1,2.2.2.2,100
2.2.2.2,1.1.1.1,100
...
```
Used by `topology-country-tool.sh` when running in CSV mode (no OSPF file).

---

## OUTPUT/ — Enriched Pipeline Outputs

Each `workflow.sh` run creates four sub-folders under `OUTPUT/`, all
named with the same `{graph_time}` and a stage suffix.

### Naming Convention

```
OUTPUT/{STAGE}/{graph_time}_{STAGE}/
         │              │       │
         │         same timestamp   stage suffix
         │         from IN-OUT      (AS-IS, GATEWAY,
         │                          ENRICHED, COLLAPSING)
         │
         STAGE: AS-IS | GATEWAY | ENRICHED | COLLAPSING
```

Files inside each folder are also **prefixed** with the stage name, so
any file is self-identifying even without folder context:

```
OUTPUT/ENRICHED/05Mar2026_18h30m00s_54_hosts_ENRICHED/
                                              ENRICHED_country-mapping.csv
                                              ENRICHED_country-palette.json
                                              ENRICHED_original-topology-with-country.json
                                              ENRICHED_original-topology-with-country.yaml
```

---

### OUTPUT/AS-IS/{graph_time}_AS-IS/

An unmodified copy of the IN-OUT-FOLDER files plus the source OSPF file.
Nothing changed. Used as a baseline for comparison and by
`generate-collapse-config.py` (which reads AS-IS nodes + edges).

```
OUTPUT/AS-IS/05Mar2026_18h30m00s_54_hosts_AS-IS/
├── AS-IS_nodes.json          ← copy of IN-OUT nodes.json (54 nodes, raw)
├── AS-IS_edges.json          ← copy of IN-OUT edges.json (148 edges, raw)
├── AS-IS_meta.json           ← copy of IN-OUT meta.json
└── AS-IS_ospf-database.txt   ← copy of ospf-database-3b.txt
```

**Why keep AS-IS?** It gives you a permanent, immutable snapshot of the
raw graph before any enrichment was applied. You can diff
`AS-IS_nodes.json` vs `ENRICHED_original-topology-with-country.json` to
see exactly what the enrichment step added.

---

### OUTPUT/GATEWAY/{graph_time}_GATEWAY/

Gateway-only topology. Only routers that have neighbours in more than
one country are included. Core (intra-country) routers are absent.

```
OUTPUT/GATEWAY/05Mar2026_18h30m00s_54_hosts_GATEWAY/
├── GATEWAY_gateway-only-topology.json    ← 32 nodes, ~90 edges
├── GATEWAY_gateway-only-topology.yaml    ← same, YAML format
├── GATEWAY_country-core-summary.json     ← per-country pair summary
└── GATEWAY_country-core-summary.yaml     ← same, YAML format
```

#### `GATEWAY_gateway-only-topology.json`
```json
{
  "description": "Gateway-only topology for graph_time=05Mar2026_18h30m00s_54_hosts",
  "node_count": 32,
  "edge_count": 90,
  "nodes": [
    { "id": "1.1.1.3", "hostname": "zaf-jhb-gw1", "country": "ZAF",
      "is_gateway": true, "color": "#FF8C42" },
    ...
  ],
  "edges": [
    { "source": "1.1.1.3", "target": "2.2.2.1",
      "cost": 100, "src_country": "ZAF", "dst_country": "DRC",
      "inter_country": true },
    ...
  ]
}
```

#### `GATEWAY_country-core-summary.json`
Aggregated by country-pair:
```json
{
  "pairs": [
    { "src_country": "ZAF", "dst_country": "DRC",
      "min_cost": 100, "max_cost": 200, "edge_count": 3 },
    ...
  ]
}
```

---

### OUTPUT/ENRICHED/{graph_time}_ENRICHED/

The richest output. Contains all 54 routers, enriched with country
codes, hostnames, and gateway flags. This is the **source of truth**
for the UI colour-push step.

```
OUTPUT/ENRICHED/05Mar2026_18h30m00s_54_hosts_ENRICHED/
├── ENRICHED_country-mapping.csv              ← primary enrichment record
├── ENRICHED_country-palette.json            ← colour mapping per country
├── ENRICHED_original-topology-with-country.json
└── ENRICHED_original-topology-with-country.yaml
```

#### `ENRICHED_country-mapping.csv` — The Key File

This is the file that `push-to-ui.py` reads to determine what colour
and label to apply to each node. 55 lines (header + 54 routers):

```csv
router_id,hostname,country_code,is_gateway
1.1.1.1,zaf-cpt-r1,ZAF,false
1.1.1.2,zaf-cpt-r2,ZAF,false
1.1.1.3,zaf-jhb-gw1,ZAF,true
...
19.19.19.1,,UNK,true
19.19.19.2,,UNK,false
...
```

Columns:
- `router_id` — the router's IP address (OSPF Router ID)
- `hostname` — from `Load-hosts-3b.txt` (empty for UNK routers)
- `country_code` — 3-letter code derived from the hostname token before the first dash; IP-like hostnames become `UNK`
- `is_gateway` — true if this router has neighbours in >1 country

#### `ENRICHED_country-palette.json`
Created by `push-to-ui.py` after patching. Records the exact colours used:
```json
{
  "graph_time": "05Mar2026_18h30m00s_54_hosts",
  "countries": ["DJB", "DRC", "FRA", "GBR", "KEN", "LES", "MOZ", "POR", "TAN", "UNK", "ZAF"],
  "palette": {
    "ZAF": { "background": "#FF8C42", "border": "#CC6D28" },
    "DRC": { "background": "#4ECDC4", "border": "#3AA39B" },
    "UNK": { "background": "#B0B0B0", "border": "#808080" },
    ...
  }
}
```

#### `ENRICHED_original-topology-with-country.json`
All 54 nodes + all 148 edges, with enrichment fields added to each node:
```json
{
  "description": "Original topology enriched with country metadata",
  "node_count": 54,
  "edge_count": 148,
  "nodes": [
    { "id": "1.1.1.1", "hostname": "zaf-cpt-r1", "country": "ZAF",
      "is_gateway": false, "color": "#FF8C42" },
    ...
    { "id": "19.19.19.1", "hostname": "", "country": "UNK",
      "is_gateway": true, "color": "#B0B0B0" }
  ],
  "edges": [ ... same 148 edges as AS-IS ... ]
}
```

---

### OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/

Used exclusively by the Topolograph **COLLAPSING view mode** in the
web UI. Tells vis.js which nodes can be collapsed into country bubbles.

```
OUTPUT/COLLAPSING/05Mar2026_18h30m00s_54_hosts_COLLAPSING/
├── COLLAPSING_country-collapse-config.json   ← the configuration
├── COLLAPSING_collapsed-topology.json        ← gateway-only topology
└── COLLAPSING_collapsed-topology.yaml        ← same, YAML format
```

#### `COLLAPSING_country-collapse-config.json`
```json
{
  "graph_time": "05Mar2026_18h30m00s_54_hosts",
  "summary": {
    "total_countries": 11,
    "total_routers": 54,
    "total_gateways": 32,
    "total_cores": 22
  },
  "countries": {
    "ZAF": {
      "total": 8,
      "gateway_count": 5,
      "core_count": 3,
      "gateway_ids": ["1.1.1.3", "1.1.1.4", "1.1.1.5", "1.1.1.6", "1.1.1.7"],
      "core_ids": ["1.1.1.1", "1.1.1.2", "1.1.1.8"],
      "default_collapsed": false
    },
    "UNK": {
      "total": 20,
      "gateway_count": 4,
      "core_count": 16,
      "gateway_ids": ["19.19.19.1", "20.20.20.1", "21.21.21.1", "22.22.22.1"],
      "core_ids": ["19.19.19.2", ..., "22.22.22.5"],
      "default_collapsed": false
    },
    ...
  }
}
```

This tells the UI: "ZAF has 5 gateway nodes — keep those visible when
ZAF is collapsed. Hide the 3 core nodes (1.1.1.1, 1.1.1.2, 1.1.1.8)."

#### `COLLAPSING_collapsed-topology.json`
The vis.js-ready topology with only gateway nodes and inter-country edges:
```json
{
  "description": "Gateway-only collapsed topology ...",
  "nodes": [
    { "id": "1.1.1.3", "hostname": "zaf-jhb-gw1", "country": "ZAF", ... },
    ...   (32 gateway nodes total)
  ],
  "edges": [
    { "source": "1.1.1.3", "target": "2.2.2.1",
      "src_country": "ZAF", "dst_country": "DRC", "cost": 100 },
    ...   (~90 gateway edges)
  ]
}
```

---

## Topolograph Internal State (Not on Disk)

In addition to the files above, Topolograph stores graph data in its
own internal database (inside the Docker container). This is what the
web UI reads when you load a graph from the dropdown.

After `push-to-ui.py` runs, each node in Topolograph's database holds:

```json
{
  "id": "1.1.1.3",
  "label": "zaf-jhb-gw1\n1.1.1.3",
  "title": "<b>zaf-jhb-gw1</b><br>IP: 1.1.1.3<br>Country: ZAF<br>Gateway: ✓",
  "color": {
    "background": "#FF8C42",
    "border": "#CC6D28",
    "highlight": { "background": "#FFB380", "border": "#FF8C42" },
    "hover": { "background": "#FFB380", "border": "#FF8C42" }
  },
  "country": "ZAF",
  "is_gateway": true,
  "hostname": "zaf-jhb-gw1",
  "group": "ZAF"
}
```

This enriched state enables the five view modes in the web UI.

---

## Complete File Inventory After Full Run

```
After: workflow.sh all \
         --ospf-file INPUT-FOLDER/ospf-database-3b.txt \
         --host-file INPUT-FOLDER/Load-hosts-3b.txt

New files created (with your graph_time = GT):

INPUT-FOLDER/
  (no new files — only you add files here)

IN-OUT-FOLDER/
  {GT}/meta.json                              ← raw API metadata
  {GT}/nodes.json                             ← 54 nodes (unmodified)
  {GT}/edges.json                             ← 148 edges (unmodified)
  {GT}/edges.csv                              ← CSV conversion

OUTPUT/AS-IS/{GT}_AS-IS/
  AS-IS_nodes.json                            ← copy of IN-OUT nodes
  AS-IS_edges.json                            ← copy of IN-OUT edges
  AS-IS_meta.json                             ← copy of IN-OUT meta
  AS-IS_ospf-database.txt                     ← copy of ospf-database-3b.txt

OUTPUT/GATEWAY/{GT}_GATEWAY/
  GATEWAY_gateway-only-topology.json          ← 32 gateways, ~90 edges
  GATEWAY_gateway-only-topology.yaml          ← same, YAML
  GATEWAY_country-core-summary.json           ← country-pair aggregation
  GATEWAY_country-core-summary.yaml           ← same, YAML

OUTPUT/ENRICHED/{GT}_ENRICHED/
  ENRICHED_country-mapping.csv               ← 54 rows: id,hostname,country,is_gw
  ENRICHED_country-palette.json             ← 11-colour palette
  ENRICHED_original-topology-with-country.json ← 54 nodes + 148 edges, enriched
  ENRICHED_original-topology-with-country.yaml ← same, YAML

OUTPUT/COLLAPSING/{GT}_COLLAPSING/
  COLLAPSING_country-collapse-config.json   ← 11 countries, 32 gw, 22 core
  COLLAPSING_collapsed-topology.json        ← 32 gw nodes, ~90 edges
  COLLAPSING_collapsed-topology.yaml        ← same, YAML

TOTAL: 16 new files created on disk
       + 54 PATCH calls to Topolograph API (not on disk)
```

Where `GT` = your graph_time, e.g. `05Mar2026_18h30m00s_54_hosts`
