"""Recurring weekly schedules, 5-tier policy evaluator, and DHCP IP drift reconciliation."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.opnsense import OPNsenseClient, OPNsenseClientError
from app.config import Settings
from app.models import (
    AuditLog,
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    RecurringSchedule,
    format_days_of_week,
    normalize_override_target_type,
    parse_days_of_week,
    utc_now,
    validate_time_hhmm,
)
from app.services.timer_service import ActiveOverrideInfo, load_active_override_maps

logger = logging.getLogger(__name__)

PolicyReason = Literal[
    "protected",
    "bonus_timer",
    "pause_timer",
    "manual_block",
    "schedule_block",
    "default_allowed",
]


class ActiveScheduleInfo(BaseModel):
    """Metadata describing an active recurring schedule currently matching a device or group."""

    schedule_id: int
    name: str
    target_type: Literal["device", "group"]
    target_id: int
    target_name: str
    start_time: str
    end_time: str
    timezone: str


class ScheduleCreateRequest(BaseModel):
    """Request payload for creating a recurring schedule."""

    name: str = Field(..., min_length=1, max_length=128)
    description: str = Field(default="", max_length=1000)
    target_type: Literal["device", "group"]
    device_id: int | None = None
    group_id: int | None = None
    days_of_week: list[int] = Field(..., min_length=1, max_length=7)
    start_time: str = Field(..., description="24-hour HH:MM start time")
    end_time: str = Field(..., description="24-hour HH:MM end time")
    timezone: str | None = None
    is_enabled: bool = True


class ScheduleUpdateRequest(BaseModel):
    """Request payload for updating an existing recurring schedule."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=1000)
    target_type: Literal["device", "group"] | None = None
    device_id: int | None = None
    group_id: int | None = None
    days_of_week: list[int] | None = Field(default=None, min_length=1, max_length=7)
    start_time: str | None = Field(default=None, description="24-hour HH:MM start time")
    end_time: str | None = Field(default=None, description="24-hour HH:MM end time")
    timezone: str | None = None
    is_enabled: bool | None = None


class ScheduleToggleRequest(BaseModel):
    """Request payload for enabling or disabling a recurring schedule."""

    is_enabled: bool


class ScheduleResponse(BaseModel):
    """Serialized recurring schedule with live active-window evaluation."""

    id: int
    name: str
    description: str
    target_type: Literal["device", "group"]
    device_id: int | None
    group_id: int | None
    target_name: str
    days_of_week: list[int]
    start_time: str
    end_time: str
    timezone: str
    is_enabled: bool
    is_active_now: bool
    created_at: str
    updated_at: str


class ScheduleListResponse(BaseModel):
    """Response wrapper for GET /api/v1/schedules."""

    schedules: list[ScheduleResponse]


class PolicyDecision(BaseModel):
    """Evaluated 5-tier policy decision for a single device."""

    device_id: int
    should_be_blocked: bool
    reason: PolicyReason
    active_schedule: ActiveScheduleInfo | None = None


class ScheduleReconciliationSummary(BaseModel):
    """Summary of a 60s or on-demand schedule & policy reconciliation cycle."""

    evaluated_device_count: int = 0
    newly_blocked_ips: list[str] = Field(default_factory=list)
    newly_unblocked_ips: list[str] = Field(default_factory=list)
    ip_drift_swaps: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    blocked_count: int = 0
    unblocked_count: int = 0
    ip_drift_healed_count: int = 0
    warnings: list[str] = Field(default_factory=list)


def _parse_hhmm_minutes(time_str: str) -> int:
    """Convert validated 'HH:MM' into minutes since midnight (0..1439)."""
    cleaned = validate_time_hhmm(time_str)
    hour_str, minute_str = cleaned.split(":")
    return int(hour_str) * 60 + int(minute_str)


