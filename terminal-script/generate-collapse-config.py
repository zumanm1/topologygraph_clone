#!/usr/bin/env python3
"""
generate-collapse-config.py
───────────────────────────────────────────────────────────────────────────────
COLLAPSING Pipeline Stage — generates the 4th output stage artefacts.

PURPOSE
  Reads the ENRICHED country-mapping.csv plus the AS-IS nodes/edges JSON and
  produces the COLLAPSING output folder:

    COLLAPSING_country-collapse-config.json   ← per-country gateway/core split
    COLLAPSING_collapsed-topology.json        ← gateway-only topology
    COLLAPSING_collapsed-topology.yaml        ← same, YAML format

SCHOLAR'S NOTE
  This implements the "information hiding" principle from software engineering
  (Parnas 1972) applied to network topology: expose only the inter-domain
  (gateway) structure at the country level, collapsing intra-domain detail.
  The collapsed topology mirrors BGP's AS-level view of OSPF internals.

USAGE
  python3 generate-collapse-config.py \\
      --enriched-dir OUTPUT/ENRICHED/<graph_time>_ENRICHED \\
      --asis-dir     OUTPUT/AS-IS/<graph_time>_AS-IS \\
      --output-dir   OUTPUT/COLLAPSING/<graph_time>_COLLAPSING \\
      --graph-time   <graph_time>

  All --*-dir arguments accept the full path to the respective stage folder.
───────────────────────────────────────────────────────────────────────────────
"""
import argparse
import csv
import json
import os
import sys
from collections import defaultdict

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


# ── CLI ───────────────────────────────────────────────────────────────────────
def parse_args():
    p = argparse.ArgumentParser(description='Generate COLLAPSING stage outputs')
    p.add_argument('--enriched-dir', required=True,
                   help='Path to <graph_time>_ENRICHED folder')
    p.add_argument('--asis-dir',     required=True,
                   help='Path to <graph_time>_AS-IS folder')
    p.add_argument('--output-dir',   required=True,
                   help='Path to <graph_time>_COLLAPSING folder (will be created)')
    p.add_argument('--graph-time',   required=True,
                   help='graph_time identifier string')
    return p.parse_args()


# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg):
    print(f'[collapse-config] {msg}')


def read_json(path):
    with open(path) as f:
        return json.load(f)


def write_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    log(f'Wrote {os.path.basename(path)}')


def write_yaml(path, data):
    if not HAS_YAML:
        log('WARNING: PyYAML not installed — skipping YAML output')
        return
    with open(path, 'w') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
    log(f'Wrote {os.path.basename(path)}')


# ── Country mapping loader ────────────────────────────────────────────────────
def load_country_mapping(enriched_dir):
    """
    Returns dict: { router_id: {hostname, country_code, is_gateway} }
    Reads ENRICHED_country-mapping.csv from the enriched dir.
    """
    csv_path = os.path.join(enriched_dir, 'ENRICHED_country-mapping.csv')
    if not os.path.exists(csv_path):
        # fallback: plain country-mapping.csv (older runs)
        csv_path = os.path.join(enriched_dir, 'country-mapping.csv')
    if not os.path.exists(csv_path):
        log(f'ERROR: country-mapping.csv not found in {enriched_dir}')
        sys.exit(1)

    mapping = {}
    with open(csv_path, newline='') as f:
        for row in csv.DictReader(f):
            rid = row['router_id'].strip()
            mapping[rid] = {
                'hostname':     row.get('hostname', rid).strip(),
                'country_code': row.get('country_code', 'UNK').strip().upper(),
                'is_gateway':   row.get('is_gateway', 'false').strip().lower() == 'true',
            }
    log(f'Loaded {len(mapping)} router entries from country-mapping.csv')
    return mapping


# ── AS-IS nodes/edges loaders ─────────────────────────────────────────────────
def load_asis_nodes(asis_dir):
    """Returns list of vis.js node dicts from AS-IS_nodes.json."""
    for fname in ('AS-IS_nodes.json', 'nodes.json'):
        p = os.path.join(asis_dir, fname)
        if os.path.exists(p):
            data = read_json(p)
            log(f'Loaded {len(data)} nodes from {fname}')
            return data
    log(f'ERROR: nodes.json not found in {asis_dir}')
    sys.exit(1)


def load_asis_edges(asis_dir):
    """Returns list of vis.js edge dicts from AS-IS_edges.json."""
    for fname in ('AS-IS_edges.json', 'edges.json'):
        p = os.path.join(asis_dir, fname)
        if os.path.exists(p):
            data = read_json(p)
            log(f'Loaded {len(data)} edges from {fname}')
            return data
    log(f'ERROR: edges.json not found in {asis_dir}')
    sys.exit(1)


# ── Core analysis ─────────────────────────────────────────────────────────────
def build_country_split(mapping):
    """
    Returns dict per country:
      { country_code: {gateways: [...rid], cores: [...rid]} }
    """
    split = defaultdict(lambda: {'gateways': [], 'cores': []})
    for rid, info in mapping.items():
        code = info['country_code']
        if info['is_gateway']:
            split[code]['gateways'].append(rid)
        else:
            split[code]['cores'].append(rid)
    return dict(split)


