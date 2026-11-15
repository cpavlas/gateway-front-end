"""Analytics service joining Elasticsearch 9.4.3 telemetry with SQLite device metadata."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    resolve_time_window,
    sanitize_domain_search,
)
from app.clients.opnsense import OPNsenseClient, OPNsenseClientError
from app.clients.plex import PlexActiveSessionItem
from app.config import Settings
from app.models import (
    AuditLog,
    BlockedTarget,
    Device,
    normalize_block_scope_type,
    normalize_block_target_type,
    normalize_block_target_value,
    utc_now,
)
from app.services.audit_and_backup_service import (
    record_performance_analysis_audit_log,
    record_upstream_error_audit_log,
)
from app.services.device_service import (
    DeviceResponse,
    build_device_response,
)
from app.services.plex_service import fetch_plex_telemetry_for_analytics

# ---------------------------------------------------------------------------
# Pydantic Response Models
# ---------------------------------------------------------------------------


AppUsageKeyLiteral = Literal[
    "youtube",
    "plex",
    "netflix",
    "disney_plus",
    "twitch",
    "tiktok",
    "discord",
    "gaming",
]


class AppUsageDeviceItem(BaseModel):
    device_id: int | None = None
    ipv4_address: str
    effective_name: str
    active_minutes: int = 0
    event_count: int = 0
    dns_queries: int = 0
    bytes: int = 0


class AppUsageItem(BaseModel):
    app_key: AppUsageKeyLiteral
    display_name: str
    active_minutes: int = 0
    event_count: int = 0
    dns_queries: int = 0
    bytes: int = 0
    last_active_at: str | None = None
    top_devices: list[AppUsageDeviceItem] = Field(default_factory=list)
    active_sessions: list[PlexActiveSessionItem] = Field(default_factory=list)


def _build_zero_app_usage() -> list[AppUsageItem]:
    """Return zeroed multi-app usage items when Elasticsearch is empty or unreachable."""
    return [
        AppUsageItem(app_key="youtube", display_name="YouTube"),
        AppUsageItem(app_key="plex", display_name="Plex"),
        AppUsageItem(app_key="netflix", display_name="Netflix"),
        AppUsageItem(app_key="disney_plus", display_name="Disney+"),
        AppUsageItem(app_key="twitch", display_name="Twitch"),
        AppUsageItem(app_key="tiktok", display_name="TikTok"),
        AppUsageItem(app_key="discord", display_name="Discord"),
        AppUsageItem(app_key="gaming", display_name="Gaming"),
    ]


def _apply_plex_override_to_es_data(
    es_data: dict[str, Any],
    plex_override: dict[str, Any] | None,
) -> dict[str, Any]:
    """Replace the `plex` entry in `es_data['application_usage']` with direct Plex telemetry."""
    if not plex_override:
        return es_data
    merged_es = dict(es_data)
    raw_apps = list(merged_es.get("application_usage") or [])
    if not raw_apps:
        merged_es["application_usage"] = [
            {
                "app_key": "youtube",
                "display_name": "YouTube",
                "active_minutes": 0,
                "event_count": 0,
                "dns_queries": 0,
                "bytes": 0,
                "last_active_at": None,
                "top_devices": [],
            },
            plex_override,
        ]
        return merged_es

    updated_apps: list[dict[str, Any]] = []
    replaced = False
    for item in raw_apps:
        if isinstance(item, dict) and item.get("app_key") == "plex":
            updated_apps.append(plex_override)
            replaced = True
        elif isinstance(item, dict):
            updated_apps.append(item)
    if not replaced:
        updated_apps.append(plex_override)
    merged_es["application_usage"] = updated_apps
    return merged_es


def _parse_app_usage_items(
    es_data: dict[str, Any],
    sqlite_devices: list[Device] | None = None,
    settings: Settings | None = None,
) -> list[AppUsageItem]:
    """Parse raw `application_usage` dicts into `AppUsageItem` objects with SQLite enrichment."""
    raw = es_data.get("application_usage")
    if not isinstance(raw, list) or not raw:
        return _build_zero_app_usage()

    by_ip: dict[str, Device] = {
        d.ipv4_address: d for d in (sqlite_devices or []) if d.ipv4_address
    }
    parsed: list[AppUsageItem] = []
    for a in raw:
        if not isinstance(a, dict):
            continue
        raw_top = a.get("top_devices") or []
        enriched_top: list[AppUsageDeviceItem] = []
        for td in raw_top:
            if not isinstance(td, dict):
                continue
            ip_str = str(td.get("ipv4_address") or "").strip()
            if not ip_str:
                continue
            dev = by_ip.get(ip_str)
            if dev is not None:
                dev_id: int | None = dev.id
                eff_name = (
                    (dev.display_name or "").strip()
                    or (dev.hostname or "").strip()
                    or ip_str
                )
            else:
                dev_id = (
                    int(td["device_id"])
                    if td.get("device_id") is not None
                    else None
                )
                eff_name = str(td.get("effective_name") or ip_str)
            enriched_top.append(
                AppUsageDeviceItem(
                    device_id=dev_id,
                    ipv4_address=ip_str,
                    effective_name=eff_name,
                    active_minutes=int(td.get("active_minutes") or 0),
                    event_count=int(td.get("event_count") or 0),
                    dns_queries=int(td.get("dns_queries") or 0),
                    bytes=int(td.get("bytes") or 0),
                )
            )
        raw_sessions = a.get("active_sessions") or []
        parsed_sessions = [
            s
            if isinstance(s, PlexActiveSessionItem)
            else PlexActiveSessionItem(**s)
            for s in raw_sessions
            if isinstance(s, (dict, PlexActiveSessionItem))
        ]
        item_copy = {
            **a,
            "top_devices": enriched_top[:3],
            "active_sessions": parsed_sessions,
        }
        parsed.append(AppUsageItem(**item_copy))
    return parsed or _build_zero_app_usage()


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
    asn: int | None = None
    packet_count: int
    bytes: int


BlockTargetTypeLiteral = Literal["domain", "asn"]
BlockScopeTypeLiteral = Literal["global", "device"]


class BlockedTargetCreateRequest(BaseModel):
    """Request payload for POST /api/v1/analytics/blocked-targets (`FB-P18-001`)."""

    target_type: BlockTargetTypeLiteral
    target_value: str = Field(..., min_length=1, max_length=255)
    scope_type: BlockScopeTypeLiteral = "global"
    device_id: int | None = None
    organization_name: str = Field(default="", max_length=255)
    reason: str = Field(default="", max_length=500)


class BlockedTargetResponse(BaseModel):
    """Serialized custom domain or ASN block rule (`FB-P18-001`)."""

    id: int
    target_type: BlockTargetTypeLiteral
    target_value: str
    scope_type: BlockScopeTypeLiteral
    device_id: int | None = None
    device_name: str | None = None
    device_ip: str | None = None
    organization_name: str = ""
    reason: str = ""
    is_enabled: bool = True
    created_at: str
    updated_at: str


class BlockedTargetListResponse(BaseModel):
    """Response payload for GET /api/v1/analytics/blocked-targets."""

    total_count: int
    enabled_count: int
    items: list[BlockedTargetResponse]


class BlockedTargetActionResponse(BaseModel):
    """Mutation response for create/delete/toggle custom domain/ASN blocks."""

    item: BlockedTargetResponse | None = None
    deleted_id: int | None = None
    opnsense_synced: bool = False
    warning: str | None = None


class TargetAttributionDeviceItem(BaseModel):
    """LAN client traffic breakdown for a single domain or ASN drilldown (`FB-P18-003`)."""

    device_id: int | None = None
    ipv4_address: str
    effective_name: str
    vendor: str | None = None
    is_online: bool = False
    is_blocked: bool = False
    is_protected: bool = False
    event_count: int = 0
    dns_queries: int = 0
    bytes: int = 0
    allowed_packets: int = 0
    blocked_packets: int = 0
    last_seen_at: str | None = None


class TargetAttributionResponse(BaseModel):
    """Response payload for GET /api/v1/analytics/attribution (`FB-P18-003`)."""

    target_type: str
    target_value: str
    window: str
    generated_at: str
    es_reachable: bool = True
    warning: str | None = None
    total_events: int = 0
    total_bytes: int = 0
    clients: list[TargetAttributionDeviceItem] = Field(default_factory=list)


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
    application_usage: list[AppUsageItem] = Field(default_factory=_build_zero_app_usage)


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
    source_ip: str | None = None
    device_name: str | None = None


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
    application_usage: list[AppUsageItem] = Field(default_factory=_build_zero_app_usage)


# ---------------------------------------------------------------------------
# Short-TTL In-Memory Cache
# ---------------------------------------------------------------------------


class AnalyticsCache:
    """Simple monotonic-clock TTL cache for Elasticsearch aggregation payloads."""

    def __init__(self, ttl_seconds: float = 90.0) -> None:
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

    def set(
        self,
        key: str,
        value: Any,
        *,
        ttl_seconds: float | None = None,
    ) -> None:
        effective_ttl = (
            float(ttl_seconds) if ttl_seconds is not None else self._ttl
        )
        self._store[key] = (time.monotonic() + effective_ttl, value)

    def clear(self) -> None:
        self._store.clear()


_analytics_cache = AnalyticsCache(ttl_seconds=90.0)


def get_analytics_cache() -> AnalyticsCache:
    """Return the singleton in-memory analytics cache."""
    return _analytics_cache


def resolve_telemetry_cache_ttl(window: str) -> float:
    """Return window-aware in-memory telemetry cache TTL in seconds (`Q2` / `Q4`).

    - `30d`: 1800s (30m)
    - `7d`: 900s (15m)
    - `today`: 180s (3m)
    - `1h`, `24h`: 90s
    """
    cleaned = (window or "24h").strip().lower()
    if cleaned == "30d":
        return 1800.0
    if cleaned == "7d":
        return 900.0
    if cleaned == "today":
        return 180.0
    return 90.0


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
        application_usage=_parse_app_usage_items(es_data, sqlite_devices, settings),
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
        application_usage=_parse_app_usage_items(es_data),
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
    record_perf: bool = True,
) -> NetworkOverviewResponse:
    """Return network-wide usage, timeline, top devices (joined with SQLite), and top domains."""
    start_t = time.perf_counter()
    win_key, _, _ = resolve_time_window(window)
    cache = get_analytics_cache()
    cache_key = f"overview:{win_key}"

    if not refresh:
        cached = cache.get(cache_key)
        if isinstance(cached, NetworkOverviewResponse):
            if record_perf:
                elapsed_ms = (time.perf_counter() - start_t) * 1000.0
                await record_performance_analysis_audit_log(
                    db,
                    view="analytics_overview",
                    window=win_key,
                    elapsed_ms=elapsed_ms,
                    cache_hit=True,
                    force_refresh=False,
                    total_events=cached.summary.total_events,
                )
            return cached

    stmt = select(Device)
    result = await db.execute(stmt)
    sqlite_devices = list(result.scalars().all())
    protected_db_ips = [
        d.ipv4_address
        for d in sqlite_devices
        if d.is_protected and d.ipv4_address
    ]

    try:
        try:
            es_data = await es_client.fetch_network_overview(
                window=win_key,
                top_n=12,
                excluded_ips=protected_db_ips,
            )
        except TypeError:
            es_data = await es_client.fetch_network_overview(window=win_key, top_n=12)
    except ElasticsearchQueryError as exc:
        await record_upstream_error_audit_log(
            db,
            service="elasticsearch",
            operation=f"network_overview:{win_key}",
            error_message=str(exc),
        )
        return _build_empty_overview_response(
            window=win_key,
            warning=str(exc),
            es_reachable=False,
        )

    fallback_plex = next(
        (
            a
            for a in (es_data.get("application_usage") or [])
            if isinstance(a, dict) and a.get("app_key") == "plex"
        ),
        None,
    )
    plex_override = await fetch_plex_telemetry_for_analytics(
        db,
        settings,
        window=win_key,
        sqlite_devices=sqlite_devices,
        fallback_plex_dict=fallback_plex,
        refresh=refresh,
    )
    enriched_es_data = _apply_plex_override_to_es_data(es_data, plex_override)

    response = _assemble_network_overview_response(
        es_data=enriched_es_data,
        sqlite_devices=sqlite_devices,
        settings=settings,
        window=win_key,
    )
    ttl = resolve_telemetry_cache_ttl(win_key)
    cache.set(cache_key, response, ttl_seconds=ttl)
    if record_perf:
        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        await record_performance_analysis_audit_log(
            db,
            view="analytics_overview",
            window=win_key,
            elapsed_ms=elapsed_ms,
            cache_hit=False,
            force_refresh=refresh,
            total_events=response.summary.total_events,
        )
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
    start_t = time.perf_counter()
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
            if not clean_search:
                elapsed_ms = (time.perf_counter() - start_t) * 1000.0
                await record_performance_analysis_audit_log(
                    db,
                    view="device_analytics",
                    window=win_key,
                    elapsed_ms=elapsed_ms,
                    cache_hit=True,
                    force_refresh=False,
                    total_events=cached.summary.total_events,
                )
            return cached.model_copy(update={"device": dev_resp})

    try:
        es_data = await es_client.fetch_device_analytics(
            ipv4_address=dev.ipv4_address,
            window=win_key,
            domain_search=clean_search,
        )
    except ElasticsearchQueryError as exc:
        await record_upstream_error_audit_log(
            db,
            service="elasticsearch",
            operation=f"device_analytics:{dev.ipv4_address}:{win_key}",
            error_message=str(exc),
        )
        return _build_empty_device_analytics_response(
            device_resp=dev_resp,
            window=win_key,
            warning=str(exc),
            es_reachable=False,
        )

    fallback_plex = next(
        (
            a
            for a in (es_data.get("application_usage") or [])
            if isinstance(a, dict) and a.get("app_key") == "plex"
        ),
        None,
    )
    plex_override = await fetch_plex_telemetry_for_analytics(
        db,
        settings,
        window=win_key,
        sqlite_devices=[dev],
        target_ips={dev.ipv4_address},
        fallback_plex_dict=fallback_plex,
        refresh=refresh,
    )
    enriched_es_data = _apply_plex_override_to_es_data(es_data, plex_override)

    response = _assemble_device_analytics_response(
        device_resp=dev_resp,
        es_data=enriched_es_data,
        window=win_key,
    )
    ttl = resolve_telemetry_cache_ttl(win_key)
    cache.set(cache_key, response, ttl_seconds=ttl)
    if not clean_search:
        elapsed_ms = (time.perf_counter() - start_t) * 1000.0
        await record_performance_analysis_audit_log(
            db,
            view="device_analytics",
            window=win_key,
            elapsed_ms=elapsed_ms,
            cache_hit=False,
            force_refresh=refresh,
            total_events=response.summary.total_events,
        )
    return response


# ---------------------------------------------------------------------------
# Phase 18: Custom Domain & ASN Blocking (`FB-P18-001`) + Client Attribution (`FB-P18-003`)
# ---------------------------------------------------------------------------


def build_blocked_target_response(
    row: BlockedTarget,
    devices_by_id: dict[int, Device],
    settings: Settings | None = None,
) -> BlockedTargetResponse:
    """Serialize a `BlockedTarget` ORM row with resolved device metadata."""
    t_type: BlockTargetTypeLiteral = (
        "asn" if str(row.target_type).strip().lower() == "asn" else "domain"
    )
    s_type: BlockScopeTypeLiteral = (
        "device" if str(row.scope_type).strip().lower() == "device" else "global"
    )
    dev = devices_by_id.get(row.device_id) if row.device_id is not None else None
    dev_name: str | None = None
    dev_ip: str | None = None
    if dev is not None:
        dev_name = (
            (dev.display_name or "").strip()
            or (dev.hostname or "").strip()
            or dev.ipv4_address
            or dev.mac_address
        )
        dev_ip = dev.ipv4_address
        if settings is not None and not dev_name:
            dev_name = build_device_response(dev, settings).effective_name

    created_iso = row.created_at.isoformat() if row.created_at else utc_now().isoformat()
    updated_iso = row.updated_at.isoformat() if row.updated_at else created_iso
    return BlockedTargetResponse(
        id=row.id,
        target_type=t_type,
        target_value=row.target_value,
        scope_type=s_type,
        device_id=row.device_id,
        device_name=dev_name,
        device_ip=dev_ip,
        organization_name=row.organization_name or "",
        reason=row.reason or "",
        is_enabled=bool(row.is_enabled),
        created_at=created_iso,
        updated_at=updated_iso,
    )


def collect_opnsense_custom_block_inputs(
    rows: list[BlockedTarget],
    devices_by_id: dict[int, Device],
) -> tuple[list[str], list[str], list[str]]:
    """Collect enabled domain names, ASNs, and device-scoped IPv4 addresses for OPNsense."""
    domains: list[str] = []
    asns: list[str] = []
    device_ips: list[str] = []
    for row in rows:
        if not row.is_enabled:
            continue
        if row.target_type == "domain":
            if row.target_value not in domains:
                domains.append(row.target_value)
        elif row.target_type == "asn":
            if row.target_value not in asns:
                asns.append(row.target_value)
        if row.scope_type == "device" and row.device_id is not None:
            dev = devices_by_id.get(row.device_id)
            if dev is not None and dev.ipv4_address and dev.ipv4_address not in device_ips:
                device_ips.append(dev.ipv4_address)
    return domains, asns, device_ips


def enrich_attribution_clients_with_sqlite(
    raw_clients: list[dict[str, Any]],
    sqlite_devices: list[Device],
    settings: Settings,
) -> list[TargetAttributionDeviceItem]:
    """Enrich attribution IP rows with SQLite `Device` display names and guardrail flags."""
    by_ip: dict[str, Device] = {
        d.ipv4_address: d for d in sqlite_devices if d.ipv4_address
    }
    protected_ips = settings.protected_ip_set
    items: list[TargetAttributionDeviceItem] = []
    for c in raw_clients:
        ip_str = str(c.get("ipv4_address") or "").strip()
        if not ip_str:
            continue
        dev = by_ip.get(ip_str)
        if dev is not None:
            dev_resp = build_device_response(dev, settings, None)
            items.append(
                TargetAttributionDeviceItem(
                    device_id=dev_resp.id,
                    ipv4_address=ip_str,
                    effective_name=dev_resp.effective_name,
                    vendor=dev_resp.vendor,
                    is_online=dev_resp.is_online,
                    is_blocked=dev_resp.is_blocked,
                    is_protected=dev_resp.is_protected,
                    event_count=int(c.get("event_count") or 0),
                    dns_queries=int(c.get("dns_queries") or 0),
                    bytes=int(c.get("bytes") or 0),
                    allowed_packets=int(c.get("allowed_packets") or 0),
                    blocked_packets=int(c.get("blocked_packets") or 0),
                    last_seen_at=c.get("last_seen_at"),
                )
            )
        else:
            items.append(
                TargetAttributionDeviceItem(
                    device_id=None,
                    ipv4_address=ip_str,
                    effective_name=ip_str,
                    vendor=None,
                    is_online=False,
                    is_blocked=False,
                    is_protected=ip_str in protected_ips,
                    event_count=int(c.get("event_count") or 0),
                    dns_queries=int(c.get("dns_queries") or 0),
                    bytes=int(c.get("bytes") or 0),
                    allowed_packets=int(c.get("allowed_packets") or 0),
                    blocked_packets=int(c.get("blocked_packets") or 0),
                    last_seen_at=c.get("last_seen_at"),
                )
            )
    return items


async def sync_custom_blocks_to_opnsense(
    db: AsyncSession,
    opnsense: OPNsenseClient,
) -> tuple[bool, str | None]:
    """Push enabled SQLite custom domain/ASN rules to OPNsense managed aliases."""
    rows = list((await db.execute(select(BlockedTarget))).scalars().all())
    devs = list((await db.execute(select(Device))).scalars().all())
    devices_by_id = {d.id: d for d in devs}
    domains, asns, device_ips = collect_opnsense_custom_block_inputs(rows, devices_by_id)
    try:
        await opnsense.sync_custom_block_aliases(
            domains=domains,
            asns=asns,
            device_ips=device_ips,
        )
        return True, None
    except (OPNsenseClientError, httpx.HTTPError, ValueError) as exc:
        return (
            False,
            f"Saved rule in SQLite, but OPNsense alias sync returned a warning: {exc}",
        )


async def list_blocked_targets(
    db: AsyncSession,
    settings: Settings | None = None,
) -> BlockedTargetListResponse:
    """List all persisted custom domain & ASN block rules ordered newest-first."""
    rows = list(
        (await db.execute(select(BlockedTarget).order_by(BlockedTarget.id.desc())))
        .scalars()
        .all()
    )
    devs = list((await db.execute(select(Device))).scalars().all())
    devices_by_id = {d.id: d for d in devs}
    items = [build_blocked_target_response(r, devices_by_id, settings) for r in rows]
    return BlockedTargetListResponse(
        total_count=len(items),
        enabled_count=sum(1 for i in items if i.is_enabled),
        items=items,
    )


def prepare_blocked_target_upsert(
    payload: BlockedTargetCreateRequest,
    t_type: str,
    t_val: str,
    s_type: str,
    target_device: Device | None,
    existing: BlockedTarget | None,
    settings: Settings,
    client_ip: str | None,
    actor: str,
    now: datetime,
) -> tuple[BlockedTarget, AuditLog, bool]:
    """Create or re-enable a `BlockedTarget` row and matching `AuditLog` entry."""
    _ = (settings, client_ip)
    effective_device_id = (
        target_device.id if s_type == "device" and target_device is not None else None
    )
    if existing is not None:
        existing.is_enabled = True
        if payload.organization_name.strip():
            existing.organization_name = payload.organization_name.strip()
        if payload.reason.strip():
            existing.reason = payload.reason.strip()
        existing.updated_at = now
        row = existing
        is_new = False
    else:
        row = BlockedTarget(
            target_type=t_type,
            target_value=t_val,
            scope_type=s_type,
            device_id=effective_device_id,
            organization_name=payload.organization_name.strip(),
            reason=payload.reason.strip(),
            is_enabled=True,
            created_at=now,
            updated_at=now,
        )
        is_new = True

    scope_desc = (
        f"device #{effective_device_id}" if s_type == "device" else "all LAN devices (global)"
    )
    audit_entry = AuditLog(
        actor=actor,
        action=f"device.block_{t_type}",
        audit_label="DEVICE_CONTROL",
        target=f"{t_type}:{t_val}",
        status="success",
        details=f"Blocked {t_type} '{t_val}' for {scope_desc}.",
    )
    return row, audit_entry, is_new


def apply_blocked_target_toggle(
    row: BlockedTarget | None,
    block_id: int,
    actor: str,
    now: datetime,
) -> tuple[BlockedTarget, AuditLog]:
    """Toggle `is_enabled` on a `BlockedTarget` row or raise 404, plus audit entry."""
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Blocked target #{block_id} not found.",
        )
    row.is_enabled = not bool(row.is_enabled)
    row.updated_at = now
    state_word = "Enabled" if row.is_enabled else "Disabled"
    audit_entry = AuditLog(
        actor=actor,
        action=f"device.toggle_block_{row.target_type}",
        audit_label="DEVICE_CONTROL",
        target=f"{row.target_type}:{row.target_value}",
        status="success",
        details=f"{state_word} {row.target_type} block '{row.target_value}'.",
    )
    return row, audit_entry


def prepare_blocked_target_delete_audit(
    row: BlockedTarget | None,
    block_id: int,
    actor: str,
) -> tuple[BlockedTarget, AuditLog]:
    """Validate existence for delete and build the corresponding `AuditLog` entry."""
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Blocked target #{block_id} not found.",
        )
    audit_entry = AuditLog(
        actor=actor,
        action=f"device.unblock_{row.target_type}",
        audit_label="DEVICE_CONTROL",
        target=f"{row.target_type}:{row.target_value}",
        status="success",
        details=f"Removed {row.target_type} block '{row.target_value}'.",
    )
    return row, audit_entry


def validate_attribution_params(
    target_type: str,
    target_value: str,
    window: str,
) -> tuple[str, str, str]:
    """Validate and normalize query parameters for target attribution drilldown."""
    try:
        win_key, _, _ = resolve_time_window(window)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    clean_type = (target_type or "").strip().lower()
    if clean_type not in ("domain", "registered_domain", "asn", "organization"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "target_type must be one of: domain, registered_domain, asn, organization."
            ),
        )
    clean_val = (target_value or "").strip()
    if not clean_val:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_value cannot be empty.",
        )
    return clean_type, clean_val, win_key


def assemble_target_attribution_response(
    clean_type: str,
    clean_val: str,
    win_key: str,
    raw: dict[str, Any] | None,
    sqlite_devices: list[Device],
    settings: Settings,
    warning: str | None = None,
) -> TargetAttributionResponse:
    """Assemble `TargetAttributionResponse` from raw ES results and SQLite devices."""
    if raw is None or warning is not None:
        return TargetAttributionResponse(
            target_type=clean_type,
            target_value=clean_val,
            window=win_key,
            generated_at=datetime.now(UTC).isoformat(),
            es_reachable=False,
            warning=warning,
        )
    clients = enrich_attribution_clients_with_sqlite(
        raw.get("clients") or [],
        sqlite_devices,
        settings,
    )
    return TargetAttributionResponse(
        target_type=clean_type,
        target_value=clean_val,
        window=win_key,
        generated_at=datetime.now(UTC).isoformat(),
        es_reachable=True,
        total_events=int(raw.get("total_events") or 0),
        total_bytes=int(raw.get("total_bytes") or 0),
        clients=clients,
    )


async def create_blocked_target(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    payload: BlockedTargetCreateRequest,
    *,
    actor: str,
    client_ip: str | None = None,
) -> BlockedTargetActionResponse:
    """Create or re-enable a custom domain or ASN block rule and sync OPNsense aliases."""
    try:
        t_type = normalize_block_target_type(payload.target_type)
        t_val = normalize_block_target_value(t_type, payload.target_value)
        s_type = normalize_block_scope_type(payload.scope_type)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    target_device: Device | None = None
    effective_device_id: int | None = None
    if s_type == "device":
        if payload.device_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="device_id is required when scope_type is 'device'.",
            )
        target_device = await db.get(Device, payload.device_id)
        if target_device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device #{payload.device_id} not found.",
            )
        dev_resp = build_device_response(target_device, settings, client_ip)
        if dev_resp.is_protected:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Device '{dev_resp.effective_name}' is protected "
                    f"({dev_resp.protection_reason})."
                ),
            )
        effective_device_id = target_device.id

    stmt = select(BlockedTarget).where(
        BlockedTarget.target_type == t_type,
        BlockedTarget.target_value == t_val,
        BlockedTarget.scope_type == s_type,
    )
    if effective_device_id is None:
        stmt = stmt.where(BlockedTarget.device_id.is_(None))
    else:
        stmt = stmt.where(BlockedTarget.device_id == effective_device_id)

    existing = (await db.execute(stmt)).scalar_one_or_none()
    row, audit_entry, is_new = prepare_blocked_target_upsert(
        payload,
        t_type,
        t_val,
        s_type,
        target_device,
        existing,
        settings,
        client_ip,
        actor,
        utc_now(),
    )
    if is_new:
        db.add(row)
    db.add(audit_entry)

    await db.flush()
    row_id = row.id
    await db.commit()
    await db.refresh(row)

    synced, warning = await sync_custom_blocks_to_opnsense(db, opnsense)
    devs = list((await db.execute(select(Device))).scalars().all())
    devices_by_id = {d.id: d for d in devs}
    item = build_blocked_target_response(
        (await db.get(BlockedTarget, row_id)) or row,
        devices_by_id,
        settings,
    )
    return BlockedTargetActionResponse(
        item=item,
        opnsense_synced=synced,
        warning=warning,
    )


async def toggle_blocked_target(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    block_id: int,
    *,
    actor: str,
) -> BlockedTargetActionResponse:
    """Toggle `is_enabled` for an existing custom domain or ASN block rule."""
    row, audit_entry = apply_blocked_target_toggle(
        await db.get(BlockedTarget, block_id),
        block_id,
        actor,
        utc_now(),
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(row)

    synced, warning = await sync_custom_blocks_to_opnsense(db, opnsense)
    devs = list((await db.execute(select(Device))).scalars().all())
    devices_by_id = {d.id: d for d in devs}
    return BlockedTargetActionResponse(
        item=build_blocked_target_response(row, devices_by_id, settings),
        opnsense_synced=synced,
        warning=warning,
    )


async def delete_blocked_target(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    block_id: int,
    *,
    actor: str,
) -> BlockedTargetActionResponse:
    """Delete a custom domain or ASN block rule and synchronize OPNsense aliases."""
    row, audit_entry = prepare_blocked_target_delete_audit(
        await db.get(BlockedTarget, block_id),
        block_id,
        actor,
    )
    await db.delete(row)
    db.add(audit_entry)
    await db.commit()

    synced, warning = await sync_custom_blocks_to_opnsense(db, opnsense)
    return BlockedTargetActionResponse(
        deleted_id=block_id,
        opnsense_synced=synced,
        warning=warning,
    )


async def get_target_attribution_analytics(
    db: AsyncSession,
    settings: Settings,
    es_client: ElasticsearchServiceClient,
    *,
    target_type: str,
    target_value: str,
    window: str = "today",
) -> TargetAttributionResponse:
    """Return LAN device attribution breakdown for a domain or ASN (`FB-P18-003`)."""
    clean_type, clean_val, win_key = validate_attribution_params(
        target_type,
        target_value,
        window,
    )
    sqlite_devices = list((await db.execute(select(Device))).scalars().all())
    try:
        raw = await es_client.fetch_target_attribution(
            target_type=clean_type,
            target_value=clean_val,
            window=win_key,
        )
    except ElasticsearchQueryError as exc:
        await record_upstream_error_audit_log(
            db,
            service="elasticsearch",
            operation=f"attribution:{clean_type}:{clean_val}:{win_key}",
            error_message=str(exc),
        )
        return assemble_target_attribution_response(
            clean_type,
            clean_val,
            win_key,
            None,
            sqlite_devices,
            settings,
            warning=str(exc),
        )

    return assemble_target_attribution_response(
        clean_type,
        clean_val,
        win_key,
        raw,
        sqlite_devices,
        settings,
    )