def is_schedule_window_active(
    days_of_week: str | list[int],
    start_time: str,
    end_time: str,
    tz_name: str = "America/Los_Angeles",
    now_utc: datetime | None = None,
) -> bool:
    """Return True if the schedule's day-of-week & time window is active at now_utc.

    Supports both same-day windows (e.g. 15:00 -> 17:00) and overnight windows
    crossing midnight (e.g. 21:00 -> 07:00), where the post-midnight morning
    segment (00:00..06:59) is governed by yesterday's day-of-week.
    """
    ref_utc = now_utc or utc_now()
    if ref_utc.tzinfo is None:
        ref_utc = ref_utc.replace(tzinfo=UTC)

    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    days_set = set(parse_days_of_week(days_of_week))
    local_dt = ref_utc.astimezone(tz)
    current_minutes = local_dt.hour * 60 + local_dt.minute
    start_minutes = _parse_hhmm_minutes(start_time)
    end_minutes = _parse_hhmm_minutes(end_time)

    today_weekday = local_dt.weekday()  # 0=Mon .. 6=Sun
    yesterday_weekday = (today_weekday - 1) % 7

    if start_minutes == end_minutes:
        # 24-hour full-day block on selected days
        return today_weekday in days_set

    if start_minutes < end_minutes:
        # Same-day window (e.g. 15:00 -> 17:00)
        return today_weekday in days_set and (start_minutes <= current_minutes < end_minutes)

    # Overnight window crossing midnight (e.g. 21:00 -> 07:00)
    if current_minutes >= start_minutes:
        return today_weekday in days_set
    if current_minutes < end_minutes:
        return yesterday_weekday in days_set
    return False


def validate_schedule_payload(
    name: str,
    target_type: str,
    device_id: int | None,
    group_id: int | None,
    days_of_week: list[int],
    start_time: str,
    end_time: str,
    tz_name: str,
) -> tuple[str, str, list[int], str, str, str]:
    """Validate and normalize schedule input fields, raising HTTPException(422) on errors."""
    cleaned_name = name.strip()
    if not cleaned_name:
        raise HTTPException(
            status_code=422,
            detail="Schedule name must not be empty.",
        )

    try:
        norm_target = normalize_override_target_type(target_type)
        norm_days = parse_days_of_week(days_of_week)
        norm_start = validate_time_hhmm(start_time)
        norm_end = validate_time_hhmm(end_time)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    if norm_target == "device" and device_id is None:
        raise HTTPException(
            status_code=422,
            detail="device_id is required when target_type is 'device'.",
        )
    if norm_target == "group" and group_id is None:
        raise HTTPException(
            status_code=422,
            detail="group_id is required when target_type is 'group'.",
        )

    cleaned_tz = tz_name.strip() or "America/Los_Angeles"
    try:
        ZoneInfo(cleaned_tz)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid IANA timezone '{cleaned_tz}'.",
        ) from exc

    return cleaned_name, norm_target, norm_days, norm_start, norm_end, cleaned_tz


def build_schedule_response(
    schedule: RecurringSchedule,
    device_names: dict[int, str],
    group_names: dict[int, str],
    now_utc: datetime | None = None,
) -> ScheduleResponse:
    """Serialize a RecurringSchedule ORM instance into a ScheduleResponse."""
    t_type: Literal["device", "group"] = (
        "group" if schedule.target_type == "group" else "device"
    )
    if t_type == "device" and schedule.device_id is not None:
        target_name = device_names.get(schedule.device_id, f"Device #{schedule.device_id}")
    elif t_type == "group" and schedule.group_id is not None:
        target_name = group_names.get(schedule.group_id, f"Group #{schedule.group_id}")
    else:
        target_name = "Unknown Target"

    days_list = parse_days_of_week(schedule.days_of_week)
    active_now = bool(schedule.is_enabled) and is_schedule_window_active(
        days_list,
        schedule.start_time,
        schedule.end_time,
        schedule.timezone,
        now_utc=now_utc,
    )

    created_iso = (
        schedule.created_at.isoformat()
        if schedule.created_at
        else utc_now().isoformat()
    )
    updated_iso = (
        schedule.updated_at.isoformat()
        if schedule.updated_at
        else created_iso
    )

    return ScheduleResponse(
        id=schedule.id,
        name=schedule.name,
        description=schedule.description or "",
        target_type=t_type,
        device_id=schedule.device_id,
        group_id=schedule.group_id,
        target_name=target_name,
        days_of_week=days_list,
        start_time=schedule.start_time,
        end_time=schedule.end_time,
        timezone=schedule.timezone,
        is_enabled=bool(schedule.is_enabled),
        is_active_now=active_now,
        created_at=created_iso,
        updated_at=updated_iso,
    )


