#!/usr/bin/env bash
set -euo pipefail

# Standalone terminal app (bash + awk + jq)
# Builds:
# 1) Original topology enriched with country + gateway flags
# 2) Gateway-only topology (routers with inter-country links only)
# 3) Country-core summary (countries collapsed, OSPF cost aggregated)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -d "$SCRIPT_DIR/OUTPUT" && -f "$SCRIPT_DIR/ospf-database.txt" ]]; then
  # Backward compatibility if script is still in project root.
  PROJECT_ROOT="$SCRIPT_DIR"
fi

OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/OUTPUT/CURRENT}"
TMP_DIR="$OUTPUT_DIR/.tmp"
mkdir -p "$OUTPUT_DIR" "$TMP_DIR"

# Host file: prefer Load-hosts.txt (canonical), fall back to host-file.txt
if [[ -f "$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt" ]]; then
  HOST_FILE="${HOST_FILE:-$PROJECT_ROOT/INPUT-FOLDER/Load-hosts.txt}"
else
  HOST_FILE="${HOST_FILE:-$PROJECT_ROOT/INPUT-FOLDER/host-file.txt}"
fi
# OSPF file: prefer ospf-database-3.txt (54 routers, current default),
#            fall back to ospf-database-2.txt (34 routers), then ospf-database.txt
if [[ -f "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3.txt" ]]; then
  OSPF_FILE="${OSPF_FILE:-$PROJECT_ROOT/INPUT-FOLDER/ospf-database-3.txt}"
elif [[ -f "$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt" ]]; then
  OSPF_FILE="${OSPF_FILE:-$PROJECT_ROOT/INPUT-FOLDER/ospf-database-2.txt}"
else
  OSPF_FILE="${OSPF_FILE:-$PROJECT_ROOT/INPUT-FOLDER/ospf-database.txt}"
fi
COUNTRY_OVERRIDE_FILE="${COUNTRY_OVERRIDE_FILE:-$PROJECT_ROOT/country-prefix-overrides.csv}"

BASE_URL="${BASE_URL:-http://localhost:8081}"
GRAPH_TIME="${GRAPH_TIME:-}"
AUTH_USER="${AUTH_USER:-ospf@topolograph.com}"
AUTH_PASS="${AUTH_PASS:-ospf}"
COUNTRIES_FILTER="${COUNTRIES_FILTER:-}"
STRICT_COUNTRIES="${STRICT_COUNTRIES:-false}"

usage() {
  cat <<'EOF'
Usage:
  ./topology-country-tool.sh all [options]
  ./topology-country-tool.sh from-file [options]
  ./topology-country-tool.sh from-api [options]
  ./topology-country-tool.sh help

Options:
  --host-file <path>          host mapping (txt or csv)
  --ospf-file <path>          OSPF DB text file (used by from-file/all fallback)
  --output-dir <path>         output folder (default: ./OUTPUT)
  --country-overrides <path>  optional CSV: prefix,country_code (e.g. fra,ETH)
  --countries <list>          optional country filter, comma-separated (e.g. ZAF,GBR,LES)
  --strict-countries          fail if any requested country is missing in topology

  --base-url <url>            Topolograph base URL for API mode
  --graph-time <value>        graph_time to pull edges from API mode
  --user <username>           API username
  --pass <password>           API password

Outputs:
  OUTPUT/country-mapping.csv
  OUTPUT/original-topology-with-country.yaml
  OUTPUT/original-topology-with-country.json
  OUTPUT/gateway-only-topology.yaml
  OUTPUT/gateway-only-topology.json
  OUTPUT/country-core-summary.yaml
  OUTPUT/country-core-summary.json
  OUTPUT/gateway-only-topology.filtered.yaml/.json (when --countries is set)
  OUTPUT/country-core-summary.filtered.yaml/.json (when --countries is set)
EOF
}

log() { echo "[topology-tool] $*"; }

