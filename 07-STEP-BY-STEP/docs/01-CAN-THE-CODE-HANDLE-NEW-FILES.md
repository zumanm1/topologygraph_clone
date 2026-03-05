# Can the Code Handle a New OSPF File and Hostname File?

## Short Answer

**Yes — with no code changes whatsoever.**

Pass the new files as explicit CLI arguments and the entire pipeline
(`workflow.sh → fetch-from-api.sh → topology-country-tool.sh →
generate-collapse-config.py → push-to-ui.py`) works transparently
with any OSPF database file and any hostname file.

This document explains *why*, tracing every script from inputs to outputs.

---

## Architecture: How Files Flow Through the System

```
                     ┌─────────────────────────────────────────────┐
                     │              INPUT-FOLDER/                  │
                     │  ospf-database-3b.txt  ←─ your OSPF file   │
                     │  Load-hosts-3b.txt     ←─ your host map    │
                     └────────────────┬────────────────────────────┘
                                      │  explicit CLI flags
                                      ▼
                     ┌─────────────────────────────────────────────┐
                     │           workflow.sh all                   │
                     │   --ospf-file ospf-database-3b.txt         │
                     │   --host-file Load-hosts-3b.txt            │
                     └─┬───────────────────────────────────────────┘
                       │
          ┌────────────┼─────────────────────────────────────┐
          │            │                                      │
          ▼            ▼                                      ▼
    Step 1         Step 2                               Step 3
  Upload OSPF    Fetch raw graph                    Run terminal pipeline
  via REST API   from API → disk                   (country enrichment)
       │               │                                      │
       │               ▼                                      ▼
       │    IN-OUT-FOLDER/{graph_time}/          OUTPUT/.tmp_work_{graph_time}/
       │    ├── meta.json                        (temporary, deleted after)
       │    ├── nodes.json
       │    ├── edges.json                                     │
       │    └── edges.csv                        ┌────────────┼────────────┐
       │                                         ▼            ▼            ▼
       │                                    Step 3a       Step 3b      Step 3c
       │                                    AS-IS         GATEWAY      ENRICHED
       │                                    copy          topology     + country
       │
       └─────────────────────┬─────────────────────────────────────────────┐
                             │                                              │
                        Step 4                                         Step 5
                  generate-collapse-config.py                       push-to-ui.py
                  (gateway/core split)                          (PATCH node colours)
                             │                                              │
                             ▼                                              ▼
                  OUTPUT/COLLAPSING/                           Topolograph UI
                  {graph_time}_COLLAPSING/                  (coloured graph view)
```

Every path in the system is **parameterised**. No script assumes a
particular filename. The file name `ospf-database-3b.txt` vs
`ospf-database-3.txt` is completely invisible to the pipeline once
it receives the `--ospf-file` argument.

---

## Script-by-Script Evidence (No Code Changes Needed)

### 1. `workflow.sh` — Master Orchestrator

**Relevant lines (simplified):**
```bash
OSPF_FILE="${1:-auto-detect}"     # overridden by --ospf-file
HOST_FILE="${2:-Load-hosts.txt}"  # overridden by --host-file

step_upload_ospf()   { POST $OSPF_FILE → API }
step_fetch_raw()     { GET  latest graph → IN-OUT-FOLDER }
step_terminal_pipeline() {
    topology-country-tool.sh \
        --ospf-file "$OSPF_FILE" \   ← whatever you passed
        --host-file "$HOST_FILE"     ← whatever you passed
}
```

The `--ospf-file` and `--host-file` values flow through unchanged.
The script cares about the *content* of the file (valid OSPF LSDB),
not the filename.

**Auto-detection fallback chain (only used when no flags given):**
```
ospf-database-3.txt → ospf-database-2.txt → (empty, no upload)
```
Since `ospf-database-3b.txt` is not in this chain, you **must**
pass `--ospf-file` explicitly. That is the only requirement.

---

### 2. `topology-country-tool.sh` — Country Enrichment Engine

