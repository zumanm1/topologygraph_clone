import csv
import io
import json
import os
import re
import time
from contextlib import contextmanager
from typing import Any, List, Optional

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from spf_calculator import apply_scenario

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


class WhatIfScenario(BaseModel):
    graph_id: str = Field(min_length=1)
    graph_time: str = Field(min_length=1)
    scenario_name: str = Field(min_length=1, max_length=255)
    scenario_type: str = Field(pattern='^(node_failure|link_failure|cost_change|multi_change)$')
    scenario_config: dict[str, Any]
    baseline_matrix: dict[str, Any]
    modified_matrix: dict[str, Any]
    statistics: Optional[dict[str, Any]] = None
    description: Optional[str] = None
    is_public: bool = False
    created_by: Optional[str] = None


class WhatIfScenarioCreate(BaseModel):
    graph_id: str = Field(min_length=1)
    graph_time: str = Field(min_length=1)
    scenario_name: str = Field(min_length=1, max_length=255)
    scenario_type: str = Field(pattern='^(node_failure|link_failure|cost_change|multi_change)$')
    scenario_config: dict[str, Any]
    description: Optional[str] = None
    is_public: bool = False


class WhatIfScenarioResponse(BaseModel):
    id: int
    graph_id: str
    graph_time: str
    scenario_name: str
    scenario_type: str
    scenario_config: dict[str, Any]
    baseline_matrix: dict[str, Any]
    modified_matrix: dict[str, Any]
    statistics: Optional[dict[str, Any]]
    description: Optional[str]
    is_public: bool
    created_at: str
    updated_at: str
    created_by: Optional[str]


class WhatIfComparison(BaseModel):
    comparison_name: str
    scenario_ids: List[int]
    graph_id: str
    graph_time: str


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


# ============================================================================
# What-If Scenario Management Endpoints
# ============================================================================

@app.post("/whatif/scenarios", response_model=WhatIfScenarioResponse, status_code=201)
def create_whatif_scenario(scenario: WhatIfScenarioCreate, topology_data: dict = None):
    """Create a new what-if scenario with baseline and modified cost matrices."""
    if not topology_data:
        raise HTTPException(status_code=400, detail="topology_data is required in request body")
    
    try:
        # Apply scenario and calculate matrices
        baseline_matrix, modified_matrix, statistics = apply_scenario(
            topology_data, 
            scenario.scenario_config
        )
        
        # Store in database
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO whatif_scenarios 
                    (graph_id, graph_time, scenario_name, scenario_type, scenario_config, 
                     baseline_matrix, modified_matrix, statistics, description, is_public)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, created_at, updated_at
                    """,
                    (
                        scenario.graph_id,
                        scenario.graph_time,
                        scenario.scenario_name,
                        scenario.scenario_type,
                        json.dumps(scenario.scenario_config),
                        json.dumps(baseline_matrix),
                        json.dumps(modified_matrix),
                        json.dumps(statistics),
                        scenario.description,
                        scenario.is_public
                    )
                )
                row = cur.fetchone()
                scenario_id = row[0]
                created_at = row[1]
                updated_at = row[2]
            conn.commit()
        
        return WhatIfScenarioResponse(
            id=scenario_id,
            graph_id=scenario.graph_id,
            graph_time=scenario.graph_time,
            scenario_name=scenario.scenario_name,
            scenario_type=scenario.scenario_type,
            scenario_config=scenario.scenario_config,
            baseline_matrix=baseline_matrix,
            modified_matrix=modified_matrix,
            statistics=statistics,
            description=scenario.description,
            is_public=scenario.is_public,
            created_at=created_at.isoformat(),
            updated_at=updated_at.isoformat(),
            created_by=None
        )
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating scenario: {str(e)}")


@app.get("/whatif/scenarios", response_model=List[WhatIfScenarioResponse])
def list_whatif_scenarios(
    graph_id: str = None,
    graph_time: str = None,
    scenario_type: str = None,
    is_public: bool = None
):
    """List all what-if scenarios with optional filtering."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            query = "SELECT id, graph_id, graph_time, scenario_name, scenario_type, scenario_config, baseline_matrix, modified_matrix, statistics, description, is_public, created_at, updated_at, created_by FROM whatif_scenarios WHERE 1=1"
            params = []
            
            if graph_id:
                query += " AND graph_id = %s"
                params.append(graph_id)
            if graph_time:
                query += " AND graph_time = %s"
                params.append(graph_time)
            if scenario_type:
                query += " AND scenario_type = %s"
                params.append(scenario_type)
            if is_public is not None:
                query += " AND is_public = %s"
                params.append(is_public)
            
            query += " ORDER BY created_at DESC"
            
            cur.execute(query, params)
            rows = cur.fetchall()
            
            return [
                WhatIfScenarioResponse(
                    id=row[0],
                    graph_id=row[1],
                    graph_time=row[2],
                    scenario_name=row[3],
                    scenario_type=row[4],
                    scenario_config=row[5],
                    baseline_matrix=row[6],
                    modified_matrix=row[7],
                    statistics=row[8],
                    description=row[9],
                    is_public=row[10],
                    created_at=row[11].isoformat(),
                    updated_at=row[12].isoformat(),
                    created_by=row[13]
                )
                for row in rows
            ]