parse_args() {
  CMD="${1:-help}"
  shift || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host-file) HOST_FILE="$2"; shift 2 ;;
      --ospf-file) OSPF_FILE="$2"; shift 2 ;;
      --output-dir) OUTPUT_DIR="$2"; TMP_DIR="$OUTPUT_DIR/.tmp"; mkdir -p "$OUTPUT_DIR" "$TMP_DIR"; shift 2 ;;
      --country-overrides) COUNTRY_OVERRIDE_FILE="$2"; shift 2 ;;
      --countries) COUNTRIES_FILTER="$2"; shift 2 ;;
      --strict-countries) STRICT_COUNTRIES="true"; shift 1 ;;
      --base-url) BASE_URL="$2"; shift 2 ;;
      --graph-time) GRAPH_TIME="$2"; shift 2 ;;
      --user) AUTH_USER="$2"; shift 2 ;;
      --pass) AUTH_PASS="$2"; shift 2 ;;
      *) echo "Unknown argument: $1"; usage; exit 1 ;;
    esac
  done
}

prepare_country_filter() {
  local out="$TMP_DIR/selected_countries.txt"
  : > "$out"
  if [[ -z "$COUNTRIES_FILTER" ]]; then
    return 0
  fi
  echo "$COUNTRIES_FILTER" | tr ',' '\n' | awk '
    {
      gsub(/^[ \t]+|[ \t]+$/, "", $0)
      c=toupper($0)
      if(c!="") print c
    }
  ' | sort -u > "$out"
}

validate_strict_countries() {
  [[ "${STRICT_COUNTRIES}" == "true" ]] || return 0
  local selected="$TMP_DIR/selected_countries.txt"
  local present="$TMP_DIR/present_countries.txt"
  local missing="$TMP_DIR/missing_countries.txt"

  if [[ ! -s "$selected" ]]; then
    echo "ERROR: --strict-countries requires --countries <list>"
    exit 2
  fi

  awk -F, '{print $3}' "$TMP_DIR/nodes.csv" | sort -u > "$present"
  comm -23 "$selected" "$present" > "$missing" || true
  if [[ -s "$missing" ]]; then
    echo "ERROR: strict country check failed. Missing requested countries:"
    sed 's/^/  - /' "$missing"
    echo "Hint: disable --strict-countries or adjust --countries / host mapping."
    exit 2
  fi
}

prepare_host_map() {
  local out="$TMP_DIR/host_map.csv"
  [[ -f "$HOST_FILE" ]] || { echo "Host file not found: $HOST_FILE"; exit 1; }

  python3 - "$PROJECT_ROOT" "$HOST_FILE" "$out" <<'PYEOF'
import csv
import os
import sys

project_root, host_file, out_path = sys.argv[1:]
sys.path.insert(0, os.path.join(project_root, "terminal-script"))
from country_code_utils import parse_host_file

host_map = parse_host_file(host_file)

def sort_key(value: str):
    try:
        return [int(part) for part in value.split('.')]
    except ValueError:
        return [value]

with open(out_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, lineterminator="\n")
    for rid in sorted(host_map, key=sort_key):
        writer.writerow([rid, host_map[rid]])
PYEOF
}

extract_edges_from_ospf_file() {
  [[ -f "$OSPF_FILE" ]] || { echo "OSPF file not found: $OSPF_FILE"; exit 1; }
  local raw="$TMP_DIR/edges_raw.csv"
  local dedup="$TMP_DIR/edges.csv"

  awk '
    function trim(s){sub(/^[ \t]+/,"",s); sub(/[ \t]+$/,"",s); return s}
    BEGIN{adv=""; p2p=0; nbr=""; metric=""}
    /Advertising Router:/ {
      split($0,a,":"); adv=trim(a[2]); next
    }
    /Link connected to: another Router \(point-to-point\)/ {p2p=1; nbr=""; metric=""; next}
    p2p && /Neighboring Router ID:/ {
      split($0,a,":"); nbr=trim(a[2]); next
    }
    p2p && /TOS 0 Metrics?:/ {
      split($0,a,":"); metric=trim(a[2])
      if(adv!="" && nbr!="" && metric!=""){print adv "," nbr "," metric}
      p2p=0; nbr=""; metric=""
      next
    }
  ' "$OSPF_FILE" > "$raw"

  # Deduplicate undirected edges; keep minimum metric if duplicates exist.
  awk -F, '
    function ipkey(ip, a){split(ip,a,"."); return sprintf("%03d%03d%03d%03d",a[1],a[2],a[3],a[4])}
    {
      a=$1; b=$2; m=$3+0
      if(ipkey(a) <= ipkey(b)){src=a; dst=b} else {src=b; dst=a}
      k=src "," dst
      if(!(k in cost) || m<cost[k]) cost[k]=m
    }
    END{
      for(k in cost) print k "," cost[k]
    }
  ' "$raw" | sort -t, -k1,1V -k2,2V > "$dedup"
}