def build_active_schedule_maps(
    schedules: list[RecurringSchedule],
    device_names: dict[int, str],
    group_names: dict[int, str],
    group_member_ids: dict[int, list[int]],
    now_utc: datetime | None = None,
) -> tuple[dict[int, ActiveScheduleInfo], dict[int, ActiveScheduleInfo]]:
    """Build (device_id -> ActiveScheduleInfo, group_id -> ActiveScheduleInfo) for active rules."""
    device_map: dict[int, ActiveScheduleInfo] = {}
    group_map: dict[int, ActiveScheduleInfo] = {}

    # 1. Process direct device schedules first (higher display priority than group schedules)
    for sched in schedules:
        if not sched.is_enabled or sched.target_type != "device" or sched.device_id is None:
            continue
        if is_schedule_window_active(
            sched.days_of_week,
            sched.start_time,
            sched.end_time,
            sched.timezone,
            now_utc=now_utc,
        ):
            if sched.device_id not in device_map:
                device_map[sched.device_id] = ActiveScheduleInfo(
                    schedule_id=sched.id,
                    name=sched.name,
                    target_type="device",
                    target_id=sched.device_id,
                    target_name=device_names.get(
                        sched.device_id, f"Device #{sched.device_id}"
                    ),
                    start_time=sched.start_time,
                    end_time=sched.end_time,
                    timezone=sched.timezone,
                )

    # 2. Process group schedules and propagate to member devices not already covered
    for sched in schedules:
        if not sched.is_enabled or sched.target_type != "group" or sched.group_id is None:
            continue
        if is_schedule_window_active(
            sched.days_of_week,
            sched.start_time,
            sched.end_time,
            sched.timezone,
            now_utc=now_utc,
        ):
            info = ActiveScheduleInfo(
                schedule_id=sched.id,
                name=sched.name,
                target_type="group",
                target_id=sched.group_id,
                target_name=group_names.get(sched.group_id, f"Group #{sched.group_id}"),
                start_time=sched.start_time,
                end_time=sched.end_time,
                timezone=sched.timezone,
            )
            if sched.group_id not in group_map:
                group_map[sched.group_id] = info
            for dev_id in group_member_ids.get(sched.group_id, []):
                if dev_id not in device_map:
                    device_map[dev_id] = info

    return device_map, group_map


