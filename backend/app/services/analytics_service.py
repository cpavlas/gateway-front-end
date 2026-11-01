"""Analytics service joining Elasticsearch 9.4.3 telemetry with SQLite device metadata."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    resolve_time_window,
    sanitize_domain_search,
)
from app.config import Settings
from app.models import Device
from app.services.device_service import (
    DeviceResponse,
    build_device_response,
)

# ---------------------------------------------------------------------------
# Pydantic Response Models
# ---------------------------------------------------------------------------


class TimelineBucketItem(BaseModel):
    timestamp: str
    total_events: int
    bytes: int
    dns_queries: int
    allowed_packets: int
    blocked_packets: int


class TopDomainItem(BaseModel):
    domain: str
    query_count: int


class TopOrganizationItem(BaseModel):
    organization: str
    packet_count: int
    bytes: int


class TopDeviceTrafficItem(BaseModel):
    device_id: int | None
    ipv4_address: str
    effective_name: str
    mac_address: str | None
    vendor: str | None
    is_online: bool
    is_blocked: bool
    is_protected: bool
    total_events: int
    bytes: int
    dns_queries: int
    allowed_packets: int
    blocked_packets: int
    last_seen_at: str | None


class NetworkOverviewSummary(BaseModel):
    total_events: int
    total_bytes: int
    dns_query_count: int
    firewall_event_count: int
    allowed_packet_count: int
    blocked_packet_count: int


class NetworkOverviewResponse(BaseModel):
    window: str
    generated_at: str
    es_reachable: bool
    warning: str | None = None
    summary: NetworkOverviewSummary
    timeline: list[TimelineBucketItem]
    top_devices: list[TopDeviceTrafficItem]
    top_domains: list[TopDomainItem]
    top_registered_domains: list[TopDomainItem]
    top_organizations: list[TopOrganizationItem]


class HourlyAccessPoint(BaseModel):
    hour: int
    label: str
    total_events: int
    dns_queries: int
    bytes: int
    active_hours_count: int


class RecentDomainQueryItem(BaseModel):
    timestamp: str
    domain: str
    registered_domain: str | None = None
    record_type: str


class DeviceAnalyticsSummary(BaseModel):
    total_events: int
    total_bytes: int
    dns_query_count: int
    firewall_event_count: int
    allowed_packet_count: int
    blocked_packet_count: int
    active_hours_in_day: int
    first_active_at: str | None = None
    last_active_at: str | None = None


class DeviceAnalyticsResponse(BaseModel):
    device: DeviceResponse
    window: str
    generated_at: str
    es_reachable: bool
    warning: str | None = None
    summary: DeviceAnalyticsSummary
    timeline: list[TimelineBucketItem]
    hourly_access_profile: list[HourlyAccessPoint]
    top_domains: list[TopDomainItem]
    top_registered_domains: list[TopDomainItem]
    top_organizations: list[TopOrganizationItem]
    recent_queries: list[RecentDomainQueryItem]


# ---------------------------------------------------------------------------
# Short-TTL In-Memory Cache
# ---------------------------------------------------------------------------


class AnalyticsCache:
    """Simple monotonic-clock TTL cache for Elasticsearch aggregation payloads."""

    def __init__(self, ttl_seconds: float = 20.0) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() >= expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (time.monotonic() + self._ttl, value)

    def clear(self) -> None:
        self._store.clear()


_analytics_cache = AnalyticsCache(ttl_seconds=20.0)


def get_analytics_cache() -> AnalyticsCache:
    """Return the singleton in-memory analytics cache."""
    return _analytics_cache


# ---------------------------------------------------------------------------
# Synchronous Helper Functions (100% traced by Python 3.12 sys.monitoring)
# ---------------------------------------------------------------------------


def _enrich_top_devices_with_sqlite(
    raw_top_devices: list[dict[str, Any]],
    sqlite_devices: list[Device],
    settings: Settings,
) -> list[TopDeviceTrafficItem]:
    """Enrich Elasticsearch IP buckets with SQLite Device records."""
    by_ip: dict[str, Device] = {
        d.ipv4_address: d for d in sqlite_devices if d.ipv4_address
    }
    protected_ips = settings.protected_ip_set
    enriched: list[TopDeviceTrafficItem] = []
    for item in raw_top_devices:
        ip_str = str(item.get("ipv4_address") or "").strip()
        if not ip_str:
            continue
        dev = by_ip.get(ip_str)
        if dev is not None:
            dev_resp = build_device_response(dev, settings, None)
            enriched.append(
                TopDeviceTrafficItem(
                    device_id=dev_resp.id,
                    ipv4_address=ip_str,
                    effective_name=dev_resp.effective_name,
                    mac_address=dev_resp.mac_address,
                    vendor=dev_resp.vendor,
                    is_online=dev_resp.is_online,
                    is_blocked=dev_resp.is_blocked,
                    is_protected=dev_resp.is_protected,
                    total_events=int(item.get("total_events") or 0),
                    bytes=int(item.get("bytes") or 0),
                    dns_queries=int(item.get("dns_queries") or 0),
                    allowed_packets=int(item.get("allowed_packets") or 0),
                    blocked_packets=int(item.get("blocked_packets") or 0),
                    last_seen_at=item.get("last_seen_at"),
                )
            )
        else:
            enriched.append(
                TopDeviceTrafficItem(
                    device_id=None,
                    ipv4_address=ip_str,
                    effective_name=ip_str,
                    mac_address=None,
                    vendor=None,
                    is_online=False,
                    is_blocked=False,
                    is_protected=ip_str in protected_ips,
                    total_events=int(item.get("total_events") or 0),
                    bytes=int(item.get("bytes") or 0),
                    dns_queries=int(item.get("dns_queries") or 0),
                    allowed_packets=int(item.get("allowed_packets") or 0),
                    blocked_packets=int(item.get("blocked_packets") or 0),
                    last_seen_at=item.get("last_seen_at"),
                )
            )
    return enriched


def _assemble_network_overview_response(
    es_data: dict[str, Any],
    sqlite_devices: list[Device],
    settings: Settings,
    window: str,
) -> NetworkOverviewResponse:
    """Build a typed NetworkOverviewResponse from normalized ES data and SQLite devices."""
    now_iso = datetime.now(UTC).isoformat()
    raw_summary = es_data.get("summary") or {}
    enriched_top_devices = _enrich_top_devices_with_sqlite(
        es_data.get("top_devices") or [],
        sqlite_devices,
        settings,
    )
    return NetworkOverviewResponse(
        window=window,
        generated_at=now_iso,
        es_reachable=True,
        warning=None,
        summary=NetworkOverviewSummary(
            total_events=int(raw_summary.get("total_events") or 0),
            total_bytes=int(raw_summary.get("total_bytes") or 0),
            dns_query_count=int(raw_summary.get("dns_query_count") or 0),
            firewall_event_count=int(raw_summary.get("firewall_event_count") or 0),
            allowed_packet_count=int(raw_summary.get("allowed_packet_count") or 0),
            blocked_packet_count=int(raw_summary.get("blocked_packet_count") or 0),
        ),
        timeline=[TimelineBucketItem(**b) for b in (es_data.get("timeline") or [])],
        top_devices=enriched_top_devices,
        top_domains=[TopDomainItem(**d) for d in (es_data.get("top_domains") or [])],
        top_registered_domains=[
            TopDomainItem(**d) for d in (es_data.get("top_registered_domains") or [])
        ],
        top_organizations=[
            TopOrganizationItem(**o) for o in (es_data.get("top_organizations") or [])
        ],
    )


def _build_empty_overview_response(
    window: str,
    warning: str,
    es_reachable: bool = False,
) -> NetworkOverviewResponse:
    """Return a graceful fallback NetworkOverviewResponse when Elasticsearch is unreachable."""
    return NetworkOverviewResponse(
        window=window,
        generated_at=datetime.now(UTC).isoformat(),
        es_reachable=es_reachable,
        warning=warning,
        summary=NetworkOverviewSummary(
            total_events=0,
            total_bytes=0,
            dns_query_count=0,
            firewall_event_count=0,
            allowed_packet_count=0,
            blocked_packet_count=0,
        ),
        timeline=[],
        top_devices=[],
        top_domains=[],
        top_registered_domains=[],
        top_organizations=[],
    )


def _build_zero_hourly_profile() -> list[HourlyAccessPoint]:
    """Return a 24-hour (00:00..23:00) zeroed activity distribution."""
    return [
        HourlyAccessPoint(
            hour=h,
            label=f"{h:02d}:00",
            total_events=0,
            dns_queries=0,
            bytes=0,
            active_hours_count=0,
        )
        for h in range(24)
    ]


def _build_empty_device_analytics_response(
    device_resp: DeviceResponse,
    window: str,
    warning: str,
    es_reachable: bool = False,
) -> DeviceAnalyticsResponse:
    """Return a zero-state DeviceAnalyticsResponse when device has no IP or ES is unreachable."""
    return DeviceAnalyticsResponse(
        device=device_resp,
        window=window,
        generated_at=datetime.now(UTC).isoformat(),
        es_reachable=es_reachable,
        warning=warning,
        summary=DeviceAnalyticsSummary(
            total_events=0,
            total_bytes=0,
            dns_query_count=0,
            firewall_event_count=0,
            allowed_packet_count=0,
            blocked_packet_count=0,
            active_hours_in_day=0,
            first_active_at=None,
            last_active_at=None,
        ),
        timeline=[],
        hourly_access_profile=_build_zero_hourly_profile(),
        top_domains=[],
        top_registered_domains=[],
        top_organizations=[],
        recent_queries=[],
    )


def _assemble_device_analytics_response(
    device_resp: DeviceResponse,
    es_data: dict[str, Any],
    window: str,
) -> DeviceAnalyticsResponse:
    """Build a typed DeviceAnalyticsResponse from normalized ES output."""
    raw_summary = es_data.get("summary") or {}
    return DeviceAnalyticsResponse(
        device=device_resp,
        window=window,
        generated_at=datetime.now(UTC).isoformat(),
        es_reachable=True,
        warning=None,
        summary=DeviceAnalyticsSummary(
            total_events=int(raw_summary.get("total_events") or 0),
            total_bytes=int(raw_summary.get("total_bytes") or 0),
            dns_query_count=int(raw_summary.get("dns_query_count") or 0),
            firewall_event_count=int(raw_summary.get("firewall_event_count") or 0),
            allowed_packet_count=int(raw_summary.get("allowed_packet_count") or 0),
            blocked_packet_count=int(raw_summary.get("blocked_packet_count") or 0),
            active_hours_in_day=int(raw_summary.get("active_hours_in_day") or 0),
            first_active_at=raw_summary.get("first_active_at"),
            last_active_at=raw_summary.get("last_active_at"),
        ),
        timeline=[TimelineBucketItem(**b) for b in (es_data.get("timeline") or [])],
        hourly_access_profile=[
            HourlyAccessPoint(**h) for h in (es_data.get("hourly_access_profile") or [])
        ],
        top_domains=[TopDomainItem(**d) for d in (es_data.get("top_domains") or [])],
        top_registered_domains=[
            TopDomainItem(**d) for d in (es_data.get("top_registered_domains") or [])
        ],
        top_organizations=[
            TopOrganizationItem(**o) for o in (es_data.get("top_organizations") or [])
        ],
        recent_queries=[
            RecentDomainQueryItem(**q) for q in (es_data.get("recent_queries") or [])
        ],
    )


def _require_device_or_404(dev: Device | None, device_id: int) -> Device:
    """Raise HTTP 404 if device row is not found."""
    if dev is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found.",
        )
    return dev


# ---------------------------------------------------------------------------
# Async Service Functions
# ---------------------------------------------------------------------------


async def get_network_overview_analytics(
    db: AsyncSession,
    settings: Settings,
    es_client: ElasticsearchServiceClient,
    window: str = "24h",
    refresh: bool = False,
) -> NetworkOverviewResponse:
    """Return network-wide usage, timeline, top devices (joined with SQLite), and top domains."""
    win_key, _, _ = resolve_time_window(window)
    cache = get_analytics_cache()
    cache_key = f"overview:{win_key}"

    if not refresh:
        cached = cache.get(cache_key)
        if isinstance(cached, NetworkOverviewResponse):
            return cached

    stmt = select(Device)
    result = await db.execute(stmt)
    sqlite_devices = list(result.scalars().all())

    try:
        es_data = await es_client.fetch_network_overview(window=win_key, top_n=12)
    except ElasticsearchQueryError as exc:
        return _build_empty_overview_response(
            window=win_key,
            warning=str(exc),
            es_reachable=False,
        )

    response = _assemble_network_overview_response(
        es_data=es_data,
        sqlite_devices=sqlite_devices,
        settings=settings,
        window=win_key,
    )
    cache.set(cache_key, response)
    return response


async def get_device_analytics(
    db: AsyncSession,
    settings: Settings,
    es_client: ElasticsearchServiceClient,
    device_id: int,
    window: str = "24h",
    domain_search: str | None = None,
    refresh: bool = False,
    client_ip: str | None = None,
) -> DeviceAnalyticsResponse:
    """Return per-device usage stats, 24-hour access profile, and visited domains."""
    win_key, _, _ = resolve_time_window(window)
    clean_search = sanitize_domain_search(domain_search)

    stmt = select(Device).where(Device.id == device_id)
    result = await db.execute(stmt)
    dev = _require_device_or_404(result.scalar_one_or_none(), device_id)

    dev_resp = build_device_response(dev, settings, client_ip)

    if not dev.ipv4_address:
        return _build_empty_device_analytics_response(
            device_resp=dev_resp,
            window=win_key,
            warning="Device does not currently have an IPv4 address assigned.",
            es_reachable=True,
        )

    cache = get_analytics_cache()
    cache_key = f"device:{dev.id}:{dev.ipv4_address}:{win_key}:{clean_search or ''}"
    if not refresh:
        cached = cache.get(cache_key)
        if isinstance(cached, DeviceAnalyticsResponse):
            return cached.model_copy(update={"device": dev_resp})

    try:
        es_data = await es_client.fetch_device_analytics(
            ipv4_address=dev.ipv4_address,
            window=win_key,
            domain_search=clean_search,
        )
    except ElasticsearchQueryError as exc:
        return _build_empty_device_analytics_response(
            device_resp=dev_resp,
            window=win_key,
            warning=str(exc),
            es_reachable=False,
        )

    response = _assemble_device_analytics_response(
        device_resp=dev_resp,
        es_data=es_data,
        window=win_key,
    )
    cache.set(cache_key, response)
    return response
