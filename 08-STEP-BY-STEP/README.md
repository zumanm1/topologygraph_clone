# 08-STEP-BY-STEP
## All-Docker Rebuild + Validation Retest

This folder captures the **new all-Docker validation flow** for the OSPF Country Topology stack.

It exists because:

- `06-STEP-BY-STEP` validated the deep 54-router behavior
- `07-STEP-BY-STEP` validated a new-file pipeline run
- both were created during an earlier transition period when some execution still happened from the host machine

`08-STEP-BY-STEP` is the updated, container-native version:

- rebuild containers from the repo root
- run the pipeline **inside** the `pipeline` container
- run the deep Playwright validation **inside** the `e2e-runner` container
- validate Bearer-token API access on the modified app before pipeline and E2E phases
- preserve the same validation intent as `06` and `07`

In practical terms, `08-STEP-BY-STEP` is now the **canonical merged test package**:

- it carries forward the old `07-STEP-BY-STEP` goal of proving the full pipeline run and output artefacts
- it carries forward the old `06-STEP-BY-STEP` goal of proving the deeper 54-router UI and analysis behavior
- it does both through the new fully Dockerized execution path

---

## Packaged Test Fixtures Used By 08

`08` is intentionally tied to the packaged repository fixtures that ship in `INPUT-FOLDER/`:

- `ospf-database-54-unk-test.txt`
- `Load-hosts-54-unk-test.txt`
- `Load-hosts.csv`
- `Load-hosts-3b.txt`
- `collapse-preferences.json`

These fixtures preserve the desired regression shape for testing:

- 54 routers in the OSPF database
- 34 mapped hosts in the default host file
- 20 remaining `UNK` routers for validation across ENRICHED, GATEWAY, COLLAPSING, Cost Matrix, and hostname upload flows
- a standard CSV/TXT host-file pair for browser-side hostname-derived country-code validation

This makes the Docker app self-contained for basic and deep testing directly after clone.

---

## Verified Remote Install And Runbook

The current repository remote for this project is:

- `https://github.com/zumanm1/topologygraph_clone.git`

The GitHub CLI is also available for users who prefer `gh repo clone`.

### Clone on a remote machine

Option A — with `gh`:

```bash
gh repo clone zumanm1/topologygraph_clone
cd topologygraph_clone
```

Option B — with `git`:

```bash
git clone https://github.com/zumanm1/topologygraph_clone.git
cd topologygraph_clone
```

### Prerequisites

Install these on the remote machine:

- `git`
- Docker Engine
- Docker Compose plugin
- optional: GitHub CLI (`gh`)

Example baseline packages for Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

Then verify:

```bash
docker --version
docker compose version
git --version
gh --version
```

### Prepare environment

From the repository root:

```bash
cp .env.example .env
```

The defaults are usually enough for a basic remote test deployment.

### Build and start the Docker app

```bash
docker compose build
docker compose up -d
```

Verify:

```bash
docker compose ps
curl -I http://localhost:8081
```

In a browser, open:

```text
http://<REMOTE_IP>:8081
```

### Start the test container

```bash
docker compose --profile test up -d e2e-runner
```

### Run the canonical Docker-native validation

```bash
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
```

This remains the recommended end-to-end validation entrypoint for a fresh remote-machine deployment.

It now also proves that the modified app on `8081` preserves the original-style
Topolograph API security path by:

- logging in through the web session
- creating a Bearer token through `/token_management/create_token`
- validating `Authorization: Bearer ...` against `/api/graph/`
- validating the dedicated layout-persistence service and per-mode saved layout workflow

If you want the **updated full Web UI user-journey suite** for the current codebase,
run:

```bash
bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```

That suite complements `08` by focusing on browser upload, browser hostname import,
all four view modes, feature-surface checks, layout/export controls, screenshots,
and the Step 10 validation report.

---

## What This Step Validates

### 1. Full stack rebuild

From the project root:

```bash
docker compose down
docker compose build
docker compose up -d
```

This raises the 5 core services:

- `mongodb`
- `flask`
- `mcp-server`
- `webserver`
- `pipeline`

And the test-only service:

- `e2e-runner` via `--profile test`

### 2. 07-style pipeline retest in Docker

Instead of running host-side scripts directly, the pipeline now runs in:

- `pipeline`

Command:

```bash
docker compose exec pipeline bash docker/scripts/docker-pipeline.sh \
  --ospf-file=ospf-database-54-unk-test.txt \
  --host-file=Load-hosts-54-unk-test.txt
```

This is the Docker-native equivalent of the old `07-STEP-BY-STEP` pipeline proof, now based on the packaged 54-router UNK-validation fixture pair.

### 2a. Bearer-token API security regression check

Before the pipeline run, `08` now proves that the modified app keeps the
original Topolograph Bearer-token workflow working on `http://localhost:8081`:

- create a token through the authenticated web session
- read the created token from MongoDB
- call `/api/graph/` with `Authorization: Bearer ...`

Expected result:

- Bearer-authenticated `/api/graph/` returns `200`

### 3. 06-style deep E2E retest in Docker

The full deep validation now runs in:

