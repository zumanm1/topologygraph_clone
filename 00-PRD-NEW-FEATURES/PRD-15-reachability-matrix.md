# PRD-15 — Country Reachability Matrix
## New tab on 💥 Impact Lab (`/impact-lab`)

> **Priority**: P1 — build second (parallel-capable with PRD-14)
> **Effort**: LOW-MED (pure JS; new table layout; reuses KSP_dijkstra)
> **Upstream deps**: None (ospf-ksp.js already exists)
> **Downstream**: PRD-17 (Risk Report can embed matrix snapshot)
> **Status**: Planning

---

## 1. Problem Statement

The Impact Lab currently answers: "what breaks if **this one node/link** fails?"
It does NOT answer the operational question every multi-country NOC needs:

> **"Which country pairs can communicate right now — and what are the costs?"**
> **"If node X fails, which country pairs go dark?"**

Network engineers today must manually run K-Path Explorer for every pair.
With 10 countries that is 90 pairs × 2 directions = 180 manual operations.
For 20 countries: 380 pairs. This is impractical for incident response.

---

## 2. User Story

> As a NOC engineer during a P1 incident, I want to see in a single colour-coded
> grid which country pairs still have a reachable path and at what cost, and I want
> to simulate removing a node to see which cells turn red — all without leaving
> the page.

---

## 3. Feature Location

**Page**: `/impact-lab`
**Integration**: New tab `🌍 Reachability Matrix` added alongside existing
`💥 Blast Radius` tab.

```
┌─ Impact Lab ─────────────────────────────────────────────────────────────────┐
│  [💥 Blast Radius]  [🌍 Reachability Matrix]   ← new tab                    │
│                                                                               │
│  ┌─ Controls ──────────────────────────────────────────────────────────────┐ │
│  │  Topology: [11Mar2026_21h17m14s_84_hosts ▼]                             │ │
│  │  Simulate failure: [None ▼]   (optional: pick a node to remove)         │ │
│  │  [▶ Build Matrix]  [📄 Export CSV]                                      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─ N×N Cost Matrix ───────────────────────────────────────────────────────┐ │
│  │       CAN   USA   FRA   DEU   GBR   AUS   JPN   SGP   BRA   KEN        │ │
│  │  CAN   —    264   870  1100   920  2100  3200  3400   990  1800        │ │
│  │  USA  310    —    600   900   750  1800  2900  3100   780  1600        │ │
│  │  FRA  870   600    —    200   300  1500  2600  2800  1200  1400        │ │
│  │  DEU 1100   900   200    —    500  1700  2800  3000  1400  1600        │ │
│  │  GBR  920   750   300   500    —   1600  2700  2900  1100  1500        │ │
│  │  AUS 2100  1800  1500  1700  1600    —   1100  800   2700   900        │ │
│  │  ...  ∞     ∞     ∞     ∞     ∞     ∞    ∞     ∞     ∞    ∞  ← NO ROUTE│ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  Colour scale: 🟢 <500  🟡 500–1500  🟠 1500–3000  🔴 >3000  ⚫ No route    │ │
│                                                                               │
│  ┌─ Failure Impact Summary ────────────────────────────────────────────────┐ │
│  │  [shown when a failure node is selected]                                 │ │
│  │  Pairs that lost reachability: 12   Pairs degraded: 8   Unaffected: 62  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Algorithm

### 4.1 Base Matrix (no failure)
```
1. C = KSP_atypeCountries(nodes)  // e.g. [CAN, USA, FRA, ...]
2. adj = KSP_buildDirAdjList(nodes, edges, {})
3. For each source country src in C:
   a. Find gateway node: srcId = KSP_bestPair(src, C[0], nodes, adj).srcId
      (or first A-type node for src country if bestPair unavailable)
   b. Run: result = KSP_dijkstra(srcId, adj, emptySet, emptySet)
   c. For each destination country dst in C:
        dstId = gateway node for dst
        matrix[src][dst] = result.dist.get(dstId) ?? Infinity
4. Render N×N table
```

**Complexity**: N Dijkstra runs (one per source country).
For N=10 → 10 Dijkstra calls ≈ **~10ms**.

### 4.2 Failure Simulation
```
1. failNode = selected node ID from dropdown
2. excl = new Set([failNode])
3. For each src gateway (skip src if gateway === failNode):
   a. result = KSP_dijkstra(srcId, adj, excl, emptySet)
   b. Fill matrix row as above
4. Compare with base matrix:
   - NEW_COST > BASE_COST → degraded (orange)
   - NEW_COST === Infinity, BASE_COST finite → lost (red)
   - NEW_COST === BASE_COST → unaffected (same colour)
```

### 4.3 Gateway Resolution per Country
```js
function _ilGateway(country, nodes) {
  // Returns the first A-type node ID whose parsed country === country
  const n = nodes.find(n => {
    const p = KSP_parseAtype(n.label || n.id || '');
    return p && p.country === country;
  });
  return n ? n.id : null;
}
```

---

## 5. Colour Scale Specification

| Cost Range | Colour | CSS Class | Hex |
|-----------|--------|-----------|-----|
| 0 (self) | Grey diagonal | `.rm-self` | `#374151` |
| 1–499 | Green | `.rm-low` | `#166534` bg + `#4ade80` text |
| 500–1499 | Yellow | `.rm-med` | `#713f12` bg + `#fbbf24` text |
| 1500–2999 | Orange | `.rm-high` | `#7c2d12` bg + `#fb923c` text |
| ≥3000 | Red | `.rm-crit` | `#7f1d1d` bg + `#f87171` text |
| ∞ (no route) | Black | `.rm-none` | `#030712` bg + `#6b7280` text + "∞" |

