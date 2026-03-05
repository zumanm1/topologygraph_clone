#!/usr/bin/env python3
"""
push-to-ui.py
=============
Reads the ENRICHED country-mapping.csv for a given graph_time and pushes
country colours, country attribute, and node title (tooltip) back into
the running Topolograph instance via PATCH /api/diagram/{graph_time}/nodes/{id}.

Usage:
    python3 push-to-ui.py --graph-time <value> [options]

Options:
    --graph-time <value>     Required. The Topolograph graph_time to update.
    --enriched-dir <path>    Path to OUTPUT/ENRICHED/{graph_time}/ (auto-detected).
    --base-url <url>         Topolograph base URL (default: http://localhost:8081)
    --user <username>        API username (default: ospf@topolograph.com)
    --pass <password>        API password (default: ospf)
    --dry-run                Print what would be sent; don't actually patch.
"""

import sys
import os
import csv
import json
import argparse
import requests

# ── Country → Colour palette ──────────────────────────────────────────────────
# Each entry: {background, border} matching vis.js color format.
# Colours chosen to be distinct, professional, colour-blind-friendly.
COUNTRY_COLORS = {
    "ZAF": {"background": "#FF8C42", "border": "#CC6D28",
            "highlight": {"background": "#FFB380", "border": "#FF8C42"},
            "hover":     {"background": "#FFB380", "border": "#FF8C42"}},
    "DRC": {"background": "#4ECDC4", "border": "#3AA39B",
            "highlight": {"background": "#7EDAD6", "border": "#4ECDC4"},
            "hover":     {"background": "#7EDAD6", "border": "#4ECDC4"}},
    "MOZ": {"background": "#45B7D1", "border": "#2E95AF",
            "highlight": {"background": "#75CDE0", "border": "#45B7D1"},
            "hover":     {"background": "#75CDE0", "border": "#45B7D1"}},
    "KEN": {"background": "#6BCB77", "border": "#4DA85A",
            "highlight": {"background": "#95DB9E", "border": "#6BCB77"},
            "hover":     {"background": "#95DB9E", "border": "#6BCB77"}},
    "TAN": {"background": "#FFD93D", "border": "#CCAA1A",
            "highlight": {"background": "#FFE675", "border": "#FFD93D"},
            "hover":     {"background": "#FFE675", "border": "#FFD93D"}},
    "LES": {"background": "#C77DFF", "border": "#A055D4",
            "highlight": {"background": "#D9A8FF", "border": "#C77DFF"},
            "hover":     {"background": "#D9A8FF", "border": "#C77DFF"}},
    "DJB": {"background": "#FF6B6B", "border": "#D44A4A",
            "highlight": {"background": "#FF9898", "border": "#FF6B6B"},
            "hover":     {"background": "#FF9898", "border": "#FF6B6B"}},
    "GBR": {"background": "#4D96FF", "border": "#2070D4",
            "highlight": {"background": "#80B5FF", "border": "#4D96FF"},
            "hover":     {"background": "#80B5FF", "border": "#4D96FF"}},
    "FRA": {"background": "#F77F00", "border": "#C46200",
            "highlight": {"background": "#FAA84D", "border": "#F77F00"},
            "hover":     {"background": "#FAA84D", "border": "#F77F00"}},
    "POR": {"background": "#06D6A0", "border": "#04A87D",
            "highlight": {"background": "#47E6BE", "border": "#06D6A0"},
            "hover":     {"background": "#47E6BE", "border": "#06D6A0"}},
    "ETH": {"background": "#F4A261", "border": "#C17E3E",
            "highlight": {"background": "#F8C28C", "border": "#F4A261"},
            "hover":     {"background": "#F8C28C", "border": "#F4A261"}},
    # Fallback for unknown / unmapped nodes
    "UNK": {"background": "#AAAAAA", "border": "#888888",
            "highlight": {"background": "#CCCCCC", "border": "#AAAAAA"},
            "hover":     {"background": "#CCCCCC", "border": "#AAAAAA"}},
}

