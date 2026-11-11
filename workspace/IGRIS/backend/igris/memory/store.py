"""Repositories over the SQLite database."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from ..agent.models import Expectation, Intent, Stage, StageState, Task, TaskState, new_id
from ..core.logging_setup import get_logger
from .db import Database, get_db

log = get_logger("memory.store")


def _dumps(v: Any) -> str:
    return json.dumps(v, default=str, ensure_ascii=False)


def _loads(s: str | None, default: Any) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return default


class TaskStore:
    def __init__(self, db: Database | None = None) -> None:
        self.db = db or get_db()

    # ------------------------------------------------------------- tasks
    async def create(self, task: Task) -> Task:
        now = time.time()
        task.updated_at = now
        await self.db.execute(
            """INSERT INTO tasks(id,objective,state,project_id,priority,created_at,updated_at,
                                 progress,context,checkpoint,intent,result)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (task.id, task.objective, task.state.value, task.project_id, task.priority,
             task.created_at, now, task.progress, _dumps(task.context),
             _dumps(task.checkpoint), _dumps(task.intent.model_dump()), _dumps(task.result)))
        log.info("task created %s: %s", task.id, task.objective[:80])
        return task

    async def save(self, task: Task) -> None:
        task.updated_at = time.time()
        await self.db.execute(
            """UPDATE tasks SET objective=?, state=?, project_id=?, priority=?, updated_at=?,
                   started_at=?, finished_at=?, progress=?, context=?, checkpoint=?,
                   intent=?, error=?, result=? WHERE id=?""",
            (task.objective, task.state.value, task.project_id, task.priority, task.updated_at,
             task.started_at, task.finished_at, task.progress, _dumps(task.context),
             _dumps(task.checkpoint), _dumps(task.intent.model_dump()),
             _dumps(task.error) if task.error else None, _dumps(task.result), task.id))
        # stages are rewritten wholesale: cheap, and guarantees consistency
        await self.db.execute("DELETE FROM task_stages WHERE task_id=?", (task.id,))
        for s in task.stages:
            s.task_id = task.id
            s.updated_at = time.time()
            await self.db.execute(
                """INSERT INTO task_stages(id,task_id,idx,title,description,state,tool_hint,
                        depends_on,expectations,attempts,created_at,updated_at,result)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (s.id, task.id, s.idx, s.title, s.description, s.state.value, s.tool_hint,
                 _dumps(s.depends_on), _dumps([e.model_dump() for e in s.expectations]),
                 s.attempts, s.created_at, s.updated_at,
                 _dumps({**s.result, "artifacts": [a for a in s.artifacts]})))

    async def get(self, task_id: str) -> Task | None:
        row = await self.db.query_one("SELECT * FROM tasks WHERE id=?", (task_id,))
        if not row:
            return None
        return await self._hydrate(row)

    async def _hydrate(self, row: dict[str, Any]) -> Task:
        task = Task(
            id=row["id"], objective=row["objective"], state=TaskState(row["state"]),
            project_id=row["project_id"], priority=row["priority"],
            created_at=row["created_at"], updated_at=row["updated_at"],
            started_at=row["started_at"], finished_at=row["finished_at"],
            progress=row["progress"], context=_loads(row["context"], {}),
            checkpoint=_loads(row["checkpoint"], {}),
            intent=Intent(**_loads(row["intent"], {})),
            error=_loads(row["error"], None), result=_loads(row["result"], {}))
        stages = await self.db.query(
            "SELECT * FROM task_stages WHERE task_id=? ORDER BY idx", (task.id,))
        for sr in stages:
            res = _loads(sr["result"], {})
            arts = res.pop("artifacts", [])
            task.stages.append(Stage(
                id=sr["id"], task_id=sr["task_id"], idx=sr["idx"], title=sr["title"],
                description=sr["description"], state=StageState(sr["state"]),
                tool_hint=sr["tool_hint"], depends_on=_loads(sr["depends_on"], []),
                expectations=[Expectation(**e) for e in _loads(sr["expectations"], [])],
                attempts=sr["attempts"], created_at=sr["created_at"],
                updated_at=sr["updated_at"], result=res, artifacts=arts))
        return task

    async def list(self, *, state: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        if state:
            rows = await self.db.query(
                "SELECT id,objective,state,progress,created_at,updated_at,finished_at,error "
                "FROM tasks WHERE state=? ORDER BY updated_at DESC LIMIT ?", (state, limit))
        else:
            rows = await self.db.query(
                "SELECT id,objective,state,progress,created_at,updated_at,finished_at,error "
                "FROM tasks ORDER BY updated_at DESC LIMIT ?", (limit,))
        for r in rows:
            r["error"] = _loads(r["error"], None)
        return rows

    async def resumable(self) -> list[Task]:
        """Tasks interrupted mid-flight — the resume system starts here."""
        rows = await self.db.query(
            "SELECT * FROM tasks WHERE state IN (?,?,?,?,?,?,?) ORDER BY updated_at",
            (TaskState.PENDING.value, TaskState.OBSERVING.value, TaskState.UNDERSTANDING.value,
             TaskState.PLANNING.value, TaskState.EXECUTING.value, TaskState.VERIFYING.value,
             TaskState.IN_PROGRESS.value))
        return [await self._hydrate(r) for r in rows]

    async def delete(self, task_id: str) -> None:
        await self.db.execute("DELETE FROM tasks WHERE id=?", (task_id,))

    # -------------------------------------------------------------- steps
    async def log_step(self, *, task_id: str, stage_id: str | None, seq: int, tool: str,
                       args: dict[str, Any], attempt: int = 1) -> str:
        sid = new_id("step_")
        await self.db.execute(
            """INSERT INTO task_steps(id,task_id,stage_id,seq,tool,args,status,started_at,attempt)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (sid, task_id, stage_id, seq, tool, _dumps(args), "RUNNING", time.time(), attempt))
        return sid

    async def finish_step(self, step_id: str, *, status: str, summary: str,
                          result: dict[str, Any], duration_ms: float) -> None:
        await self.db.execute(
            """UPDATE task_steps SET status=?, summary=?, result=?, finished_at=?, duration_ms=?
               WHERE id=?""",
            (status, summary, _dumps(result), time.time(), duration_ms, step_id))

    async def steps(self, task_id: str, limit: int = 200) -> list[dict[str, Any]]:
        rows = await self.db.query(
            "SELECT * FROM task_steps WHERE task_id=? ORDER BY seq DESC LIMIT ?", (task_id, limit))
        for r in rows:
            r["args"] = _loads(r["args"], {})
            r["result"] = _loads(r["result"], {})
        return rows[::-1]

    # ---------------------------------------------------------- artifacts
    async def add_artifact(self, *, task_id: str, stage_id: str | None, path: str, kind: str,
                           label: str, size_bytes: int, sha256: str,
                           meta: dict[str, Any] | None = None, verified: bool = False) -> str:
        aid = new_id("art_")
        await self.db.execute(
            """INSERT INTO artifacts(id,task_id,stage_id,path,kind,label,size_bytes,sha256,meta,
                                     created_at,verified)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, task_id, stage_id, path, kind, label, size_bytes, sha256,
             _dumps(meta or {}), time.time(), int(verified)))
        return aid

    async def artifacts(self, task_id: str) -> list[dict[str, Any]]:
        rows = await self.db.query(
            "SELECT * FROM artifacts WHERE task_id=? ORDER BY created_at", (task_id,))
        for r in rows:
            r["meta"] = _loads(r["meta"], {})
            r["verified"] = bool(r["verified"])
        return rows

    # ------------------------------------------------------------ memories
    async def remember(self, scope: str, key: str, value: Any, *, tags: list[str] | None = None,
                       project_id: str | None = None) -> None:
        now = time.time()
        await self.db.execute(
            """INSERT INTO memories(id,scope,key,value,tags,project_id,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?)
               ON CONFLICT(scope,key,project_id) DO UPDATE SET
                 value=excluded.value, tags=excluded.tags, updated_at=excluded.updated_at""",
            (new_id("mem_"), scope, key, _dumps(value), _dumps(tags or []), project_id, now, now))

    async def recall(self, scope: str, key: str, default: Any = None,
                     project_id: str | None = None) -> Any:
        row = await self.db.query_one(
            "SELECT value FROM memories WHERE scope=? AND key=? AND "
            "(project_id IS ? OR project_id=?)", (scope, key, project_id, project_id))
        return _loads(row["value"], default) if row else default

    async def search_memory(self, scope: str | None = None, tag: str | None = None,
                            limit: int = 50) -> list[dict[str, Any]]:
        sql = "SELECT * FROM memories WHERE 1=1"
        params: list[Any] = []
        if scope:
            sql += " AND scope=?"; params.append(scope)
        if tag:
            sql += " AND tags LIKE ?"; params.append(f'%"{tag}"%')
        sql += " ORDER BY updated_at DESC LIMIT ?"; params.append(limit)
        rows = await self.db.query(sql, params)
        for r in rows:
            r["value"] = _loads(r["value"], None)
            r["tags"] = _loads(r["tags"], [])
        return rows

    async def forget(self, scope: str | None = None) -> int:
        if scope:
            cur = await self.db.execute("DELETE FROM memories WHERE scope=?", (scope,))
        else:
            cur = await self.db.execute("DELETE FROM memories")
        return cur.rowcount or 0

    # -------------------------------------------------------- conversation
    async def add_message(self, role: str, content: str, *, task_id: str | None = None,
                          meta: dict[str, Any] | None = None) -> str:
        mid = new_id("msg_")
        await self.db.execute(
            "INSERT INTO conversation(id,task_id,role,content,created_at,meta) VALUES(?,?,?,?,?,?)",
            (mid, task_id, role, content, time.time(), _dumps(meta or {})))
        return mid

    async def conversation(self, limit: int = 40, task_id: str | None = None) -> list[dict[str, Any]]:
        if task_id:
            rows = await self.db.query(
                "SELECT * FROM conversation WHERE task_id=? ORDER BY created_at DESC LIMIT ?",
                (task_id, limit))
        else:
            rows = await self.db.query(
                "SELECT * FROM conversation ORDER BY created_at DESC LIMIT ?", (limit,))
        for r in rows:
            r["meta"] = _loads(r["meta"], {})
        return rows[::-1]

    async def clear_conversation(self) -> None:
        await self.db.execute("DELETE FROM conversation")

    # ------------------------------------------------------------ projects
    async def create_project(self, name: str, root_dir: str | Path,
                             meta: dict[str, Any] | None = None) -> str:
        pid = new_id("prj_")
        await self.db.execute(
            "INSERT INTO projects(id,name,root_dir,created_at,meta) VALUES(?,?,?,?,?)",
            (pid, name, str(root_dir), time.time(), _dumps(meta or {})))
        return pid

    async def projects(self) -> list[dict[str, Any]]:
        rows = await self.db.query("SELECT * FROM projects ORDER BY created_at DESC")
        for r in rows:
            r["meta"] = _loads(r["meta"], {})
        return rows

    # -------------------------------------------------------------- grants
    async def save_grants(self, grants: list[dict[str, Any]]) -> None:
        await self.db.execute("DELETE FROM auth_grants WHERE persistent=1")
        for g in grants:
            if not g.get("persistent"):
                continue
            await self.db.execute(
                "INSERT OR REPLACE INTO auth_grants(key,permission,scope,persistent,granted_at) "
                "VALUES(?,?,?,?,?)",
                (f"{g['permission']}:{g.get('scope', '*')}", g["permission"],
                 g.get("scope", "*"), 1, g.get("granted_at", time.time())))

    async def load_grants(self) -> list[dict[str, Any]]:
        return await self.db.query("SELECT * FROM auth_grants WHERE persistent=1")


class Store:
    """Facade exposed to the rest of the backend.

    ``Store.tasks`` is the task/stage/step repository; the convenience methods
    below delegate to it so callers have a single entry point.
    """

    def __init__(self, db: Database | None = None) -> None:
        self.tasks = TaskStore(db)
        self.db = db or get_db()

    # settings -----------------------------------------------------------
    async def settings_get(self, key: str, default: Any = None) -> Any:
        return await self.db.get_setting(key, default)

    async def settings_set(self, key: str, value: Any) -> None:
        await self.db.set_setting(key, value)

    async def settings_all(self) -> dict[str, Any]:
        return await self.db.all_settings()

    async def settings_delete(self, key: str) -> None:
        await self.db.delete_setting(key)

    # memory -------------------------------------------------------------
    async def remember(self, scope: str, key: str, value: Any, *, tags: list[str] | None = None,
                       project_id: str | None = None) -> None:
        await self.tasks.remember(scope, key, value, tags=tags, project_id=project_id)

    async def recall(self, scope: str, key: str, default: Any = None,
                     project_id: str | None = None) -> Any:
        return await self.tasks.recall(scope, key, default, project_id=project_id)

    async def search_memory(self, scope: str | None = None, tag: str | None = None,
                            limit: int = 50) -> list[dict[str, Any]]:
        return await self.tasks.search_memory(scope, tag, limit)

    async def forget(self, scope: str | None = None) -> int:
        return await self.tasks.forget(scope)

    # conversation -------------------------------------------------------
    async def add_message(self, role: str, content: str, *, task_id: str | None = None,
                          meta: dict[str, Any] | None = None) -> str:
        return await self.tasks.add_message(role, content, task_id=task_id, meta=meta)

    async def conversation(self, limit: int = 40, task_id: str | None = None) -> list[dict[str, Any]]:
        return await self.tasks.conversation(limit, task_id)

    async def clear_conversation(self) -> None:
        await self.tasks.clear_conversation()

    # projects -----------------------------------------------------------
    async def create_project(self, name: str, root_dir: str | Path,
                             meta: dict[str, Any] | None = None) -> str:
        return await self.tasks.create_project(name, root_dir, meta)

    async def projects(self) -> list[dict[str, Any]]:
        return await self.tasks.projects()