extract_edges_from_api() {
  [[ -n "$GRAPH_TIME" ]] || { echo "GRAPH_TIME is required for from-api"; return 1; }
  local api_out="$TMP_DIR/edges_api.json"
  local dedup="$TMP_DIR/edges.csv"
  local found=0

  # Try known endpoint shape from docs.
  if curl -sf -u "$AUTH_USER:$AUTH_PASS" "$BASE_URL/api/diagram/$GRAPH_TIME/edges" > "$api_out"; then
    found=1
  fi

  if [[ $found -ne 1 ]]; then
    echo "Could not fetch edges from API endpoint: $BASE_URL/api/diagram/$GRAPH_TIME/edges"
    echo "Use from-file mode or verify graph_time/credentials."
    return 1
  fi

  jq -r '
    if type=="array" then .[] else empty end
    | [.src // .source // .from, .dst // .target // .to, (.cost // .link_cost // 1)]
    | @csv
  ' "$api_out" | sed 's/"//g' | awk -F, 'NF>=3{print $1 "," $2 "," $3}' > "$TMP_DIR/edges_raw.csv"

  awk -F, '
    function ipkey(ip, a){split(ip,a,"."); return sprintf("%03d%03d%03d%03d",a[1],a[2],a[3],a[4])}
    {
      a=$1; b=$2; m=$3+0
      if(ipkey(a) <= ipkey(b)){src=a; dst=b} else {src=b; dst=a}
      k=src "," dst
      if(!(k in cost) || m<cost[k]) cost[k]=m
    }
    END{for(k in cost) print k "," cost[k]}
  ' "$TMP_DIR/edges_raw.csv" | sort -t, -k1,1V -k2,2V > "$dedup"
}

build_enriched_model() {
  local host_map="$TMP_DIR/host_map.csv"
  local edges="$TMP_DIR/edges.csv"
  local nodes="$TMP_DIR/nodes.csv"
  local edges_enriched="$TMP_DIR/edges_enriched.csv"

  [[ -f "$host_map" ]] || { echo "missing host map"; exit 1; }
  [[ -f "$edges" ]] || { echo "missing edges"; exit 1; }

  python3 - "$PROJECT_ROOT" "$host_map" "$edges" "$COUNTRY_OVERRIDE_FILE" "$nodes" "$edges_enriched" <<'PYEOF'
import csv
import os
import sys

project_root, host_map_csv, edges_csv, override_file, nodes_path, edges_enriched_path = sys.argv[1:]
sys.path.insert(0, os.path.join(project_root, "terminal-script"))
from country_code_utils import build_enriched_rows, load_overrides

host_map = {}
with open(host_map_csv, newline="", encoding="utf-8") as f:
    for row in csv.reader(f):
        if len(row) >= 2:
            host_map[row[0].strip()] = row[1].strip()

edges = []
with open(edges_csv, newline="", encoding="utf-8") as f:
    for row in csv.reader(f):
        if len(row) >= 3:
            cost_raw = row[2].strip()
            cost = int(float(cost_raw)) if cost_raw else 0
            edges.append((row[0].strip(), row[1].strip(), cost))

overrides = load_overrides(override_file)
node_rows, edge_rows = build_enriched_rows(host_map, edges, overrides)

with open(nodes_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, lineterminator="\n")
    writer.writerows(node_rows)

with open(edges_enriched_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, lineterminator="\n")
    writer.writerows(edge_rows)
PYEOF
}

write_country_mapping() {
  local out="$OUTPUT_DIR/country-mapping.csv"
  echo "router_id,hostname,country_code,is_gateway" > "$out"
  cat "$TMP_DIR/nodes.csv" >> "$out"
}

write_original_outputs() {
  local yaml="$OUTPUT_DIR/original-topology-with-country.yaml"
  local json="$OUTPUT_DIR/original-topology-with-country.json"
  local nodes="$TMP_DIR/nodes.csv"
  local edges="$TMP_DIR/edges_enriched.csv"

  {
    echo "nodes:"
    awk -F, '{
      printf "  - name: %s\n", $1
      printf "    label: %s\n", $2
      printf "    country: %s\n", $3
      printf "    is_gateway: %s\n", $4
    }' "$nodes"
    echo "edges:"
    awk -F, '{
      printf "  - src: %s\n", $1
      printf "    dst: %s\n", $2
      printf "    cost: %s\n", $3
      printf "    src_country: %s\n", $4
      printf "    dst_country: %s\n", $5
      printf "    inter_country: %s\n", $6
    }' "$edges"
  } > "$yaml"

  jq -n \
    --slurpfile nodes <(awk -F, '{printf "{\"name\":\"%s\",\"label\":\"%s\",\"country\":\"%s\",\"is_gateway\":%s}\n",$1,$2,$3,$4}' "$nodes" | jq -s '.') \
    --slurpfile edges <(awk -F, '{printf "{\"src\":\"%s\",\"dst\":\"%s\",\"cost\":%s,\"src_country\":\"%s\",\"dst_country\":\"%s\",\"inter_country\":%s}\n",$1,$2,$3,$4,$5,$6}' "$edges" | jq -s '.') \
    '{nodes:$nodes[0], edges:$edges[0]}' > "$json"
}

