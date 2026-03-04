# COLLAPSING — Country Group Topology Feature
## Implementation Plan

### Scholar's Framing
This feature solves a classical graph visualisation problem: **scalability through semantic grouping**.
With 200+ routers across 10 countries, a flat topology is cognitively overloaded. The COLLAPSING
mode applies the computer science principle of *information hiding* — expose only the inter-domain
(gateway) structure, collapsing intra-domain detail on demand. This mirrors BGP's own abstraction:
BGP sees only AS-level routing, hiding internal OSPF details. We replicate that at the UI level.

---

## Current State (Confirmed by Code Reading)

| Property | Value |
|----------|-------|
| topolograph.js | 4,327 lines |
| vis.js | Custom `vis-network_with_label.js` (supports clustering API) |
| Node enrichment | `country`, `is_gateway`, `color`, `hostname` stored in vis.DataSet |
| Gateway detection | Cross-country edge → both endpoints are gateways |
| Current data | 34 routers: **28 gateways, 6 core** (ZAF:3, GBR:1, FRA:1, POR:1) |
| Country Filter panel | Dynamically injected JS (not in HTML template) |
| Edge visibility | `_syncEdgeVisibility()` — hides edges if EITHER endpoint hidden |

---

## Architecture Decision: Pure vis.DataSet hide/show (NOT vis.js clustering)

**Reason**: Gateway nodes must remain individually visible and addressable after collapse.
vis.js clustering merges them into one synthetic node — unacceptable for OSPF analysis.

**Core insight**: When country X is collapsed:
- All `is_gateway === false` nodes in X → `hidden: true`
- All edges touching hidden core nodes → `hidden: true` (via `_syncEdgeVisibility`)
- Gateway nodes in X remain fully visible and functional
- Inter-country edges (gateway→gateway) are unaffected — they survive ✓
- SPT server-side calculations unchanged — vis.DataSet `hidden` is UI-only ✓

**For double-click expand**: `network.on('doubleClick', ...)` → detect node country → toggle

---

## New Global State (additions to topolograph.js)

```javascript
// ── COLLAPSING feature state ───────────────────────────────────────────────────
var _collapseState   = {};  // { ZAF: true,  DRC: false, ... }
var _collapseHidden  = {};  // { ZAF: {nodeIds:Set, edgeIds:Set}, ... }
var _viewMode        = 'enriched'; // 'asis'|'gateway'|'enriched'|'collapsing'
var _cpPanelBuilt    = false;      // Country Groups panel built flag
var _nodeOrigLabels  = {};  // { nodeId: original_label } for badge removal
```

---

## Files To Be Created / Modified

| File | Action | Lines est. |
|------|--------|-----------|
| `topolograph-docker/init/topolograph.js` | APPEND ~450 lines of new code | +450 |
| `terminal-script/workflow.sh` | ADD step_generate_collapse + output dir + summary | +35 |
| `terminal-script/generate-collapse-config.py` | NEW Python script | ~130 |
| `01-STEP-BY-STEP/scripts/10-validate-collapsing.cjs` | NEW validation script | ~200 |
| `01-STEP-BY-STEP/aa-how-to-use-the-app.txt` | ADD COLLAPSING section | +50 |

---

## Frontend Implementation (topolograph.js additions)

### Section A: Helper utilities

```
_getCountryNodesByType(code)
  → returns { gateways: [...nodes], cores: [...nodes], all: [...] }
  → gateway = n.is_gateway === true
  → core    = !n.is_gateway (falsy)

_collapseEdgeIds(coreNodeIds)
  → returns array of edge IDs where e.from or e.to ∈ coreNodeIds
  → used by collapseCountry and expandCountry

_markGatewayCollapsed(countryCode, isCollapsed)
  → when isCollapsed=true:  borderWidth=3, borderDashes=[5,3], title badge "↓N cores hidden"
  → when isCollapsed=false: restore borderWidth=1, borderDashes=false, clear title badge
```

### Section B: Core collapse/expand functions

