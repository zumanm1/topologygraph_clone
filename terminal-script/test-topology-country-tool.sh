#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$SCRIPT_DIR/topology-country-tool.sh" && -f "$SCRIPT_DIR/ospf-database.txt" ]]; then
  # Backward compatibility when scripts are still in project root.
  ROOT="$SCRIPT_DIR"
fi

TOOL="$ROOT/terminal-script/topology-country-tool.sh"
if [[ -f "$ROOT/topology-country-tool.sh" ]]; then
  TOOL="$ROOT/topology-country-tool.sh"
fi

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; exit 1; }

mk_case_dir() {
  mktemp -d "/tmp/topo-tool-test.XXXXXX"
}

write_ospf_triangle() {
  local f="$1"
  cat > "$f" <<'EOF'
r-a#show ip os database router
  Advertising Router: 1.1.1.1
    Link connected to: another Router (point-to-point)
     (Link ID) Neighboring Router ID: 2.2.2.2
       TOS 0 Metrics: 10
  Advertising Router: 2.2.2.2
    Link connected to: another Router (point-to-point)
     (Link ID) Neighboring Router ID: 1.1.1.1
       TOS 0 Metrics: 10
    Link connected to: another Router (point-to-point)
     (Link ID) Neighboring Router ID: 3.3.3.3
       TOS 0 Metrics: 20
  Advertising Router: 3.3.3.3
    Link connected to: another Router (point-to-point)
     (Link ID) Neighboring Router ID: 2.2.2.2
       TOS 0 Metrics: 20
EOF
}

write_ospf_single_country() {
  local f="$1"
  cat > "$f" <<'EOF'
r-z#show ip os database router
  Advertising Router: 10.0.0.1
    Link connected to: another Router (point-to-point)
     (Link ID) Neighboring Router ID: 10.0.0.2
       TOS 0 Metrics: 5
  Advertising Router: 10.0.0.2
    Link connected to: another Router (point-to-point)
     (Link ID) Neighboring Router ID: 10.0.0.1
       TOS 0 Metrics: 5
EOF
}

test_case_1_real_inputs() {
  local out="$ROOT/OUTPUT/CURRENT"
  "$TOOL" from-file --host-file "$ROOT/INPUT-FOLDER/host-file.txt" --ospf-file "$ROOT/INPUT-FOLDER/ospf-database.txt" --output-dir "$out" >/dev/null
  jq -e '(.nodes|length)>0 and (.edges|length)>0' "$out/original-topology-with-country.json" >/dev/null || fail "real-input original output empty"
  jq -e '[.edges[]|select(.inter_country!=true)]|length==0' "$out/gateway-only-topology.json" >/dev/null || fail "real-input gateway has non inter-country edges"
  pass "case1 real dataset baseline"
}

test_case_2_csv_host_file_support() {
  local d; d="$(mk_case_dir)"
  write_ospf_triangle "$d/ospf.txt"
  cat > "$d/hosts.csv" <<'EOF'
device_ip_address,device_name
1.1.1.1,aaa-a-r1
2.2.2.2,bbb-b-r1
3.3.3.3,ccc-c-r1
EOF
  "$TOOL" from-file --host-file "$d/hosts.csv" --ospf-file "$d/ospf.txt" --output-dir "$d/out" >/dev/null
  jq -e '(.nodes|length)==3 and (.edges|length)==2' "$d/out/original-topology-with-country.json" >/dev/null || fail "csv host support failed"
  pass "case2 csv host-file parsing"
}

test_case_3_filtered_hidden_country_cost() {
  local d; d="$(mk_case_dir)"
  write_ospf_triangle "$d/ospf.txt"
  cat > "$d/hosts.txt" <<'EOF'
1.1.1.1 aaa-a-r1
2.2.2.2 bbb-b-r1
3.3.3.3 ccc-c-r1
EOF
  "$TOOL" from-file --host-file "$d/hosts.txt" --ospf-file "$d/ospf.txt" --countries "AAA,CCC" --output-dir "$d/out" >/dev/null
  jq -e '.nodes|length==2' "$d/out/country-core-summary.filtered.json" >/dev/null || { cat "$d/out/country-mapping.csv"; cat "$d/out/gateway-only-topology.json"; cat "$d/out/country-core-summary.json"; cat "$d/out/country-core-summary.filtered.json"; fail "filtered country node count incorrect"; }
  jq -e '.edges[] | select(.src_country=="AAA" and .dst_country=="CCC" and .effective_avg_cost==30 and .includes_hidden_countries==true)' "$d/out/country-core-summary.filtered.json" >/dev/null || { cat "$d/out/country-mapping.csv"; cat "$d/out/gateway-only-topology.json"; cat "$d/out/country-core-summary.json"; cat "$d/out/country-core-summary.filtered.json"; fail "hidden-country effective cost not preserved"; }
  pass "case3 filtered effective cost through hidden country"
}

