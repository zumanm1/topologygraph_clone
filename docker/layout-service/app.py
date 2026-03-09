import csv
import io
import json
import os
import re
import time
from contextlib import contextmanager
from typing import Any

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

DB_HOST = os.getenv("LAYOUT_DB_HOST", "layout-db")
DB_PORT = int(os.getenv("LAYOUT_DB_PORT", "5432"))
DB_NAME = os.getenv("LAYOUT_DB_NAME", "topolograph_layouts")
DB_USER = os.getenv("LAYOUT_DB_USER", "layout_user")
DB_PASSWORD = os.getenv("LAYOUT_DB_PASSWORD", "layout_password")

DSN = f"dbname={DB_NAME} user={DB_USER} password={DB_PASSWORD} host={DB_HOST} port={DB_PORT}"

app = FastAPI(title="Topolograph Layout API")


class LayoutPayload(BaseModel):
    graph_id: str = Field(min_length=1)
    graph_time: str = Field(min_length=1)
    view_mode: str = Field(min_length=1)
    positions: dict[str, dict[str, float | int]] = Field(default_factory=dict)
    viewport: dict[str, Any] = Field(default_factory=dict)
    physics_enabled: bool = True
    selected_node_id: str | None = None


class CountryOverride(BaseModel):
    prefix: str = Field(min_length=1, max_length=255)
    country_code: str = Field(min_length=3, max_length=3)
    notes: str | None = None

    @field_validator('prefix')
    @classmethod
    def validate_prefix(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r'^[a-z0-9][a-z0-9-]*$', v):
            raise ValueError('prefix must contain only lowercase letters, numbers, and hyphens')
        return v

    @field_validator('country_code')
    @classmethod
    def validate_country_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not re.match(r'^[A-Z]{3}$', v):
            raise ValueError('country_code must be exactly 3 uppercase letters')
        return v


class CountryOverrideBulk(BaseModel):
    overrides: list[CountryOverride]


@contextmanager
def get_conn():
    conn = psycopg.connect(DSN)
    try:
        yield conn
    finally:
        conn.close()


def run_migrations() -> None:
    """Run database migrations from migrations directory."""
    migrations_dir = os.path.join(os.path.dirname(__file__), 'migrations')
    if not os.path.exists(migrations_dir):
        return
    
    migration_files = sorted([f for f in os.listdir(migrations_dir) if f.endswith('.sql')])
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            for migration_file in migration_files:
                migration_path = os.path.join(migrations_dir, migration_file)
                with open(migration_path, 'r') as f:
                    migration_sql = f.read()
                try:
                    cur.execute(migration_sql)
                    conn.commit()
                except psycopg.errors.DuplicateTable:
                    conn.rollback()
                except Exception as e:
                    conn.rollback()
                    raise RuntimeError(f"Migration {migration_file} failed: {e}")


def ensure_schema() -> None:
    for _ in range(30):
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS layout_snapshots_secure (
                            owner_login TEXT NOT NULL,
                            graph_id TEXT NOT NULL,
                            graph_time TEXT NOT NULL,
                            view_mode TEXT NOT NULL,
                            revision INTEGER NOT NULL DEFAULT 1,
                            physics_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                            selected_node_id TEXT,
                            positions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            viewport_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            PRIMARY KEY (owner_login, graph_id, graph_time, view_mode)
                        )
                        """
                    )
                    conn.commit()
            run_migrations()
            return
        except psycopg.OperationalError:
            time.sleep(1)
    raise RuntimeError("layout database is not reachable")


@app.on_event("startup")
def startup() -> None:
    ensure_schema()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def require_owner(x_authenticated_user: str | None = Header(default=None)) -> str:
    owner = (x_authenticated_user or "").strip()
    if not owner:
        raise HTTPException(status_code=401, detail="authentication required")
    return owner


@app.get("/layouts")
def get_layout(graph_id: str, graph_time: str, view_mode: str, owner_login: str = Depends(require_owner)) -> dict[str, Any]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT owner_login, graph_id, graph_time, view_mode, revision, physics_enabled,
                       selected_node_id, positions_json, viewport_json, updated_at
                FROM layout_snapshots_secure
                WHERE owner_login = %s AND graph_id = %s AND graph_time = %s AND view_mode = %s
                """,
                (owner_login, graph_id, graph_time, view_mode),
            )
            row = cur.fetchone()
    if not row:
        return {"found": False}
    return {
        "found": True,
        "graph_id": row[1],
        "graph_time": row[2],
        "view_mode": row[3],
        "revision": row[4],
        "physics_enabled": row[5],
        "selected_node_id": row[6],
        "positions": row[7] or {},
        "viewport": row[8] or {},
        "updated_at": row[9].isoformat() if row[9] else None,
    }


