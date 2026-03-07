# 06-STEP-BY-STEP — Deep End-to-End Validation

> **Validates the full OSPF topology pipeline** from raw OSPF database input
> through every output stage, PLUS all Sprint 3 features at depth — including
> the `_refreshCostMatrix` bug fix, `Apply Change → matrix auto-refresh` integration,
> and 20 UNK nodes from an unmapped OSPF database.

---

## Quick Run

```bash
# Prerequisites: Docker running (port 8081), project cloned, .env created
cd /path/to/OSPF-DATABASE-TEST
docker compose --profile test up -d e2e-runner
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
```

**Expected result**: `ALL 06-STEP-BY-STEP CHECKS PASSED ✅` (90+ checks, 0 failures)

---

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Docker container `flask` running | `docker ps \| grep flask` |
| Topolograph UI at port 8081 | `curl http://localhost:8081/login` |
| Node.js ≥ 18 | `node --version` |
| Playwright installed | `ls tests/node_modules/playwright` |
| `ospf-database-3.txt` in INPUT-FOLDER | 54 routers (34 named + 20 UNK) |
| `Load-hosts.txt` in INPUT-FOLDER | 34 entries (leaves 20 UNK unmapped) |
| `Load-hosts.csv` or `Load-hosts-3b.txt` in INPUT-FOLDER | standard host-file fixture for hostname-derived country checks |
| Pipeline run at least once | `ls OUTPUT/COLLAPSING/*_54_hosts_*/` |

---

## Step-by-Step Reproduction

### Step 1: Run the pipeline with ospf-database-3.txt

```bash
docker compose exec pipeline bash /app/terminal-script/workflow.sh all \
  --ospf-file /app/INPUT-FOLDER/ospf-database-3.txt \
  --host-file /app/INPUT-FOLDER/Load-hosts.txt \
  --base-url  http://webserver:8081
```

This uploads 54 routers. The 20 routers not in `Load-hosts.txt` get classified as `UNK`.

**Expected output:**
```
Countries: DJB:2 | DRC:4 | FRA:3 | GBR:3 | KEN:2 | LES:3 | MOZ:4 | POR:3 | TAN:2 | UNK:20 | ZAF:8
COLLAPSING: 11 ctry | 54 rtr | 32 gw | 22 core
UNK: total=20 gw=4 core=16
```

### Step 2: Run deep validation

```bash
GRAPH_TIME="$(ls -1 IN-OUT-FOLDER | grep '_54_hosts' | sort | tail -1)"
docker compose exec -T e2e-runner bash /app/docker/scripts/docker-e2e.sh \
  --graph-time="$GRAPH_TIME"
```

Or with a visible browser:
```bash
docker compose exec -T e2e-runner env HEADLESS=false bash /app/docker/scripts/docker-e2e.sh \
  --graph-time="$GRAPH_TIME"
```

Or trigger fresh pipeline + validation in one shot:
```bash
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
```

---

## Options

| Flag | Description |
|------|-------------|
| *(none)* | Run Phase 0 pre-flight + Phase 1 JSON checks + Phase 3 Playwright |
| `--run-pipeline-db3` | Also re-run workflow.sh with ospf-database-3.txt (Phase 2) |
| `--skip-phase1` | Skip JSON integrity checks (faster) |
| `--visible` | Show browser window (headless=false) |
| `--graph-time=<gt>` | Force a specific graph_time instead of auto-detecting |

---

## What's Tested (vs 05-STEP-BY-STEP)

