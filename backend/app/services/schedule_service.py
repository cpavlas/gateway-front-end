"""Recurring weekly schedules, 5-tier policy evaluator, and DHCP IP drift reconciliation."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.opnsense import OPNsenseClient, OPNsenseClientError
from app.config import Settings

if TYPE_CHECKING:
    from app.clients.elasticsearch import ElasticsearchServiceClient
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

ScheduleBlockMode = Literal["internet", "youtube"]

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
    block_mode: ScheduleBlockMode = "internet"
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
    block_mode: ScheduleBlockMode = "internet"
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
    block_mode: ScheduleBlockMode | None = None
    days_of_week: list[int] | None = Field(default=None, min_length=1, max_length=7)
    start_time: str | None = Field(default=None, description="24-hour HH:MM start time")
    end_time: str | None = Field(default=None, description="24-hour HH:MM end time")
    timezone: str | None = None
    is_enabled: bool | None = None


class ScheduleToggleRequest(BaseModel):
    """Request payload for enabling or disabling a recurring schedule."""

    is_enabled: bool


class ScheduleSnoozeRequest(BaseModel):
    """Request payload for snoozing or clearing snooze on a recurring schedule (`FB-P17-005`)."""

    duration_minutes: int | None = Field(default=60, ge=1, le=1440)
    until_end_of_window: bool = False
    clear: bool = False


class ScheduleResponse(BaseModel):
    """Serialized recurring schedule with live active-window evaluation."""

    id: int
    name: str
    description: str
    target_type: Literal["device", "group"]
    device_id: int | None
    group_id: int | None
    target_name: str
    block_mode: ScheduleBlockMode = "internet"
    days_of_week: list[int]
    start_time: str
    end_time: str
    timezone: str
    is_enabled: bool
    is_active_now: bool
    is_snoozed: bool = False
    snoozed_until: str | None = None
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


def normalize_schedule_block_mode(raw_mode: str | None) -> ScheduleBlockMode:
    """Normalize recurring schedule enforcement mode ('internet' vs 'youtube')."""
    if isinstance(raw_mode, str) and raw_mode.strip().lower() == "youtube":
        return "youtube"
    return "internet"


def is_schedule_snoozed(
    snoozed_until: datetime | None,
    now_utc: datetime | None = None,
) -> bool:
    """Return True if a recurring schedule currently has an active future snooze timestamp."""
    if snoozed_until is None:
        return False
    ref_utc = now_utc or utc_now()
    if ref_utc.tzinfo is None:
        ref_utc = ref_utc.replace(tzinfo=UTC)
    target_utc = (
        snoozed_until.replace(tzinfo=UTC)
        if snoozed_until.tzinfo is None
        else snoozed_until.astimezone(UTC)
    )
    return target_utc > ref_utc


def compute_snooze_until(
    end_time: str,
    tz_name: str = "America/Los_Angeles",
    duration_minutes: int | None = 60,
    until_end_of_window: bool = False,
    now_utc: datetime | None = None,
) -> datetime:
    """Compute UTC expiration timestamp for a recurring schedule snooze request."""
    ref_utc = now_utc or utc_now()
    if ref_utc.tzinfo is None:
        ref_utc = ref_utc.replace(tzinfo=UTC)

    if until_end_of_window:
        try:
            tz = ZoneInfo(tz_name or "America/Los_Angeles")
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("UTC")
        end_minutes = _parse_hhmm_minutes(end_time)
        local_dt = ref_utc.astimezone(tz)
        candidate_local = local_dt.replace(
            hour=end_minutes // 60,
            minute=end_minutes % 60,
            second=0,
            microsecond=0,
        )
        if candidate_local <= local_dt:
            candidate_local += timedelta(days=1)
        candidate_utc = candidate_local.astimezone(UTC)
        if candidate_utc > ref_utc:
            return candidate_utc

    safe_minutes = max(1, min(int(duration_minutes or 60), 1440))
    return ref_utc + timedelta(minutes=safe_minutes)


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
    snoozed_raw = getattr(schedule, "snoozed_until", None)
    snoozed = is_schedule_snoozed(snoozed_raw, now_utc=now_utc)
    snoozed_iso: str | None = None
    if snoozed and snoozed_raw is not None:
        snoozed_dt = (
            snoozed_raw.replace(tzinfo=UTC)
            if snoozed_raw.tzinfo is None
            else snoozed_raw.astimezone(UTC)
        )
        snoozed_iso = snoozed_dt.isoformat()

    raw_active = bool(schedule.is_enabled) and is_schedule_window_active(
        days_list,
        schedule.start_time,
        schedule.end_time,
        schedule.timezone,
        now_utc=now_utc,
    )
    active_now = raw_active and not snoozed
    mode = normalize_schedule_block_mode(getattr(schedule, "block_mode", "internet"))

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
        block_mode=mode,
        days_of_week=days_list,
        start_time=schedule.start_time,
        end_time=schedule.end_time,
        timezone=schedule.timezone,
        is_enabled=bool(schedule.is_enabled),
        is_active_now=active_now,
        is_snoozed=snoozed,
        snoozed_until=snoozed_iso,
        created_at=created_iso,
        updated_at=updated_iso,
    )


def build_active_schedule_maps(
    schedules: list[RecurringSchedule],
    device_names: dict[int, str],
    group_names: dict[int, str],
    group_member_ids: dict[int, list[int]],
    now_utc: datetime | None = None,
    *,
    mode_filter: ScheduleBlockMode | None = None,
) -> tuple[dict[int, ActiveScheduleInfo], dict[int, ActiveScheduleInfo]]:
    """Build (device_id -> ActiveScheduleInfo, group_id -> ActiveScheduleInfo) for active rules.

    When `mode_filter` is omitted, internet-mode schedules take precedence over youtube-mode
    schedules per target while still exposing both for badge display.
    """
    device_map: dict[int, ActiveScheduleInfo] = {}
    group_map: dict[int, ActiveScheduleInfo] = {}

    ordered_schedules = sorted(
        schedules,
        key=lambda s: 0
        if normalize_schedule_block_mode(getattr(s, "block_mode", "internet")) == "internet"
        else 1,
    )

    # 1. Process direct device schedules first (higher display priority than group schedules)
    for sched in ordered_schedules:
        if not sched.is_enabled or sched.target_type != "device" or sched.device_id is None:
            continue
        if is_schedule_snoozed(getattr(sched, "snoozed_until", None), now_utc=now_utc):
            continue
        sched_mode = normalize_schedule_block_mode(getattr(sched, "block_mode", "internet"))
        if mode_filter is not None and sched_mode != mode_filter:
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
                    block_mode=sched_mode,
                    start_time=sched.start_time,
                    end_time=sched.end_time,
                    timezone=sched.timezone,
                )

    # 2. Process group schedules and propagate to member devices not already covered
    for sched in ordered_schedules:
        if not sched.is_enabled or sched.target_type != "group" or sched.group_id is None:
            continue
        if is_schedule_snoozed(getattr(sched, "snoozed_until", None), now_utc=now_utc):
            continue
        sched_mode = normalize_schedule_block_mode(getattr(sched, "block_mode", "internet"))
        if mode_filter is not None and sched_mode != mode_filter:
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
                block_mode=sched_mode,
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

    if active_schedule is not None and active_schedule.block_mode == "internet":
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

    sched_mode = normalize_schedule_block_mode(payload.block_mode)
    new_sched = RecurringSchedule(
        name=name,
        description=payload.description.strip(),
        target_type=target_type,
        device_id=payload.device_id if target_type == "device" else None,
        group_id=payload.group_id if target_type == "group" else None,
        block_mode=sched_mode,
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
            details=f"Created {sched_mode} schedule '{name}' ({start_t}-{end_t} {clean_tz}).",
        )
    )
    await db.commit()
    await db.refresh(new_sched)

    await reconcile_schedules_and_policies(db, opnsense, settings)

    _, device_names, group_names, _ = await _load_schedule_context(db)
    return build_schedule_response(new_sched, device_names, group_names)


async def _collect_schedule_target_device_ids(
    db: AsyncSession,
    sched: RecurringSchedule,
) -> set[int]:
    """Resolve all device IDs currently covered by a schedule target (device or group)."""
    if sched.target_type == "device" and sched.device_id is not None:
        return {sched.device_id}
    if sched.target_type == "group" and sched.group_id is not None:
        mem_rows = (
            await db.execute(
                select(DeviceGroupMembership.device_id).where(
                    DeviceGroupMembership.group_id == sched.group_id
                )
            )
        ).scalars().all()
        return {int(did) for did in mem_rows}
    return set()


def prepare_schedule_update_params(
    sched: RecurringSchedule,
    payload: ScheduleUpdateRequest,
    default_tz: str,
) -> tuple[str, str, int | None, int | None, str, str, list[int], str, str, str, bool]:
    """Synchronously merge & validate updated fields on an existing schedule."""
    prev_mode = normalize_schedule_block_mode(getattr(sched, "block_mode", "internet"))
    tz_str = payload.timezone or sched.timezone or default_tz
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
    eff_block_mode = (
        normalize_schedule_block_mode(payload.block_mode)
        if payload.block_mode is not None
        else prev_mode
    )
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
    return (
        name,
        target_type,
        eff_device_id,
        eff_group_id,
        eff_desc.strip(),
        eff_block_mode,
        days_list,
        start_t,
        end_t,
        clean_tz,
        bool(eff_enabled),
    )


def apply_schedule_update_orm(
    sched: RecurringSchedule,
    schedule_id: int,
    params: tuple[
        str, str, int | None, int | None, str, str, list[int], str, str, str, bool
    ],
    actor_ip: str = "unknown",
) -> AuditLog:
    """Synchronously apply validated update parameters to `RecurringSchedule`."""
    (
        name,
        target_type,
        eff_device_id,
        eff_group_id,
        clean_desc,
        eff_block_mode,
        days_list,
        start_t,
        end_t,
        clean_tz,
        eff_enabled,
    ) = params
    sched.name = name
    sched.description = clean_desc
    sched.target_type = target_type
    sched.device_id = eff_device_id if target_type == "device" else None
    sched.group_id = eff_group_id if target_type == "group" else None
    sched.block_mode = eff_block_mode
    sched.days_of_week = format_days_of_week(days_list)
    sched.start_time = start_t
    sched.end_time = end_t
    sched.timezone = clean_tz
    sched.is_enabled = eff_enabled
    return AuditLog(
        actor=f"admin ({actor_ip})",
        action="schedule_update",
        target=f"schedule:{schedule_id}",
        status="success",
        details=f"Updated {eff_block_mode} schedule '{name}' ({start_t}-{end_t} {clean_tz}).",
    )


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

    prev_mode = normalize_schedule_block_mode(getattr(sched, "block_mode", "internet"))
    prev_target_device_ids = (
        await _collect_schedule_target_device_ids(db, sched)
        if prev_mode == "youtube"
        else set()
    )

    params = prepare_schedule_update_params(sched, payload, settings.tz)
    _, target_type, eff_device_id, eff_group_id, *_ = params

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

    db.add(apply_schedule_update_orm(sched, schedule_id, params, actor_ip=actor_ip))
    await db.commit()
    await db.refresh(sched)

    await reconcile_schedules_and_policies(
        db,
        opnsense,
        settings,
        extra_youtube_unblock_device_ids=prev_target_device_ids,
    )

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

    sched_mode = normalize_schedule_block_mode(getattr(sched, "block_mode", "internet"))
    yt_device_ids = (
        await _collect_schedule_target_device_ids(db, sched)
        if sched_mode == "youtube"
        else set()
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

    await reconcile_schedules_and_policies(
        db,
        opnsense,
        settings,
        extra_youtube_unblock_device_ids=yt_device_ids,
    )


def build_cloned_schedule_row(
    sched: RecurringSchedule,
    actor_ip: str = "unknown",
) -> tuple[RecurringSchedule, AuditLog]:
    """Synchronously construct a cloned `RecurringSchedule` ORM object and audit entry."""
    base_name = sched.name.strip()
    suffix = " (Copy)"
    cloned_name = f"{base_name[: max(1, 128 - len(suffix))]}{suffix}"
    cloned = RecurringSchedule(
        name=cloned_name,
        description=sched.description or "",
        target_type=sched.target_type,
        device_id=sched.device_id,
        group_id=sched.group_id,
        block_mode=normalize_schedule_block_mode(getattr(sched, "block_mode", "internet")),
        days_of_week=sched.days_of_week,
        start_time=sched.start_time,
        end_time=sched.end_time,
        timezone=sched.timezone,
        is_enabled=bool(sched.is_enabled),
        snoozed_until=None,
    )
    audit = AuditLog(
        actor=f"admin ({actor_ip})",
        action="schedule_clone",
        target=f"schedule:{sched.id}",
        status="success",
        details=f"Cloned schedule '{sched.name}' -> '{cloned_name}'.",
    )
    return cloned, audit


def apply_schedule_snooze_mutation(
    sched: RecurringSchedule,
    payload: ScheduleSnoozeRequest,
    actor_ip: str = "unknown",
    now_utc: datetime | None = None,
) -> AuditLog:
    """Synchronously apply snooze/clear mutation on a `RecurringSchedule` row."""
    if payload.clear:
        sched.snoozed_until = None
        action_detail = f"Cleared snooze on schedule '{sched.name}'."
    else:
        until_utc = compute_snooze_until(
            sched.end_time,
            tz_name=sched.timezone,
            duration_minutes=payload.duration_minutes,
            until_end_of_window=payload.until_end_of_window,
            now_utc=now_utc,
        )
        sched.snoozed_until = until_utc
        action_detail = f"Snoozed schedule '{sched.name}' until {until_utc.isoformat()}."

    return AuditLog(
        actor=f"admin ({actor_ip})",
        action="schedule_snooze",
        target=f"schedule:{sched.id}",
        status="success",
        details=action_detail,
    )


def collect_quota_exceeded_youtube_targets(
    groups: list[DeviceGroup],
    group_member_ids: dict[int, list[int]],
    group_today_youtube_minutes: dict[int, int],
    tz_name: str = "America/Los_Angeles",
) -> tuple[dict[int, ActiveScheduleInfo], set[int]]:
    """Compute per-device YouTube blocks triggered by group daily YouTube quotas (`FB-P17-006`).

    Returns `(quota_block_map, all_quota_managed_device_ids)` so exceeded groups trigger a
    YouTube block AND daily rollover / cleared limits restore access automatically.
    """
    quota_block_map: dict[int, ActiveScheduleInfo] = {}
    all_quota_managed_device_ids: set[int] = set()
    for grp in groups:
        limit_mins = getattr(grp, "daily_youtube_limit_minutes", None)
        if limit_mins is None or limit_mins <= 0:
            continue
        members = group_member_ids.get(grp.id, [])
        all_quota_managed_device_ids.update(members)
        used_mins = max(0, int(group_today_youtube_minutes.get(grp.id, 0) or 0))
        if used_mins >= limit_mins:
            info = ActiveScheduleInfo(
                schedule_id=0,
                name=f"Daily YouTube Quota ({grp.name}: {used_mins}m/{limit_mins}m)",
                target_type="group",
                target_id=grp.id,
                target_name=grp.name,
                block_mode="youtube",
                start_time="00:00",
                end_time="23:59",
                timezone=tz_name or "America/Los_Angeles",
            )
            for dev_id in members:
                if dev_id not in quota_block_map:
                    quota_block_map[dev_id] = info
    return quota_block_map, all_quota_managed_device_ids


def plan_youtube_schedule_actions(
    devices: list[Device],
    schedules: list[RecurringSchedule],
    youtube_schedule_map: dict[int, ActiveScheduleInfo],
    effective_override_map: dict[int, ActiveOverrideInfo],
    group_member_ids: dict[int, list[int]],
    current_yt_alias_ips: set[str],
    protected_ips: frozenset[str],
    extra_youtube_unblock_device_ids: set[int] | None = None,
    *,
    youtube_quota_map: dict[int, ActiveScheduleInfo] | None = None,
    quota_managed_device_ids: set[int] | None = None,
) -> tuple[list[tuple[Device, ActiveScheduleInfo]], list[Device]]:
    """Compute (devices_to_block_youtube, devices_to_unblock_youtube) for YouTube policies.

    Precedence:
    1. Protected device/IP -> never YouTube-blocked
    2. Active Reward/Bonus Timer (`mode == 'bonus'`) -> overrides schedules & daily YT quotas
    3. Active YouTube Schedule OR Group Daily YouTube Quota reached -> YouTube-blocked
    4. Otherwise -> restore YouTube if device belongs to a managed schedule or quota group
    """
    all_yt_target_ids: set[int] = set(extra_youtube_unblock_device_ids or set())
    if quota_managed_device_ids:
        all_yt_target_ids.update(quota_managed_device_ids)
    for sched in schedules:
        if normalize_schedule_block_mode(getattr(sched, "block_mode", "internet")) != "youtube":
            continue
        if sched.target_type == "device" and sched.device_id is not None:
            all_yt_target_ids.add(sched.device_id)
        elif sched.target_type == "group" and sched.group_id is not None:
            all_yt_target_ids.update(group_member_ids.get(sched.group_id, []))

    to_yt_block: list[tuple[Device, ActiveScheduleInfo]] = []
    to_yt_unblock: list[Device] = []
    quota_map = youtube_quota_map or {}

    for dev in devices:
        dev_ip = dev.ipv4_address
        is_prot = bool(dev.is_protected) or (bool(dev_ip) and dev_ip in protected_ips)
        active_ov = effective_override_map.get(dev.id)
        has_bonus = (
            active_ov is not None and active_ov.is_active and active_ov.mode == "bonus"
        )
        yt_policy = youtube_schedule_map.get(dev.id) or quota_map.get(dev.id)

        if yt_policy is not None and not is_prot and not has_bonus:
            if dev_ip and (not dev.is_youtube_blocked or dev_ip not in current_yt_alias_ips):
                to_yt_block.append((dev, yt_policy))
        elif dev.id in all_yt_target_ids:
            if (dev_ip and dev_ip in current_yt_alias_ips) or dev.is_youtube_blocked:
                to_yt_unblock.append(dev)

    return to_yt_block, to_yt_unblock


async def clone_schedule(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    schedule_id: int,
    actor_ip: str = "unknown",
) -> ScheduleResponse:
    """Duplicate an existing recurring schedule with '(Copy)' suffix (`FB-P17-004`)."""
    sched = await db.get(RecurringSchedule, schedule_id)
    if sched is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found.",
        )

    cloned, audit = build_cloned_schedule_row(sched, actor_ip=actor_ip)
    db.add(cloned)
    db.add(audit)
    await db.commit()
    await db.refresh(cloned)

    await reconcile_schedules_and_policies(db, opnsense, settings)

    _, device_names, group_names, _ = await _load_schedule_context(db)
    return build_schedule_response(cloned, device_names, group_names)


async def snooze_schedule(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    schedule_id: int,
    payload: ScheduleSnoozeRequest,
    actor_ip: str = "unknown",
) -> ScheduleResponse:
    """Snooze an active schedule temporarily or clear an active snooze (`FB-P17-005`)."""
    sched = await db.get(RecurringSchedule, schedule_id)
    if sched is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Schedule #{schedule_id} not found.",
        )

    audit = apply_schedule_snooze_mutation(sched, payload, actor_ip=actor_ip)
    db.add(audit)
    await db.commit()
    await db.refresh(sched)

    await reconcile_schedules_and_policies(db, opnsense, settings)

    _, device_names, group_names, _ = await _load_schedule_context(db)
    return build_schedule_response(sched, device_names, group_names)


async def reconcile_schedules_and_policies(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    now_utc: datetime | None = None,
    *,
    extra_youtube_unblock_device_ids: set[int] | None = None,
    es_client: ElasticsearchServiceClient | None = None,
    group_today_youtube_minutes: dict[int, int] | None = None,
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
    internet_schedule_map, _ = build_active_schedule_maps(
        schedules,
        device_names,
        group_names,
        group_member_ids,
        now_utc=ref_utc,
        mode_filter="internet",
    )
    youtube_schedule_map, _ = build_active_schedule_maps(
        schedules,
        device_names,
        group_names,
        group_member_ids,
        now_utc=ref_utc,
        mode_filter="youtube",
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
            active_schedule=internet_schedule_map.get(dev.id),
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

    # 4. Enforce YouTube-only schedules and group daily YouTube quotas
    all_groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    all_memberships = list(
        (await db.execute(select(DeviceGroupMembership))).scalars().all()
    )
    has_quota_groups = any(
        getattr(g, "daily_youtube_limit_minutes", None) is not None for g in all_groups
    )
    resolved_yt_minutes: dict[int, int] = dict(group_today_youtube_minutes or {})
    if has_quota_groups and group_today_youtube_minutes is None:
        from app.services.group_service import resolve_group_today_youtube_minutes

        resolved_yt_minutes = await resolve_group_today_youtube_minutes(
            settings,
            all_groups,
            all_memberships,
            devices,
            es_client=es_client,
        )
    youtube_quota_map, quota_managed_device_ids = collect_quota_exceeded_youtube_targets(
        all_groups,
        group_member_ids,
        resolved_yt_minutes,
        tz_name=settings.tz,
    )

    has_youtube_rules = (
        bool(
            youtube_schedule_map
            or youtube_quota_map
            or quota_managed_device_ids
            or extra_youtube_unblock_device_ids
        )
        or any(
            normalize_schedule_block_mode(getattr(s, "block_mode", "internet"))
            == "youtube"
            for s in schedules
        )
    )
    if has_youtube_rules:
        try:
            current_yt_alias_ips = set(await opnsense.list_youtube_blocked_ips())
        except (OPNsenseClientError, httpx.HTTPError) as exc:
            err_msg = (
                f"Failed to list OPNsense YouTube blocked alias IPs during policy reconcile: {exc}"
            )
            logger.warning(err_msg)
            summary.errors.append(err_msg)
            current_yt_alias_ips = None

        if current_yt_alias_ips is not None:
            to_yt_block, to_yt_unblock = plan_youtube_schedule_actions(
                devices,
                schedules,
                youtube_schedule_map,
                effective_override_map,
                group_member_ids,
                current_yt_alias_ips,
                protected_ips,
                extra_youtube_unblock_device_ids=extra_youtube_unblock_device_ids,
                youtube_quota_map=youtube_quota_map,
                quota_managed_device_ids=quota_managed_device_ids,
            )
            for dev, yt_sched in to_yt_block:
                dev_ip = dev.ipv4_address
                dev_id = dev.id
                if not dev_ip:
                    continue
                try:
                    await opnsense.add_ip_to_youtube_block_alias(dev_ip)
                    dev.is_youtube_blocked = True
                    db.add(
                        AuditLog(
                            actor="schedule",
                            action="policy_enforce_youtube_schedule",
                            target=f"device:{dev_id} ({dev_ip})",
                            status="success",
                            details=(
                                f"Blocked YouTube on {dev_ip} via schedule '{yt_sched.name}'."
                            ),
                        )
                    )
                    await db.commit()
                except Exception as exc:
                    await db.rollback()
                    err = f"Failed to block YouTube for device #{dev_id} ({dev_ip}): {exc}"
                    logger.warning(err)
                    summary.errors.append(err)

            for dev in to_yt_unblock:
                dev_ip = dev.ipv4_address
                dev_id = dev.id
                try:
                    if dev_ip and dev_ip in current_yt_alias_ips:
                        await opnsense.remove_ip_from_youtube_block_alias(dev_ip)
                    dev.is_youtube_blocked = False
                    db.add(
                        AuditLog(
                            actor="schedule",
                            action="policy_unblock_youtube_schedule",
                            target=f"device:{dev_id} ({dev_ip or 'no-ip'})",
                            status="success",
                            details=(
                                "Restored YouTube access after schedule window / snooze / bonus."
                            ),
                        )
                    )
                    await db.commit()
                except Exception as exc:
                    await db.rollback()
                    err = f"Failed to unblock YouTube for device #{dev_id} ({dev_ip}): {exc}"
                    logger.warning(err)
                    summary.errors.append(err)

    summary.blocked_count = len(summary.newly_blocked_ips)
    summary.unblocked_count = len(summary.newly_unblocked_ips)
    summary.ip_drift_healed_count = len(summary.ip_drift_swaps)
    summary.warnings = list(summary.errors)
    return summary
