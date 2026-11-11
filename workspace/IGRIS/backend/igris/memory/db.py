"""SQLite persistence: settings, tasks, stages, steps, artifacts, memory.

Schema is versioned and migrated in place so an existing installation upgrades
without data loss. Writes use WAL mode — a crash mid-task must not corrupt the
checkpoint that lets IGRIS resume.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Iterable

import aiosqlite

from ..core.logging_setup import get_logger

log = get_logger("memory.db")

SCHEMA_VERSION = 4

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    root_dir    TEXT NOT NULL,
    created_at  REAL NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tasks (
    id            TEXT PRIMARY KEY,
    objective     TEXT NOT NULL,
    state         TEXT NOT NULL DEFAULT 'PENDING',
    project_id    TEXT,
    priority      INTEGER NOT NULL DEFAULT 0,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL,
    started_at    REAL,
    finished_at   REAL,
    progress      REAL NOT NULL DEFAULT 0,
    context       TEXT NOT NULL DEFAULT '{}',
    checkpoint    TEXT NOT NULL DEFAULT '{}',
    intent        TEXT NOT NULL DEFAULT '{}',
    error         TEXT,
    result        TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);

CREATE TABLE IF NOT EXISTS task_stages (
    id            TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL,
    idx           INTEGER NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    state         TEXT NOT NULL DEFAULT 'PENDING',
    tool_hint     TEXT,
    depends_on    TEXT NOT NULL DEFAULT '[]',
    expectations  TEXT NOT NULL DEFAULT '[]',
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL,
    result        TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stages_task ON task_stages(task_id, idx);

CREATE TABLE IF NOT EXISTS task_steps (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    stage_id    TEXT,
    seq         INTEGER NOT NULL,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'RUNNING',
    summary     TEXT NOT NULL DEFAULT '',
    result      TEXT NOT NULL DEFAULT '{}',
    started_at  REAL NOT NULL,
    finished_at REAL,
    duration_ms REAL,
    attempt     INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_steps_task ON task_steps(task_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    stage_id    TEXT,
    path        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'file',
    label       TEXT NOT NULL DEFAULT '',
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    sha256      TEXT NOT NULL DEFAULT '',
    meta        TEXT NOT NULL DEFAULT '{}',
    created_at  REAL NOT NULL,
    verified    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);

CREATE TABLE IF NOT EXISTS memories (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL,          -- user | project | execution
    key         TEXT NOT NULL,
    value       TEXT NOT NULL DEFAULT '{}',
    tags        TEXT NOT NULL DEFAULT '[]',
    project_id  TEXT,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_scope_key ON memories(scope, key, project_id);

CREATE TABLE IF NOT EXISTS conversation (
    id          TEXT PRIMARY KEY,
    task_id     TEXT,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  REAL NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_conversation_created ON conversation(created_at DESC);

CREATE TABLE IF NOT EXISTS auth_grants (
    key         TEXT PRIMARY KEY,
    permission  TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT '*',
    persistent  INTEGER NOT NULL DEFAULT 0,
    granted_at  REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------- lifecycle
    async def connect(self) -> "Database":
        self._conn = await aiosqlite.connect(self.path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(SCHEMA)
        await self._migrate()
        await self._conn.commit()
        log.info("database ready at %s (schema v%s)", self.path, SCHEMA_VERSION)
        return self

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def _migrate(self) -> None:
        assert self._conn is not None
        cur = await self._conn.execute(
            "SELECT value FROM schema_meta WHERE key='version'")
        row = await cur.fetchone()
        current = int(row[0]) if row else 0
        if current < SCHEMA_VERSION:
            log.info("migrating schema %s -> %s", current, SCHEMA_VERSION)
            await self._conn.execute(
                "INSERT INTO schema_meta(key,value) VALUES('version',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(SCHEMA_VERSION),))
            await self._conn.commit()

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("database not connected")
        return self._conn

    # --------------------------------------------------------- helpers
    async def execute(self, sql: str, params: Iterable[Any] = ()) -> aiosqlite.Cursor:
        async with self._lock:
            cur = await self.conn.execute(sql, tuple(params))
            await self.conn.commit()
            return cur

    async def query(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        cur = await self.conn.execute(sql, tuple(params))
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def query_one(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        rows = await self.query(sql, params)
        return rows[0] if rows else None

    # --------------------------------------------------------- settings
    async def get_setting(self, key: str, default: Any = None) -> Any:
        row = await self.query_one("SELECT value FROM settings WHERE key=?", (key,))
        if row is None:
            return default
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return row["value"]

    async def set_setting(self, key: str, value: Any) -> None:
        await self.execute(
            "INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, json.dumps(value), time.time()))

    async def all_settings(self) -> dict[str, Any]:
        rows = await self.query("SELECT key,value FROM settings")
        out: dict[str, Any] = {}
        for r in rows:
            try:
                out[r["key"]] = json.loads(r["value"])
            except json.JSONDecodeError:
                out[r["key"]] = r["value"]
        return out

    async def delete_setting(self, key: str) -> None:
        await self.execute("DELETE FROM settings WHERE key=?", (key,))

    async def stats(self) -> dict[str, Any]:
        out: dict[str, Any] = {"path": str(self.path), "size_bytes": self.path.stat().st_size}
        for table in ("tasks", "task_stages", "task_steps", "artifacts", "memories",
                      "conversation", "settings"):
            row = await self.query_one(f"SELECT COUNT(*) AS c FROM {table}")
            out[table] = row["c"] if row else 0
        out["schema_version"] = SCHEMA_VERSION
        return out


_db: Database | None = None


def get_db() -> Database:
    if _db is None:
        raise RuntimeError("database not initialised")
    return _db


def set_db(db: Database) -> None:
    global _db
    _db = db
