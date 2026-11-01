"""Async SQLAlchemy engine and session management for SQLite."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from fastapi import Depends
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings
from app.models import Base

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _ensure_sqlite_parent_dir(database_url: str) -> None:
    """Create parent directory for file-backed SQLite URLs if needed."""
    prefix = "sqlite+aiosqlite:///"
    if database_url.startswith(prefix) and ":memory:" not in database_url:
        raw_path = database_url[len(prefix) :]
        if raw_path:
            db_path = Path(raw_path)
            db_path.parent.mkdir(parents=True, exist_ok=True)


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
        _ensure_sqlite_parent_dir(cfg.database_url)
        _engine = create_async_engine(
            cfg.database_url,
            echo=False,
            future=True,
        )
        if cfg.database_url.startswith("sqlite"):
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
    """Ensure all database tables exist."""
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
