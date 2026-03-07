#!/usr/bin/env python3
"""
1) Validate Topolograph is accessible at http://localhost:8080
2) Create default credentials if needed
3) Upload ospf-database.txt via API and print result.
"""
import sys
import requests
import os
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8081")
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
USER = os.environ.get("API_USER") or os.environ.get("TOPOLOGRAPH_WEB_API_USERNAME_EMAIL") or os.environ.get("USER", "ospf@topolograph.com")
PASS = os.environ.get("API_PASS") or os.environ.get("TOPOLOGRAPH_WEB_API_PASSWORD") or os.environ.get("PASS", "ospf")
BOOTSTRAP_SECRET = os.environ.get("TOPOLOGRAPH_BOOTSTRAP_SECRET", PASS)
LSDB_PATH = Path(os.environ.get("LSDB_FILE", PROJECT_ROOT / "INPUT-FOLDER" / "ospf-database.txt"))
TIMEOUT = int(os.environ.get("TIMEOUT", "120"))


def session_for_base_url(base_url: str) -> requests.Session:
    session = requests.Session()
    hostname = (urlparse(base_url).hostname or "").lower()
    if hostname in {"localhost", "127.0.0.1", "::1"}:
        session.trust_env = False
    return session


def main():
    session = session_for_base_url(BASE_URL)
    # 1) Validate accessible
    print(f"Checking {BASE_URL} ...")
    try:
        r = session.get(f"{BASE_URL}/", timeout=10)
        r.raise_for_status()
        print(f"  OK – Topolograph is reachable (HTTP {r.status_code})")
    except requests.RequestException as e:
        print(f"  FAIL – Cannot reach Topolograph: {e}")
        print("  Start the app first: ./start_topolograph.sh  (Docker must be running)")
        return 1

    # 2) Create default credentials (idempotent)
    print("Creating default API credentials ...")
    try:
        r = session.post(f"{BASE_URL}/create-default-credentials", headers={"X-Topolograph-Bootstrap-Secret": BOOTSTRAP_SECRET}, timeout=10)
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if data.get("status") == "ok":
            print("  OK – Default credentials ready")
        else:
            print(f"  Response: {r.status_code} {data or r.text[:200]}")
    except Exception as e:
        print(f"  Note: {e}")

    # 3) Upload LSDB
    if not LSDB_PATH.exists():
        print(f"LSDB file not found: {LSDB_PATH}")
        return 1
    lsdb_text = LSDB_PATH.read_text(encoding="utf-8", errors="replace")
    print(f"Uploading {LSDB_PATH.name} ({len(lsdb_text)} chars) ...")

    try:
        r = session.post(
            f"{BASE_URL}/api/graph",
            auth=(USER, PASS),
            json={
                "lsdb_output": lsdb_text,
                "vendor_device": "Cisco",
                "igp_protocol": "ospf",
            },
            timeout=TIMEOUT,
        )
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code in (200, 201) and (data.get("graph_time") or data.get("timestamp")):
            print("  OK – Upload successful")
            print(f"  graph_time: {data.get('graph_time', 'N/A')}")
            print(f"  hosts: {data.get('hosts', {}).get('count', 'N/A')}")
            if data.get("networks"):
                print(f"  networks: {data.get('networks')}")
            if data.get("reports"):
                print(f"  reports: {data.get('reports')}")
            return 0
        print(f"  FAIL – HTTP {r.status_code}")
        print(f"  Response: {data or r.text[:500]}")
        if r.status_code == 401:
            print("  Tip: Run create-default-credentials or check TOPOLOGRAPH_WEB_API_* in topolograph-docker/.env")
        return 1
    except requests.RequestException as e:
        print(f"  Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
