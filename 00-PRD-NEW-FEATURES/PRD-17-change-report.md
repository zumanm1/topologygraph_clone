# PRD-17 — Change Window Risk Report (PDF/HTML Export)
## New button on 📋 Change Planner (`/change-planner`)

> **Priority**: P2 — build fourth
> **Effort**: MED (print CSS + HTML serialisation; no external libraries)
> **Upstream deps**: PRD-16 (recommended — scenario name in report header)
> **Optional enrichment**: PRD-14 (asymmetry findings), PRD-15 (matrix snapshot)
> **Downstream**: None (terminal PRD in this chain)
> **Status**: Planning

---

## 1. Problem Statement

After a network engineer uses Change Planner to model cost changes and analyse
impact (affected pairs, degraded/improved paths, risk score), there is no way to
export that analysis as a formal document to attach to a change ticket.

Every real-world change process (ITIL, CAB, RFC) requires a documented risk
assessment that shows:
- What is being changed (edge IDs, cost values)
- What is the expected impact (affected country pairs, before/after costs)
- What is the risk level (LOW / MEDIUM / HIGH / CRITICAL)
- Who prepared the plan and for which topology snapshot

Without this, the tool is a visualisation toy — with it, it becomes a planning
artefact generator that fits directly into change management workflows.

---

## 2. User Story

> As a network engineer preparing a CAB change request, I want to click
> "📄 Export Report" after running Analyse Impact, and receive an HTML file
> I can attach to the ticket and optionally print to PDF via the browser, showing
> all changes, the full impact table, risk score, and the topology snapshot used.

---

## 3. Feature Location

**Page**: `/change-planner`
**Integration**: `📄 Export Report` button added to Change Plan toolbar.
Button is **disabled** until Analyse Impact has been run at least once.

```
┌─ Change Plan ─────────────────────────────────────────────────────────────────┐
│  [+ Add Row]  [▶ Analyse Impact]  [🎬 Animate]                                │
│  [💾 Save Plan]  [📂 Load Plan]  [📄 Export Report]  [🗑 Clear]  [📊 CSV]   │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Report Structure

The generated HTML file contains five sections:

### Section 1 — Header / Metadata
```
OSPF Change Window Risk Report
Generated: 2026-03-11 21:17:14 UTC
Topology snapshot: 11Mar2026_21h17m14s_84_hosts
Plan description: "Transit cost increase for planned maintenance 14-Mar"
Topolograph version: 2.57.2
```

### Section 2 — Change Plan Table
| Edge ID | Mode | FWD Cost (before) | FWD Cost (after) | REV Cost (before) | REV Cost (after) |
|---------|------|-------------------|------------------|-------------------|------------------|
| e42 | ASYM | 100 | 100 | 64 | 9999 |
| e17 | SYM | 200 | 500 | 200 | 500 |

*"Before" costs are pulled from the loaded edge data; "after" are the override values.*

### Section 3 — Risk Assessment Summary
```
Overall Risk:  🔴 HIGH
Pairs affected: 14   Improved: 4   Degraded: 10
Risk factors:
  ✗ 3 country pairs will lose primary path
  ✗ 10 pairs degraded by >10%
  ✓ All country pairs retain at least one reachable path
  ✓ No countries become fully isolated
