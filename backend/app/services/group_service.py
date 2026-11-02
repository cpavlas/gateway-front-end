"""Device groups / profiles CRUD, bulk block/unblock, and group analytics service (Phase 4)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    resolve_time_window,
    sanitize_domain_search,
)
from app.clients.opnsense import OPNsenseClient, OPNsenseClientError
from app.config import Settings
from app.models import (
    AuditLog,
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    normalize_group_color,
    utc_now,
)
from app.services.analytics_service import (
    AppUsageItem,
    DeviceAnalyticsSummary,
    HourlyAccessPoint,
    RecentDomainQueryItem,
    TimelineBucketItem,
    TopDomainItem,
    TopOrganizationItem,
    _build_zero_app_usage,
    _build_zero_hourly_profile,
    _parse_app_usage_items,
    get_analytics_cache,
)
from app.services.device_service import (
    DeviceResponse,
    build_device_group_badge_map,
    build_device_response,
)
from app.services.schedule_service import ActiveScheduleInfo, get_active_schedule_maps
from app.services.timer_service import (
    ActiveOverrideInfo,
    cancel_active_overrides_for_group,
    load_active_override_maps,
)

GroupStatusLiteral = Literal["empty", "allowed", "partially_blocked", "blocked"]


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------


class GroupCreateRequest(BaseModel):
    """Request payload for POST /api/v1/groups."""

    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    color_badge: str = Field(default="indigo", max_length=32)
    icon: str = Field(default="users", max_length=32)
    device_ids: list[int] = Field(default_factory=list)


class GroupUpdateRequest(BaseModel):
    """Request payload for PATCH /api/v1/groups/{group_id}."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=1000)
    color_badge: str | None = Field(default=None, max_length=32)
    icon: str | None = Field(default=None, max_length=32)
    device_ids: list[int] | None = None


class GroupMembersUpdateRequest(BaseModel):
    """Request payload for PUT /api/v1/groups/{group_id}/members."""

    device_ids: list[int] = Field(default_factory=list)


class GroupResponse(BaseModel):
    """Serialized device group representation including computed state and members."""

    id: int
    name: str
    description: str
    color_badge: str
    icon: str
    access_status: GroupStatusLiteral
    youtube_status: GroupStatusLiteral = "empty"
    total_devices: int
    online_devices: int
    blocked_devices: int
    youtube_blocked_devices: int = 0
    protected_devices: int
    blockable_devices: int
    member_device_ids: list[int]
    members: list[DeviceResponse]
    active_override: ActiveOverrideInfo | None = None
    active_schedule: ActiveScheduleInfo | None = None
    created_at: str
    updated_at: str


class GroupListResponse(BaseModel):
    """Response payload for GET /api/v1/groups."""

    groups: list[GroupResponse]


class GroupBulkActionResponse(BaseModel):
    """Response payload for POST /api/v1/groups/{group_id}/block and /unblock."""

    group: GroupResponse
    action: Literal["block", "unblock", "youtube_block", "youtube_unblock"]
    affected_device_ids: list[int]
    affected_ips: list[str]
    skipped_protected_names: list[str]
    skipped_no_ip_names: list[str]
    states_killed_ips: list[str]
    warnings: list[str]


class GroupMemberTrafficItem(BaseModel):
    """Per-member traffic & DNS contribution within a group (Waterfall Update 4A)."""

    device_id: int
    effective_name: str
    ipv4_address: str | None
    mac_address: str
    vendor: str | None
    is_online: bool
    is_blocked: bool
    is_protected: bool
    total_events: int = 0
    bytes: int = 0
    dns_query_count: int = 0
    allowed_packet_count: int = 0
    blocked_packet_count: int = 0


class GroupAnalyticsResponse(BaseModel):
    """Response payload for GET /api/v1/groups/{group_id}/analytics."""

    group: GroupResponse
    tracked_ips: list[str]
    window: str
    generated_at: str
    es_reachable: bool = True
    warning: str | None = None
    summary: DeviceAnalyticsSummary
    member_breakdown: list[GroupMemberTrafficItem]
    timeline: list[TimelineBucketItem]
    hourly_access_profile: list[HourlyAccessPoint]
    top_domains: list[TopDomainItem]
    top_registered_domains: list[TopDomainItem]
    top_organizations: list[TopOrganizationItem]
    recent_queries: list[RecentDomainQueryItem]
    application_usage: list[AppUsageItem] = Field(default_factory=_build_zero_app_usage)