write_gateway_only_outputs() {
  local gateway_edges="$TMP_DIR/gateway_edges.csv"
  local gateway_nodes="$TMP_DIR/gateway_nodes.csv"
  local yaml="$OUTPUT_DIR/gateway-only-topology.yaml"
  local json="$OUTPUT_DIR/gateway-only-topology.json"

  awk -F, '$6=="true"{print $0}' "$TMP_DIR/edges_enriched.csv" > "$gateway_edges"
  : > "$gateway_nodes"

  awk -F, '
    FNR==NR { n[$1]=$0; next }
    { keep[$1]=1; keep[$2]=1 }
    END{
      for(k in keep) if(k in n) print n[k]
    }
  ' "$TMP_DIR/nodes.csv" "$gateway_edges" | sort -t, -k1,1V > "$gateway_nodes"

  {
    echo "nodes:"
    awk -F, '{
      printf "  - name: %s\n", $1
      printf "    label: %s\n", $2
      printf "    country: %s\n", $3
      printf "    is_gateway: true\n"
    }' "$gateway_nodes"
    echo "edges:"
    awk -F, '{
      printf "  - src: %s\n", $1
      printf "    dst: %s\n", $2
      printf "    cost: %s\n", $3
      printf "    src_country: %s\n", $4
      printf "    dst_country: %s\n", $5
      printf "    inter_country: true\n"
    }' "$gateway_edges"
  } > "$yaml"

  jq -n \
    --slurpfile nodes <(awk -F, '{printf "{\"name\":\"%s\",\"label\":\"%s\",\"country\":\"%s\",\"is_gateway\":true}\n",$1,$2,$3}' "$gateway_nodes" | jq -s '.') \
    --slurpfile edges <(awk -F, '{printf "{\"src\":\"%s\",\"dst\":\"%s\",\"cost\":%s,\"src_country\":\"%s\",\"dst_country\":\"%s\",\"inter_country\":true}\n",$1,$2,$3,$4,$5}' "$gateway_edges" | jq -s '.') \
    '{nodes:$nodes[0], edges:$edges[0]}' > "$json"
}

write_country_core_summary_outputs() {
  local pairs="$TMP_DIR/country_pairs.csv"
  local countries="$TMP_DIR/countries.csv"
  local yaml="$OUTPUT_DIR/country-core-summary.yaml"
  local json="$OUTPUT_DIR/country-core-summary.json"

  : > "$pairs"
  : > "$countries"

  awk -F, '
    function pair(a,b){ return (a<b)? a "," b : b "," a }
    {
      ca=$4; cb=$5; c=$3+0
      k=pair(ca,cb)
      cnt[k]++; sum[k]+=c
      if(!(k in mn) || c<mn[k]) mn[k]=c
      cc[ca]=1; cc[cb]=1
    }
    END{
      for(k in cnt){
        split(k,p,",")
        avg=sum[k]/cnt[k]
        printf "%s,%s,%.2f,%d,%d\n", p[1], p[2], avg, mn[k], cnt[k]
      }
      for(c in cc) print c > "'"$countries"'"
    }
  ' "$TMP_DIR/gateway_edges.csv" | sort -t, -k1,1 -k2,2 > "$pairs"
  sort -u "$countries" -o "$countries"

  {
    echo "nodes:"
    awk '{printf "  - name: %s\n    label: %s\n", $1, $1}' "$countries"
    echo "edges:"
    awk -F, '{
      printf "  - src_country: %s\n", $1
      printf "    dst_country: %s\n", $2
      printf "    avg_cost: %s\n", $3
      printf "    min_cost: %s\n", $4
      printf "    link_count: %s\n", $5
    }' "$pairs"
  } > "$yaml"

  jq -n \
    --slurpfile nodes <(awk '{printf "{\"name\":\"%s\",\"label\":\"%s\"}\n",$1,$1}' "$countries" | jq -s '.') \
    --slurpfile edges <(awk -F, '{printf "{\"src_country\":\"%s\",\"dst_country\":\"%s\",\"avg_cost\":%s,\"min_cost\":%s,\"link_count\":%s}\n",$1,$2,$3,$4,$5}' "$pairs" | jq -s '.') \
    '{nodes:$nodes[0], edges:$edges[0]}' > "$json"
}