- `e2e-runner`

Command:

```bash
docker compose --profile test up -d e2e-runner
docker compose exec e2e-runner bash docker/scripts/docker-e2e.sh \
  --graph-time=06Mar2026_10h12m29s_54_hosts
```

This is the Docker-native equivalent of `06-STEP-BY-STEP/scripts/run-full-e2e-v2.sh`.

### 4. Hostname-mapping page load regression check

After the deep E2E run, `08` now also performs a focused regression check for the hostname-mapping page:

- open `/ospf-host-to-dns-mapping` after the Docker restart
- verify the empty-state message is not visible
- verify the graph selectors are populated for load and migration flows

Command used by the 08 runner:

```bash
bash 08-STEP-BY-STEP/scripts/check-hostname-mapping-page.sh
```

### 5. Layout-persistence regression check

After the deep E2E run, `08` now also validates the new saved-layout workflow:

- dedicated blank `layout-db` service starts successfully
- proxied `/layout-api/health` responds through the webserver
- the new layout toolbar controls render in the UI
- a moved node can be saved, reloaded, reset per-node, reset per-layout, and exported

Command used by the 08 runner:

```bash
docker compose exec -e GRAPH_TIME=<graph_time> e2e-runner \
  node /app/tests/validate-layout-persistence.cjs
```

---

## What 08 Inherits From 07-STEP-BY-STEP

The old `07` suite proved the pipeline itself.

`08` keeps that intent and re-runs it through Docker with the packaged fixtures.

The retained verification points are:

- pre-flight container readiness
- Bearer-token API security on the modified app
- full pipeline execution inside Docker
- creation of the expected output families under `IN-OUT-FOLDER/` and `OUTPUT/`
- validation of the key topology numbers
- proof that the UI receives the pushed enriched topology

Operationally, this is the `07` question restated in Docker form:

- can a fresh repo clone run the packaged test OSPF file and host mapping entirely inside containers and produce the expected graph artefacts?

---

## What 08 Inherits From 06-STEP-BY-STEP

The old `06` suite proved the deeper behavioral surface of the 54-router graph.

`08` keeps that intent and re-runs it through Docker with the graph produced by the packaged fixtures.

The retained verification points are:

- Phase 0 pre-flight checks
- Phase 1 JSON artefact integrity
- deep Playwright validation across AS-IS, ENRICHED, GATEWAY, CURRENT, and COLLAPSING
- `UNK` visibility and behavior validation
- hostname upload and hostname-derived reclassification checks
- dedicated hostname-derived country-code regression (standard host file + conflicting 3-col file)
- layout save/load/reset/export validation through the dedicated layout service
- hostname-mapping page load regression after Docker restart
- Cost Matrix render and refresh regression checks
- What-If Analysis render, execution, and apply checks
- integration check: Apply Change → Cost Matrix survives and refreshes

Operationally, this is the `06` question restated in Docker form:

- after the Docker pipeline produces the graph, do all deeper UI and analysis behaviors still pass on the rebuilt stack?

---

## Canonical 08 Retest Command

```bash
bash 08-STEP-BY-STEP/scripts/run-all-docker-validation.sh
```

That command now does all of the following in one flow:

- rebuilds the Docker images
- starts the 5 core services
- starts the test-only `e2e-runner`
- validates Bearer-token API security on `8081`
- runs the packaged 54-router UNK pipeline
- runs the deep Docker-native validation against the resulting graph
- runs the dedicated hostname-derived country-code regression against the resulting graph
- runs the dedicated layout-persistence Playwright smoke test
- runs a dedicated hostname-mapping page regression check

---

## Fresh Validated Result From This Retest

### Graph produced by Docker pipeline

- `graph_time`: `06Mar2026_10h12m29s_54_hosts`

### 07-equivalent outcome

- pipeline run inside `pipeline` container: **PASS**
- fresh 54-router graph uploaded and processed: **PASS**
- output artifacts created: **PASS**

### 06-equivalent outcome

- deep Playwright validation inside `e2e-runner`: **PASS**
- total summary: **114 passed / 0 failed / 2 warnings**

---

## The Two Warnings Observed

These were warnings, not failures:

- `P3-GW`: core nodes hidden count was lower than the historical expectation
- `P8-MAT`: UNK row had no non-zero cost cells

The suite still ended with:

```text
STATUS: ALL 06-STEP-BY-STEP CHECKS PASSED ✅
```

So these remain informational observations, not regressions that broke the full stack.

---

## Why 08 Matters

`06` and `07` proved feature correctness.

`08` proves something more operationally important:

- the **same validations still succeed after rebuilding the new all-Docker app locally**
- the app is no longer dependent on host-side Python/Node execution for its primary validation path
- the older validation intent survives the infrastructure migration

---

## Files In This Folder

- `README.md`
  - overview of the new all-Docker retest

- `scripts/run-all-docker-validation.sh`
  - one-command rebuild + pipeline + e2e retest flow

- `scripts/check-hostname-mapping-page.sh`
  - focused regression check for hostname-mapping page graph loading after Docker restart

- `validation-report.txt`
  - summary of the successful local retest captured from this session
