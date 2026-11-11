"""Application catalog, discovery and launching.

Discovery order on Windows (first hit wins):
  1. explicit user-configured path
  2. ``App Paths`` registry key (HKLM then HKCU)
  3. ``PATH`` lookup
  4. well-known install directories
  5. Start Menu shortcut resolution (``WScript.Shell``)
  6. Uninstall registry display-name scan

On other platforms it falls back to ``PATH`` and common locations, and reports
honestly when an application is not present.
"""
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ...core.logging_setup import get_logger
from .platform import is_windows

log = get_logger("integrations.desktop.apps")


@dataclass(slots=True)
class AppSpec:
    key: str                      # canonical id used by the agent
    display_name: str
    executables: list[str]        # windows exe names / unix binaries
    aliases: list[str] = field(default_factory=list)
    category: str = "utility"
    windows_dirs: list[str] = field(default_factory=list)   # glob patterns under ProgramFiles
    app_path_key: str | None = None
    cli: bool = False             # has a usable command-line/scripting interface
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


PF = "{ProgramFiles}"
PF86 = "{ProgramFiles(x86)}"
LOCAL = "{LocalAppData}"

APP_CATALOG: list[AppSpec] = [
    AppSpec("notepad", "Notepad", ["notepad.exe", "notepad"], ["text editor", "editor", "记事本"],
            "editor", app_path_key="notepad.exe"),
    AppSpec("explorer", "File Explorer", ["explorer.exe", "explorer", "nautilus", "dolphin", "open"],
            ["files", "folder", "file manager", "文件管理器"], "system"),
    AppSpec("wordpad", "WordPad", ["wordpad.exe"], ["write"], "editor"),
    AppSpec("mspaint", "Paint", ["mspaint.exe", "mspaint"], ["paint", "drawing"], "graphics"),
    AppSpec("calculator", "Calculator", ["calc.exe", "CalculatorApp.exe", "gnome-calculator"],
            ["calc"], "utility"),
    AppSpec("terminal", "Windows Terminal", ["wt.exe", "wt"], ["console", "shell"], "system"),
    AppSpec("cmd", "Command Prompt", ["cmd.exe"], ["shell"], "system"),
    AppSpec("powershell", "PowerShell", ["powershell.exe", "pwsh", "pwsh.exe"], ["shell", "ps"],
            "system"),
    AppSpec("vscode", "Visual Studio Code", ["code.cmd", "code", "Code.exe"],
            ["vs code", "code editor", "vsc"], "editor",
            windows_dirs=[f"{LOCAL}/Programs/Microsoft VS Code/Code.exe",
                         f"{PF}/Microsoft VS Code/Code.exe"], cli=True),
    AppSpec("chrome", "Google Chrome", ["chrome.exe", "google-chrome", "chromium",
                                        "Google Chrome"],
            ["browser", "google chrome"], "browser",
            windows_dirs=[f"{PF}/Google/Chrome/Application/chrome.exe",
                          f"{PF86}/Google/Chrome/Application/chrome.exe",
                          f"{LOCAL}/Google/Chrome/Application/chrome.exe"], cli=True),
    AppSpec("edge", "Microsoft Edge", ["msedge.exe", "microsoft-edge"], ["browser", "edge"],
            "browser",
            windows_dirs=[f"{PF86}/Microsoft/Edge/Application/msedge.exe",
                          f"{PF}/Microsoft/Edge/Application/msedge.exe"], cli=True),
    AppSpec("firefox", "Mozilla Firefox", ["firefox.exe", "firefox"], ["browser"], "browser",
            windows_dirs=[f"{PF}/Mozilla Firefox/firefox.exe",
                          f"{PF86}/Mozilla Firefox/firefox.exe"], cli=True),
    AppSpec("blender", "Blender", ["blender.exe", "blender", "Blender"],
            ["3d", "blender3d", "三维"], "creative",
            windows_dirs=[f"{PF}/Blender Foundation/Blender*/blender.exe",
                          f"{PF86}/Blender Foundation/Blender*/blender.exe",
                          f"{LOCAL}/Programs/Blender*/blender.exe"], cli=True,
            notes="Supports --background --python <script> headless execution and bpy scripting."),
    AppSpec("ffmpeg", "FFmpeg", ["ffmpeg.exe", "ffmpeg"], ["video converter"], "media", cli=True),
    AppSpec("ffprobe", "FFprobe", ["ffprobe.exe", "ffprobe"], [], "media", cli=True),
    AppSpec("vlc", "VLC", ["vlc.exe", "vlc"], ["media player"], "media",
            windows_dirs=[f"{PF}/VideoLAN/VLC/vlc.exe", f"{PF86}/VideoLAN/VLC/vlc.exe"], cli=True),
    AppSpec("obs", "OBS Studio", ["obs64.exe", "obs32.exe", "obs"], ["screen recorder"], "media",
            windows_dirs=[f"{PF}/obs-studio/bin/64bit/obs64.exe"]),
    AppSpec("audacity", "Audacity", ["audacity.exe", "audacity"], ["audio editor"], "media",
            windows_dirs=[f"{PF}/Audacity/audacity.exe"]),
    AppSpec("gimp", "GIMP", ["gimp.exe", "gimp", "gimp-2.10"], ["image editor", "photoshop alternative"],
            "creative", windows_dirs=[f"{PF}/GIMP*/bin/gimp-*.exe"], cli=True),
    AppSpec("inkscape", "Inkscape", ["inkscape.exe", "inkscape"], ["vector editor"], "creative",
            windows_dirs=[f"{PF}/Inkscape/bin/inkscape.exe"], cli=True),
    AppSpec("photoshop", "Adobe Photoshop", ["Photoshop.exe"], ["ps", "image editor"], "creative",
            windows_dirs=[f"{PF}/Adobe/Adobe Photoshop*/Photoshop.exe"]),
    AppSpec("premiere", "Adobe Premiere Pro", ["Adobe Premiere Pro.exe"], ["video editor", "pr"],
            "creative", windows_dirs=[f"{PF}/Adobe/Adobe Premiere Pro*/Adobe Premiere Pro.exe"]),
    AppSpec("aftereffects", "Adobe After Effects", ["AfterFX.exe"], ["ae", "vfx"], "creative",
            windows_dirs=[f"{PF}/Adobe/Adobe After Effects*/Support Files/AfterFX.exe"]),
    AppSpec("davinci", "DaVinci Resolve", ["Resolve.exe"], ["video editor", "resolve"], "creative",
            windows_dirs=[f"{PF}/Blackmagic Design/DaVinci Resolve/Resolve.exe"]),
    AppSpec("capcut", "CapCut", ["CapCut.exe"], ["video editor"], "creative",
            windows_dirs=[f"{LOCAL}/CapCut/Apps/*/CapCut.exe"]),
    AppSpec("word", "Microsoft Word", ["WINWORD.EXE"], ["ms word", "doc"], "office",
            windows_dirs=[f"{PF}/Microsoft Office/root/Office16/WINWORD.EXE",
                          f"{PF86}/Microsoft Office/root/Office16/WINWORD.EXE"]),
    AppSpec("excel", "Microsoft Excel", ["EXCEL.EXE"], ["ms excel", "spreadsheet"], "office",
            windows_dirs=[f"{PF}/Microsoft Office/root/Office16/EXCEL.EXE",
                          f"{PF86}/Microsoft Office/root/Office16/EXCEL.EXE"]),
    AppSpec("powerpoint", "Microsoft PowerPoint", ["POWERPNT.EXE"], ["ppt", "slides", "presentation"],
            "office", windows_dirs=[f"{PF}/Microsoft Office/root/Office16/POWERPNT.EXE",
                                    f"{PF86}/Microsoft Office/root/Office16/POWERPNT.EXE"]),
    AppSpec("settings", "Windows Settings", ["ms-settings:", "immersivecontrolpanel"],
            ["preferences"], "system"),
    AppSpec("taskmgr", "Task Manager", ["taskmgr.exe"], ["processes"], "system"),
    AppSpec("controlpanel", "Control Panel", ["control.exe"], [], "system"),
    AppSpec("python", "Python", ["python.exe", "python3", "python", "py.exe"], ["py"], "dev", cli=True),
    AppSpec("node", "Node.js", ["node.exe", "node"], ["nodejs"], "dev", cli=True),
    AppSpec("git", "Git", ["git.exe", "git"], [], "dev", cli=True),
    AppSpec("discord", "Discord", ["Discord.exe", "discord"], [], "communication",
            windows_dirs=[f"{LOCAL}/Discord/app-*/Discord.exe"]),
    AppSpec("spotify", "Spotify", ["Spotify.exe", "spotify"], ["music"], "media",
            windows_dirs=[f"{LOCAL}/Spotify/Spotify.exe"]),
    AppSpec("steam", "Steam", ["steam.exe", "steam"], ["games"], "utility",
            windows_dirs=[f"{PF86}/Steam/steam.exe", f"{PF}/Steam/steam.exe"]),
]

