"""Runtime path resolution.

All mutable state (database, checkpoints, logs, generated projects, sandbox)
lives under a single data root so the application can be relocated, backed up
or pointed at a temporary directory during tests.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "IGRIS"


def _default_data_root() -> Path:
    override = os.environ.get("IGRIS_HOME")
    if override:
        return Path(override).expanduser()
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / APP_NAME
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / APP_NAME.lower()


class RuntimePaths:
    """Resolves and creates the runtime directory tree."""

    def __init__(self, data_root: Path | str | None = None) -> None:
        self.data_root = Path(data_root) if data_root else _default_data_root()
        self.database_dir = self.data_root / "database"
        self.checkpoints_dir = self.data_root / "checkpoints"
        self.logs_dir = self.data_root / "logs"
        self.projects_dir = self.data_root / "projects"
        self.sandbox_dir = self.data_root / "sandbox"
        self.downloads_dir = self.data_root / "downloads"
        self.captures_dir = self.data_root / "captures"
        self.cache_dir = self.data_root / "cache"
        self.db_file = self.database_dir / "igris.sqlite3"
        self.audit_file = self.logs_dir / "audit.jsonl"
        self.log_file = self.logs_dir / "igris.log"

    def ensure(self) -> "RuntimePaths":
        for d in (
            self.data_root, self.database_dir, self.checkpoints_dir, self.logs_dir,
            self.projects_dir, self.sandbox_dir, self.downloads_dir, self.captures_dir,
            self.cache_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)
        return self

    def project_dir(self, project_id: str) -> Path:
        p = self.projects_dir / project_id
        p.mkdir(parents=True, exist_ok=True)
        return p

    def as_dict(self) -> dict[str, str]:
        return {k: str(v) for k, v in self.__dict__.items() if isinstance(v, Path)}


_default: RuntimePaths | None = None


def get_paths() -> RuntimePaths:
    global _default
    if _default is None:
        _default = RuntimePaths().ensure()
    return _default


def set_paths(paths: RuntimePaths) -> None:
    global _default
    _default = paths.ensure()
