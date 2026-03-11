# PRD-18 — Snapshot Timeline / Change History Explorer
## New mode on 🔀 Topology Diff (`/topo-diff`)

> **Priority**: P3 — build fifth (most complex)
> **Effort**: HIGH (sequential Dijkstra over many snapshots; date range UI)
> **Upstream deps**: `/api/graph-times` (already fixed in PRD-14→13 session)
> **Inter-PRD deps**: None (standalone)
> **Downstream**: None
> **Status**: Planning

---

## 1. Problem Statement

With 333+ saved topology snapshots, engineers can compare **any two** via the
existing Topology Diff page. But this is manual, one-pair-at-a-time.

There is no way to answer:
> "Show me every topology change that occurred between 06-Mar and 11-Mar,
>  ordered by time, with a summary of what changed in each transition."

This is the most critical tool for:
- **Post-incident forensics** — "when exactly did this link go bad?"
- **Capacity planning** — "how many link costs changed last quarter?"
- **Compliance** — "prove that the network was stable during the audit period"
- **Regression detection** — "did someone accidentally restore an old cost?"

---

## 2. User Story

> As a network operations engineer performing post-incident review, I want to
> select a date range, click "Run Timeline", and see a chronological list of
> every topology change that occurred — each row showing what changed, when, and
> by how much — so I can pinpoint the exact snapshot where a route change first
> appeared.

---

## 3. Feature Location

**Page**: `/topo-diff`
**Integration**: New mode `📅 Timeline` added as a third tab alongside
existing `🔍 Compare` and `📊 Diff Table` modes.

```
┌─ Topology Diff ──────────────────────────────────────────────────────────────┐
│  [🔍 Compare]  [📊 Diff Table]  [📅 Timeline]   ← new tab                  │
│                                                                               │
│  ┌─ Timeline Controls ─────────────────────────────────────────────────────┐ │
│  │  From: [06Mar2026 ▼]   To: [11Mar2026 ▼]                                │ │
│  │  Filter: [All snapshots ▼]  (or: 84_hosts only / 13_hosts only / All)   │ │
│  │  [▶ Run Timeline]   Max transitions: [50 ▼]   [📄 Export CSV]           │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─ Progress ──────────────────────────────────────────────────────────────┐ │
│  │  ████████████░░░░░░ Processing 18 of 24 transitions...                  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  Timeline: 24 snapshots → 23 transitions (3 with changes)                    │
│                                                                               │
│  ┌─ Transition List ───────────────────────────────────────────────────────┐ │
│  │  ▶ 11Mar2026_14h43m03s → 11Mar2026_21h17m14s  🔴 5 changes              │ │
│  │    ├ cost↑  e42: FRA:r1→DEU:r1  64 → 1000 (+936, +1463%)               │ │
│  │    ├ cost↓  e17: DEU:r1→USA:r1  200 → 100  (-100, -50%)                │ │
│  │    ├ new    e99: AUS:r1→SGP:r1  — → 400 (new adjacency)                │ │
│  │    ├ lost   e03: CAN:r1→FRA:r1  500 → — (adjacency removed)            │ │
│  │    └ cost↑  e28: GBR:r1→BRA:r1  300 → 600 (+300, +100%)               │ │
│  │                                                                           │ │
│  │  ✓ 10Mar2026_19h47m41s → 11Mar2026_14h43m03s  No changes               │ │
│  │  ✓ 10Mar2026_18h05m49s → 10Mar2026_19h47m41s  No changes               │ │
│  │  ▶ 10Mar2026_17h23m36s → 10Mar2026_18h05m49s  🟡 2 changes              │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Algorithm

### 4.1 Snapshot Filtering
```
1. Fetch full list from /api/graph-times → returns array sorted chronologically
2. Filter by date range: parse first 9 chars of graph_time (e.g. "11Mar2026")
   using custom date parser (no Date.parse needed — format is fixed)
