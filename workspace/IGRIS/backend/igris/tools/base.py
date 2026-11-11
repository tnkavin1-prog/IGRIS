"""Tool framework.

Every capability IGRIS exposes to Gemini is a :class:`Tool` with:

* a machine-readable JSON-schema for its arguments (generated from a pydantic
  model, so validation and declaration can never drift apart),
* an explicit permission set and risk level consulted by the security policy,
* a declared timeout,
* a ``verify()`` hook that inspects *observed reality* after the action ran.

Gemini function names must match ``^[a-zA-Z0-9_-]{1,64}$``; IGRIS therefore uses
``domain_action`` naming (``fs_write_file``, ``app_launch``).
"""
from __future__ import annotations

import asyncio
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, ClassVar, Type

from pydantic import BaseModel, ValidationError as PydanticValidationError

from ..core.errors import ValidationError
from ..core.events import EventBus, EventType
from ..core.logging_setup import get_logger
from ..core.paths import RuntimePaths
from ..core.result import (Artifact, Status, ToolResult, Verification,
                                 VerificationCheck, VerifyStatus)
from ..security.audit import AuditLog
from ..security.command_guard import CommandGuard
from ..security.path_guard import PathGuard
from ..security.policy import AuthorizationManager, Permission, Risk

log = get_logger("tools")

_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


@dataclass(slots=True)
class ToolContext:
    """Everything a tool may need, injected by the executor."""
    paths: RuntimePaths
    path_guard: PathGuard
    command_guard: CommandGuard
    auth: AuthorizationManager
    audit: AuditLog
    bus: EventBus
    provider: Any = None                      # GeminiProvider
    store: Any = None                         # Store
    settings: dict[str, Any] = field(default_factory=dict)
    task_id: str | None = None
    stage_id: str | None = None
    project_dir: Any = None
    cancel_event: asyncio.Event | None = None
    #: free-form scratch the supervisor shares across stages of one task
    scratch: dict[str, Any] = field(default_factory=dict)

    @property
    def cancelled(self) -> bool:
        return bool(self.cancel_event and self.cancel_event.is_set())

    def emit(self, type_: str, **data: Any) -> None:
        self.bus.publish(type_, data, channel="task", task_id=self.task_id)


@dataclass(slots=True)
class ToolSpec:
    name: str
    description: str
    category: str
    permissions: list[Permission] = field(default_factory=list)
    risk: Risk = Risk.LOW
    timeout: float = 120.0
    #: permission that must be freshly authorized every single invocation
    confirm_permission: Permission | None = None
    readonly: bool = False
    platform: tuple[str, ...] = ("win32", "linux", "darwin")
    tags: list[str] = field(default_factory=list)
    #: human-facing description of how success is verified
    verification_hint: str = ""
    max_retries: int = 2

    def __post_init__(self) -> None:
        if not _NAME_RE.match(self.name):
            raise ValueError(
                f"tool name {self.name!r} is not Gemini-safe (^[a-zA-Z0-9_-]{{1,64}}$)")

    def declaration(self, parameters: dict[str, Any]) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": parameters}


class Tool(ABC):
    """Base class. Subclasses define ``Args`` (pydantic) and ``run``."""

    spec: ClassVar[ToolSpec]
    Args: ClassVar[Type[BaseModel]]

    def __init__(self) -> None:
        if not hasattr(self, "Args") or self.Args is None:
            raise TypeError(f"{type(self).__name__} must define an Args pydantic model")
        self._schema = self._clean_schema(self.Args.model_json_schema())

    @staticmethod
    def _clean_schema(schema: dict[str, Any]) -> dict[str, Any]:
        """Strip JSON-schema constructs Gemini's function-calling rejects."""
        schema = dict(schema)
        schema.pop("$defs", None)
        schema.pop("definitions", None)
        schema.pop("title", None)
        for key in ("additionalProperties",):
            schema.pop(key, None)
        props = schema.get("properties")
        if isinstance(props, dict):
            for name, spec in props.items():
                if isinstance(spec, dict):
                    spec.pop("title", None)
                    if "default" in spec:
                        spec.pop("default")
                    if spec.get("type") == "null" or spec.get("anyOf"):
                        # nullable -> keep the first non-null branch
                        branches = [b for b in spec.get("anyOf", []) if b.get("type") != "null"]
                        if branches:
                            merged = dict(branches[0])
                            merged["description"] = spec.get("description", merged.get("description", ""))
                            props[name] = merged
                    if "items" in spec and isinstance(spec["items"], dict):
                        spec["items"].pop("title", None)
        return schema

    @property
    def schema(self) -> dict[str, Any]:
        return self._schema

    def declaration(self) -> dict[str, Any]:
        return self.spec.declaration(self._schema)

    def validate(self, raw: dict[str, Any]) -> BaseModel:
        try:
            return self.Args.model_validate(raw or {})
        except PydanticValidationError as exc:
            raise ValidationError(
                f"invalid arguments for {self.spec.name}: {exc.error_count()} problem(s)",
                details={"errors": [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]}
                                    for e in exc.errors()][:12]}) from exc

    @abstractmethod
    async def run(self, args: BaseModel, ctx: ToolContext) -> ToolResult:
        """Perform the action. Must return a ToolResult, never raise for
        expected failures — raise only for programmer errors."""

    # ---- optional hooks -------------------------------------------------
    def verify(self, args: BaseModel, result: ToolResult, ctx: ToolContext) -> Verification:
        """Default: trust the declared status but require an explicit summary.

        Concrete tools override this with real inspection of the file system,
        process state or rendered output.
        """
        v = Verification()
        if result.status.ok:
            v.add(VerificationCheck("tool_reported_success", True, True, True,
                                    result.summary[:120]))
        else:
            v.status = VerifyStatus.FAILED
            v.add(VerificationCheck("tool_reported_success", True, False, False,
                                    result.summary[:120]))
        return v

    def is_available(self) -> tuple[bool, str]:
        """Platform/dependency availability probe used by the tool registry."""
        import sys
        if sys.platform not in self.spec.platform:
            return False, f"requires platform in {self.spec.platform}, running {sys.platform}"
        return True, "available"


