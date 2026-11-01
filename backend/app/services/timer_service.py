"""Timed temporary internet access overrides ('pause' & 'bonus' timers) service (Phase 5)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.opnsense import OPNsenseClient
from app.config import Settings
from app.models import (
    AuditLog,
    Device,
    DeviceGroup,
    TemporaryOverride,
    normalize_override_mode,
    utc_now,
)

OverrideModeLiteral = Literal["pause", "bonus"]
OverrideTargetLiteral = Literal["device", "group"]

PRESET_MINUTES_MAP: dict[str, int] = {
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 120,
    "4h": 240,
}
MIN_OVERRIDE_MINUTES = 1
MAX_OVERRIDE_MINUTES = 1440


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------


class ActiveOverrideInfo(BaseModel):
    """Serialized representation of an active temporary override timer."""

    id: int
    target_type: OverrideTargetLiteral
    device_id: int | None = None
    group_id: int | None = None
    target_name: str = ""
    mode: OverrideModeLiteral
    duration_minutes: int
    created_by: str
    reason: str = ""
    is_active: bool
    created_at: str
    expires_at: str
    remaining_seconds: int


class TimerStartRequest(BaseModel):
    """Request payload for starting a temporary pause or bonus access timer."""

    mode: OverrideModeLiteral
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    preset: str | None = Field(default=None, max_length=32)
    reason: str = Field(default="", max_length=255)


class TimerListResponse(BaseModel):
    """Response payload for GET /api/v1/timers."""

    timers: list[ActiveOverrideInfo]


class TimerCancelResponse(BaseModel):
    """Response payload for DELETE /api/v1/timers/{override_id}."""

    cancelled_override_id: int
    target_type: OverrideTargetLiteral
    device_id: int | None = None
    group_id: int | None = None
    mode: OverrideModeLiteral
    reverted_state: bool
    warnings: list[str] = Field(default_factory=list)


class OverrideReconciliationSummary(BaseModel):
    """Summary of expired overrides processed by the reconciliation job."""

    checked_active_count: int = 0
    expired_processed_count: int = 0
    unblocked_targets: list[str] = Field(default_factory=list)
    reblocked_targets: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Pure Synchronous Helper Functions (100% deterministic & sys.monitoring friendly)
# ---------------------------------------------------------------------------


def ensure_utc(dt: datetime) -> datetime:
    """Ensure a datetime instance is timezone-aware in UTC (handles SQLite naive timestamps)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def resolve_timezone(tz_name: str | None) -> ZoneInfo:
    """Resolve an IANA timezone name or fall back to UTC."""
    if not tz_name or not tz_name.strip():
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(tz_name.strip())
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        return ZoneInfo("UTC")


def calculate_override_expiry(
    now_utc: datetime,
    *,
    duration_minutes: int | None = None,
    preset: str | None = None,
    tz_name: str = "UTC",
) -> tuple[datetime, int]:
    """Calculate `(expires_at_utc, duration_minutes)` from a preset or explicit minutes."""
    now_aware = ensure_utc(now_utc)
    cleaned_preset = (preset or "").strip().lower()

    if cleaned_preset in ("until_tomorrow_0700", "until_morning", "tomorrow_0700"):
        tz = resolve_timezone(tz_name)
        local_now = now_aware.astimezone(tz)
        candidate_local = local_now.replace(hour=7, minute=0, second=0, microsecond=0)
        if candidate_local <= local_now:
            candidate_local = (local_now + timedelta(days=1)).replace(
                hour=7, minute=0, second=0, microsecond=0
            )
        expires_utc = candidate_local.astimezone(UTC)
        computed_minutes = max(
            1, int(round((expires_utc - now_aware).total_seconds() / 60.0))
        )
        return expires_utc, computed_minutes

    if cleaned_preset:
        if cleaned_preset not in PRESET_MINUTES_MAP:
            raise ValueError(
                f"Unsupported timer preset '{preset}'. "
                f"Allowed presets: {sorted([*PRESET_MINUTES_MAP.keys(), 'until_tomorrow_0700'])}"
            )
        minutes = PRESET_MINUTES_MAP[cleaned_preset]
    elif duration_minutes is not None:
        minutes = int(duration_minutes)
    else:
        raise ValueError("Either 'duration_minutes' or 'preset' must be provided.")

    if minutes < MIN_OVERRIDE_MINUTES or minutes > MAX_OVERRIDE_MINUTES:
        raise ValueError(
            f"Override duration must be between {MIN_OVERRIDE_MINUTES} "
            f"and {MAX_OVERRIDE_MINUTES} minutes."
        )

    expires_utc = now_aware + timedelta(minutes=minutes)
    return expires_utc, minutes


