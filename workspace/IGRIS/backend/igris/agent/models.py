"""Domain model for the autonomous execution engine."""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}" if prefix else uuid.uuid4().hex[:12]


class TaskState(str, Enum):
    """OBSERVE -> UNDERSTAND -> PLAN -> EXECUTE -> VERIFY -> REPLAN -> COMPLETE"""
    PENDING = "PENDING"
    OBSERVING = "OBSERVING"
    UNDERSTANDING = "UNDERSTANDING"
    PLANNING = "PLANNING"
    EXECUTING = "EXECUTING"
    VERIFYING = "VERIFYING"
    REPLANNING = "REPLANNING"
    IN_PROGRESS = "IN_PROGRESS"
    AWAITING_AUTHORIZATION = "AWAITING_AUTHORIZATION"
    BLOCKED = "BLOCKED"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

    @property
    def terminal(self) -> bool:
        return self in {TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED}

    @property
    def active(self) -> bool:
        return self in {TaskState.OBSERVING, TaskState.UNDERSTANDING, TaskState.PLANNING,
                        TaskState.EXECUTING, TaskState.VERIFYING, TaskState.REPLANNING,
                        TaskState.IN_PROGRESS}


class StageState(str, Enum):
    PENDING = "PENDING"
    READY = "READY"
    RUNNING = "RUNNING"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    SKIPPED = "SKIPPED"

    @property
    def terminal(self) -> bool:
        return self in {StageState.COMPLETED, StageState.FAILED,
                        StageState.BLOCKED, StageState.SKIPPED}


class Expectation(BaseModel):
    """A concrete, machine-checkable statement about what success looks like."""
    kind: Literal["file_exists", "file_min_size", "file_contains", "dir_exists",
                  "json_field", "process_exit_code", "image_valid", "video_valid",
                  "audio_valid", "blend_object_exists", "http_status",
                  "output_matches", "nonempty", "custom"] = "file_exists"
    target: str = ""
    expected: Any = None
    description: str = ""

    def describe(self) -> str:
        return self.description or f"{self.kind}({self.target}{'=' + str(self.expected) if self.expected is not None else ''})"


class Stage(BaseModel):
    id: str = Field(default_factory=lambda: new_id("stg_"))
    task_id: str = ""
    idx: int = 0
    title: str = ""
    description: str = ""
    state: StageState = StageState.PENDING
    tool_hint: str | None = None
    depends_on: list[str] = Field(default_factory=list)
    expectations: list[Expectation] = Field(default_factory=list)
    attempts: int = 0
    max_attempts: int = 3
    result: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    @property
    def ready(self) -> bool:
        return self.state in {StageState.PENDING, StageState.READY, StageState.FAILED}


class Intent(BaseModel):
    """Output of the intent-understanding engine."""
    raw: str = ""
    goal: str = ""
    category: str = "general"        # research | creation | automation | analysis | system
    desired_output: str = ""
    deliverables: list[str] = Field(default_factory=list)
    required_apps: list[str] = Field(default_factory=list)
    required_resources: list[str] = Field(default_factory=list)
    files_to_inspect: list[str] = Field(default_factory=list)
    needs_research: bool = False
    needs_download: bool = False
    needs_desktop_control: bool = False
    verification_strategy: str = ""
    expectations: list[Expectation] = Field(default_factory=list)
    ambiguities: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    estimated_complexity: Literal["trivial", "simple", "moderate", "complex", "long_running"] = "simple"
    confidence: float = 0.0


class Task(BaseModel):
    id: str = Field(default_factory=lambda: new_id("task_"))
    objective: str = ""
    state: TaskState = TaskState.PENDING
    project_id: str | None = None
    priority: int = 0
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    progress: float = 0.0
    intent: Intent = Field(default_factory=Intent)
    stages: list[Stage] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    checkpoint: dict[str, Any] = Field(default_factory=dict)
    error: dict[str, Any] | None = None
    result: dict[str, Any] = Field(default_factory=dict)

    # ------------------------------------------------------------- views
    def stage(self, stage_id: str) -> Stage | None:
        return next((s for s in self.stages if s.id == stage_id), None)

    def completed_stages(self) -> list[Stage]:
        return [s for s in self.stages if s.state is StageState.COMPLETED]

    def pending_stages(self) -> list[Stage]:
        return [s for s in self.stages if not s.state.terminal]

    def current_stage(self) -> Stage | None:
        return next((s for s in self.stages if s.state is StageState.RUNNING), None) \
            or next((s for s in self.stages if not s.state.terminal), None)

    def ready_stages(self) -> list[Stage]:
        done = {s.id for s in self.stages if s.state is StageState.COMPLETED
                or s.state is StageState.SKIPPED}
        out = []
        for s in self.stages:
            if not s.ready or s.attempts >= s.max_attempts:
                continue
            if all(d in done for d in s.depends_on):
                out.append(s)
        return sorted(out, key=lambda s: s.idx)

    def recompute_progress(self) -> float:
        if not self.stages:
            return 0.0
        weights = {StageState.COMPLETED: 1.0, StageState.SKIPPED: 1.0,
                   StageState.RUNNING: 0.4, StageState.VERIFYING: 0.8,
                   StageState.FAILED: 0.0, StageState.BLOCKED: 0.0,
                   StageState.PENDING: 0.0, StageState.READY: 0.0}
        total = sum(weights.get(s.state, 0.0) for s in self.stages)
        self.progress = round(total / len(self.stages), 4)
        return self.progress

    def deliverables(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for s in self.stages:
            out.extend(s.artifacts)
        return out

    def to_public(self) -> dict[str, Any]:
        return {
            "id": self.id, "objective": self.objective, "state": self.state.value,
            "project_id": self.project_id, "progress": self.progress,
            "created_at": self.created_at, "updated_at": self.updated_at,
            "started_at": self.started_at, "finished_at": self.finished_at,
            "intent": self.intent.model_dump(),
            "stages": [s.model_dump() for s in self.stages],
            "error": self.error, "result": self.result,
            "deliverables": self.deliverables(),
            "checkpoint": self.checkpoint,
            "context_keys": sorted(self.context.keys()),
        }

    def summary_line(self) -> str:
        cur = self.current_stage()
        return (f"[{self.state.value}] {self.objective[:70]} — "
                f"{len(self.completed_stages())}/{len(self.stages)} stages"
                + (f", current: {cur.title}" if cur else ""))
