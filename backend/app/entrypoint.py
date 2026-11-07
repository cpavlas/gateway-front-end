"""Container entrypoint that ensures SQLite volume ownership before dropping to non-root user."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from app.db import extract_sqlite_file_path

logger = logging.getLogger(__name__)

GATEWAY_UID = 10001
GATEWAY_GID = 10001
GATEWAY_USER = "gateway"
DEFAULT_DATA_DIR = Path("/app/data")
DEFAULT_CMD = ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]  # noqa: S104


def resolve_target_data_dirs(env: dict[str, str] | None = None) -> list[Path]:
    """Return unique SQLite data directories that must be writable by the gateway user."""
    environ = env if env is not None else dict(os.environ)
    dirs: list[Path] = [DEFAULT_DATA_DIR]

    sqlite_path_raw = environ.get("SQLITE_DB_PATH", "").strip().strip("\"'")
    if sqlite_path_raw:
        dirs.append(Path(sqlite_path_raw).parent)

    db_url_raw = environ.get("DATABASE_URL", "").strip().strip("\"'")
    if db_url_raw.startswith("sqlite+aiosqlite:///app/"):
        db_url_raw = "sqlite+aiosqlite:////" + db_url_raw[len("sqlite+aiosqlite:///") :]
    extracted = extract_sqlite_file_path(db_url_raw)
    if extracted is not None:
        dirs.append(extracted.parent)

    unique: list[Path] = []
    for d in dirs:
        if d not in unique:
            unique.append(d)
    return unique


def prepare_sqlite_directories(
    dirs: list[Path],
    uid: int = GATEWAY_UID,
    gid: int = GATEWAY_GID,
) -> list[Path]:
    """Create SQLite directories and fix ownership/permissions when running as root."""
    prepared: list[Path] = []
    is_root = getattr(os, "geteuid", lambda: -1)() == 0
    chown_fn = getattr(os, "chown", None)

    for directory in dirs:
        try:
            directory.mkdir(parents=True, exist_ok=True)
            if is_root and callable(chown_fn):
                chown_fn(directory, uid, gid)
                directory.chmod(0o775)
                for child in directory.iterdir():
                    try:
                        chown_fn(child, uid, gid)
                    except OSError:
                        pass
            prepared.append(directory)
        except OSError as exc:
            logger.warning("Could not prepare SQLite directory '%s': %s", directory, exc)
    return prepared


def drop_privileges_if_root(
    uid: int = GATEWAY_UID,
    gid: int = GATEWAY_GID,
    username: str = GATEWAY_USER,
) -> bool:
    """Drop root privileges to the unprivileged gateway user if currently UID 0."""
    geteuid_fn = getattr(os, "geteuid", None)
    if not callable(geteuid_fn) or geteuid_fn() != 0:
        return False

    initgroups_fn = getattr(os, "initgroups", None)
    setgid_fn = getattr(os, "setgid", None)
    setuid_fn = getattr(os, "setuid", None)

    if callable(initgroups_fn):
        try:
            initgroups_fn(username, gid)
        except OSError:
            pass
    if callable(setgid_fn):
        setgid_fn(gid)
    if callable(setuid_fn):
        setuid_fn(uid)
    os.environ["HOME"] = f"/home/{username}"
    os.environ["USER"] = username
    return True


def main(argv: list[str] | None = None) -> None:
    """Prepare SQLite directories, drop root privileges to gateway, and exec uvicorn."""
    target_dirs = resolve_target_data_dirs()
    prepare_sqlite_directories(target_dirs)
    drop_privileges_if_root()

    args = list(argv) if argv is not None else sys.argv[1:]
    cmd = args if args else list(DEFAULT_CMD)
    os.execvp(cmd[0], cmd)  # noqa: S606


if __name__ == "__main__":  # pragma: no cover
    main()