def compute_remaining_seconds(
    expires_at: datetime,
    now_utc: datetime | None = None,
) -> int:
    """Compute remaining seconds until `expires_at` (clamped to `>= 0`)."""
    now_aware = ensure_utc(now_utc or utc_now())
    exp_aware = ensure_utc(expires_at)
    delta = int((exp_aware - now_aware).total_seconds())
    return max(0, delta)


def build_override_info(
    override: TemporaryOverride,
    *,
    target_name: str = "",
    now_utc: datetime | None = None,
) -> ActiveOverrideInfo:
    """Convert a `TemporaryOverride` ORM row into an `ActiveOverrideInfo` response model."""
    now_aware = ensure_utc(now_utc or utc_now())
    created_aware = ensure_utc(override.created_at) if override.created_at else now_aware
    expires_aware = ensure_utc(override.expires_at)
    remaining = (
        compute_remaining_seconds(expires_aware, now_aware) if override.is_active else 0
    )
    target_type_lit: OverrideTargetLiteral = (
        "group" if override.target_type == "group" else "device"
    )
    mode_lit: OverrideModeLiteral = (
        "bonus" if override.mode == "bonus" else "pause"
    )
    return ActiveOverrideInfo(
        id=override.id,
        target_type=target_type_lit,
        device_id=override.device_id,
        group_id=override.group_id,
        target_name=target_name,
        mode=mode_lit,
        duration_minutes=override.duration_minutes,
        created_by=override.created_by or "admin",
        reason=override.reason or "",
        is_active=bool(override.is_active and remaining > 0),
        created_at=created_aware.isoformat(),
        expires_at=expires_aware.isoformat(),
        remaining_seconds=remaining,
    )


def build_active_override_maps(
    overrides: list[TemporaryOverride],
    device_names: dict[int, str] | None = None,
    group_names: dict[int, str] | None = None,
    now_utc: datetime | None = None,
) -> tuple[dict[int, ActiveOverrideInfo], dict[int, ActiveOverrideInfo]]:
    """Partition non-expired active overrides into `(by_device_id, by_group_id)` maps."""
    now_aware = ensure_utc(now_utc or utc_now())
    dev_names = device_names or {}
    grp_names = group_names or {}
    by_device: dict[int, ActiveOverrideInfo] = {}
    by_group: dict[int, ActiveOverrideInfo] = {}

    for ov in overrides:
        if not ov.is_active:
            continue
        if compute_remaining_seconds(ov.expires_at, now_aware) <= 0:
            continue
        if ov.target_type == "device" and ov.device_id is not None:
            t_name = dev_names.get(ov.device_id, f"Device #{ov.device_id}")
            by_device[ov.device_id] = build_override_info(
                ov, target_name=t_name, now_utc=now_aware
            )
        elif ov.target_type == "group" and ov.group_id is not None:
            t_name = grp_names.get(ov.group_id, f"Group #{ov.group_id}")
            by_group[ov.group_id] = build_override_info(
                ov, target_name=t_name, now_utc=now_aware
            )

    return by_device, by_group


def _build_override_maps_from_entities(
    active_rows: list[TemporaryOverride],
    devices: list[Device],
    groups: list[DeviceGroup],
    now_utc: datetime | None = None,
) -> tuple[dict[int, ActiveOverrideInfo], dict[int, ActiveOverrideInfo]]:
    """Map ORM Device/DeviceGroup rows into active override dictionaries."""
    dev_names = {
        d.id: (d.display_name or d.hostname or d.ipv4_address or d.mac_address)
        for d in devices
    }
    grp_names = {g.id: g.name for g in groups}
    return build_active_override_maps(active_rows, dev_names, grp_names, now_utc)


def _build_timer_list_response(
    by_device: dict[int, ActiveOverrideInfo],
    by_group: dict[int, ActiveOverrideInfo],
) -> TimerListResponse:
    """Combine and sort active device and group overrides by remaining_seconds."""
    combined = [*by_device.values(), *by_group.values()]
    combined.sort(key=lambda item: item.remaining_seconds)
    return TimerListResponse(timers=combined)


