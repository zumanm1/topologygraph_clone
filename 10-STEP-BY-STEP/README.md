# 10-STEP-BY-STEP
## Updated Full Web UI User-Journey Validation Pack

This folder captures the **updated end-to-end validation flow** for how a normal user now uses the application through the Web UI and the Docker-native stack.

It is designed as a **new non-destructive step suite**:

- it does **not** replace `05-STEP-BY-STEP`
- it does **not** replace `07-STEP-BY-STEP`
- it does **not** replace `08-STEP-BY-STEP`
- it does **not** replace `09-STEP-BY-STEP`

Instead, `10-STEP-BY-STEP` packages the current updated behavior into a single reusable validation family that proves:

- packaged repository fixtures can still be used end to end
- the Docker stack can still generate `IN-OUT-FOLDER` and `OUTPUT` artifacts
- the Web UI user flow still works through upload, host import, graph load, filtering, view switching, and feature actions
- the updated code still supports all four main views:
  - `AS-IS`
  - `GATEWAY`
  - `ENRICHED`
  - `COLLAPSING`
- the current feature surface is still present and testable:
  - `Costs`
  - `⚡ Asymm`
  - `🌡 Heatmap`
  - `📊 Matrix`
  - `🛡 Redundancy`
  - `⚠ UNK`
  - `📂 Host File`
  - `🗺 Cost Matrix`
  - `🔬 What-If`
  - `💾 Save Layout`
  - `📥 Load Layout`
  - `♻ Reset Layout`
  - `🎯 Reset Node`
  - `YAML`
  - `CSV`
  - `Excel`

---

## What 10 Runs

The Step 10 runner packages six validations:

1. **Pipeline / artifact generation**
   - uploads the packaged OSPF fixture through the Web UI
   - runs `workflow.sh enrich-existing` for the resolved `graph_time`
   - validates `INPUT-FOLDER`, `IN-OUT-FOLDER`, and `OUTPUT`

2. **Full deep UI regression**
   - reuses the current deep Playwright validator for the updated code

3. **Host CSV import regression**
   - validates the normal Web UI host import flow

4. **Country filter across all four views**
   - proves filtering works in `AS-IS`, `GATEWAY`, `ENRICHED`, `COLLAPSING`

5. **Feature surface validation**
   - validates the current toolbar / panel feature set

6. **Layout + export validation**
   - validates save/load/reset/reset-node and YAML/CSV/Excel export triggers

7. **Updated walkthrough**
   - captures a realistic user journey with screenshots for the current code

---

## Folder Layout

```text
10-STEP-BY-STEP/
  README.md
  validation-report.txt
  docs/
    01-TEST-MATRIX.md
    02-HOW-TO-RUN.md
  scripts/
    run-updated-webui-validation.sh
  screenshots/
    full-e2e/
    host-import/
    all-views/
    features/
    layout/
    walkthrough/
```

---

## Quick Start

From the project root:

```bash
bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```

Optional visible browser mode:

```bash
HEADLESS=false bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```

---

## Inputs Used

The Step 10 suite uses the packaged fixtures in `INPUT-FOLDER/`:

- `ospf-database-54-unk-test.txt`
- `Load-hosts.csv`

That combination matches the current updated Web UI regression focus:

- upload raw OSPF through the UI
- generate a real `graph_time` through the browser-side upload path
- enrich the uploaded graph through the terminal pipeline using `enrich-existing`
- import hostnames through the hostname page
- derive countries from hostname prefixes
- preserve `UNK` routers where hostnames are missing or IP-like
- infer `is_gateway` on the raw-upload path in the browser runtime

---

## Output Expectations

The suite validates these artifact families for the resolved `graph_time`:

- `IN-OUT-FOLDER/{graph_time}/`
  - `meta.json`
  - `nodes.json`
  - `edges.json`
  - `edges.csv`

- `OUTPUT/AS-IS/{graph_time}_AS-IS/`
- `OUTPUT/GATEWAY/{graph_time}_GATEWAY/`
- `OUTPUT/ENRICHED/{graph_time}_ENRICHED/`
- `OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/`

---

## Relationship To Older Step Suites

- `05` established the earlier full validation style
- `07` documented the new-file pipeline and artifact structure
- `08` established the canonical Docker-native rebuild/retest path
- `09` isolated the hostname-derived country-code regression
- `10` packages the **current updated user journey + feature validation** into one new suite for the updated codebase
