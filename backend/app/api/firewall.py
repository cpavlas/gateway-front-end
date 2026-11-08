"""Phase 10 Firewall & Security REST endpoints (`/api/v1/firewall/overview`)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.system import get_elasticsearch_client
from app.auth import AuthUserResponse, require_admin_session
from app.clients.elasticsearch import ElasticsearchServiceClient
from app.config import Settings, get_settings
from app.db import get_db_session
from app.services.firewall_service import (
    FirewallOpenPortSessionsResponse,
    FirewallOverviewResponse,
    get_firewall_overview_analytics,
    get_open_wan_port_sessions,
)

router = APIRouter(prefix="/api/v1/firewall", tags=["firewall"])

TimeWindowLiteral = Literal["today", "1h", "24h", "7d", "30d"]


@router.get("/overview", response_model=FirewallOverviewResponse)
async def read_firewall_overview(
    window: TimeWindowLiteral = Query(
        default="today",
        description="Firewall telemetry time window: today, 1h, 24h, 7d, or 30d.",
    ),
    action: str | None = Query(
        default=None,
        description="Optional action filter: all, pass, or block.",
    ),
    direction: str | None = Query(
        default=None,
        description="Optional direction filter: all, inbound, or outbound.",
    ),
    protocol: str | None = Query(
        default=None,
        description="Optional transport protocol filter: all, tcp, udp, icmp, ipv6-icmp, igmp.",
    ),
    search: str | None = Query(
        default=None,
        description="Optional search string (IP, port, interface, protocol, or ASN organization).",
    ),
    refresh: bool = Query(
        default=False,
        description="If true, bypass the short-TTL cache and query Elasticsearch directly.",
    ),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    es_client: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
    settings: Settings = Depends(get_settings),
) -> FirewallOverviewResponse:
    """Return Firewall & Security KPIs, timeline, noisy LAN devices, WAN scanners,
    open WAN ports, and recent events.
    """
    return await get_firewall_overview_analytics(
        db=db,
        settings=settings,
        es_client=es_client,
        window=window,
        action=action,
        direction=direction,
        protocol=protocol,
        search=search,
        refresh=refresh,
    )


@router.get("/open-ports/sessions", response_model=FirewallOpenPortSessionsResponse)
async def read_open_wan_port_sessions(
    destination_ip: str = Query(
        ...,
        description="Internal LAN destination IPv4 address for the open WAN port.",
    ),
    destination_port: int = Query(
        ...,
        ge=1,
        le=65535,
        description="Internal destination/redirect port.",
    ),
    external_port: int | None = Query(
        default=None,
        ge=1,
        le=65535,
        description="Optional external WAN incoming port.",
    ),
    protocol: str = Query(
        default="tcp",
        description="Transport protocol: tcp or udp.",
    ),
    window: TimeWindowLiteral = Query(
        default="24h",
        description="Firewall telemetry time window: 1h, 24h, 7d, or 30d.",
    ),
    search: str | None = Query(
        default=None,
        description="Optional filter by external IP, country, city, or ISP/ASN organization.",
    ),
    refresh: bool = Query(
        default=False,
        description="If true, bypass cache and query Elasticsearch directly.",
    ),
    _current_user: AuthUserResponse = Depends(require_admin_session),
    db: AsyncSession = Depends(get_db_session),
    es_client: ElasticsearchServiceClient = Depends(get_elasticsearch_client),
) -> FirewallOpenPortSessionsResponse:
    """Return connected external WAN IP details (GeoIP location, ASN/ISP, connection length,
    source ports, TCP flags, TTL, and recent events) for an active open WAN port (`FB-P13-002`).
    """
    return await get_open_wan_port_sessions(
        db=db,
        es_client=es_client,
        destination_ip=destination_ip,
        destination_port=destination_port,
        external_port=external_port,
        protocol=protocol,
        window=window,
        search=search,
        refresh=refresh,
    )