def _create_override_and_audit_objects(
    *,
    target_type: OverrideTargetLiteral,
    device_id: int | None,
    group_id: int | None,
    target_label: str,
    mode: OverrideModeLiteral,
    minutes: int,
    actor: str,
    reason: str,
    now_aware: datetime,
    expires_utc: datetime,
) -> tuple[TemporaryOverride, AuditLog]:
    """Construct `TemporaryOverride` and `AuditLog` ORM objects for a new timer."""
    override = TemporaryOverride(
        target_type=target_type,
        device_id=device_id,
        group_id=group_id,
        mode=mode,
        duration_minutes=minutes,
        created_by=actor,
        reason=reason,
        is_active=True,
        created_at=now_aware,
        expires_at=expires_utc,
    )
    audit = AuditLog(
        actor=actor,
        action=f"timer.{target_type}.{mode}",
        target=target_label,
        status="success",
        details=(
            f"Started {target_type} {mode} timer for {minutes}m until {expires_utc.isoformat()}"
            + (f" ({reason})" if reason else "")
        ),
    )
    return override, audit


def _finalize_cancelled_override(
    override: TemporaryOverride,
    *,
    actor: str,
    reverted: bool,
    warnings: list[str],
    now_aware: datetime,
) -> tuple[AuditLog, TimerCancelResponse]:
    """Update cancelled override fields and build AuditLog + TimerCancelResponse."""
    override.is_active = False
    override.cancelled_at = now_aware
    audit = AuditLog(
        actor=actor,
        action="timer.cancel",
        target=f"{override.target_type}:{override.device_id or override.group_id}",
        status="success",
        details=f"Cancelled {override.mode} override #{override.id} (revert_state={reverted}).",
    )
    target_type_lit: OverrideTargetLiteral = (
        "group" if override.target_type == "group" else "device"
    )
    mode_lit: OverrideModeLiteral = (
        "bonus" if override.mode == "bonus" else "pause"
    )
    resp = TimerCancelResponse(
        cancelled_override_id=override.id,
        target_type=target_type_lit,
        device_id=override.device_id,
        group_id=override.group_id,
        mode=mode_lit,
        reverted_state=reverted,
        warnings=warnings,
    )
    return audit, resp


def select_expired_overrides(
    overrides: list[TemporaryOverride],
    now_utc: datetime | None = None,
) -> list[TemporaryOverride]:
    """Return active overrides whose `expires_at` is at or before `now_utc`."""
    now_aware = ensure_utc(now_utc or utc_now())
    expired: list[TemporaryOverride] = []
    for ov in overrides:
        if ov.is_active and ensure_utc(ov.expires_at) <= now_aware:
            expired.append(ov)
    return expired


