"""Authentication, Argon2id password verification, signed JWT cookies, and rate limiting."""

from __future__ import annotations

import hmac
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, SecretStr

from app.config import Settings, get_settings

SESSION_COOKIE_NAME = "gateway_session"
JWT_ALGORITHM = "HS256"

_ph = PasswordHasher()


class LoginRequest(BaseModel):
    """Credentials submitted to /api/v1/auth/login."""

    username: str
    password: str


class SetupStatusResponse(BaseModel):
    """First-boot setup status returned by GET /api/v1/auth/setup-status."""

    needs_initial_setup: bool
    admin_username: str = "admin"


class SetupAdminRequest(BaseModel):
    """Payload submitted to POST /api/v1/auth/setup-admin on clean container builds."""

    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str | None = None


class AuthUserResponse(BaseModel):
    """Authenticated user session info."""

    username: str
    role: Literal["admin", "operator"] = "admin"
    theme_preference: str = "default"
    authenticated: bool = True
    expires_at: str


def hash_password(password: str) -> str:
    """Hash a plaintext password using Argon2id."""
    cleaned = password.strip()
    if len(cleaned) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    return str(_ph.hash(cleaned))


def verify_password_hash(password: str, stored_hash: str) -> bool:
    """Verify a plaintext password against a stored Argon2id hash or plaintext secret."""
    if not stored_hash:
        return False
    if stored_hash.startswith("$argon2"):
        try:
            return bool(_ph.verify(stored_hash, password))
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    return hmac.compare_digest(password, stored_hash)


def is_protected_admin_username(username: str) -> bool:
    """Return True if the username is the built-in protected 'admin' account."""
    return username.strip().lower() == "admin"


class InMemoryLoginRateLimiter:
    """Sliding-window per-client-IP rate limiter for /api/v1/auth/login."""

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, ip: str, now: float, window_seconds: int) -> deque[float]:
        bucket = self._failures[ip]
        cutoff = now - window_seconds
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        return bucket

    def check_allowed(self, ip: str, max_attempts: int, window_seconds: int) -> None:
        """Raise 429 if the client IP has exceeded max_attempts failed logins within the window."""
        now = time.monotonic()
        bucket = self._prune(ip, now, window_seconds)
        if len(bucket) >= max_attempts:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Please wait before retrying.",
            )

    def record_failure(self, ip: str, window_seconds: int) -> None:
        """Record a failed login attempt for the client IP."""
        now = time.monotonic()
        bucket = self._prune(ip, now, window_seconds)
        bucket.append(now)

    def reset_ip(self, ip: str) -> None:
        """Clear failed attempts on successful login."""
        self._failures.pop(ip, None)

    def clear_all(self) -> None:
        """Reset all tracked failures (used in unit tests)."""
        self._failures.clear()


login_rate_limiter = InMemoryLoginRateLimiter()


def verify_admin_credentials(username: str, password: str, settings: Settings) -> bool:
    """Verify username and password against configured .env admin credentials in constant time."""
    if not settings.has_configured_env_admin_password:
        return False
    username_ok = hmac.compare_digest(
        username.strip().lower(), settings.admin_username.strip().lower()
    )
    raw_secret = settings.admin_password
    configured_secret = (
        raw_secret.get_secret_value()
        if isinstance(raw_secret, SecretStr)
        else str(raw_secret)
    )
    password_ok = verify_password_hash(password, configured_secret)
    return username_ok and password_ok


def create_session_token(
    username: str,
    settings: Settings,
    *,
    role: Literal["admin", "operator"] = "admin",
    theme_preference: str = "default",
) -> tuple[str, datetime]:
    """Create a signed JWT session token and return (token, expires_at)."""
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.session_expire_minutes)
    payload = {
        "sub": username,
        "role": role,
        "theme": theme_preference,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "type": "admin_session",
    }
    token = jwt.encode(
        payload,
        settings.app_secret_key.get_secret_value(),
        algorithm=JWT_ALGORITHM,
    )
    return token, expires_at


def decode_session_token(token: str, settings: Settings) -> AuthUserResponse:
    """Decode and validate a signed JWT session cookie."""
    try:
        payload = jwt.decode(
            token,
            settings.app_secret_key.get_secret_value(),
            algorithms=[JWT_ALGORITHM],
            leeway=10,
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has expired. Please log in again.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication session.",
        ) from exc

    sub = payload.get("sub")
    token_type = payload.get("type")
    exp = payload.get("exp")
    if not sub or exp is None or token_type != "admin_session":  # noqa: S105
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session subject.",
        )

    raw_role = str(payload.get("role", "admin")).lower()
    role: Literal["admin", "operator"] = (
        "operator" if raw_role == "operator" else "admin"
    )
    theme_pref = str(payload.get("theme", "default") or "default")
    expires_iso = datetime.fromtimestamp(int(exp), tz=UTC).isoformat()
    return AuthUserResponse(
        username=str(sub),
        role=role,
        theme_preference=theme_pref,
        authenticated=True,
        expires_at=expires_iso,
    )


def get_client_ip(request: Request) -> str:
    """Extract client IP address from request."""
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def require_admin_session(
    gateway_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    settings: Settings = Depends(get_settings),
) -> AuthUserResponse:
    """FastAPI dependency enforcing a valid signed user session cookie."""
    if not gateway_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return decode_session_token(gateway_session, settings)


async def require_admin_role(
    current_user: AuthUserResponse = Depends(require_admin_session),
) -> AuthUserResponse:
    """FastAPI dependency enforcing Administrator ('admin') role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges are required for this action.",
        )
    return current_user
