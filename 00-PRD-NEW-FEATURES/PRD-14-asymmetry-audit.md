# PRD-14 — K-Path All-Pairs Asymmetry Audit
## New tab on 🛤 K-Path Explorer (`/path-explorer`)

> **Priority**: P1 — build first
> **Effort**: LOW (pure JS, reuses ospf-ksp.js, no new endpoints)
> **Upstream deps**: None (ospf-ksp.js already exists)
> **Downstream**: PRD-17 (Risk Report can embed audit findings)
> **Status**: Planning

---

## 1. Problem Statement

The existing network score card checks for **asymmetric edges** (single hop A→B cost ≠ B→A
cost) but does NOT check for **end-to-end asymmetric paths** between countries.
A path from CAN→USA may traverse 3 hops with total cost 264, while USA→CAN goes
a completely different route at cost 310 — a 17% asymmetry that causes latency
inconsistency, TCP retransmit spikes, and is invisible to the current tooling.

Engineers only discover this by manually running K-Path Explorer for every pair —
which is O(N²) combinations for N A-type countries.

---

## 2. User Story

> As a network planner managing a multi-country OSPF domain, I want to see in one
> click which country pairs have asymmetric shortest paths (fwd cost ≠ rev cost),
> ranked by severity, so I can prioritise which cost mismatches to correct before
> the next maintenance window.

---

## 3. Feature Location

**Page**: `/path-explorer`
**Integration point**: New tab `⚡ Asymmetry Audit` added alongside existing
`→ FWD` / `← REV` path tabs.

```
┌─ K-Path Explorer ────────────────────────────────────────────────────────────┐
│  [📊 Paths]  [⚡ Asymmetry Audit]   ← new tab here                          │
│                                                                               │
│  ┌─ Audit Controls ─────────────────────────────────────────────────────────┐│
│  │  Topology: [11Mar2026_21h17m14s_84_hosts ▼]   Threshold: [5 %]          ││
│  │  [▶ Run Full Audit]  [📄 Copy TSV]                                       ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                                                                               │
│  ┌─ Results ────────────────────────────────────────────────────────────────┐│
│  │  Found 7 asymmetric pairs (threshold 5%)                                 ││
│  │                                                                           ││
│  │  Pair        FWD Cost  REV Cost  Delta   %Asym  Severity                 ││
│  │  CAN → USA   264       310       +46     17.4%  🔴 HIGH                  ││
│  │  FRA → AUS   810       750       -60      7.4%  🟡 MED                   ││
│  │  DEU → JPN   1200      1050      -150    12.5%  🔴 HIGH                  ││
│  │  GBR → BRA   920       920       0        0.0%  🟢 SYM                   ││
│  │  ...                                                                      ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                                                                               │
│  Summary: 7 pairs above threshold · 3 HIGH · 4 MED · 12 SYM                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Algorithm

```
1. Get A-type countries from loaded topology: C = KSP_atypeCountries(nodes)
2. For each ordered pair (src, dst) where src != dst:
   a. fwdPair = KSP_bestPair(src, dst, nodes, adjFwd)
   b. revPair = KSP_bestPair(dst, src, nodes, adjFwd)  // NOT adjRev — same fwd graph
   c. if fwdPair && revPair:
        delta = revPair.cost - fwdPair.cost
        pct   = abs(delta) / fwdPair.cost * 100
        asymmetric = pct >= threshold
   d. record { src, dst, fwdCost, revCost, delta, pct, asymmetric }
3. Sort by pct DESC
4. Render table — highlight rows above threshold
```

**Note**: Uses `_peAdjFwd` (already built on topology load). No additional adj list needed.
`KSP_bestPair` picks the gateway node per country and runs one Dijkstra.
For N=10 countries → 90 pairs → 180 Dijkstra calls ≈ **~50ms** in JS (well within budget).

---

## 5. Severity Thresholds

| % Asymmetry | Badge | Meaning |
|------------|-------|---------|
| 0% | 🟢 SYM | Perfectly symmetric |
| 1–4.9% | 🔵 LOW | Within acceptable variance |
| 5–14.9% | 🟡 MED | Investigate; may affect traffic engineering |
| ≥15% | 🔴 HIGH | Actively problematic; flag for change ticket |

Default threshold input: `5%` (user-adjustable, re-runs filter client-side without re-computing).

---

## 6. Detailed UI Specification

### 6.1 Tab Header
```html
<div class="pe-tab" id="peTabAudit" onclick="peSelectTab('audit')">⚡ Asymmetry Audit</div>
```
Active state: yellow/amber glow (`#f59e0b`) to distinguish from FWD (cyan) / REV (orange).

