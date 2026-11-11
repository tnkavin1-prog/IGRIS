"""Platform capability detection.

IGRIS targets Windows but must degrade honestly elsewhere: every capability
reports whether it is genuinely available *on this machine*, so the agent never
plans a step it cannot perform and never claims a Windows action succeeded on a
non-Windows host.
"""
from __future__ import annotations

import os
import platform
import shutil
import sys
from dataclasses import asdict, dataclass, field
from typing import Any

from ...core.logging_setup import get_logger

log = get_logger("integrations.desktop.platform")


@dataclass(slots=True)
class Capability:
    name: str
    available: bool
    backend: str = ""
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def is_windows() -> bool:
    return sys.platform == "win32"


def windows_build() -> dict[str, Any] | None:
    if not is_windows():
        return None
    try:
        v = sys.getwindowsversion()  # type: ignore[attr-defined]
        return {"major": v.major, "minor": v.minor, "build": v.build,
                "platform": v.platform, "service_pack": v.service_pack,
                "version_string": platform.version()}
    except Exception as exc:  # pragma: no cover
        return {"error": str(exc)}


def _module_available(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def detect_capabilities() -> dict[str, Capability]:
    caps: dict[str, Capability] = {}

    caps["platform"] = Capability("platform", True, sys.platform,
                                  f"{platform.system()} {platform.release()} "
                                  f"({platform.machine()})")

    # Windows UI Automation via pywinauto
    uia = is_windows() and _module_available("pywinauto")
    caps["ui_automation"] = Capability(
        "ui_automation", uia, "pywinauto/UIA" if uia else "",
        "Windows UI Automation available" if uia else
        ("pywinauto not installed" if is_windows() else f"not applicable on {sys.platform}"))

    caps["win32_api"] = Capability(
        "win32_api", is_windows() and _module_available("win32api"), "pywin32",
        "pywin32 available" if is_windows() else "not applicable off Windows")

    # Synthetic input
    pyautogui = _module_available("pyautogui")
    caps["synthetic_input"] = Capability(
        "synthetic_input", pyautogui and (is_windows() or os.environ.get("DISPLAY") is not None
                                          or sys.platform == "darwin"),
        "pyautogui" if pyautogui else "",
        "keyboard/mouse automation available" if pyautogui else "pyautogui not installed")

    caps["screen_capture"] = Capability(
        "screen_capture", _module_available("mss"), "mss",
        "mss installed" if _module_available("mss") else "mss not installed")

    caps["powershell"] = Capability(
        "powershell", bool(shutil.which("powershell.exe" if is_windows() else "pwsh")),
        shutil.which("powershell.exe") or shutil.which("pwsh") or "",
        "PowerShell found" if (shutil.which("powershell.exe") or shutil.which("pwsh"))
        else "PowerShell not found")

    for tool in ("ffmpeg", "ffprobe", "blender", "git", "node", "python"):
        exe = "python3" if tool == "python" and not is_windows() else tool
        p = shutil.which(exe) or shutil.which(exe + (".exe" if is_windows() else ""))
        caps[tool] = Capability(tool, bool(p), p or "", "on PATH" if p else "not on PATH")

    caps["browser_playwright"] = Capability(
        "browser_playwright", _module_available("playwright"), "playwright",
        "playwright installed" if _module_available("playwright") else "playwright not installed")

    return caps


def capabilities_report() -> dict[str, Any]:
    caps = detect_capabilities()
    return {
        "platform": sys.platform,
        "is_windows": is_windows(),
        "windows_build": windows_build(),
        "python": platform.python_version(),
        "capabilities": {k: v.to_dict() for k, v in caps.items()},
        "missing": sorted(k for k, v in caps.items() if not v.available),
        "note": ("Running on Windows: full desktop automation available."
                 if is_windows() else
                 f"Running on {sys.platform}: Windows-only automation (UI Automation, "
                 f"Win32, Start Menu resolution) is unavailable here and those tools "
                 f"report BLOCKED rather than pretending to succeed."),
    }
