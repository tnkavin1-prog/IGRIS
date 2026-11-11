"""File-system scope enforcement.

IGRIS may only touch directories the user explicitly authorized, plus its own
runtime tree. Every path handed to a tool is resolved (following symlinks) and
checked against the authorized roots *and* a deny-list of credential stores.
Checks happen after resolution so ``/authorized/../../.ssh/id_rsa`` fails.
"""
from __future__ import annotations

import fnmatch
import os
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath

from ..core.errors import PathOutsideScope, PermissionDenied
from ..core.logging_setup import get_logger

log = get_logger("security.path_guard")

#: Patterns that must never be read, written or enumerated, even inside an
#: authorized root. Matching is performed on the resolved absolute path.
SENSITIVE_PATTERNS: tuple[str, ...] = (
    "**/.ssh/**", "**/.gnupg/**", "**/.aws/credentials", "**/.azure/**",
    "**/.kube/config", "**/.netrc", "**/_netrc", "**/.git-credentials",
    "**/.git/config", "**/.npmrc", "**/.pypirc", "**/.docker/config.json",
    "**/.config/gcloud/**", "**/id_rsa", "**/id_ed25519", "**/*.pfx", "**/*.p12",
    "**/*.keystore", "**/cookies.sqlite", "**/Login Data", "**/Web Data",
    "**/Local State", "**/NTUSER.DAT", "**/SAM", "**/SYSTEM", "**/SECURITY",
    "**/AppData/Local/Microsoft/Credentials/**",
    "**/AppData/Roaming/Microsoft/Protect/**",
    "**/Microsoft/Edge/User Data/**/Login Data",
    "**/Google/Chrome/User Data/**/Login Data",
    "**/.env", "**/.env.*", "**/secrets/**", "**/igris.vault",
)

_TRAVERSAL = re.compile(r"(^|[/\\])\.\.($|[/\\])")


class PathGuard:
    def __init__(self, *, runtime_roots: list[Path] | None = None,
                 allow_full_disk: bool = False) -> None:
        self._roots: list[Path] = []
        self.allow_full_disk = allow_full_disk
        for r in runtime_roots or []:
            self.authorize(r)

    # ------------------------------------------------------- registration
    def authorize(self, root: str | Path) -> Path:
        p = self._resolve(Path(root).expanduser())
        if not p.exists():
            p.mkdir(parents=True, exist_ok=True)
        if p not in self._roots:
            self._roots.append(p)
            log.info("authorized root: %s", p)
        return p

    def revoke(self, root: str | Path) -> bool:
        p = self._resolve(Path(root).expanduser())
        before = len(self._roots)
        self._roots = [r for r in self._roots if r != p]
        if len(self._roots) != before:
            log.info("revoked root: %s", p)
            return True
        return False

    @property
    def roots(self) -> list[Path]:
        return list(self._roots)

    def roots_as_strings(self) -> list[str]:
        return [str(r) for r in self._roots]

    # ------------------------------------------------------------ checks
    @staticmethod
    def _resolve(p: Path) -> Path:
        """Normalize without requiring existence; follow symlinks when present."""
        try:
            if p.exists():
                return p.resolve(strict=True)
            anchor = p
            while anchor.parent != anchor and not anchor.exists():
                anchor = anchor.parent
            rel = p.relative_to(anchor) if p != anchor else Path()
            return (anchor.resolve(strict=True) / rel) if str(rel) else anchor.resolve(strict=True)
        except (OSError, RuntimeError):
            return p.absolute()

    def is_sensitive(self, path: Path) -> bool:
        s = path.as_posix()
        w = str(path).replace("\\", "/")
        for pat in SENSITIVE_PATTERNS:
            for target in {s, w, path.name}:
                if fnmatch.fnmatch(target, pat) or fnmatch.fnmatch(target.lower(), pat.lower()):
                    return True
        return False

    def check(self, raw: str | Path, *, write: bool = False, must_exist: bool = False) -> Path:
        """Validate a path. Raises PathOutsideScope / PermissionDenied."""
        s = str(raw).strip()
        if not s:
            raise PathOutsideScope("empty path")
        if _TRAVERSAL.search(s.replace("\\", "/")) and not Path(s).is_absolute():
            raise PathOutsideScope(f"relative traversal in path: {s!r}")
        p = self._resolve(Path(s).expanduser())

        if self.is_sensitive(p):
            raise PermissionDenied(
                f"{p} matches a protected credential/system pattern", details={"path": str(p)})

        inside = any(p == r or r in p.parents for r in self._roots)
        if not inside and not self.allow_full_disk:
            raise PathOutsideScope(
                f"{p} is outside authorized directories",
                details={"path": str(p), "authorized": self.roots_as_strings()})

        if write:
            parent = p if p.is_dir() else p.parent
            if parent.exists() and not os.access(parent, os.W_OK):
                raise PermissionDenied(f"no write permission on {parent}")
        if must_exist and not p.exists():
            raise PathOutsideScope(f"{p} does not exist", details={"path": str(p)},
                                   retryable=False)
        return p

    def check_read(self, raw: str | Path) -> Path:
        return self.check(raw, must_exist=True)

    def check_write(self, raw: str | Path) -> Path:
        return self.check(raw, write=True)

    def sandbox_ok(self, p: Path, sandbox: Path) -> bool:
        p = self._resolve(p)
        sandbox = self._resolve(sandbox)
        return p == sandbox or sandbox in p.parents

    def describe(self) -> dict:
        return {"roots": self.roots_as_strings(),
                "allow_full_disk": self.allow_full_disk,
                "protected_patterns": len(SENSITIVE_PATTERNS),
                "platform": sys.platform,
                "separator": os.sep,
                "windows_path_syntax": bool(PureWindowsPath("C:\\x").drive),
                "posix_path_syntax": bool(PurePosixPath("/x").anchor)}


_guard: PathGuard | None = None


def get_guard() -> PathGuard:
    global _guard
    if _guard is None:
        raise RuntimeError("PathGuard not initialised")
    return _guard


def set_guard(g: PathGuard) -> None:
    global _guard
    _guard = g
