"""Phase 10 Firewall & Security analytics service (`FB-P10-001`)."""

from __future__ import annotations

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
)
from app.clients.opnsense import OPNsenseClient
from app.config import Settings
from app.models import Device
from app.services.analytics_service import TimelineBucketItem, get_analytics_cache
from app.services.audit_and_backup_service import record_upstream_error_audit_log

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
        and settings.opnsense_api_secret != "changeme"
    ):
        try:
            opn_client = OPNsenseClient(settings)
            live_mappings = await opn_client.get_destination_nat_mappings()
            if live_mappings:
                _LAST_KNOWN_NAT_MAPPINGS.update(live_mappings)
        except Exception:
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
) -> FirewallOverviewResponse:
    """Fetch Phase 10 Firewall & Security telemetry and enrich LAN IPs with SQLite devices."""
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
            return build_firewall_overview_response(
                merged_cached,
                sqlite_devices,
                settings,
                window=win_key,
                es_reachable=True,
                nat_port_mappings=nat_mappings,
            )

    try:
        es_data = await es_client.fetch_firewall_overview(
            window=win_key,
            action=clean_action if clean_action != "all" else None,
            direction=clean_dir if clean_dir != "all" else None,
            protocol=clean_proto if clean_proto != "all" else None,
            search=clean_search or None,
        )
        if window_aggs is None:
            window_aggs = {
                "summary": es_data.get("summary"),
                "timeline": es_data.get("timeline"),
                "noisy_lan_sources": es_data.get("noisy_lan_sources"),
                "external_scanners": es_data.get("external_scanners"),
                "open_wan_ports": es_data.get("open_wan_ports"),
            }
            cache.set(window_cache_key, window_aggs)
            _LAST_GOOD_WINDOW_AGGS[win_key] = window_aggs
        else:
            es_data = {
                **es_data,
                **window_aggs,
                "recent_events": es_data.get("recent_events", []),
            }
        cache.set(cache_key, es_data)
        return build_firewall_overview_response(
            es_data,
            sqlite_devices,
            settings,
            window=win_key,
            es_reachable=True,
            nat_port_mappings=nat_mappings,
        )
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