test_case_4_single_country_no_gateway() {
  local d; d="$(mk_case_dir)"
  write_ospf_single_country "$d/ospf.txt"
  cat > "$d/hosts.txt" <<'EOF'
10.0.0.1 zaf-a-r1
10.0.0.2 zaf-a-r2
EOF
  "$TOOL" from-file --host-file "$d/hosts.txt" --ospf-file "$d/ospf.txt" --output-dir "$d/out" >/dev/null
  jq -e '.edges|length==0' "$d/out/gateway-only-topology.json" >/dev/null || fail "single-country should have zero gateway edges"
  jq -e '(.nodes|length)==0 and (.edges|length)==0' "$d/out/country-core-summary.json" >/dev/null || fail "single-country summary should be empty"
  pass "case4 single-country robustness"
}

test_case_5_country_override() {
  local d; d="$(mk_case_dir)"
  write_ospf_triangle "$d/ospf.txt"
  cat > "$d/hosts.txt" <<'EOF'
1.1.1.1 fra-a-r1
2.2.2.2 bbb-b-r1
3.3.3.3 ccc-c-r1
EOF
  cat > "$d/override.csv" <<'EOF'
# prefix,country_code
fra,ETH
EOF
  "$TOOL" from-file --host-file "$d/hosts.txt" --ospf-file "$d/ospf.txt" --country-overrides "$d/override.csv" --output-dir "$d/out" >/dev/null
  jq -e '.nodes[] | select(.name=="1.1.1.1" and .country=="ETH")' "$d/out/original-topology-with-country.json" >/dev/null || fail "country override not applied"
  pass "case5 country override mapping"
}

test_case_6_strict_countries_fail() {
  local d; d="$(mk_case_dir)"
  write_ospf_triangle "$d/ospf.txt"
  cat > "$d/hosts.txt" <<'EOF'
1.1.1.1 aaa-a-r1
2.2.2.2 bbb-b-r1
3.3.3.3 ccc-c-r1
EOF
  if "$TOOL" from-file --host-file "$d/hosts.txt" --ospf-file "$d/ospf.txt" --countries "AAA,EGY" --strict-countries --output-dir "$d/out" >/dev/null 2>&1; then
    fail "strict-countries should fail when requested country is missing"
  fi
  pass "case6 strict-countries fails on missing country"
}

test_case_7_strict_countries_pass() {
  local d; d="$(mk_case_dir)"
  write_ospf_triangle "$d/ospf.txt"
  cat > "$d/hosts.txt" <<'EOF'
1.1.1.1 aaa-a-r1
2.2.2.2 bbb-b-r1
3.3.3.3 ccc-c-r1
EOF
  "$TOOL" from-file --host-file "$d/hosts.txt" --ospf-file "$d/ospf.txt" --countries "AAA,BBB,CCC" --strict-countries --output-dir "$d/out" >/dev/null
  jq -e '.filter.selected_countries | length == 3' "$d/out/country-core-summary.filtered.json" >/dev/null || fail "strict-countries pass case did not produce expected filtered output"
  pass "case7 strict-countries passes when all countries exist"
}

test_case_8_hostname_prefix_country_code() {
  local d; d="$(mk_case_dir)"
  write_ospf_triangle "$d/ospf.txt"
  cat > "$d/hosts.txt" <<'EOF'
1.1.1.1 drc-gom-r1
2.2.2.2 zaf-jhb-r1
3.3.3.3 3.3.3.3
EOF
  "$TOOL" from-file --host-file "$d/hosts.txt" --ospf-file "$d/ospf.txt" --output-dir "$d/out" >/dev/null
  jq -e '.nodes[] | select(.name=="1.1.1.1" and .country=="DRC")' "$d/out/original-topology-with-country.json" >/dev/null || fail "hostname prefix before dash did not map to DRC"
  jq -e '.nodes[] | select(.name=="2.2.2.2" and .country=="ZAF")' "$d/out/original-topology-with-country.json" >/dev/null || fail "hostname prefix before dash did not map to ZAF"
  jq -e '.nodes[] | select(.name=="3.3.3.3" and .country=="UNK")' "$d/out/original-topology-with-country.json" >/dev/null || fail "router-id fallback should map to UNK"
  pass "case8 hostname-prefix country derivation"
}

main() {
  [[ -x "$TOOL" ]] || fail "tool not executable: $TOOL"
  test_case_1_real_inputs
  test_case_2_csv_host_file_support
  test_case_3_filtered_hidden_country_cost
  test_case_4_single_country_no_gateway
  test_case_5_country_override
  test_case_6_strict_countries_fail
  test_case_7_strict_countries_pass
  test_case_8_hostname_prefix_country_code
  echo "ALL TESTS PASSED"
}

main "$@"
