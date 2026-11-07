"""Network devices inventory and instant block/unblock API routes (/api/v1/devices)."""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_opnsense_client
from app.auth import AuthUserResponse, get_client_ip, require_admin_session
from app.clients.opnsense import OPNsenseClient, OPNsenseClientError
from app.config import Settings, get_settings
from app.db import get_db_session
from app.models import Device
from app.services.audit_and_backup_service import record_upstream_error_audit_log
from app.services.device_service import (
    DeviceActionResponse,
    DeviceListResponse,
    DeviceResponse,
    DeviceStatusFilter,
    DeviceUpdateRequest,
    block_device_internet,
    block_device_youtube,
    list_devices_inventory,
    sync_devices_from_opnsense,
    unblock_device_internet,
    unblock_device_youtube,
    update_device_metadata,
)

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])


@router.get("", response_model=DeviceListResponse)
async def get_devices(
    request: Request,
    sync: bool = Query(
        default=False,
        description="If true, force a live sync from OPNsense before returning devices.",
    ),
    search: str | None = Query(default=None, description="Search by name, IP, MAC, or vendor."),
    status_filter: DeviceStatusFilter = Query(default="all", alias="status"),
    group_id: int | None = Query(
        default=None, description="Optional group ID to filter member devices."
    ),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> DeviceListResponse:
    """List discovered network devices with KPI summary counts (auto-syncing if DB is empty)."""
    count = (await db.execute(select(func.count(Device.id)))).scalar_one()
    if sync or count == 0:
        try:
            await sync_devices_from_opnsense(db, opnsense, settings)
        except (OPNsenseClientError, httpx.HTTPError) as exc:
            await record_upstream_error_audit_log(
                db,
                service="opnsense",
                operation="devices.sync",
                error_message=str(exc),
                actor=_current_user.username,
            )
            if sync:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Failed to synchronize devices from OPNsense: {exc}",
                ) from exc

    client_ip = get_client_ip(request)
    return await list_devices_inventory(
        db,
        settings,
        client_ip=client_ip,
        search=search,
        status_filter=status_filter,
        group_id=group_id,
    )


@router.post("/sync", response_model=DeviceListResponse)
async def sync_devices(
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> DeviceListResponse:
    """Force an immediate live reconciliation against OPNsense ARP, Dnsmasq, and block alias."""
    try:
        await sync_devices_from_opnsense(db, opnsense, settings)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        await record_upstream_error_audit_log(
            db,
            service="opnsense",
            operation="devices.sync",
            error_message=str(exc),
            actor=_current_user.username,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to synchronize devices from OPNsense: {exc}",
        ) from exc

    client_ip = get_client_ip(request)
    return await list_devices_inventory(db, settings, client_ip=client_ip)


@router.patch("/{device_id}", response_model=DeviceResponse)
async def patch_device(
    device_id: int,
    payload: DeviceUpdateRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> DeviceResponse:
    """Update a device's custom display_name, notes, or manual protection flag."""
    client_ip = get_client_ip(request)
    return await update_device_metadata(
        db,
        settings,
        device_id,
        payload,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{device_id}/block", response_model=DeviceActionResponse)
async def block_device(
    device_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> DeviceActionResponse:
    """Block internet access for a single device and terminate active firewall states."""
    client_ip = get_client_ip(request)
    return await block_device_internet(
        db,
        opnsense,
        settings,
        device_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{device_id}/unblock", response_model=DeviceActionResponse)
async def unblock_device(
    device_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> DeviceActionResponse:
    """Restore internet access for a single device."""
    client_ip = get_client_ip(request)
    return await unblock_device_internet(
        db,
        opnsense,
        settings,
        device_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{device_id}/youtube/block", response_model=DeviceActionResponse)
async def post_block_device_youtube(
    device_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> DeviceActionResponse:
    """Block YouTube access for a single device while keeping Plex and general internet allowed."""
    client_ip = get_client_ip(request)
    return await block_device_youtube(
        db,
        opnsense,
        settings,
        device_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{device_id}/youtube/unblock", response_model=DeviceActionResponse)
async def post_unblock_device_youtube(
    device_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> DeviceActionResponse:
    """Restore YouTube access for a single device."""
    client_ip = get_client_ip(request)
    return await unblock_device_youtube(
        db,
        opnsense,
        settings,
        device_id,
        actor=current_user.username,
        client_ip=client_ip,
    )