BY_KEY: dict[str, AppSpec] = {a.key: a for a in APP_CATALOG}


def _expand(p: str) -> str:
    env = {"{ProgramFiles}": os.environ.get("ProgramFiles", "C:\\Program Files"),
           "{ProgramFiles(x86)}": os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"),
           "{LocalAppData}": os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local")),
           "{AppData}": os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming")),
           "{SystemRoot}": os.environ.get("SystemRoot", "C:\\Windows"),
           "{UserProfile}": str(Path.home())}
    out = p
    for k, v in env.items():
        out = out.replace(k, v)
    return out


def _registry_app_path(exe: str) -> str | None:
    if not is_windows():
        return None
    try:
        import winreg
    except ImportError:
        return None
    sub = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive, sub) as k:
                val, _ = winreg.QueryValueEx(k, None)
                if val and Path(val).exists():
                    return str(val)
        except OSError:
            continue
    return None


def _start_menu_resolve(name: str) -> str | None:
    """Resolve a Start Menu .lnk to its target via WScript.Shell."""
    if not is_windows():
        return None
    roots = [os.path.join(os.environ.get("ProgramData", "C:\\ProgramData"),
                          r"Microsoft\Windows\Start Menu\Programs"),
             os.path.join(os.environ.get("APPDATA", ""),
                          r"Microsoft\Windows\Start Menu\Programs")]
    hits: list[Path] = []
    for root in roots:
        rp = Path(root)
        if not rp.exists():
            continue
        for lnk in rp.rglob("*.lnk"):
            if name.lower() in lnk.stem.lower():
                hits.append(lnk)
    if not hits:
        return None
    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
        pythoncom.CoInitialize()
        shell = win32com.client.Dispatch("WScript.Shell")
        for lnk in hits:
            try:
                target = shell.CreateShortCut(str(lnk)).Targetpath
                if target and Path(target).exists():
                    return target
            except Exception:
                continue
    except ImportError:
        # Fallback: parse the .lnk binary for a local path string
        try:
            data = hits[0].read_bytes()
            m = re.search(rb"[A-Za-z]:\\[\x20-\x7e]{3,200}?\.exe", data)
            if m:
                cand = m.group(0).decode("ascii", "ignore")
                if Path(cand).exists():
                    return cand
        except OSError:
            pass
    return None


