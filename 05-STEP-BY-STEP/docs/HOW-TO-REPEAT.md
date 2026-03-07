# 05-STEP-BY-STEP — How to Repeat This Test

This document explains how to reproduce the full end-to-end validation of the
OSPF Country Topology pipeline, all five view modes, and the three Sprint 3
features (UNK Highlight, Hostname Upload, Cost Matrix, What-If Analysis).

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Docker | ≥20 | `docker ps` must show `webserver`, `flask`, `mongodb` |
| Node.js | ≥18 | `node --version` |
| Python | ≥3.9 | for pipeline scripts and Phase 1 JSON validation |
| Playwright | any | installed in `tests/node_modules` |

### Start the stack

```bash
cd /path/to/OSPF-DATABASE-TEST
docker compose up -d          # or: bash start.sh
```

Confirm the UI is live:

```bash
curl -s http://localhost:8081/login | grep -i "topolograph\|ospf"
```

---

## Quick Run (recommended)

```bash
bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh
```

This runs all three phases automatically:

- **Phase 0** — Pre-flight (Docker, input files, Node.js, Playwright, artefacts)
- **Phase 1** — JSON artefact integrity (IN-OUT, AS-IS, GATEWAY, ENRICHED, COLLAPSING, CURRENT)
- **Phase 3** — Playwright full E2E: 9 test phases, 50+ checks, 17 screenshots

Results are written to:

```
05-STEP-BY-STEP/validation-report.txt
05-STEP-BY-STEP/screenshots/01-login-success.png  …  17-what-if-collapsing-mode.png
```

---

## Options

```bash
# Run with visible browser (watch the tests in real time)
bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh --visible

# Force a fresh pipeline run first (creates new graph_time)
bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh --run-pipeline

# Skip JSON artefact checks, only run Playwright
bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh --skip-phase1

# Specify a particular graph_time
bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh \
     --graph-time 04Mar2026_12h25m56s_34_hosts
```

---

## Running Just the Playwright Test

```bash
docker compose --profile test up -d e2e-runner
docker compose exec -T e2e-runner env \
  GRAPH_TIMES=04Mar2026_12h25m56s_34_hosts \
  node /app/tests/validate-full-e2e.cjs
```

---

## Full Pipeline Run (from scratch)

If no artefacts exist on disk, run the full pipeline first:

```bash
docker compose exec pipeline bash /app/terminal-script/workflow.sh all \
  --ospf-file /app/INPUT-FOLDER/ospf-database-2.txt \
  --host-file /app/INPUT-FOLDER/Load-hosts.txt \
  --base-url http://webserver:8081
```

This will:

1. Upload the OSPF database to Topolograph (`ospf-database-2.txt`)
2. Fetch the raw graph → `IN-OUT-FOLDER/{graph_time}/`
3. Run the terminal topology pipeline:
   - `OUTPUT/AS-IS/{graph_time}_AS-IS/`
   - `OUTPUT/GATEWAY/{graph_time}_GATEWAY/`
   - `OUTPUT/ENRICHED/{graph_time}_ENRICHED/`
4. Generate collapse config → `OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/`
5. Push country colours back to the UI

After the pipeline, rerun the validation:

```bash
bash 05-STEP-BY-STEP/scripts/run-full-e2e-validation.sh
```

---

## What the Test Validates

### Phase 0 — Pre-Flight

- Docker webserver responds at `http://localhost:8081`
- `INPUT-FOLDER/ospf-database-2.txt` exists
- `INPUT-FOLDER/Load-hosts.txt` exists
- `INPUT-FOLDER/Load-hosts.csv` exists
- Node.js and Playwright installed
- At least one COLLAPSING artefact directory on disk

### Phase 1 — JSON Artefact Integrity

For the latest `graph_time`:

| Stage | Checks |
|---|---|
| IN-OUT-FOLDER | meta.json, nodes.json (34), edges.json (≥100) |
| AS-IS | 34 nodes, ≥100 edges |
| GATEWAY | 28 nodes, ZAF has exactly 5 gateways |
| ENRICHED | country-mapping.csv, ≥10 countries |
| COLLAPSING | config: 10 ctry / 34 rtr / 28 gw / 6 core; topology: 28 nodes; ZAF has 3 cores |
| CURRENT | gateway topology and country-core summary exist |

### Phase 3 — Playwright UI (9 test phases)