| Feature | 05 | 06 (deeper) |
|---------|----|----|
| AS-IS 54 nodes | ≥30 | ≥50 + UNK count |
| ENRICHED | ≥30 | ≥50 + 11 countries + UNK visible |
| GATEWAY | ≥20 | ≥32 + UNK hubs + 22 cores hidden |
| COLLAPSING | ZAF collapse, Collapse All | + UNK non-interactive row |
| Cost Matrix | rows≥5, cells>0 | rows≥11, UNK row, UNK non-zero costs, Excel btn, ↺ btn, functions, **↺ rebuilds (bug fix)** |
| What-If | run, risk, apply btn | + auto-fill cost, Δ column, affected pairs, **Apply → vis.js update**, confirmation, **CSV export callable** |
| Integration | — | **Apply Change while matrix open → matrix survives + updates** |
| Phase 1 | Dynamic counts | + UNK gateways (4), UNK cores (16), `edges.csv` |

---

## Phase Descriptions

### Phase 0: Pre-Flight (10 checks)
- Docker webserver responding
- `ospf-database-2.txt` and `ospf-database-3.txt` exist
- `Load-hosts.txt` has exactly 34 entries (20 UNK demo)
- `Load-hosts.csv` or `Load-hosts-3b.txt` provides standard hostname mappings for the browser regression
- Node.js + Playwright available
- 54-host COLLAPSING artefacts on disk
- UNK country present in COLLAPSING config

### Phase 1: JSON Artefact Integrity (~22 checks)
- Auto-detects expected counts from graph_time suffix + COLLAPSING config
- All 6 output stages validated against each other
- UNK-specific: 20 total, 4 gateways, 16 cores
- `edges.csv` present in IN-OUT-FOLDER
- ZAF has 3 core nodes (regression test)

### Phase 2: Optional Pipeline Run
- Runs `workflow.sh all --ospf-file ospf-database-3.txt --host-file Load-hosts.txt`
- Only triggered with `--run-pipeline-db3`

### Phase 3: Playwright E2E (12 phases, 90+ checks)

| Phase | Checks |
|-------|--------|
| AUTH | Login |
| LOAD | 54 nodes loaded |
| P1-ASIS | 54 visible, UNK nodes ≥20, 4 toolbar buttons |
| P2-ENRICHED | 54 visible, Country Filter, ≥34 classified, ≥20 UNK visible, 11 countries |
| P3-GATEWAY | ≥32 visible, ≥22 cores hidden, ≥4 UNK hubs visible |
| P4-CURRENT | Loads without error |
| P5-COLLAPSING | Panel, UNK non-interactive, ZAF ▲badge, Σcost, Persistent Path Overlay, Collapse All ≥22 |
| P6-UNK | Toggle on/off, GATEWAY cross-mode |
| P7-HOST | standard host file, derived KEN/DRC/ZAF checks, conflicting static country ignored, UNK preserved ≥20, manual reclassify |
| P8-MATRIX | 11 rows, UNK row, UNK non-zero costs, Excel btn, ↺ btn, functions, **↺ REBUILDS** (not closes), GATEWAY mode |
| P9-WHATIF | Edge picker, auto-fill, CSV Export btn, functions, cost change card, affected pairs, Δ column, Apply → vis.js, confirmation, Apply btn disabled, Export callable, COLLAPSING cross-mode |
| P10-INT | Both panels open, analysis, **Apply → matrix survives + data updates** |

---

## Screenshot Reference (21 files)

| File | Content |
|------|---------|
| `01-login-success.png` | Login page after auth |
| `02-graph-loaded-54.png` | 54-router topology loaded |
| `03-asis-54.png` | AS-IS view with UNK nodes |
| `04-enriched-54.png` | ENRICHED with 11 country colours |
| `05-gateway-54.png` | GATEWAY mode — 32 gw + UNK hubs |
| `06-current-54.png` | CURRENT mode |
| `07-collapsing-panel-54.png` | COLLAPSING panel |
| `07b-collapsing-unk-row.png` | UNK row (non-interactive) |
| `08-zaf-collapsed-54.png` | ZAF collapsed with badge |
| `09-zaf-badge-zoom-54.png` | ZAF gateway badge closeup |
| `10-unk-highlight-54.png` | UNK Highlight active |
| `11-hostname-upload-54.png` | Hostname Upload panel |
| `12-hostname-applied-54.png` | After standard host-file apply with derived country labels |
| `13-cost-matrix-54.png` | Cost Matrix (11×11) |
| `14-cost-matrix-refreshed.png` | Matrix after ↺ Refresh (rebuilt) |
| `15-cost-matrix-gateway-54.png` | Matrix in GATEWAY mode |
| `16-whatif-54.png` | What-If panel |
| `17-whatif-analysis-result.png` | Analysis with Δ column |
| `18-whatif-applied.png` | After Apply Change |
| `19-whatif-collapsing-54.png` | What-If in COLLAPSING state |
| `20-matrix-post-apply.png` | Matrix auto-refreshed after Apply |
| `21-integration-complete.png` | Integration test complete |