3. Filter by topology type if user selected filter (e.g. only _84_hosts)
4. Cap at max_transitions + 1 snapshots
```

### 4.2 Sequential Diff Engine
```
For i = 0 to (filtered_snapshots.length - 2):
  snapA = filtered_snapshots[i]
  snapB = filtered_snapshots[i+1]

  dataA = await _tdLoadTopology(snapA)   // POST /upload-ospf-lsdb-from-js
  dataB = await _tdLoadTopology(snapB)   // POST /upload-ospf-lsdb-from-js

  diff  = _tdComputeDiff(dataA, dataB)
  // diff = { added: [], removed: [], changed: [{edgeId, before, after, delta, pct}] }

  results.push({ snapA, snapB, diff })
  updateProgress(i, filtered_snapshots.length - 1)

// Render all results after all diffs complete
```

**Performance note**: Each diff requires 2 topology fetches. For 50 transitions
→ up to 100 POST requests. These are sequential (not parallel) to avoid rate-limiting.
Estimated time: ~2s per pair × 50 = 100s. Progress bar + cancel button are required.

### 4.3 Diff Computation (`_tdComputeDiff`)
```js
function _tdComputeDiff(dataA, dataB) {
  const edgesA = new Map(dataA.edges.map(e => [String(e.id), e]));
  const edgesB = new Map(dataB.edges.map(e => [String(e.id), e]));

  const added   = [...edgesB.keys()].filter(id => !edgesA.has(id));
  const removed = [...edgesA.keys()].filter(id => !edgesB.has(id));
  const changed = [];

  for (const [id, eA] of edgesA) {
    if (!edgesB.has(id)) continue;  // removed — already handled
    const eB = edgesB.get(id);
    const costA = _tdEdgeCost(eA);
    const costB = _tdEdgeCost(eB);
    if (costA !== costB) {
      const delta = costB - costA;
      const pct   = costA !== 0 ? (delta / costA * 100).toFixed(1) : '∞';
      changed.push({ id, from: eA.from, to: eA.to, before: costA, after: costB, delta, pct });
    }
  }
  return { added, removed, changed };
}
```

### 4.4 Date Range Parsing
```js
const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
function _tdParseGraphTimeDate(gt) {
  // "11Mar2026_21h17m14s_84_hosts" → Date(2026, 2, 11)
  const m = gt.match(/^(\d{2})([A-Za-z]{3})(\d{4})/);
  if (!m) return null;
  return new Date(parseInt(m[3]), MONTHS[m[2]], parseInt(m[1]));
}
```

---

## 5. From/To Date Selector UI

Two `<select>` dropdowns populated from `/api/graph-times`:
- Extract unique dates from graph_time values
- Sort chronologically
- Default: From = earliest snapshot date; To = today's date

```html
<select id="tdTimelineFrom"><!-- populated from API --></select>
<select id="tdTimelineTo"><!-- populated from API --></select>
```

---

## 6. Cancel Button

Critical for long-running computations (50+ transitions):
```js
var _tdTimelineCancelled = false;

function tdCancelTimeline() {
  _tdTimelineCancelled = true;
  document.getElementById('tdBtnCancelTimeline').disabled = true;
  tdSetStatus('Cancelled — showing results so far');
}

