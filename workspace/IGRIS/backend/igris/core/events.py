"""Event bus.

Single source of truth for everything the UI is allowed to observe. Tools,
the executor, the supervisor and integrations publish typed events; the
WebSocket route and the audit log subscribe. The bus is thread-safe so
blocking tools running in a worker thread can publish directly.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

_seq = itertools.count(1)


@dataclass(slots=True)
class Event:
    type: str
    data: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)
    id: int = field(default_factory=lambda: next(_seq))
    channel: str = "system"
    task_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "type": self.type, "channel": self.channel,
            "task_id": self.task_id, "ts": self.ts, "data": self.data,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), default=str)


class EventType:
    # lifecycle
    APP_READY = "app.ready"
    BACKEND_STATUS = "backend.status"
    # provider
    PROVIDER_STATUS = "provider.status"
    PROVIDER_MODEL_LIST = "provider.models"
    # conversation / voice
    VOICE_STATE = "voice.state"
    TRANSCRIPT_PARTIAL = "voice.transcript.partial"
    TRANSCRIPT_FINAL = "voice.transcript.final"
    ASSISTANT_MESSAGE = "assistant.message"
    ASSISTANT_CHUNK = "assistant.chunk"
    # task engine
    TASK_CREATED = "task.created"
    TASK_STATE = "task.state"
    TASK_PROGRESS = "task.progress"
    STAGE_ADDED = "task.stage.added"
    STAGE_STATE = "task.stage.state"
    STEP_STARTED = "task.step.started"
    STEP_FINISHED = "task.step.finished"
    TOOL_CALL = "tool.call"
    TOOL_RESULT = "tool.result"
    VERIFICATION = "task.verification"
    REPLAN = "task.replan"
    ERROR = "task.error"
    DELIVERABLE = "task.deliverable"
    # authorization
    AUTH_REQUEST = "auth.request"
    AUTH_RESULT = "auth.result"
    # system
    LOG = "log"


Listener = Callable[[Event], Awaitable[None] | None]


class EventBus:
    """Fan-out pub/sub with a bounded replay buffer for late subscribers."""

    def __init__(self, history: int = 500) -> None:
        self._listeners: list[tuple[str | None, Listener]] = []
        self._history: deque[Event] = deque(maxlen=history)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, listener: Listener, prefix: str | None = None) -> Callable[[], None]:
        self._listeners.append((prefix, listener))

        def unsubscribe() -> None:
            for i, (p, l) in enumerate(self._listeners):
                if p == prefix and l is listener:
                    self._listeners.pop(i)
                    break
        return unsubscribe

    def history(self, since_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        items = [e.to_dict() for e in self._history if e.id > since_id]
        return items[-limit:]

    def publish(self, type_: str, data: dict[str, Any] | None = None, *,
                channel: str = "system", task_id: str | None = None) -> Event:
        ev = Event(type=type_, data=data or {}, channel=channel, task_id=task_id)
        self._history.append(ev)
        for prefix, listener in list(self._listeners):
            if prefix and not ev.type.startswith(prefix):
                continue
            try:
                res = listener(ev)
                if asyncio.iscoroutine(res):
                    loop = self._loop
                    if loop is not None and not loop.is_closed():
                        asyncio.run_coroutine_threadsafe(res, loop)
                    else:
                        asyncio.get_event_loop().create_task(res)  # pragma: no cover
            except Exception:  # a broken listener must never break a tool
                pass
        return ev


_bus: EventBus | None = None


def get_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus


def set_bus(bus: EventBus) -> None:
    global _bus
    _bus = bus