# ---------------------------------------------------------------------------
# Pure Synchronous Helper Functions (100% traced by Python 3.12 sys.monitoring)
# ---------------------------------------------------------------------------


def validate_group_fields(
    name: str,
    color_badge: str | None = "indigo",
    icon: str | None = "users",
) -> tuple[str, str, str]:
    """Validate and normalize group name, color badge, and icon token."""
    cleaned_name = name.strip()
    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group name cannot be empty.",
        )
    try:
        cleaned_color = normalize_group_color(color_badge)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    cleaned_icon = (icon or "users").strip().lower() or "users"
    return cleaned_name, cleaned_color, cleaned_icon


def compute_group_access_status(members: list[DeviceResponse]) -> GroupStatusLiteral:
    """Compute real-time group access state across non-protected blockable member devices."""
    if not members:
        return "empty"
    blockable = [m for m in members if not m.is_protected and m.ipv4_address]
    if not blockable:
        if any(m.is_blocked for m in members):
            return "blocked"
        return "empty"
    blocked_count = sum(1 for m in blockable if m.is_blocked)
    if blocked_count == 0:
        return "allowed"
    if blocked_count == len(blockable):
        return "blocked"
    if blocked_count == len(blockable):
        return "blocked"
    return "partially_blocked"


def compute_group_youtube_status(members: list[DeviceResponse]) -> GroupStatusLiteral:
    """Compute real-time group YouTube block state across non-protected blockable member devices."""
    if not members:
        return "empty"
    blockable = [m for m in members if not m.is_protected and m.ipv4_address]
    if not blockable:
        if any(m.is_youtube_blocked for m in members):
            return "blocked"
        return "empty"
    blocked_count = sum(1 for m in blockable if m.is_youtube_blocked)
    if blocked_count == 0:
        return "allowed"
    if blocked_count == len(blockable):
        return "blocked"
    return "partially_blocked"


def build_group_response(
    group: DeviceGroup,
    members: list[DeviceResponse],
    active_override: ActiveOverrideInfo | None = None,
    active_schedule: ActiveScheduleInfo | None = None,
) -> GroupResponse:
    """Construct a sorted `GroupResponse` with computed status and KPI counts."""
    sorted_members = sorted(
        members,
        key=lambda d: (
            0 if d.is_online else 1,
            0 if d.is_blocked else 1,
            d.effective_name.lower(),
        ),
    )
    blockable = [m for m in sorted_members if not m.is_protected and m.ipv4_address]
    return GroupResponse(
        id=group.id,
        name=group.name,
        description=group.description or "",
        color_badge=group.color_badge,
        icon=group.icon,
        access_status=compute_group_access_status(sorted_members),
        youtube_status=compute_group_youtube_status(sorted_members),
        total_devices=len(sorted_members),
        online_devices=sum(1 for m in sorted_members if m.is_online),
        blocked_devices=sum(1 for m in sorted_members if m.is_blocked),
        youtube_blocked_devices=sum(1 for m in sorted_members if m.is_youtube_blocked),
        protected_devices=sum(1 for m in sorted_members if m.is_protected),
        blockable_devices=len(blockable),
        member_device_ids=[m.id for m in sorted_members],
        members=sorted_members,
        active_override=active_override,
        active_schedule=active_schedule,
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
    )


