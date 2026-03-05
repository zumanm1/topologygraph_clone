# Topolograph OSPF — Feature Planning PRD
## All 5 View Modes: AS-IS · GATEWAY · ENRICHED · COLLAPSING · DB2

```
Author    : Scholar Analysis (Session 2026-03-04)
Codebase  : OSPF-DATABASE-TEST / topolograph-docker
References: 00-STEP-BY-STEP, 01-STEP-BY-STEP, 02-STEP-BY-STEP
Test data : INPUT-FOLDER/ospf-database-2.txt
             34 routers · 10 countries · 108 edges · 28 gateways · 6 cores
```

---

## 0. Dataset Reference (Grounded in ospf-database-2.txt)

| Country | Code | Routers | Gateways | Cores | Colour |
|---|---|---|---|---|---|
| South Africa | ZAF | 8 | 5 | 3 | `#FF8C42` |
| D.R. Congo | DRC | 4 | 4 | 0 | `#4ECDC4` |
| Mozambique | MOZ | 4 | 4 | 0 | `#45B7D1` |
| United Kingdom | GBR | 3 | 2 | 1 | `#4D96FF` |
| France | FRA | 3 | 2 | 1 | `#F77F00` |
| Lesotho | LES | 3 | 3 | 0 | `#C77DFF` |
| Portugal | POR | 3 | 2 | 1 | `#06D6A0` |
| Kenya | KEN | 2 | 2 | 0 | `#6BCB77` |
| Tanzania | TAN | 2 | 2 | 0 | `#FFD93D` |
| Djibouti | DJB | 2 | 2 | 0 | `#FF6B6B` |
| **TOTAL** | | **34** | **28** | **6** | |

**Core routers** (hidden in COLLAPSING): `gbr-lon-r3`, `fra-par-r3`, `por-lis-r3`, `zaf-prs-r1`, `zaf-mtb-r1`, `zaf-jnb-r2`

**Hostname pattern**: `{country_code}-{city_abbrev}-r{N}` — e.g. `zaf-cpt-r1` = South Africa / Cape Town / Router 1

**IP scheme**: 9.x = LES · 10.x = TAN · 11.x = MOZ · 12.x = KEN · 13.x = DRC · 14.x = DJB · 15.x = GBR · 16.x = FRA · 17.x = POR · 18.x = ZAF

---

## Priority Framework

| Level | Label | Definition |
|---|---|---|
| P1 | **Critical** | Directly enables core OSPF engineer workflows; blocks understanding without it |
| P2 | **High** | Significantly improves depth of understanding; builds on P1 features |
| P3 | **Valuable** | Adds breadth or convenience; completes the feature set |

**Effort sizing**: S = < 1 day · M = 1–3 days · L = 3–7 days (one engineer)

---

## GLOBAL BASELINE — HOT-F0: Hostname + IP Dual-Label on All Nodes

> **This feature is a prerequisite for ALL 5 modes. Implement it first.**

### OSPF Engineer Use Case

An OSPF engineer looking at the canvas today sees only IP addresses (e.g. `18.18.18.1`). They cannot identify a router by its operational name without consulting a separate spreadsheet. The `Load-hosts.txt` mapping file already provides hostnames — they must appear on the graph canvas.

For unmapped nodes (UNK — grey, no hostname in Load-hosts.txt), the IP alone is shown, preserving visibility without confusion.

### Current State

- `AS-IS_nodes.json` contains `{id, label: "IP", name: "IP"}` — IP only
- After `push-to-ui.py` PATCH, MongoDB node gains `hostname` field but **does not update `label`**
- `topolograph.js > setViewMode('asis')` greys node colours but leaves `label` unchanged
- Result: **canvas always shows IP only**, regardless of mode

### Target State

```
┌─────────────────┐     ┌─────────────────┐
│   18.18.18.1    │  →  │   zaf-cpt-r1    │
│   (raw IP only) │     │   18.18.18.1    │
└─────────────────┘     └─────────────────┘

For unmapped (UNK) nodes:
┌─────────────────┐   unchanged   ┌─────────────────┐
│   99.99.99.9    │   ──────────  │   99.99.99.9    │
│                 │               │   (UNK)         │
└─────────────────┘               └─────────────────┘
```

### Implementation Plan

**File: `terminal-script/push-to-ui.py`**

In the PATCH payload per node, add the `label` field:

```python
# Current (patch_data only sets country, hostname, color, title, group, is_gateway)
# Add this line to the payload builder:
"label": f"{hostname}\n{router_id}" if hostname else router_id
```

The vis.js vis-network `label` field supports `\n` newlines when `font.multi` is not required. This renders as two-line text natively.

**File: `topolograph-docker/init/topolograph.js`**

In `setViewMode('asis')` (line ~4577), the mode greys colours but must NOT overwrite labels. The current code only calls `nodes.update(nodes.get().map(n => ({id: n.id, color: {...}})))` — labels are untouched. ✅ No change needed here.

In `applyCountryColors()` (line ~4091), the guard `if (n.color && n.color.background) return` skips already-coloured nodes. This is fine — label is not affected by `applyCountryColors`. ✅ No change needed.

**For COLLAPSING mode**: When collapsing, `_markGatewayCollapsed()` appends to `title` (tooltip). It must not clobber `label`. Currently it doesn't — ✅ safe.