| Phase | Coverage |
|---|---|
| AUTH | Login with ospf@topolograph.com |
| LOAD | Graph load via upload page (dynamic_graph_time dropdown) |
| P1 AS-IS | ≥30 visible nodes, ≥100 edges, Sprint 3 toolbar buttons present |
| P2 ENRICHED | ≥30 nodes, country classification, Country Filter panel |
| P3 GATEWAY | 28+ visible gateway nodes, hidden core count |
| P4 CURRENT | Mode loads without error |
| P5 COLLAPSING | Panel renders, collapse ZAF → badge "▲ N hidden \| Σcost: X", cross-country edges remain visible (Persistent Path Overlay), Collapse All / Expand All |
| P6 UNK Highlight | Toggle ON (active class), toggle OFF, present across modes |
| P7 Hostname Upload | Panel renders, graph context stats, drag-drop zone, CSV apply via `_applyHostnameMapping`, manual reclassify |
| P8 Cost Matrix | Panel renders, ≥5 country rows, non-zero Dijkstra cells, view-mode badge, gradient legend, cell click (path highlight), available in GATEWAY mode |
| P9 What-If | Panel renders, edge picker populated, view-mode badge, run analysis → result + risk label, apply button, available while COLLAPSING active |

---

## Screenshots Generated

| File | Content |
|---|---|
| `01-login-success.png` | Upload page after login |
| `02-graph-loaded.png` | Graph loaded (34 nodes) |
| `03-asis-view.png` | AS-IS view mode |
| `04-enriched-view.png` | ENRICHED with country colours |
| `05-gateway-view.png` | GATEWAY (28 nodes) |
| `06-current-view.png` | CURRENT mode |
| `07-collapsing-panel.png` | COLLAPSING panel open |
| `08-collapsing-zaf-collapsed.png` | ZAF collapsed, badge visible |
| `09-zaf-badge-zoom.png` | ZAF gateway badge (▲ hidden \| Σcost) |
| `10-unk-highlight-on.png` | UNK highlight active (orange nodes) |
| `11-hostname-upload-panel.png` | Hostname Upload panel with drag-drop zone |
| `12-hostname-applied.png` | After CSV mapping applied |
| `13-cost-matrix-panel.png` | Cost Matrix (10×10 heat-map) |
| `14-cost-matrix-gateway-mode.png` | Cost Matrix in GATEWAY mode |
| `15-what-if-panel.png` | What-If panel with edge picker |
| `16-what-if-result.png` | Analysis result with risk label |
| `17-what-if-collapsing-mode.png` | What-If while COLLAPSING active |

---

## Architecture Reference

```
INPUT-FOLDER/
  ospf-database-2.txt        ← OSPF LSDB (34 routers, 10 countries)
  Load-hosts.txt             ← Host mapping: router_id → hostname → country
  Load-hosts.csv             ← CSV form of host mapping
  collapse-preferences.json  ← Which countries are collapsed by default

  ↓ workflow.sh all

IN-OUT-FOLDER/{graph_time}/
  meta.json, nodes.json, edges.json   ← Raw API fetch

  ↓ topology-country-tool.sh / push-to-ui.py

OUTPUT/AS-IS/{graph_time}_AS-IS/
  AS-IS_original-topology-with-country.json  ← 34 nodes + colours

OUTPUT/GATEWAY/{graph_time}_GATEWAY/
  GATEWAY_gateway-only-topology.json         ← 28 gateway nodes only

OUTPUT/ENRICHED/{graph_time}_ENRICHED/
  ENRICHED_original-topology-with-country.json
  ENRICHED_country-mapping.csv               ← 34 routers → country

OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/
  COLLAPSING_country-collapse-config.json    ← 10 countries, 28 gw, 6 core
  COLLAPSING_collapsed-topology.json         ← 28-node collapsed view

OUTPUT/CURRENT/
  gateway-only-topology.json                 ← Symlink/copy of latest GATEWAY
  country-core-summary.json                  ← Latest enrichment summary

topolograph-docker/init/topolograph.js
  Sprint 3 features (lines ~5732–6776):
    _toggleUnkHighlight()         ← P6 UNK Highlight
    buildHostnameUploadPanel()    ← P7 Hostname Upload
    buildOspfCostMatrix()         ← P8 Cost Matrix (Dijkstra APSP)
    buildOspfWhatIf()             ← P9 What-If Analysis
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Webserver NOT responding" | `docker start webserver flask mongodb` |
| "nodes.json not found" | Run `workflow.sh all` to generate artefacts |
| "Cannot find module 'playwright'" | `cd tests && npm install` |
| Cost Matrix shows all N/R | Graph may not be loaded — ensure `loadGraph()` ran |
| What-If panel overlapping | Expected: panel is center-positioned at `left:50%;transform:translateX(20%)` |
| Badge has no Σcost | Ensure Docker was restarted after last topolograph.js edit |

To restart Docker after code changes:

```bash
docker restart flask
```

---

## Commit History

```
af984c7  feat(sprint3): UNK filter + Hostname Upload + Cost Matrix + What-If Analysis
101c17d  feat(collapsing): IP Fabric Selective Collapse parity — L9/L10 + v3 validation
ff18c8a  feat: COLLAPSING deep-dive — 285/285 checks pass across all 4 graph_times
df81363  feat: Multi-Mode Enhancement Sprint — 31/31 E2E feature checks pass
c500445  feat: complete COLLAPSING feature E2E validation — 24/24 checks pass
86deaad  feat: COLLAPSING pipeline stage + 4-mode UI + validation + docs
```
