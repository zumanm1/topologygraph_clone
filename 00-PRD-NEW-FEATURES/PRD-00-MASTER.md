# PRD-00 — Master Overview: New Feature Suite
## OSPF Network Planning & Audit Extensions

> **Folder**: `00-PRD-NEW-FEATURES/`
> **Status**: Planning
> **Date**: 2026-03-11

---

## 1. Executive Summary

Five new capabilities extend the existing 4-page OSPF Path Analysis Suite
(K-Path Explorer, Change Planner, Impact Lab, Topology Diff) built in PRD-08→13.
No new pages. No new routes. No new nav items.
Each feature adds a tab or button to an existing page and reuses `ospf-ksp.js`.

---

## 2. Feature Registry

| PRD   | Feature                        | Page              | Type        | Priority |
|-------|--------------------------------|-------------------|-------------|----------|
| PRD-14 | K-Path All-Pairs Asymmetry Audit | 🛤 K-Path Explorer | New tab     | **P1**   |
| PRD-15 | Country Reachability Matrix    | 💥 Impact Lab      | New tab     | **P1**   |
| PRD-16 | Offline Scenario Save/Load     | 📋 Change Planner  | New buttons | **P2**   |
| PRD-17 | Change Window Risk Report      | 📋 Change Planner  | New button  | **P2**   |
| PRD-18 | Snapshot Timeline Explorer     | 🔀 Topology Diff   | New mode    | **P3**   |

---

## 3. Cross-PRD Dependency Graph

```
ospf-ksp.js (exists) ──────────────────────────────────────────────┐
                                                                     │
PRD-14 (Asymmetry Audit) ──────────────────────────────────────────►│ standalone
    No upstream deps                                                  │
    ↓ output feeds                                                    │
PRD-17 (Risk Report): can embed asymmetry findings                   │
                                                                     │
PRD-15 (Reachability Matrix) ──────────────────────────────────────►│ standalone
    No upstream deps                                                  │
    ↓ output feeds                                                    │
PRD-17 (Risk Report): can embed matrix table                         │
                                                                     │
PRD-16 (Save/Load Scenario) ───────────────────────────────────────►│ standalone
    No upstream deps                                                  │
    ↓ output feeds                                                    │
PRD-17 (Risk Report): scenario name + loaded plan in report header   │
                                                                     │
PRD-17 (Change Risk Report) ──── depends on ──► PRD-16 (optional)   │
    Recommended: PRD-16 done first (scenario name/metadata)          │
    Optional:    PRD-15 done first (embed matrix in report)          │
    Optional:    PRD-14 done first (embed asymmetry flags)           │
                                                                     │
PRD-18 (Snapshot Timeline) ────────────────────────────────────────►│ standalone
    Depends on: MongoDB graph list (/api/graph-times — already fixed)│
    Depends on: Topology Diff page (exists)                          │
    No inter-PRD dependencies                                        │
```

### Strict dependency order for implementation

```
PRD-14  ──┐
PRD-15  ──┤── can all start in parallel (no inter-deps)
PRD-16  ──┤
PRD-18  ──┘

PRD-17  ──── start after PRD-16 (recommended); after PRD-14 & PRD-15 (optimal)
```

---

## 4. Priority Matrix

| PRD   | User Value | Build Effort | Risk | Start Order |
|-------|-----------|-------------|------|-------------|
| PRD-14 | HIGH — catches asymmetric routing in 1 click | LOW (pure JS) | Low | **1st** |
| PRD-15 | HIGH — answers "what countries are reachable?" | LOW-MED | Low | **2nd** |
| PRD-16 | MED — team-based scenario sharing | LOW | Low | **3rd** |
| PRD-17 | HIGH — required for ITIL/CAB sign-off | MED | Low | **4th** |
| PRD-18 | MED-HIGH — post-incident forensics | HIGH | Med | **5th** |

---

## 5. Shared Principles (all PRDs)

- **Zero new Flask routes**: All 5 features use existing endpoints
  (`/upload-ospf-lsdb-from-js`, `/api/graph-times`, browser FileReader/Blob)
- **Zero new pages**: Features integrate as tabs/panels/buttons on existing 4 pages
- **ospf-ksp.js is the engine**: All path computations reuse existing library
- **Dark theme**: All new UI matches existing `#1a2535` / `#0f172a` palette
- **No external libraries**: No jsPDF, no Papa Parse — native browser APIs only

---

## 6. Files Affected (all PRDs combined)

| File | PRDs | Change Type |
|------|------|-------------|
| `docker/flask/static/js/path-explorer.js` | PRD-14 | Add audit tab logic |
| `docker/flask/path-explorer.html` | PRD-14 | Add audit tab HTML + CSS |
| `docker/flask/static/js/impact-lab.js` | PRD-15 | Add matrix tab logic |
| `docker/flask/impact-lab.html` | PRD-15 | Add matrix tab HTML + CSS |
| `docker/flask/static/js/change-planner.js` | PRD-16, PRD-17 | Save/load + report export |
| `docker/flask/change-planner.html` | PRD-16, PRD-17 | Buttons + print CSS |
| `docker/flask/static/js/topo-diff.js` | PRD-18 | Timeline mode |
| `docker/flask/topo-diff.html` | PRD-18 | Timeline tab + CSS |
| `docker/flask/static/js/ospf-ksp.js` | PRD-15, PRD-17 | Minor additions only |

---

## 7. Test Coverage

Each PRD will produce one Playwright assertion block appended to
`tests/23-path-analysis-suite-e2e.cjs` (Phase H onwards), plus unit
assertions in a new file `tests/24-new-features-e2e.cjs`.

---

## 8. Related PRDs

| PRD Set | Description |
|---------|-------------|
| PRD-08 → PRD-13 | Existing: ospf-ksp.js, 4 analysis pages, navbar, routes |
| **PRD-14 → PRD-18** | **This suite: 5 feature extensions** |