**Pipeline change**: Update `push-to-ui.py`. No Docker rebuild required (it's a `terminal-script/`, not inside the container). No schema change to the API.

**Acceptance Criteria**
- [ ] After `push-to-ui.py` runs, canvas shows `hostname\nIP` on every mapped node
- [ ] Unmapped nodes (UNK) show `IP\n(UNK)`
- [ ] Labels persist across mode switches (AS-IS / GATEWAY / ENRICHED / COLLAPSING)
- [ ] SPT dropdown still shows correct node identifiers (uses `label` field in options — ensure dropdown uses IP or RID separately, not the multiline label)

**Priority**: P1 · Effort: S (< 2 hours)

---

---

# PART 1 — AS-IS MODE

## Purpose

Raw OSPF topology as Topolograph captured it — no enrichment, no country context, pure protocol adjacency. Designed for:

- **Topology audit**: Does the adjacency table match the network design doc?
- **Initial discovery**: What routers and links exist in this OSPF domain?
- **Protocol debugging**: Any unexpected adjacencies? Any asymmetric costs?
- **Compliance**: Does the observed OSPF state match the intended config?

**Current behaviour**: 34 grey nodes, 108 edges, SPT available, no labels beyond IP.

---

## AS-F1 — Edge OSPF Cost Labels on Canvas

**Priority**: P1 · Effort: S

### OSPF Engineer Use Case

OSPF routing is entirely driven by link cost (metric). An engineer cannot assess a topology without seeing costs. Today, costs are buried in a right-click popup table — the canvas shows only adjacencies with no cost information. Displaying costs on edges transforms the canvas from a connectivity diagram into an OSPF routing diagram.

**Data source**: `OUTPUT/AS-IS/{gt}_AS-IS/AS-IS_edges.json` — each edge has `{from, to, cost, label}`.

### Feature Description

Each edge on the canvas displays its OSPF cost as a label centred on the edge. A toggle checkbox hides/shows all cost labels. Edges with cost > threshold (e.g. cost > 100) are highlighted orange to flag expensive links.

```
     [zaf-cpt-r1]              [gbr-lon-r1]
          │                         │
          ├──────── cost: 10 ────────┤
          │                         │
```

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`**

After the `upload_ospf_lsdb()` completes and the graph loads (inside the `setTimeout` callback at line ~495), add:

```javascript
// AS-F1: Apply OSPF cost labels to edges
function _applyCostLabels(show) {
  if (typeof edges === 'undefined' || !edges) return;
  edges.update(edges.get().map(e => ({
    id: e.id,
    label: show ? String(e.cost || '') : '',
    font: { size: 10, color: '#555', align: 'middle' },
    // Flag expensive edges (cost > 100) with orange colour
    color: (show && e.cost > 100)
      ? { color: '#e67e22', highlight: '#e67e22', hover: '#e67e22' }
      : undefined
  })));
}
```

Add a toggle checkbox to the toolbar:
```html
<label id="costLabelToggle">
  <input type="checkbox" id="chkCostLabels" onchange="_applyCostLabels(this.checked)">
  Show edge costs
</label>
```

Inject the checkbox into the Topolograph toolbar alongside the existing SPT controls (inside `buildViewModeButtons()` or immediately after).

**Mode integration**: Call `_applyCostLabels(false)` on mode switch to GATEWAY (cost labels on the full graph are noisy in that mode). Restore to user preference on switch back to AS-IS/ENRICHED.

**Acceptance Criteria**
- [ ] "Show edge costs" checkbox is visible in toolbar
- [ ] When checked: every edge displays its numeric OSPF cost centred on the edge
- [ ] Edges with cost > 100 turn orange when checkbox is active
- [ ] When unchecked: all cost labels hidden, edge colours restored
- [ ] Labels remain readable at all zoom levels (vis.js handles this natively)

---

## AS-F2 — LSDB Metadata Hover Tooltip

**Priority**: P1 · Effort: M

### OSPF Engineer Use Case

The raw OSPF LSDB header (from `ospf-database-2.txt`) contains per-router metadata that is rich with diagnostic information:

```
Link ID      ADV Router    Age     Seq#         Checksum  Link count
9.9.9.1      9.9.9.1       786     0x80000003   0x00F060  7
```

- **Age**: If a router's LSDB age is approaching 3600s (MaxAge), its LSA is about to expire — potential instability
- **Seq#**: Increasing sequence numbers show active OSPF reconvergence
- **Link count**: A router with link_count=9 is highly connected; link_count=2 is a stub
- **Checksum**: Used in protocol verification

Currently this data is parsed by Topolograph server-side but **never surfaced on the canvas**. Hovering a node shows nothing useful.

### Feature Description

Hover over any node → a rich tooltip appears showing LSDB metadata for that router:

```
╔══════════════════════════════════╗
║  zaf-cpt-r1                     ║
║  18.18.18.1                     ║
╠══════════════════════════════════╣
║  OSPF Area  :  Area 0           ║
║  Age        :  786 s            ║
║  Seq#       :  0x80000003       ║
║  Checksum   :  0x00F060         ║
║  Link Count :  7                ║
║  Country    :  ZAF              ║
║  Role       :  Gateway          ║
╚══════════════════════════════════╝
```

### Implementation Plan

**Phase A — Pipeline: Extract LSDB metadata**

**File: `terminal-script/topology-country-tool.sh`** or a new companion script `parse-lsdb-meta.py`:

Parse the LSDB header block from `ospf-database-2.txt`:
```python
import re, json

lsdb_meta = {}
pattern = re.compile(
    r'^(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+(0x\w+)\s+(0x\w+)\s+(\d+)'
)
for line in open('ospf-database-2.txt'):
    m = pattern.match(line.strip())
    if m:
        rid = m.group(1)
        lsdb_meta[rid] = {
            'age': int(m.group(3)),
            'seq': m.group(4),
            'checksum': m.group(5),
            'link_count': int(m.group(6))
        }
json.dump(lsdb_meta, open('lsdb-meta.json', 'w'), indent=2)
```

**Phase B — Pipeline: Inject into PATCH payload**

**File: `terminal-script/push-to-ui.py`**

Load `lsdb-meta.json` and include in the `title` HTML field per node:

```python
meta = lsdb_meta.get(router_id, {})
title_html = f"""
<b>{hostname}</b> ({router_id})<br>
Country: {country} | Role: {'Gateway' if is_gw else 'Core'}<br>
Age: {meta.get('age','—')} s | Seq: {meta.get('seq','—')}<br>
Link Count: {meta.get('link_count','—')} | Checksum: {meta.get('checksum','—')}
"""
patch_data['title'] = title_html
```

**Phase C — UI: No topolograph.js changes needed**

vis.js already renders `node.title` as an HTML tooltip on hover. The field is already in the PATCH payload schema — just needs content.

**Note on Age alerting**: Add a CSS class indicator to the label or a border color when `age > 1800` (30 min — LSA nearing half-life):
```python
if meta.get('age', 0) > 1800:
    patch_data['borderWidth'] = 3
    patch_data['color']['border'] = '#e74c3c'  # red border = aging LSA
```

**Acceptance Criteria**
- [ ] Hover over any node shows tooltip with: hostname, IP, country, role, OSPF age, Seq#, link count
- [ ] Nodes with LSDB age > 1800s show red border
- [ ] Tooltip appears within 300ms of hover (vis.js native)
- [ ] UNK nodes show tooltip with IP + "Unmapped — no hostname in Load-hosts.txt"

---

## AS-F3 — Asymmetric Link Highlighter

**Priority**: P2 · Effort: M

### OSPF Engineer Use Case

OSPF is a symmetric link-state protocol — in a correctly configured network, OSPF cost from A→B equals cost from B→A. When costs are asymmetric (deliberately or by misconfiguration), routing becomes asymmetric: traffic flows A→B on one path, B→A on another. This creates:
- Asymmetric routing that breaks stateful firewalls
- Unexpected traffic patterns
- Difficult-to-debug connectivity issues

**Data available**: `AS-IS_edges.json` has directional edges with `cost`. By grouping edges by the `{min(from,to), max(from,to)}` node pair and comparing costs in each direction, asymmetry is immediately detectable.

### Feature Description

A button "Show Asymmetric Links" appears in the toolbar. When clicked:
- Scans all edges for pairs where `cost(A→B) ≠ cost(B→A)`
- Highlights those edges in bright orange with bidirectional arrows
- Opens a small panel: "Asymmetric Links Found: N" listing each pair with their costs
- Clicking a row in the panel zooms to that edge in the graph

```
[GBR-lon-r1] ──── cost: 10 ────→ [ZAF-cpt-r1]
[GBR-lon-r1] ←── cost: 100 ──── [ZAF-cpt-r1]
↑ ASYMMETRIC — highlighted orange
```

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `detectAsymmetricLinks()`:

```javascript
function detectAsymmetricLinks() {
  if (typeof edges === 'undefined') return;
  var allEdges = edges.get();
  var pairMap = {};   // key: "minId_maxId" → { forward: cost, reverse: cost, ids: [] }

  allEdges.forEach(function(e) {
    var key = [Math.min(e.from, e.to), Math.max(e.from, e.to)].join('_');
    if (!pairMap[key]) pairMap[key] = { forward: null, reverse: null, ids: [] };
    if (e.from < e.to) pairMap[key].forward = e.cost;
    else               pairMap[key].reverse = e.cost;
    pairMap[key].ids.push(e.id);
  });

  var asymmetric = [];
  Object.entries(pairMap).forEach(([key, pair]) => {
    if (pair.forward !== null && pair.reverse !== null && pair.forward !== pair.reverse) {
      asymmetric.push({ key, pair });
      // Highlight
      pair.ids.forEach(id => edges.update({
        id, color: { color: '#e67e22', highlight: '#e67e22' },
        width: 3
      }));
    }
  });

  // Build report panel
  _buildAsymmetricPanel(asymmetric);
}
```

Panel injection mirrors the Country Filter panel pattern already in the codebase.

**Acceptance Criteria**
- [ ] Button "Asymmetric Links" in toolbar
- [ ] Clicking identifies all asymmetric node pairs and highlights edges orange
- [ ] Panel shows count + list of asymmetric pairs with cost values
- [ ] Clicking a row in the panel calls `network.focus(nodeId)` to zoom to that link
- [ ] Second click on button clears highlights and hides panel

---

## AS-F4 — Node Degree Heatmap

**Priority**: P2 · Effort: S

### OSPF Engineer Use Case

OSPF floods LSAs through the network. Routers with many adjacencies (high degree) flood more copies and process more DBD packets — they are OSPF processing bottlenecks. An engineer designing a large OSPF domain wants to identify high-degree nodes to ensure they have sufficient CPU.

In the test dataset, `gbr-lon-r1` has link_count=9 (highest), `djb-db-r1` has link_count=5 (lowest). This heatmap instantly shows the OSPF flooding load distribution.

### Feature Description

Toggle "Degree Heatmap" in toolbar → nodes recolour from blue (low degree) to red (high degree):

```
Blue (#3498db)   = degree 1–3  (stub/low adjacency)
Yellow (#f1c40f) = degree 4–6  (normal)
Red (#e74c3c)    = degree 7+   (high adjacency, OSPF bottleneck risk)
```

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `applyDegreeHeatmap()`:

```javascript
function applyDegreeHeatmap(enable) {
  if (!enable) { applyCountryColors(); return; }    // restore country colours

  var allEdges = edges.get();
  var degree = {};

  // Count adjacencies per node
  allEdges.forEach(function(e) {
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to]   = (degree[e.to]   || 0) + 1;
  });

  var maxDeg = Math.max(...Object.values(degree));

  nodes.update(nodes.get().map(function(n) {
    var d = degree[n.id] || 0;
    var ratio = d / maxDeg;
    // Linear interpolation: blue → yellow → red
    var bg = ratio < 0.5
      ? _lerpColor('#3498db', '#f1c40f', ratio * 2)
      : _lerpColor('#f1c40f', '#e74c3c', (ratio - 0.5) * 2);
    return { id: n.id, color: { background: bg, border: '#333' } };
  }));
}

function _lerpColor(c1, c2, t) {
  // Hex color lerp helper
  var r1=parseInt(c1.slice(1,3),16), g1=parseInt(c1.slice(3,5),16), b1=parseInt(c1.slice(5,7),16);
  var r2=parseInt(c2.slice(1,3),16), g2=parseInt(c2.slice(3,5),16), b2=parseInt(c2.slice(5,7),16);
  var r=Math.round(r1+(r2-r1)*t), g=Math.round(g1+(g2-g1)*t), b=Math.round(b1+(b2-b1)*t);
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
```

**Acceptance Criteria**
- [ ] "Degree Heatmap" toggle in toolbar (checkbox or button)
- [ ] All 34 nodes recolour by degree on activation
- [ ] Colour legend shown: "Low ■ ■ ■ High"
- [ ] Toggle off restores country colours (calls `applyCountryColors()`)
- [ ] Tooltip (node `title`) shows degree count: "Degree: 9 adjacencies"

---

## AS-F5 — Graph Export (JSON / DOT / CSV)

**Priority**: P3 · Effort: M

### OSPF Engineer Use Case

OSPF engineers frequently need to import topology data into external tools:
- **Graphviz DOT**: For generating publication-quality topology diagrams
- **CSV**: For feeding NMS systems (Nagios, Zabbix, LibreNMS)
- **JSON**: For custom scripts and automation
- The pipeline already generates `AS-IS_nodes.json` and `AS-IS_edges.json` — a one-click export packages them

### Feature Description

"Export" dropdown in toolbar with three options:
1. **Export JSON** → Downloads `topo-{graph_time}.json` with `{nodes[], edges[], meta}`
2. **Export CSV** → Downloads `topo-{graph_time}.csv` with one row per edge (from, from_hostname, to, to_hostname, cost)
3. **Export DOT** → Downloads `topo-{graph_time}.dot` for Graphviz rendering

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `exportTopology(format)`:

```javascript
function exportTopology(format) {
  var ns = nodes.get();
  var es = edges.get();

  var content, filename, mime;

  if (format === 'json') {
    content = JSON.stringify({ nodes: ns, edges: es }, null, 2);
    filename = 'topology.json'; mime = 'application/json';

  } else if (format === 'csv') {
    var rows = ['from_ip,from_host,to_ip,to_host,cost'];
    es.forEach(function(e) {
      var fn = ns.find(n=>n.id===e.from), tn = ns.find(n=>n.id===e.to);
      rows.push([fn?.label,fn?.hostname||'',tn?.label,tn?.hostname||'',e.cost].join(','));
    });
    content = rows.join('\n'); filename = 'topology.csv'; mime = 'text/csv';

  } else if (format === 'dot') {
    var lines = ['graph ospf {'];
    ns.forEach(n => lines.push(`  "${n.label}" [label="${n.hostname||n.label}"];`));
    es.forEach(e => {
      var fn=ns.find(n=>n.id===e.from), tn=ns.find(n=>n.id===e.to);
      lines.push(`  "${fn?.label}" -- "${tn?.label}" [label="${e.cost}"];`);
    });
    lines.push('}');
    content = lines.join('\n'); filename = 'topology.dot'; mime = 'text/plain';
  }

  // Trigger browser download
  var blob = new Blob([content], {type: mime});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
```

**Acceptance Criteria**
- [ ] Export dropdown accessible in all view modes
- [ ] JSON export produces valid JSON parseable by Python/Node
- [ ] CSV export usable as NMS input (one edge per row)
- [ ] DOT export renderable by `dot -Tpng topology.dot -o topology.png`
- [ ] Exported filenames include `graph_time` for auditability

---

---

# PART 2 — GATEWAY MODE

## Purpose

Inter-country backbone view. Shows **only the 28 gateway (border) routers** — the 6 core/internal routers are hidden. Designed for:

- **Cross-country link planning**: Which countries connect to which, and how redundantly?
- **Failure impact analysis**: If ZAF gateways go down, which countries lose connectivity?
- **NMS seed**: The GATEWAY topology is the ideal input for cross-country monitoring
- **BGP analogy**: Like a BGP AS-level topology, but derived from OSPF

**Current behaviour**: 28 gateway nodes visible with country colours, no panels, no additional context.

---

## GW-F1 — Cross-Country Connectivity Matrix

**Priority**: P1 · Effort: M

### OSPF Engineer Use Case

A network manager needs to answer: "Which countries can reach which?" and "How many inter-country links exist between each pair?" The current graph shows this visually but not quantitatively. With 10 countries, a 10×10 matrix gives immediate, scannable answers.

**Data source**: `OUTPUT/GATEWAY/{gt}_GATEWAY/GATEWAY_gateway-only-topology.json` — contains gateway nodes with country codes and inter-country edges.

### Feature Description

A floating panel "Country Connectivity Matrix" (toggled from toolbar) shows a 10×10 grid:

```
       ZAF  GBR  FRA  POR  DRC  MOZ  KEN  TAN  LES  DJB
ZAF  [  —    2    1    1    0    2    0    0    0    0  ]
GBR  [  2    —    2    1    0    0    0    0    0    0  ]
FRA  [  1    2    —    1    0    0    0    0    0    0  ]
...
```

- Cell value = number of direct inter-country gateway links between that pair
- Cell is green if ≥ 2 (redundant), yellow if = 1 (single point of failure), empty if 0 (no direct link)
- Click any non-zero cell → highlight those edges on the graph canvas

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `buildConnectivityMatrix()`:

```javascript
function buildConnectivityMatrix() {
  var allEdges = edges.get().filter(e => !e.hidden);
  var allNodes = nodes.get();
  var nodeCountry = {};
  allNodes.forEach(n => { nodeCountry[n.id] = (n.country || 'UNK').toUpperCase(); });

  // Build matrix
  var countries = [...new Set(Object.values(nodeCountry))].sort();
  var matrix = {};
  var edgesPerPair = {};

  countries.forEach(c1 => {
    matrix[c1] = {};
    edgesPerPair[c1] = {};
    countries.forEach(c2 => { matrix[c1][c2] = 0; edgesPerPair[c1][c2] = []; });
  });

  allEdges.forEach(function(e) {
    var c1 = nodeCountry[e.from], c2 = nodeCountry[e.to];
    if (c1 && c2 && c1 !== c2) {
      matrix[c1][c2]++;
      matrix[c2][c1]++;
      edgesPerPair[c1][c2].push(e.id);
      edgesPerPair[c2][c1].push(e.id);
    }
  });

  // Build HTML table
  var html = '<table id="connMatrix"><tr><th></th>';
  countries.forEach(c => html += `<th>${c}</th>`);
  html += '</tr>';

  countries.forEach(c1 => {
    html += `<tr><th>${c1}</th>`;
    countries.forEach(c2 => {
      if (c1 === c2) { html += '<td class="cmDiag">—</td>'; return; }
      var n = matrix[c1][c2];
      var cls = n === 0 ? 'cmZero' : n === 1 ? 'cmSingle' : 'cmRedundant';
      var eids = JSON.stringify(edgesPerPair[c1][c2]);
      html += `<td class="${cls}" onclick="_highlightEdges(${eids})">${n || ''}</td>`;
    });
    html += '</tr>';
  });
  html += '</table>';

  // Render panel (fixed position, bottom-left)
  document.getElementById('connMatrixPanel').innerHTML = html;
  document.getElementById('connMatrixPanel').style.display = 'block';
}

function _highlightEdges(edgeIds) {
  // Reset all edge colours, then highlight selected
  edges.update(edges.get().map(e => ({id: e.id, color: undefined, width: 1})));
  edges.update(edgeIds.map(id => ({id, color: {color:'#e74c3c'}, width: 4})));
}
```

CSS for cells: `.cmSingle { background: #ffe97d; }` `.cmRedundant { background: #a8e6cf; }`

**Acceptance Criteria**
- [ ] "Connectivity Matrix" button in GATEWAY mode toolbar
- [ ] Matrix shows correct link counts for all 10×10 country pairs
- [ ] Green cells for ≥2 links, yellow for exactly 1 (SPOF)
- [ ] Clicking a cell highlights those edges on the canvas
- [ ] Empty cells (0 direct links) show no number

---

## GW-F2 — Edge Cost Labels + Cost-Based Colouring

**Priority**: P1 · Effort: S

### OSPF Engineer Use Case

In GATEWAY mode, the visible edges are all inter-country. These are the most strategically important links in the network — they determine how OSPF traffic is routed between countries. An engineer planning a new country peering (e.g. adding a DJB–KEN link) needs to know the costs of existing cross-country links to set the new link's cost appropriately.

### Feature Description

In GATEWAY mode:
- Every inter-country edge shows its OSPF cost as a label
- Edges are coloured by cost range:
  - Green (`#27ae60`): cost ≤ 10 (low-cost/preferred)
  - Yellow (`#f39c12`): cost 11–100 (medium)
  - Red (`#e74c3c`): cost > 100 (high-cost/backup)
- A legend panel explains the colour scheme

### Implementation Plan

Called during `setViewMode('gateway')` in `topolograph.js` — after the hidden/visible update, additionally call `_applyGatewayCostStyle()`:

```javascript
function _applyGatewayCostStyle() {
  edges.update(edges.get().map(function(e) {
    if (e.hidden) return { id: e.id };
    var cost = e.cost || 0;
    var clr = cost <= 10 ? '#27ae60' : cost <= 100 ? '#f39c12' : '#e74c3c';
    return {
      id: e.id,
      label: String(cost),
      font: { size: 11, color: '#333', align: 'middle' },
      color: { color: clr, highlight: clr, hover: clr },
      width: cost <= 10 ? 3 : cost <= 100 ? 2 : 1   // thick = cheap
    };
  }));
}
```

**Acceptance Criteria**
- [ ] All visible inter-country edges show cost labels in GATEWAY mode
- [ ] Green/Yellow/Red cost colouring applied consistently
- [ ] Legend panel visible in GATEWAY mode
- [ ] Switching away from GATEWAY mode resets edge colours

---

## GW-F3 — Single-Country Failure Simulation

**Priority**: P2 · Effort: L

### OSPF Engineer Use Case

"What happens to the network if ZAF (8 routers, 5 gateways) goes offline?" This is the most critical OSPF planning question. Today, there is no way to answer it without manually tracing paths in the graph. The failure simulator answers this instantly.

**OSPF context**: When a gateway router fails, the OSPF LSA ages out (MaxAge = 3600s) and is flooded with age=3600. All routers remove it from their LSDB and recompute SPT. If the failed router was the only path between two other countries, those countries lose connectivity.

### Feature Description

In GATEWAY mode, a "Failure Simulator" panel appears:
1. User selects a country to fail from a dropdown
2. Click "Simulate Failure"
3. The simulation hides all that country's gateway nodes/edges
4. A BFS connectivity analysis runs on the remaining graph
5. The panel shows: "Connected islands after ZAF failure: [GBR, FRA, POR] | [DRC, MOZ, KEN, TAN, LES, DJB]"
6. Disconnected country groups are highlighted with distinct colours

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `simulateCountryFailure(code)`:

```javascript
function simulateCountryFailure(failedCode) {
  var allNodes = nodes.get();
  var allEdges = edges.get();
  var nodeCountry = {};
  allNodes.forEach(n => nodeCountry[n.id] = (n.country||'UNK').toUpperCase());

  // Build adjacency list excluding failed country
  var adj = {};
  allNodes.filter(n => nodeCountry[n.id] !== failedCode).forEach(n => adj[n.id] = []);
  allEdges.forEach(e => {
    if (nodeCountry[e.from] !== failedCode && nodeCountry[e.to] !== failedCode) {
      adj[e.from] && adj[e.from].push(e.to);
      adj[e.to]   && adj[e.to].push(e.from);
    }
  });

  // BFS to find connected components
  var visited = new Set(), components = [];
  Object.keys(adj).forEach(function(start) {
    if (visited.has(+start)) return;
    var component = [], queue = [+start];
    while (queue.length) {
      var node = queue.shift();
      if (visited.has(node)) continue;
      visited.add(node); component.push(node);
      (adj[node] || []).forEach(n => !visited.has(n) && queue.push(n));
    }
    components.push(component);
  });

  // Map components to countries
  var compCountries = components.map(comp => {
    var ctrs = [...new Set(comp.map(id => nodeCountry[id]))];
    return ctrs.filter(c => c !== failedCode);
  });

  // Display result + colour each component
  _renderFailureResult(failedCode, compCountries);
}
```

**Acceptance Criteria**
- [ ] Dropdown in GATEWAY mode to select country to fail
- [ ] "Simulate" button triggers analysis
- [ ] Disconnected components shown in distinct highlight colours
- [ ] Panel shows text: "After ZAF failure: 2 islands detected — [GBR, FRA, POR] | [DRC, MOZ, KEN, TAN, LES, DJB]"
- [ ] "Clear simulation" button restores original colours
- [ ] Countries with no impact shown as "connected (N remaining paths)"

---

## GW-F4 — Inter-Country Link Redundancy Score

**Priority**: P2 · Effort: M

### OSPF Engineer Use Case

Network redundancy is not binary — it's a spectrum. A country pair with 3 gateway links at different costs has excellent redundancy; a pair with only 1 link is a SPOF (Single Point of Failure). An OSPF engineer needs a "redundancy score" per link to prioritise which SPOFs to address first.

### Feature Description

Each gateway edge is annotated with a redundancy badge:
- `R=1` (red): only 1 link between these two countries (SPOF)
- `R=2` (yellow): 2 parallel paths available
- `R=3+` (green): 3+ parallel paths (well-redundant)

A summary panel lists all SPOFs (R=1 country pairs) sorted by traffic importance (total countries reachable via that link).

### Implementation Plan

Extends `GW-F1`'s matrix data. After building `matrix[c1][c2]`:

```javascript
allEdges.forEach(function(e) {
  var c1 = nodeCountry[e.from], c2 = nodeCountry[e.to];
  if (c1 !== c2) {
    var r = matrix[c1][c2];  // total links between these countries
    var badge = r === 1 ? '⚠R=1' : r === 2 ? 'R=2' : '✅R=3+';
    var bColor = r === 1 ? '#e74c3c' : r === 2 ? '#f39c12' : '#27ae60';
    edges.update({
      id: e.id,
      label: `cost:${e.cost} ${badge}`,
      color: { color: bColor }
    });
  }
});
```

**Acceptance Criteria**
- [ ] Every inter-country edge shows redundancy badge (R=1/R=2/R=3+)
- [ ] Red (R=1) edges are immediately visually prominent
- [ ] SPOF panel lists all R=1 country pairs
- [ ] Clicking a SPOF row in the panel highlights that edge and zooms to it

---

## GW-F5 — NMS Export: Gateway Links CSV

**Priority**: P3 · Effort: S

### OSPF Engineer Use Case

The GATEWAY topology (28 nodes, 82 edges) is the ideal seed for a Network Management System (NMS) monitoring cross-country connectivity. Feeding this into LibreNMS, Zabbix, or Nagios requires a CSV of gateway router IPs and their interconnections.

### Feature Description

"Export for NMS" button → Downloads `gateway-nms-{graph_time}.csv`:

```csv
src_hostname,src_ip,src_country,dst_hostname,dst_ip,dst_country,cost,is_redundant
zaf-cpt-r1,18.18.18.1,ZAF,gbr-lon-r1,15.15.15.1,GBR,10,true
gbr-lon-r1,15.15.15.1,GBR,fra-par-r1,16.16.16.1,FRA,20,true
```

**Implementation Plan**

Extends `AS-F5` export logic. Filters to only inter-country edges where both endpoints are gateways. Uses the country connectivity matrix to set `is_redundant` based on R≥2.

**Acceptance Criteria**
- [ ] CSV downloadable from GATEWAY mode toolbar
- [ ] Columns: src_hostname, src_ip, src_country, dst_hostname, dst_ip, dst_country, cost, is_redundant
- [ ] Only inter-country edges included (not intra-country)
- [ ] `is_redundant=true` for country pairs with ≥2 links

---

---

# PART 3 — ENRICHED MODE

## Purpose

Full topology with country context — the **default operating view** for OSPF engineers. All 34 nodes, all 108 edges, country colours, Country Filter panel (SHOW ONLY / EXCLUDE). The richest view: everything is visible and differentiated by country.

**Current behaviour**: Country Filter panel, SPT from any node, backup path detection, ECMP handling.

---

## EN-F1 — Edge Cost Labels + Intra/Cross-Country Visual Distinction

**Priority**: P1 · Effort: S

### OSPF Engineer Use Case

An OSPF engineer in ENRICHED mode needs to see the full cost structure of the network — both intra-country links (internal to a country's OSPF domain) and cross-country links (inter-domain). These have fundamentally different operational significance:

- **Intra-country edges** (e.g. zaf-cpt-r1 → zaf-prs-r1, same country): Internal OSPF topology, typically low and uniform cost
- **Cross-country edges** (e.g. zaf-cpt-r1 → gbr-lon-r1, different countries): Inter-domain links, often high-cost intentional preference setters

Displaying them with different visual weight makes the structure immediately parseable.

### Feature Description

In ENRICHED mode (toggled by checkbox):
- **Intra-country edges**: thin grey line, cost label in small grey font
- **Cross-country edges**: thick coloured line (same colour as the gateway node's country), cost label in bold
- Checkbox: "Show edge costs + type distinction"

```
  [zaf-cpt-r1]═══(cost:10)═══[zaf-prs-r1]     ← thin grey: intra-ZAF
        ║
   cost:100 ← bold, coloured
        ║
  [gbr-lon-r1]                                  ← thick orange: ZAF→GBR cross-country
```

### Implementation Plan

Extend `_applyCostLabels()` (from AS-F1) with an ENRICHED variant:

```javascript
function _applyEnrichedEdgeStyle(show) {
  if (!show) { _applyCostLabels(false); return; }
  var nodeCountry = {};
  nodes.get().forEach(n => nodeCountry[n.id] = (n.country||'UNK').toUpperCase());

  edges.update(edges.get().map(function(e) {
    var c1 = nodeCountry[e.from], c2 = nodeCountry[e.to];
    var isCross = c1 !== c2;
    var col = isCross ? (COUNTRY_COLOR_PALETTE[c1] || {}).background : '#aaaaaa';
    return {
      id: e.id,
      label: String(e.cost || ''),
      font: { size: isCross ? 13 : 9, color: '#333', bold: isCross },
      color: { color: col || '#aaaaaa' },
      width: isCross ? 3 : 1
    };
  }));
}
```

**Acceptance Criteria**
- [ ] "Show edge costs" checkbox in ENRICHED mode toolbar
- [ ] Intra-country edges: thin, grey, small cost label
- [ ] Cross-country edges: thick, country-coloured, bold cost label
- [ ] Toggle off restores default edge appearance

---

## EN-F2 — OSPF Area Visualisation on Canvas

**Priority**: P2 · Effort: M

### OSPF Engineer Use Case

The current test dataset is Area 0 only (`meta.json: {areas: [0, 1]}`). Real production networks have multiple OSPF areas (stub areas, totally-stub areas, NSSAs). Area boundaries define where LSA flooding stops — a critical topology design concept. Without area visualisation on the canvas, the engineer cannot assess ABR placement or flooding domain sizing.

**Data available**:
- `/get_areas_list` API endpoint (already implemented in topolograph.js line 3880) returns `{area_id, nodes_count, networks_count, is_backbone}`
- Each node has an `areas` array attribute (line 3827: `node.areas.join(', ')`)
- This data is server-side and accessible — it just needs to be surfaced on the canvas

### Feature Description

In ENRICHED mode, a new toggle "Show OSPF Areas" makes area membership visible:
- Node **border colour** = OSPF area (node fill colour stays as country colour)
  - Area 0 (backbone): solid thick blue border
  - Area 1, 2, …: distinct coloured dashed border
- ABR nodes (member of Area 0 AND at least one other area): double border / diamond shape
- Area legend panel shows: "Area 0 (backbone, 34 nodes) | Area 1 (stub, N nodes)"

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `applyAreaVisualisation()`:

```javascript
function applyAreaVisualisation(enable) {
  if (!enable) {
    // Reset borders to defaults
    nodes.update(nodes.get().map(n => ({id: n.id, borderWidth: 1, borderWidthSelected: 2})));
    return;
  }

  // Fetch area data via existing AJAX endpoint
  $.ajax({
    url: '/get_areas_list',
    success: function(response) {
      var areaCols = ['#3498db','#e74c3c','#2ecc71','#9b59b6','#f39c12'];
      var areaColMap = {};
      (response.items || []).forEach(function(area, i) {
        areaColMap[area.area_id] = {
          color: area.is_backbone ? '#2980b9' : areaCols[i % areaCols.length],
          dashed: !area.is_backbone
        };
      });

      nodes.update(nodes.get().map(function(n) {
        if (!n.areas || !n.areas.length) return {id: n.id};
        var primaryArea = n.areas[0];
        var isABR = n.areas.length > 1;
        var ac = areaColMap[primaryArea] || {color:'#888', dashed:false};
        return {
          id: n.id,
          borderWidth: isABR ? 4 : 2,
          color: {
            // Preserve background (country colour), only change border
            background: n.color && n.color.background || '#cccccc',
            border: ac.color
          },
          shape: isABR ? 'diamond' : undefined
        };
      }));

      _buildAreaLegend(areaColMap);
    }
  });
}
```

**Acceptance Criteria**
- [ ] "Show OSPF Areas" toggle in ENRICHED mode
- [ ] Node border changes colour to reflect area membership
- [ ] ABR nodes (multi-area) rendered as diamonds with thick border
- [ ] Area legend panel shows area IDs, node counts, backbone status
- [ ] Node tooltip (title) includes area: "Areas: 0, 1"
- [ ] Toggle off restores original borders

---

## EN-F3 — Country-to-Country SPT Panel

**Priority**: P1 · Effort: M

### OSPF Engineer Use Case

An OSPF engineer's primary question is: "What is the routing path from Country A to Country B, and what does it cost?" This exists for single router-to-router SPT but not for country-to-country. For a 10-country network, the engineer would need to run 45 individual SPT calculations to understand all country pair paths. A Country SPT Panel does this at one abstraction level up.

### Feature Description

In ENRICHED mode, a "Country Path Finder" panel:
1. Dropdown: "Source Country" (ZAF, GBR, FRA...)
2. Dropdown: "Destination Country" (ZAF, GBR, FRA...)
3. Button: "Find Paths"
4. Result: for each gateway in source country, compute SPT to each gateway in dest country → show the minimum-cost path with its route (countries traversed) and total cost

```
ZAF → GBR  Best path:
  zaf-cpt-r1(18.18.18.1) → gbr-lon-r1(15.15.15.1)  cost: 110
  Path: ZAF → FRA → GBR  (2 hops, via fra-par-r1)
  Backup: ZAF → POR → GBR  cost: 150
```

### Implementation Plan

The server-side SPT already exists — the panel orchestrates multiple calls:

```javascript
async function findCountrySPT(srcCode, dstCode) {
  var srcGateways = nodes.get().filter(n => n.country === srcCode && n.is_gateway);
  var dstGateways = nodes.get().filter(n => n.country === dstCode && n.is_gateway);

  var results = [];
  for (var src of srcGateways) {
    for (var dst of dstGateways) {
      // Call existing SPT endpoint
      var res = await fetch(`/get_shortest_path?src=${src.id}&dst=${dst.id}&graph_id=${GRAPH_ID}`);
      var data = await res.json();
      results.push({ src: src.label, dst: dst.label, cost: data.cost, path: data.path });
    }
  }

  // Sort by cost, display top 3
  results.sort((a,b) => a.cost - b.cost);
  _renderCountrySPTPanel(results.slice(0, 3));
}
```

**Note**: The actual SPT endpoint name may differ from `/get_shortest_path` — check topolograph.js `$.ajax` calls for the correct path (e.g. `/get_spt_from_to`).

**Acceptance Criteria**
- [ ] "Country Path Finder" panel accessible in ENRICHED mode
- [ ] Source/destination country dropdowns populated from visible nodes
- [ ] Top 3 cheapest paths shown with: source RID, dest RID, cost, countries traversed
- [ ] Clicking a result paints that SPT path on the canvas using existing SPT colouring
- [ ] "Clear" button removes SPT painting

---

## EN-F4 — UNK Node Visibility Dashboard

**Priority**: P2 · Effort: S

### OSPF Engineer Use Case

In the test dataset, all 34 routers are mapped (hostname in Load-hosts.txt). In a real production network with hundreds of routers, many OSPF routers may not have hostnames in the mapping file. These appear as grey "UNK" nodes — visible in the Country Filter as "UNK" entries. An OSPF engineer needs to know exactly which routers are unmapped so they can update the host file.

### Feature Description

An "Unmapped Routers" panel (always visible when UNK nodes exist, hidden when all mapped):
- Header: "⚠ 3 unmapped routers detected"
- List of UNK router IDs (IPs) with a link to the host mapping page
- A "Download UNK list" button for CSV download
- A count badge on the Country Filter button when UNK nodes exist

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — extend `buildCountryFilterPanel()` at line 4157:

```javascript
// After building the panel, check for UNK nodes
var unkNodes = nodes.get().filter(n => !n.hostname || (n.country||'').toUpperCase() === 'UNK');
if (unkNodes.length > 0) {
  var unkHtml = `<div id="unkPanel">
    <b>⚠ ${unkNodes.length} unmapped router(s)</b><br>
    ${unkNodes.map(n => `<code>${n.label}</code>`).join('<br>')}
    <br><a href="/ospf-host-to-dns-mapping" target="_blank">→ Update host mappings</a>
    <br><button onclick="_downloadUnkCsv()">Download UNK list CSV</button>
  </div>`;
  document.getElementById('countryFilterPanel').insertAdjacentHTML('beforeend', unkHtml);
}

function _downloadUnkCsv() {
  var unk = nodes.get().filter(n => !n.hostname || (n.country||'').toUpperCase() === 'UNK');
  var csv = 'router_id,label\n' + unk.map(n=>`${n.id},${n.label}`).join('\n');
  var blob = new Blob([csv], {type:'text/csv'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'unmapped-routers.csv'; a.click();
}
```

**Acceptance Criteria**
- [ ] Panel section appears when UNK nodes exist (test: use `host-file-unk-test.txt`)
- [ ] Lists every unmapped router IP
- [ ] Link navigates to host mapping page
- [ ] CSV download contains all UNK node IPs
- [ ] Panel is absent when all routers are mapped (current test dataset)

---

## EN-F5 — Node Properties Inspector

**Priority**: P2 · Effort: S

### OSPF Engineer Use Case

Right-clicking a node in Topolograph currently shows SPT-related menu items. There is no way to see all the data stored in the vis.js DataSet for a specific node: its country, role, OSPF area, link count, or raw RID. An inspector panel (like browser DevTools "element inspector") fills this gap for operational debugging.

### Feature Description

Click any node → a "Node Inspector" panel slides in (fixed, right side) showing all node attributes:

```
╔═══════════════════════════════╗
║  Node Inspector               ║
╠═══════════════════════════════╣
║  Hostname : zaf-cpt-r1        ║
║  Router ID: 18.18.18.1        ║
║  Country  : ZAF               ║
║  Role     : Gateway (border)  ║
║  OSPF Area: Area 0            ║
║  Degree   : 7 adjacencies     ║
║  Link Count (LSDB): 7         ║
║  LSA Age  : 786s              ║
║  Seq #    : 0x80000003        ║
╚═══════════════════════════════╝
```

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — hook into the `network.on('click')` event (already wired for SPT):

```javascript
// Add node inspector alongside existing click handler
network.on('click', function(params) {
  // ... existing SPT logic ...

  // NEW: Node inspector
  if (params.nodes && params.nodes.length === 1) {
    var node = nodes.get(params.nodes[0]);
    if (node) _showNodeInspector(node);
  }
});

function _showNodeInspector(node) {
  var degree = edges.get().filter(e => e.from === node.id || e.to === node.id).length;
  var html = `<div id="nodeInspector">
    <b>Node Inspector</b> <span onclick="this.parentElement.remove()">✕</span>
    <table>
      <tr><td>Hostname</td><td>${node.hostname || '—'}</td></tr>
      <tr><td>Router ID</td><td>${node.label}</td></tr>
      <tr><td>Country</td><td>${node.country || 'UNK'}</td></tr>
      <tr><td>Role</td><td>${node.is_gateway ? 'Gateway (border)' : 'Core (internal)'}</td></tr>
      <tr><td>OSPF Area(s)</td><td>${(node.areas||[]).join(', ') || 'Area 0'}</td></tr>
      <tr><td>Degree</td><td>${degree} adjacencies</td></tr>
    </table>
  </div>`;
  // Inject panel (remove existing if present)
  var existing = document.getElementById('nodeInspector');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
}
```

**Acceptance Criteria**
- [ ] Single-click on any node opens inspector panel
- [ ] Inspector shows: hostname, RID (IP), country, role (gateway/core), area(s), degree
- [ ] Close button (✕) dismisses the panel
- [ ] Inspector updates immediately on clicking a different node
- [ ] Panel doesn't interfere with existing right-click SPT menu

---

---

# PART 4 — COLLAPSING MODE

## Purpose

Hierarchical information hiding — the **BGP-analogy view** of an OSPF network. Reduces cognitive load on large topologies by hiding intra-country core routers on demand. The engineer sees the network at "AS-level" granularity by default, and drills into specific countries on demand.

**Current behaviour** (fully implemented — strongest feature set):
- [AS-IS] [GATEWAY] [ENRICHED] [COLLAPSING] toolbar buttons
- Country Groups panel with per-country toggle, Collapse All / Expand All
- Double-click any node → toggle that country's collapse state
- Gateway nodes get dashed border + tooltip when collapsed
- `_collapseState{}` and `_collapseHidden{}` track UI state

---

## CL-F1 — Persist Collapse State (default_collapsed Configuration)

**Priority**: P1 · Effort: M

### OSPF Engineer Use Case

An OSPF engineer working with a large country (ZAF: 8 routers, 3 cores) will always want ZAF collapsed on entry — they only care about the gateways during cross-country planning sessions. Today, every time they load a graph in COLLAPSING mode, all countries start expanded and they must manually collapse ZAF again.

The `COLLAPSING_country-collapse-config.json` already has a `default_collapsed` field on every country — it is always `false`. This is an unused hook for persistence.

### Feature Description

**Two mechanisms**:

1. **Browser-side persistence** (session): When the user collapses/expands countries, save state to `localStorage`. On next load of the same graph, auto-apply saved state.

2. **Pipeline-side defaults** (permanent): A `collapse-preferences.json` file (in `INPUT-FOLDER/`) lists which countries should default to collapsed. The pipeline's `generate-collapse-config.py` reads this and sets `default_collapsed: true`.

### Implementation Plan

**Mechanism 1 — localStorage persistence**

**File: `topolograph-docker/init/topolograph.js`**

In `toggleCollapseCountry(code)` (the existing collapse toggle function), after updating `_collapseState`:

```javascript
// Save to localStorage with graph_time key
function _persistCollapseState() {
  var key = 'collapseState_' + (window._graphTime || 'current');
  localStorage.setItem(key, JSON.stringify(_collapseState));
}

// Restore on mode switch to COLLAPSING
function _restoreCollapseState() {
  var key = 'collapseState_' + (window._graphTime || 'current');
  var saved = localStorage.getItem(key);
  if (!saved) return;
  var state = JSON.parse(saved);
  Object.entries(state).forEach(function([code, collapsed]) {
    if (collapsed && !_collapseState[code]) toggleCollapseCountry(code);
  });
}
```

Call `_restoreCollapseState()` at the end of `setViewMode('collapsing')`.

**Mechanism 2 — Pipeline default_collapsed**

**File: `terminal-script/generate-collapse-config.py`**

```python
import json, os

prefs_file = os.path.join(os.path.dirname(__file__), '../INPUT-FOLDER/collapse-preferences.json')
default_collapsed = {}
if os.path.exists(prefs_file):
    prefs = json.load(open(prefs_file))
    default_collapsed = {c.upper(): True for c in prefs.get('collapse_by_default', [])}

# In the per-country entry:
entry['default_collapsed'] = default_collapsed.get(country_code, False)
```

**`INPUT-FOLDER/collapse-preferences.json`** (new file, user-editable):
```json
{
  "collapse_by_default": ["ZAF"],
  "comment": "Countries to collapse automatically on COLLAPSING mode load"
}
```

**File: `topolograph-docker/init/topolograph.js`**

In the `setTimeout` callback (line ~495), after `_resetCollapseState()`, read the collapse config embedded in the page and auto-collapse:

```javascript
// Read collapse config (loaded from PATCH data) and auto-collapse countries
// with default_collapsed: true
setTimeout(function() {
  // ... existing calls ...
  _autoCollapseDefaults();
}, 900);

function _autoCollapseDefaults() {
  if (_viewMode !== 'collapsing') return;
  // collapseConfig is injected by push-to-ui.py as a global (see below)
  if (typeof window._collapseConfig === 'undefined') return;
  Object.entries(window._collapseConfig.countries || {}).forEach(function([code, cfg]) {
    if (cfg.default_collapsed && !_collapseState[code]) {
      toggleCollapseCountry(code);
    }
  });
}
```

**`push-to-ui.py`**: After pushing node PATCHes, embed the collapse config as a JS global:

```python
# Inject collapse config into a JS global via a special node annotation or
# via a dedicated endpoint. Simplest approach: write collapse config JSON
# to a file that topolograph.js loads via fetch('/static/collapse-config.json')
```

**Acceptance Criteria**
- [ ] After collapsing ZAF and refreshing the page (same graph_time), ZAF is still collapsed
- [ ] `collapse-preferences.json` with `["ZAF"]` causes ZAF to start collapsed on load
- [ ] "Remember current collapse state" button in Country Groups panel saves to localStorage
- [ ] "Clear saved state" button resets to defaults
- [ ] `default_collapsed` field in `COLLAPSING_country-collapse-config.json` reflects preferences

---

## CL-F2 — Country-Level SPT in Collapsed View

**Priority**: P1 · Effort: M

### OSPF Engineer Use Case

In COLLAPSING mode with ZAF, GBR, FRA collapsed (only gateways visible), an engineer wants to know: "What is the OSPF path from ZAF to DJB?" The existing SPT panel works on specific router IDs — not on country codes. In collapsed view, the engineer thinks in countries, not router IDs.

**Architecture note**: The COLLAPSING feature explicitly states (topolograph.js line 4342): `"hidden: true → UI-only flag; server-side SPT calculations unaffected"`. This means SPT from any RID still works correctly even when that country is collapsed — the server uses the full MongoDB topology regardless of client-side `hidden` flags.

### Feature Description

In COLLAPSING mode, the Country Groups panel gains a "Path Finder" section:
- Dropdown: "From Country"
- Dropdown: "To Country"
- Button: "Find Best Path"
- Result shows: path as sequence of countries + gateways + costs
- The path is highlighted on the canvas, expanding any collapsed countries along the route

```
ZAF → DJB  Best path:
  zaf-cpt-r1 → ken-mob-r1 → djb-db-r1
  Countries traversed: ZAF → KEN → DJB
  Total cost: 220
[Auto-expanding KEN to show the path]
```

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — extend `buildCollapsePanel()` to add Path Finder:

```javascript
// Add to panel HTML (inside buildCollapsePanel):
var pathFinderHtml = `
  <div id="cpPathFinder">
    <b>Country Path Finder</b>
    <select id="cpPathSrc">${countryOptions}</select>
    <span>→</span>
    <select id="cpPathDst">${countryOptions}</select>
    <button onclick="findCollapsingPath()">Find</button>
    <div id="cpPathResult"></div>
  </div>`;

function findCollapsingPath() {
  var srcCode = document.getElementById('cpPathSrc').value;
  var dstCode = document.getElementById('cpPathDst').value;

  // Get representative gateway RIDs
  var srcGateways = nodes.get().filter(n => n.country === srcCode && n.is_gateway);
  var dstGateways = nodes.get().filter(n => n.country === dstCode && n.is_gateway);

  if (!srcGateways.length || !dstGateways.length) {
    document.getElementById('cpPathResult').textContent = 'No gateway nodes found';
    return;
  }

  // Use first gateways as representatives (could extend to try all pairs)
  var srcId = srcGateways[0].label;  // IP = node identifier for API
  var dstId = dstGateways[0].label;

  // Call existing SPT endpoint
  $.get('/get_shortest_path', { src: srcId, dst: dstId }, function(res) {
    // Auto-expand countries along the path
    var pathCountries = [...new Set(res.path.map(rid => {
      var n = nodes.get().find(x => x.label === rid);
      return n ? n.country : null;
    }).filter(Boolean))];

    pathCountries.forEach(function(code) {
      if (_collapseState[code]) toggleCollapseCountry(code);  // expand
    });

    // Render result
    document.getElementById('cpPathResult').innerHTML =
      `Cost: ${res.cost} | Via: ${pathCountries.join(' → ')}`;

    // Paint the path (use existing SPT paint functions)
    _paintSptPath(res.path);
  });
}
```

**Acceptance Criteria**
- [ ] "Country Path Finder" section visible in Country Groups panel (COLLAPSING mode only)
- [ ] Source/Destination dropdowns show all 10 country codes
- [ ] Path computed and displayed as: cost + countries traversed + router sequence
- [ ] Countries along the path auto-expand if collapsed
- [ ] Path painted on canvas using existing SPT blue edge colouring
- [ ] "Clear Path" button restores collapse state and removes path painting

---

## CL-F3 — Core Count Badge on Gateway Nodes When Collapsed

**Priority**: P2 · Effort: S

### OSPF Engineer Use Case

When a country is collapsed, the `_markGatewayCollapsed()` function (line 4396) adds a dashed border and a tooltip. But the engineer can only see the hidden count by hovering — it's not immediately visible. An on-canvas badge (label update showing "▲3 hidden") makes collapsed state scannable without hover.

**In the current test data**: When ZAF is collapsed, 3 core nodes are hidden (zaf-prs-r1, zaf-mtb-r1, zaf-jnb-r2). The gateway nodes (zaf-cpt-r1, zaf-cpt-r2, zaf-mtz-r1, zaf-jnb-r1, zaf-mtb-r2) should show "▲3" to communicate this.

### Feature Description

When a country collapses, each of its gateway nodes updates its label:
```
Before:  zaf-cpt-r1         After: zaf-cpt-r1
         18.18.18.1                 18.18.18.1
                                    ▲ 3 hidden
```

When the country expands, the label reverts to `hostname\nIP`.

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — extend `_markGatewayCollapsed()` (line ~4396):

```javascript
// Current function marks border as dashed and updates title (tooltip)
// ADD: also update label to show hidden count

function _markGatewayCollapsed(nodeId, countryCode, hiddenCount) {
  // ... existing dashed border + tooltip code ...

  // NEW: Add badge to label
  var node = nodes.get(nodeId);
  if (!node) return;
  var baseLbl = node._origLabel || node.label || node.id;
  nodes.update({
    id: nodeId,
    _origLabel: baseLbl,   // preserve original for restore
    label: baseLbl + '\n▲ ' + hiddenCount + ' hidden'
  });
}

// In the restore path (_markGatewayExpanded equivalent):
function _markGatewayExpanded(nodeId) {
  var node = nodes.get(nodeId);
  if (!node || !node._origLabel) return;
  nodes.update({ id: nodeId, label: node._origLabel, _origLabel: undefined });
  // ... existing restore border code ...
}
```

**Acceptance Criteria**
- [ ] Collapsing ZAF (3 cores): all 5 ZAF gateway nodes show "▲ 3 hidden" in their label
- [ ] Collapsing GBR (1 core): GBR gateways show "▲ 1 hidden"
- [ ] Expanding: labels restore to `hostname\nIP`
- [ ] "Collapse All" → all 4 countries with cores show badges
- [ ] Badge disappears on "Expand All"

---

## CL-F4 — Inter-Country Cost Table in Collapsed View

**Priority**: P2 · Effort: M

### OSPF Engineer Use Case

In COLLAPSING mode with some countries collapsed, the engineer sees gateway-to-gateway inter-country edges. They need a quick summary: "For each country pair I can see, what are the edge costs?" This is more detailed than the connectivity matrix (GW-F1) — it shows individual edge costs, not just counts.

**Data source**: `COLLAPSING_collapsed-topology.json` — 28 gateway nodes, 82 edges, all with costs. Combined with country codes from node properties.

### Feature Description

A floating "Inter-Country Links" table panel (toggled from Country Groups panel footer):

```
Country Pair         Links  Min Cost  Max Cost
ZAF ↔ GBR             2      10        100
ZAF ↔ FRA             1      50         —
ZAF ↔ POR             1      80         —
GBR ↔ FRA             2      20        120
FRA ↔ POR             1      30         —
...
```

Clicking a row highlights those edges on the canvas.

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new function `buildInterCountryCostTable()`:

```javascript
function buildInterCountryCostTable() {
  var allEdges = edges.get().filter(e => !e.hidden);
  var nodeMap = {};
  nodes.get().forEach(n => nodeMap[n.id] = n);

  var pairStats = {};   // key: "C1_C2" (alphabetical)

  allEdges.forEach(function(e) {
    var n1 = nodeMap[e.from], n2 = nodeMap[e.to];
    if (!n1 || !n2) return;
    var c1 = (n1.country||'UNK').toUpperCase(), c2 = (n2.country||'UNK').toUpperCase();
    if (c1 === c2) return;   // skip intra-country
    var key = [c1, c2].sort().join('↔');
    if (!pairStats[key]) pairStats[key] = { costs: [], ids: [] };
    pairStats[key].costs.push(e.cost || 0);
    pairStats[key].ids.push(e.id);
  });

  var rows = Object.entries(pairStats).map(([pair, stats]) => {
    var min = Math.min(...stats.costs), max = Math.max(...stats.costs);
    return `<tr onclick="_highlightEdges(${JSON.stringify(stats.ids)})">
      <td>${pair}</td>
      <td>${stats.costs.length}</td>
      <td>${min}</td>
      <td>${stats.costs.length > 1 ? max : '—'}</td>
    </tr>`;
  }).join('');

  // Build panel
  var html = `<div id="costTablePanel">
    <b>Inter-Country Links</b>
    <table><tr><th>Pair</th><th>Links</th><th>Min Cost</th><th>Max Cost</th></tr>
    ${rows}</table>
  </div>`;
  _injectOrReplacePanel('costTablePanel', html);
}
```

**Acceptance Criteria**
- [ ] "Link Cost Table" button in Country Groups panel
- [ ] Table shows all visible inter-country edge pairs (updates when countries collapse/expand)
- [ ] Min/Max cost shown; Max=— for single-link pairs
- [ ] Clicking a row highlights those edges on canvas
- [ ] Table updates dynamically when collapse state changes

---

## CL-F5 — Shareable Collapse State URL

**Priority**: P3 · Effort: S

### OSPF Engineer Use Case

An OSPF engineer sets up a specific collapse state (ZAF collapsed, GBR expanded, showing path from FRA to DJB) and wants to share this exact view with a colleague. A URL parameter encoding the collapse state allows "deep linking" to a specific topology view.

### Feature Description

"Copy Link" button in Country Groups panel → copies to clipboard a URL like:
```
http://localhost:8081/graph?gt=04Mar2026_12h25m56s_34_hosts&collapse=ZAF,FRA&mode=collapsing
```

When a colleague opens this URL, the app:
1. Loads the specified graph_time
2. Switches to COLLAPSING mode
3. Collapses the specified countries

### Implementation Plan

**URL generation** (client-side only):

```javascript
function _copyCollapseStateUrl() {
  var collapsed = Object.entries(_collapseState)
    .filter(([_, v]) => v).map(([k]) => k).join(',');
  var gt = window._graphTime || '';
  var url = `${location.origin}${location.pathname}?gt=${gt}&mode=collapsing&collapse=${collapsed}`;
  navigator.clipboard.writeText(url);
  alert('Link copied to clipboard!');
}

// On page load, read URL params
function _applyUrlParams() {
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode');
  var collapse = params.get('collapse');
  var gt = params.get('gt');

  if (gt) { /* pre-select graph_time in dropdown */ }
  if (mode) setViewMode(mode);
  if (collapse) {
    collapse.split(',').forEach(code => toggleCollapseCountry(code.toUpperCase()));
  }
}
```

**Acceptance Criteria**
- [ ] "Copy Link" button in Country Groups panel
- [ ] Copied URL encodes: graph_time + mode + collapsed countries
- [ ] Opening the URL restores exact collapse state
- [ ] URL is human-readable and editable

---

---

# PART 5 — DB2 MODE (Database Diff / Snapshot Comparison)

## Purpose

**DB2 Mode** addresses the OSPF engineer's most critical operational need: understanding **what changed** between two OSPF topology snapshots. An OSPF network is not static — costs change, links fail, routers are added, and adjacencies shift. Comparing two LSDB captures (e.g. before and after a maintenance window) reveals the exact topology delta.

**Conceptual analogy**: Like `git diff` for network topology — instead of comparing source code lines, it compares OSPF router link states, edge costs, and adjacency tables.

**Data assets available**:
- `INPUT-FOLDER/ospf-database.txt` — Snapshot 1 (earlier database, 56KB)
- `INPUT-FOLDER/ospf-database-2.txt` — Snapshot 2 (current database, 61KB, 34 routers)
- `OUTPUT/DB2/` — 10 items (likely DB2-specific pre-computed outputs)

**Implementation approach**: DB2 Mode is a **5th view mode** added to the `[AS-IS] [GATEWAY] [ENRICHED] [COLLAPSING]` toolbar as `[DB2 DIFF]`. It loads two graphs simultaneously and computes the diff client-side.

---

## DB-F1 — Dual OSPF Database Loader

**Priority**: P1 · Effort: L

### OSPF Engineer Use Case

An engineer runs a maintenance window: changes OSPF cost on a link, verifies convergence, captures a new LSDB. They now have two LSDB files. DB2 Mode must be able to load both — one as "baseline" (DB1) and one as "current" (DB2) — and display both simultaneously for comparison.

### Feature Description

When switching to DB2 mode, a panel appears:
- "Baseline graph" dropdown → select a graph_time (or upload new OSPF database)
- "Comparison graph" dropdown → select a different graph_time
- "Compare" button → run diff and display

The canvas shows the union of both graphs' nodes and edges, with colour coding:
- **Green nodes/edges**: New in DB2 (added after baseline)
- **Red nodes/edges**: Removed in DB2 (existed in baseline, gone now)
- **Yellow nodes/edges**: Changed (same node/edge, different cost or different adjacency)
- **Grey nodes/edges**: Unchanged (identical in both)

### Implementation Plan

**File: `topolograph-docker/init/topolograph.js`** — new mode `'db2diff'` added to `setViewMode()`:

```javascript
} else if (mode === 'db2diff') {
  expandAllCountries(); resetCountryFilter();
  _hideCfPanel(); _hideCpPanel();
  if (!_db2PanelBuilt) buildDb2Panel();
  else _showDb2Panel();
}
```

**New function `buildDb2Panel()`**:

```javascript
function buildDb2Panel() {
  var html = `<div id="db2Panel" class="cpPanel">
    <div class="cpHeader">DB2 — Topology Diff</div>
    <div>
      Baseline: <select id="db2Src">${_buildGraphTimeOptions()}</select><br>
      Compare:  <select id="db2Dst">${_buildGraphTimeOptions()}</select><br>
      <button onclick="runDb2Diff()">Compare →</button>
    </div>
    <div id="db2Result"></div>
    <div id="db2Legend">
      <span style="color:#27ae60">■ Added</span>
      <span style="color:#e74c3c">■ Removed</span>
      <span style="color:#f39c12">■ Changed cost</span>
      <span style="color:#aaa">■ Unchanged</span>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  _db2PanelBuilt = true;
}
```

**Graph time options** come from the `#dynamic_graph_time` select element already in the page.

**Acceptance Criteria**
- [ ] "DB2 DIFF" button in view mode toolbar
- [ ] DB2 panel shows two graph_time selectors
- [ ] "Compare" button triggers diff computation
- [ ] Loading indicator shown during AJAX fetches

---

## DB-F2 — Edge Diff (Changed Costs, New/Removed Links)

**Priority**: P1 · Effort: M

### OSPF Engineer Use Case

"I changed the OSPF cost on the ZAF→GBR link from 10 to 50. Did the change take effect? And did any other links change unexpectedly?" Edge diff answers this instantly, showing every link that changed cost or appeared/disappeared between the two snapshots.

### Feature Description

After running the diff, changed edges are highlighted and listed:

```
═══ Edge Changes: 3 found ═══
+ Added:   zaf-mtz-r1 → ken-mob-r1  (new adjacency, cost: 30)
~ Changed: zaf-cpt-r1 → gbr-lon-r1  (cost: 10 → 50, Δ+40)
- Removed: les-mar-r1 → tan-mbz-r1  (adjacency dropped)
```

### Implementation Plan

**`runDb2Diff()` function** — core diff engine:

```javascript
async function runDb2Diff() {
  var srcGt = document.getElementById('db2Src').value;
  var dstGt = document.getElementById('db2Dst').value;

  // Fetch edges for both graph times
  var [srcEdges, dstEdges] = await Promise.all([
    fetch(`/api/diagram/${srcGt}/edges`).then(r=>r.json()),
    fetch(`/api/diagram/${dstGt}/edges`).then(r=>r.json())
  ]);

  // Build edge maps: key = "fromIP_toIP"
  var edgeKey = e => [e.source, e.target].sort().join('_');
  var srcMap = {}, dstMap = {};
  (srcEdges.edges || []).forEach(e => srcMap[edgeKey(e)] = e);
  (dstEdges.edges || []).forEach(e => dstMap[edgeKey(e)] = e);

  var added   = Object.keys(dstMap).filter(k => !srcMap[k]);
  var removed = Object.keys(srcMap).filter(k => !dstMap[k]);
  var changed = Object.keys(srcMap).filter(k => dstMap[k] && srcMap[k].cost !== dstMap[k].cost);

  // Apply colours to canvas edges
  _applyDiffColours(added, removed, changed, srcMap, dstMap);

  // Render diff report
  _renderDiffReport(added, removed, changed, srcMap, dstMap);
}

function _applyDiffColours(added, removed, changed, srcMap, dstMap) {
  // All edges → grey (unchanged baseline)
  edges.update(edges.get().map(e => ({id: e.id, color: {color:'#cccccc'}, width: 1})));

  // Highlight changed edges by type
  var edgeByKey = {};
  edges.get().forEach(e => {
    var n1 = nodes.get(e.from), n2 = nodes.get(e.to);
    if (n1 && n2) edgeByKey[[n1.label, n2.label].sort().join('_')] = e.id;
  });

  changed.forEach(k => edges.update({
    id: edgeByKey[k],
    color: {color:'#f39c12'}, width: 3,
    label: `${srcMap[k].cost}→${dstMap[k].cost}`
  }));
}
```

**API endpoint**: The existing `/api/diagram/{gt}/edges` (documented in `00-STEP-BY-STEP/aa-how-to-use-the-app.txt`) returns all edges for a given graph_time — usable directly.

**Acceptance Criteria**
- [ ] Added edges: green, thick, label "NEW (cost: X)"
- [ ] Removed edges: red, dashed
- [ ] Changed-cost edges: orange, label "10 → 50 (Δ+40)"
- [ ] Unchanged edges: grey, thin
- [ ] Diff panel lists all changes: added count, removed count, changed count
- [ ] Each list item is clickable → zoom to that edge on canvas

---

## DB-F3 — Node Diff (New/Removed Routers)

**Priority**: P1 · Effort: S

### OSPF Engineer Use Case

"Was a new router added to the OSPF domain? Was the ZAF decommission completed?" Node diff shows additions and removals at the router level between snapshots — critical for change management verification.

**In the test data**: `ospf-database.txt` (Snapshot 1) may have fewer/more routers than `ospf-database-2.txt` (Snapshot 2, 34 routers). A node diff would immediately surface this.

### Feature Description

Node diff panel section (within DB2 panel):
```
═══ Node Changes: 2 found ═══
+ Added:   18.18.18.8 (zaf-mtb-r2)  — new ZAF router
- Removed: 99.99.99.1               — router no longer in LSDB
```

Added nodes appear GREEN on the canvas; removed nodes appear as RED ghost nodes (shown with dashed border even though they're not in the current topology — loaded from the baseline data).

### Implementation Plan

Extends `runDb2Diff()` with node comparison:

```javascript
// Fetch nodes for both graph times
var [srcNodes, dstNodes] = await Promise.all([
  fetch(`/api/diagram/${srcGt}/nodes`).then(r=>r.json()),
  fetch(`/api/diagram/${dstGt}/nodes`).then(r=>r.json())
]);

var srcNodeMap = {}, dstNodeMap = {};
(srcNodes.nodes || []).forEach(n => srcNodeMap[n.label] = n);  // label = IP
(dstNodes.nodes || []).forEach(n => dstNodeMap[n.label] = n);

var addedNodes   = Object.keys(dstNodeMap).filter(ip => !srcNodeMap[ip]);
var removedNodes = Object.keys(srcNodeMap).filter(ip => !dstNodeMap[ip]);

// Colour added nodes green, add removed nodes as ghost nodes
addedNodes.forEach(ip => {
  var node = nodes.get().find(n => n.label === ip);
  if (node) nodes.update({id: node.id, color: {background:'#27ae60', border:'#1a8a44'}, borderWidth: 3});
});

// Add ghost nodes for removed routers
removedNodes.forEach((ip, i) => {
  nodes.add({
    id: 'ghost_' + i,
    label: ip + '\n(REMOVED)',
    color: {background:'#fadbd8', border:'#e74c3c'},
    borderWidth: 2,
    borderDashes: true,
    shape: 'box',
    _isGhost: true
  });
});
```

**Acceptance Criteria**
- [ ] Added nodes: bright green fill
- [ ] Removed nodes: red ghost (dashed border, semi-transparent, labelled "REMOVED")
- [ ] Diff panel shows: "+ N routers added, - N routers removed"
- [ ] "Clear diff" removes ghost nodes and restores colours
- [ ] Clicking a ghost node opens Node Inspector showing its last-known state from baseline

---

## DB-F4 — SPT Diff (Did Routing Change?)

**Priority**: P2 · Effort: L

### OSPF Engineer Use Case

An engineer changes a link cost from 10 to 50. The topology edge changes — but did the **routing** actually change? If the path was already going via a cheaper alternate route, the cost change had no routing effect. SPT Diff answers: "For this source→destination pair, did the shortest path tree change?"

**OSPF context**: This is the core question in every OSPF cost change: "did this change affect traffic flows?" SPF re-runs on every cost change but the results depend on the entire topology — a cost increase on a non-critical link may change nothing.

### Feature Description

In the DB2 diff panel, a "Routing Impact" section:
1. Select Source router + Destination router
2. Click "SPT Compare"
3. Shows side-by-side:
   - Baseline SPT: path + cost
   - Current SPT: path + cost
   - Delta: "Path UNCHANGED" or "Path CHANGED: now via fra-par-r1 (cost 50→80, +60%)"

### Implementation Plan

```javascript
async function runSptDiff(srcRid, dstRid, srcGt, dstGt) {
  // SPT in baseline
  var baselineSpt = await fetch(`/get_shortest_path?src=${srcRid}&dst=${dstRid}&graph_id=${srcGt}`)
    .then(r => r.json());

  // SPT in comparison
  var currentSpt = await fetch(`/get_shortest_path?src=${srcRid}&dst=${dstRid}&graph_id=${dstGt}`)
    .then(r => r.json());

  var pathChanged = baselineSpt.path.join(',') !== currentSpt.path.join(',');
  var costChanged = baselineSpt.cost !== currentSpt.cost;

  var result = pathChanged
    ? `⚠ PATH CHANGED\nBaseline: ${baselineSpt.path.join('→')} (cost ${baselineSpt.cost})\nCurrent:  ${currentSpt.path.join('→')} (cost ${currentSpt.cost})`
    : `✅ PATH UNCHANGED (cost ${baselineSpt.cost} → ${currentSpt.cost})`;

  document.getElementById('db2SptResult').textContent = result;

  // Paint both paths on canvas (baseline = blue, current = orange)
  _paintSptPath(baselineSpt.path, '#3498db');
  _paintSptPath(currentSpt.path, '#e67e22');
}
```

**Acceptance Criteria**
- [ ] Source/destination dropdowns populated with all nodes from both graphs
- [ ] Baseline path painted blue on canvas
- [ ] Current path painted orange on canvas (overlapping paths show different colours)
- [ ] Delta text: "PATH UNCHANGED" or "PATH CHANGED: [details]"
- [ ] Cost delta shown as absolute (Δ+40) and percentage (+40%)

---

## DB-F5 — Country Impact Analysis

**Priority**: P2 · Effort: M

### OSPF Engineer Use Case

"I changed the ZAF→GBR link cost. Which countries are affected by this routing change?" Rather than checking every router pair individually (34² = 1,156 possible SPT pairs), Country Impact Analysis runs SPT checks at country level and identifies which country pairs experienced routing changes.

### Feature Description

"Analyse Country Impact" button runs a full country-level SPT diff:
- For each of the 45 country pairs (10 choose 2), runs SPT in baseline + current
- Reports which country pairs have changed routing
- Visualises as a heatmap matrix: green = no change, red = routing changed

```
Impact Matrix (changes highlighted):
         ZAF  GBR  FRA  POR  ...
ZAF  [    —  ■RED ■RED   ■   ... ]
GBR  [  ■RED   —  ■RED   ■   ... ]
FRA  [  ■RED ■RED   —    ■   ... ]
```

### Implementation Plan

Extension of `runSptDiff()` — runs for all 45 country pairs in parallel:

```javascript
async function runCountryImpactAnalysis(srcGt, dstGt) {
  var countries = [...new Set(nodes.get().map(n => n.country).filter(Boolean))];
  var pairs = [];
  countries.forEach((c1, i) => countries.slice(i+1).forEach(c2 => pairs.push([c1, c2])));

  // Run all SPT comparisons in parallel (batches of 5 to avoid overloading server)
  var results = {};
  for (var i = 0; i < pairs.length; i += 5) {
    var batch = pairs.slice(i, i+5);
    var batchResults = await Promise.all(batch.map(([c1, c2]) =>
      _compareCountrySpt(c1, c2, srcGt, dstGt)
    ));
    batch.forEach(([c1, c2], j) => { results[`${c1}_${c2}`] = batchResults[j]; });
  }

  // Build impact heatmap
  _buildImpactMatrix(countries, results);
}
```

**Acceptance Criteria**
- [ ] "Country Impact Analysis" button in DB2 diff panel
- [ ] Heatmap matrix shows all 10×10 country pairs
- [ ] Red cells = routing changed between snapshots
- [ ] Green cells = routing unchanged
- [ ] Clicking a red cell zooms to the affected country pair and shows SPT diff
- [ ] Progress indicator shown during batch SPT computation (45 API calls)

---

---

# PRIORITY SUMMARY TABLE

| ID | Feature | Mode | Priority | Effort | OSPF Engineer Benefit |
|---|---|---|---|---|---|
| HOT-F0 | Hostname + IP Dual Label | **ALL** | **P1** | S | Critical baseline for all modes |
| AS-F1 | Edge Cost Labels on Canvas | AS-IS | **P1** | S | See OSPF metric on every link |
| AS-F2 | LSDB Metadata Hover Tooltip | AS-IS | **P1** | M | LSA age, Seq#, link count per router |
| GW-F1 | Cross-Country Connectivity Matrix | GATEWAY | **P1** | M | 10×10 matrix of inter-country link counts |
| GW-F2 | Edge Cost + Cost Colouring | GATEWAY | **P1** | S | Instantly see expensive cross-country links |
| EN-F1 | Edge Cost + Intra/Cross Distinction | ENRICHED | **P1** | S | Full cost picture with visual hierarchy |
| EN-F3 | Country-to-Country SPT Panel | ENRICHED | **P1** | M | SPT at country abstraction level |
| CL-F1 | Persist Collapse State | COLLAPSING | **P1** | M | Remember ZAF collapsed on load |
| CL-F2 | Country-Level SPT in Collapsed View | COLLAPSING | **P1** | M | Path queries stay at country granularity |
| DB-F1 | Dual OSPF Database Loader | DB2 | **P1** | L | Load two snapshots for comparison |
| DB-F2 | Edge Diff (Cost Changes, New/Removed) | DB2 | **P1** | M | See every link change between snapshots |
| DB-F3 | Node Diff (Added/Removed Routers) | DB2 | **P1** | S | Verify decommissioning or new additions |
| AS-F3 | Asymmetric Link Highlighter | AS-IS | P2 | M | Find asymmetric cost configurations |
| AS-F4 | Node Degree Heatmap | AS-IS | P2 | S | Identify OSPF flooding bottlenecks |
| GW-F3 | Country Failure Simulation | GATEWAY | P2 | L | Blast radius of gateway failure |
| GW-F4 | Inter-Country Redundancy Score | GATEWAY | P2 | M | R=1 SPOF identification |
| EN-F2 | OSPF Area Visualisation | ENRICHED | P2 | M | Area boundaries on canvas |
| EN-F4 | UNK Node Visibility Dashboard | ENRICHED | P2 | S | Identify unmapped routers |
| EN-F5 | Node Properties Inspector | ENRICHED | P2 | S | All node attributes in one panel |
| CL-F3 | Core Count Badge on Gateway Nodes | COLLAPSING | P2 | S | On-canvas visibility of hidden count |
| CL-F4 | Inter-Country Cost Table | COLLAPSING | P2 | M | Summary of all visible inter-country costs |
| DB-F4 | SPT Diff (Did Routing Change?) | DB2 | P2 | L | Verify routing impact of cost change |
| DB-F5 | Country Impact Analysis | DB2 | P2 | M | Which country pairs affected by change |
| AS-F5 | Graph Export (JSON/DOT/CSV) | AS-IS | P3 | M | NMS/Graphviz input |
| GW-F5 | NMS Export: Gateway Links CSV | GATEWAY | P3 | S | LibreNMS/Nagios seed |
| CL-F5 | Shareable Collapse State URL | COLLAPSING | P3 | S | Deep-link to specific view |

---

# IMPLEMENTATION ROADMAP

## Sprint 0 — Baseline (1 day)

1. **HOT-F0** (Hostname + IP Dual Label) — `push-to-ui.py` PATCH label update
2. **AS-F1** (Edge cost labels toggle) — `topolograph.js` `_applyCostLabels()` function

These two features unlock all subsequent features. No Docker rebuild required — both are in `terminal-script/` (Python) and `topolograph-docker/init/topolograph.js` (bind-mounted JS).

## Sprint 1 — AS-IS Depth (2–3 days)

- AS-F2: LSDB metadata tooltip (pipeline: parse-lsdb-meta.py + push-to-ui.py update)
- AS-F3: Asymmetric link detector (client-side JS only)
- AS-F4: Degree heatmap (client-side JS only)
- EN-F5: Node inspector (client-side JS, small)
- EN-F4: UNK node dashboard (client-side JS, small)

## Sprint 2 — GATEWAY Intelligence (3–4 days)

- GW-F1: Connectivity matrix (client-side JS)
- GW-F2: Cost colouring in GATEWAY mode (client-side JS, small)
- GW-F4: Redundancy score (extends GW-F1)
- GW-F5: NMS CSV export (extends AS-F5 pattern)

## Sprint 3 — ENRICHED & COLLAPSING (3–4 days)

- EN-F1: Edge cost + type distinction in ENRICHED (client-side JS)
- EN-F2: OSPF area visualisation (requires `/get_areas_list` AJAX integration)
- EN-F3: Country-to-Country SPT panel (requires SPT endpoint calls)
- CL-F1: Persist collapse state (localStorage + pipeline `collapse-preferences.json`)
- CL-F2: Country-level SPT in collapsed view (requires SPT endpoint calls)
- CL-F3: Core count badge (small, extends `_markGatewayCollapsed()`)
- CL-F4: Inter-country cost table (client-side JS)

## Sprint 4 — DB2 Diff Mode (4–5 days)

- DB-F1: Dual loader panel (new `buildDb2Panel()`)
- DB-F2: Edge diff (AJAX fetches + diff engine)
- DB-F3: Node diff (extends edge diff)
- DB-F4: SPT diff (requires SPT endpoint × 2)
- DB-F5: Country impact matrix (batch SPT calls)
- AS-F5: Export (JSON/DOT/CSV) — add alongside DB2 sprint

---

## File Change Map

| File | Features |
|---|---|
| `terminal-script/push-to-ui.py` | HOT-F0, AS-F2 |
| `terminal-script/parse-lsdb-meta.py` *(new)* | AS-F2 |
| `terminal-script/generate-collapse-config.py` | CL-F1 |
| `INPUT-FOLDER/collapse-preferences.json` *(new)* | CL-F1 |
| `topolograph-docker/init/topolograph.js` | **ALL client-side features** |
| `02-STEP-BY-STEP/scripts/run-collapsing-validation.sh` | Validation updates |
| `tests/validate-collapsing-full.cjs` | B16+ test cases for new features |

---

## Docker Rebuild Required?

| Change | Docker Rebuild |
|---|---|
| `push-to-ui.py` changes | ❌ No (Python script, runs outside container) |
| `generate-collapse-config.py` changes | ❌ No (Python script, runs outside container) |
| `topolograph.js` changes | ❌ No (**bind-mounted** at `/init/topolograph.js`) |
| New Python dependencies in `push-to-ui.py` | ❌ No (uses stdlib only) |
| New Flask API endpoints | ✅ Yes (requires flask container rebuild) |

**Key finding**: All P1 and most P2 features are achievable WITHOUT a Docker rebuild. They operate in the bind-mounted JS file or in terminal scripts outside the container. Only the DB2 SPT Diff (DB-F4, DB-F5) requires additional Flask API endpoints and would trigger a rebuild.

---

*Document version: 2026-03-04 · OSPF-DATABASE-TEST · 34 routers · 10 countries · 26 features*
