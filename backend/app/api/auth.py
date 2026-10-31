"""Authentication API routes (/api/v1/auth/login, /logout, /me)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    SESSION_COOKIE_NAME,
    AuthUserResponse,
    LoginRequest,
    create_session_token,
    get_client_ip,
    login_rate_limiter,
    require_admin_session,
    verify_admin_credentials,
)
from app.config import Settings, get_settings
from app.db import get_db_session
from app.models import AuditLog

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=AuthUserResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> AuthUserResponse:
    """Authenticate admin credentials and issue an HttpOnly signed session cookie."""
    client_ip = get_client_ip(request)
    login_rate_limiter.check_allowed(
        ip=client_ip,
        max_attempts=settings.auth_rate_limit_attempts,
        window_seconds=settings.auth_rate_limit_window_seconds,
    )

    if not verify_admin_credentials(payload.username, payload.password, settings):
        login_rate_limiter.record_failure(
            ip=client_ip,
            window_seconds=settings.auth_rate_limit_window_seconds,
        )
        db.add(
            AuditLog(
                actor=payload.username or "unknown",
                action="auth.login",
                target=client_ip,
                status="failed",
                details="Invalid username or password",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    login_rate_limiter.reset_ip(client_ip)
    token, expires_at = create_session_token(settings.admin_username, settings)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.session_expire_minutes * 60,
        httponly=True,
        samesite="lax",
        secure=(settings.app_env == "production"),
        path="/",
    )

    db.add(
        AuditLog(
            actor=settings.admin_username,
            action="auth.login",
            target=client_ip,
            status="success",
            details="Admin login successful",
        )
    )
    await db.commit()

    return AuthUserResponse(
        username=settings.admin_username,
        authenticated=True,
        expires_at=expires_at.isoformat(),
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Clear the admin session cookie and log the logout event."""
    client_ip = get_client_ip(request)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    db.add(
        AuditLog(
            actor=current_user.username,
            action="auth.logout",
            target=client_ip,
            status="success",
            details="Admin logged out",
        )
    )
    await db.commit()
    return {"status": "logged_out"}


@router.get("/me", response_model=AuthUserResponse)
async def get_current_user(
    current_user: AuthUserResponse = Depends(require_admin_session),
) -> AuthUserResponse:
    """Return the currently authenticated admin user."""
    return current_user
