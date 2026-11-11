"""Logging with API-key redaction.

A hard requirement: the Gemini API key must never appear in logs, events or
screenshots. A redaction filter is installed on every handler so even an
accidental ``logger.info(cfg)`` cannot leak it.
"""
from __future__ import annotations

import logging
import logging.handlers
import re
import sys
from pathlib import Path
from typing import Iterable

from .events import EventBus, EventType, get_bus
from .paths import RuntimePaths, get_paths

_KEY_PATTERNS = [
    re.compile(r"\bAIza[0-9A-Za-z_\-]{10,}\b"),          # Google API key shape
    re.compile(r"(?i)\b(api[_-]?key|apikey|token|secret|password)\b\s*[:=]\s*['\"]?([A-Za-z0-9_\-]{12,})['\"]?"),
]
_REDACTED = "[REDACTED]"


class RedactionFilter(logging.Filter):
    def __init__(self, extra_secrets: Iterable[str] = ()) -> None:
        super().__init__()
        self._extra = {s for s in extra_secrets if s and len(s) >= 6}

    def add_secret(self, secret: str) -> None:
        if secret and len(secret) >= 6:
            self._extra.add(secret)

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        out = msg
        for pat in _KEY_PATTERNS:
            out = pat.sub(_REDACTED, out)
        for s in self._extra:
            out = out.replace(s, _REDACTED)
        if out != msg:
            record.msg = out
            record.args = ()
        return True


class EventLogHandler(logging.Handler):
    """Mirrors WARNING+ records onto the event bus for the UI activity log."""

    def __init__(self, bus: EventBus, level: int = logging.INFO) -> None:
        super().__init__(level)
        self._bus = bus

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self._bus.publish(EventType.LOG, {
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            })
        except Exception:
            pass


_filter = RedactionFilter()


def redaction_filter() -> RedactionFilter:
    return _filter


def register_secret(secret: str) -> None:
    _filter.add_secret(secret)


def setup_logging(paths: RuntimePaths | None = None, *, level: int = logging.INFO,
                  console: bool = True) -> logging.Logger:
    paths = paths or get_paths()
    paths.logs_dir.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger("igris")
    root.setLevel(level)
    root.propagate = False
    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)-28s %(message)s")

    fh = logging.handlers.RotatingFileHandler(
        paths.log_file, maxBytes=5_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    fh.addFilter(_filter)
    root.addHandler(fh)

    if console:
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        sh.addFilter(_filter)
        root.addHandler(sh)

    eh = EventLogHandler(get_bus(), level=logging.WARNING)
    eh.setFormatter(logging.Formatter("%(name)s: %(message)s"))
    eh.addFilter(_filter)
    root.addHandler(eh)

    root.debug("logging initialised at %s", paths.log_file)
    return root


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"igris.{name}")