This script is the core parser. It reads the OSPF file using `awk`
pattern matching, looking for OSPF LSDB structure:

```
"Advertising Router:" → identifies each router
"point-to-point"      → identifies each link
"Neighboring Router ID" + "TOS Metrics" → extracts cost
```

It does **not** check the filename — only the content. As long as
`ospf-database-3b.txt` contains valid Cisco OSPF LSDB output (which
it does, since it's a copy of `ospf-database-3.txt`), the awk parser
extracts edges identically.

**Host file handling:**
```bash
# Auto-detects format from content, not filename
if first_line_has_comma; then format=CSV
else format=TXT
```
Works with any filename. CSV or TXT auto-detected by content inspection.

---

### 3. `fetch-from-api.sh` — API Graph Fetcher

This script **never touches the OSPF file at all**. It fetches from
the Topolograph API by `graph_time`. The OSPF file was already
consumed in Step 1 (upload). After upload, the API returns a
`graph_time` string — that is the only identifier used.

```bash
GET /api/graph/                     → list all graphs, find latest
GET /api/diagram/{graph_time}/nodes → 54 nodes (JSON)
GET /api/diagram/{graph_time}/edges → 148 edges (JSON + CSV)
```

No filename dependency.

---

### 4. `generate-collapse-config.py` — Collapse Generator

Reads from two folders (paths passed as arguments):
```python
enriched_dir = args.enriched_dir   # e.g. OUTPUT/ENRICHED/{graph_time}_ENRICHED/
asis_dir     = args.asis_dir       # e.g. OUTPUT/AS-IS/{graph_time}_AS-IS/
```

Reads files by their **stage-prefix names**, not OSPF filenames:
```python
open(enriched_dir / "ENRICHED_country-mapping.csv")
open(asis_dir     / "AS-IS_nodes.json")
open(asis_dir     / "AS-IS_edges.json")
```

Completely version-agnostic.

---

### 5. `push-to-ui.py` — Colour Palette Pusher

Reads `ENRICHED_country-mapping.csv`, patching each node in
Topolograph via REST API. No filename dependency — just graph_time.

```python
url = f"{base_url}/api/diagram/{graph_time}/nodes/{node_id}"
requests.patch(url, json=payload)
```

---

## What the Code DOES Check (Correctly)

### Content Validation (not filename validation)

| Check | Where | What It Verifies |
|-------|-------|-----------------|
| OSPF LSDB format | `topology-country-tool.sh` (awk) | Finds "Advertising Router:" blocks |
| Host file format | `topology-country-tool.sh` | Auto-detects CSV vs space-separated TXT |
| API response | `fetch-from-api.sh` | Valid JSON array with graph_time field |
| Node count | `fetch-from-api.sh` (logging) | Logs "54 nodes" for confirmation |
| Country mapping | `push-to-ui.py` | Warns on UNK nodes (unmapped in host file) |

### The Only Hard Requirement

The OSPF file must be valid Cisco OSPF LSDB text format — the same
format produced by `show ip ospf database detail` on a Cisco router.
`ospf-database-3b.txt` satisfies this because it is a byte-for-byte
copy of the verified `ospf-database-3.txt`.

---

## Summary Table

| Script | Reads OSPF filename? | Reads host filename? | Works with 3b files? |
|--------|---------------------|---------------------|----------------------|
| `workflow.sh` | via `--ospf-file` arg | via `--host-file` arg | ✅ Yes, with flags |
| `topology-country-tool.sh` | via `--ospf-file` arg | via `--host-file` arg | ✅ Yes |
| `fetch-from-api.sh` | ❌ Never (API only) | ❌ Never | ✅ Yes |
| `generate-collapse-config.py` | ❌ Never (folder paths) | ❌ Never | ✅ Yes |
| `push-to-ui.py` | ❌ Never (graph_time) | ❌ Never | ✅ Yes |
| `save-load-hosts.sh` | ❌ Not applicable | via `--from` arg | ✅ Yes |

**Verdict: Zero code changes. Two explicit CLI flags. Full pipeline.**