def evaluate_device_effective_policy(
    device: Device,
    protected_ips: frozenset[str],
    active_override: ActiveOverrideInfo | None,
    active_schedule: ActiveScheduleInfo | None,
) -> PolicyDecision:
    """Evaluate the deterministic 5-Tier Policy Precedence Order for a device:

    1. Protected Device / Protected IP -> Always Allowed
    2. Active Temporary Override ('bonus' -> Allowed; 'pause' -> Blocked)
    3. Manual Permanent Block (device.is_manually_blocked) -> Blocked
    4. Active Recurring Schedule Window -> Blocked
    5. Default Policy -> Allowed
    """
    if bool(device.is_protected) or (
        device.ipv4_address and device.ipv4_address in protected_ips
    ):
        return PolicyDecision(
            device_id=device.id,
            should_be_blocked=False,
            reason="protected",
            active_schedule=active_schedule,
        )

    if active_override is not None and active_override.is_active:
        if active_override.mode == "bonus":
            return PolicyDecision(
                device_id=device.id,
                should_be_blocked=False,
                reason="bonus_timer",
                active_schedule=active_schedule,
            )
        return PolicyDecision(
            device_id=device.id,
            should_be_blocked=True,
            reason="pause_timer",
            active_schedule=active_schedule,
        )

    if bool(getattr(device, "is_manually_blocked", False)):
        return PolicyDecision(
            device_id=device.id,
            should_be_blocked=True,
            reason="manual_block",
            active_schedule=active_schedule,
        )

    if active_schedule is not None:
        return PolicyDecision(
            device_id=device.id,
            should_be_blocked=True,
            reason="schedule_block",
            active_schedule=active_schedule,
        )

    return PolicyDecision(
        device_id=device.id,
        should_be_blocked=False,
        reason="default_allowed",
        active_schedule=None,
    )


def plan_policy_and_ip_drift_actions(
    devices: list[Device],
    decisions: dict[int, PolicyDecision],
    current_alias_ips: set[str],
    protected_ips: frozenset[str],
) -> tuple[list[tuple[Device, PolicyDecision]], list[tuple[Device, PolicyDecision]], list[str]]:
    """Compute (devices_to_block, devices_to_unblock, orphan_or_drift_ips_to_remove)."""
    to_block: list[tuple[Device, PolicyDecision]] = []
    to_unblock: list[tuple[Device, PolicyDecision]] = []
    expected_blocked_ips: set[str] = set()

    for dev in devices:
        decision = decisions.get(dev.id)
        if decision is None:
            continue
        ip = dev.ipv4_address
        if decision.should_be_blocked:
            if ip and ip not in protected_ips:
                expected_blocked_ips.add(ip)
                if not dev.is_blocked or ip not in current_alias_ips:
                    to_block.append((dev, decision))
        else:
            if dev.is_blocked or (ip and ip in current_alias_ips):
                to_unblock.append((dev, decision))

    # Any IP present in OPNsense alias that is no longer the current IP of a blocked device
    # (e.g., DHCP IP drift when a blocked MAC got a new IP, or a protected IP)
    unblock_device_ips = {
        dev.ipv4_address for dev, _ in to_unblock if dev.ipv4_address is not None
    }
    drift_ips = sorted(
        ip
        for ip in current_alias_ips
        if ip not in expected_blocked_ips and ip not in unblock_device_ips
    )

    return to_block, to_unblock, drift_ips


async def _load_schedule_context(
    db: AsyncSession,
) -> tuple[list[RecurringSchedule], dict[int, str], dict[int, str], dict[int, list[int]]]:
    """Load schedules, device names, group names, and group memberships from SQLite."""
    sched_res = await db.execute(
        select(RecurringSchedule).order_by(RecurringSchedule.id.asc())
    )
    schedules = list(sched_res.scalars().all())

    dev_res = await db.execute(select(Device))
    device_names = {
        d.id: (d.display_name or d.hostname or d.ipv4_address or d.mac_address)
        for d in dev_res.scalars().all()
    }

    grp_res = await db.execute(select(DeviceGroup))
    group_names = {g.id: g.name for g in grp_res.scalars().all()}

    mem_res = await db.execute(select(DeviceGroupMembership))
    group_member_ids: dict[int, list[int]] = {}
    for m in mem_res.scalars().all():
        group_member_ids.setdefault(m.group_id, []).append(m.device_id)

    return schedules, device_names, group_names, group_member_ids


