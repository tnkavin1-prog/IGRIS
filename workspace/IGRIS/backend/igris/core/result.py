"""ToolResult and Verification — the backbone of "never claim completion".

A tool call is *not* a success because it returned; it is a success because its
declared expectations were checked against observed reality.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Status(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"
    BLOCKED = "blocked"
    SKIPPED = "skipped"

    @property
    def ok(self) -> bool:
        return self is Status.SUCCESS


class VerifyStatus(str, Enum):
    NOT_REQUIRED = "not_required"
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"
    BLOCKED = "blocked"


@dataclass(slots=True)
class VerificationCheck:
    """One concrete expectation and what was actually observed."""
    name: str
    expected: Any
    actual: Any
    passed: bool
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "expected": self.expected, "actual": self.actual,
                "passed": self.passed, "detail": self.detail}


@dataclass(slots=True)
class Verification:
    status: VerifyStatus = VerifyStatus.NOT_REQUIRED
    checks: list[VerificationCheck] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        if self.status is VerifyStatus.NOT_REQUIRED:
            return True
        return self.status is VerifyStatus.PASSED

    def add(self, check: VerificationCheck) -> "Verification":
        self.checks.append(check)
        self.recompute()
        return self

    def recompute(self) -> None:
        if not self.checks:
            return
        self.status = VerifyStatus.PASSED if all(c.passed for c in self.checks) else VerifyStatus.FAILED

    def to_dict(self) -> dict[str, Any]:
        return {"status": self.status.value,
                "passed": self.passed,
                "checks": [c.to_dict() for c in self.checks]}


@dataclass(slots=True)
class Artifact:
    """A concrete file/deliverable produced by a tool."""
    path: str
    kind: str = "file"           # file | image | video | audio | project | report
    label: str = ""
    size_bytes: int = 0
    sha256: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"path": self.path, "kind": self.kind, "label": self.label,
                "size_bytes": self.size_bytes, "sha256": self.sha256, "meta": self.meta}


@dataclass(slots=True)
class ToolResult:
    status: Status
    summary: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    artifacts: list[Artifact] = field(default_factory=list)
    verification: Verification = field(default_factory=Verification)
    error: dict[str, Any] | None = None
    retryable: bool = False
    duration_ms: float = 0.0
    tool: str = ""
    started_at: float = field(default_factory=time.time)
    #: machine-readable hints the planner can use to recover
    hints: list[str] = field(default_factory=list)

    # ---- constructors -------------------------------------------------
    @classmethod
    def ok(cls, summary: str = "", **data: Any) -> "ToolResult":
        return cls(status=Status.SUCCESS, summary=summary, data=data)

    @classmethod
    def fail(cls, summary: str, *, code: str = "TOOL_FAILED", retryable: bool = False,
             **details: Any) -> "ToolResult":
        return cls(status=Status.FAILED, summary=summary, retryable=retryable,
                   error={"code": code, "details": details})

    @classmethod
    def blocked(cls, summary: str, *, code: str = "BLOCKED", **details: Any) -> "ToolResult":
        return cls(status=Status.BLOCKED, summary=summary, error={"code": code, "details": details})

    @classmethod
    def partial(cls, summary: str, **data: Any) -> "ToolResult":
        return cls(status=Status.PARTIAL, summary=summary, data=data)

    # ---- helpers ------------------------------------------------------
    def with_artifact(self, artifact: Artifact) -> "ToolResult":
        self.artifacts.append(artifact)
        return self

    def to_dict(self, *, truncate: int = 4000) -> dict[str, Any]:
        def clip(v: Any) -> Any:
            if isinstance(v, str) and len(v) > truncate:
                return v[:truncate] + f"…[+{len(v) - truncate} chars]"
            return v

        data = {k: clip(v) for k, v in self.data.items()}
        return {
            "status": self.status.value,
            "ok": self.status.ok,
            "summary": clip(self.summary),
            "data": data,
            "artifacts": [a.to_dict() for a in self.artifacts],
            "verification": self.verification.to_dict(),
            "error": self.error,
            "retryable": self.retryable,
            "duration_ms": round(self.duration_ms, 2),
            "tool": self.tool,
            "hints": self.hints,
        }

    def compact_for_model(self, *, max_chars: int = 2200) -> str:
        """Compact JSON view fed back to Gemini as a function response."""
        import json
        d = self.to_dict(truncate=max_chars)
        d.pop("duration_ms", None)
        s = json.dumps(d, default=str, ensure_ascii=False)
        if len(s) > max_chars:
            s = s[:max_chars] + "…}"
        return s