### 6.2 Controls Row
- **Topology dropdown**: same `#peGraphTimeSel` selector (shared with paths tab; reads current value)
- **Threshold input**: `<input type="number" min="0" max="100" value="5" step="1">` — changing value re-filters in-memory results without re-running Dijkstra
- **Run button**: triggers full audit; shows spinner during computation
- **Copy TSV button**: copies tab-separated values to clipboard for pasting into Excel/Sheets

### 6.3 Results Table Columns
| Column | Description |
|--------|-------------|
| Pair | `SRC → DST` (country codes) |
| FWD Cost | Cheapest fwd path cost |
| REV Cost | Cheapest rev path cost |
| Delta | `REV − FWD` (signed) |
| % Asymmetry | `|delta| / fwdCost × 100`, 1 decimal place |
| Severity | Badge (🟢/🔵/🟡/🔴) |
| Action | `[🛤 View]` — switches to Paths tab, pre-selects this country pair |

### 6.4 Summary Bar (below table)
```
Found N asymmetric pairs above threshold X% · A HIGH · B MED · C SYM
```

---

## 7. Files to Change

| File | Change |
|------|--------|
| `docker/flask/static/js/path-explorer.js` | Add `peRunAudit()`, `peRenderAuditTable()`, `peAuditFilterByThreshold()`, `peAuditCopyTsv()` functions; update `peSelectTab()` to handle `'audit'` |
| `docker/flask/path-explorer.html` | Add `#peTabAudit` tab button; add `#peAuditPanel` div with controls + table; add audit CSS |

**No changes to**: `ospf-ksp.js`, `security_overlay.py`, `Dockerfile`.

---

## 8. Edge Cases & Hardening

| # | Case | Handling |
|---|------|----------|
| 1 | < 2 A-type countries loaded | Show "Load a topology with at least 2 A-type countries" — disable Run button |
| 2 | No path found for a pair (isolated country) | Row shows `—` for cost; marked as `⚫ NO ROUTE` |
| 3 | fwdCost = 0 (degenerate graph) | Guard: `if fwdCost === 0 → pct = 0` to avoid divide-by-zero |
| 4 | Very large topology (100+ countries, 10k pairs) | Show progress bar; yield to browser every 50 pairs via `setTimeout(fn, 0)` |
| 5 | Threshold changed while running | Lock controls during computation; re-enable on completion |

---

## 9. Acceptance Criteria

- [ ] Tab `⚡ Asymmetry Audit` appears on K-Path Explorer page
- [ ] Running audit on `11Mar2026_21h17m14s_84_hosts` produces ≥1 result row
- [ ] Changing threshold to 0% shows all pairs; changing to 100% shows only extreme asymmetry
- [ ] `[🛤 View]` action correctly pre-selects the country pair in the Paths tab
- [ ] Copy TSV button puts valid TSV on clipboard
- [ ] No path found cases render `⚫ NO ROUTE` without JS errors
- [ ] Audit completes in < 2 seconds for a 84-node topology

---

## 10. Test Assertions (Playwright — `tests/24-new-features-e2e.cjs`)

```js
// Phase A — Asymmetry Audit
test('audit tab visible', async () => {
  await page.click('#peTabAudit');
  await expect(page.locator('#peAuditPanel')).toBeVisible();
});
test('run audit returns results', async () => {
  await page.click('#peBtnRunAudit');
  await page.waitForSelector('.audit-row', { timeout: 5000 });
  const rows = await page.$$('.audit-row');
  expect(rows.length).toBeGreaterThan(0);
});
test('threshold filter works', async () => {
  await page.fill('#peAuditThreshold', '100');
  const visibleRows = await page.$$('.audit-row:not([hidden])');
  // at 100% threshold, only extreme cases remain
  expect(visibleRows.length).toBeLessThan(rows.length);
});
```