class ToolRegistry:
    """Name -> Tool, with availability filtering and Gemini declaration export."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}
        self._unavailable: dict[str, str] = {}

    def register(self, tool: Tool) -> Tool:
        name = tool.spec.name
        if name in self._tools:
            raise ValueError(f"duplicate tool registration: {name}")
        ok, reason = tool.is_available()
        if ok:
            self._tools[name] = tool
        else:
            self._unavailable[name] = reason
            log.warning("tool %s unavailable: %s", name, reason)
        return tool

    def register_all(self, tools: list[Tool]) -> None:
        for t in tools:
            self.register(t)

    def get(self, name: str) -> Tool:
        from ..core.errors import ToolNotFound
        if name not in self._tools:
            raise ToolNotFound(f"unknown tool {name!r}",
                               details={"available": sorted(self._tools),
                                        "unavailable": self._unavailable})
        return self._tools[name]

    def has(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> list[str]:
        return sorted(self._tools)

    def all(self) -> list[Tool]:
        return [self._tools[n] for n in sorted(self._tools)]

    def by_category(self, category: str) -> list[Tool]:
        return [t for t in self.all() if t.spec.category == category]

    def declarations(self, *, names: list[str] | None = None,
                     platform: str | None = None) -> list[dict[str, Any]]:
        import sys
        plat = platform or sys.platform
        out = []
        for t in self.all():
            if names and t.spec.name not in names:
                continue
            if plat not in t.spec.platform:
                continue
            out.append(t.declaration())
        return out

    def describe(self) -> list[dict[str, Any]]:
        return [{"name": t.spec.name, "category": t.spec.category,
                 "description": t.spec.description,
                 "permissions": [p.value for p in t.spec.permissions],
                 "risk": t.spec.risk.value, "readonly": t.spec.readonly,
                 "timeout": t.spec.timeout, "platform": list(t.spec.platform),
                 "verification_hint": t.spec.verification_hint,
                 "tags": t.spec.tags,
                 "parameters": t.schema}
                for t in self.all()]

    def unavailable(self) -> dict[str, str]:
        return dict(self._unavailable)

    def manifest(self) -> dict[str, Any]:
        return {"available": len(self._tools), "unavailable": self._unavailable,
                "tools": self.describe()}


def ok(summary: str, **data: Any) -> ToolResult:
    return ToolResult.ok(summary, **data)


def fail(summary: str, *, code: str = "TOOL_FAILED", retryable: bool = False, **d: Any) -> ToolResult:
    return ToolResult.fail(summary, code=code, retryable=retryable, **d)


def blocked(summary: str, *, code: str = "BLOCKED", **d: Any) -> ToolResult:
    return ToolResult.blocked(summary, code=code, **d)


def artifact(path: Any, kind: str = "file", label: str = "", meta: dict | None = None) -> Artifact:
    import hashlib
    from pathlib import Path
    p = Path(path)
    size = p.stat().st_size if p.exists() else 0
    digest = ""
    try:
        if p.exists() and p.is_file() and size < 64 * 1024 * 1024:
            h = hashlib.sha256()
            with p.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            digest = h.hexdigest()
    except OSError:
        pass
    return Artifact(path=str(p), kind=kind, label=label or p.name, size_bytes=size,
                    sha256=digest, meta=meta or {})
