"""Unit and integration tests for Admin Authentication and Rate Limiting (Step 1.2)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from httpx import AsyncClient

from app.auth import JWT_ALGORITHM, SESSION_COOKIE_NAME, verify_admin_credentials
from app.config import Settings


async def test_ping_endpoint_is_public(async_client: AsyncClient) -> None:
    """GET /api/v1/system/ping returns 200 OK without authentication."""
    resp = await async_client.get("/api/v1/system/ping")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_me_requires_authentication(async_client: AsyncClient) -> None:
    """GET /api/v1/auth/me returns 401 when no session cookie is present."""
    resp = await async_client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_login_success_me_and_logout_flow(
    async_client: AsyncClient, test_settings: Settings
) -> None:
    """Valid admin login sets HttpOnly cookie, /me succeeds, and /logout clears session."""
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200
    data = login_resp.json()
    assert data["username"] == "admin"
    assert data["authenticated"] is True
    assert SESSION_COOKIE_NAME in login_resp.cookies

    me_resp = await async_client.get("/api/v1/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["username"] == "admin"

    logout_resp = await async_client.post("/api/v1/auth/logout")
    assert logout_resp.status_code == 200
    assert logout_resp.json()["status"] == "logged_out"

    async_client.cookies.delete(SESSION_COOKIE_NAME)
    me_after = await async_client.get("/api/v1/auth/me")
    assert me_after.status_code == 401


async def test_login_rejects_wrong_password_and_enforces_rate_limit(
    async_client: AsyncClient, test_settings: Settings
) -> None:
    """Repeated failed logins return 401 and then 429 once auth_rate_limit_attempts is reached."""
    for _ in range(test_settings.auth_rate_limit_attempts):
        resp = await async_client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        )
        assert resp.status_code == 401

    # Next attempt within window must be blocked with 429 Too Many Requests
    blocked_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "admin",
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert blocked_resp.status_code == 429


async def test_expired_and_tampered_jwt_cookies_rejected(
    async_client: AsyncClient, test_settings: Settings
) -> None:
    """Expired or invalidly signed JWT session cookies are rejected with 401."""
    expired_payload = {
        "sub": test_settings.admin_username,
        "iat": int((datetime.now(UTC) - timedelta(hours=2)).timestamp()),
        "exp": int((datetime.now(UTC) - timedelta(hours=1)).timestamp()),
        "type": "admin_session",
    }
    expired_token = jwt.encode(
        expired_payload,
        test_settings.app_secret_key.get_secret_value(),
        algorithm=JWT_ALGORITHM,
    )
    async_client.cookies.set(SESSION_COOKIE_NAME, expired_token)
    resp_expired = await async_client.get("/api/v1/auth/me")
    assert resp_expired.status_code == 401
    assert "expired" in resp_expired.json()["detail"].lower()

    tampered_token = jwt.encode(
        {
            "sub": test_settings.admin_username,
            "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            "type": "admin_session",
        },
        "wrong_signing_secret_0123456789abcdef0123456789abcdef",
        algorithm=JWT_ALGORITHM,
    )
    async_client.cookies.set(SESSION_COOKIE_NAME, tampered_token)
    resp_tampered = await async_client.get("/api/v1/auth/me")
    assert resp_tampered.status_code == 401


def test_argon2_prehashed_admin_password_supported(test_settings: Settings) -> None:
    """verify_admin_credentials supports both plaintext and pre-hashed Argon2id passwords."""
    ph = PasswordHasher()
    hashed = ph.hash("MySuperSecretAdminPass!")
    hashed_settings = test_settings.model_copy(update={"admin_password": hashed})

    assert verify_admin_credentials("admin", "MySuperSecretAdminPass!", hashed_settings) is True
    assert verify_admin_credentials("admin", "WrongPassword", hashed_settings) is False
    assert (
        verify_admin_credentials("wronguser", "MySuperSecretAdminPass!", hashed_settings) is False
    )
