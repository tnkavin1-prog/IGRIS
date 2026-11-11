"""Permission model and interactive authorization.

Tools declare the permissions they need. Before a gated action runs, the
supervisor asks the ``AuthorizationManager``; if no grant exists it publishes
an ``auth.request`` event, the UI shows a dialog, and execution *blocks* until
the user decides (or the request times out and the action is refused).

Nothing here silently downgrades a refusal into a success.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..core.errors import AuthorizationRequired
from ..core.events import EventType, get_bus
from ..core.logging_setup import get_logger

log = get_logger("security.policy")


class Permission(str, Enum):
    FS_READ = "fs.read"
    FS_WRITE = "fs.write"
    FS_DELETE = "fs.delete"
    APP_LAUNCH = "app.launch"
    DESKTOP_CONTROL = "desktop.control"
    SCREEN_CAPTURE = "screen.capture"
    SHELL_EXEC = "shell.exec"
    PRIVILEGED_EXEC = "shell.privileged"
    NETWORK = "network.access"
    BROWSER = "browser.control"
    DOWNLOAD = "network.download"
    BLENDER = "app.blender"
    MEDIA = "media.process"
    INSTALL = "system.install"
    EXTERNAL_MESSAGE = "external.message"
    PURCHASE = "external.purchase"
    SECURITY_SETTINGS = "system.security"


#: Actions that ALWAYS need a fresh, per-instance authorization.
ALWAYS_CONFIRM: set[Permission] = {
    Permission.FS_DELETE, Permission.PRIVILEGED_EXEC, Permission.INSTALL,
    Permission.EXTERNAL_MESSAGE, Permission.PURCHASE, Permission.SECURITY_SETTINGS,
}

#: Granted once per session, remembered afterwards.
SESSION_GRANTABLE: set[Permission] = {
    Permission.FS_READ, Permission.FS_WRITE, Permission.APP_LAUNCH,
    Permission.DESKTOP_CONTROL, Permission.SCREEN_CAPTURE, Permission.SHELL_EXEC,
    Permission.NETWORK, Permission.BROWSER, Permission.DOWNLOAD,
    Permission.BLENDER, Permission.MEDIA,
}


class Risk(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(slots=True)
class AuthorizationRequest:
    id: str
    permission: Permission
    action: str
    detail: str
    risk: Risk
    task_id: str | None = None
    created_at: float = field(default_factory=time.time)
    decision: str | None = None       # approved | denied | timeout
    decided_at: float | None = None
    remember: bool = False
    scope: str = ""                    # e.g. the specific path or command
    _event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "permission": self.permission.value, "action": self.action,
                "detail": self.detail, "risk": self.risk.value, "task_id": self.task_id,
                "scope": self.scope, "created_at": self.created_at,
                "decision": self.decision, "decided_at": self.decided_at}


@dataclass(slots=True)
class Grant:
    permission: Permission
    scope: str = "*"
    granted_at: float = field(default_factory=time.time)
    persistent: bool = False

    def matches(self, scope: str) -> bool:
        return self.scope == "*" or self.scope == scope or scope.startswith(self.scope.rstrip("*"))


class AuthorizationManager:
    """Tracks grants and brokers interactive authorization with the UI."""

    def __init__(self, *, default_timeout: float = 180.0, auto_approve: set[Permission] | None = None) -> None:
        self._grants: dict[str, Grant] = {}
        self._pending: dict[str, AuthorizationRequest] = {}
        self._history: list[dict[str, Any]] = []
        self.default_timeout = default_timeout
        #: Test/dev only — never enabled in a packaged build.
        self.auto_approve: set[Permission] = set(auto_approve or ())

    # ------------------------------------------------------------ grants
    def grant(self, permission: Permission, scope: str = "*", persistent: bool = False) -> Grant:
        g = Grant(permission=permission, scope=scope, persistent=persistent)
        self._grants[f"{permission.value}:{scope}"] = g
        log.info("granted %s scope=%s persistent=%s", permission.value, scope, persistent)
        return g

    def revoke(self, permission: Permission, scope: str = "*") -> bool:
        return self._grants.pop(f"{permission.value}:{scope}", None) is not None

    def clear(self) -> None:
        self._grants.clear()

    def has(self, permission: Permission, scope: str = "*") -> bool:
        return any(g.permission == permission and g.matches(scope) for g in self._grants.values())

    def grants_public(self) -> list[dict[str, Any]]:
        return [{"permission": g.permission.value, "scope": g.scope,
                 "persistent": g.persistent, "granted_at": g.granted_at}
                for g in self._grants.values()]

    # ------------------------------------------------- interactive broker
    def pending_public(self) -> list[dict[str, Any]]:
        return [r.public() for r in self._pending.values()]

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._history[-limit:]

    async def request(self, permission: Permission, action: str, detail: str = "", *,
                      risk: Risk = Risk.MEDIUM, scope: str = "", task_id: str | None = None,
                      timeout: float | None = None) -> AuthorizationRequest:
        """Return an approved request, or raise AuthorizationRequired."""
        scope = scope or "*"
        if self.has(permission, scope) and permission not in ALWAYS_CONFIRM:
            log.debug("cached grant for %s", permission.value)
            req = AuthorizationRequest(id=f"cached-{uuid.uuid4().hex[:8]}", permission=permission,
                                       action=action, detail=detail, risk=risk, task_id=task_id,
                                       decision="approved", scope=scope,
                                       decided_at=time.time())
            self._history.append(req.public())
            return req

        if permission in self.auto_approve:
            req = AuthorizationRequest(id=f"auto-{uuid.uuid4().hex[:8]}", permission=permission,
                                       action=action, detail=detail, risk=risk, task_id=task_id,
                                       decision="approved", scope=scope, decided_at=time.time(),
                                       remember=False)
            self._history.append(req.public())
            log.warning("AUTO-APPROVED %s (%s) — dev/test mode", permission.value, action)
            return req

        req = AuthorizationRequest(id=uuid.uuid4().hex[:12], permission=permission,
                                    action=action, detail=detail, risk=risk,
                                    task_id=task_id, scope=scope)
        self._pending[req.id] = req
        get_bus().publish(EventType.AUTH_REQUEST, req.public(), channel="auth", task_id=task_id)
        log.info("authorization requested: %s / %s (id=%s)", permission.value, action, req.id)

        try:
            await asyncio.wait_for(req._event.wait(), timeout or self.default_timeout)
        except asyncio.TimeoutError:
            req.decision = "timeout"
            req.decided_at = time.time()
        finally:
            self._pending.pop(req.id, None)
            self._history.append(req.public())
            get_bus().publish(EventType.AUTH_RESULT, req.public(), channel="auth", task_id=task_id)

        if req.decision != "approved":
            raise AuthorizationRequired(
                f"User authorization for '{action}' was {req.decision or 'not provided'}",
                details={"permission": permission.value, "request_id": req.id,
                         "risk": risk.value, "scope": scope})
        return req

    def decide(self, request_id: str, approved: bool, *, remember: bool = False) -> bool:
        req = self._pending.get(request_id)
        if not req:
            return False
        req.decision = "approved" if approved else "denied"
        req.decided_at = time.time()
        req.remember = remember
        if approved and remember and req.permission in SESSION_GRANTABLE:
            self.grant(req.permission, req.scope or "*", persistent=False)
        req._event.set()
        return True

    def decide_all(self, approved: bool, *, remember: bool = False) -> int:
        n = 0
        for rid in list(self._pending):
            if self.decide(rid, approved, remember=remember):
                n += 1
        return n


_mgr: AuthorizationManager | None = None


def get_auth() -> AuthorizationManager:
    global _mgr
    if _mgr is None:
        _mgr = AuthorizationManager()
    return _mgr


def set_auth(m: AuthorizationManager) -> None:
    global _mgr
    _mgr = m
