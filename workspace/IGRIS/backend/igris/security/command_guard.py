"""Command validation.

Gemini proposes commands; this module decides whether IGRIS may run them.
Untrusted model output never reaches ``subprocess`` unfiltered.

Three layers:
  1. Structural parsing of the command line (shell-agnostic tokenizer).
  2. Deny-list of destructive / privilege-escalating / persistence patterns.
  3. Allow-list of executables permitted without interactive authorization.

Anything that is not explicitly allowed requires a user authorization grant,
which the supervisor obtains through the UI before execution.
"""
from __future__ import annotations

import re
import shlex
from dataclasses import dataclass, field

from ..core.logging_setup import get_logger

log = get_logger("security.command_guard")


@dataclass(slots=True)
class CommandVerdict:
    allowed: bool
    reason: str = ""
    needs_authorization: bool = False
    category: str = "unknown"
    executable: str = ""
    argv: list[str] = field(default_factory=list)
    matched_rules: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "allowed": self.allowed, "reason": self.reason,
            "needs_authorization": self.needs_authorization,
            "category": self.category, "executable": self.executable,
            "argv": self.argv, "matched_rules": self.matched_rules,
        }


#: Executables that are safe to run without asking (read-mostly / app launches).
DEFAULT_ALLOWLIST: set[str] = {
    # windows
    "notepad", "explorer", "calc", "mspaint", "wordpad", "cmd", "powershell",
    "pwsh", "code", "wt", "terminal", "control", "tasklist", "systeminfo",
    "where", "whoami", "hostname", "ver", "echo", "type", "dir", "findstr",
    "blender", "ffmpeg", "ffprobe", "git", "python", "python3", "py", "node",
    "npm", "npx", "start",
    # posix (dev parity + CI)
    "ls", "cat", "pwd", "mkdir", "cp", "mv", "touch", "head", "tail", "wc",
    "grep", "find", "sort", "uniq", "sed", "awk", "which", "uname", "date",
    "sh", "bash", "zip", "unzip", "tar", "gzip", "gunzip",
}

#: Shells whose payloads are permitted when no dangerous rule matches. They are
#: still gated by ``Permission.SHELL_EXEC`` in the policy layer; this module only
#: rejects *dangerous content*, it does not require per-cmdlet allowlisting.
TRUSTED_SHELLS: set[str] = {"cmd", "powershell", "pwsh"}

#: Executables that always need explicit user authorization.
ELEVATION_EXECUTABLES: set[str] = {
    "runas", "sudo", "su", "doas", "gsudo", "psexec", "sc", "schtasks",
    "regedit", "bcdedit", "vssadmin", "diskpart", "wmic", "format", "cipher",
    "takeown", "icacls", "cacls", "net", "netsh", "reg", "powershell_ise",
    "dism", "winget", "choco", "scoop", "msiexec", "setup", "installutil",
}

#: Patterns whose presence anywhere in the command line forces authorization
#: (or outright denial). Each entry: (regex, category, deny?, reason).
_RULES: list[tuple[re.Pattern[str], str, bool, str]] = [
    (re.compile(r"\b(format|diskpart)\b.*\s(/[q:]|\s+\w:)", re.I), "disk", True,
     "disk formatting/partitioning"),
    (re.compile(r"\bformat\s+[a-z]:", re.I), "disk", True, "drive format"),
    (re.compile(r"\brm\s+(-[a-z]*\s+)*-?[rf]{1,2}.*\s(/|~|\$HOME|C:\\\\?)(\s|$)", re.I),
     "destructive", True, "recursive delete of a filesystem root"),
    (re.compile(r"\brm\s+-rf?\s+/", re.I), "destructive", True, "rm -rf /"),
    (re.compile(r"\bdel\s+/[sfq]{1,3}\b.*\\\\?\s*$", re.I), "destructive", False,
     "recursive forced delete"),
    (re.compile(r"\bRemove-Item\b.*-(Recurse|Force)", re.I), "destructive", False,
     "recursive PowerShell delete"),
    (re.compile(r"\b(Shutdown|shutdown)\b.*(-[srf]|/[srf])", re.I), "system", False,
     "system shutdown/restart"),
    (re.compile(r"\bStop-Computer\b|\bRestart-Computer\b", re.I), "system", False,
     "system power state change"),
    (re.compile(r"\breg\s+(delete|add|import|load)\b", re.I), "registry", False,
     "registry modification"),
    (re.compile(r"\b(New-ItemProperty|Set-ItemProperty|Remove-ItemProperty)\b.*"
                r"(CurrentVersion\\\\Run|Winlogon)", re.I), "persistence", True,
     "autorun/persistence registration"),
    (re.compile(r"\bSet-MpPreference\b|\bDisable-REALTIME|Add-MpPreference\b.*Exclusion", re.I),
     "security", True, "modifying Windows Defender settings"),
    (re.compile(r"\bvssadmin\s+delete\b|\bwbadmin\s+delete\b", re.I), "security", True,
     "deleting shadow copies/backups"),
    (re.compile(r"\b(bcdedit|bootcfg)\b", re.I), "boot", True, "boot configuration change"),
    (re.compile(r"\b(takeown|icacls|cacls)\b", re.I), "acl", False, "ownership/ACL change"),
    (re.compile(r"\bnet\s+(user|localgroup)\b", re.I), "accounts", True,
     "local account modification"),
    (re.compile(r"\b(winget|choco|scoop|msiexec)\s+(install|uninstall)", re.I), "install", False,
     "software installation"),
    (re.compile(r"\b(curl|wget|Invoke-WebRequest|iwr)\b.*\|\s*(sh|bash|powershell|pwsh|iex)", re.I),
     "remote-exec", True, "piping a remote script into a shell"),
    (re.compile(r"\bInvoke-Expression\b|\biex\b", re.I), "remote-exec", False,
     "dynamic code execution"),
    (re.compile(r"powershell(\.exe)?\b.*-(e|enc|encodedcommand)\b", re.I), "obfuscation", True,
     "encoded PowerShell command"),
    (re.compile(r"-\w*[ew]\s+[A-Za-z0-9+/]{80,}={0,2}", ), "obfuscation", True,
     "long base64 payload argument"),
    (re.compile(r"\bDDoS\b|\bkeylog|\bmimikatz\b|\bpsexec\b.*-accepteula\s+-s\b", re.I),
     "malware", True, "known offensive tooling"),
    (re.compile(r">\s*/dev/sd[a-z]|\bmkfs\b|\bdd\s+if=.*of=/dev/", re.I), "disk", True,
     "raw device write"),
    (re.compile(r"\bchmod\s+(-R\s+)?0?777\b", re.I), "acl", False, "world-writable permissions"),
    (re.compile(r"\bgit\s+push\b.*--force\b|\bgit\s+reset\s+--hard\b", re.I), "vcs", False,
     "destructive VCS operation"),
]


