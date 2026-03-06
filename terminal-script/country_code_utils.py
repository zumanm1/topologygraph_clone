import csv
import os
import re
from typing import Dict, Iterable, List, Tuple


def load_overrides(path: str) -> Dict[str, str]:
    overrides: Dict[str, str] = {}
    if not path or not os.path.exists(path):
        return overrides
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            first = (row[0] or "").strip()
            if not first or first.startswith("#"):
                continue
            if len(row) < 2:
                continue
            overrides[first.lower()] = (row[1] or "").strip().upper()
    return overrides


def _looks_like_ip(value: str) -> bool:
    return bool(re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", value.strip()))


def derive_country_code(hostname: str, overrides: Dict[str, str] | None = None) -> str:
    overrides = overrides or {}
    host = (hostname or "").strip()
    if not host or _looks_like_ip(host):
        return "UNK"

    lowered = host.lower()
    prefix_token = lowered.split("-", 1)[0].strip()
    if not prefix_token:
        prefix_token = lowered

    if prefix_token in overrides:
        return overrides[prefix_token]

    letters = re.findall(r"[a-z]", prefix_token)
    if len(letters) >= 3:
        return "".join(letters[:3]).upper()

    start = re.match(r"([a-z]{3})", lowered)
    if start:
        code = start.group(1)
        return overrides.get(code, code.upper())

    compact = re.sub(r"[^a-z0-9]", "", lowered)
    if len(compact) >= 3 and compact[:3].isalpha():
        code = compact[:3]
        return overrides.get(code, code.upper())

    return "UNK"


def parse_host_file(path: str) -> Dict[str, str]:
    host_map: Dict[str, str] = {}
    with open(path, newline="", encoding="utf-8") as f:
        first_line = f.readline()
        f.seek(0)
        if "," in first_line:
            reader = csv.reader(f)
            header = next(reader, [])
            header_map = {str(col).strip().lower(): idx for idx, col in enumerate(header)}
            if "device_ip_address" in header_map and "device_name" in header_map:
                ip_idx = header_map["device_ip_address"]
                host_idx = header_map["device_name"]
            elif "router_id" in header_map and "hostname" in header_map:
                ip_idx = header_map["router_id"]
                host_idx = header_map["hostname"]
            else:
                ip_idx = 0
                host_idx = 1
                if len(header) >= 2:
                    rid = (header[ip_idx] or "").strip()
                    host = (header[host_idx] or "").strip()
                    if rid and host and not rid.startswith("#"):
                        host_map[rid] = host
            for row in reader:
                if len(row) <= max(ip_idx, host_idx):
                    continue
                rid = (row[ip_idx] or "").strip()
                host = (row[host_idx] or "").strip()
                if rid and host and not rid.startswith("#"):
                    host_map[rid] = host
        else:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split(None, 1)
                if len(parts) < 2:
                    continue
                host_map[parts[0].strip()] = parts[1].strip()
    return host_map


def build_enriched_rows(host_map: Dict[str, str], edges: Iterable[Tuple[str, str, int | float]], overrides: Dict[str, str] | None = None) -> Tuple[List[Tuple[str, str, str, str]], List[Tuple[str, str, int | float, str, str, str]]]:
    overrides = overrides or {}
    edge_rows: List[Tuple[str, str, int | float, str, str, str]] = []
    gateways = set()
    seen = set()

    prepared_edges: List[Tuple[str, str, int | float, str, str, bool]] = []
    for src, dst, cost in edges:
        src_code = derive_country_code(host_map.get(src, ""), overrides)
        dst_code = derive_country_code(host_map.get(dst, ""), overrides)
        inter = src_code != dst_code
        prepared_edges.append((src, dst, cost, src_code, dst_code, inter))
        seen.add(src)
        seen.add(dst)
        if inter:
            gateways.add(src)
            gateways.add(dst)

    for src, dst, cost, src_code, dst_code, inter in prepared_edges:
        edge_rows.append((src, dst, cost, src_code, dst_code, "true" if inter else "false"))

    node_rows: List[Tuple[str, str, str, str]] = []
    for rid in sorted(seen, key=lambda value: [int(x) for x in value.split(".")] if _looks_like_ip(value) else [value]):
        host = host_map.get(rid, rid)
        code = derive_country_code(host_map.get(rid, ""), overrides)
        node_rows.append((rid, host, code, "true" if rid in gateways else "false"))

    return node_rows, edge_rows