write_filtered_gateway_outputs() {
  local cf="$TMP_DIR/selected_countries.txt"
  [[ -s "$cf" ]] || return 0

  local n_in="$TMP_DIR/gateway_nodes.csv"
  local e_in="$TMP_DIR/gateway_edges.csv"
  local n_out="$TMP_DIR/gateway_filtered_nodes.csv"
  local e_out="$TMP_DIR/gateway_filtered_edges.csv"
  local yaml="$OUTPUT_DIR/gateway-only-topology.filtered.yaml"
  local json="$OUTPUT_DIR/gateway-only-topology.filtered.json"

  : > "$n_out"
  : > "$e_out"

  awk -F, -v CF="$cf" '
    function min(a,b){return (a<b)?a:b}
    BEGIN{
      OFS=","
      INF=1e12
      while((getline < CF)>0){sel[$1]=1}
    }
    FNR==NR{
      rid=$1; lbl=$2; c=$3
      all[++n]=rid
      lblm[rid]=lbl
      cm[rid]=c
      if(c in sel){vis[rid]=1; print rid,lbl,c,"true" > "'"$n_out"'"}
      next
    }
    {
      a=$1; b=$2; w=$3+0
      em[a SUBSEP b]=w; em[b SUBSEP a]=w
      if(!(a in id)){id[a]=++k; name[k]=a}
      if(!(b in id)){id[b]=++k; name[k]=b}
      i=id[a]; j=id[b]
      if(!(i SUBSEP j in d) || w<d[i SUBSEP j]){d[i SUBSEP j]=w; d[j SUBSEP i]=w; nx[i SUBSEP j]=j; nx[j SUBSEP i]=i}
    }
    END{
      for(i=1;i<=k;i++){
        for(j=1;j<=k;j++){
          if(i==j){d[i SUBSEP j]=0; nx[i SUBSEP j]=j}
          else if(!(i SUBSEP j in d)){d[i SUBSEP j]=INF}
        }
      }
      for(m=1;m<=k;m++)
        for(i=1;i<=k;i++)
          for(j=1;j<=k;j++)
            if(d[i SUBSEP m]+d[m SUBSEP j] < d[i SUBSEP j]){
              d[i SUBSEP j]=d[i SUBSEP m]+d[m SUBSEP j]
              nx[i SUBSEP j]=nx[i SUBSEP m]
            }

      for(i=1;i<=k;i++){
        for(j=i+1;j<=k;j++){
          a=name[i]; b=name[j]
          if(!(a in vis) || !(b in vis)) continue
          if(cm[a]==cm[b]) continue
          if(d[i SUBSEP j] >= INF) continue
          direct=((a SUBSEP b in em)? em[a SUBSEP b] : ((b SUBSEP a in em)? em[b SUBSEP a] : "null"))
          # path reconstruction
          u=i; path=a; transit=0; hidden=""
          delete seenh
          while(u!=j){
            nu=nx[u SUBSEP j]
            if(nu==0) break
            rn=name[nu]
            path=path ">" rn
            if(nu!=j && nu!=i){
              transit++
              cc=cm[rn]
              if(!(cc in sel) && !(cc in seenh)){
                hidden = (hidden=="" ? cc : hidden "|" cc)
                seenh[cc]=1
              }
            }
            u=nu
          }
          incl=(hidden==""?"false":"true")
          print a,b,d[i SUBSEP j],direct,cm[a],cm[b],path,hidden,incl,transit > "'"$e_out"'"
        }
      }
    }
  ' "$n_in" "$e_in"

  {
    echo "nodes:"
    awk -F, '{
      printf "  - name: %s\n", $1
      printf "    label: %s\n", $2
      printf "    country: %s\n", $3
      printf "    is_gateway: true\n"
    }' "$n_out"
    echo "edges:"
    awk -F, '{
      printf "  - src: %s\n", $1
      printf "    dst: %s\n", $2
      printf "    effective_cost: %.2f\n", $3
      printf "    direct_cost: %s\n", $4
      printf "    src_country: %s\n", $5
      printf "    dst_country: %s\n", $6
      printf "    path_router_ids: \"%s\"\n", $7
      printf "    hidden_transit_countries: \"%s\"\n", $8
      printf "    includes_hidden_countries: %s\n", $9
      printf "    transit_router_count: %s\n", $10
    }' "$e_out"
  } > "$yaml"

  jq -n \
    --slurpfile nodes <(awk -F, '{printf "{\"name\":\"%s\",\"label\":\"%s\",\"country\":\"%s\",\"is_gateway\":true}\n",$1,$2,$3}' "$n_out" | jq -s '.') \
    --slurpfile edges <(awk -F, '{printf "{\"src\":\"%s\",\"dst\":\"%s\",\"effective_cost\":%s,\"direct_cost\":%s,\"src_country\":\"%s\",\"dst_country\":\"%s\",\"path_router_ids\":\"%s\",\"hidden_transit_countries\":\"%s\",\"includes_hidden_countries\":%s,\"transit_router_count\":%s}\n",$1,$2,$3,($4=="null"?"null":$4),$5,$6,$7,$8,$9,$10}' "$e_out" | jq -s '.') \
    --slurpfile selected <(awk '{printf "{\"country\":\"%s\"}\n",$1}' "$cf" | jq -s '.') \
    '{filter:{selected_countries:$selected[0]}, nodes:$nodes[0], edges:$edges[0]}' > "$json"
}

