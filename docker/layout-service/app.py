import json
import os
import time
from contextlib import contextmanager
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

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


@contextmanager
def get_conn():
    conn = psycopg.connect(DSN)
    try:
        yield conn
    finally:
        conn.close()


def ensure_schema() -> None:
    for _ in range(30):
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        CREATE TABLE IF NOT EXISTS layout_snapshots (
                            graph_id TEXT NOT NULL,
                            graph_time TEXT NOT NULL,
                            view_mode TEXT NOT NULL,
                            revision INTEGER NOT NULL DEFAULT 1,
                            physics_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                            selected_node_id TEXT,
                            positions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            viewport_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            PRIMARY KEY (graph_id, graph_time, view_mode)
                        )
                        """
                    )
                    conn.commit()
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


@app.get("/layouts")
def get_layout(graph_id: str, graph_time: str, view_mode: str) -> dict[str, Any]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT graph_id, graph_time, view_mode, revision, physics_enabled,
                       selected_node_id, positions_json, viewport_json, updated_at
                FROM layout_snapshots
                WHERE graph_id = %s AND graph_time = %s AND view_mode = %s
                """,
                (graph_id, graph_time, view_mode),
            )
            row = cur.fetchone()
    if not row:
        return {"found": False}
    return {
        "found": True,
        "graph_id": row[0],
        "graph_time": row[1],
        "view_mode": row[2],
        "revision": row[3],
        "physics_enabled": row[4],
        "selected_node_id": row[5],
        "positions": row[6] or {},
        "viewport": row[7] or {},
        "updated_at": row[8].isoformat() if row[8] else None,
    }


@app.put("/layouts")
def save_layout(payload: LayoutPayload) -> dict[str, Any]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO layout_snapshots (
                    graph_id, graph_time, view_mode, revision, physics_enabled,
                    selected_node_id, positions_json, viewport_json, updated_at
                )
                VALUES (%s, %s, %s, 1, %s, %s, %s::jsonb, %s::jsonb, NOW())
                ON CONFLICT (graph_id, graph_time, view_mode)
                DO UPDATE SET
                    revision = layout_snapshots.revision + 1,
                    physics_enabled = EXCLUDED.physics_enabled,
                    selected_node_id = EXCLUDED.selected_node_id,
                    positions_json = EXCLUDED.positions_json,
                    viewport_json = EXCLUDED.viewport_json,
                    updated_at = NOW()
                RETURNING revision, updated_at
                """,
                (
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
def reset_layout(graph_id: str, graph_time: str, view_mode: str) -> dict[str, str]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM layout_snapshots WHERE graph_id = %s AND graph_time = %s AND view_mode = %s",
                (graph_id, graph_time, view_mode),
            )
            deleted = cur.rowcount
            conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="layout not found")
    return {"status": "ok"}


@app.delete("/layouts/node")
def reset_layout_node(graph_id: str, graph_time: str, view_mode: str, node_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE layout_snapshots
                SET positions_json = COALESCE(positions_json, '{}'::jsonb) - %s,
                    revision = revision + 1,
                    updated_at = NOW()
                WHERE graph_id = %s AND graph_time = %s AND view_mode = %s
                RETURNING revision, updated_at
                """,
                (node_id, graph_id, graph_time, view_mode),
            )
            row = cur.fetchone()
            conn.commit()
    if not row:
        raise HTTPException(status_code=404, detail="layout not found")
    return {"status": "ok", "revision": row[0], "updated_at": row[1].isoformat()}
