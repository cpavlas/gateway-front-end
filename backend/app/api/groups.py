"""Device groups / profiles CRUD, bulk block/unblock, and group analytics API routes."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_elasticsearch_client, get_opnsense_client
from app.auth import AuthUserResponse, get_client_ip, require_admin_session
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.group_service import (
    GroupAnalyticsResponse,
    GroupBulkActionResponse,
    GroupCreateRequest,
    GroupListResponse,
    GroupMembersUpdateRequest,
    GroupResponse,
    GroupUpdateRequest,
    block_group_internet,
    block_group_youtube,
    create_group,
    delete_group,
    get_group_analytics,
    get_group_by_id,
    list_groups,
    set_group_members,
    unblock_group_internet,
    unblock_group_youtube,
    update_group,
)

TimeWindow = Literal["1h", "24h", "7d", "30d"]

router = APIRouter(prefix="/api/v1/groups", tags=["groups"])


@router.get("", response_model=GroupListResponse)
async def get_all_groups(
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> GroupListResponse:
    """List all device groups with member counts and computed access state."""
    client_ip = get_client_ip(request)
    return await list_groups(db, settings, client_ip=client_ip)


@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def post_create_group(
    payload: GroupCreateRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> GroupResponse:
    """Create a new device group/profile and assign optional initial member devices."""
    client_ip = get_client_ip(request)
    return await create_group(
        db,
        settings,
        payload,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.get("/{group_id}", response_model=GroupResponse)
async def get_single_group(
    group_id: int,
    request: Request,
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> GroupResponse:
    """Fetch a single device group and its assigned member devices."""
    client_ip = get_client_ip(request)
    return await get_group_by_id(db, settings, group_id, client_ip=client_ip)


@router.patch("/{group_id}", response_model=GroupResponse)
async def patch_single_group(
    group_id: int,
    payload: GroupUpdateRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> GroupResponse:
    """Update a device group's name, description, color badge, icon, or member list."""
    client_ip = get_client_ip(request)
    return await update_group(
        db,
        settings,
        group_id,
        payload,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.put("/{group_id}/members", response_model=GroupResponse)
async def put_group_members(
    group_id: int,
    payload: GroupMembersUpdateRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> GroupResponse:
    """Replace the member device list for a group."""
    client_ip = get_client_ip(request)
    return await set_group_members(
        db,
        settings,
        group_id,
        payload,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_single_group(
    group_id: int,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """Delete a device group (member devices remain intact in the device inventory)."""
    await delete_group(db, group_id, actor=current_user.username)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{group_id}/block", response_model=GroupBulkActionResponse)
async def post_block_group(
    group_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> GroupBulkActionResponse:
    """Bulk-block internet access for all non-protected member devices in a group."""
    client_ip = get_client_ip(request)
    return await block_group_internet(
        db,
        opnsense,
        settings,
        group_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{group_id}/unblock", response_model=GroupBulkActionResponse)
async def post_unblock_group(
    group_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> GroupBulkActionResponse:
    """Restore internet access for all member devices in a group."""
    client_ip = get_client_ip(request)
    return await unblock_group_internet(
        db,
        opnsense,
        settings,
        group_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{group_id}/youtube/block", response_model=GroupBulkActionResponse)
async def post_block_group_youtube(
    group_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> GroupBulkActionResponse:
    """Bulk-block YouTube access for all non-protected member devices in a group."""
    client_ip = get_client_ip(request)
    return await block_group_youtube(
        db,
        opnsense,
        settings,
        group_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.post("/{group_id}/youtube/unblock", response_model=GroupBulkActionResponse)
async def post_unblock_group_youtube(
    group_id: int,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> GroupBulkActionResponse:
    """Restore YouTube access for all member devices in a group."""
    client_ip = get_client_ip(request)
    return await unblock_group_youtube(
        db,
        opnsense,
        settings,
        group_id,
        actor=current_user.username,
        client_ip=client_ip,
    )


@router.get("/{group_id}/analytics", response_model=GroupAnalyticsResponse)
async def get_single_group_analytics(
    group_id: int,
    request: Request,
    window: TimeWindow = Query(default="24h", description="Time window: 1h, 24h, 7d, or 30d."),
    domain_search: str | None = Query(
        default=None,
        description="Optional substring filter for chronological recent DNS queries.",
    ),
    refresh: bool = Query(default=False, description="Bypass 20-second in-memory cache."),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    es_client: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
) -> GroupAnalyticsResponse:
    """Return combined usage, per-member traffic breakdown, 24h access profile, and domains."""
    client_ip = get_client_ip(request)
    return await get_group_analytics(
        db=db,
        settings=settings,
        es_client=es_client,
        group_id=group_id,
        window=window,
        domain_search=domain_search,
        refresh=refresh,
        client_ip=client_ip,
    )

