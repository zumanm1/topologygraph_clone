# PRD-16 — Offline Scenario Save / Load
## New buttons on 📋 Change Planner (`/change-planner`)

> **Priority**: P2 — build third
> **Effort**: LOW (browser FileReader + Blob API; zero backend changes)
> **Upstream deps**: None
> **Downstream**: PRD-17 (Risk Report uses scenario name in report header)
> **Status**: Planning

---

## 1. Problem Statement

Change rows entered in Change Planner are **ephemeral** — they exist only in browser
memory and are lost on page refresh. There is no way to:

1. Save a planned maintenance window and continue it later
2. Share a draft change scenario with a colleague for review
3. Version-control planned OSPF cost changes alongside the LSDB snapshots
4. Load a previously-approved change plan at execution time to confirm impact

Network engineers managing multi-country OSPF domains routinely plan changes
days in advance and require peer review before a CAB (Change Advisory Board)
approval. Without persistence the tool cannot participate in that workflow.

---

## 2. User Story

> As a network engineer, I want to save my change plan (edge IDs + costs) as a
> JSON file, share it with my team lead via email or Teams, have them load it into
> their own Change Planner instance, review the impact, and approve it — all
> before any actual change is made on the network.

---

## 3. Feature Location

**Page**: `/change-planner`
**Integration**: Two new buttons added to the existing Change Plan toolbar,
between `Animate` and `CSV`.

```
┌─ Change Plan ─────────────────────────────────────────────────────────────────┐
│  Edge ID  │  Mode  │  FWD  │  REV                                             │
│  e42      │  asym  │  100  │  9999                                            │
│  ...                                                                           │
│                                                                                │
│  [+ Add Row]  [▶ Analyse Impact]  [🎬 Animate]  [💾 Save Plan]  [📂 Load Plan]│
│                                   [🗑 Clear]  [📊 CSV]                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. JSON Scenario File Format

```json
{
  "version": "1.0",
  "schema": "ospf-change-scenario",
  "created": "2026-03-11T21:17:14Z",
  "graph_time": "11Mar2026_21h17m14s_84_hosts",
  "description": "Transit cost increase for planned maintenance 14-Mar",
  "author": "",
  "changes": [
    {
      "id": 1,
      "edgeId": "e42",
      "mode": "asym",
      "fwd": 100,
      "rev": 9999
    },
    {
      "id": 2,
      "edgeId": "e17",
      "mode": "sym",
      "fwd": 500,
      "rev": 500
    }
  ]
}
```

### Field Notes
- `version`: format version (allows future migration)
- `schema`: identifier so apps can reject unrelated JSON files
- `graph_time`: the snapshot this plan was created against (displayed as warning if loaded into a different snapshot)
- `description`: optional free-text (editable via a text field in UI)
- `author`: empty by default (not tracked — privacy-safe)
- `changes`: exact serialisation of `_cpRows` array (edge ID + mode + costs)

---

## 5. Save Flow

```
1. User clicks 💾 Save Plan
2. If _cpRows is empty: show toast "Nothing to save — add changes first"
3. Build JSON object (format above); include current graph_time from selector
4. Show optional description field: <input placeholder="Add plan description (optional)">
5. Generate filename: change-plan-<graph_time>-<yyyymmdd>.json
6. Create Blob:
     const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
     const a = document.createElement('a');
     a.href = URL.createObjectURL(blob);
     a.download = filename;
     a.click();
7. Show notification: "Plan saved: change-plan-11Mar2026_21h17m14s_84_hosts-20260311.json"
```

---

## 6. Load Flow

```
1. User clicks 📂 Load Plan
2. Create hidden <input type="file" accept=".json"> and trigger .click()
3. FileReader.readAsText(file)
4. On load:
   a. Parse JSON — if parse fails: show error toast "Invalid JSON file"
   b. Validate schema field === "ospf-change-scenario"
      — if invalid: show error "Not a valid Change Plan file"
   c. Validate version — if unsupported: show warning (not error)
   d. If data.graph_time !== current graph_time:
        show warning banner:
        "⚠ This plan was created for [data.graph_time] but you have
         [currentGraphTime] loaded. Impact results may differ."
   e. Ask: "Load X changes? This will replace your current plan."
        [Cancel] [Load N changes]
   f. On confirm: clear _cpRows; populate from data.changes; re-render table
   g. Notification: "Loaded N changes from [filename]"