@app.get("/whatif/scenarios/{scenario_id}", response_model=WhatIfScenarioResponse)
def get_whatif_scenario(scenario_id: int):
    """Get a specific what-if scenario by ID."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, graph_id, graph_time, scenario_name, scenario_type, 
                       scenario_config, baseline_matrix, modified_matrix, statistics,
                       description, is_public, created_at, updated_at, created_by
                FROM whatif_scenarios
                WHERE id = %s
                """,
                (scenario_id,)
            )
            row = cur.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Scenario not found")
            
            return WhatIfScenarioResponse(
                id=row[0],
                graph_id=row[1],
                graph_time=row[2],
                scenario_name=row[3],
                scenario_type=row[4],
                scenario_config=row[5],
                baseline_matrix=row[6],
                modified_matrix=row[7],
                statistics=row[8],
                description=row[9],
                is_public=row[10],
                created_at=row[11].isoformat(),
                updated_at=row[12].isoformat(),
                created_by=row[13]
            )


@app.delete("/whatif/scenarios/{scenario_id}", status_code=204)
def delete_whatif_scenario(scenario_id: int):
    """Delete a what-if scenario."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM whatif_scenarios WHERE id = %s RETURNING id", (scenario_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Scenario not found")
        conn.commit()
    return Response(status_code=204)


@app.post("/whatif/compare")
def compare_whatif_scenarios(comparison: WhatIfComparison):
    """Compare multiple what-if scenarios and return aggregated statistics."""
    if len(comparison.scenario_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 scenarios required for comparison")
    
    if len(comparison.scenario_ids) > 4:
        raise HTTPException(status_code=400, detail="Maximum 4 scenarios can be compared at once")
    
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Fetch all scenarios
            cur.execute(
                """
                SELECT id, scenario_name, scenario_type, scenario_config, 
                       baseline_matrix, modified_matrix, statistics
                FROM whatif_scenarios
                WHERE id = ANY(%s) AND graph_id = %s AND graph_time = %s
                """,
                (comparison.scenario_ids, comparison.graph_id, comparison.graph_time)
            )
            rows = cur.fetchall()
            
            if len(rows) != len(comparison.scenario_ids):
                raise HTTPException(status_code=404, detail="One or more scenarios not found")
            
            scenarios = [
                {
                    "id": row[0],
                    "scenario_name": row[1],
                    "scenario_type": row[2],
                    "scenario_config": row[3],
                    "baseline_matrix": row[4],
                    "modified_matrix": row[5],
                    "statistics": row[6]
                }
                for row in rows
            ]
            
            # Store comparison in database
            cur.execute(
                """
                INSERT INTO whatif_comparisons (comparison_name, scenario_ids, graph_id, graph_time, comparison_result)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    comparison.comparison_name,
                    comparison.scenario_ids,
                    comparison.graph_id,
                    comparison.graph_time,
                    json.dumps({"scenarios": scenarios})
                )
            )
            comparison_id = cur.fetchone()[0]
        conn.commit()
    
    return {
        "comparison_id": comparison_id,
        "scenarios": scenarios,
        "summary": {
            "total_scenarios": len(scenarios),
            "scenario_types": list(set(s["scenario_type"] for s in scenarios))
        }
    }


@app.get("/whatif/matrix-diff/{scenario_id}")
def get_matrix_diff(scenario_id: int):
    """Get the cost matrix differences for a specific scenario."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT baseline_matrix, modified_matrix, statistics
                FROM whatif_scenarios
                WHERE id = %s
                """,
                (scenario_id,)
            )
            row = cur.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Scenario not found")
            
            baseline = row[0]
            modified = row[1]
            statistics = row[2] or {}
            
            # Calculate differences
            diff = {}
            for src in baseline:
                if src not in diff:
                    diff[src] = {}
                for dst in baseline[src]:
                    baseline_cost = baseline[src][dst]
                    modified_cost = modified.get(src, {}).get(dst, float('inf'))
                    
                    if baseline_cost != modified_cost:
                        diff[src][dst] = {
                            "baseline": baseline_cost,
                            "modified": modified_cost,
                            "delta": modified_cost - baseline_cost if modified_cost != float('inf') else None,
                            "status": "lost" if modified_cost == float('inf') else ("improved" if modified_cost < baseline_cost else "degraded")
                        }
            
            return {
                "scenario_id": scenario_id,
                "baseline_matrix": baseline,
                "modified_matrix": modified,
                "diff": diff,
                "statistics": statistics
            }