write_filtered_country_summary_outputs() {
  local cf="$TMP_DIR/selected_countries.txt"
  [[ -s "$cf" ]] || return 0

  local p_in="$TMP_DIR/country_pairs.csv"
  local n_in="$TMP_DIR/countries.csv"
  local n_out="$TMP_DIR/country_filtered_nodes.csv"
  local e_out="$TMP_DIR/country_filtered_edges.csv"
  local yaml="$OUTPUT_DIR/country-core-summary.filtered.yaml"
  local json="$OUTPUT_DIR/country-core-summary.filtered.json"

  : > "$n_out"
  : > "$e_out"
  awk 'NR==FNR{sel[$1]=1; next} ($1 in sel){print $1}' "$cf" "$n_in" > "$n_out"

  awk -F, -v CF="$cf" '
    BEGIN{
      INF=1e12; OFS=","
      while((getline < CF)>0){sel[$1]=1}
    }
    {
      a=$1; b=$2; wA=$3+0; wM=$4+0; lc=$5+0
      if(!(a in id)){id[a]=++n; nm[n]=a}
      if(!(b in id)){id[b]=++n; nm[n]=b}
      i=id[a]; j=id[b]
      dA[i SUBSEP j]=dA[j SUBSEP i]=wA
      dM[i SUBSEP j]=dM[j SUBSEP i]=wM
      nx[i SUBSEP j]=j; nx[j SUBSEP i]=i
      directA[a SUBSEP b]=wA; directA[b SUBSEP a]=wA
      directM[a SUBSEP b]=wM; directM[b SUBSEP a]=wM
      links[a SUBSEP b]=lc; links[b SUBSEP a]=lc
    }
    END{
      for(i=1;i<=n;i++){
        for(j=1;j<=n;j++){
          if(i==j){dA[i SUBSEP j]=0; dM[i SUBSEP j]=0; nx[i SUBSEP j]=j}
          else{
            if(!(i SUBSEP j in dA)) dA[i SUBSEP j]=INF
            if(!(i SUBSEP j in dM)) dM[i SUBSEP j]=INF
          }
        }
      }
      for(k=1;k<=n;k++)
        for(i=1;i<=n;i++)
          for(j=1;j<=n;j++){
            if(dA[i SUBSEP k]+dA[k SUBSEP j] < dA[i SUBSEP j]){
              dA[i SUBSEP j]=dA[i SUBSEP k]+dA[k SUBSEP j]
              nx[i SUBSEP j]=nx[i SUBSEP k]
            }
            if(dM[i SUBSEP k]+dM[k SUBSEP j] < dM[i SUBSEP j]){
              dM[i SUBSEP j]=dM[i SUBSEP k]+dM[k SUBSEP j]
            }
          }

      for(i=1;i<=n;i++) for(j=i+1;j<=n;j++){
        a=nm[i]; b=nm[j]
        if(!(a in sel) || !(b in sel)) continue
        if(dA[i SUBSEP j] >= INF) continue
        direct_avg=((a SUBSEP b in directA)? directA[a SUBSEP b] : "null")
        direct_min=((a SUBSEP b in directM)? directM[a SUBSEP b] : "null")
        dlinks=((a SUBSEP b in links)? links[a SUBSEP b] : 0)

        u=i; path=a; hidden=""
        delete seenh
        while(u!=j){
          nu=nx[u SUBSEP j]
          if(nu==0) break
          c=nm[nu]
          path=path ">" c
          if(nu!=i && nu!=j && !(c in sel) && !(c in seenh)){
            hidden=(hidden==""? c : hidden "|" c)
            seenh[c]=1
          }
          u=nu
        }
        incl=(hidden==""?"false":"true")
        print a,b,dA[i SUBSEP j],dM[i SUBSEP j],direct_avg,direct_min,dlinks,path,hidden,incl > "'"$e_out"'"
      }
    }
  ' "$p_in"

  {
    echo "nodes:"
    awk '{printf "  - name: %s\n    label: %s\n", $1, $1}' "$n_out"
    echo "edges:"
    awk -F, '{
      printf "  - src_country: %s\n", $1
      printf "    dst_country: %s\n", $2
      printf "    effective_avg_cost: %.2f\n", $3
      printf "    effective_min_cost: %.2f\n", $4
      printf "    direct_avg_cost: %s\n", $5
      printf "    direct_min_cost: %s\n", $6
      printf "    direct_link_count: %s\n", $7
      printf "    path_countries: \"%s\"\n", $8
      printf "    hidden_transit_countries: \"%s\"\n", $9
      printf "    includes_hidden_countries: %s\n", $10
    }' "$e_out"
  } > "$yaml"

  jq -n \
    --slurpfile nodes <(awk '{printf "{\"name\":\"%s\",\"label\":\"%s\"}\n",$1,$1}' "$n_out" | jq -s '.') \
    --slurpfile edges <(awk -F, '{printf "{\"src_country\":\"%s\",\"dst_country\":\"%s\",\"effective_avg_cost\":%s,\"effective_min_cost\":%s,\"direct_avg_cost\":%s,\"direct_min_cost\":%s,\"direct_link_count\":%s,\"path_countries\":\"%s\",\"hidden_transit_countries\":\"%s\",\"includes_hidden_countries\":%s}\n",$1,$2,$3,$4,($5=="null"?"null":$5),($6=="null"?"null":$6),$7,$8,$9,$10}' "$e_out" | jq -s '.') \
    --slurpfile selected <(awk '{printf "{\"country\":\"%s\"}\n",$1}' "$cf" | jq -s '.') \
    '{filter:{selected_countries:$selected[0]}, nodes:$nodes[0], edges:$edges[0]}' > "$json"
}

run_pipeline() {
  prepare_country_filter
  prepare_host_map
  build_enriched_model
  validate_strict_countries
  write_country_mapping
  write_original_outputs
  write_gateway_only_outputs
  write_country_core_summary_outputs
  write_filtered_gateway_outputs
  write_filtered_country_summary_outputs

  log "Done. Files written to: $OUTPUT_DIR"
  ls -1 "$OUTPUT_DIR" | sed 's/^/  - /'
}

main() {
  parse_args "$@"
  case "$CMD" in
    help|-h|--help) usage ;;
    from-file)
      extract_edges_from_ospf_file
      run_pipeline
      ;;
    from-api)
      extract_edges_from_api
      run_pipeline
      ;;
    all)
      if [[ -n "$GRAPH_TIME" ]]; then
        extract_edges_from_api || extract_edges_from_ospf_file
      else
        extract_edges_from_ospf_file
      fi
      run_pipeline
      ;;
    *)
      echo "Unknown command: $CMD"
      usage
      exit 1
      ;;
  esac
}

main "$@"
