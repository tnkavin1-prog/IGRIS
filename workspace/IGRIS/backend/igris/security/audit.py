"""Append-only JSONL audit log.

Every tool invocation, authorization decision, file mutation and process
launch is recorded with enough context to reconstruct what IGRIS did and why.
Records pass through the same redaction filter as the application log.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from ..core.logging_setup import get_logger, redaction_filter

log = get_logger("security.audit")
_fltr = redaction_filter()


class AuditLog:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def record(self, kind: str, **fields: Any) -> dict[str, Any]:
        entry = {"ts": time.time(), "kind": kind, **fields}
        line = json.dumps(entry, default=str, ensure_ascii=False)
        # reuse the log-redaction machinery without emitting a log record
        class _R:  # minimal LogRecord stand-in for the filter
            def __init__(self, msg: str) -> None:
                self.msg = msg
                self.args: tuple = ()
            def getMessage(self) -> str:  # noqa: N802
                return self.msg
        r = _R(line)
        _fltr.filter(r)  # type: ignore[arg-type]
        line = r.msg
        with self._lock:
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return entry

    def tail(self, n: int = 100, kind: str | None = None) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        out: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if kind and e.get("kind") != kind:
                    continue
                out.append(e)
        return out[-n:]

    def count(self) -> int:
        if not self.path.exists():
            return 0
        with self.path.open("rb") as fh:
            return sum(1 for _ in fh)

    def contains_secret(self, secret: str) -> bool:
        """Self-check used by the security test-suite."""
        if not self.path.exists() or not secret:
            return False
        return secret.encode() in self.path.read_bytes()


_audit: AuditLog | None = None


def get_audit() -> AuditLog:
    global _audit
    if _audit is None:
        raise RuntimeError("AuditLog not initialised")
    return _audit


def init_audit(path: Path) -> AuditLog:
    global _audit
    _audit = AuditLog(path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return _audit
