# 10-STEP-BY-STEP — Test Matrix

## Goal

Validate the **current updated codebase** through the same major surfaces a user and operator now rely on:

- upload raw OSPF through the browser
- import hostnames through the browser
- validate all four main views
- validate current feature actions and panels
- validate layout persistence and export controls
- validate `INPUT-FOLDER`, `IN-OUT-FOLDER`, and `OUTPUT` artifacts

---

## Fixtures

| Type | File |
|---|---|
| OSPF input | `INPUT-FOLDER/ospf-database-54-unk-test.txt` |
| Host input | `INPUT-FOLDER/Load-hosts.csv` |

---

## Validation Units

### A. Artifact validation

Script:

- `tests/validate-step10-artifacts.cjs`

Checks:

- `INPUT-FOLDER` contains the packaged fixtures
- `IN-OUT-FOLDER/{graph_time}` contains:
  - `meta.json`
  - `nodes.json`
  - `edges.json`
  - `edges.csv`
- `OUTPUT/AS-IS/{graph_time}_AS-IS`
- `OUTPUT/GATEWAY/{graph_time}_GATEWAY`
- `OUTPUT/ENRICHED/{graph_time}_ENRICHED`
- `OUTPUT/COLLAPSING/{graph_time}_COLLAPSING`
- key file presence and minimal content sanity

### B. Full deep UI regression

Script:

- `tests/validate-full-e2e-v2.cjs`

Checks:

- login
- graph load
- `AS-IS`
- `GATEWAY`
- `ENRICHED`
- `CURRENT`
- `COLLAPSING`
- `UNK`
- Host File panel
- Cost Matrix
- What-If
- cross-mode behavior

### C. Web UI host import regression

Script:

- `tests/validate-webui-country-import.cjs`

Checks:

- upload raw OSPF through browser
- load hostname page
- import `Load-hosts.csv`
- update hostnames on graph
- reload graph
- verify hostname-derived country assignment
- verify `UNK` remains for IP-like/missing cases

### D. Country filter across all four views

Script:

- `tests/validate-country-filter-all-views.cjs`

Checks:

- `AS-IS` filter works
- `GATEWAY` filter works
- `ENRICHED` filter works
- `COLLAPSING` filter works
- country filter panel visibility
- country groups panel visibility where expected
- `UNK` panel visibility

### E. Feature-surface validation

Script:

- `tests/validate-features-full.cjs`

Checks:

- `Costs`
- `⚡ Asymm`
- `🌡 Heatmap`
- `📊 Matrix`
- `🛡 Redundancy`
- `⚠ UNK`
- `📂 Host File`
- `🗺 Cost Matrix`
- `🔬 What-If`
- node inspector
- collapsing actions and badges

### F. Layout and export validation

Script:

- `tests/validate-layout-persistence.cjs`

Checks:

- `💾 Save Layout`
- `📥 Load Layout`
- `♻ Reset Layout`
- `🎯 Reset Node`
- `YAML`
- `CSV`
- `Excel`

### G. Updated user walkthrough

Script:

- `tests/validate-step10-user-journey.cjs`

Checks:

- captures the current realistic browser journey with screenshots
- demonstrates upload → host import → graph load → views → panels → layout/export surface

---

## Screenshot Buckets

```text
10-STEP-BY-STEP/screenshots/
  full-e2e/
  host-import/
  all-views/
  features/
  layout/
  walkthrough/
```

---

## Edge-case hardening built into Step 10

- avoid writing screenshots into older step folders
- run stateful browser tests sequentially, not in parallel
- prefer explicit waits around upload/import/load transitions
- pass `GRAPH_TIME` into validators that depend on stable topology selection
- validate real artifact filenames from the current output layout instead of guessed names