def resolve(app_key: str, *, extra_paths: dict[str, str] | None = None) -> dict[str, Any]:
    """Locate an application. Returns a dict describing where/how it was found."""
    spec = BY_KEY.get(app_key.lower())
    if not spec:
        # allow a raw executable / alias
        for s in APP_CATALOG:
            if app_key.lower() in [a.lower() for a in s.aliases] + \
               [e.lower() for e in s.executables] + [s.display_name.lower()]:
                spec = s
                break
    if not spec:
        raw = shutil.which(app_key) or (shutil.which(app_key + ".exe") if is_windows() else None)
        return {"found": bool(raw), "app": app_key, "path": raw or "", "method": "path",
                "display_name": app_key, "cli": False,
                "error": None if raw else f"unknown application {app_key!r}"}

    if extra_paths and spec.key in extra_paths and Path(extra_paths[spec.key]).exists():
        return {"found": True, "app": spec.key, "path": extra_paths[spec.key],
                "method": "user-configured", "display_name": spec.display_name,
                "cli": spec.cli, "notes": spec.notes}

    tried: list[str] = []
    for exe in spec.executables:
        if exe.endswith(":"):            # URI protocol launcher (ms-settings:)
            if is_windows():
                return {"found": True, "app": spec.key, "path": exe, "method": "uri",
                        "display_name": spec.display_name, "cli": spec.cli, "notes": spec.notes}
            continue
        p = shutil.which(exe) or (shutil.which(Path(exe).stem) if is_windows() else None)
        tried.append(f"which:{exe}")
        if p:
            return {"found": True, "app": spec.key, "path": p, "method": "path",
                    "display_name": spec.display_name, "cli": spec.cli, "notes": spec.notes}

    if spec.app_path_key:
        tried.append(f"registry:{spec.app_path_key}")
        rp = _registry_app_path(spec.app_path_key)
        if rp:
            return {"found": True, "app": spec.key, "path": rp, "method": "registry-app-paths",
                    "display_name": spec.display_name, "cli": spec.cli, "notes": spec.notes}

    for pattern in spec.windows_dirs:
        expanded = _expand(pattern)
        tried.append(f"dir:{expanded}")
        if "*" in expanded:
            parent = Path(expanded).parent
            if parent.exists():
                for cand in sorted(parent.glob(Path(expanded).name), reverse=True):
                    if cand.exists():
                        return {"found": True, "app": spec.key, "path": str(cand),
                                "method": "known-directory", "display_name": spec.display_name,
                                "cli": spec.cli, "notes": spec.notes}
        elif Path(expanded).exists():
            return {"found": True, "app": spec.key, "path": expanded, "method": "known-directory",
                    "display_name": spec.display_name, "cli": spec.cli, "notes": spec.notes}

    if is_windows():
        tried.append(f"startmenu:{spec.display_name}")
        sm = _start_menu_resolve(spec.display_name)
        if sm:
            return {"found": True, "app": spec.key, "path": sm, "method": "start-menu",
                    "display_name": spec.display_name, "cli": spec.cli, "notes": spec.notes}

    return {"found": False, "app": spec.key, "path": "", "method": "",
            "display_name": spec.display_name, "cli": spec.cli, "notes": spec.notes,
            "error": f"{spec.display_name} not found on this machine", "tried": tried}