```

Risk scoring formula:
| Score | Level | Condition |
|-------|-------|-----------|
| 0–2 | 🟢 LOW | ≤2 pairs degraded, 0 lost |
| 3–5 | 🟡 MEDIUM | 3–6 pairs degraded OR ≤2 lost |
| 6–10 | 🟠 HIGH | 7–12 pairs degraded OR 3–5 lost |
| >10 | 🔴 CRITICAL | >12 pairs degraded OR >5 lost OR any country isolated |

### Section 4 — Affected Country Pairs Table
Full table of every pair where before-cost ≠ after-cost:
| Pair | Direction | Cost Before | Cost After | Delta | % Change | Status |
|------|-----------|-------------|------------|-------|----------|--------|
| CAN → USA | FWD | 264 | 310 | +46 | +17.4% | ↑ DEGRADED |
| FRA → AUS | FWD | 810 | 750 | -60 | -7.4% | ↓ IMPROVED |
| DEU → JPN | FWD | 1200 | ∞ | — | — | ⚫ LOST |

### Section 5 — Appendix (optional, if PRD-14 / PRD-15 data available)
- If PRD-14 data available: "Asymmetry audit at time of report: N pairs flagged"
- If PRD-15 data available: Full reachability matrix (before state)

---

## 5. HTML Report Template

The report is generated entirely in-browser using string templating.
No external libraries (no jsPDF, no html2canvas).

```js
function cpGenerateReport() {
  const meta = {
    generated:    new Date().toISOString().replace('T',' ').slice(0,19) + ' UTC',
    graphTime:    _cpGraphTime,
    description:  document.getElementById('cpDescription').value || '(none)',
    version:      '2.57.2'
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>OSPF Change Report — ${meta.graphTime}</title>
<style>
  /* Print-optimised CSS */
  body { font-family: -apple-system, sans-serif; color: #111; margin: 20mm; }
  h1 { font-size: 18pt; border-bottom: 2px solid #111; padding-bottom: 6px; }
  h2 { font-size: 13pt; color: #1e3a5f; margin-top: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10pt; }
  th { background: #1e3a5f; color: #fff; padding: 6px 10px; text-align: left; }
  td { border: 1px solid #ddd; padding: 5px 10px; }
  tr:nth-child(even) td { background: #f5f7fa; }
  .risk-HIGH { color: #b91c1c; font-weight: bold; }
  .risk-MED  { color: #d97706; font-weight: bold; }
  .risk-LOW  { color: #16a34a; font-weight: bold; }
  .tag-deg   { color: #c2410c; }
  .tag-imp   { color: #15803d; }
  .tag-lost  { color: #dc2626; font-weight: bold; }
  @media print { body { margin: 10mm; } }
</style>
</head>
<body>
  <h1>OSPF Change Window Risk Report</h1>
  <table class="meta-table">
    <tr><th>Generated</th><td>${meta.generated}</td></tr>
    <tr><th>Topology Snapshot</th><td>${meta.graphTime}</td></tr>
    <tr><th>Plan Description</th><td>${_cpEscHtml(meta.description)}</td></tr>
    <tr><th>Tool Version</th><td>Topolograph ${meta.version}</td></tr>
  </table>
  ${_cpBuildChangesTable()}
  ${_cpBuildRiskSummary()}
  ${_cpBuildImpactTable()}
  ${_cpBuildAppendix()}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ospf-change-report-${meta.graphTime}.html`;
  a.click();
}
```

### Print to PDF
The HTML file includes print-optimised CSS. Engineer opens the file in browser
and uses `Ctrl+P → Save as PDF`. No extra tooling needed.

---

## 6. "Before" Cost Resolution

To show before/after costs, the report needs to know what the edge cost was
*before* the override. This data is available in `_cpEdges` (the loaded edge
list). Resolution:

```js
function _cpBeforeCost(edgeId, direction) {
  const edge = _cpEdges.find(e => String(e.id) === String(edgeId));
  if (!edge) return null;
  const subs = edge.inside_ecmp_edges_ll;
  if (subs && subs.length) {
    const sub = subs[0];
    return direction === 'fwd' ? sub.weight : (sub.weight_rev ?? sub.weight);
  }
  return edge.weight ?? null;
}
```

If before-cost cannot be resolved (edge ID not found), show `—` in table.

---

## 7. Risk Score Computation

```js
function _cpComputeRisk(impactRows) {
  let degraded = 0, lost = 0, isolated = new Set();
  impactRows.forEach(r => {
    if (r.afterCost === Infinity)     { lost++;     isolated.add(r.src); isolated.add(r.dst); }
    else if (r.afterCost > r.beforeCost) degraded++;
  });
  const countryCount = KSP_atypeCountries(_cpNodes).length;
  if (isolated.size >= countryCount) return 'CRITICAL';  // all isolated
  if (lost > 5 || degraded > 12)     return 'CRITICAL';
  if (lost > 2 || degraded > 6)      return 'HIGH';
  if (lost > 0 || degraded > 2)      return 'MEDIUM';
  return 'LOW';
}
```

---

## 8. Files to Change

| File | Change |
|------|--------|
| `docker/flask/static/js/change-planner.js` | Add `cpGenerateReport()`, `_cpBuildChangesTable()`, `_cpBuildRiskSummary()`, `_cpBuildImpactTable()`, `_cpBeforeCost()`, `_cpComputeRisk()`, `_cpEscHtml()` |
| `docker/flask/change-planner.html` | Add `#cpBtnReport` button (disabled until impact run); no CSS changes needed (report uses inline/print CSS) |

**No changes to**: `ospf-ksp.js`, `security_overlay.py`, `Dockerfile`.

---

## 9. Security Hardening

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | XSS via edge IDs or labels in HTML | All dynamic content via `_cpEscHtml()` (replaces `<>&"'`) |
| 2 | Very long description field in HTML | Truncate to 500 chars with `…` |
| 3 | Report with 10,000 impact rows | Cap table at 500 rows; add note "First 500 of N rows shown" |
| 4 | Blob URL memory leak | `URL.revokeObjectURL(url)` after 60s timeout |

---

## 10. Edge Cases

| # | Case | Handling |
|---|------|----------|
| 1 | Report button clicked before Analyse Impact | Button is `disabled`; tooltip: "Run Analyse Impact first" |
| 2 | No affected pairs (all unchanged) | Section 4 shows "No pairs affected" |
| 3 | Before-cost unknown for an edge | Shows `—` in before columns; note in footer |
| 4 | PRD-14/15 data not available | Appendix section omitted silently |
| 5 | Very large graph (100+ countries, 10k pairs) | Async report generation with spinner; max 500 rows in impact table |

---

## 11. Acceptance Criteria

- [ ] `📄 Export Report` button disabled before Analyse Impact is run
- [ ] Button enabled after `cpAnalyseImpact()` completes
- [ ] Clicking button downloads `ospf-change-report-<graph_time>.html`
- [ ] Report contains all 5 sections
- [ ] Risk level matches expected value for a known test scenario
- [ ] Before costs shown for edges where data is available
- [ ] HTML file opens in browser and prints cleanly to PDF via `Ctrl+P`
- [ ] `_cpEscHtml` prevents XSS — `<script>` in description does not execute

---

## 12. Test Assertions (`tests/24-new-features-e2e.cjs`)

```js
// Phase D — Change Report
test('report button disabled before analyse', async () => {
  await page.goto(BASE_URL + '/change-planner');
  const btn = await page.locator('#cpBtnReport');
  await expect(btn).toBeDisabled();
});
test('report downloads after analyse', async () => {
  // add row + run analyse
  await page.click('#cpBtnAddRow');
  // ... set edge + costs
  await page.click('#cpBtnAnalyse');
  await page.waitForSelector('#cpImpactSummary');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#cpBtnReport')
  ]);
  expect(download.suggestedFilename()).toMatch(/^ospf-change-report-.+\.html$/);
});
test('report HTML contains required sections', async () => {
  const buffer = await download.createReadStream();
  const content = await streamToString(buffer);
  expect(content).toContain('OSPF Change Window Risk Report');
  expect(content).toContain('Risk Assessment');
  expect(content).toContain('Affected Country Pairs');
});
```
