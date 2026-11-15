"""Elasticsearch 9.4.3 analytics REST endpoints (/api/v1/analytics & /devices/{id}/analytics)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_elasticsearch_client, get_opnsense_client
from app.auth import AuthUserResponse, get_client_ip, require_admin_session
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.analytics_service import (
    BlockedTargetActionResponse,
    BlockedTargetCreateRequest,
    BlockedTargetListResponse,
    DeviceAnalyticsResponse,
    NetworkOverviewResponse,
    TargetAttributionResponse,
    create_blocked_target,
    delete_blocked_target,
    get_device_analytics,
    get_network_overview_analytics,
    get_target_attribution_analytics,
    list_blocked_targets,
    toggle_blocked_target,
)

router = APIRouter(prefix="/api/v1", tags=["analytics"])

TimeWindowLiteral = Literal["today", "1h", "24h", "7d", "30d"]


@router.get("/analytics/overview", response_model=NetworkOverviewResponse)
async def read_network_overview(
    window: TimeWindowLiteral = Query(
        default="today",
        description="Analytics time window: today, 1h, 24h, 7d, or 30d.",
    ),
    refresh: bool = Query(
        default=False,
        description="If true, bypass the short-TTL cache and query Elasticsearch directly.",
    ),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    es_client: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
    settings: Settings = Depends(get_settings),
) -> NetworkOverviewResponse:
    """Return network-wide bandwidth, timeline, top devices, and top DNS domains."""
    return await get_network_overview_analytics(
        db=db,
        settings=settings,
        es_client=es_client,
        window=window,
        refresh=refresh,
    )


@router.get("/devices/{device_id}/analytics", response_model=DeviceAnalyticsResponse)
async def read_device_analytics(
    device_id: int,
    request: Request,
    window: TimeWindowLiteral = Query(
        default="24h",
        description="Analytics time window: 1h, 24h, 7d, or 30d.",
    ),
    domain_search: str | None = Query(
        default=None,
        description="Optional substring filter for chronological recent DNS queries.",
    ),
    refresh: bool = Query(
        default=False,
        description="If true, bypass the short-TTL cache and query Elasticsearch directly.",
    ),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    es_client: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
    settings: Settings = Depends(get_settings),
) -> DeviceAnalyticsResponse:
    """Return per-device usage stats, 24-hour access profile, and visited DNS domains."""
    return await get_device_analytics(
        db=db,
        settings=settings,
        es_client=es_client,
        device_id=device_id,
        window=window,
        domain_search=domain_search,
        refresh=refresh,
        client_ip=get_client_ip(request),
    )


@router.get("/analytics/blocked-targets", response_model=BlockedTargetListResponse)
async def read_blocked_targets(
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> BlockedTargetListResponse:
    """List all custom domain and ASN block rules persisted in SQLite (`FB-P18-001`)."""
    return await list_blocked_targets(db=db, settings=settings)


@router.post(
    "/analytics/blocked-targets",
    response_model=BlockedTargetActionResponse,
    status_code=201,
)
async def create_custom_blocked_target(
    payload: BlockedTargetCreateRequest,
    request: Request,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> BlockedTargetActionResponse:
    """Create or re-enable a global or per-device domain/ASN block (`FB-P18-001`)."""
    return await create_blocked_target(
        db=db,
        opnsense=opnsense,
        settings=settings,
        payload=payload,
        actor=current_user.username,
        client_ip=get_client_ip(request),
    )


@router.patch(
    "/analytics/blocked-targets/{block_id}/toggle",
    response_model=BlockedTargetActionResponse,
)
async def toggle_custom_blocked_target(
    block_id: int,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
    settings: Settings = Depends(get_settings),
) -> BlockedTargetActionResponse:
    """Enable or disable an existing custom domain or ASN block rule (`FB-P18-001`)."""
    return await toggle_blocked_target(
        db=db,
        opnsense=opnsense,
        settings=settings,
        block_id=block_id,
        actor=current_user.username,
    )


@router.delete(
    "/analytics/blocked-targets/{block_id}",
    response_model=BlockedTargetActionResponse,
)
async def remove_custom_blocked_target(
    block_id: int,
    current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    opnsense: OPNsenseClient = Depends(get_opnsense_client),
) -> BlockedTargetActionResponse:
    """Remove a custom domain or ASN block rule and sync OPNsense aliases (`FB-P18-001`)."""
    return await delete_blocked_target(
        db=db,
        opnsense=opnsense,
        block_id=block_id,
        actor=current_user.username,
    )


@router.get("/analytics/attribution", response_model=TargetAttributionResponse)
async def read_target_attribution(
    target_type: Literal["domain", "registered_domain", "asn", "organization"] = Query(
        ...,
        description="Target category: domain, registered_domain, asn, or organization.",
    ),
    target_value: str = Query(
        ...,
        min_length=1,
        max_length=255,
        description="Domain FQDN, registered root domain, ASN number, or org name.",
    ),
    window: TimeWindowLiteral = Query(
        default="today",
        description="Analytics time window: today, 1h, 24h, 7d, or 30d.",
    ),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    es_client: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
    settings: Settings = Depends(get_settings),
) -> TargetAttributionResponse:
    """Return LAN devices that queried a domain or communicated with an ASN (`FB-P18-003`)."""
    return await get_target_attribution_analytics(
        db=db,
        settings=settings,
        es_client=es_client,
        target_type=target_type,
        target_value=target_value,
        window=window,
    )