```

---

## 7. Description Field

Add a small text input above the change table:
```html
<input type="text" id="cpDescription"
       placeholder="Plan description (optional — saved with file)"
       style="width:100%; margin-bottom:6px; background:#1e2a38; color:#e0e8f0;
              border:1px solid #2d3f54; border-radius:4px; padding:4px 8px; font-size:11px;">
```
Value included in saved JSON. Pre-filled when a plan is loaded.

---

## 8. Files to Change

| File | Change |
|------|--------|
| `docker/flask/static/js/change-planner.js` | Add `cpSavePlan()`, `cpLoadPlan()`, `cpSerialise()`, `cpDeserialise()`, `cpMismatchWarning()` |
| `docker/flask/change-planner.html` | Add `#cpBtnSave`, `#cpBtnLoad`, `#cpDescription` input; update button row |

**No changes to**: `ospf-ksp.js`, `security_overlay.py`, `Dockerfile`.

---

## 9. Security Hardening

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Malicious JSON with `__proto__` pollution | Use `JSON.parse` only; validate `schema` field before any property access |
| 2 | File with 10,000 change rows (DoS) | Cap at 200 rows; show "File truncated to 200 rows" warning |
| 3 | XSS via description field | `textContent` (not `innerHTML`) when rendering description |
| 4 | Very large file | Cap file size at 1 MB in FileReader; reject with error if exceeded |

---

## 10. Edge Cases

| # | Case | Handling |
|---|------|----------|
| 1 | Empty change rows | "Nothing to save" toast; Save button disabled if rows empty |
| 2 | Load over existing changes | Confirmation dialog before overwrite |
| 3 | Snapshot mismatch | Yellow warning banner; allow load anyway |
| 4 | Browser blocks download | Show fallback: textarea with JSON for manual copy |
| 5 | File with unknown edge IDs | Load rows anyway; user will see blank Edge ID fields which they can re-select |

---

## 11. Acceptance Criteria

- [ ] `💾 Save Plan` downloads a valid `.json` file when rows exist
- [ ] Downloaded file matches the schema defined in §4
- [ ] `📂 Load Plan` populates the change table from a valid file
- [ ] Snapshot mismatch shows warning banner (not blocking error)
- [ ] Empty rows → Save disabled with tooltip "Add changes first"
- [ ] Malformed JSON shows error toast without crashing
- [ ] Description field value persists in saved file and restores on load
- [ ] Large file (>1 MB) rejected with error message

---

## 12. Test Assertions (`tests/24-new-features-e2e.cjs`)

```js
// Phase C — Save/Load Scenario
test('save plan downloads file', async () => {
  // Add a row first
  await page.click('#cpBtnAddRow');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#cpBtnSave')
  ]);
  expect(download.suggestedFilename()).toMatch(/^change-plan-.+\.json$/);
});
test('load plan restores rows', async () => {
  // Write temp file, load it
  const scenarioPath = path.join(__dirname, 'fixture-scenario.json');
  fs.writeFileSync(scenarioPath, JSON.stringify({
    version: '1.0', schema: 'ospf-change-scenario',
    graph_time: 'test', description: 'test', author: '', changes: [
      { id: 1, edgeId: 'e42', mode: 'sym', fwd: 100, rev: 100 }
    ]
  }));
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#cpBtnLoad')
  ]);
  await fileChooser.setFiles(scenarioPath);
  await page.click('#cpLoadConfirm');
  const rows = await page.$$('.cp-change-row');
  expect(rows.length).toBe(1);
});
```