---

## Key Bug Fixed in This Sprint

### `_refreshCostMatrix()` — Panel Close Instead of Refresh

**Root cause**: `_refreshCostMatrix()` called `buildOspfCostMatrix()` which is a TOGGLE function. When the panel was already open, calling it would **close** the panel and return early, never rebuilding it.

**Effect**:
- Clicking ↺ in the matrix header **closed** the panel (not refreshed)
- `_applyWhatIf()` calling `_refreshCostMatrix()` after a cost change **closed** the matrix

**Fix** (`topolograph.js` line 6372):
```javascript
// BEFORE (bug):
function _refreshCostMatrix() {
  buildOspfCostMatrix();  // closes if open — WRONG
}

// AFTER (fix):
function _refreshCostMatrix() {
  var old = document.getElementById('ospfCostMatrixPanel');
  if (old) { old.remove(); _matrixData = null; }  // explicitly remove
  buildOspfCostMatrix();  // panel gone → builds fresh
}
```

**Verified by P8 test**: "↺ Refresh: panel REBUILT (not closed) — bug fix verified ✓"
**Verified by P10 test**: "Cost Matrix panel SURVIVED Apply Change (auto-refresh worked ✓)"

---

## Architecture

```
06-STEP-BY-STEP/
├── docs/
│   └── HOW-TO-REPEAT.md          ← This file
├── scripts/
│   └── run-full-e2e-v2.sh        ← Master 3-phase validation script
├── screenshots/
│   └── 01-21-*.png               ← Auto-captured by Playwright
└── validation-report.txt         ← Full tee'd output (auto-generated)

tests/
└── validate-full-e2e-v2.cjs      ← 12-phase Playwright test (90+ checks)

INPUT-FOLDER/
├── ospf-database-3.txt           ← 54 routers (20 UNK, 4 clusters)
├── Load-hosts.txt                ← 34 named routers only
├── Load-hosts.csv                ← standard CSV host file (`device_ip_address,device_name`)
└── Load-hosts-3b.txt             ← standard TXT host file (`router_id hostname`)
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Graph shows 34 nodes, not 54 | Run pipeline with `ospf-database-3.txt` (not `ospf-database-2.txt`) |
| UNK count < 20 | Check `Load-hosts.txt` has exactly 34 entries; re-run push-to-ui.py |
| ↺ Refresh closes matrix instead of rebuilding | `_refreshCostMatrix()` bug — check Docker restarted after topolograph.js fix |
| Cost Matrix shows 10 rows (no UNK) | `filter(c => c !== 'UNK')` bug — check topolograph.js `_computeCountryMatrix` |
| Apply Change closes matrix | `_refreshCostMatrix` bug (same as above) |
| P10 Integration fails | Ensure Docker restarted after topolograph.js fix |
| No 54-host COLLAPSING artefact | Run: `docker compose exec pipeline bash /app/terminal-script/workflow.sh all --ospf-file /app/INPUT-FOLDER/ospf-database-3.txt --host-file /app/INPUT-FOLDER/Load-hosts.txt --base-url http://webserver:8081` |
