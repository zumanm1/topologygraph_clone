# Topolograph: Validation and How It All Works

## Validation summary (after restart)

After restarting the app, the following is validated:

| Check | Result |
|-------|--------|
| **Containers** | All 7 core services running: `pipeline`, `webserver`, `flask`, `mongodb`, `mcp-server`, `layout-api`, `layout-db` |
| **HTTP** | `http://localhost:8081/login` returns 200 (full Flask app registered) |
| **App identity** | Page is Topolograph (OSPF/IS-IS topology UI), not default Nginx |
| **Default credentials** | Bootstrap secret accepted → session credentials active |
| **Bearer token** | `Authorization: Bearer <token>` against `/api/graph/` returns 200 |
| **API upload** | Upload OSPF via Web UI → `graph_time` created (54 hosts with UNK test fixture) |
| **Deep E2E** | 127 Playwright checks pass across AS-IS/ENRICHED/GATEWAY/COLLAPSING/Cost Matrix/What-If |
| **Security** | 17 security + 14 layout-isolation checks pass, 0 failures |

So: **the app is restarted and working end-to-end.**

---

## How to re-validate anytime

**Quick stack health check:**
```bash
docker compose ps
curl -s --max-time 5 http://localhost:8081/login | grep -c 'Topolograph\|login'
```

**Full Docker-native rebuild + deep validation (canonical):**
```bash
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
# Result: 127 passed, 0 failed, 0 warned (Steps 06+07+regression checks)
```

**Web UI user-journey + feature-surface validation:**
```bash
bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
# Result: 7 validators, 0 failed, 0 warned
```

**Security + layout-isolation validation:**
```bash
bash 11-STEP-BY-STEP-SECURITY/scripts/run-security-validation.sh
# Result: 17+14 passed, 0 failed, 0 warned
```

**Orchestrated run (Steps 08 + 11 in sequence):**
```bash
bash 12-STEP-BY-STEP-ORCHESTRATED/scripts/run-orchestrated-validation.sh
```

---

## Deeper understanding: architecture

### 1. What runs when you “start the app”

`docker compose up -d` from the repository root starts the core services:

| Container | Role | Port (host) | Depends on |
|-----------|------|-------------|------------|
| **mongodb** | Stores graphs, users, API state | 27017 | — |
| **flask** | Topolograph backend: parses LSDB, builds graph, REST API, auth | (none exposed) | mongodb |
| **webserver** | Nginx: reverse proxy; forwards `/` and `/api/*` to Flask, `/layout-api/*` to layout-api, `/mcp` to MCP server | **8081** | flask, mcp-server, layout-api |
| **mcp-server** | MCP server for AI/LLM tools (path, nodes, etc.) | 8000 | flask (via API) |
| **pipeline** | Bash + Python runner for the packaged OSPF pipeline | — | webserver, flask |
| **layout-api** | FastAPI service: saves/loads per-user per-graph-time vis.js node positions | (internal) | layout-db |
| **layout-db** | PostgreSQL: stores layout snapshots keyed by owner+graph_id+graph_time+view_mode | 5432 (internal) | — |

You only need to open **http://localhost:8081** in the browser. Nginx receives the request and proxies it to Flask. Flask serves the web UI and the REST API under `/api/`.

### 2. Request flow (high level)

1. **Browser** → `http://localhost:8081/` → **webserver (Nginx)**.
2. Nginx matches `location /` and **proxy_pass** to **flask:5000**.
3. **Flask** serves the main HTML (Topolograph title, “Login / Local login”, etc.).
4. For **login**, the same origin (`http://localhost:8081`) is used; Flask handles session/auth.
5. For **upload**, the UI or your script sends `POST http://localhost:8081/api/graph` with `lsdb_output`, `vendor_device`, `igp_protocol`. Flask parses the LSDB (e.g. Cisco TextFSM), builds the graph, stores it in **MongoDB**, and returns `graph_time`, `hosts`, `networks`, `reports`.

So “restart the app” = restart these four containers; “validate it’s working” = check that the same flow (HTTP 200, Topolograph page, credentials, API upload, and optional network API) all succeed.

### 3. Why you might see “Welcome to nginx!” instead of Topolograph

That message is the **default Nginx index** page. So you’re hitting **an Nginx that is not the Topolograph webserver container** (e.g. another Nginx on the same port, or a different stack). When Topolograph is the one answering, the response body contains “Topolograph” / “OSPF/OSPFv3/IS-IS … topology” and the login UI. The validation script checks for that.

### 4. Data flow for your OSPF file

1. **ospf-database.txt** (Cisco “show ip ospf database router” output) is sent to `POST /api/graph`.
2. Flask (Topolograph) uses **Cisco TextFSM** templates (from the `topolograph` repo) to parse Router LSAs and build nodes + edges.
3. Graph is stored in **MongoDB** and identified by **graph_time** (e.g. `26Feb2026_10h17m30s_34_hosts`).
4. You can then:
   - Open that graph in the UI at **http://localhost:8081** (after login).
   - Call **GET /api/network/<graph_time>** to get networks/prefixes and RIDs.
   - Use **POST /api/path** for shortest path, backup path, etc. (see Topolograph README/API docs).

### 5. One-off “create credentials” container

`flask-create-creds-from-env` runs once at startup: it calls Flask’s `create-default-credentials` so the user and password from `.env` exist and authorised networks are set. After that the container exits. It’s not needed for normal operation; the Docker-native validation scripts can re-run the same bootstrap endpoint through the `e2e-runner` container when needed.

---

## Summary

- **Restart:** `docker compose down && docker compose up -d` from the repository root.
- **Validate (canonical):** `bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh` — full Docker rebuild + 127-check E2E + security regression.
- **Validate (Web UI suite):** `bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh` — 7-validator user-journey + feature-surface suite.
- **Validate (orchestrated):** `bash 12-STEP-BY-STEP-ORCHESTRATED/scripts/run-orchestrated-validation.sh` — Steps 08 + 11 in sequence.
- **Login URL:** **http://localhost:8081/** with **Login / Local login** and credentials from `.env` (e.g. `ospf@topolograph.com` / `ospf`).

With the checks above, everything is validated and working.
