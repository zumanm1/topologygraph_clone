# 07-STEP-BY-STEP
## New OSPF File Pipeline — ospf-database-3b.txt + Load-hosts-3b.txt

This folder documents and validates running the full OSPF Country Topology
pipeline with a brand-new OSPF file and a new hostname mapping file,
demonstrating that **zero code changes** are needed.

---

## Input Files

| File | Location | Description |
|------|----------|-------------|
| `ospf-database-3b.txt` | `INPUT-FOLDER/` | 54-router OSPF LSDB (copy of ospf-database-3.txt) |
| `Load-hosts-3b.txt` | `INPUT-FOLDER/` | 34 named entries (copy of Load-hosts.txt) |
| `Load-hosts.csv` | `INPUT-FOLDER/` | Standard CSV host file (`device_ip_address,device_name`) for browser derivation regression |

The `3b` suffix makes it clear this is a variant/copy, distinguishable
from the canonical `3` files. In a real scenario, `3b.txt` would contain
a different network topology.

---

## Quick Start

```bash
# From project root:
bash 07-STEP-BY-STEP/scripts/run-pipeline-3b.sh
```

For the current full remote-machine install and Docker-native validation flow, use:

```bash
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
```

For the updated **full Web UI user-journey validation** on the current codebase, use:

```bash
bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```

The 08 command above:
1. Verifies pre-flight conditions (5 checks)
2. Uploads `ospf-database-3b.txt` to Topolograph
3. Fetches raw graph → `IN-OUT-FOLDER/{graph_time}/`
4. Enriches topology → `OUTPUT/{AS-IS,GATEWAY,ENRICHED,COLLAPSING}/{graph_time}_*/` using hostname-derived country codes
5. Pushes country colours to Topolograph UI (54 PATCH calls)
6. Verifies all 19 output files exist (15+ checks)

Expected result:
```
✅ ALL CHECKS PASSED
graph_time : 05Mar2026_HHhMMmSSs_54_hosts
duration   : ~30s
```

---

## Documentation Index

| Document | What It Covers |
|----------|---------------|
| [`docs/01-CAN-THE-CODE-HANDLE-NEW-FILES.md`](docs/01-CAN-THE-CODE-HANDLE-NEW-FILES.md) | Architecture analysis: why zero code changes are needed |
| [`docs/02-COMPLETE-WALKTHROUGH.md`](docs/02-COMPLETE-WALKTHROUGH.md) | Step-by-step guide from command line to browser |
| [`docs/03-FOLDER-FILE-REFERENCE.md`](docs/03-FOLDER-FILE-REFERENCE.md) | Every folder and file explained with content samples |

---

## File Structure After Pipeline Run

```
INPUT-FOLDER/
  ospf-database-3b.txt     ← your OSPF LSDB (input)
  Load-hosts-3b.txt        ← your hostname map (input)

IN-OUT-FOLDER/
  {graph_time}/
    meta.json              ← API metadata snapshot
    nodes.json             ← 54 nodes (raw from API)
    edges.json             ← 148 edges (raw from API)
    edges.csv              ← CSV conversion

OUTPUT/AS-IS/{graph_time}_AS-IS/
    AS-IS_nodes.json       ← unmodified copy
    AS-IS_edges.json       ← unmodified copy
    AS-IS_meta.json        ← unmodified copy
    AS-IS_ospf-database.txt ← copy of ospf-database-3b.txt

OUTPUT/GATEWAY/{graph_time}_GATEWAY/
    GATEWAY_gateway-only-topology.json/.yaml   ← 32 gw nodes
    GATEWAY_country-core-summary.json/.yaml    ← country-pair aggregation

OUTPUT/ENRICHED/{graph_time}_ENRICHED/
    ENRICHED_country-mapping.csv               ← 54 rows, KEY FILE
    ENRICHED_country-palette.json             ← 11-colour palette
    ENRICHED_original-topology-with-country.json/.yaml

OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/
    COLLAPSING_country-collapse-config.json   ← 11c/54r/32gw/22core
    COLLAPSING_collapsed-topology.json/.yaml  ← for vis.js COLLAPSING mode
```

---

## How It Works (One-Paragraph Summary)

`workflow.sh all --ospf-file X --host-file Y` uploads file `X` to
Topolograph via its REST API, receiving back a `graph_time` timestamp.
It then fetches the raw graph (nodes + edges JSON) into `IN-OUT-FOLDER`.
Next it calls `topology-country-tool.sh`, which uses `awk` to parse the
OSPF LSDB, maps router IDs to hostnames via the host file, derives country codes
from the hostname token before the first dash (first 3 letters, uppercased),
marks IP-like or missing hostnames as `UNK`, and classifies each router as gateway (cross-country
links) or core (same-country only). The enriched outputs flow into four
`OUTPUT/` sub-folders, each prefixed with its stage name. Finally,
`push-to-ui.py` PATCHes each node in Topolograph with its country colour,
dual-line label, and tooltip — enabling all five view modes and the two
Analysis features (Cost Matrix, What-If Analysis) in the web UI.

---

## Key Numbers (ospf-database-3b.txt + Load-hosts-3b.txt)

| Metric | Value |
|--------|-------|
| Total routers | 54 |
| Named routers | 34 (in Load-hosts-3b.txt) |
| UNK routers | 20 (19.x, 20.x, 21.x, 22.x — no hostname) |
| Countries | 11 (ZAF DRC MOZ KEN TAN LES DJB GBR FRA POR + UNK) |
| Gateway routers | 32 |
| Core routers | 22 |
| OSPF edges | 148 |
| Gateway edges | ~90 |

---

## Reference: Previous Step-by-Step Suites

| Suite | Input | Focus |
|-------|-------|-------|
| `05-STEP-BY-STEP/` | ospf-database-2.txt (34 routers) | 5-view modes + Sprint 3 features |
| `06-STEP-BY-STEP/` | ospf-database-3.txt (54 routers) | Deep validation, 114/114 E2E checks |
| `07-STEP-BY-STEP/` | ospf-database-3b.txt (54 routers) | New-file pipeline, architecture docs |
| `08-STEP-BY-STEP/` | packaged 54-router fixtures | Canonical Docker-native rebuild + regression flow |
| `09-STEP-BY-STEP/` | standard host files + conflicting 3-col fixture | Focused hostname-derived country-code regression |
| `10-STEP-BY-STEP/` | packaged 54-router fixtures + browser upload path | Updated full Web UI user journey, artifacts, screenshots, layout/export |