def validate_timer_start_payload(
    payload: TimerStartRequest,
    tz_name: str,
    now_utc: datetime | None = None,
) -> tuple[OverrideModeLiteral, datetime, int, str]:
    """Validate TimerStartRequest and return (mode, expires_at_utc, duration_minutes, reason)."""
    now_aware = ensure_utc(now_utc or utc_now())
    try:
        normalized_mode = normalize_override_mode(payload.mode)
        expires_utc, minutes = calculate_override_expiry(
            now_aware,
            duration_minutes=payload.duration_minutes,
            preset=payload.preset,
            tz_name=tz_name,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    mode_lit: OverrideModeLiteral = "bonus" if normalized_mode == "bonus" else "pause"
    return mode_lit, expires_utc, minutes, (payload.reason or "").strip()


def mark_overrides_cancelled(
    overrides: list[TemporaryOverride],
    now_utc: datetime | None = None,
) -> int:
    """Mark a list of active `TemporaryOverride` rows as cancelled in-place."""
    now_aware = ensure_utc(now_utc or utc_now())
    count = 0
    for ov in overrides:
        if ov.is_active:
            ov.is_active = False
            ov.cancelled_at = now_aware
            count += 1
    return count


# ---------------------------------------------------------------------------
# Async Database & OPNsense Orchestration Functions
# ---------------------------------------------------------------------------


async def cancel_active_overrides_for_device(
    db: AsyncSession,
    device_id: int,
    now_utc: datetime | None = None,
) -> int:
    """Cancel any active temporary overrides for `device_id` (used on manual block/unblock)."""
    rows = list(
        (
            await db.execute(
                select(TemporaryOverride).where(
                    TemporaryOverride.target_type == "device",
                    TemporaryOverride.device_id == device_id,
                    TemporaryOverride.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    return mark_overrides_cancelled(rows, now_utc)


async def cancel_active_overrides_for_group(
    db: AsyncSession,
    group_id: int,
    now_utc: datetime | None = None,
) -> int:
    """Cancel any active temporary overrides for `group_id` (used on manual group block/unblock)."""
    rows = list(
        (
            await db.execute(
                select(TemporaryOverride).where(
                    TemporaryOverride.target_type == "group",
                    TemporaryOverride.group_id == group_id,
                    TemporaryOverride.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    return mark_overrides_cancelled(rows, now_utc)


async def load_active_override_maps(
    db: AsyncSession,
    now_utc: datetime | None = None,
) -> tuple[dict[int, ActiveOverrideInfo], dict[int, ActiveOverrideInfo]]:
    """Load all active overrides from SQLite and return `(by_device_id, by_group_id)`."""
    active_rows = list(
        (
            await db.execute(
                select(TemporaryOverride)
                .where(TemporaryOverride.is_active.is_(True))
                .order_by(TemporaryOverride.id.asc())
            )
        )
        .scalars()
        .all()
    )
    if not active_rows:
        return {}, {}

    devices = list((await db.execute(select(Device))).scalars().all())
    groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    return _build_override_maps_from_entities(active_rows, devices, groups, now_utc)


async def list_active_overrides(
    db: AsyncSession,
    now_utc: datetime | None = None,
) -> TimerListResponse:
    """Return all currently active (non-expired) temporary overrides."""
    by_device, by_group = await load_active_override_maps(db, now_utc)
    return _build_timer_list_response(by_device, by_group)


async def start_device_override(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    device_id: int,
    payload: TimerStartRequest,
    *,
    actor: str,
    client_ip: str | None = None,
    now_utc: datetime | None = None,
) -> ActiveOverrideInfo:
    """Start a temporary 'pause' (block) or 'bonus' (unblock) timer on a single device."""
    from app.services.device_service import (
        block_device_internet,
        unblock_device_internet,
    )

    now_aware = ensure_utc(now_utc or utc_now())
    mode, expires_utc, minutes, reason = validate_timer_start_payload(
        payload, settings.tz, now_aware
    )

    if mode == "pause":
        action_res = await block_device_internet(
            db,
            opnsense,
            settings,
            device_id,
            actor=actor,
            client_ip=client_ip,
        )
    else:
        action_res = await unblock_device_internet(
            db,
            opnsense,
            settings,
            device_id,
            actor=actor,
            client_ip=client_ip,
        )

    await cancel_active_overrides_for_device(db, device_id, now_aware)
    target_addr = action_res.device.ipv4_address or action_res.device.mac_address
    override, audit = _create_override_and_audit_objects(
        target_type="device",
        device_id=device_id,
        group_id=None,
        target_label=f"{action_res.device.effective_name} ({target_addr})",
        mode=mode,
        minutes=minutes,
        actor=actor,
        reason=reason,
        now_aware=now_aware,
        expires_utc=expires_utc,
    )
    db.add(override)
    db.add(audit)
    await db.commit()
    await db.refresh(override)
    return build_override_info(
        override,
        target_name=action_res.device.effective_name,
        now_utc=now_aware,
    )


async def start_group_override(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    group_id: int,
    payload: TimerStartRequest,
    *,
    actor: str,
    client_ip: str | None = None,
    now_utc: datetime | None = None,
) -> ActiveOverrideInfo:
    """Start a temporary 'pause' (block) or 'bonus' (unblock) timer on a device group."""
    from app.services.group_service import (
        block_group_internet,
        unblock_group_internet,
    )

    now_aware = ensure_utc(now_utc or utc_now())
    mode, expires_utc, minutes, reason = validate_timer_start_payload(
        payload, settings.tz, now_aware
    )

    if mode == "pause":
        action_res = await block_group_internet(
            db,
            opnsense,
            settings,
            group_id,
            actor=actor,
            client_ip=client_ip,
        )
    else:
        action_res = await unblock_group_internet(
            db,
            opnsense,
            settings,
            group_id,
            actor=actor,
            client_ip=client_ip,
        )

    await cancel_active_overrides_for_group(db, group_id, now_aware)
    override, audit = _create_override_and_audit_objects(
        target_type="group",
        device_id=None,
        group_id=group_id,
        target_label=f"Group '{action_res.group.name}' (id={group_id})",
        mode=mode,
        minutes=minutes,
        actor=actor,
        reason=reason,
        now_aware=now_aware,
        expires_utc=expires_utc,
    )
    db.add(override)
    db.add(audit)
    await db.commit()
    await db.refresh(override)
    return build_override_info(
        override,
        target_name=action_res.group.name,
        now_utc=now_aware,
    )


async def cancel_override(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    override_id: int,
    *,
    actor: str,
    revert_state: bool = True,
    client_ip: str | None = None,
    now_utc: datetime | None = None,
) -> TimerCancelResponse:
    """Cancel an active temporary override by ID and optionally revert its OPNsense state."""
    from app.services.device_service import (
        block_device_internet,
        unblock_device_internet,
    )
    from app.services.group_service import (
        block_group_internet,
        unblock_group_internet,
    )

    now_aware = ensure_utc(now_utc or utc_now())
    override = (
        await db.execute(
            select(TemporaryOverride).where(TemporaryOverride.id == override_id)
        )
    ).scalar_one_or_none()

    if not override:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Temporary override {override_id} not found.",
        )

    override.is_active = False
    override.cancelled_at = now_aware
    warnings: list[str] = []
    reverted = False

    if revert_state:
        if override.target_type == "device" and override.device_id is not None:
            if override.mode == "pause":
                res = await unblock_device_internet(
                    db,
                    opnsense,
                    settings,
                    override.device_id,
                    actor=actor,
                    client_ip=client_ip,
                )
                if res.warning:
                    warnings.append(res.warning)
                reverted = True
            else:
                res = await block_device_internet(
                    db,
                    opnsense,
                    settings,
                    override.device_id,
                    actor=actor,
                    client_ip=client_ip,
                )
                if res.warning:
                    warnings.append(res.warning)
                reverted = True
        elif override.target_type == "group" and override.group_id is not None:
            if override.mode == "pause":
                grp_res = await unblock_group_internet(
                    db,
                    opnsense,
                    settings,
                    override.group_id,
                    actor=actor,
                    client_ip=client_ip,
                )
                warnings.extend(grp_res.warnings)
                reverted = True
            else:
                grp_res = await block_group_internet(
                    db,
                    opnsense,
                    settings,
                    override.group_id,
                    actor=actor,
                    client_ip=client_ip,
                )
                warnings.extend(grp_res.warnings)
                reverted = True

    audit, resp = _finalize_cancelled_override(
        override,
        actor=actor,
        reverted=reverted,
        warnings=warnings,
        now_aware=now_aware,
    )
    db.add(audit)
    await db.commit()
    return resp


async def reconcile_expired_overrides(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    *,
    now_utc: datetime | None = None,
) -> OverrideReconciliationSummary:
    """Inspect active overrides, enforce OPNsense state transitions, and log audit events."""
    from app.services.device_service import (
        block_device_internet,
        unblock_device_internet,
    )
    from app.services.group_service import (
        block_group_internet,
        unblock_group_internet,
    )

    now_aware = ensure_utc(now_utc or utc_now())
    active_rows = list(
        (
            await db.execute(
                select(TemporaryOverride)
                .where(TemporaryOverride.is_active.is_(True))
                .order_by(TemporaryOverride.expires_at.asc())
            )
        )
        .scalars()
        .all()
    )
    expired_rows = select_expired_overrides(active_rows, now_aware)
    summary = OverrideReconciliationSummary(
        checked_active_count=len(active_rows),
        expired_processed_count=0,
    )

    for ov in expired_rows:
        ov_id = ov.id
        ov_mode = ov.mode
        ov_target_type = ov.target_type
        ov_target_id = ov.device_id or ov.group_id
        try:
            if ov_target_type == "device" and ov.device_id is not None:
                if ov_mode == "pause":
                    res = await unblock_device_internet(
                        db, opnsense, settings, ov.device_id, actor="timer"
                    )
                    summary.unblocked_targets.append(res.device.effective_name)
                else:
                    res = await block_device_internet(
                        db, opnsense, settings, ov.device_id, actor="timer"
                    )
                    summary.reblocked_targets.append(res.device.effective_name)
            elif ov_target_type == "group" and ov.group_id is not None:
                if ov_mode == "pause":
                    grp_res = await unblock_group_internet(
                        db, opnsense, settings, ov.group_id, actor="timer"
                    )
                    summary.unblocked_targets.append(f"Group:{grp_res.group.name}")
                else:
                    grp_res = await block_group_internet(
                        db, opnsense, settings, ov.group_id, actor="timer"
                    )
                    summary.reblocked_targets.append(f"Group:{grp_res.group.name}")

            ov_ref = await db.get(TemporaryOverride, ov_id)
            if ov_ref is not None:
                ov_ref.is_active = False
                ov_ref.completed_at = now_aware
            db.add(
                AuditLog(
                    actor="timer",
                    action=f"timer.expired.{ov_mode}",
                    target=f"{ov_target_type}:{ov_target_id}",
                    status="success",
                    details=f"Expired {ov_mode} timer #{ov_id} completed and state restored.",
                )
            )
            await db.commit()
            summary.expired_processed_count += 1
        except Exception as exc:
            await db.rollback()
            err_msg = f"Failed to reconcile expired override #{ov_id}: {exc}"
            summary.errors.append(err_msg)

    return summary
