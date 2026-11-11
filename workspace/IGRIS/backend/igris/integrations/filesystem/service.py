"""Real local file-system service.

All operations go through :class:`PathGuard`, so IGRIS can only touch
directories the user authorized. Nothing here is simulated: reads return real
bytes, writes are flushed and re-stat'ed, and every mutating call reports the
observed post-condition (size + sha256) so the caller can verify it.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import mimetypes
import os
import re
import shutil
import stat
import time
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from ...core.errors import PermissionDenied, ResourceMissing, ValidationError
from ...core.logging_setup import get_logger
from ...security.path_guard import PathGuard

log = get_logger("integrations.filesystem")

TEXT_SUFFIXES = {".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".csv",
                 ".tsv", ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss", ".xml",
                 ".sql", ".sh", ".ps1", ".bat", ".log", ".blend.py", ".gitignore", ".env.example"}
MAX_TEXT_INLINE = 512 * 1024
MAX_IMAGE_INLINE = 8 * 1024 * 1024


@dataclass(slots=True)
class FileInfo:
    path: str
    name: str
    exists: bool
    is_dir: bool
    is_file: bool
    size_bytes: int
    modified_at: float | None
    created_at: float | None
    sha256: str
    mime: str
    extension: str
    readable: bool
    writable: bool
    symlink: bool
    target: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def sha256_of(path: Path, *, limit: int = 256 * 1024 * 1024) -> str:
    if not path.is_file():
        return ""
    if path.stat().st_size > limit:
        # hash head+tail+size for very large files (fast, still collision-resistant enough
        # for duplicate detection inside one project)
        h = hashlib.sha256()
        with path.open("rb") as fh:
            h.update(fh.read(1 << 20))
            fh.seek(max(0, path.stat().st_size - (1 << 20)))
            h.update(fh.read(1 << 20))
        h.update(str(path.stat().st_size).encode())
        return "partial-" + h.hexdigest()
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class FileSystemService:
    def __init__(self, guard: PathGuard) -> None:
        self.guard = guard

    # ------------------------------------------------------------ inspect
    def info(self, raw: str | Path) -> FileInfo:
        p = self.guard.check(raw)
        exists = p.exists()
        st = p.stat() if exists else None
        is_dir = bool(st and stat.S_ISDIR(st.st_mode))
        is_file = bool(st and stat.S_ISREG(st.st_mode))
        return FileInfo(
            path=str(p), name=p.name, exists=exists, is_dir=is_dir, is_file=is_file,
            size_bytes=st.st_size if st else 0,
            modified_at=st.st_mtime if st else None,
            created_at=getattr(st, "st_birthtime", st.st_ctime if st else None),
            sha256=sha256_of(p) if is_file else "",
            mime=(mimetypes.guess_type(p.name)[0] or ("directory" if is_dir else "application/octet-stream")),
            extension=p.suffix.lower(),
            readable=bool(st and os.access(p, os.R_OK)),
            writable=os.access(p.parent if not is_dir else p, os.W_OK),
            symlink=p.is_symlink(),
            target=str(p.resolve()) if p.is_symlink() else None)

    def exists(self, raw: str | Path) -> bool:
        try:
            return self.guard.check(raw).exists()
        except (PermissionDenied, ValidationError):
            return False

    def list_dir(self, raw: str | Path, *, recursive: bool = False,
                 pattern: str | None = None, limit: int = 2000) -> list[dict[str, Any]]:
        root = self.guard.check(raw, must_exist=True)
        if not root.is_dir():
            raise ValidationError(f"{root} is not a directory")
        out: list[dict[str, Any]] = []
        it: Iterable[Path] = root.rglob("*") if recursive else root.iterdir()
        for entry in it:
            if len(out) >= limit:
                break
            try:
                if pattern and not fnmatch.fnmatch(entry.name.lower(), pattern.lower()):
                    continue
                st = entry.stat()
                out.append({"path": str(entry), "name": entry.name,
                            "is_dir": entry.is_dir(), "size_bytes": st.st_size,
                            "modified_at": st.st_mtime, "extension": entry.suffix.lower()})
            except OSError as exc:
                out.append({"path": str(entry), "name": entry.name, "error": str(exc)})
        return out

    def search(self, root: str | Path, *, name_pattern: str | None = None,
               content_pattern: str | None = None, max_size: int = 4 * 1024 * 1024,
               limit: int = 200, include_dirs: bool = False) -> list[dict[str, Any]]:
        base = self.guard.check(root, must_exist=True)
        rx = re.compile(content_pattern, re.I) if content_pattern else None
        results: list[dict[str, Any]] = []
        for entry in base.rglob("*"):
            if len(results) >= limit:
                break
            try:
                if entry.is_dir():
                    if include_dirs and name_pattern and fnmatch.fnmatch(entry.name.lower(), name_pattern.lower()):
                        results.append({"path": str(entry), "is_dir": True, "match": "name"})
                    continue
                if name_pattern and not fnmatch.fnmatch(entry.name.lower(), name_pattern.lower()):
                    continue
                item: dict[str, Any] = {"path": str(entry), "is_dir": False,
                                        "size_bytes": entry.stat().st_size,
                                        "modified_at": entry.stat().st_mtime}
                if rx is not None:
                    if entry.stat().st_size > max_size:
                        continue
                    try:
                        text = entry.read_text(encoding="utf-8", errors="ignore")
                    except OSError:
                        continue
                    m = rx.search(text)
                    if not m:
                        continue
                    item["match"] = "content"
                    item["excerpt"] = text[max(0, m.start() - 80):m.start() + 160]
                else:
                    item["match"] = "name"
                results.append(item)
            except OSError:
                continue
        return results

    # --------------------------------------------------------------- read
    def read_text(self, raw: str | Path, *, encoding: str = "utf-8",
                  max_bytes: int = MAX_TEXT_INLINE, offset: int = 0) -> dict[str, Any]:
        p = self.guard.check_read(raw)
        if p.is_dir():
            raise ValidationError(f"{p} is a directory, not a text file")
        size = p.stat().st_size
        if size > max_bytes:
            with p.open("rb") as fh:
                fh.seek(offset)
                data = fh.read(max_bytes)
            truncated = True
        else:
            data = p.read_bytes()[offset:offset + max_bytes]
            truncated = size > offset + max_bytes
        return {"path": str(p), "size_bytes": size, "encoding": encoding,
                "content": data.decode(encoding, errors="replace"),
                "truncated": truncated, "lines": data.decode(encoding, errors="replace").count("\n") + 1}

    def read_binary_b64(self, raw: str | Path, *, max_bytes: int = MAX_IMAGE_INLINE) -> dict[str, Any]:
        import base64
        p = self.guard.check_read(raw)
        if not p.is_file():
            raise ValidationError(f"{p} is not a file")
        data = p.read_bytes()[:max_bytes]
        return {"path": str(p), "size_bytes": p.stat().st_size,
                "mime": mimetypes.guess_type(p.name)[0] or "application/octet-stream",
                "data_b64": base64.b64encode(data).decode(),
                "truncated": p.stat().st_size > max_bytes}

    def read_json(self, raw: str | Path) -> Any:
        d = self.read_text(raw)
        return json.loads(d["content"])

    # -------------------------------------------------------------- write
    def write_text(self, raw: str | Path, content: str, *, encoding: str = "utf-8",
                   append: bool = False, mkdirs: bool = True) -> dict[str, Any]:
        p = self.guard.check_write(raw)
        if p.exists() and p.is_dir():
            raise ValidationError(f"{p} is a directory")
        if mkdirs:
            p.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with p.open(mode, encoding=encoding, newline="\n") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        info = self.info(p)
        return {"path": info.path, "bytes_written": len(content.encode(encoding)),
                "size_bytes": info.size_bytes, "sha256": info.sha256, "append": append,
                "verified_exists": info.exists and info.is_file}

    def write_bytes(self, raw: str | Path, data: bytes, *, mkdirs: bool = True) -> dict[str, Any]:
        p = self.guard.check_write(raw)
        if mkdirs:
            p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, p)
        info = self.info(p)
        return {"path": info.path, "size_bytes": info.size_bytes, "sha256": info.sha256,
                "verified_exists": info.exists and info.is_file}

    def write_json(self, raw: str | Path, obj: Any, *, indent: int = 2) -> dict[str, Any]:
        return self.write_text(raw, json.dumps(obj, indent=indent, ensure_ascii=False, default=str))

    # ------------------------------------------------------------ mutate
    def mkdir(self, raw: str | Path) -> dict[str, Any]:
        p = self.guard.check_write(raw)
        p.mkdir(parents=True, exist_ok=True)
        return {"path": str(p), "is_dir": p.is_dir()}

    def rename(self, src: str | Path, dst: str | Path, *, overwrite: bool = False) -> dict[str, Any]:
        s = self.guard.check(src, must_exist=True)
        d = self.guard.check_write(dst)
        if d.exists() and not overwrite:
            raise ValidationError(f"destination {d} already exists (pass overwrite=true)")
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))
        return {"from": str(s), "to": str(d), "verified": d.exists() and not s.exists()}

    def copy(self, src: str | Path, dst: str | Path, *, overwrite: bool = False) -> dict[str, Any]:
        s = self.guard.check_read(src)
        d = self.guard.check_write(dst)
        if d.exists() and not overwrite:
            raise ValidationError(f"destination {d} already exists (pass overwrite=true)")
        d.parent.mkdir(parents=True, exist_ok=True)
        if s.is_dir():
            shutil.copytree(s, d, dirs_exist_ok=True)
        else:
            shutil.copy2(s, d)
        src_hash, dst_hash = sha256_of(s), sha256_of(d)
        return {"from": str(s), "to": str(d), "size_bytes": d.stat().st_size,
                "sha256": dst_hash, "verified_identical": src_hash == dst_hash and d.exists()}

    def delete(self, raw: str | Path, *, recursive: bool = False) -> dict[str, Any]:
        """Delete is ALWAYS gated by an explicit authorization upstream."""
        p = self.guard.check_write(raw)
        if not p.exists():
            raise ResourceMissing(f"{p} does not exist")
        before = str(p)
        if p.is_dir():
            if not recursive:
                raise ValidationError(f"{p} is a directory; recursive=true required")
            shutil.rmtree(p)
        else:
            p.unlink()
        return {"path": before, "verified_gone": not Path(before).exists()}

    def extract_archive(self, archive: str | Path, dest: str | Path) -> dict[str, Any]:
        a = self.guard.check_read(archive)
        d = self.guard.check_write(dest)
        d.mkdir(parents=True, exist_ok=True)
        if not zipfile.is_zipfile(a):
            raise ValidationError(f"{a} is not a zip archive (tar support: use media tool)")
        extracted: list[str] = []
        with zipfile.ZipFile(a) as zf:
            for member in zf.namelist():
                # zip-slip protection
                target = (d / member).resolve()
                if not str(target).startswith(str(d.resolve())):
                    raise PermissionDenied(f"archive member escapes destination: {member}")
                extracted.append(member)
            zf.extractall(d)
        return {"archive": str(a), "destination": str(d), "entries": len(extracted),
                "files": extracted[:200],
                "verified": all((d / e).exists() for e in extracted if not e.endswith("/"))}

    # --------------------------------------------------------- organizing
    def find_duplicates(self, root: str | Path, *, min_size: int = 1,
                        limit: int = 5000) -> list[dict[str, Any]]:
        """Size-bucketed then hash-verified duplicate detection."""
        base = self.guard.check(root, must_exist=True)
        buckets: dict[int, list[Path]] = {}
        for entry in base.rglob("*"):
            if not entry.is_file():
                continue
            try:
                sz = entry.stat().st_size
            except OSError:
                continue
            if sz < min_size:
                continue
            buckets.setdefault(sz, []).append(entry)
            if sum(len(v) for v in buckets.values()) > limit:
                break
        groups: list[dict[str, Any]] = []
        for sz, files in buckets.items():
            if len(files) < 2:
                continue
            by_hash: dict[str, list[Path]] = {}
            for f in files:
                try:
                    by_hash.setdefault(sha256_of(f), []).append(f)
                except OSError:
                    continue
            for h, dupes in by_hash.items():
                if len(dupes) > 1:
                    groups.append({"sha256": h, "size_bytes": sz, "count": len(dupes),
                                   "wasted_bytes": sz * (len(dupes) - 1),
                                   "paths": [str(d) for d in sorted(dupes)]})
        groups.sort(key=lambda g: g["wasted_bytes"], reverse=True)
        return groups

    def categorize(self, name: str) -> str:
        ext = Path(name).suffix.lower().lstrip(".")
        table = {
            "Documents": {"pdf", "doc", "docx", "odt", "rtf", "txt", "md", "tex", "pages",
                          "epub", "mobi", "xls", "xlsx", "csv", "tsv", "ppt", "pptx", "odp",
                          "key", "numbers", "json", "yaml", "yml", "xml", "ini", "log"},
            "Images": {"jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "svg",
                       "heic", "heif", "raw", "cr2", "nef", "ico", "avif"},
            "Videos": {"mp4", "mkv", "mov", "avi", "wmv", "flv", "webm", "m4v", "mpg",
                       "mpeg", "3gp", "ts", "m2ts"},
            "Audio": {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus", "aiff", "mid"},
            "Archives": {"zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "cab", "zst"},
            "Code": {"py", "js", "ts", "tsx", "jsx", "c", "h", "cpp", "hpp", "cs", "java",
                     "go", "rs", "rb", "php", "swift", "kt", "sh", "bat", "ps1", "sql",
                     "html", "css", "scss", "vue", "svelte", "blend", "glsl"},
            "Executables": {"exe", "msi", "appx", "dll", "apk", "deb", "rpm", "appimage",
                            "jar", "com", "scr"},
            "Fonts": {"ttf", "otf", "woff", "woff2", "eot"},
            "3D": {"obj", "fbx", "stl", "gltf", "glb", "usd", "usdz", "ply", "dae", "3ds",
                   "blend1"},
        }
        for cat, exts in table.items():
            if ext in exts:
                return cat
        return "Other"

    def organize_plan(self, root: str | Path, *, by: str = "type",
                      dry_run: bool = True) -> dict[str, Any]:
        """Build (and optionally apply) a sorting plan for a folder."""
        base = self.guard.check(root, must_exist=True)
        plan: dict[str, list[dict[str, Any]]] = {}
        total = 0
        for entry in sorted(base.iterdir()):
            if entry.is_dir():
                continue
            total += 1
            if by == "type":
                bucket = self.categorize(entry.name)
            elif by == "date":
                bucket = time.strftime("%Y-%m", time.localtime(entry.stat().st_mtime))
            else:
                bucket = entry.suffix.lower().lstrip(".") or "no-extension"
            plan.setdefault(bucket, []).append({
                "from": str(entry), "to": str(base / bucket / entry.name),
                "size_bytes": entry.stat().st_size})
        return {"root": str(base), "strategy": by, "dry_run": dry_run,
                "files_scanned": total, "buckets": len(plan),
                "plan": {k: v for k, v in sorted(plan.items())},
                "summary": {k: len(v) for k, v in sorted(plan.items())}}

    def organize_apply(self, plan: dict[str, Any]) -> dict[str, Any]:
        moved, failed = [], []
        for bucket, items in (plan.get("plan") or {}).items():
            for it in items:
                src = self.guard.check(it["from"], must_exist=True)
                dst = self.guard.check_write(it["to"])
                if dst.exists():
                    stem, suf = dst.stem, dst.suffix
                    n = 1
                    while dst.exists():
                        dst = dst.with_name(f"{stem} ({n}){suf}")
                        n += 1
                try:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(src), str(dst))
                    moved.append({"from": str(src), "to": str(dst),
                                  "verified": dst.exists() and not src.exists()})
                except OSError as exc:
                    failed.append({"from": str(src), "error": str(exc)})
        return {"moved": len(moved), "failed": len(failed), "details": moved[:200],
                "errors": failed[:50], "all_verified": all(m["verified"] for m in moved) and not failed}