@app.put("/layouts")
def save_layout(payload: LayoutPayload, owner_login: str = Depends(require_owner)) -> dict[str, Any]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO layout_snapshots_secure (
                    owner_login, graph_id, graph_time, view_mode, revision, physics_enabled,
                    selected_node_id, positions_json, viewport_json, updated_at
                )
                VALUES (%s, %s, %s, %s, 1, %s, %s, %s::jsonb, %s::jsonb, NOW())
                ON CONFLICT (owner_login, graph_id, graph_time, view_mode)
                DO UPDATE SET
                    revision = layout_snapshots_secure.revision + 1,
                    physics_enabled = EXCLUDED.physics_enabled,
                    selected_node_id = EXCLUDED.selected_node_id,
                    positions_json = EXCLUDED.positions_json,
                    viewport_json = EXCLUDED.viewport_json,
                    updated_at = NOW()
                RETURNING revision, updated_at
                """,
                (
                    owner_login,
                    payload.graph_id,
                    payload.graph_time,
                    payload.view_mode,
                    payload.physics_enabled,
                    payload.selected_node_id,
                    json.dumps(payload.positions),
                    json.dumps(payload.viewport),
                ),
            )
            revision, updated_at = cur.fetchone()
            conn.commit()
    return {"status": "ok", "revision": revision, "updated_at": updated_at.isoformat()}


@app.delete("/layouts")
def reset_layout(graph_id: str, graph_time: str, view_mode: str, owner_login: str = Depends(require_owner)) -> dict[str, str]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM layout_snapshots_secure WHERE owner_login = %s AND graph_id = %s AND graph_time = %s AND view_mode = %s",
                (owner_login, graph_id, graph_time, view_mode),
            )
            deleted = cur.rowcount
            conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="layout not found")
    return {"status": "ok"}


@app.delete("/layouts/node")
def reset_layout_node(graph_id: str, graph_time: str, view_mode: str, node_id: str, owner_login: str = Depends(require_owner)) -> dict[str, Any]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE layout_snapshots_secure
                SET positions_json = COALESCE(positions_json, '{}'::jsonb) - %s,
                    revision = revision + 1,
                    updated_at = NOW()
                WHERE owner_login = %s AND graph_id = %s AND graph_time = %s AND view_mode = %s
                RETURNING revision, updated_at
                """,
                (node_id, owner_login, graph_id, graph_time, view_mode),
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        raise HTTPException(status_code=404, detail="layout not found")
    return {"status": "ok", "revision": row[0], "updated_at": row[1].isoformat()}


# ============================================================================
# Country Override Management API
# ============================================================================

@app.get("/country-overrides")
def list_country_overrides() -> dict[str, Any]:
    """List all country overrides."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, prefix, country_code, created_at, updated_at, created_by, notes
                FROM country_overrides
                ORDER BY prefix ASC
                """
            )
            rows = cur.fetchall()
    
    overrides = [
        {
            "id": row[0],
            "prefix": row[1],
            "country_code": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "updated_at": row[4].isoformat() if row[4] else None,
            "created_by": row[5],
            "notes": row[6],
        }
        for row in rows
    ]
    return {"overrides": overrides, "count": len(overrides)}