When failure simulation is active, cells that changed from base:
- Cost increased: add `.rm-degraded` pulsing outline (orange)
- Changed to ∞: add `.rm-lost` outline (red, thicker)

---

## 6. Detailed UI Specification

### 6.1 Tab
```html
<div class="il-tab" id="ilTabMatrix" onclick="ilSelectTab('matrix')">🌍 Reachability Matrix</div>
```

### 6.2 Failure Simulation Dropdown
- Options: `None` (base state) + all 84 nodes sorted by label
- Selecting a node immediately re-runs matrix with that node excluded
- Nodes that ARE a gateway for a country: flagged with `[GW]` suffix in dropdown

### 6.3 Export CSV
- Generates: `reachability-matrix-<graph_time>[-failure-<node>].csv`
- Format: standard CSV; `inf` for no-route cells; header row = country codes

### 6.4 Failure Impact Summary Panel
Only visible when a failure node is selected. Shows:
```
Node failed: can-tor-kem-r1 (CAN gateway)
Pairs LOST (∞): 18   Pairs DEGRADED (+cost): 7   UNAFFECTED: 57
Countries isolated: CAN (no routes to/from any country)
```

---

## 7. ospf-ksp.js Additions

Two small helper functions (no changes to existing functions):

```js
// Get first gateway node ID for a country
function KSP_countryGateway(country, nodesList) {
  const n = nodesList.find(function(n) {
    const p = KSP_parseAtype(n.label || n.id || '');
    return p && p.country.toUpperCase() === country.toUpperCase();
  });
  return n ? n.id : null;
}

// Build full cost matrix: Map<srcCountry, Map<dstCountry, cost>>
function KSP_reachabilityMatrix(countries, nodesList, adjList, excludedNodeSet) {
  var matrix = {};
  countries.forEach(function(src) {
    matrix[src] = {};
    var srcId = KSP_countryGateway(src, nodesList);
    if (!srcId || (excludedNodeSet && excludedNodeSet.has(String(srcId)))) {
      countries.forEach(function(dst) { matrix[src][dst] = Infinity; });
      return;
    }
    var result = KSP_dijkstra(srcId, adjList, excludedNodeSet || new Set(), new Set());
    countries.forEach(function(dst) {
      if (dst === src) { matrix[src][dst] = 0; return; }
      var dstId = KSP_countryGateway(dst, nodesList);
      matrix[src][dst] = dstId ? (result.dist.get(String(dstId)) ?? Infinity) : Infinity;
    });
  });
  return matrix;
}
```

---

## 8. Files to Change

| File | Change |
|------|--------|
| `docker/flask/static/js/ospf-ksp.js` | Add `KSP_countryGateway`, `KSP_reachabilityMatrix` |
| `docker/flask/static/js/impact-lab.js` | Add `ilBuildMatrix()`, `ilRenderMatrix()`, `ilSimulateFailure()`, `ilExportMatrixCsv()` |
| `docker/flask/impact-lab.html` | Add `#ilTabMatrix` tab; `#ilMatrixPanel` with controls + table; matrix CSS |

**No changes to**: `security_overlay.py`, `Dockerfile`, `topolograph.js`.

---

## 9. Edge Cases & Hardening

| # | Case | Handling |
|---|------|----------|
| 1 | < 2 A-type countries | Show "No A-type countries found — load a topology with A-type hostnames" |
| 2 | Gateway node is the failed node | That country's row/col shows ∞ for all; highlight header cell red |
| 3 | Asymmetric paths: matrix[A][B] ≠ matrix[B][A] | Show both; no auto-transpose; this IS the feature's value |
| 4 | Large N (>20 countries) | Matrix scrolls horizontally; sticky row/col headers via CSS |
| 5 | Export with Infinity values | Write as `inf` string in CSV; compatible with pandas/numpy/Excel |
| 6 | No topology loaded | Disable "Build Matrix" button; show "Load a topology first" |

---

## 10. Acceptance Criteria

- [ ] `🌍 Reachability Matrix` tab visible on Impact Lab page
- [ ] Running matrix on `11Mar2026_21h17m14s_84_hosts` produces N×N grid (N = count of A-type countries)
- [ ] Diagonal cells show grey `—`
- [ ] Colour scale correctly applied (green/yellow/orange/red/black)
- [ ] Selecting a failure node updates the matrix and shows Impact Summary
- [ ] Export CSV downloads correctly named file with valid data
- [ ] No JS errors on topology with 0 or 1 A-type countries

---

## 11. Test Assertions (`tests/24-new-features-e2e.cjs`)

```js
// Phase B — Reachability Matrix
test('matrix tab visible', async () => {
  await page.goto(BASE_URL + '/impact-lab');
  await page.click('#ilTabMatrix');
  await expect(page.locator('#ilMatrixPanel')).toBeVisible();
});
test('matrix builds on 84-host topology', async () => {
  await page.click('#ilBtnBuildMatrix');
  await page.waitForSelector('.rm-cell', { timeout: 8000 });
  const cells = await page.$$('.rm-cell');
  expect(cells.length).toBeGreaterThan(0);
});
test('failure simulation highlights lost cells', async () => {
  await page.selectOption('#ilFailureNode', { index: 1 });
  await page.waitForSelector('.rm-lost');
  const lost = await page.$$('.rm-lost');
  // at least one route is affected when any transit node fails
});
```