def build_collapse_config(graph_time, split):
    """
    Produces the COLLAPSING_country-collapse-config.json structure.
    Includes per-country metadata and default expand state.
    """
    countries = {}
    for code, info in sorted(split.items()):
        gw  = sorted(info['gateways'])
        cor = sorted(info['cores'])
        countries[code] = {
            'total':            len(gw) + len(cor),
            'gateway_count':    len(gw),
            'core_count':       len(cor),
            'gateway_ids':      gw,
            'core_ids':         cor,
            'default_collapsed': False,  # all expanded by default
        }

    total_routers  = sum(v['total']         for v in countries.values())
    total_gateways = sum(v['gateway_count'] for v in countries.values())
    total_cores    = sum(v['core_count']    for v in countries.values())

    log(f'Country split: {len(countries)} countries, '
        f'{total_routers} total, {total_gateways} gateways, {total_cores} cores')

    return {
        'graph_time':     graph_time,
        'summary': {
            'total_countries': len(countries),
            'total_routers':   total_routers,
            'total_gateways':  total_gateways,
            'total_cores':     total_cores,
        },
        'countries': countries,
    }


def build_collapsed_topology(asis_nodes, asis_edges, mapping, split):
    """
    Produces the gateway-only collapsed topology:
    - Nodes: only gateway nodes (with country/is_gateway enrichment)
    - Edges: inter-country edges + intra-country edges between gateways only
             (core-to-core and gateway-to-core edges are excluded)

    NOTE: vis.js node 'id' is an integer index; 'label' holds the router IP
    that matches the router_id in country-mapping.csv.
    """
    # Build gateway IP set for quick lookup (keyed by IP / label)
    gw_ips = set()
    for info in split.values():
        gw_ips.update(info['gateways'])

    # Build numeric-id → IP mapping and ip → numeric-id mapping
    node_id_to_ip = {}   # int id → IP string
    node_ip_to_id = {}   # IP string → int id
    for n in asis_nodes:
        ip  = str(n.get('label', n.get('name', '')))
        nid = n.get('id')
        node_id_to_ip[nid] = ip
        node_ip_to_id[ip]  = nid

    # Build gateway numeric-id set (for edge filtering)
    gw_numeric_ids = {node_ip_to_id[ip] for ip in gw_ips if ip in node_ip_to_id}

    # Enrich and filter nodes — keep only gateways
    collapsed_nodes = []
    for n in asis_nodes:
        ip   = str(n.get('label', n.get('name', '')))
        info = mapping.get(ip, {})
        if not info.get('is_gateway', False):
            continue  # skip core nodes
        node_out = dict(n)
        node_out['country']    = info.get('country_code', 'UNK')
        node_out['is_gateway'] = True
        node_out['hostname']   = info.get('hostname', ip)
        collapsed_nodes.append(node_out)

    # Filter edges: keep only edges where BOTH endpoints are gateways.
    # AS-IS edges may use either:
    #   vis.js format: 'from' (int id), 'to' (int id)
    #   pipeline format: 'src' (IP string), 'dst' (IP string)
    collapsed_edges = []
    for e in asis_edges:
        # Resolve endpoints to IP strings for uniform comparison
        if 'src' in e and 'dst' in e:
            src_ip = str(e['src'])
            dst_ip = str(e['dst'])
        else:
            src_ip = node_id_to_ip.get(e.get('from'), '')
            dst_ip = node_id_to_ip.get(e.get('to'), '')
        if src_ip in gw_ips and dst_ip in gw_ips:
            collapsed_edges.append(dict(e))

    log(f'Collapsed topology: {len(collapsed_nodes)} gateway nodes, '
        f'{len(collapsed_edges)} gateway edges '
        f'(from {len(asis_nodes)} nodes, {len(asis_edges)} edges)')

    return {
        'description': 'Gateway-only collapsed topology. '
                       'Core routers are hidden; all inter-country links preserved.',
        'nodes': collapsed_nodes,
        'edges': collapsed_edges,
    }


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    log(f'graph_time   : {args.graph_time}')
    log(f'enriched_dir : {args.enriched_dir}')
    log(f'asis_dir     : {args.asis_dir}')
    log(f'output_dir   : {args.output_dir}')

    # 1. Load inputs
    mapping    = load_country_mapping(args.enriched_dir)
    asis_nodes = load_asis_nodes(args.asis_dir)
    asis_edges = load_asis_edges(args.asis_dir)

    # 2. Build country gateway/core split
    split = build_country_split(mapping)

    # 3. Generate collapse config
    config = build_collapse_config(args.graph_time, split)
    write_json(
        os.path.join(args.output_dir, 'COLLAPSING_country-collapse-config.json'),
        config
    )

    # 4. Generate collapsed topology (gateway-only)
    collapsed = build_collapsed_topology(asis_nodes, asis_edges, mapping, split)
    write_json(
        os.path.join(args.output_dir, 'COLLAPSING_collapsed-topology.json'),
        collapsed
    )
    write_yaml(
        os.path.join(args.output_dir, 'COLLAPSING_collapsed-topology.yaml'),
        collapsed
    )

    # 5. Print summary
    s = config['summary']
    print()
    print('╔══════════════════════════════════════════════════╗')
    print('║          COLLAPSING STAGE COMPLETE               ║')
    print('╠══════════════════════════════════════════════════╣')
    print(f'║  Countries : {s["total_countries"]:<36}║')
    print(f'║  Total     : {s["total_routers"]:<36}║')
    print(f'║  Gateways  : {s["total_gateways"]:<36}║')
    print(f'║  Core      : {s["total_cores"]:<36}║')
    print('╠══════════════════════════════════════════════════╣')
    for code, info in sorted(config['countries'].items()):
        line = f'  {code:<6} total={info["total"]}  gw={info["gateway_count"]}  core={info["core_count"]}'
        print(f'║  {line:<47}║')
    print('╚══════════════════════════════════════════════════╝')
    print()


if __name__ == '__main__':
    main()