def assemble_group_responses(
    groups: list[DeviceGroup],
    memberships: list[DeviceGroupMembership],
    devices: list[Device],
    settings: Settings,
    client_ip: str | None = None,
    overrides_by_device: dict[int, ActiveOverrideInfo] | None = None,
    overrides_by_group: dict[int, ActiveOverrideInfo] | None = None,
    schedules_by_device: dict[int, ActiveScheduleInfo] | None = None,
    schedules_by_group: dict[int, ActiveScheduleInfo] | None = None,
) -> list[GroupResponse]:
    """Assemble all `GroupResponse` items sorted alphabetically by group name."""
    badges_by_device = build_device_group_badge_map(groups, memberships)
    dev_overrides = overrides_by_device or {}
    grp_overrides = overrides_by_group or {}
    dev_schedules = schedules_by_device or {}
    grp_schedules = schedules_by_group or {}
    device_resp_by_id: dict[int, DeviceResponse] = {
        d.id: build_device_response(
            d,
            settings,
            client_ip,
            groups=badges_by_device.get(d.id, []),
            active_override=dev_overrides.get(d.id),
            active_schedule=dev_schedules.get(d.id),
        )
        for d in devices
    }
    members_by_group: dict[int, list[DeviceResponse]] = {g.id: [] for g in groups}
    for m in memberships:
        dev_resp = device_resp_by_id.get(m.device_id)
        if dev_resp is not None and m.group_id in members_by_group:
            members_by_group[m.group_id].append(dev_resp)

    sorted_groups = sorted(groups, key=lambda g: g.name.lower())
    return [
        build_group_response(
            g,
            members_by_group.get(g.id, []),
            active_override=grp_overrides.get(g.id),
            active_schedule=grp_schedules.get(g.id),
        )
        for g in sorted_groups
    ]


def plan_group_bulk_action(
    members: list[DeviceResponse],
    action: Literal["block", "unblock", "youtube_block", "youtube_unblock"],
) -> dict[str, Any]:
    """Determine eligible device IDs/IPs and skipped devices for a bulk group block/unblock."""
    eligible_device_ids: list[int] = []
    eligible_ips: list[str] = []
    seen_ips: set[str] = set()
    skipped_protected_names: list[str] = []
    skipped_no_ip_names: list[str] = []

    if action == "block":
        for m in members:
            if m.is_protected:
                skipped_protected_names.append(m.effective_name)
                continue
            if not m.ipv4_address:
                skipped_no_ip_names.append(m.effective_name)
                continue
            eligible_device_ids.append(m.id)
            if m.ipv4_address not in seen_ips:
                seen_ips.add(m.ipv4_address)
                eligible_ips.append(m.ipv4_address)
    else:
        for m in members:
            eligible_device_ids.append(m.id)
            if not m.ipv4_address:
                skipped_no_ip_names.append(m.effective_name)
                continue
            if m.ipv4_address not in seen_ips:
                seen_ips.add(m.ipv4_address)
                eligible_ips.append(m.ipv4_address)

    return {
        "eligible_device_ids": eligible_device_ids,
        "eligible_ips": eligible_ips,
        "skipped_protected_names": skipped_protected_names,
        "skipped_no_ip_names": skipped_no_ip_names,
    }


def _build_empty_group_analytics_response(
    group_resp: GroupResponse,
    tracked_ips: list[str],
    window: str,
    warning: str,
    es_reachable: bool = False,
) -> GroupAnalyticsResponse:
    """Return a zero-state GroupAnalyticsResponse when group has no IPs or ES is unreachable."""
    member_breakdown = [
        GroupMemberTrafficItem(
            device_id=m.id,
            effective_name=m.effective_name,
            ipv4_address=m.ipv4_address,
            mac_address=m.mac_address,
            vendor=m.vendor,
            is_online=m.is_online,
            is_blocked=m.is_blocked,
            is_protected=m.is_protected,
        )
        for m in group_resp.members
    ]
    return GroupAnalyticsResponse(
        group=group_resp,
        tracked_ips=tracked_ips,
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
        member_breakdown=member_breakdown,
        timeline=[],
        hourly_access_profile=_build_zero_hourly_profile(),
        top_domains=[],
        top_registered_domains=[],
        top_organizations=[],
        recent_queries=[],
    )


