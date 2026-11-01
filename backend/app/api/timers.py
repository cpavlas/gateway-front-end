"""Timed temporary internet access overrides ('pause' & 'bonus' timers) API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_opnsense_client
from app.auth import AuthUserResponse, get_client_ip, require_admin_session
from app.clients.opnsense import OPNsenseClient
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.timer_service import (
    ActiveOverrideInfo,
    OverrideReconciliationSummary,
    TimerCancelResponse,
    TimerListResponse,
    TimerStartRequest,
    cancel_override,
    list_active_overrides,
    reconcile_expired_overrides,
    start_device_override,
    start_group_override,
)

router = APIRouter(prefix="/api/v1/timers", tags=["timers"])


@router.get("", response_model=TimerListResponse)
async def get_active_timers(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> TimerListResponse:
    """List all currently active temporary pause/bonus overrides across devices and groups."""
    return await list_active_overrides(db)


@router.post(
    "/devices/{device_id}",
    response_model=ActiveOverrideInfo,
    status_code=status.HTTP_201_CREATED,
)
async def post_start_device_timer(
    device_id: int,
    payload: TimerStartRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> ActiveOverrideInfo:
    """Start a temporary pause (block) or bonus (unblock) countdown timer on a single device."""
    client_ip = get_client_ip(request)
    return await start_device_override(
        db,
        opnsense,
        settings,
        device_id,
        payload,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post(
    "/groups/{group_id}",
    response_model=ActiveOverrideInfo,
    status_code=status.HTTP_201_CREATED,
)
async def post_start_group_timer(
    group_id: int,
    payload: TimerStartRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> ActiveOverrideInfo:
    """Start a temporary pause (block) or bonus (unblock) countdown timer on a device group."""
    client_ip = get_client_ip(request)
    return await start_group_override(
        db,
        opnsense,
        settings,
        group_id,
        payload,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.delete("/{override_id}", response_model=TimerCancelResponse)
async def delete_cancel_timer(
    override_id: int,
    request: Request,
    revert_state: bool = Query(default=True),
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> TimerCancelResponse:
    """Cancel an active temporary override timer and optionally revert its OPNsense access state."""
    client_ip = get_client_ip(request)
    return await cancel_override(
        db,
        opnsense,
        settings,
        override_id,
        actor=current_user.username,
        revert_state=revert_state,
        client_ip=client_ip,
    )


@router.post("/reconcile", response_model=OverrideReconciliationSummary)
async def post_reconcile_timers(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> OverrideReconciliationSummary:
    """Manually trigger immediate reconciliation of any expired temporary overrides."""
    return await reconcile_expired_overrides(db, opnsense, settings)

