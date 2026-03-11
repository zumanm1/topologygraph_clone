# 13-STEP-BY-STEP
## OSPF Path Analysis Suite — Full E2E Validation with Real A/B/C-type Data

This folder validates the complete **OSPF Path Analysis Suite** (PRD-08 → PRD-13):
K-Path Explorer, Change Planner, Impact Lab, and Topology Diff — using the real
84-node OSPF dataset with properly resolved A-type, B-type, and C-type hostnames.

It builds on the patterns established in:
- `10-STEP-BY-STEP` — Web UI upload + enrichment pipeline
- `11-STEP-BY-STEP-SECURITY` — Security checks
- `12-STEP-BY-STEP-ORCHESTRATED` — Multi-suite orchestration

---

## What Step 13 Tests

### Input Files Used
| File | Purpose |
|------|---------|
| `INPUT-FOLDER/ospf-database-54-unk-test.txt` | Real OSPF LSDB — 84 routers, 54 with full hostnames |
| `INPUT-FOLDER/Load-hosts-metro-level.csv` | A-type hostname map (72 rows): `9.9.9.1 → can-tor-kem-r1` |

### Hostname Types After CSV Import
| Type | Format | Example |
|------|--------|---------|
| **A-type** | `{cc}-{city}-{district}-{role}{n}` | `can-tor-kem-r1`, `usa-nyc-man-r1` |
| **B-type** | Partial: `{cc}-{city}-{role}{n}` | `can-van-r1` |
| **C-type** | Plain hostname or IP | `ken-mob-r2`, `12.12.12.2` |

A-type nodes enable country-based K-SP routing and impact analysis.

### Countries Present (from CSV)
`CAN`, `USA`, `KEN`, `GBR`, `DEU`, `FRA`, `AUS`, `JPN`, `SGP`, `BRA`

---

## Test Phases (23-path-analysis-suite-e2e.cjs)

| Phase | Page | Key Assertions |
|-------|------|----------------|
| **A** | Main `/upload-ospf-isis-lsdb` | OSPF file uploaded → 84+ nodes; CSV applied → A-type nodes detected; localStorage written |
| **B** | Navbar | 4 new Analysis links present: K-Path Explorer, Change Planner, Impact Lab, Topo Diff |
| **C** | `/path-explorer` | A-type countries in dropdowns; K-SP FWD + REV paths computed; override row added |
| **D** | `/change-planner` | Nodes loaded; change row added; impact analysis runs; animate if A-type pairs affected |
| **E** | `/impact-lab` | Nodes loaded; node search works; blast rings visible; country impact table populated |
| **F** | `/topo-diff` | Snapshot dropdown present; Compare runs; diff table shown |
| **G** | Cross-page | K-Paths + Change Planner toolbar buttons present with correct hrefs |

---

## How to Run

### Option 1 — Shell runner (recommended, uses Docker e2e-runner)
```bash
bash 13-STEP-BY-STEP/scripts/run-path-analysis-validation.sh
```

### Option 2 — Direct (requires Node.js + Playwright on host)
```bash
cd /path/to/OSPF-DATABASE-TEST
BASE_URL=http://localhost:8081 \
API_USER=ospf@topolograph.com \
API_PASS=ospf \
node tests/23-path-analysis-suite-e2e.cjs
```

### Option 3 — Docker exec manually
```bash
docker compose --profile test up -d e2e-runner
docker compose exec e2e-runner \
  env BASE_URL=http://webserver:8081 API_USER=ospf@topolograph.com API_PASS=ospf \
  node /app/tests/23-path-analysis-suite-e2e.cjs
```

---

## Prerequisites

- Docker stack running: `docker compose up -d flask webserver pipeline`
- Input files present in `INPUT-FOLDER/`
- Credentials in `.env` (or passed via environment variables)

---

## Output

| Artifact | Location |
|----------|----------|
| Validation report (stdout + file) | `13-STEP-BY-STEP/validation-report.txt` |
| Screenshots (7 phases) | `13-STEP-BY-STEP/screenshots/` |

---

## Relation to Other Steps

| Step | Scope |
|------|-------|
| 10 | Web UI upload + enrichment pipeline |
| 11 | Security: auth, CSRF, layout-api |
| 12 | Orchestrated: runs 08 + 10 + 11 together |
| **13** | **Path Analysis Suite: K-SP, Change Planner, Impact Lab, Topo Diff with real A-type data** |