async def get_active_schedule_maps(
    db: AsyncSession,
    now_utc: datetime | None = None,
) -> tuple[dict[int, ActiveScheduleInfo], dict[int, ActiveScheduleInfo]]:
    """Return active (device_id -> ActiveScheduleInfo, group_id -> ActiveScheduleInfo) maps."""
    schedules, device_names, group_names, group_member_ids = await _load_schedule_context(db)
    return build_active_schedule_maps(
        schedules,
        device_names,
        group_names,
        group_member_ids,
        now_utc=now_utc,
    )


async def list_schedules(
    db: AsyncSession,
    now_utc: datetime | None = None,
) -> ScheduleListResponse:
    """List all recurring schedules with live active-window evaluation."""
    schedules, device_names, group_names, _ = await _load_schedule_context(db)
    return ScheduleListResponse(
        schedules=[
            build_schedule_response(s, device_names, group_names, now_utc=now_utc)
            for s in schedules
        ]
    )


async def create_schedule(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    payload: ScheduleCreateRequest,
    actor_ip: str = "unknown",
) -> ScheduleResponse:
    """Create a recurring schedule and immediately reconcile device policies."""
    tz_str = payload.timezone or settings.tz
    name, target_type, days_list, start_t, end_t, clean_tz = validate_schedule_payload(
        payload.name,
        payload.target_type,
        payload.device_id,
        payload.group_id,
        payload.days_of_week,
        payload.start_time,
        payload.end_time,
        tz_str,
    )

    if target_type == "device":
        dev = await db.get(Device, payload.device_id)
        if dev is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device #{payload.device_id} not found.",
            )
    else:
        grp = await db.get(DeviceGroup, payload.group_id)
        if grp is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device group #{payload.group_id} not found.",
            )

    new_sched = RecurringSchedule(
        name=name,
        description=payload.description.strip(),
        target_type=target_type,
        device_id=payload.device_id if target_type == "device" else None,
        group_id=payload.group_id if target_type == "group" else None,
        days_of_week=format_days_of_week(days_list),
        start_time=start_t,
        end_time=end_t,
        timezone=clean_tz,
        is_enabled=payload.is_enabled,
    )
    db.add(new_sched)
    db.add(
        AuditLog(
            actor=f"admin ({actor_ip})",
            action="schedule_create",
            target=f"{target_type}:{payload.device_id or payload.group_id}",
            status="success",
            details=f"Created schedule '{name}' ({start_t}-{end_t} {clean_tz}).",
        )
    )
    await db.commit()
    await db.refresh(new_sched)

    await reconcile_schedules_and_policies(db, opnsense, settings)

    _, device_names, group_names, _ = await _load_schedule_context(db)
    return build_schedule_response(new_sched, device_names, group_names)


