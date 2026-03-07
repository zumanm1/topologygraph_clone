# 10-STEP-BY-STEP — How To Run

## Recommended command

From the repository root:

```bash
bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```

Visible browser mode:

```bash
HEADLESS=false bash 10-STEP-BY-STEP/scripts/run-updated-webui-validation.sh
```

---

## What the runner does

1. loads environment from `.env` or `.env.example`
2. ensures the Docker stack is running
3. ensures `e2e-runner` is up
4. uploads the packaged OSPF fixture through the Web UI using Playwright:
   - `ospf-database-54-unk-test.txt`
5. resolves the created `graph_time`
6. runs `workflow.sh enrich-existing` using:
   - the resolved `graph_time`
   - `ospf-database-54-unk-test.txt`
   - `Load-hosts.csv`
7. runs the Step 10 validation set sequentially
8. writes a combined report to:

```text
10-STEP-BY-STEP/validation-report.txt
```

9. writes screenshots under:

```text
10-STEP-BY-STEP/screenshots/
```

---

## Why Step 10 runs sequentially

Several validations mutate state:

- upload new graphs
- import hostnames
- change filters
- save layouts
- trigger downloads

Running them in parallel risks cross-test contamination. Step 10 intentionally runs them one by one.

---

## Main outputs to review

- `10-STEP-BY-STEP/validation-report.txt`
- `10-STEP-BY-STEP/screenshots/full-e2e/`
- `10-STEP-BY-STEP/screenshots/host-import/`
- `10-STEP-BY-STEP/screenshots/all-views/`
- `10-STEP-BY-STEP/screenshots/features/`
- `10-STEP-BY-STEP/screenshots/layout/`
- `10-STEP-BY-STEP/screenshots/walkthrough/`

---

## Troubleshooting

### If the UI is not responding

Check:

```bash
docker compose ps
curl -I http://localhost:8081/login
```

### If Playwright is not running

Check that the profile service is up:

```bash
docker compose --profile test up -d e2e-runner
```

### If no `graph_time` is resolved

Check the pipeline output directories:

```bash
ls IN-OUT-FOLDER
ls OUTPUT/ENRICHED
```

### If screenshots are missing

Check the target folders:

```bash
ls 10-STEP-BY-STEP/screenshots
```

---

## Scope note

Step 10 is intentionally **UI-focused**:

- downloads are validated at the trigger/download level
- advanced panels are validated by opening and checking meaningful content
- it is not intended to formally prove every numeric result inside every analysis feature
