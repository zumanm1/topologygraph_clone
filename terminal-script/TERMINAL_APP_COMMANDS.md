# Standalone Gateway/Country Topology Tool

This is a separate terminal app (bash only) and does **not** modify Topolograph internals.

Scripts folder:
- `terminal-script/topology-country-tool.sh`
- `terminal-script/validate-terminal-app-outputs.sh`
- `terminal-script/test-topology-country-tool.sh`

## What it generates

Under `OUTPUT/`:
- `country-mapping.csv`
- `original-topology-with-country.yaml`
- `original-topology-with-country.json`
- `gateway-only-topology.yaml`
- `gateway-only-topology.json`
- `country-core-summary.yaml`
- `country-core-summary.json`

## Manual commands (file mode)

Use your local files (`ospf-database.txt` + `host-file.txt` or `host-file-csv.csv`):

```bash
cd /Users/macbook/Documents/OSPF-DATABASE-TEST
./terminal-script/topology-country-tool.sh from-file \
  --host-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/host-file.txt" \
  --ospf-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/ospf-database.txt" \
  --output-dir "/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/CURRENT"
```

If you want to use CSV host file:

```bash
./terminal-script/topology-country-tool.sh from-file \
  --host-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/host-file-csv.csv" \
  --ospf-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/ospf-database.txt" \
  --output-dir "/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/CURRENT"
```

## Manual commands (extract from Topolograph API first)

If you want to pull edges from app graph time directly:

```bash
cd /Users/macbook/Documents/OSPF-DATABASE-TEST
./terminal-script/topology-country-tool.sh from-api \
  --host-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/host-file.txt" \
  --base-url "http://localhost:8081" \
  --graph-time "26Feb2026_10h22m10s_34_hosts" \
  --user "ospf@topolograph.com" \
  --pass "ospf" \
  --output-dir "/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/CURRENT"
```

Note:
- API edge extraction endpoint is `/api/diagram/{graph_time}/edges` (diagram/YAML graphs).
- For OSPF LSDB graphs, use `from-file` mode with `ospf-database.txt`.

## One-command mode

Uses API if `--graph-time` is provided, otherwise file mode:

```bash
./terminal-script/topology-country-tool.sh all \
  --host-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/host-file.txt" \
  --ospf-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/ospf-database.txt" \
  --output-dir "/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/CURRENT"
```

## Country filter with hidden-country cost inclusion

Generate filtered views where only selected countries are shown, but end-to-end costs are computed over the full graph (including hidden transit countries):

```bash
./terminal-script/topology-country-tool.sh from-file \
  --host-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/host-file.txt" \
  --ospf-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/ospf-database.txt" \
  --countries "ZAF,GBR,LES,MOZ,KEN,DRC,POR,DJB,TAN,ETH,EGY" \
  --strict-countries \
  --output-dir "/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/CURRENT"
```

Additional filtered outputs:
- `OUTPUT/gateway-only-topology.filtered.yaml`
- `OUTPUT/gateway-only-topology.filtered.json`
- `OUTPUT/country-core-summary.filtered.yaml`
- `OUTPUT/country-core-summary.filtered.json`

Key fields in filtered outputs:
- `includes_hidden_countries` (true/false)
- `hidden_transit_countries` (pipe-separated country list)
- `effective_*_cost` (cost including hidden-country transit)
- `direct_*_cost` (direct edge cost if present, else null)

Strict mode:
- Add `--strict-countries` to fail fast when any requested country from `--countries` is missing in current topology.
- Exit code is non-zero (2), useful for CI pipelines.

Validation command:

```bash
cd /Users/macbook/Documents/OSPF-DATABASE-TEST
COUNTRIES_FILTER="ZAF,GBR,LES,MOZ,KEN,DRC,POR,DJB,TAN" ./terminal-script/validate-terminal-app-outputs.sh
```

Regression test suite (real + synthetic topologies):

```bash
cd /Users/macbook/Documents/OSPF-DATABASE-TEST
./terminal-script/test-topology-country-tool.sh
```

## Optional country override mapping

Create a file `country-prefix-overrides.csv`:

```csv
# prefix,country_code
fra,ETH
```

Then run with:

```bash
./terminal-script/topology-country-tool.sh from-file \
  --host-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/host-file.txt" \
  --ospf-file "/Users/macbook/Documents/OSPF-DATABASE-TEST/INPUT-FOLDER/ospf-database.txt" \
  --country-overrides "/Users/macbook/Documents/OSPF-DATABASE-TEST/country-prefix-overrides.csv" \
  --output-dir "/Users/macbook/Documents/OSPF-DATABASE-TEST/OUTPUT/CURRENT"
```

## Behavior summary

- Country code is auto-discovered from hostname prefix (first 3 chars, uppercased).
- Routers with links to different countries are marked `is_gateway=true`.
- `gateway-only-topology.*` hides non-gateway routers.
- `country-core-summary.*` collapses topology to country nodes and aggregates OSPF inter-country costs:
  - `avg_cost`
  - `min_cost`
  - `link_count`