```
collapseCountry(code)
  1. get cores = _getCountryNodesByType(code).cores
  2. nodes.update(cores.map → hidden:true)
  3. edgeIds = _collapseEdgeIds(new Set(cores.map→id))
  4. edges.update(edgeIds.map → hidden:true)
  5. _markGatewayCollapsed(code, true)
  6. _collapseState[code] = true
  7. _collapseHidden[code] = {nodeIds, edgeIds}
  8. _updateCollapsePanel()

expandCountry(code)
  1. if !_collapseHidden[code]: return
  2. nodes.update(nodeIds.map → hidden:false)
  3. edges.update(edgeIds.map → hidden:false)
  4. _markGatewayCollapsed(code, false)
  5. _collapseState[code] = false
  6. delete _collapseHidden[code]
  7. _updateCollapsePanel()

toggleCollapseCountry(code)
  → _collapseState[code] ? expandCountry(code) : collapseCountry(code)

collapseAllCountries()
  → _getCountriesInGraph().forEach(code => collapseCountry(code))

expandAllCountries()
  → Object.keys(_collapseState).filter(c => _collapseState[c])
     .forEach(code => expandCountry(code))
```

### Section C: View Mode (4-button bar)

Buttons injected into the DOM at graph-load time (in setTimeout, same as buildCountryFilterPanel).
Position: new `<div id="viewModeBar">` appended to the graph container area.

```
buildViewModeButtons()
  → create #viewModeBar with 4 buttons: AS-IS | GATEWAY | ENRICHED | COLLAPSING
  → each button class="vmBtn btn btn-outline-secondary"
  → default active: ENRICHED

setViewMode(mode)
  'asis':
    - expandAllCountries() + resetCountryFilter()
    - nodes.update(all → color: {background:'#ccc', border:'#999'})
    - hide Country Groups panel, hide Country Filter panel

  'gateway':
    - expandAllCountries()
    - nodes.update: hidden = !n.is_gateway
    - _syncEdgeVisibility()
    - show only gateways, hide Country Groups panel

  'enriched':
    - expandAllCountries() + resetCountryFilter()
    - applyCountryColors() (re-colour all nodes)
    - show Country Filter panel, hide Country Groups panel

  'collapsing':
    - resetCountryFilter() (unhide all)
    - applyCountryColors()
    - hide Country Filter panel
    - buildCollapsePanel() if not built
    - show Country Groups panel
```

### Section D: Country Groups Panel (new floating panel)

Similar to buildCountryFilterPanel. ID: `#countryCollapsePanel`.
Position: top-right, offset 220px below Country Filter panel (or 80px if CF hidden).

Panel layout:
```
╔══════════════════════════════╗
║ 🗂 Country Groups         [−] ║
╠══════════════════════════════╣
║  [Collapse All]  [Expand All] ║
╠══════════════════════════════╣
║  🟠 ZAF  8 nodes  5gw  3core  [▼] ║  ← collapsed, click to expand
║  🟢 DRC  4 nodes  4gw  0core  [▶] ║  ← expanded, click to collapse
║  🔵 GBR  3 nodes  2gw  1core  [▶] ║
║  ...                          ║
╚══════════════════════════════╝
```

- Country rows are clickable → toggleCollapseCountry(code)
- ▼ = collapsed (click to expand), ▶ = expanded (click to collapse)
- Color swatch matches country color from COUNTRY_COLOR_PALETTE
- Counts: total / gw / core
- Drag-to-reposition (same mousedown pattern as CF panel)

_updateCollapsePanel() refreshes row states without rebuilding the whole panel.

### Section E: Double-click handler (in init_visjs_graph)

Added after existing network.on handlers:
```javascript
network.on('doubleClick', function(params) {
  if (params.nodes.length !== 1) return;
  if (_viewMode !== 'collapsing') return;
  var node = nodes.get(params.nodes[0]);
  if (!node || !node.country) return;
  toggleCollapseCountry(node.country.toUpperCase());
});
```

### Section F: Hook into existing init (line 495 setTimeout)

Add to the setTimeout at line 495:
```javascript
setTimeout(function() {
  if (typeof applyCountryColors === 'function') { applyCountryColors(); }
  if (typeof buildCountryFilterPanel === 'function') { buildCountryFilterPanel(); }
  // NEW:
  if (typeof buildViewModeButtons === 'function') { buildViewModeButtons(); }
  // Reset collapse state on graph reload
  _collapseState = {};
  _collapseHidden = {};
  _viewMode = 'enriched';
  _cpPanelBuilt = false;
}, 900);
```

---

## Pipeline Stage: COLLAPSING (workflow.sh + generate-collapse-config.py)

### New output folder structure

