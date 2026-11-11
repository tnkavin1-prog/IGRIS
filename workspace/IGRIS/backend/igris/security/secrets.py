"""Secret storage.

Priority order:
  1. Windows DPAPI (``CryptProtectData``) — per-user, per-machine binding.
     This is what IGRIS uses on the target platform; no key material ever
     leaves the process in plaintext.
  2. OS keyring (``keyring``) — macOS Keychain / SecretService / Windows CredMan.
  3. AES-256-GCM file vault with a machine-bound key (0600) — last resort so
     the product still works on platforms without a credential store.

The backend reports which mechanism is active so the UI can tell the user the
truth about protection strength. Plaintext is never logged and never returned
to the frontend: callers receive a masked fingerprint only.
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import platform
import secrets as pysecrets
import sys
from pathlib import Path
from typing import Any

from ..core.logging_setup import get_logger, register_secret

log = get_logger("security.secrets")

SERVICE = "IGRIS"
ACCOUNT = "gemini_api_key"


if sys.platform == "win32":
    import ctypes.wintypes  # only importable on Windows

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_char))]
else:  # pragma: no cover - non-Windows dev/test hosts
    class DATA_BLOB(ctypes.Structure):  # type: ignore[no-redef]
        _fields_ = [("cbData", ctypes.c_uint32),
                    ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> DATA_BLOB:
    buf = ctypes.create_string_buffer(data, len(data))
    return DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _read_blob(blob: DATA_BLOB) -> bytes:
    try:
        return ctypes.string_at(blob.pbData, blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob.pbData)  # type: ignore[attr-defined]


class SecretBackend:
    name = "unknown"
    #: True when the backend binds ciphertext to the current OS user/machine.
    user_bound = False

    def store(self, key: str, value: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def load(self, key: str) -> str | None:  # pragma: no cover - interface
        raise NotImplementedError

    def delete(self, key: str) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class DPAPIBackend(SecretBackend):
    """Windows Data Protection API via crypt32."""

    name = "windows-dpapi"
    user_bound = True

    def store(self, key: str, value: str) -> None:
        payload = json.dumps({"k": key, "v": value}).encode()
        out = DATA_BLOB()
        ok = ctypes.windll.crypt32.CryptProtectData(  # type: ignore[attr-defined]
            ctypes.byref(_blob(payload)), "IGRIS", None, None, None, 0, ctypes.byref(out))
        if not ok:
            raise OSError(f"CryptProtectData failed: {ctypes.GetLastError()}")
        try:
            data = _read_blob(out)
        finally:
            ctypes.windll.kernel32.LocalFree(out.pbData)  # type: ignore[attr-defined]
        _write_atomic(_store_path() / f"{_safe_name(key)}.dpapi", data)

    def load(self, key: str) -> str | None:
        p = _store_path() / f"{_safe_name(key)}.dpapi"
        if not p.exists():
            return None
        out = DATA_BLOB()
        ok = ctypes.windll.crypt32.CryptUnprotectData(  # type: ignore[attr-defined]
            ctypes.byref(_blob(p.read_bytes())), None, None, None, None, 0, ctypes.byref(out))
        if not ok:
            raise OSError(f"CryptUnprotectData failed: {ctypes.GetLastError()}")
        try:
            payload = json.loads(_read_blob(out).decode())
        finally:
            ctypes.windll.kernel32.LocalFree(out.pbData)  # type: ignore[attr-defined]
        return payload.get("v")

    def delete(self, key: str) -> None:
        (_store_path() / f"{_safe_name(key)}.dpapi").unlink(missing_ok=True)


class KeyringBackend(SecretBackend):
    name = "os-keyring"
    user_bound = True

    def __init__(self) -> None:
        import keyring  # imported lazily: optional dependency
        self._kr = keyring

    def store(self, key: str, value: str) -> None:
        self._kr.set_password(SERVICE, key, value)

    def load(self, key: str) -> str | None:
        return self._kr.get_password(SERVICE, key)

    def delete(self, key: str) -> None:
        try:
            self._kr.delete_password(SERVICE, key)
        except Exception:
            pass


class FileVaultBackend(SecretBackend):
    """AES-256-GCM vault. Key = HKDF(machine id + random salt file, 0600)."""

    name = "encrypted-file-vault"
    user_bound = True

    def _key(self) -> bytes:
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        from cryptography.hazmat.primitives import hashes

        store = _store_path()
        salt_file = store / "vault.salt"
        if salt_file.exists():
            salt = salt_file.read_bytes()
        else:
            salt = pysecrets.token_bytes(32)
            _write_atomic(salt_file, salt, mode=0o600)
        ikm = (_machine_id() + ":" + salt.hex()).encode()
        return HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
                    info=b"igris-file-vault-v1").derive(ikm)

    def store(self, key: str, value: str) -> None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        nonce = pysecrets.token_bytes(12)
        ct = AESGCM(self._key()).encrypt(nonce, value.encode(), key.encode())
        _write_atomic(_store_path() / f"{_safe_name(key)}.vault",
                      json.dumps({"n": base64.b64encode(nonce).decode(),
                                  "c": base64.b64encode(ct).decode()}).encode(), mode=0o600)

    def load(self, key: str) -> str | None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        p = _store_path() / f"{_safe_name(key)}.vault"
        if not p.exists():
            return None
        blob = json.loads(p.read_text())
        nonce = base64.b64decode(blob["n"])
        ct = base64.b64decode(blob["c"])
        return AESGCM(self._key()).decrypt(nonce, ct, key.encode()).decode()

    def delete(self, key: str) -> None:
        (_store_path() / f"{_safe_name(key)}.vault").unlink(missing_ok=True)


class MemoryBackend(SecretBackend):
    """Ephemeral; used by tests and by --no-persist-secrets."""
    name = "memory"
    user_bound = False

    def __init__(self) -> None:
        self._d: dict[str, str] = {}

    def store(self, key: str, value: str) -> None:
        self._d[key] = value

    def load(self, key: str) -> str | None:
        return self._d.get(key)

    def delete(self, key: str) -> None:
        self._d.pop(key, None)


# ---------------------------------------------------------------- helpers
_store_root: Path | None = None


def configure(store_root: Path) -> None:
    global _store_root
    _store_root = Path(store_root)


def _store_path() -> Path:
    root = _store_root or Path(os.environ.get("IGRIS_HOME", Path.home() / ".igris")) / "secrets"
    root.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(root, 0o700)
    except OSError:
        pass
    return root


def _safe_name(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:24]


def _write_atomic(p: Path, data: bytes, mode: int = 0o600) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    try:
        os.chmod(tmp, mode)
    except OSError:
        pass
    os.replace(tmp, p)


def _machine_id() -> str:
    for env in ("IGRIS_MACHINE_ID", "MACHINE_GUID"):
        if os.environ.get(env):
            return os.environ[env]
    candidates = [Path("/etc/machine-id"), Path("/var/lib/dbus/machine-id")]
    for c in candidates:
        try:
            if c.exists():
                return c.read_text().strip()
        except OSError:
            pass
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"SOFTWARE\Microsoft\Cryptography") as k:
                return str(winreg.QueryValueEx(k, "MachineGuid")[0])
        except Exception:
            pass
    return platform.node() + "|" + str(os.getuid() if hasattr(os, "getuid") else "")


_backend: SecretBackend | None = None
_backend_error: str = ""


def _probe(b: SecretBackend) -> str | None:
    """A backend is only trusted after a real store/load/delete round-trip.

    Constructing ``keyring`` succeeds even when no credential store exists; the
    failure only surfaces on first use. Probing avoids selecting a backend that
    would break at runtime.
    """
    key = f"__igris_probe__{pysecrets.token_hex(4)}"
    value = pysecrets.token_urlsafe(12)
    try:
        b.store(key, value)
        if b.load(key) != value:
            return "round-trip mismatch"
        b.delete(key)
        return None
    except Exception as exc:
        try:
            b.delete(key)
        except Exception:
            pass
        return f"{type(exc).__name__}: {exc}"


def _select_backend(force: str | None = None) -> SecretBackend:
    global _backend_error
    if force == "memory":
        return MemoryBackend()
    order: list[tuple[str, Any]] = []
    if sys.platform == "win32":
        order.append(("dpapi", DPAPIBackend))
    order += [("keyring", KeyringBackend), ("vault", FileVaultBackend)]
    errors: list[str] = []
    for name, factory in order:
        if force and force != name:
            continue
        try:
            candidate = factory()
        except Exception as exc:
            errors.append(f"{name}: construct: {type(exc).__name__}: {exc}")
            continue
        problem = _probe(candidate)
        if problem is None:
            return candidate
        errors.append(f"{name}: probe: {problem}")
        log.warning("secret backend %s rejected (%s)", name, problem)
    _backend_error = " | ".join(errors)
    log.error("no persistent secret backend available; using ephemeral memory. %s", _backend_error)
    return MemoryBackend()


def get_backend(force: str | None = None) -> SecretBackend:
    global _backend
    if _backend is None or force:
        _backend = _select_backend(force)
        log.info("secret backend: %s (user_bound=%s)", _backend.name, _backend.user_bound)
    return _backend


def backend_info() -> dict[str, Any]:
    b = get_backend()
    return {"backend": b.name, "user_bound": b.user_bound,
            "platform": sys.platform, "fallback_error": _backend_error}


def set_secret(key: str, value: str) -> None:
    register_secret(value)
    get_backend().store(key, value)
    log.info("stored secret %r via %s", key, get_backend().name)


def get_secret(key: str) -> str | None:
    try:
        v = get_backend().load(key)
    except Exception as exc:
        log.error("failed to read secret %r: %s", key, exc)
        return None
    if v:
        register_secret(v)
    return v


def delete_secret(key: str) -> None:
    get_backend().delete(key)


def mask(value: str | None) -> str:
    """Fingerprint safe to show in the UI (never the key itself)."""
    if not value:
        return ""
    h = hashlib.sha256(value.encode()).hexdigest()[:8]
    return f"{value[:4]}…{value[-4:]} (sha256:{h})"