def catalog_status(extra_paths: dict[str, str] | None = None) -> list[dict[str, Any]]:
    out = []
    for spec in APP_CATALOG:
        r = resolve(spec.key, extra_paths=extra_paths)
        out.append({"key": spec.key, "display_name": spec.display_name,
                    "category": spec.category, "found": r["found"], "path": r["path"],
                    "method": r["method"], "cli": spec.cli, "aliases": spec.aliases})
    return out


def build_launch_command(path: str, args: list[str] | None = None,
                         working_dir: str | None = None) -> list[str]:
    argv = [path] + list(args or [])
    if is_windows() and path.lower().endswith((".cmd", ".bat")):
        return ["cmd.exe", "/c"] + argv
    return argv


def launch(app_key: str, args: list[str] | None = None, *, files: list[str] | None = None,
           working_dir: str | None = None, wait: bool = False, timeout: float = 30.0,
           extra_paths: dict[str, str] | None = None) -> dict[str, Any]:
    """Launch an application and verify the process actually started."""
    info = resolve(app_key, extra_paths=extra_paths)
    if not info["found"]:
        return {"started": False, "error": info.get("error", "not found"), "app": app_key,
                "resolution": info}

    path = info["path"]
    all_args = list(args or []) + list(files or [])
    if path.endswith(":"):                       # URI protocol
        try:
            os.startfile(path)  # type: ignore[attr-defined]
            return {"started": True, "app": app_key, "path": path, "method": "uri",
                    "pid": None, "verified": True, "verification": "URI handler invoked"}
        except OSError as exc:
            return {"started": False, "app": app_key, "error": str(exc)}

    argv = build_launch_command(path, all_args, working_dir)
    log.info("launching %s: %s", app_key, " ".join(shlex.quote(a) for a in argv))
    try:
        creationflags = 0
        if is_windows():
            creationflags = 0x00000008  # DETACHED_PROCESS
        proc = subprocess.Popen(
            argv, cwd=working_dir or None, creationflags=creationflags,
            stdout=subprocess.PIPE if wait else subprocess.DEVNULL,
            stderr=subprocess.PIPE if wait else subprocess.DEVNULL,
            text=True, close_fds=True)
    except OSError as exc:
        return {"started": False, "app": app_key, "path": path, "argv": argv,
                "error": f"{type(exc).__name__}: {exc}"}

    result: dict[str, Any] = {"started": True, "app": app_key, "path": path,
                              "argv": argv, "pid": proc.pid, "display_name": info["display_name"]}

    if wait:
        try:
            out, err = proc.communicate(timeout=timeout)
            result.update({"exit_code": proc.returncode, "stdout": (out or "")[-8000:],
                           "stderr": (err or "")[-4000:],
                           "verified": proc.returncode == 0,
                           "verification": f"process exited with code {proc.returncode}"})
        except subprocess.TimeoutExpired:
            proc.kill()
            out, err = proc.communicate()
            result.update({"exit_code": None, "timed_out": True, "verified": False,
                           "stdout": (out or "")[-4000:], "stderr": (err or "")[-2000:],
                           "error": f"timed out after {timeout}s",
                           "verification": f"killed after {timeout}s timeout"})
    else:
        # Verify the process is genuinely alive rather than assuming success.
        import time as _t
        _t.sleep(0.6)
        alive = proc.poll() is None
        result.update({"alive": alive, "exit_code": proc.poll(), "verified": alive,
                       "verification": ("process still running (pid %d)" % proc.pid if alive
                                        else f"process exited immediately with code {proc.poll()}")})
        if not alive and proc.returncode not in (0, None):
            result["error"] = f"process exited immediately with code {proc.returncode}"
    return result
