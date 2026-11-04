"""Shared pytest fixtures for backend unit and integration tests."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import login_rate_limiter
from app.config import Settings, clear_runtime_overrides, get_settings
from app.db import dispose_db, init_db
from app.main import create_app


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> None:
    """Clear login rate limiter and runtime settings overrides before and after each test."""
    login_rate_limiter.clear_all()
    clear_runtime_overrides()
    yield
    login_rate_limiter.clear_all()
    clear_runtime_overrides()


@pytest.fixture()
def test_settings(tmp_path: Path) -> Settings:
    """Return isolated test Settings backed by an ephemeral SQLite file."""
    db_file = tmp_path / "test_gateway.db"
    return Settings(
        _env_file=None,
        app_env="testing",
        app_port=8080,
        tz="America/Los_Angeles",
        app_secret_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        admin_username="admin",
        admin_password="TestStrongPassword!2026",
        session_expire_minutes=60,
        auth_rate_limit_attempts=3,
        auth_rate_limit_window_seconds=60,
        database_url=f"sqlite+aiosqlite:///{db_file.as_posix()}",
        opnsense_base_url="https://opnsense.example.local",
        opnsense_api_key="test_opn_key",
        opnsense_api_secret="test_opn_secret",
        opnsense_verify_ssl=True,
        opnsense_block_alias="gateway_blocked_devices",
        opnsense_protected_ips="192.168.1.1,192.168.1.10",
        elasticsearch_url="https://elasticsearch.example.local:9200",
        elasticsearch_api_key="dGVzdF9pZDp0ZXN0X3NlY3JldA==",
        elasticsearch_verify_ssl=True,
        elasticsearch_index_patterns="logs-pfsense.log*",
    )


@pytest.fixture()
async def initialized_db(test_settings: Settings) -> AsyncGenerator[Settings, None]:
    """Initialize an isolated SQLite database for model and service unit tests."""
    await dispose_db()
    await init_db(test_settings)
    yield test_settings
    await dispose_db()


@pytest.fixture()
async def async_client(test_settings: Settings) -> AsyncGenerator[AsyncClient, None]:
    """Provide an httpx AsyncClient wired to a test FastAPI app and ephemeral SQLite DB."""
    await dispose_db()
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: test_settings
    await init_db(test_settings)

    transport = ASGITransport(app=app, client=("192.168.1.25", 54321))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    app.dependency_overrides.clear()
    await dispose_db()