// In the sequential loop:
if (_tdTimelineCancelled) break;
```

---

## 7. Export CSV Format

```
transition_from,transition_to,change_type,edge_id,from_node,to_node,cost_before,cost_after,delta,pct_change
11Mar2026_14h43m03s,11Mar2026_21h17m14s,cost_up,e42,fra-par-r1,deu-muc-r1,64,1000,+936,+1463%
11Mar2026_14h43m03s,11Mar2026_21h17m14s,new_link,e99,aus-syd-r1,sgp-sin-r1,,400,,
10Mar2026_17h23m36s,10Mar2026_18h05m49s,cost_down,e17,deu-ber-r1,usa-nyc-r1,200,100,-100,-50%
```

---

## 8. Transition Row Colour Coding

| Status | Badge | Colour | Condition |
|--------|-------|--------|-----------|
| No changes | ✓ | Grey | `diff.changed.length === 0 && added.length === 0 && removed.length === 0` |
| Minor change | 🔵 N changes | Blue | 1–2 cost changes, no additions/removals |
| Medium change | 🟡 N changes | Yellow | 3–5 changes OR 1 added/removed link |
| Major change | 🔴 N changes | Red | >5 changes OR >1 added/removed OR >50% cost increase |

---

## 9. Files to Change

| File | Change |
|------|--------|
| `docker/flask/static/js/topo-diff.js` | Add `tdRunTimeline()`, `_tdComputeDiff()`, `_tdParseGraphTimeDate()`, `tdRenderTimeline()`, `tdCancelTimeline()`, `tdExportTimelineCsv()` |
| `docker/flask/topo-diff.html` | Add `#tdTabTimeline` tab; `#tdTimelinePanel` with controls, progress, list; timeline CSS |
| `docker/flask/static/js/ospf-ksp.js` | No changes needed |

---

## 10. Performance Budget

| Scenario | Transitions | Est. Time |
|---------|-------------|-----------|
| 1 day (84_hosts only) | 2–5 | < 10s |
| 1 week (84_hosts only) | 10–20 | 20–40s |
| Full range, all types, max 50 | 50 | ~100s |

**Mitigations**:
- Progress bar + cancel button (required)
- Default max transitions: 20 (user can increase to 50)
- Topology cache: if same `graph_time` loaded in Compare tab, reuse cached data
- Show partial results as they arrive (don't wait for all 50 before rendering)

---

## 11. Edge Cases & Hardening

| # | Case | Handling |
|---|------|----------|
| 1 | From date > To date | Swap silently; notify user |
| 2 | Only 1 snapshot in range | Show "Need ≥2 snapshots — widen date range" |
| 3 | API returns 401 mid-sequence | Stop; show "Session expired — please reload" |
| 4 | Topology fetch times out | Mark transition as "Load error"; continue to next |
| 5 | 0 changes in all transitions | Show "No topology changes detected in this period" |
| 6 | Huge diff (300+ edge changes) | Expand/collapse rows; show first 10 + "Show all" |
| 7 | Same snapshot appears twice in list | Skip duplicate transitions (both sides identical) |

---

## 12. Acceptance Criteria

- [ ] `📅 Timeline` tab visible on Topology Diff page
- [ ] From/To dropdowns populated with unique dates from stored snapshots
- [ ] Running timeline on 06-Mar → 11-Mar range produces ≥1 transition row
- [ ] Transitions with no changes show `✓ No changes`
- [ ] Transitions with changes show expandable diff rows
- [ ] Progress bar advances during computation
- [ ] Cancel button stops computation at current position
- [ ] Export CSV downloads correctly formatted file
- [ ] Session timeout handled gracefully (no crash)

---

## 13. Test Assertions (`tests/24-new-features-e2e.cjs`)

```js
// Phase E — Snapshot Timeline
test('timeline tab visible', async () => {
  await page.goto(BASE_URL + '/topo-diff');
  await page.click('#tdTabTimeline');
  await expect(page.locator('#tdTimelinePanel')).toBeVisible();
});
test('timeline produces results for full date range', async () => {
  await page.selectOption('#tdTimelineFrom', { index: 0 });
  await page.selectOption('#tdTimelineTo', { index: -1 });
  await page.selectOption('#tdTimelineMax', '20');
  await page.click('#tdBtnRunTimeline');
  // Wait for progress to finish (up to 60s for 20 transitions)
  await page.waitForSelector('.td-transition-row', { timeout: 60000 });
  const rows = await page.$$('.td-transition-row');
  expect(rows.length).toBeGreaterThan(0);
});
test('cancel stops computation', async () => {
  await page.click('#tdBtnRunTimeline');
  await page.waitForSelector('#tdBtnCancelTimeline:not([disabled])');
  await page.click('#tdBtnCancelTimeline');
  await page.waitForSelector('.td-status-cancelled');
});
```