@app.get("/country-overrides/{prefix}")
def get_country_override(prefix: str) -> dict[str, Any]:
    """Get a specific country override by prefix."""
    prefix = prefix.strip().lower()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, prefix, country_code, created_at, updated_at, created_by, notes
                FROM country_overrides
                WHERE prefix = %s
                """,
                (prefix,),
            )
            row = cur.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="override not found")
    
    return {
        "id": row[0],
        "prefix": row[1],
        "country_code": row[2],
        "created_at": row[3].isoformat() if row[3] else None,
        "updated_at": row[4].isoformat() if row[4] else None,
        "created_by": row[5],
        "notes": row[6],
    }


@app.post("/country-overrides")
def create_country_override(payload: CountryOverride) -> dict[str, Any]:
    """Create a new country override."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    INSERT INTO country_overrides (prefix, country_code, notes)
                    VALUES (%s, %s, %s)
                    RETURNING id, prefix, country_code, created_at, updated_at, created_by, notes
                    """,
                    (payload.prefix, payload.country_code, payload.notes),
                )
                row = cur.fetchone()
                conn.commit()
            except psycopg.errors.UniqueViolation:
                conn.rollback()
                raise HTTPException(status_code=409, detail=f"override for prefix '{payload.prefix}' already exists")
    
    return {
        "status": "created",
        "override": {
            "id": row[0],
            "prefix": row[1],
            "country_code": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "updated_at": row[4].isoformat() if row[4] else None,
            "created_by": row[5],
            "notes": row[6],
        },
    }


@app.put("/country-overrides/{prefix}")
def update_country_override(prefix: str, payload: CountryOverride) -> dict[str, Any]:
    """Update an existing country override."""
    prefix = prefix.strip().lower()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE country_overrides
                SET country_code = %s, notes = %s, updated_at = NOW()
                WHERE prefix = %s
                RETURNING id, prefix, country_code, created_at, updated_at, created_by, notes
                """,
                (payload.country_code, payload.notes, prefix),
            )
            row = cur.fetchone()
            conn.commit()
    
    if not row:
        raise HTTPException(status_code=404, detail="override not found")
    
    return {
        "status": "updated",
        "override": {
            "id": row[0],
            "prefix": row[1],
            "country_code": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
            "updated_at": row[4].isoformat() if row[4] else None,
            "created_by": row[5],
            "notes": row[6],
        },
    }


@app.delete("/country-overrides/{prefix}")
def delete_country_override(prefix: str) -> dict[str, str]:
    """Delete a country override."""
    prefix = prefix.strip().lower()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM country_overrides WHERE prefix = %s",
                (prefix,),
            )
            deleted = cur.rowcount
            conn.commit()
    
    if not deleted:
        raise HTTPException(status_code=404, detail="override not found")
    
    return {"status": "deleted", "prefix": prefix}


@app.post("/country-overrides/bulk")
def bulk_import_country_overrides(payload: CountryOverrideBulk) -> dict[str, Any]:
    """Bulk import country overrides."""
    created = 0
    updated = 0
    errors = []
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            for override in payload.overrides:
                try:
                    cur.execute(
                        """
                        INSERT INTO country_overrides (prefix, country_code, notes)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (prefix)
                        DO UPDATE SET country_code = EXCLUDED.country_code,
                                      notes = EXCLUDED.notes,
                                      updated_at = NOW()
                        RETURNING (xmax = 0) AS inserted
                        """,
                        (override.prefix, override.country_code, override.notes),
                    )
                    row = cur.fetchone()
                    if row[0]:
                        created += 1
                    else:
                        updated += 1
                except Exception as e:
                    errors.append({"prefix": override.prefix, "error": str(e)})
            
            if not errors:
                conn.commit()
            else:
                conn.rollback()
    
    return {
        "status": "completed" if not errors else "partial",
        "created": created,
        "updated": updated,
        "errors": errors,
    }


@app.get("/country-overrides/export/csv")
def export_country_overrides_csv() -> Response:
    """Export all country overrides as CSV."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT prefix, country_code, notes
                FROM country_overrides
                ORDER BY prefix ASC
                """
            )
            rows = cur.fetchall()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['prefix', 'country_code', 'notes'])
    for row in rows:
        writer.writerow([row[0], row[1], row[2] or ''])
    
    return Response(
        content=output.getvalue(),
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename="country-overrides.csv"'}
    )
