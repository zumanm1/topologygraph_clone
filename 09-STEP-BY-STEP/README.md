# 09-STEP-BY-STEP
## Hostname-Derived Country Codes

This folder documents and validates the updated country-code behavior for the OSPF Country Topology stack.

The canonical rule is now:

- load a standard host file that maps `router_id -> hostname`
- derive the country from the hostname token before the first `-`
- take the first three letters of that token and uppercase them
- if the hostname is missing or IP-like, classify the node as `UNK`
- do **not** rely on a static country column for automatic classification

Examples:

- `ken-mob-r2` -> `KEN`
- `zaf-mtz-r1` -> `ZAF`
- `drc-gom-r1` -> `DRC`
- `19.19.19.1` -> `UNK`

---

## Why 09 Exists

`06-STEP-BY-STEP` validates the deep UI surface.

`07-STEP-BY-STEP` validates a full pipeline run with new files.

`08-STEP-BY-STEP` is the canonical Docker-native rebuild + retest.

`09-STEP-BY-STEP` isolates the country-code question itself:

- does the terminal pipeline derive country from the host file hostname?
- does the browser host-file upload derive country the same way?
- does an IP-like hostname stay `UNK`?
- if a 3-column file contains a conflicting static country, does hostname-derived classification still win?

---

## Validation Command

```bash
bash 09-STEP-BY-STEP/scripts/run-country-derivation-validation.sh
```

That runner performs two checks:

1. terminal regression:
   - `bash terminal-script/test-topology-country-tool.sh`
2. browser regression:
   - `tests/validate-country-derivation.cjs`

The browser regression captures screenshots into:

```text
09-STEP-BY-STEP/screenshots/
```

Expected screenshot files:

- `01-standard-host-file-derived-countries.png`
- `02-conflicting-country-column-ignored.png`

---

## Fixtures Used

The runner uses the repository fixtures in `INPUT-FOLDER/`:

- `Load-hosts.csv`
- `Load-hosts-3b.txt`
- `Load-hosts.txt`

The browser regression prefers those standard host files over the legacy enriched fixture.

---

## Relationship To 08

`08-STEP-BY-STEP/scripts/run-all-docker-validation.sh` now includes the dedicated country-derivation regression as part of the canonical Docker-native validation flow.

So:

- use `09` when you want the focused country-code proof
- use `08` when you want the full canonical retest
