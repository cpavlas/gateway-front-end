"""Phase 10 Firewall & Security analytics service (`FB-P10-001`)."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    resolve_time_window,
    sanitize_firewall_search,
    validate_ipv4_address,
)
from app.clients.opnsense import OPNsenseClient
from app.config import Settings
from app.models import Device
from app.services.analytics_service import TimelineBucketItem, get_analytics_cache
from app.services.audit_and_backup_service import (
    record_performance_analysis_audit_log,
    record_upstream_error_audit_log,
)

_LAST_GOOD_WINDOW_AGGS: dict[str, dict[str, Any]] = {}
_LAST_KNOWN_NAT_MAPPINGS: dict[tuple[str, int, str], int] = {}


class FirewallOverviewSummary(BaseModel):
    """Firewall packet KPI metrics for the selected time window."""

    total_packets: int = 0
    allowed_packets: int = 0
    blocked_packets: int = 0
    inbound_packets: int = 0
    outbound_packets: int = 0
    total_bytes: int = 0
    open_wan_port_count: int = 0


class FirewallNoisyLanDeviceItem(BaseModel):
    """Internal LAN device generating blocked firewall packets (with 1-click block correlation)."""

    device_id: int | None = None
    ipv4_address: str
    effective_name: str
    mac_address: str | None = None
    is_online: bool = False
    is_blocked: bool = False
    is_protected: bool = False
    blocked_packets: int = 0
    bytes: int = 0
    target_ports: list[int] = Field(default_factory=list)
    last_seen_at: str | None = None


class FirewallExternalScannerItem(BaseModel):
    """External non-RFC1918 WAN source IP blocked at the perimeter."""

    source_ip: str
    organization: str | None = None
    blocked_packets: int = 0
    bytes: int = 0
    target_ports: list[int] = Field(default_factory=list)
    last_seen_at: str | None = None


class FirewallOpenWanPortItem(BaseModel):
    """Active inbound WAN exposure (`event.action == 'pass'`) to a LAN IP/port."""

    device_id: int | None = None
    destination_ip: str
    effective_name: str
    external_port: int = 0
    destination_port: int
    port_mapping: str = ""
    protocol: str
    passed_packets: int = 0
    bytes: int = 0
    unique_external_sources: int = 0
    last_seen_at: str | None = None


class FirewallLogEventItem(BaseModel):
    """Individual searchable `filterlog` event row."""

    timestamp: str
    action: str
    direction: str
    protocol: str
    interface: str
    source_ip: str
    source_name: str | None = None
    source_port: int | None = None
    source_org: str | None = None
    destination_ip: str
    destination_name: str | None = None
    destination_port: int | None = None
    destination_org: str | None = None
    bytes: int = 0
    rule_id: str = ""


class FirewallOverviewResponse(BaseModel):
    """Response model for `GET /api/v1/firewall/overview` (`FB-P10-001`)."""

    window: str
    generated_at: str
    es_reachable: bool
    warning: str | None = None
    summary: FirewallOverviewSummary
    timeline: list[TimelineBucketItem]
    noisy_lan_devices: list[FirewallNoisyLanDeviceItem]
    external_scanners: list[FirewallExternalScannerItem]
    open_wan_ports: list[FirewallOpenWanPortItem]
    recent_events: list[FirewallLogEventItem]


def build_firewall_overview_response(
    es_data: dict[str, Any] | None,
    sqlite_devices: list[Device],
    settings: Settings,
    *,
    window: str,
    es_reachable: bool,
    warning: str | None = None,
    nat_port_mappings: dict[tuple[str, int, str], int] | None = None,
) -> FirewallOverviewResponse:
    """Pure synchronous helper joining Elasticsearch `filterlog` telemetry
    with SQLite `Device` rows and OPNsense Destination NAT (`external_port:destination_port`).
    """
    generated_at = datetime.now(UTC).isoformat()
    if not es_reachable or es_data is None:
        return FirewallOverviewResponse(
            window=window,
            generated_at=generated_at,
            es_reachable=False,
            warning=warning,
            summary=FirewallOverviewSummary(),
            timeline=[],
            noisy_lan_devices=[],
            external_scanners=[],
            open_wan_ports=[],
            recent_events=[],
        )

    by_ip: dict[str, Device] = {
        d.ipv4_address: d for d in sqlite_devices if d.ipv4_address
    }
    protected_ips = settings.protected_ip_set
    nat_map = nat_port_mappings or {}

    def _resolve_device_name(ip_str: str) -> tuple[Device | None, str]:
        dev = by_ip.get(ip_str)
        if dev is None:
            return None, ip_str
        eff = (
            (dev.display_name or "").strip()
            or (dev.hostname or "").strip()
            or ip_str
        )
        return dev, eff

    raw_summary = es_data.get("summary") or {}
    summary = FirewallOverviewSummary(
        total_packets=int(raw_summary.get("total_packets") or 0),
        allowed_packets=int(raw_summary.get("allowed_packets") or 0),
        blocked_packets=int(raw_summary.get("blocked_packets") or 0),
        inbound_packets=int(raw_summary.get("inbound_packets") or 0),
        outbound_packets=int(raw_summary.get("outbound_packets") or 0),
        total_bytes=int(raw_summary.get("total_bytes") or 0),
        open_wan_port_count=int(raw_summary.get("open_wan_port_count") or 0),
    )

    timeline = [TimelineBucketItem(**t) for t in (es_data.get("timeline") or [])]

    noisy_lan_devices: list[FirewallNoisyLanDeviceItem] = []
    for item in es_data.get("noisy_lan_sources") or []:
        ip_str = str(item.get("ipv4_address") or "").strip()
        if not ip_str:
            continue
        dev, eff_name = _resolve_device_name(ip_str)
        noisy_lan_devices.append(
            FirewallNoisyLanDeviceItem(
                device_id=dev.id if dev is not None else None,
                ipv4_address=ip_str,
                effective_name=eff_name,
                mac_address=dev.mac_address if dev is not None else None,
                is_online=bool(dev.is_online) if dev is not None else False,
                is_blocked=bool(dev.is_blocked) if dev is not None else False,
                is_protected=(
                    bool(dev.is_protected or ip_str in protected_ips)
                    if dev is not None
                    else (ip_str in protected_ips)
                ),
                blocked_packets=int(item.get("blocked_packets") or 0),
                bytes=int(item.get("bytes") or 0),
                target_ports=[int(p) for p in (item.get("target_ports") or [])],
                last_seen_at=item.get("last_seen_at"),
            )
        )

    external_scanners = [
        FirewallExternalScannerItem(**s)
        for s in (es_data.get("external_scanners") or [])
    ]

    raw_wan_ports = list(es_data.get("open_wan_ports") or [])
    existing_wan_keys = {
        (
            str(wp.get("destination_ip") or "").strip(),
            int(wp.get("destination_port") or 0),
            str(wp.get("protocol") or "tcp").lower(),
        )
        for wp in raw_wan_ports
    }
    for (nat_ip, nat_port, nat_proto), nat_ext in sorted(nat_map.items()):
        if (nat_ip, nat_port, nat_proto) not in existing_wan_keys:
            raw_wan_ports.append(
                {
                    "destination_ip": nat_ip,
                    "destination_port": nat_port,
                    "external_port": nat_ext,
                    "protocol": nat_proto,
                    "passed_packets": 0,
                    "bytes": 0,
                    "unique_external_sources": 0,
                    "last_seen_at": None,
                }
            )
            existing_wan_keys.add((nat_ip, nat_port, nat_proto))

    claimed_external_ports: set[tuple[int, str]] = set()
    explicit_ext_by_idx: dict[int, int] = {}

    # Pass 1: assign explicit NAT mappings from OPNsense `d_nat` / `query_states`
    for idx, wp in enumerate(raw_wan_ports):
        dest_ip = str(wp.get("destination_ip") or "").strip()
        dest_port = int(wp.get("destination_port") or 0)
        proto = str(wp.get("protocol") or "tcp").lower()
        mapped_ext = nat_map.get((dest_ip, dest_port, proto))
        if mapped_ext is None and wp.get("external_port"):
            mapped_ext = int(wp["external_port"])
        if mapped_ext is not None and mapped_ext > 0:
            explicit_ext_by_idx[idx] = mapped_ext
            claimed_external_ports.add((mapped_ext, proto))

    # Pass 2: assign external_port & port_mapping (`external_port:destination_port`),
    # deduplicating when multiple LAN hosts share the same redirect port (e.g. 32400 -> 32401).
    open_wan_ports: list[FirewallOpenWanPortItem] = []
    for idx, wp in enumerate(raw_wan_ports):
        dest_ip = str(wp.get("destination_ip") or "").strip()
        if not dest_ip:
            continue
        dest_port = int(wp.get("destination_port") or 0)
        proto = str(wp.get("protocol") or "tcp").lower()
        if idx in explicit_ext_by_idx:
            ext_port = explicit_ext_by_idx[idx]
        else:
            ext_port = dest_port
            while ext_port > 0 and (ext_port, proto) in claimed_external_ports:
                ext_port += 1
            if ext_port > 0:
                claimed_external_ports.add((ext_port, proto))
        dev, eff_name = _resolve_device_name(dest_ip)
        open_wan_ports.append(
            FirewallOpenWanPortItem(
                device_id=dev.id if dev is not None else None,
                destination_ip=dest_ip,
                effective_name=eff_name,
                external_port=ext_port,
                destination_port=dest_port,
                port_mapping=f"{ext_port}:{dest_port}",
                protocol=proto,
                passed_packets=int(wp.get("passed_packets") or 0),
                bytes=int(wp.get("bytes") or 0),
                unique_external_sources=int(wp.get("unique_external_sources") or 0),
                last_seen_at=wp.get("last_seen_at"),
            )
        )
    summary.open_wan_port_count = max(summary.open_wan_port_count, len(open_wan_ports))

    recent_events: list[FirewallLogEventItem] = []
    for ev in es_data.get("recent_events") or []:
        src_ip = str(ev.get("source_ip") or "").strip()
        dst_ip = str(ev.get("destination_ip") or "").strip()
        src_dev, src_name = _resolve_device_name(src_ip)
        dst_dev, dst_name = _resolve_device_name(dst_ip)
        recent_events.append(
            FirewallLogEventItem(
                timestamp=str(ev.get("timestamp") or ""),
                action=str(ev.get("action") or "unknown"),
                direction=str(ev.get("direction") or "unknown"),
                protocol=str(ev.get("protocol") or "unknown"),
                interface=str(ev.get("interface") or ""),
                source_ip=src_ip,
                source_name=src_name if src_dev is not None else None,
                source_port=ev.get("source_port"),
                source_org=ev.get("source_org"),
                destination_ip=dst_ip,
                destination_name=dst_name if dst_dev is not None else None,
                destination_port=ev.get("destination_port"),
                destination_org=ev.get("destination_org"),
                bytes=int(ev.get("bytes") or 0),
                rule_id=str(ev.get("rule_id") or ""),
            )
        )

    return FirewallOverviewResponse(
        window=window,
        generated_at=generated_at,
        es_reachable=True,
        warning=warning,
        summary=summary,
        timeline=timeline,
        noisy_lan_devices=noisy_lan_devices,
        external_scanners=external_scanners,
        open_wan_ports=open_wan_ports,
        recent_events=recent_events,
    )


async def _get_nat_port_mappings(
    settings: Settings,
    *,
    refresh: bool = False,
) -> dict[tuple[str, int, str], int]:
    """Return cached or live OPNsense Destination NAT port mappings."""
    cache = get_analytics_cache()
    nat_cache_key = "firewall:nat_port_mappings"
    if not refresh:
        cached_nat = cache.get(nat_cache_key)
        if isinstance(cached_nat, dict):
            return dict(_LAST_KNOWN_NAT_MAPPINGS)
    if (
        settings.opnsense_api_key
        and settings.opnsense_api_key != "changeme"
        and settings.opnsense_api_secret
        and settings.opnsense_api_secret != "changeme"  # noqa: S105
    ):
        try:
            opn_client = OPNsenseClient(settings)
            live_mappings = await opn_client.get_destination_nat_mappings()
            if live_mappings:
                _LAST_KNOWN_NAT_MAPPINGS.update(live_mappings)
        except Exception:  # noqa: S110
            pass
    cache.set(nat_cache_key, {"loaded": True})
    return dict(_LAST_KNOWN_NAT_MAPPINGS)


async def get_firewall_overview_analytics(
    db: AsyncSession,
    settings: Settings,
    es_client: ElasticsearchServiceClient,
    *,
    window: str = "24h",
    action: str | None = None,
    direction: str | None = None,
    protocol: str | None = None,
    search: str | None = None,
    refresh: bool = False,
    record_perf: bool = True,
) -> FirewallOverviewResponse:
    """Fetch Phase 10 Firewall & Security telemetry and enrich LAN IPs with SQLite devices."""
    start_t = time.perf_counter()
    try:
        win_key, _, _ = resolve_time_window(window)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    clean_search = sanitize_firewall_search(search) or ""
    clean_action = (action or "all").strip().lower()
    clean_dir = (direction or "all").strip().lower()
    clean_proto = (protocol or "all").strip().lower()
    has_active_filter = (
        clean_action != "all"
        or clean_dir != "all"
        or clean_proto != "all"
        or bool(clean_search)
    )

    cache = get_analytics_cache()
    window_cache_key = f"firewall_window:{win_key}"
    cache_key = (
        f"firewall:{win_key}:{clean_action}:{clean_dir}:{clean_proto}:{clean_search}"
    )

    sqlite_devices = list((await db.execute(select(Device))).scalars().all())
    nat_mappings = await _get_nat_port_mappings(settings, refresh=refresh)

    # Lock window-level aggregations (`summary`, `timeline`, `noisy_lan_sources`,
    # `external_scanners`, `open_wan_ports`) so changing Searchable Log Explorer filters
    # NEVER causes top panels to drift across different point-in-time ES snapshots (`BUG-P10-007`).
    window_aggs = None if refresh else cache.get(window_cache_key)
    if window_aggs is None and not refresh and has_active_filter:
        window_aggs = _LAST_GOOD_WINDOW_AGGS.get(win_key)

    if not refresh:
        cached_es = cache.get(cache_key)
        if cached_es is not None:
            merged_cached = (
                {**cached_es, **window_aggs, "recent_events": cached_es.get("recent_events", [])}
                if window_aggs is not None
                else cached_es
            )
            resp = build_firewall_overview_response(
                merged_cached,
                sqlite_devices,
                settings,
                window=win_key,
                es_reachable=True,
                nat_port_mappings=nat_mappings,
            )
            if record_perf and not has_active_filter:
                elapsed_ms = (time.perf_counter() - start_t) * 1000.0
                await record_performance_analysis_audit_log(
                    db,
                    view="firewall_overview",
                    window=win_key,
                    elapsed_ms=elapsed_ms,
                    cache_hit=True,
                    force_refresh=False,
                    total_events=resp.summary.total_packets,
                )
            return resp

    try:
        es_data = await es_client.fetch_firewall_overview(
            window=win_key,
            action=clean_action if clean_action != "all" else None,
            direction=clean_dir if clean_dir != "all" else None,
            protocol=clean_proto if clean_proto != "all" else None,
            search=clean_search or None,
        )
        ttl = 300.0 if win_key in ("7d", "30d") else 90.0
        if window_aggs is None:
            window_aggs = {
                "summary": es_data.get("summary"),
                "timeline": es_data.get("timeline"),
                "noisy_lan_sources": es_data.get("noisy_lan_sources"),
                "external_scanners": es_data.get("external_scanners"),
                "open_wan_ports": es_data.get("open_wan_ports"),
            }
            cache.set(window_cache_key, window_aggs, ttl_seconds=ttl)
            _LAST_GOOD_WINDOW_AGGS[win_key] = window_aggs
        else:
            es_data = {
                **es_data,
                **window_aggs,
                "recent_events": es_data.get("recent_events", []),
            }
        cache.set(cache_key, es_data, ttl_seconds=ttl)
        resp = build_firewall_overview_response(
            es_data,
            sqlite_devices,
            settings,
            window=win_key,
            es_reachable=True,
            nat_port_mappings=nat_mappings,
        )
        if record_perf and not has_active_filter:
            elapsed_ms = (time.perf_counter() - start_t) * 1000.0
            await record_performance_analysis_audit_log(
                db,
                view="firewall_overview",
                window=win_key,
                elapsed_ms=elapsed_ms,
                cache_hit=False,
                force_refresh=refresh,
                total_events=resp.summary.total_packets,
            )
        return resp
    except ElasticsearchQueryError as exc:
        await record_upstream_error_audit_log(
            db,
            service="elasticsearch",
            operation=f"firewall_overview:{win_key}",
            error_message=str(exc),
        )
        return build_firewall_overview_response(
            None,
            sqlite_devices,
            settings,
            window=win_key,
            es_reachable=False,
            warning=f"Elasticsearch telemetry temporarily unavailable ({exc}).",
            nat_port_mappings=nat_mappings,
        )


class FirewallOpenPortSessionsSummary(BaseModel):
    """Summary KPIs for external WAN IPs connected to a specific open WAN port (`FB-P13-002`)."""

    total_passed_packets: int = 0
    total_bytes: int = 0
    unique_external_ips: int = 0
    top_country: str | None = None
    first_seen_at: str | None = None
    last_seen_at: str | None = None


class FirewallConnectedExternalIpItem(BaseModel):
    """Per-external-IP GeoIP, ASN, connection duration, and packet telemetry (`FB-P13-002`)."""

    source_ip: str
    asn: int | None = None
    organization: str | None = None
    city_name: str | None = None
    region_name: str | None = None
    region_iso_code: str | None = None
    country_name: str | None = None
    country_iso_code: str | None = None
    continent_name: str | None = None
    location_label: str = "Unknown Location"
    latitude: float | None = None
    longitude: float | None = None
    passed_packets: int = 0
    bytes: int = 0
    first_seen_at: str | None = None
    last_seen_at: str | None = None
    connection_duration_seconds: int = 0
    connection_duration_label: str = "< 1s"
    active_duration_minutes: int = 0
    source_ports: list[int] = Field(default_factory=list)
    tcp_flags: str | None = None
    ttl: int | None = None
    interface: str | None = None
    rule_id: str | None = None
    community_id: str | None = None


class FirewallOpenPortSessionEventItem(BaseModel):
    """Individual chronological `filterlog` packet event for an open WAN port (`FB-P13-002`)."""

    timestamp: str
    source_ip: str
    source_port: int | None = None
    asn: int | None = None
    organization: str | None = None
    location_label: str = "Unknown Location"
    country_iso_code: str | None = None
    protocol: str = "tcp"
    bytes: int = 0
    tcp_flags: str | None = None
    ttl: int | None = None
    interface: str = ""
    rule_id: str = ""


class FirewallOpenPortSessionsResponse(BaseModel):
    """Response model for `GET /api/v1/firewall/open-ports/sessions` (`FB-P13-002`)."""

    window: str
    generated_at: str
    es_reachable: bool
    warning: str | None = None
    device_id: int | None = None
    effective_name: str
    destination_ip: str
    external_port: int
    destination_port: int
    port_mapping: str
    protocol: str
    summary: FirewallOpenPortSessionsSummary
    external_ips: list[FirewallConnectedExternalIpItem]
    recent_events: list[FirewallOpenPortSessionEventItem]


def build_open_wan_port_sessions_response(
    es_data: dict[str, Any] | None,
    sqlite_devices: list[Device],
    *,
    destination_ip: str,
    destination_port: int,
    external_port: int | None = None,
    protocol: str = "tcp",
    window: str = "24h",
    es_reachable: bool = True,
    warning: str | None = None,
) -> FirewallOpenPortSessionsResponse:
    """Pure synchronous helper assembling `FirewallOpenPortSessionsResponse` (`FB-P13-002`)."""
    generated_at = datetime.now(UTC).isoformat()
    clean_proto = (protocol or "tcp").strip().lower()
    ext_port = (
        int(external_port)
        if external_port and int(external_port) > 0
        else int(destination_port)
    )
    port_mapping = f"{ext_port}:{int(destination_port)}"

    dev = next(
        (d for d in sqlite_devices if d.ipv4_address == destination_ip),
        None,
    )
    effective_name = (
        ((dev.display_name or "").strip() or (dev.hostname or "").strip() or destination_ip)
        if dev is not None
        else destination_ip
    )

    if not es_reachable or es_data is None:
        return FirewallOpenPortSessionsResponse(
            window=window,
            generated_at=generated_at,
            es_reachable=False,
            warning=warning,
            device_id=dev.id if dev is not None else None,
            effective_name=effective_name,
            destination_ip=destination_ip,
            external_port=ext_port,
            destination_port=int(destination_port),
            port_mapping=port_mapping,
            protocol=clean_proto,
            summary=FirewallOpenPortSessionsSummary(),
            external_ips=[],
            recent_events=[],
        )

    raw_sum = es_data.get("summary") or {}
    summary = FirewallOpenPortSessionsSummary(
        total_passed_packets=int(raw_sum.get("total_passed_packets") or 0),
        total_bytes=int(raw_sum.get("total_bytes") or 0),
        unique_external_ips=int(raw_sum.get("unique_external_ips") or 0),
        top_country=raw_sum.get("top_country"),
        first_seen_at=raw_sum.get("first_seen_at"),
        last_seen_at=raw_sum.get("last_seen_at"),
    )
    external_ips = [
        FirewallConnectedExternalIpItem(**item)
        for item in (es_data.get("external_ips") or [])
    ]
    recent_events = [
        FirewallOpenPortSessionEventItem(**ev)
        for ev in (es_data.get("recent_events") or [])
    ]

    return FirewallOpenPortSessionsResponse(
        window=window,
        generated_at=generated_at,
        es_reachable=True,
        warning=warning,
        device_id=dev.id if dev is not None else None,
        effective_name=effective_name,
        destination_ip=destination_ip,
        external_port=ext_port,
        destination_port=int(destination_port),
        port_mapping=port_mapping,
        protocol=clean_proto,
        summary=summary,
        external_ips=external_ips,
        recent_events=recent_events,
    )


async def get_open_wan_port_sessions(
    db: AsyncSession,
    es_client: ElasticsearchServiceClient,
    *,
    destination_ip: str,
    destination_port: int,
    external_port: int | None = None,
    protocol: str = "tcp",
    window: str = "24h",
    search: str | None = None,
    refresh: bool = False,
) -> FirewallOpenPortSessionsResponse:
    """Fetch connected external WAN IP details for an open WAN port (`FB-P13-002`)."""
    start_t = time.perf_counter()
    try:
        win_key, _, _ = resolve_time_window(window)
        valid_ip = validate_ipv4_address(destination_ip)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    clean_proto = (protocol or "tcp").strip().lower()
    clean_search = sanitize_firewall_search(search) or ""
    cache = get_analytics_cache()
    cache_key = (
        f"wan_port_sessions:{valid_ip}:{int(destination_port)}:{clean_proto}:{win_key}:{clean_search}"
    )

    sqlite_devices = list((await db.execute(select(Device))).scalars().all())

    if not refresh:
        cached_es = cache.get(cache_key)
        if isinstance(cached_es, dict):
            resp = build_open_wan_port_sessions_response(
                cached_es,
                sqlite_devices,
                destination_ip=valid_ip,
                destination_port=destination_port,
                external_port=external_port,
                protocol=clean_proto,
                window=win_key,
                es_reachable=True,
            )
            if not clean_search:
                elapsed_ms = (time.perf_counter() - start_t) * 1000.0
                await record_performance_analysis_audit_log(
                    db,
                    view="wan_port_sessions",
                    window=win_key,
                    elapsed_ms=elapsed_ms,
                    cache_hit=True,
                    force_refresh=False,
                    total_events=resp.summary.total_passed_packets,
                )
            return resp

    try:
        es_data = await es_client.fetch_open_wan_port_sessions(
            destination_ip=valid_ip,
            destination_port=int(destination_port),
            protocol=clean_proto,
            window=win_key,
            search=clean_search or None,
        )
        ttl = 300.0 if win_key in ("7d", "30d") else 90.0
        cache.set(cache_key, es_data, ttl_seconds=ttl)
        resp = build_open_wan_port_sessions_response(
            es_data,
            sqlite_devices,
            destination_ip=valid_ip,
            destination_port=destination_port,
            external_port=external_port,
            protocol=clean_proto,
            window=win_key,
            es_reachable=True,
        )
        if not clean_search:
            elapsed_ms = (time.perf_counter() - start_t) * 1000.0
            await record_performance_analysis_audit_log(
                db,
                view="wan_port_sessions",
                window=win_key,
                elapsed_ms=elapsed_ms,
                cache_hit=False,
                force_refresh=refresh,
                total_events=resp.summary.total_passed_packets,
            )
        return resp
    except ElasticsearchQueryError as exc:
        await record_upstream_error_audit_log(
            db,
            service="elasticsearch",
            operation=f"wan_port_sessions:{valid_ip}:{destination_port}:{win_key}",
            error_message=str(exc),
        )
        return build_open_wan_port_sessions_response(
            None,
            sqlite_devices,
            destination_ip=valid_ip,
            destination_port=destination_port,
            external_port=external_port,
            protocol=clean_proto,
            window=win_key,
            es_reachable=False,
            warning=f"Elasticsearch telemetry temporarily unavailable ({exc}).",
        )