class CommandGuard:
    def __init__(self, allowlist: set[str] | None = None, *, strict: bool = True) -> None:
        self.allowlist = set(allowlist) if allowlist is not None else set(DEFAULT_ALLOWLIST)
        self.strict = strict

    @staticmethod
    def tokenize(command: str) -> list[str]:
        try:
            return shlex.split(command, posix=True)
        except ValueError:
            return command.split()

    @staticmethod
    def _basename(executable: str) -> str:
        e = executable.strip().strip('"').replace("\\\\", "\\")
        e = re.split(r"[/\\]", e)[-1]
        return re.sub(r"\.(exe|bat|cmd|com|ps1)$", "", e, flags=re.I).lower()

    def evaluate(self, command: str, *, authorized: bool = False,
                 inside_trusted_shell: bool = False) -> CommandVerdict:
        """Classify a command line.

        Rules are evaluated against the *whole* command line before any shell
        wrapper is unwrapped, so ``powershell -enc <base64>`` cannot hide an
        obfuscated payload behind its own recursion.
        """
        cmd = (command or "").strip()
        if not cmd:
            return CommandVerdict(False, "empty command", category="invalid")

        argv = self.tokenize(cmd)
        if not argv:
            return CommandVerdict(False, "unparseable command", category="invalid")

        exe = self._basename(argv[0])

        # ---- layer 2: deny / confirm rules over the raw command line ----
        matched: list[str] = []
        category = "generic"
        denied_reason = ""
        needs_auth = False
        for pat, cat, deny, reason in _RULES:
            if pat.search(cmd):
                matched.append(reason)
                category = cat
                if deny and not denied_reason:
                    denied_reason = reason
                elif not deny:
                    needs_auth = True

        if denied_reason:
            log.warning("command DENIED (%s): %.160s", denied_reason, cmd)
            return CommandVerdict(False, f"blocked by policy: {denied_reason}",
                                  category=category, executable=exe, argv=argv,
                                  matched_rules=matched)

        # ---- layer 1: unwrap shell payloads and evaluate them too -------
        if exe in {"cmd", "powershell", "pwsh", "sh", "bash", "zsh"} and len(argv) > 1:
            switches = {"/c", "/k", "-c", "-command", "--command", "-e", "-enc",
                        "-encodedcommand", "-file", "-f"}
            idx = next((i for i, a in enumerate(argv) if a.lower() in switches), None)
            payload = " ".join(argv[idx + 1:]) if idx is not None else " ".join(argv[1:])
            if payload.strip() and payload.strip() != cmd:
                inner = self.evaluate(payload, authorized=authorized,
                                      inside_trusted_shell=exe in TRUSTED_SHELLS)
                if not inner.allowed:
                    inner.executable = exe
                    inner.argv = argv
                    inner.matched_rules = matched + [f"wrapper:{exe}"] + inner.matched_rules
                    if inner.needs_authorization:
                        inner.reason = f"{exe} payload: {inner.reason}"
                    return inner

        # ---- layer 3: executable classification -------------------------
        if exe in ELEVATION_EXECUTABLES:
            needs_auth = True
            category = "privileged"
            matched.append(f"privileged-executable:{exe}")

        if authorized:
            return CommandVerdict(True, "explicitly authorized by user", category=category,
                                  executable=exe, argv=argv, matched_rules=matched)

        if needs_auth:
            return CommandVerdict(False, "requires user authorization: " + "; ".join(matched),
                                  needs_authorization=True, category=category,
                                  executable=exe, argv=argv, matched_rules=matched)

        if exe in self.allowlist:
            return CommandVerdict(True, "allowlisted executable", category=category,
                                  executable=exe, argv=argv, matched_rules=matched)

        if inside_trusted_shell:
            return CommandVerdict(True, "trusted shell payload, no dangerous pattern matched",
                                  category="shell", executable=exe, argv=argv,
                                  matched_rules=matched)

        return CommandVerdict(
            allowed=not self.strict,
            reason="executable not on allowlist",
            needs_authorization=self.strict, category=category, executable=exe, argv=argv,
            matched_rules=matched)


_guard: CommandGuard | None = None


def get_command_guard() -> CommandGuard:
    global _guard
    if _guard is None:
        _guard = CommandGuard()
    return _guard


def set_command_guard(g: CommandGuard) -> None:
    global _guard
    _guard = g
