"""Authentication API routes (/api/v1/auth/setup-status, /setup-admin, /login, /logout, /me)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    SESSION_COOKIE_NAME,
    AuthUserResponse,
    LoginRequest,
    SetupAdminRequest,
    SetupStatusResponse,
    create_session_token,
    get_client_ip,
    login_rate_limiter,
    require_admin_session,
)
from app.config import Settings, get_settings
from app.db import get_db_session
from app.models import AuditLog, User
from app.services.user_service import (
    authenticate_user_account,
    get_setup_status,
    setup_initial_admin_account,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _set_session_cookie(
    request: Request,
    response: Response,
    token: str,
    settings: Settings,
) -> None:
    """Attach the signed HttpOnly session cookie to the response."""
    is_https = (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto", "").lower() == "https"
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.session_expire_minutes * 60,
        httponly=True,
        samesite="lax",
        secure=is_https,
        path="/",
    )


@router.get("/setup-status", response_model=SetupStatusResponse)
async def auth_setup_status(
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> SetupStatusResponse:
    """Check whether first-boot `admin` password setup is required (`FB-P9-001`)."""
    return await get_setup_status(db, settings)


@router.post("/setup-admin", response_model=AuthUserResponse)
async def auth_setup_admin(
    payload: SetupAdminRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> AuthUserResponse:
    """Complete NGINX-style first-boot `admin` password setup and issue session cookie."""
    client_ip = get_client_ip(request)
    try:
        user_row = await setup_initial_admin_account(
            db, payload, settings, client_ip=client_ip
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    token, expires_at = create_session_token(
        user_row.username,
        settings,
        role="admin",
        theme_preference=user_row.theme_preference,
    )
    _set_session_cookie(request, response, token, settings)
    return AuthUserResponse(
        username=user_row.username,
        role="admin",
        theme_preference=user_row.theme_preference,
        authenticated=True,
        expires_at=expires_at.isoformat(),
    )


@router.post("/login", response_model=AuthUserResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> AuthUserResponse:
    """Authenticate user credentials and issue an HttpOnly signed session cookie."""
    client_ip = get_client_ip(request)
    login_rate_limiter.check_allowed(
        ip=client_ip,
        max_attempts=settings.auth_rate_limit_attempts,
        window_seconds=settings.auth_rate_limit_window_seconds,
    )

    try:
        user_row = await authenticate_user_account(
            db, payload.username, payload.password, settings
        )
    except PermissionError as exc:
        db.add(
            AuditLog(
                actor=payload.username or "unknown",
                action="auth.login",
                audit_label="AUTH_EVENT",
                target=client_ip,
                status="failed",
                details=str(exc),
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    if user_row is None:
        login_rate_limiter.record_failure(
            ip=client_ip,
            window_seconds=settings.auth_rate_limit_window_seconds,
        )
        db.add(
            AuditLog(
                actor=payload.username or "unknown",
                action="auth.login",
                audit_label="AUTH_EVENT",
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
    role_lit: Literal["admin", "operator"] = (
        "operator" if user_row.role == "operator" else "admin"
    )
    token, expires_at = create_session_token(
        user_row.username,
        settings,
        role=role_lit,
        theme_preference=user_row.theme_preference or "default",
    )
    _set_session_cookie(request, response, token, settings)

    db.add(
        AuditLog(
            actor=user_row.username,
            action="auth.login",
            audit_label="AUTH_EVENT",
            target=client_ip,
            status="success",
            details=f"User login successful (role={role_lit})",
        )
    )
    await db.commit()

    return AuthUserResponse(
        username=user_row.username,
        role=role_lit,
        theme_preference=user_row.theme_preference or "default",
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
    """Clear the user session cookie and log the logout event."""
    client_ip = get_client_ip(request)
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    db.add(
        AuditLog(
            actor=current_user.username,
            action="auth.logout",
            audit_label="AUTH_EVENT",
            target=client_ip,
            status="success",
            details="User logged out",
        )
    )
    await db.commit()
    return {"status": "logged_out"}


@router.get("/me", response_model=AuthUserResponse)
async def get_current_user(
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> AuthUserResponse:
    """Return the currently authenticated user's session details."""
    user_row = (
        await db.execute(
            select(User).where(
                func.lower(User.username) == current_user.username.lower()
            )
        )
    ).scalar_one_or_none()
    if user_row is not None:
        if not user_row.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account is disabled.",
            )
        role_lit: Literal["admin", "operator"] = (
            "operator" if user_row.role == "operator" else "admin"
        )
        return AuthUserResponse(
            username=user_row.username,
            role=role_lit,
            theme_preference=user_row.theme_preference or "default",
            authenticated=True,
            expires_at=current_user.expires_at,
        )
    return current_user
