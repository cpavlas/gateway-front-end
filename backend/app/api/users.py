"""User account management API routes (/api/v1/users) for Phase 9 (`FB-P9-003`)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import AuthUserResponse, require_admin_role
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.user_service import (
    UserCreatePayload,
    UserItem,
    UserListResponse,
    UserUpdatePayload,
    create_user_account,
    delete_user_account,
    list_all_users,
    update_user_account,
)

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("", response_model=UserListResponse)
async def get_users(
    _current_user: AuthUserResponse = Depends(require_admin_role),
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db_session),
) -> UserListResponse:
    """List all platform user accounts (Admin only)."""
    return await list_all_users(db, settings)


@router.post("", response_model=UserItem, status_code=status.HTTP_201_CREATED)
async def post_user(
    payload: UserCreatePayload,
    current_user: AuthUserResponse = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db_session),
) -> UserItem:
    """Create a new platform user account and set initial password (Admin only)."""
    try:
        return await create_user_account(db, payload, actor=current_user.username)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.patch("/{user_id}", response_model=UserItem)
async def patch_user(
    user_id: int,
    payload: UserUpdatePayload,
    current_user: AuthUserResponse = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db_session),
) -> UserItem:
    """Update a user's password, role, active state, or theme preference (Admin only)."""
    try:
        return await update_user_account(
            db, user_id, payload, actor=current_user.username
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    current_user: AuthUserResponse = Depends(require_admin_role),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, object]:
    """Delete a user account while protecting the built-in `admin` user (Admin only)."""
    try:
        return await delete_user_account(
            db, user_id, actor=current_user.username
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

