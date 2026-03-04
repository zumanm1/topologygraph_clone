#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$SCRIPT_DIR/topology-country-tool.sh" && -f "$SCRIPT_DIR/ospf-database.txt" ]]; then
  # Backward compatibility when scripts are still in project root.
  ROOT="$SCRIPT_DIR"
fi

OUT="${OUT:-$ROOT/OUTPUT/CURRENT}"
TOOL="$ROOT/terminal-script/topology-country-tool.sh"
if [[ -f "$ROOT/topology-country-tool.sh" ]]; then
  TOOL="$ROOT/topology-country-tool.sh"
fi
HOST_FILE="${HOST_FILE:-$ROOT/INPUT-FOLDER/host-file.txt}"
OSPF_FILE="${OSPF_FILE:-$ROOT/INPUT-FOLDER/ospf-database.txt}"
COUNTRIES_FILTER="${COUNTRIES_FILTER:-}"
STRICT_COUNTRIES="${STRICT_COUNTRIES:-false}"

echo "[validate] Regenerating outputs..."
if [[ -n "$COUNTRIES_FILTER" ]]; then
  strict_flag=()
  if [[ "$STRICT_COUNTRIES" == "true" ]]; then
    strict_flag+=(--strict-countries)
  fi
  "$TOOL" from-file --host-file "$HOST_FILE" --ospf-file "$OSPF_FILE" --countries "$COUNTRIES_FILTER" "${strict_flag[@]}" --output-dir "$OUT" >/dev/null
else
  "$TOOL" from-file --host-file "$HOST_FILE" --ospf-file "$OSPF_FILE" --output-dir "$OUT" >/dev/null
fi

required_files=(
  "$OUT/country-mapping.csv"
  "$OUT/original-topology-with-country.yaml"
  "$OUT/original-topology-with-country.json"
  "$OUT/gateway-only-topology.yaml"
  "$OUT/gateway-only-topology.json"
  "$OUT/country-core-summary.yaml"
  "$OUT/country-core-summary.json"
)

if [[ -n "$COUNTRIES_FILTER" ]]; then
  required_files+=(
    "$OUT/gateway-only-topology.filtered.yaml"
    "$OUT/gateway-only-topology.filtered.json"
    "$OUT/country-core-summary.filtered.yaml"
    "$OUT/country-core-summary.filtered.json"
  )
fi

echo "[validate] Checking files exist and are non-empty..."
for f in "${required_files[@]}"; do
  [[ -s "$f" ]] || { echo "FAIL: missing or empty $f"; exit 1; }
done

echo "[validate] Validating JSON syntax..."
jq -e . "$OUT/original-topology-with-country.json" >/dev/null
jq -e . "$OUT/gateway-only-topology.json" >/dev/null
jq -e . "$OUT/country-core-summary.json" >/dev/null

echo "[validate] Checking core invariants..."
orig_nodes=$(jq '.nodes|length' "$OUT/original-topology-with-country.json")
orig_edges=$(jq '.edges|length' "$OUT/original-topology-with-country.json")
gw_nodes=$(jq '.nodes|length' "$OUT/gateway-only-topology.json")
gw_edges=$(jq '.edges|length' "$OUT/gateway-only-topology.json")
cc_nodes=$(jq '.nodes|length' "$OUT/country-core-summary.json")
cc_edges=$(jq '.edges|length' "$OUT/country-core-summary.json")

[[ "$orig_nodes" -gt 0 && "$orig_edges" -gt 0 ]] || { echo "FAIL: original topology has no nodes/edges"; exit 1; }
[[ "$gw_nodes" -gt 0 && "$gw_edges" -gt 0 ]] || { echo "FAIL: gateway topology has no nodes/edges"; exit 1; }
[[ "$cc_nodes" -gt 0 && "$cc_edges" -gt 0 ]] || { echo "FAIL: country summary has no nodes/edges"; exit 1; }

# gateway-only must only contain inter-country edges
bad_gw_edges=$(jq '[.edges[] | select(.inter_country!=true)] | length' "$OUT/gateway-only-topology.json")
[[ "$bad_gw_edges" -eq 0 ]] || { echo "FAIL: gateway topology has non inter-country edges"; exit 1; }

# gateway nodes must be marked gateway in original
missing_flag=$(jq -n --argfile o "$OUT/original-topology-with-country.json" --argfile g "$OUT/gateway-only-topology.json" \
  '([ $g.nodes[].name ] - [ $o.nodes[] | select(.is_gateway==true) | .name ]) | length')
[[ "$missing_flag" -eq 0 ]] || { echo "FAIL: gateway nodes not flagged in original topology"; exit 1; }

# country summary metrics must be positive
bad_cc_rows=$(jq '[.edges[] | select((.avg_cost|tonumber) <= 0 or (.min_cost|tonumber) <= 0 or (.link_count|tonumber) <= 0)] | length' "$OUT/country-core-summary.json")
[[ "$bad_cc_rows" -eq 0 ]] || { echo "FAIL: invalid aggregate metrics in country summary"; exit 1; }

echo "[validate] Checking expected country labels presence (warn-only)..."
expected=(ZAF GBR LES MOZ ETH KEN DRC POR DJB TAN EGY)
present=$(jq -r '.nodes[].name' "$OUT/country-core-summary.json" | tr '\n' ' ')
for c in "${expected[@]}"; do
  if jq -e --arg c "$c" '.nodes[] | select(.name==$c)' "$OUT/country-core-summary.json" >/dev/null; then
    :
  else
    echo "WARN: country $c not present in current dataset"
  fi
done

echo "[validate] Summary:"
echo "  original  : nodes=$orig_nodes edges=$orig_edges"
echo "  gateway   : nodes=$gw_nodes edges=$gw_edges"
echo "  countries : nodes=$cc_nodes edges=$cc_edges"
echo "  outputs   : $OUT"

if [[ -n "$COUNTRIES_FILTER" ]]; then
  echo "[validate] Checking filtered topology invariants..."
  fgw_nodes=$(jq '.nodes|length' "$OUT/gateway-only-topology.filtered.json")
  fgw_edges=$(jq '.edges|length' "$OUT/gateway-only-topology.filtered.json")
  fcc_nodes=$(jq '.nodes|length' "$OUT/country-core-summary.filtered.json")
  fcc_edges=$(jq '.edges|length' "$OUT/country-core-summary.filtered.json")
  [[ "$fgw_nodes" -gt 0 && "$fgw_edges" -gt 0 ]] || { echo "FAIL: filtered gateway topology is empty"; exit 1; }
  [[ "$fcc_nodes" -gt 0 && "$fcc_edges" -gt 0 ]] || { echo "FAIL: filtered country summary is empty"; exit 1; }

  bad_eff=$(jq '[.edges[] | select((.effective_avg_cost|tonumber) <= 0 or (.effective_min_cost|tonumber) <= 0)] | length' "$OUT/country-core-summary.filtered.json")
  [[ "$bad_eff" -eq 0 ]] || { echo "FAIL: filtered country summary has non-positive effective costs"; exit 1; }

  echo "  filtered gateway  : nodes=$fgw_nodes edges=$fgw_edges"
  echo "  filtered countries: nodes=$fcc_nodes edges=$fcc_edges"
fi

echo "PASS: terminal app outputs are valid and internally consistent."
