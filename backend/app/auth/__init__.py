"""Authentication, Argon2id password verification, signed JWT cookies, and rate limiting."""

from __future__ import annotations

import hmac
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Request, status
from pydantic import BaseModel, SecretStr

from app.config import Settings, get_settings

SESSION_COOKIE_NAME = "gateway_session"
JWT_ALGORITHM = "HS256"

_ph = PasswordHasher()


class LoginRequest(BaseModel):
    """Credentials submitted to /api/v1/auth/login."""

    username: str
    password: str


class AuthUserResponse(BaseModel):
    """Authenticated user session info."""

    username: str
    authenticated: bool = True
    expires_at: str


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
    """Verify username and password against configured admin credentials in constant time."""
    username_ok = hmac.compare_digest(username.strip(), settings.admin_username.strip())
    raw_secret = settings.admin_password
    configured_secret = (
        raw_secret.get_secret_value() if isinstance(raw_secret, SecretStr) else str(raw_secret)
    )

    password_ok = False
    if configured_secret.startswith("$argon2"):
        try:
            password_ok = _ph.verify(configured_secret, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            password_ok = False
    else:
        password_ok = hmac.compare_digest(password, configured_secret)

    return username_ok and password_ok


def create_session_token(username: str, settings: Settings) -> tuple[str, datetime]:
    """Create a signed JWT session token and return (token, expires_at)."""
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.session_expire_minutes)
    payload = {
        "sub": username,
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
    if not sub or exp is None or token_type != "admin_session" or sub != settings.admin_username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session subject.",
        )

    expires_iso = datetime.fromtimestamp(int(exp), tz=UTC).isoformat()
    return AuthUserResponse(username=str(sub), authenticated=True, expires_at=expires_iso)


def get_client_ip(request: Request) -> str:
    """Extract client IP address from request."""
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def require_admin_session(
    gateway_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    settings: Settings = Depends(get_settings),
) -> AuthUserResponse:
    """FastAPI dependency enforcing a valid signed admin session cookie."""
    if not gateway_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return decode_session_token(gateway_session, settings)