def _assemble_group_analytics_response(
    group_resp: GroupResponse,
    tracked_ips: list[str],
    es_data: dict[str, Any],
    window: str,
) -> GroupAnalyticsResponse:
    """Assemble a typed GroupAnalyticsResponse joining ES member IP buckets with SQLite members."""
    raw_summary = es_data.get("summary") or {}
    stats_by_ip: dict[str, dict[str, int]] = {
        str(item.get("ip")): item
        for item in (es_data.get("member_ip_breakdown") or [])
        if item.get("ip")
    }
    name_by_ip: dict[str, str] = {
        m.ipv4_address: m.effective_name
        for m in group_resp.members
        if m.ipv4_address
    }

    member_breakdown: list[GroupMemberTrafficItem] = []
    for m in group_resp.members:
        ip_stats = stats_by_ip.get(m.ipv4_address or "", {})
        member_breakdown.append(
            GroupMemberTrafficItem(
                device_id=m.id,
                effective_name=m.effective_name,
                ipv4_address=m.ipv4_address,
                mac_address=m.mac_address,
                vendor=m.vendor,
                is_online=m.is_online,
                is_blocked=m.is_blocked,
                is_protected=m.is_protected,
                total_events=int(ip_stats.get("total_events") or 0),
                bytes=int(ip_stats.get("bytes") or 0),
                dns_query_count=int(ip_stats.get("dns_query_count") or 0),
                allowed_packet_count=int(ip_stats.get("allowed_packet_count") or 0),
                blocked_packet_count=int(ip_stats.get("blocked_packet_count") or 0),
            )
        )
    member_breakdown.sort(
        key=lambda item: (item.bytes, item.total_events, item.dns_query_count),
        reverse=True,
    )

    recent_queries: list[RecentDomainQueryItem] = []
    for q in es_data.get("recent_queries") or []:
        src_ip = q.get("source_ip")
        recent_queries.append(
            RecentDomainQueryItem(
                timestamp=str(q.get("timestamp") or ""),
                domain=str(q.get("domain") or ""),
                registered_domain=q.get("registered_domain"),
                record_type=str(q.get("record_type") or "A"),
                source_ip=src_ip,
                device_name=name_by_ip.get(src_ip) if src_ip else None,
            )
        )

    return GroupAnalyticsResponse(
        group=group_resp,
        tracked_ips=tracked_ips,
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
        member_breakdown=member_breakdown,
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
        recent_queries=recent_queries,
        application_usage=_parse_app_usage_items(es_data),
    )


def _require_group_or_404(group: DeviceGroup | None, group_id: int) -> DeviceGroup:
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device group {group_id} not found.",
        )
    return group


# ---------------------------------------------------------------------------
# Async Database & Service Operations
# ---------------------------------------------------------------------------


async def _sync_group_memberships(
    db: AsyncSession,
    group_id: int,
    device_ids: list[int],
) -> None:
    """Replace a group's memberships with the validated set of existing device_ids."""
    unique_ids = sorted({int(did) for did in device_ids if int(did) > 0})
    if unique_ids:
        existing_ids = set(
            (
                await db.execute(select(Device.id).where(Device.id.in_(unique_ids)))
            )
            .scalars()
            .all()
        )
        missing = sorted(set(unique_ids) - existing_ids)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device IDs not found: {missing}",
            )
    await db.execute(
        delete(DeviceGroupMembership).where(DeviceGroupMembership.group_id == group_id)
    )
    now = utc_now()
    for did in unique_ids:
        db.add(
            DeviceGroupMembership(
                group_id=group_id,
                device_id=did,
                created_at=now,
            )
        )


async def list_groups(
    db: AsyncSession,
    settings: Settings,
    *,
    client_ip: str | None = None,
) -> GroupListResponse:
    """List all device groups with their assigned members and computed access state."""
    groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    if not groups:
        return GroupListResponse(groups=[])
    memberships = list((await db.execute(select(DeviceGroupMembership))).scalars().all())
    devices = list((await db.execute(select(Device))).scalars().all())
    overrides_by_device, overrides_by_group = await load_active_override_maps(db)
    schedules_by_device, schedules_by_group = await get_active_schedule_maps(db)
    return GroupListResponse(
        groups=assemble_group_responses(
            groups,
            memberships,
            devices,
            settings,
            client_ip,
            overrides_by_device=overrides_by_device,
            overrides_by_group=overrides_by_group,
            schedules_by_device=schedules_by_device,
            schedules_by_group=schedules_by_group,
        )
    )