async def update_schedule(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    schedule_id: int,
    payload: ScheduleUpdateRequest,
    actor_ip: str = "unknown",
) -> ScheduleResponse:
    """Update an existing recurring schedule and immediately reconcile device policies."""
    sched = await db.get(RecurringSchedule, schedule_id)
    if sched is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found.",
        )

    tz_str = payload.timezone or sched.timezone or settings.tz
    eff_name = payload.name if payload.name is not None else sched.name
    eff_desc = payload.description if payload.description is not None else sched.description
    eff_target_type = payload.target_type or sched.target_type
    eff_device_id = (
        payload.device_id
        if payload.target_type is not None or payload.device_id is not None
        else sched.device_id
    )
    eff_group_id = (
        payload.group_id
        if payload.target_type is not None or payload.group_id is not None
        else sched.group_id
    )
    eff_days = (
        payload.days_of_week
        if payload.days_of_week is not None
        else parse_days_of_week(sched.days_of_week)
    )
    eff_start = payload.start_time if payload.start_time is not None else sched.start_time
    eff_end = payload.end_time if payload.end_time is not None else sched.end_time
    eff_enabled = payload.is_enabled if payload.is_enabled is not None else sched.is_enabled

    name, target_type, days_list, start_t, end_t, clean_tz = validate_schedule_payload(
        eff_name,
        eff_target_type,
        eff_device_id,
        eff_group_id,
        eff_days,
        eff_start,
        eff_end,
        tz_str,
    )

    if target_type == "device":
        dev = await db.get(Device, eff_device_id)
        if dev is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device #{eff_device_id} not found.",
            )
    else:
        grp = await db.get(DeviceGroup, eff_group_id)
        if grp is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Device group #{eff_group_id} not found.",
            )

    sched.name = name
    sched.description = eff_desc.strip()
    sched.target_type = target_type
    sched.device_id = eff_device_id if target_type == "device" else None
    sched.group_id = eff_group_id if target_type == "group" else None
    sched.days_of_week = format_days_of_week(days_list)
    sched.start_time = start_t
    sched.end_time = end_t
    sched.timezone = clean_tz
    sched.is_enabled = eff_enabled

    db.add(
        AuditLog(
            actor=f"admin ({actor_ip})",
            action="schedule_update",
            target=f"schedule:{schedule_id}",
            status="success",
            details=f"Updated schedule '{name}' ({start_t}-{end_t} {clean_tz}).",
        )
    )
    await db.commit()
    await db.refresh(sched)

    await reconcile_schedules_and_policies(db, opnsense, settings)

    _, device_names, group_names, _ = await _load_schedule_context(db)
    return build_schedule_response(sched, device_names, group_names)


async def toggle_schedule(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    schedule_id: int,
    is_enabled: bool,
    actor_ip: str = "unknown",
) -> ScheduleResponse:
    """Enable or disable a recurring schedule and immediately reconcile device policies."""
    sched = await db.get(RecurringSchedule, schedule_id)
    if sched is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found.",
        )

    sched.is_enabled = bool(is_enabled)
    db.add(
        AuditLog(
            actor=f"admin ({actor_ip})",
            action="schedule_toggle",
            target=f"schedule:{schedule_id}",
            status="success",
            details=f"{'Enabled' if is_enabled else 'Disabled'} schedule '{sched.name}'.",
        )
    )
    await db.commit()
    await db.refresh(sched)

    await reconcile_schedules_and_policies(db, opnsense, settings)

    _, device_names, group_names, _ = await _load_schedule_context(db)
    return build_schedule_response(sched, device_names, group_names)


async def delete_schedule(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    schedule_id: int,
    actor_ip: str = "unknown",
) -> None:
    """Delete a recurring schedule and immediately reconcile device policies."""
    sched = await db.get(RecurringSchedule, schedule_id)
    if sched is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found.",
        )

    sched_name = sched.name
    await db.delete(sched)
    db.add(
        AuditLog(
            actor=f"admin ({actor_ip})",
            action="schedule_delete",
            target=f"schedule:{schedule_id}",
            status="success",
            details=f"Deleted schedule '{sched_name}'.",
        )
    )
    await db.commit()

    await reconcile_schedules_and_policies(db, opnsense, settings)