# Auto-generate colors for countries not in the palette using HSL hashing
def _auto_color(country_code: str) -> dict:
    """Deterministic color derived from country code string hash."""
    import hashlib
    digest = int(hashlib.sha256(country_code.encode()).hexdigest(), 16)
    hue = digest % 360
    bg  = f"hsl({hue}, 65%, 60%)"
    bdr = f"hsl({hue}, 65%, 40%)"
    return {"background": bg, "border": bdr,
            "highlight": {"background": bg, "border": bdr},
            "hover":     {"background": bg, "border": bdr}}

def get_color(country: str) -> dict:
    code = (country or "UNK").strip().upper()
    return COUNTRY_COLORS.get(code) or _auto_color(code) or COUNTRY_COLORS["UNK"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_country_mapping(csv_path: str) -> dict:
    """Returns {router_id: {hostname, country, is_gateway}} from country-mapping.csv."""
    mapping = {}
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rid = row.get("router_id", "").strip()
            if rid:
                mapping[rid] = {
                    "hostname":   row.get("hostname", rid).strip(),
                    "country":    (row.get("country_code") or row.get("country") or "UNK").strip().upper(),
                    "is_gateway": row.get("is_gateway", "false").strip().lower() == "true",
                }
    return mapping


def fetch_nodes(base_url: str, graph_time: str, auth: tuple) -> list:
    r = requests.get(f"{base_url}/api/diagram/{graph_time}/nodes", auth=auth, timeout=30)
    r.raise_for_status()
    return r.json()


def patch_node(base_url: str, graph_time: str, node_id: int | str,
               payload: dict, auth: tuple, dry_run: bool) -> bool:
    url = f"{base_url}/api/diagram/{graph_time}/nodes/{node_id}"
    if dry_run:
        print(f"  [DRY-RUN] PATCH {url} → {json.dumps(payload)[:120]}")
        return True
    r = requests.patch(url, json=payload, auth=auth, timeout=10)
    return r.status_code in (200, 201, 204)


def build_title(info: dict) -> str:
    gw_tag = " 🌐" if info["is_gateway"] else ""
    country = info["country"]
    hostname = info["hostname"]
    is_unk = (country == "UNK")
    # For UNK nodes the hostname IS the router_id — flag it clearly
    unk_note = "<br/><i style='color:#f90'>⚠ No hostname mapping in host file</i>" if is_unk else ""
    return (f"<b>{hostname}</b>{gw_tag}<br/>"
            f"Country: <b>{country}</b>{unk_note}<br/>"
            f"Gateway: {str(info['is_gateway']).lower()}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Push country colours to Topolograph UI")
    parser.add_argument("--graph-time",   required=True)
    parser.add_argument("--enriched-dir", default="")
    parser.add_argument("--base-url",     default="http://localhost:8081")
    parser.add_argument("--user",         default="ospf@topolograph.com")
    parser.add_argument("--pass",         dest="password", default="ospf")
    parser.add_argument("--dry-run",      action="store_true")
    args = parser.parse_args()

    auth = (args.user, args.password)

    # Locate ENRICHED_country-mapping.csv
    # Subfolder is now {graph_time}_ENRICHED; file prefix is ENRICHED_
    if args.enriched_dir:
        csv_path = os.path.join(args.enriched_dir, "ENRICHED_country-mapping.csv")
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        csv_path = os.path.join(project_root, "OUTPUT", "ENRICHED",
                                f"{args.graph_time}_ENRICHED", "ENRICHED_country-mapping.csv")

    if not os.path.exists(csv_path):
        print(f"ERROR: ENRICHED_country-mapping.csv not found at: {csv_path}")
        print("Run the terminal pipeline first (workflow.sh or topology-country-tool.sh)")
        sys.exit(1)

    print(f"[push-to-ui] Loading country mapping: {csv_path}")
    mapping = load_country_mapping(csv_path)
    print(f"[push-to-ui] {len(mapping)} routers mapped to countries")

    # Summarise countries
    from collections import Counter
    cc_count = Counter(v["country"] for v in mapping.values())
    print("[push-to-ui] Countries: " + " | ".join(f"{c}:{n}" for c, n in sorted(cc_count.items())))

    # Fetch live nodes from Topolograph
    print(f"[push-to-ui] Fetching nodes for graph_time={args.graph_time} …")
    nodes = fetch_nodes(args.base_url, args.graph_time, auth)
    print(f"[push-to-ui] {len(nodes)} nodes in graph")

    # Build colour palette summary for front-end
    palette  = {}
    unk_nodes = []          # router_ids that had no hostname mapping
    ok, fail, skip = 0, 0, 0
    for node in nodes:
        node_id   = node.get("id")
        router_id = node.get("name") or node.get("label") or ""

        info = mapping.get(router_id)
        is_from_mapping = info is not None
        if info is None:
            # Node is in the live graph but NOT in host file → UNK
            # This router still gets processed — not dropped.
            info = {"hostname": router_id, "country": "UNK", "is_gateway": False}

        country = info["country"]
        color   = get_color(country)
        palette[country] = color  # collect for legend

        # HOT-F0: Dual-label — show hostname on line 1, IP/RID on line 2.
        # For unmapped (UNK) nodes the hostname IS the router_id so we label
        # them with the IP plus a "(UNK)" tag so engineers can identify them.
        if is_from_mapping and info["hostname"] != router_id:
            node_label = f"{info['hostname']}\n{router_id}"
        elif not is_from_mapping:
            node_label = f"{router_id}\n(UNK)"
        else:
            node_label = router_id  # fallback: hostname == router_id edge case

        payload = {
            "country":    country,
            "is_gateway": info["is_gateway"],
            "hostname":   info["hostname"],
            "color":      color,
            "title":      build_title(info),
            # group = country code → vis.js can colour by group
            "group":      country,
            # HOT-F0: two-line label visible on the graph canvas
            "label":      node_label,
        }

        success = patch_node(args.base_url, args.graph_time, node_id, payload, auth, args.dry_run)
        if success:
            ok += 1
            if country == "UNK":
                unk_nodes.append(router_id)
        else:
            fail += 1
            print(f"  FAIL  node_id={node_id} router={router_id}")

    print(f"\n[push-to-ui] Patched: {ok} OK  |  {fail} FAILED  |  {skip} skipped")
    if unk_nodes:
        print(f"[push-to-ui] ⚠  UNK nodes ({len(unk_nodes)}) — no hostname in host file:")
        for rid in sorted(unk_nodes):
            print(f"             • {rid}  (label=router-id, colour=grey, shown in 'Unknown / Unmapped' filter group)")
    else:
        print("[push-to-ui] ✓  All nodes have hostname mappings — no UNK nodes.")

    # Write palette JSON (used by topolograph.js for the filter panel legend)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    palette_path = os.path.join(project_root, "OUTPUT", "ENRICHED",
                                f"{args.graph_time}_ENRICHED", "ENRICHED_country-palette.json")
    os.makedirs(os.path.dirname(palette_path), exist_ok=True)
    with open(palette_path, "w") as f:
        json.dump({"graph_time": args.graph_time, "palette": palette,
                   "countries": sorted(palette.keys())}, f, indent=2)
    print(f"[push-to-ui] Palette written: {palette_path}")

    # Expose palette as an API-accessible endpoint via a small flag file in the
    # container-accessible static area (uses topolograph.js pick-up mechanism).
    print(f"[push-to-ui] Done — open http://localhost:8081/ and load graph_time={args.graph_time}")
    print("             The Country Filter panel will appear automatically in the UI.")


if __name__ == "__main__":
    main()