async def get_group_by_id(
    db: AsyncSession,
    settings: Settings,
    group_id: int,
    *,
    client_ip: str | None = None,
) -> GroupResponse:
    """Fetch a single DeviceGroup and its members or raise HTTP 404."""
    raw_grp = (
        await db.execute(select(DeviceGroup).where(DeviceGroup.id == group_id))
    ).scalar_one_or_none()
    grp = _require_group_or_404(raw_grp, group_id)
    all_groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    memberships = list((await db.execute(select(DeviceGroupMembership))).scalars().all())
    devices = list((await db.execute(select(Device))).scalars().all())
    overrides_by_device, overrides_by_group = await load_active_override_maps(db)
    schedules_by_device, schedules_by_group = await get_active_schedule_maps(db)
    assembled = assemble_group_responses(
        all_groups,
        memberships,
        devices,
        settings,
        client_ip,
        overrides_by_device=overrides_by_device,
        overrides_by_group=overrides_by_group,
        schedules_by_device=schedules_by_device,
        schedules_by_group=schedules_by_group,
    )
    for item in assembled:
        if item.id == grp.id:
            return item
    return build_group_response(grp, [])


async def create_group(
    db: AsyncSession,
    settings: Settings,
    payload: GroupCreateRequest,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupResponse:
    """Create a new device group and optional initial member assignments."""
    cleaned_name, cleaned_color, cleaned_icon = validate_group_fields(
        payload.name,
        payload.color_badge,
        payload.icon,
    )
    dup = (
        await db.execute(
            select(DeviceGroup).where(func.lower(DeviceGroup.name) == cleaned_name.lower())
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A device group named '{cleaned_name}' already exists.",
        )

    now = utc_now()
    grp = DeviceGroup(
        name=cleaned_name,
        description=payload.description.strip(),
        color_badge=cleaned_color,
        icon=cleaned_icon,
        created_at=now,
        updated_at=now,
    )
    db.add(grp)
    await db.flush()

    if payload.device_ids:
        await _sync_group_memberships(db, grp.id, payload.device_ids)

    db.add(
        AuditLog(
            actor=actor,
            action="group.create",
            target=cleaned_name,
            status="success",
            details=f"Created group '{cleaned_name}' with {len(set(payload.device_ids))} members.",
        )
    )
    await db.commit()
    return await get_group_by_id(db, settings, grp.id, client_ip=client_ip)


async def update_group(
    db: AsyncSession,
    settings: Settings,
    group_id: int,
    payload: GroupUpdateRequest,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupResponse:
    """Update a device group's metadata and/or member device list."""
    raw_grp = (
        await db.execute(select(DeviceGroup).where(DeviceGroup.id == group_id))
    ).scalar_one_or_none()
    grp = _require_group_or_404(raw_grp, group_id)

    new_name = payload.name if payload.name is not None else grp.name
    new_color = payload.color_badge if payload.color_badge is not None else grp.color_badge
    new_icon = payload.icon if payload.icon is not None else grp.icon
    cleaned_name, cleaned_color, cleaned_icon = validate_group_fields(
        new_name, new_color, new_icon
    )

    if cleaned_name.lower() != grp.name.lower():
        dup = (
            await db.execute(
                select(DeviceGroup).where(
                    func.lower(DeviceGroup.name) == cleaned_name.lower(),
                    DeviceGroup.id != group_id,
                )
            )
        ).scalar_one_or_none()
        if dup is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A device group named '{cleaned_name}' already exists.",
            )

    grp.name = cleaned_name
    grp.color_badge = cleaned_color
    grp.icon = cleaned_icon
    if payload.description is not None:
        grp.description = payload.description.strip()
    grp.updated_at = utc_now()

    if payload.device_ids is not None:
        await _sync_group_memberships(db, grp.id, payload.device_ids)

    db.add(
        AuditLog(
            actor=actor,
            action="group.update",
            target=grp.name,
            status="success",
            details=f"Updated group '{grp.name}'.",
        )
    )
    await db.commit()
    return await get_group_by_id(db, settings, grp.id, client_ip=client_ip)


async def set_group_members(
    db: AsyncSession,
    settings: Settings,
    group_id: int,
    payload: GroupMembersUpdateRequest,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupResponse:
    """Replace the member devices of a group."""
    raw_grp = (
        await db.execute(select(DeviceGroup).where(DeviceGroup.id == group_id))
    ).scalar_one_or_none()
    grp = _require_group_or_404(raw_grp, group_id)
    await _sync_group_memberships(db, grp.id, payload.device_ids)
    grp.updated_at = utc_now()

    db.add(
        AuditLog(
            actor=actor,
            action="group.members",
            target=grp.name,
            status="success",
            details=f"Set {len(set(payload.device_ids))} members on group '{grp.name}'.",
        )
    )
    await db.commit()
    return await get_group_by_id(db, settings, grp.id, client_ip=client_ip)


async def delete_group(
    db: AsyncSession,
    group_id: int,
    *,
    actor: str,
) -> None:
    """Delete a device group and its membership links (devices remain intact)."""
    raw_grp = (
        await db.execute(select(DeviceGroup).where(DeviceGroup.id == group_id))
    ).scalar_one_or_none()
    grp = _require_group_or_404(raw_grp, group_id)
    grp_name = grp.name
    await db.execute(
        delete(DeviceGroupMembership).where(DeviceGroupMembership.group_id == group_id)
    )
    await db.delete(grp)
    db.add(
        AuditLog(
            actor=actor,
            action="group.delete",
            target=grp_name,
            status="success",
            details=f"Deleted device group '{grp_name}'.",
        )
    )
    await db.commit()


async def block_group_internet(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    group_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupBulkActionResponse:
    """Block internet access for all non-protected member devices in a group."""
    grp_resp = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    plan = plan_group_bulk_action(grp_resp.members, action="block")
    eligible_ids: list[int] = plan["eligible_device_ids"]
    eligible_ips: list[str] = plan["eligible_ips"]
    skipped_protected: list[str] = plan["skipped_protected_names"]
    skipped_no_ip: list[str] = plan["skipped_no_ip_names"]

    if not eligible_ips:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Group '{grp_resp.name}' has no blockable devices with an IPv4 address "
                f"(protected={len(skipped_protected)}, without IP={len(skipped_no_ip)})."
            ),
        )

    try:
        for ip in eligible_ips:
            await opnsense.add_ip_to_block_alias(ip)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        db.add(
            AuditLog(
                actor=actor,
                action="group.block",
                target=grp_resp.name,
                status="failed",
                details=f"Bulk block alias update failed: {exc}",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to update OPNsense block alias for group '{grp_resp.name}': {exc}",
        ) from exc

    states_killed_ips: list[str] = []
    warnings: list[str] = []
    for ip in eligible_ips:
        try:
            await opnsense.kill_states_for_ip(ip)
            states_killed_ips.append(ip)
        except (OPNsenseClientError, httpx.HTTPError) as exc:
            warnings.append(f"kill_states warning for {ip}: {exc}")

    if skipped_protected:
        warnings.append(
            f"Skipped protected device(s): {', '.join(skipped_protected)}"
        )
    if skipped_no_ip:
        warnings.append(
            f"Skipped device(s) without IPv4: {', '.join(skipped_no_ip)}"
        )

    now = utc_now()
    devs = list(
        (await db.execute(select(Device).where(Device.id.in_(eligible_ids)))).scalars().all()
    )
    for d in devs:
        d.is_blocked = True
        if not actor.startswith(("timer", "schedule")):
            d.is_manually_blocked = True
        d.updated_at = now

    await cancel_active_overrides_for_group(db, group_id, now)
    db.add(
        AuditLog(
            actor=actor,
            action="group.block",
            target=f"{grp_resp.name} ({len(eligible_ips)} IPs)",
            status="warning" if warnings else "success",
            details=(
                f"Blocked {len(eligible_ips)} IPs ({', '.join(eligible_ips)}). "
                + ("; ".join(warnings) if warnings else "All active states terminated.")
            ),
        )
    )
    await db.commit()

    updated_group = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    return GroupBulkActionResponse(
        group=updated_group,
        action="block",
        affected_device_ids=eligible_ids,
        affected_ips=eligible_ips,
        skipped_protected_names=skipped_protected,
        skipped_no_ip_names=skipped_no_ip,
        states_killed_ips=states_killed_ips,
        warnings=warnings,
    )


async def unblock_group_internet(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    group_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupBulkActionResponse:
    """Restore internet access for all member devices in a group."""
    grp_resp = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    plan = plan_group_bulk_action(grp_resp.members, action="unblock")
    eligible_ids: list[int] = plan["eligible_device_ids"]
    eligible_ips: list[str] = plan["eligible_ips"]
    skipped_no_ip: list[str] = plan["skipped_no_ip_names"]

    if not eligible_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Group '{grp_resp.name}' has no member devices to unblock.",
        )

    try:
        for ip in eligible_ips:
            await opnsense.remove_ip_from_block_alias(ip)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        db.add(
            AuditLog(
                actor=actor,
                action="group.unblock",
                target=grp_resp.name,
                status="failed",
                details=f"Bulk unblock alias update failed: {exc}",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to remove IPs from OPNsense block alias for '{grp_resp.name}': {exc}",
        ) from exc

    warnings: list[str] = []
    if skipped_no_ip:
        warnings.append(
            f"Device(s) had no IPv4 address: {', '.join(skipped_no_ip)}"
        )

    now = utc_now()
    devs = list(
        (await db.execute(select(Device).where(Device.id.in_(eligible_ids)))).scalars().all()
    )
    for d in devs:
        d.is_blocked = False
        if not actor.startswith(("timer", "schedule")):
            d.is_manually_blocked = False
        d.updated_at = now

    await cancel_active_overrides_for_group(db, group_id, now)
    db.add(
        AuditLog(
            actor=actor,
            action="group.unblock",
            target=f"{grp_resp.name} ({len(eligible_ips)} IPs)",
            status="success",
            details=f"Unblocked {len(eligible_ips)} IPs ({', '.join(eligible_ips)}).",
        )
    )
    await db.commit()

    updated_group = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    return GroupBulkActionResponse(
        group=updated_group,
        action="unblock",
        affected_device_ids=eligible_ids,
        affected_ips=eligible_ips,
        skipped_protected_names=[],
        skipped_no_ip_names=skipped_no_ip,
        states_killed_ips=[],
        warnings=warnings,
    )


async def block_group_youtube(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    group_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupBulkActionResponse:
    """Block YouTube access for all non-protected member devices in a group."""
    grp_resp = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    plan = plan_group_bulk_action(grp_resp.members, action="block")
    eligible_ids: list[int] = plan["eligible_device_ids"]
    eligible_ips: list[str] = plan["eligible_ips"]
    skipped_protected: list[str] = plan["skipped_protected_names"]
    skipped_no_ip: list[str] = plan["skipped_no_ip_names"]

    if not eligible_ips:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Group '{grp_resp.name}' has no blockable devices with an IPv4 address "
                f"(protected={len(skipped_protected)}, without IP={len(skipped_no_ip)})."
            ),
        )

    try:
        for ip in eligible_ips:
            await opnsense.add_ip_to_youtube_block_alias(ip)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        db.add(
            AuditLog(
                actor=actor,
                action="group.youtube_block",
                target=grp_resp.name,
                status="failed",
                details=f"Bulk YouTube block alias update failed: {exc}",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Failed to update OPNsense YouTube block alias "
                f"for group '{grp_resp.name}': {exc}"
            ),
        ) from exc

    warnings: list[str] = []
    if skipped_protected:
        warnings.append(f"Skipped protected device(s): {', '.join(skipped_protected)}")
    if skipped_no_ip:
        warnings.append(f"Skipped device(s) without IPv4: {', '.join(skipped_no_ip)}")

    now = utc_now()
    devs = list(
        (await db.execute(select(Device).where(Device.id.in_(eligible_ids)))).scalars().all()
    )
    for d in devs:
        d.is_youtube_blocked = True
        d.updated_at = now

    db.add(
        AuditLog(
            actor=actor,
            action="group.youtube_block",
            target=f"{grp_resp.name} ({len(eligible_ips)} IPs)",
            status="warning" if warnings else "success",
            details=(
                f"Blocked YouTube for {len(eligible_ips)} IPs ({', '.join(eligible_ips)}). "
                + ("; ".join(warnings) if warnings else "Plex and general internet remain allowed.")
            ),
        )
    )
    await db.commit()

    updated_group = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    return GroupBulkActionResponse(
        group=updated_group,
        action="youtube_block",
        affected_device_ids=eligible_ids,
        affected_ips=eligible_ips,
        skipped_protected_names=skipped_protected,
        skipped_no_ip_names=skipped_no_ip,
        states_killed_ips=[],
        warnings=warnings,
    )


async def unblock_group_youtube(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    group_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> GroupBulkActionResponse:
    """Restore YouTube access for all member devices in a group."""
    grp_resp = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    plan = plan_group_bulk_action(grp_resp.members, action="unblock")
    eligible_ids: list[int] = plan["eligible_device_ids"]
    eligible_ips: list[str] = plan["eligible_ips"]
    skipped_no_ip: list[str] = plan["skipped_no_ip_names"]

    if not eligible_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Group '{grp_resp.name}' has no member devices to unblock.",
        )

    try:
        for ip in eligible_ips:
            await opnsense.remove_ip_from_youtube_block_alias(ip)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        db.add(
            AuditLog(
                actor=actor,
                action="group.youtube_unblock",
                target=grp_resp.name,
                status="failed",
                details=f"Bulk YouTube unblock alias update failed: {exc}",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Failed to remove IPs from OPNsense YouTube block alias "
                f"for '{grp_resp.name}': {exc}"
            ),
        ) from exc

    warnings: list[str] = []
    if skipped_no_ip:
        warnings.append(f"Device(s) had no IPv4 address: {', '.join(skipped_no_ip)}")

    now = utc_now()
    devs = list(
        (await db.execute(select(Device).where(Device.id.in_(eligible_ids)))).scalars().all()
    )
    for d in devs:
        d.is_youtube_blocked = False
        d.updated_at = now

    db.add(
        AuditLog(
            actor=actor,
            action="group.youtube_unblock",
            target=f"{grp_resp.name} ({len(eligible_ips)} IPs)",
            status="success",
            details=f"Unblocked YouTube for {len(eligible_ips)} IPs ({', '.join(eligible_ips)}).",
        )
    )
    await db.commit()

    updated_group = await get_group_by_id(db, settings, group_id, client_ip=client_ip)
    return GroupBulkActionResponse(
        group=updated_group,
        action="youtube_unblock",
        affected_device_ids=eligible_ids,
        affected_ips=eligible_ips,
        skipped_protected_names=[],
        skipped_no_ip_names=skipped_no_ip,
        states_killed_ips=[],
        warnings=warnings,
    )


async def get_group_analytics(
    db: AsyncSession,
    settings: Settings,
    es_client: ElasticsearchServiceClient,
    group_id: int,
    window: str = "24h",
    domain_search: str | None = None,
    refresh: bool = False,
    client_ip: str | None = None,
) -> GroupAnalyticsResponse:
    """Return multi-IP usage stats, per-member breakdown, 24h access profile, and domains."""
    win_key, _, _ = resolve_time_window(window)
    clean_search = sanitize_domain_search(domain_search)
    grp_resp = await get_group_by_id(db, settings, group_id, client_ip=client_ip)

    tracked_ips = sorted(
        {m.ipv4_address for m in grp_resp.members if m.ipv4_address}
    )
    if not tracked_ips:
        return _build_empty_group_analytics_response(
            group_resp=grp_resp,
            tracked_ips=[],
            window=win_key,
            warning="No member devices with an IPv4 address are assigned to this group yet.",
            es_reachable=True,
        )

    cache = get_analytics_cache()
    ips_sig = ",".join(tracked_ips)
    cache_key = f"group:{grp_resp.id}:{ips_sig}:{win_key}:{clean_search or ''}"
    if not refresh:
        cached = cache.get(cache_key)
        if isinstance(cached, GroupAnalyticsResponse):
            return cached.model_copy(update={"group": grp_resp})

    try:
        es_data = await es_client.fetch_group_analytics(
            ipv4_addresses=tracked_ips,
            window=win_key,
            domain_search=clean_search,
        )
    except ElasticsearchQueryError as exc:
        return _build_empty_group_analytics_response(
            group_resp=grp_resp,
            tracked_ips=tracked_ips,
            window=win_key,
            warning=str(exc),
            es_reachable=False,
        )

    response = _assemble_group_analytics_response(
        group_resp=grp_resp,
        tracked_ips=tracked_ips,
        es_data=es_data,
        window=win_key,
    )
    cache.set(cache_key, response)
    return response