```
OUTPUT/COLLAPSING/{graph_time}_COLLAPSING/
  COLLAPSING_country-collapse-config.json
  COLLAPSING_collapsed-topology.json
  COLLAPSING_collapsed-topology.yaml
```

### generate-collapse-config.py

Input files (from ENRICHED stage):
- `ENRICHED_country-mapping.csv` (router_id, hostname, country_code, is_gateway)
- `AS-IS_nodes.json` (vis.js node list with id, label)
- `AS-IS_edges.json` (vis.js edge list with from, to, cost/label)

Algorithm:
1. Read country-mapping.csv → build per-country: gateways[], cores[]
2. Read AS-IS edges → filter inter-country vs intra-country
3. Build collapsed-topology: only gateway nodes + inter-country edges + intra-gateway edges
4. Write COLLAPSING_country-collapse-config.json
5. Write COLLAPSING_collapsed-topology.json/.yaml

### workflow.sh additions

1. Add `OUTPUT_COLLAPSING` variable
2. Add `step_generate_collapse_config()` function (runs generate-collapse-config.py)
3. Call it in main() after step_terminal_pipeline
4. Add to print_summary

---

## Validation Script (10-validate-collapsing.cjs)

Playwright script that:
1. Loads the enriched 34-host graph
2. Clicks "COLLAPSING" view mode button
3. Verifies Country Groups panel appears
4. Collapses ZAF → verifies 3 nodes hidden (18.18.18.3, .5, .6)
5. Double-clicks ZAF gateway → verifies ZAF expands (3 nodes visible again)
6. Clicks "Collapse All" → verifies 6 nodes total hidden
7. Clicks "Expand All" → verifies all 34 nodes visible
8. Tests AS-IS mode → verifies no country colors, all visible
9. Tests GATEWAY mode → verifies only 28 gateways visible
10. Verifies COLLAPSING output files exist on disk

---

## SPT Cost Calculation Integrity

**How OSPF shortest path works in Topolograph**:
- User right-clicks node → backend call: `GET /get_spt_path?graph_id=X&from=A&to=B`
- Server computes Dijkstra on the FULL stored graph (MongoDB, unchanged)
- Returns coloured path edges and costs
- vis.js just renders the coloured edges

**Impact of COLLAPSING**: ZERO. The `hidden` property is a vis.js UI-only flag.
The server never sees it. Dijkstra runs on all 34 nodes/108 edges regardless.
✓ All calculations remain intact.

---

## Visual Design

### Gateway node when country is collapsed
- `borderWidth: 3` (thicker border)
- `borderDashes: [6, 3]` (dashed border = "there's more inside")
- `title` tooltip: "ZAF gateway [3 core routers collapsed]"
- Shape: unchanged (dot) — avoids disrupting layout

### View Mode Button Bar
- Injected as `<div id="viewModeBar" style="margin:4px 0; display:inline-flex; gap:4px;">` 
- Inserted after the `#togg_buttons2` div (query and insertAdjacentElement)
- 4 buttons with Bootstrap `btn-outline-secondary` + `.active` → `btn-primary`

---

## Implementation Order (sequential — each depends on previous)

1. `generate-collapse-config.py` — self-contained Python, validates data model
2. `workflow.sh` — add COLLAPSING stage, run to generate output files
3. `topolograph.js` — the main UI work (appendix block at end of file):
   a. Global state vars
   b. _getCountryNodesByType, _collapseEdgeIds, _markGatewayCollapsed
   c. collapseCountry, expandCountry, toggleCollapseCountry
   d. collapseAllCountries, expandAllCountries
   e. setViewMode
   f. buildViewModeButtons
   g. buildCollapsePanel + _updateCollapsePanel
   h. Add doubleClick handler inside init_visjs_graph
   i. Extend the setTimeout at line 495
4. Reload Docker (topolograph.js is bind-mounted — just browser refresh)
5. `10-validate-collapsing.cjs` — Playwright validation
6. Documentation update

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| expandCountry restores edges already hidden by Country Filter | Track _collapseHidden per-operation; only restore edges in that set |
| Physics re-runs on collapse (layout jumps) | Use physics:false during show/hide operations |
| Gateway badge persists after graph reload | Reset _collapseState in the setTimeout hook |
| vis.js DataSet update causes render flicker | Batch all updates, call nodes.update([...]) once |
| Double-click conflict with existing selectNode handler | Check _viewMode === 'collapsing' before acting |

---
