"""Recurring weekly schedules & policy reconciliation API routes (/api/v1/schedules)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_opnsense_client
from app.auth import AuthUserResponse, get_client_ip, require_admin_session
from app.clients.opnsense import OPNsenseClient
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.schedule_service import (
    ScheduleCreateRequest,
    ScheduleListResponse,
    ScheduleReconciliationSummary,
    ScheduleResponse,
    ScheduleToggleRequest,
    ScheduleUpdateRequest,
    create_schedule,
    delete_schedule,
    list_schedules,
    reconcile_schedules_and_policies,
    toggle_schedule,
    update_schedule,
)

router = APIRouter(prefix="/api/v1/schedules", tags=["schedules"])


@router.get("", response_model=ScheduleListResponse)
async def get_all_schedules(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> ScheduleListResponse:
    """List all recurring weekly schedules with live active-window evaluation."""
    return await list_schedules(db)


@router.post(
    "",
    response_model=ScheduleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_create_schedule(
    payload: ScheduleCreateRequest,
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> ScheduleResponse:
    """Create a recurring weekly schedule for a device or group and enforce policy."""
    return await create_schedule(
        db,
        opnsense,
        settings,
        payload,
        actor_ip=get_client_ip(request),
    )


@router.put("/{schedule_id}", response_model=ScheduleResponse)
@router.patch("/{schedule_id}", response_model=ScheduleResponse)
async def put_update_schedule(
    schedule_id: int,
    payload: ScheduleUpdateRequest,
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> ScheduleResponse:
    """Update an existing recurring schedule and immediately re-evaluate device policies."""
    return await update_schedule(
        db,
        opnsense,
        settings,
        schedule_id,
        payload,
        actor_ip=get_client_ip(request),
    )


@router.patch("/{schedule_id}/toggle", response_model=ScheduleResponse)
@router.post("/{schedule_id}/toggle", response_model=ScheduleResponse)
async def patch_toggle_schedule(
    schedule_id: int,
    payload: ScheduleToggleRequest,
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> ScheduleResponse:
    """Enable or disable a recurring schedule and immediately re-evaluate device policies."""
    return await toggle_schedule(
        db,
        opnsense,
        settings,
        schedule_id,
        payload.is_enabled,
        actor_ip=get_client_ip(request),
    )


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_schedule(
    schedule_id: int,
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> Response:
    """Delete a recurring schedule and immediately re-evaluate device policies."""
    await delete_schedule(
        db,
        opnsense,
        settings,
        schedule_id,
        actor_ip=get_client_ip(request),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reconcile", response_model=ScheduleReconciliationSummary)
async def post_reconcile_schedules(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> ScheduleReconciliationSummary:
    """Trigger an immediate 5-tier policy and DHCP IP drift reconciliation cycle."""
    return await reconcile_schedules_and_policies(db, opnsense, settings)

