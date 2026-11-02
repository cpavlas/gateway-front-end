"""Audit log querying, 90-day retention pruning, and JSON config backup/restore (Phase 7)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AuditLog,
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    format_days_of_week,
    normalize_group_color,
    normalize_mac_address,
    parse_days_of_week,
    utc_now,
    validate_time_hhmm,
)
from app.models import (
    RecurringSchedule as Schedule,
)


class AuditLogItem(BaseModel):
    """Serialized audit log record."""

    id: int
    actor: str
    action: str
    target: str
    status: str
    details: str
    created_at: str


class AuditLogListResponse(BaseModel):
    """Response payload for GET /api/v1/audit-logs."""

    total_count: int
    items: list[AuditLogItem]


class ConfigBackupDeviceItem(BaseModel):
    """Exported per-device metadata keyed by normalized MAC address."""

    mac_address: str
    display_name: str | None = None
    notes: str = ""
    is_protected: bool = False
    is_manually_blocked: bool = False
    is_youtube_blocked: bool = False


class ConfigBackupGroupItem(BaseModel):
    """Exported device group/profile and member MAC addresses."""

    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    color_badge: str = "indigo"
    icon: str = "users"
    member_macs: list[str] = Field(default_factory=list)


class ConfigBackupScheduleItem(BaseModel):
    """Exported recurring schedule rule."""

    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    target_type: Literal["device", "group"]
    device_mac: str | None = None
    group_name: str | None = None
    days_of_week: list[int]
    start_time: str
    end_time: str
    timezone: str = "America/Los_Angeles"
    is_enabled: bool = True


class ConfigBackupPayload(BaseModel):
    """Portable JSON configuration snapshot (excludes all API keys and secrets)."""

    schema_version: str = "1.0"
    exported_at: str = Field(default_factory=lambda: utc_now().isoformat())
    devices: list[ConfigBackupDeviceItem] = Field(default_factory=list)
    groups: list[ConfigBackupGroupItem] = Field(default_factory=list)
    schedules: list[ConfigBackupScheduleItem] = Field(default_factory=list)


class ConfigRestoreSummary(BaseModel):
    """Summary returned by POST /api/v1/system/restore."""

    devices_updated: int
    groups_upserted: int
    schedules_upserted: int
    restored_at: str


def build_audit_log_item(row: AuditLog) -> AuditLogItem:
    """Convert an `AuditLog` ORM instance into an `AuditLogItem`."""
    return AuditLogItem(
        id=row.id,
        actor=row.actor,
        action=row.action,
        target=row.target or "",
        status=row.status or "success",
        details=row.details or "",
        created_at=row.created_at.isoformat(),
    )


def filter_and_paginate_audit_logs(
    rows: list[AuditLog],
    *,
    action_filter: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> AuditLogListResponse:
    """Sort, filter, and slice `AuditLog` rows in pure Python for deterministic test coverage."""
    sorted_rows = sorted(rows, key=lambda r: (r.created_at, r.id), reverse=True)
    filtered = sorted_rows
    if action_filter and action_filter.strip() and action_filter.strip().lower() != "all":
        act_q = action_filter.strip().lower()
        filtered = [r for r in filtered if act_q in (r.action or "").lower()]

    if search and search.strip():
        q = search.strip().lower()
        filtered = [
            r
            for r in filtered
            if q in (r.actor or "").lower()
            or q in (r.action or "").lower()
            or q in (r.target or "").lower()
            or q in (r.details or "").lower()
            or q in (r.status or "").lower()
        ]

    safe_limit = max(1, min(int(limit), 250))
    items = [build_audit_log_item(r) for r in filtered[:safe_limit]]
    return AuditLogListResponse(total_count=len(filtered), items=items)


def assemble_backup_payload(
    devices: list[Device],
    groups: list[DeviceGroup],
    memberships: list[DeviceGroupMembership],
    schedules: list[Schedule],
) -> ConfigBackupPayload:
    """Assemble a secret-free `ConfigBackupPayload` from SQLite ORM rows."""
    dev_by_id: dict[int, Device] = {d.id: d for d in devices}
    grp_by_id: dict[int, DeviceGroup] = {g.id: g for g in groups}

    backup_devices = [
        ConfigBackupDeviceItem(
            mac_address=d.mac_address,
            display_name=d.display_name,
            notes=d.notes or "",
            is_protected=bool(d.is_protected),
            is_manually_blocked=bool(d.is_manually_blocked),
            is_youtube_blocked=bool(getattr(d, "is_youtube_blocked", False)),
        )
        for d in sorted(devices, key=lambda item: item.mac_address)
    ]

    macs_by_group: dict[int, list[str]] = {g.id: [] for g in groups}
    for m in memberships:
        dev = dev_by_id.get(m.device_id)
        if dev is not None and m.group_id in macs_by_group:
            macs_by_group[m.group_id].append(dev.mac_address)

    backup_groups = [
        ConfigBackupGroupItem(
            name=g.name,
            description=g.description or "",
            color_badge=g.color_badge,
            icon=g.icon,
            member_macs=sorted(set(macs_by_group.get(g.id, []))),
        )
        for g in sorted(groups, key=lambda item: item.name.lower())
    ]

    backup_schedules: list[ConfigBackupScheduleItem] = []
    for s in sorted(schedules, key=lambda item: item.name.lower()):
        target_dev = dev_by_id.get(s.device_id) if s.device_id is not None else None
        target_grp = grp_by_id.get(s.group_id) if s.group_id is not None else None
        target_type: Literal["device", "group"] = (
            "group" if s.target_type == "group" else "device"
        )
        backup_schedules.append(
            ConfigBackupScheduleItem(
                name=s.name,
                description=s.description or "",
                target_type=target_type,
                device_mac=target_dev.mac_address if target_dev else None,
                group_name=target_grp.name if target_grp else None,
                days_of_week=parse_days_of_week(s.days_of_week),
                start_time=s.start_time,
                end_time=s.end_time,
                timezone=s.timezone,
                is_enabled=bool(s.is_enabled),
            )
        )

    return ConfigBackupPayload(
        schema_version="1.0",
        exported_at=utc_now().isoformat(),
        devices=backup_devices,
        groups=backup_groups,
        schedules=backup_schedules,
    )


def prepare_restored_devices(
    existing_devices: list[Device],
    backup_devices: list[ConfigBackupDeviceItem],
    now: datetime,
) -> tuple[dict[str, Device], list[Device], int]:
    """Synchronously reconcile `ConfigBackupDeviceItem` rows against existing `Device` objects."""
    dev_by_mac: dict[str, Device] = {d.mac_address: d for d in existing_devices}
    new_devices: list[Device] = []
    updated_count = 0
    for item in backup_devices:
        mac = normalize_mac_address(item.mac_address)
        dev = dev_by_mac.get(mac)
        if dev is None:
            dev = Device(
                mac_address=mac,
                display_name=item.display_name,
                notes=item.notes or "",
                is_protected=bool(item.is_protected),
                is_manually_blocked=bool(item.is_manually_blocked),
                is_youtube_blocked=bool(item.is_youtube_blocked),
                first_seen_at=now,
                last_seen_at=now,
                updated_at=now,
            )
            dev_by_mac[mac] = dev
            new_devices.append(dev)
        else:
            dev.display_name = item.display_name
            dev.notes = item.notes or ""
            dev.is_protected = bool(item.is_protected)
            dev.is_manually_blocked = bool(item.is_manually_blocked)
            dev.is_youtube_blocked = bool(item.is_youtube_blocked)
            dev.updated_at = now
        updated_count += 1
    return dev_by_mac, new_devices, updated_count


def prepare_restored_groups(
    existing_groups: list[DeviceGroup],
    backup_groups: list[ConfigBackupGroupItem],
    now: datetime,
) -> tuple[dict[str, DeviceGroup], list[DeviceGroup], int]:
    """Synchronously reconcile `ConfigBackupGroupItem` rows against existing `DeviceGroup` rows."""
    grp_by_name: dict[str, DeviceGroup] = {g.name.lower(): g for g in existing_groups}
    new_groups: list[DeviceGroup] = []
    upserted_count = 0
    for g_item in backup_groups:
        clean_name = g_item.name.strip()
        clean_color = normalize_group_color(g_item.color_badge)
        clean_icon = (g_item.icon or "users").strip().lower() or "users"
        grp = grp_by_name.get(clean_name.lower())
        if grp is None:
            grp = DeviceGroup(
                name=clean_name,
                description=g_item.description or "",
                color_badge=clean_color,
                icon=clean_icon,
                created_at=now,
                updated_at=now,
            )
            grp_by_name[clean_name.lower()] = grp
            new_groups.append(grp)
        else:
            grp.name = clean_name
            grp.description = g_item.description or ""
            grp.color_badge = clean_color
            grp.icon = clean_icon
            grp.updated_at = now
        upserted_count += 1
    return grp_by_name, new_groups, upserted_count


def prepare_restored_schedules(
    existing_schedules: list[Schedule],
    backup_schedules: list[ConfigBackupScheduleItem],
    dev_by_mac: dict[str, Device],
    grp_by_name: dict[str, DeviceGroup],
    now: datetime,
) -> tuple[list[Schedule], int]:
    """Synchronously reconcile `ConfigBackupScheduleItem` rows against existing `Schedule` rows."""
    sched_by_name: dict[str, Schedule] = {s.name.lower(): s for s in existing_schedules}
    new_schedules: list[Schedule] = []
    upserted_count = 0
    for s_item in backup_schedules:
        clean_sched_name = s_item.name.strip()
        days_csv = format_days_of_week(s_item.days_of_week)
        start_hhmm = validate_time_hhmm(s_item.start_time)
        end_hhmm = validate_time_hhmm(s_item.end_time)

        target_dev_id: int | None = None
        target_grp_id: int | None = None
        if s_item.target_type == "device" and s_item.device_mac:
            t_dev = dev_by_mac.get(normalize_mac_address(s_item.device_mac))
            if t_dev is not None:
                target_dev_id = t_dev.id
        elif s_item.target_type == "group" and s_item.group_name:
            t_grp = grp_by_name.get(s_item.group_name.strip().lower())
            if t_grp is not None:
                target_grp_id = t_grp.id

        if target_dev_id is None and target_grp_id is None:
            continue

        sched = sched_by_name.get(clean_sched_name.lower())
        if sched is None:
            sched = Schedule(
                name=clean_sched_name,
                description=s_item.description or "",
                target_type=s_item.target_type,
                device_id=target_dev_id,
                group_id=target_grp_id,
                days_of_week=days_csv,
                start_time=start_hhmm,
                end_time=end_hhmm,
                timezone=s_item.timezone or "America/Los_Angeles",
                is_enabled=bool(s_item.is_enabled),
                created_at=now,
                updated_at=now,
            )
            sched_by_name[clean_sched_name.lower()] = sched
            new_schedules.append(sched)
        else:
            sched.description = s_item.description or ""
            sched.target_type = s_item.target_type
            sched.device_id = target_dev_id
            sched.group_id = target_grp_id
            sched.days_of_week = days_csv
            sched.start_time = start_hhmm
            sched.end_time = end_hhmm
            sched.timezone = s_item.timezone or "America/Los_Angeles"
            sched.is_enabled = bool(s_item.is_enabled)
            sched.updated_at = now
        upserted_count += 1
    return new_schedules, upserted_count


async def prune_old_audit_logs(db: AsyncSession, retention_days: int = 90) -> int:
    """Delete audit log rows older than `retention_days`."""
    cutoff = utc_now() - timedelta(days=max(1, int(retention_days)))
    result = await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


async def list_audit_logs(
    db: AsyncSession,
    *,
    action_filter: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> AuditLogListResponse:
    """Prune expired (>90d) audit logs and return filtered/paginated audit history."""
    await prune_old_audit_logs(db, retention_days=90)
    rows = list((await db.execute(select(AuditLog))).scalars().all())
    return filter_and_paginate_audit_logs(
        rows,
        action_filter=action_filter,
        search=search,
        limit=limit,
    )


async def export_configuration_backup(db: AsyncSession) -> ConfigBackupPayload:
    """Export all device metadata, groups, and schedules into a portable JSON snapshot."""
    devices = list((await db.execute(select(Device))).scalars().all())
    groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    memberships = list((await db.execute(select(DeviceGroupMembership))).scalars().all())
    schedules = list((await db.execute(select(Schedule))).scalars().all())
    return assemble_backup_payload(devices, groups, memberships, schedules)


async def restore_configuration_backup(
    db: AsyncSession,
    payload: ConfigBackupPayload,
    *,
    actor: str,
) -> ConfigRestoreSummary:
    """Idempotently restore device customizations, groups, and schedules from a backup snapshot."""
    now = utc_now()
    existing_devices = list((await db.execute(select(Device))).scalars().all())
    dev_by_mac, new_devices, devices_updated = prepare_restored_devices(
        existing_devices, payload.devices, now
    )
    for d in new_devices:
        db.add(d)
    await db.flush()

    existing_groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    grp_by_name, new_groups, groups_upserted = prepare_restored_groups(
        existing_groups, payload.groups, now
    )
    for g in new_groups:
        db.add(g)
    await db.flush()

    for g_item in payload.groups:
        grp = grp_by_name.get(g_item.name.strip().lower())
        if grp is None:
            continue
        await db.execute(
            delete(DeviceGroupMembership).where(DeviceGroupMembership.group_id == grp.id)
        )
        for raw_mac in set(g_item.member_macs):
            member_dev = dev_by_mac.get(normalize_mac_address(raw_mac))
            if member_dev is not None:
                db.add(
                    DeviceGroupMembership(
                        group_id=grp.id,
                        device_id=member_dev.id,
                        created_at=now,
                    )
                )

    existing_schedules = list((await db.execute(select(Schedule))).scalars().all())
    new_schedules, schedules_upserted = prepare_restored_schedules(
        existing_schedules, payload.schedules, dev_by_mac, grp_by_name, now
    )
    for s in new_schedules:
        db.add(s)

    db.add(
        AuditLog(
            actor=actor,
            action="system.restore",
            target="configuration_backup",
            status="success",
            details=(
                f"Restored {devices_updated} devices, {groups_upserted} groups, "
                f"and {schedules_upserted} schedules."
            ),
        )
    )
    await db.commit()
    return ConfigRestoreSummary(
        devices_updated=devices_updated,
        groups_upserted=groups_upserted,
        schedules_upserted=schedules_upserted,
        restored_at=now.isoformat(),
    )