async def reconcile_schedules_and_policies(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    now_utc: datetime | None = None,
) -> ScheduleReconciliationSummary:
    """Evaluate all devices against the 5-Tier Policy Precedence Engine & sync OPNsense."""
    summary = ScheduleReconciliationSummary()
    ref_utc = now_utc or utc_now()

    dev_res = await db.execute(select(Device).order_by(Device.id.asc()))
    devices = list(dev_res.scalars().all())
    summary.evaluated_device_count = len(devices)
    if not devices:
        return summary

    device_override_map, group_override_map = await load_active_override_maps(
        db, now_utc=ref_utc
    )
    schedules, device_names, group_names, group_member_ids = await _load_schedule_context(
        db
    )
    device_schedule_map, _ = build_active_schedule_maps(
        schedules, device_names, group_names, group_member_ids, now_utc=ref_utc
    )
    # Propagate active group overrides to member devices without a direct device override
    effective_override_map: dict[int, ActiveOverrideInfo] = dict(device_override_map)
    for grp_id, grp_ov in group_override_map.items():
        for member_dev_id in group_member_ids.get(grp_id, []):
            if member_dev_id not in effective_override_map:
                effective_override_map[member_dev_id] = grp_ov

    protected_ips = settings.protected_ip_set

    decisions: dict[int, PolicyDecision] = {}
    for dev in devices:
        decisions[dev.id] = evaluate_device_effective_policy(
            dev,
            protected_ips=protected_ips,
            active_override=effective_override_map.get(dev.id),
            active_schedule=device_schedule_map.get(dev.id),
        )

    try:
        current_alias_ips = set(await opnsense.list_blocked_alias_ips())
    except OPNsenseClientError as exc:
        err_msg = f"Failed to list OPNsense blocked alias IPs during policy reconcile: {exc}"
        logger.warning(err_msg)
        summary.errors.append(err_msg)
        return summary

    to_block, to_unblock, drift_ips = plan_policy_and_ip_drift_actions(
        devices, decisions, current_alias_ips, protected_ips
    )

    # 1. Enforce blocks required by policy
    for dev, decision in to_block:
        dev_ip = dev.ipv4_address
        dev_id = dev.id
        if not dev_ip:
            continue
        try:
            await opnsense.add_ip_to_block_alias(dev_ip)
            try:
                await opnsense.kill_states_for_ip(dev_ip)
            except OPNsenseClientError:
                pass
            dev.is_blocked = True
            summary.newly_blocked_ips.append(dev_ip)
            db.add(
                AuditLog(
                    actor="schedule",
                    action=f"policy_enforce_{decision.reason}",
                    target=f"device:{dev_id} ({dev_ip})",
                    status="success",
                    details=(
                        f"Blocked {dev_ip} via {decision.reason}"
                        + (
                            f" ('{decision.active_schedule.name}')"
                            if decision.active_schedule
                            else ""
                        )
                    ),
                )
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            err = f"Failed to block device #{dev_id} ({dev_ip}): {exc}"
            logger.warning(err)
            summary.errors.append(err)

    # 2. Enforce unblocks required by policy (e.g. schedule window ended or bonus timer active)
    for dev, decision in to_unblock:
        dev_ip = dev.ipv4_address
        dev_id = dev.id
        try:
            if dev_ip and dev_ip in current_alias_ips:
                await opnsense.remove_ip_from_block_alias(dev_ip)
            dev.is_blocked = False
            if dev_ip:
                summary.newly_unblocked_ips.append(dev_ip)
            db.add(
                AuditLog(
                    actor="schedule",
                    action=f"policy_unblock_{decision.reason}",
                    target=f"device:{dev_id} ({dev_ip or 'no-ip'})",
                    status="success",
                    details=f"Restored internet access ({decision.reason}).",
                )
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            err = f"Failed to unblock device #{dev_id} ({dev_ip}): {exc}"
            logger.warning(err)
            summary.errors.append(err)

    # 3. Clean up stale DHCP IP drift entries from OPNsense alias
    for stale_ip in drift_ips:
        try:
            await opnsense.remove_ip_from_block_alias(stale_ip)
            summary.ip_drift_swaps.append(stale_ip)
            db.add(
                AuditLog(
                    actor="system_reconcile",
                    action="dhcp_ip_drift_cleanup",
                    target=stale_ip,
                    status="success",
                    details=f"Removed stale/drifted IP {stale_ip} from OPNsense block alias.",
                )
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            err = f"Failed to remove drifted IP {stale_ip}: {exc}"
            logger.warning(err)
            summary.errors.append(err)

    summary.blocked_count = len(summary.newly_blocked_ips)
    summary.unblocked_count = len(summary.newly_unblocked_ips)
    summary.ip_drift_healed_count = len(summary.ip_drift_swaps)
    summary.warnings = list(summary.errors)
    return summary
