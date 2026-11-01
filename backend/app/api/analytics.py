"""Elasticsearch 9.4.3 analytics REST endpoints (/api/v1/analytics & /devices/{id}/analytics)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_elasticsearch_client
from app.auth import AuthUserResponse, get_client_ip, require_admin_session
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.analytics_service import (
    DeviceAnalyticsResponse,
    NetworkOverviewResponse,
    get_device_analytics,
    get_network_overview_analytics,
)

router = APIRouter(prefix="/api/v1", tags=["analytics"])

TimeWindowLiteral = Literal["1h", "24h", "7d", "30d"]


@router.get("/analytics/overview", response_model=NetworkOverviewResponse)
async def read_network_overview(
    window: TimeWindowLiteral = Query(
        default="24h",
        description="Analytics time window: 1h, 24h, 7d, or 30d.",
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
