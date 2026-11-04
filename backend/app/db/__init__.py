"""Async SQLAlchemy engine and session management for SQLite."""

from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from fastapi import Depends
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings
from app.models import Base

logger = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def extract_sqlite_file_path(database_url: str) -> Path | None:
    """Return the filesystem Path for a file-backed SQLite database URL, or None for :memory:."""
    if not database_url.startswith("sqlite") or ":memory:" in database_url:
        return None
    try:
        url_obj = make_url(database_url)
        if url_obj.database and url_obj.database != ":memory:":
            return Path(url_obj.database)
    except Exception:
        pass
    prefix = "sqlite+aiosqlite:///"
    if database_url.startswith(prefix):
        raw_path = database_url[len(prefix) :]
        if raw_path:
            return Path(raw_path)
    return None


def _ensure_sqlite_parent_dir(database_url: str) -> str:
    """Ensure the parent directory for a file-backed SQLite URL exists and is writable.

    Returns the validated `database_url` (or a writable fallback URL in `/tmp/gateway-data`
    if the primary directory is not writable by the current container UID/GID).
    """
    db_path = extract_sqlite_file_path(database_url)
    if db_path is None:
        return database_url

    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.execute("PRAGMA user_version")
        conn.close()
        return database_url
    except (sqlite3.OperationalError, OSError) as exc:
        uid = getattr(os, "geteuid", lambda: -1)()
        gid = getattr(os, "getegid", lambda: -1)()
        fallback_dir = Path(tempfile.gettempdir()) / "gateway-data"
        fallback_dir.mkdir(parents=True, exist_ok=True)
        fallback_db = fallback_dir / db_path.name
        fallback_url = f"sqlite+aiosqlite:///{fallback_db.as_posix()}"
        logger.warning(
            "Unable to open SQLite database at '%s' (uid=%s, gid=%s, error=%s). "
            "Check host bind-mount ownership on '%s'. Falling back to writable path '%s'.",
            db_path,
            uid,
            gid,
            exc,
            db_path.parent,
            fallback_db,
        )
        return fallback_url


def _enable_sqlite_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
    """Enable SQLite foreign key enforcement (ON DELETE CASCADE) on every new connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def get_engine(settings: Settings | None = None) -> AsyncEngine:
    """Return or initialize the async SQLAlchemy engine."""
    global _engine
    if _engine is None:
        cfg = settings or get_settings()
        resolved_url = _ensure_sqlite_parent_dir(cfg.database_url)
        if resolved_url != cfg.database_url:
            cfg.database_url = resolved_url
        _engine = create_async_engine(
            resolved_url,
            echo=False,
            future=True,
        )
        if resolved_url.startswith("sqlite"):
            event.listen(_engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
    return _engine


def get_session_factory(settings: Settings | None = None) -> async_sessionmaker[AsyncSession]:
    """Return or initialize the async session factory."""
    global _session_factory
    if _session_factory is None:
        engine = get_engine(settings)
        _session_factory = async_sessionmaker(
            bind=engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


async def init_db(settings: Settings | None = None) -> None:
    """Ensure all database tables and non-destructive column migrations exist."""
    engine = get_engine(settings)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        res = await conn.execute(text("PRAGMA table_info(devices)"))
        existing_cols = {str(row[1]) for row in res.fetchall()}
        if existing_cols and "is_manually_blocked" not in existing_cols:
            await conn.execute(
                text(
                    "ALTER TABLE devices ADD COLUMN is_manually_blocked "
                    "BOOLEAN NOT NULL DEFAULT 0"
                )
            )
            await conn.execute(
                text("UPDATE devices SET is_manually_blocked = is_blocked")
            )
        if existing_cols and "is_youtube_blocked" not in existing_cols:
            await conn.execute(
                text(
                    "ALTER TABLE devices ADD COLUMN is_youtube_blocked "
                    "BOOLEAN NOT NULL DEFAULT 0"
                )
            )

        res_audit = await conn.execute(text("PRAGMA table_info(audit_logs)"))
        existing_audit_cols = {str(row[1]) for row in res_audit.fetchall()}
        if existing_audit_cols and "audit_label" not in existing_audit_cols:
            await conn.execute(
                text(
                    "ALTER TABLE audit_logs ADD COLUMN audit_label "
                    "VARCHAR(32) NOT NULL DEFAULT 'SYSTEM'"
                )
            )
            await conn.execute(
                text(
                    "UPDATE audit_logs SET audit_label = CASE "
                    "WHEN lower(action) LIKE 'auth.%' OR lower(action) LIKE 'login%' "
                    "OR lower(action) LIKE 'logout%' THEN 'AUTH_EVENT' "
                    "WHEN lower(action) LIKE 'user%' THEN 'USER_MGMT' "
                    "WHEN lower(action) LIKE 'diagnostic%' THEN 'DIAGNOSTIC_ERROR' "
                    "WHEN lower(action) LIKE 'settings%' THEN 'SETTINGS_CHANGE' "
                    "WHEN lower(action) LIKE '%youtube%' THEN 'YOUTUBE_CONTROL' "
                    "WHEN lower(action) LIKE 'device%' THEN 'DEVICE_CONTROL' "
                    "WHEN lower(action) LIKE 'group%' THEN 'GROUP_CONTROL' "
                    "WHEN lower(action) LIKE 'timer%' THEN 'TIMER_OVERRIDE' "
                    "WHEN lower(action) LIKE 'schedule%' THEN 'SCHEDULE_CHANGE' "
                    "WHEN lower(action) LIKE 'config%' OR lower(action) LIKE 'backup%' "
                    "OR lower(action) LIKE 'restore%' THEN 'CONFIG_BACKUP' "
                    "ELSE 'SYSTEM' END"
                )
            )


async def dispose_db() -> None:
    """Dispose the global engine and reset cached session factory."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_db_session(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an AsyncSession."""
    factory = get_session_factory(settings)
    async with factory() as session:
        yield session
