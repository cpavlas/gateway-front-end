"""Device discovery, reconciliation, and instant block/unblock service (Phases 2–4)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.opnsense import (
    OPNsenseClient,
    OPNsenseClientError,
    validate_ipv4_address,
)
from app.config import Settings
from app.models import (
    AuditLog,
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    SystemMetadata,
    clean_discovered_hostname,
    normalize_mac_address,
    utc_now,
)
from app.services.schedule_service import ActiveScheduleInfo, get_active_schedule_maps
from app.services.timer_service import (
    ActiveOverrideInfo,
    cancel_active_overrides_for_device,
    load_active_override_maps,
)

LAST_SYNC_METADATA_KEY = "devices_last_synced_at"
DeviceStatusFilter = Literal["all", "online", "blocked", "protected", "unassigned"]


class DeviceGroupBadge(BaseModel):
    """Compact group badge attached to a DeviceResponse."""

    id: int
    name: str
    color_badge: str
    icon: str


class DeviceResponse(BaseModel):
    """Serialized network device representation returned to the frontend."""

    id: int
    mac_address: str
    ipv4_address: str | None
    hostname: str | None
    display_name: str | None
    effective_name: str
    vendor: str | None
    interface_name: str | None
    lease_type: str
    is_online: bool
    is_blocked: bool
    is_youtube_blocked: bool = False
    is_protected: bool
    protection_reason: str | None = None
    notes: str
    groups: list[DeviceGroupBadge] = Field(default_factory=list)
    active_override: ActiveOverrideInfo | None = None
    active_schedule: ActiveScheduleInfo | None = None
    first_seen_at: str
    last_seen_at: str
    updated_at: str


class DeviceSummaryStats(BaseModel):
    """Aggregate KPI counts across the full device inventory."""

    total_devices: int = 0
    online_devices: int = 0
    blocked_devices: int = 0
    protected_devices: int = 0


class DeviceListResponse(BaseModel):
    """Response payload for GET /api/v1/devices and POST /api/v1/devices/sync."""

    summary: DeviceSummaryStats
    devices: list[DeviceResponse]
    last_synced_at: str | None = None


class DeviceUpdateRequest(BaseModel):
    """Request payload for PATCH /api/v1/devices/{device_id}."""

    display_name: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    is_protected: bool | None = None


class DeviceActionResponse(BaseModel):
    """Response payload for POST /api/v1/devices/{device_id}/block and /unblock."""

    device: DeviceResponse
    action: Literal["block", "unblock", "youtube_block", "youtube_unblock"]
    states_killed: bool = False
    warning: str | None = None


def _try_validate_ipv4(raw_ip: Any) -> str | None:
    if not isinstance(raw_ip, str) or not raw_ip.strip():
        return None
    try:
        return validate_ipv4_address(raw_ip)
    except ValueError:
        return None


def _pick_vendor(arp_vendor: str | None, lease_vendor: str | None) -> str | None:
    """Choose the most descriptive vendor label between ARP manufacturer and Dnsmasq mac_info."""
    cleaned_arp = clean_discovered_hostname(arp_vendor)
    cleaned_lease = clean_discovered_hostname(lease_vendor)
    if cleaned_arp and cleaned_arp.lower() != "private":
        return cleaned_arp
    if cleaned_lease and cleaned_lease.lower() != "private":
        return cleaned_lease
    return cleaned_arp or cleaned_lease


def build_device_group_badge_map(
    groups: list[DeviceGroup],
    memberships: list[DeviceGroupMembership],
) -> dict[int, list[DeviceGroupBadge]]:
    """Build a mapping of {device_id: [DeviceGroupBadge, ...]} sorted by group name."""
    group_by_id: dict[int, DeviceGroupBadge] = {
        g.id: DeviceGroupBadge(
            id=g.id,
            name=g.name,
            color_badge=g.color_badge,
            icon=g.icon,
        )
        for g in groups
    }
    by_device: dict[int, list[DeviceGroupBadge]] = {}
    for m in memberships:
        badge = group_by_id.get(m.group_id)
        if badge is not None:
            by_device.setdefault(m.device_id, []).append(badge)
    for badge_list in by_device.values():
        badge_list.sort(key=lambda b: b.name.lower())
    return by_device


def build_device_response(
    device: Device,
    settings: Settings,
    client_ip: str | None = None,
    groups: list[DeviceGroupBadge] | None = None,
    active_override: ActiveOverrideInfo | None = None,
    active_schedule: ActiveScheduleInfo | None = None,
) -> DeviceResponse:
    """Convert a SQLAlchemy `Device` row into a `DeviceResponse` with protection metadata."""
    ip = device.ipv4_address
    in_protected_env = bool(ip and ip in settings.protected_ip_set)
    is_admin_ip = bool(ip and client_ip and ip == client_ip)
    effective_protected = bool(device.is_protected or in_protected_env or is_admin_ip)

    protection_reason: str | None = None
    if in_protected_env:
        protection_reason = "Protected gateway/infrastructure IP (OPNSENSE_PROTECTED_IPS)"
    elif is_admin_ip:
        protection_reason = "Active administrator session IP"
    elif device.is_protected:
        protection_reason = "Manually marked Protected"

    effective_name = (
        (device.display_name or "").strip()
        or (device.hostname or "").strip()
        or (device.ipv4_address or "").strip()
        or device.mac_address
    )

    return DeviceResponse(
        id=device.id,
        mac_address=device.mac_address,
        ipv4_address=device.ipv4_address,
        hostname=device.hostname,
        display_name=device.display_name,
        effective_name=effective_name,
        vendor=device.vendor,
        interface_name=device.interface_name,
        lease_type=device.lease_type or "unknown",
        is_online=bool(device.is_online),
        is_blocked=device.is_blocked,
        is_youtube_blocked=bool(getattr(device, "is_youtube_blocked", False)),
        is_protected=effective_protected,
        protection_reason=protection_reason,
        notes=device.notes or "",
        groups=groups or [],
        active_override=active_override,
        active_schedule=active_schedule,
        first_seen_at=device.first_seen_at.isoformat(),
        last_seen_at=device.last_seen_at.isoformat(),
        updated_at=device.updated_at.isoformat(),
    )


def merge_opnsense_discovery_payloads(
    arp_rows: list[dict[str, Any]],
    lease_rows: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    """Merge raw OPNsense Dnsmasq leases and ARP entries keyed by normalized MAC."""
    discovered: dict[str, dict[str, Any]] = {}
    online_macs: set[str] = set()

    # 1. Process Dnsmasq DHCP leases (Waterfall Update 2A: address, hwaddr, mac_info, '*' stripping)
    for row in lease_rows:
        if not isinstance(row, dict):
            continue
        raw_mac = row.get("hwaddr") or row.get("mac")
        if not isinstance(raw_mac, str):
            continue
        try:
            mac = normalize_mac_address(raw_mac)
        except ValueError:
            continue

        ip = _try_validate_ipv4(row.get("address") or row.get("ip"))
        hostname = clean_discovered_hostname(row.get("hostname"))
        vendor = clean_discovered_hostname(row.get("mac_info"))
        interface_name = (
            clean_discovered_hostname(str(row.get("if_descr") or ""))
            or clean_discovered_hostname(str(row.get("if_name") or ""))
            or clean_discovered_hostname(str(row.get("if") or ""))
        )
        raw_lease_type = str(row.get("lease_type") or "").strip().lower()
        if not raw_lease_type:
            raw_lease_type = "static" if row.get("is_reserved") else "dynamic"

        entry = discovered.setdefault(
            mac,
            {
                "ipv4_address": None,
                "hostname": None,
                "lease_vendor": None,
                "arp_vendor": None,
                "interface_name": None,
                "lease_type": raw_lease_type,
            },
        )
        if ip:
            entry["ipv4_address"] = ip
        if hostname:
            entry["hostname"] = hostname
        if vendor:
            entry["lease_vendor"] = vendor
        if interface_name:
            entry["interface_name"] = interface_name
        entry["lease_type"] = raw_lease_type

    # 2. Process live ARP table entries (/api/diagnostics/interface/get_arp)
    for row in arp_rows:
        if not isinstance(row, dict):
            continue
        raw_mac = row.get("mac")
        if not isinstance(raw_mac, str):
            continue
        try:
            mac = normalize_mac_address(raw_mac)
        except ValueError:
            continue

        ip = _try_validate_ipv4(row.get("ip"))
        expired = bool(row.get("expired", False))
        if not expired:
            online_macs.add(mac)

        arp_hostname = clean_discovered_hostname(row.get("hostname"))
        arp_vendor = clean_discovered_hostname(row.get("manufacturer"))
        arp_intf = clean_discovered_hostname(
            str(row.get("intf_description") or row.get("intf") or "")
        )
        arp_lease_type = "static" if row.get("permanent") else "arp_only"

        entry = discovered.setdefault(
            mac,
            {
                "ipv4_address": None,
                "hostname": None,
                "lease_vendor": None,
                "arp_vendor": None,
                "interface_name": None,
                "lease_type": arp_lease_type,
            },
        )
        if ip and (not expired or not entry["ipv4_address"]):
            entry["ipv4_address"] = ip
        if arp_hostname and not entry["hostname"]:
            entry["hostname"] = arp_hostname
        if arp_vendor:
            entry["arp_vendor"] = arp_vendor
        if arp_intf and not entry["interface_name"]:
            entry["interface_name"] = arp_intf

    return discovered, online_macs


def _reconcile_ORM_devices(
    existing_rows: list[Device],
    discovered: dict[str, dict[str, Any]],
    online_macs: set[str],
    blocked_ips: set[str],
    settings: Settings,
    now: datetime,
) -> list[Device]:
    """Update existing `Device` rows and return newly created `Device` instances."""
    existing_by_mac: dict[str, Device] = {d.mac_address: d for d in existing_rows}
    new_devices: list[Device] = []

    for mac, info in discovered.items():
        ip = info["ipv4_address"]
        vendor = _pick_vendor(info["arp_vendor"], info["lease_vendor"])
        is_online = mac in online_macs
        is_blocked = bool(ip and ip in blocked_ips)
        is_protected_ip = bool(ip and ip in settings.protected_ip_set)

        if mac in existing_by_mac:
            dev = existing_by_mac[mac]
            if ip:
                dev.ipv4_address = ip
            if info["hostname"]:
                dev.hostname = info["hostname"]
            if vendor:
                dev.vendor = vendor
            if info["interface_name"]:
                dev.interface_name = info["interface_name"]
            if info["lease_type"]:
                dev.lease_type = info["lease_type"]
            dev.is_online = is_online
            dev.is_blocked = bool(dev.ipv4_address and dev.ipv4_address in blocked_ips)
            if is_protected_ip:
                dev.is_protected = True
            if is_online:
                dev.last_seen_at = now
            dev.updated_at = now
        else:
            new_devices.append(
                Device(
                    mac_address=mac,
                    ipv4_address=ip,
                    hostname=info["hostname"],
                    display_name=None,
                    vendor=vendor,
                    interface_name=info["interface_name"],
                    lease_type=info["lease_type"] or "unknown",
                    is_online=is_online,
                    is_blocked=is_blocked,
                    is_protected=is_protected_ip,
                    notes="",
                    first_seen_at=now,
                    last_seen_at=now,
                    updated_at=now,
                )
            )

    for mac, dev in existing_by_mac.items():
        if mac not in discovered:
            dev.is_online = False
            dev.is_blocked = bool(dev.ipv4_address and dev.ipv4_address in blocked_ips)
            if dev.ipv4_address and dev.ipv4_address in settings.protected_ip_set:
                dev.is_protected = True

    return new_devices


def _filter_and_summarize_devices(
    rows: list[Device],
    settings: Settings,
    *,
    client_ip: str | None = None,
    search: str | None = None,
    status_filter: DeviceStatusFilter = "all",
    group_id: int | None = None,
    badges_by_device: dict[int, list[DeviceGroupBadge]] | None = None,
    overrides_by_device: dict[int, ActiveOverrideInfo] | None = None,
    schedules_by_device: dict[int, ActiveScheduleInfo] | None = None,
    last_synced_at: str | None = None,
) -> DeviceListResponse:
    """Build sorted, filtered `DeviceListResponse` and KPI summary counts."""
    badge_map = badges_by_device or {}
    override_map = overrides_by_device or {}
    schedule_map = schedules_by_device or {}
    all_responses = [
        build_device_response(
            d,
            settings,
            client_ip,
            groups=badge_map.get(d.id, []),
            active_override=override_map.get(d.id),
            active_schedule=schedule_map.get(d.id),
        )
        for d in rows
    ]
    all_responses.sort(
        key=lambda item: (
            0 if item.is_online else 1,
            0 if item.is_blocked else 1,
            item.effective_name.lower(),
        )
    )

    summary = DeviceSummaryStats(
        total_devices=len(all_responses),
        online_devices=sum(1 for d in all_responses if d.is_online),
        blocked_devices=sum(1 for d in all_responses if d.is_blocked),
        protected_devices=sum(1 for d in all_responses if d.is_protected),
    )

    filtered = all_responses
    if status_filter == "online":
        filtered = [d for d in filtered if d.is_online]
    elif status_filter == "blocked":
        filtered = [d for d in filtered if d.is_blocked]
    elif status_filter == "protected":
        filtered = [d for d in filtered if d.is_protected]
    elif status_filter == "unassigned":
        filtered = [d for d in filtered if len(d.groups) == 0]

    if group_id is not None:
        filtered = [d for d in filtered if any(g.id == group_id for g in d.groups)]

    if search and search.strip():
        q = search.strip().lower()
        filtered = [
            d
            for d in filtered
            if q in d.effective_name.lower()
            or (d.hostname and q in d.hostname.lower())
            or (d.display_name and q in d.display_name.lower())
            or (d.ipv4_address and q in d.ipv4_address.lower())
            or q in d.mac_address.lower()
            or (d.vendor and q in d.vendor.lower())
            or (d.interface_name and q in d.interface_name.lower())
            or any(q in g.name.lower() for g in d.groups)
        ]

    return DeviceListResponse(
        summary=summary,
        devices=filtered,
        last_synced_at=last_synced_at,
    )


def _apply_device_metadata_updates(
    dev: Device | None,
    device_id: int,
    payload: DeviceUpdateRequest,
    settings: Settings,
) -> Device:
    """Validate and apply metadata updates to a `Device` instance."""
    if not dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found.",
        )

    if payload.display_name is not None:
        cleaned_name = payload.display_name.strip()
        dev.display_name = cleaned_name if cleaned_name else None

    if payload.notes is not None:
        dev.notes = payload.notes.strip()

    if payload.is_protected is not None:
        if (
            not payload.is_protected
            and dev.ipv4_address
            and dev.ipv4_address in settings.protected_ip_set
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Cannot remove protection from infrastructure IP {dev.ipv4_address} "
                    f"(configured in OPNSENSE_PROTECTED_IPS)."
                ),
            )
        dev.is_protected = payload.is_protected

    dev.updated_at = utc_now()
    return dev


def _validate_device_blockable(
    dev: Device | None,
    device_id: int,
    settings: Settings,
    client_ip: str | None = None,
) -> tuple[Device, str]:
    """Ensure target device exists, has an IPv4 address, and is not protected from blocking."""
    if not dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found.",
        )

    if not dev.ipv4_address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot block a device without a known IPv4 address.",
        )

    if dev.ipv4_address in settings.protected_ip_set:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Refusing to block protected gateway/infrastructure IP {dev.ipv4_address}."
            ),
        )

    if client_ip and dev.ipv4_address == client_ip:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Refusing to block {dev.ipv4_address} because it is your active "
                f"administrator session IP."
            ),
        )

    if dev.is_protected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Device '{dev.display_name or dev.hostname or dev.mac_address}' is marked "
                f"Protected. Unprotect the device before blocking."
            ),
        )

    return dev, dev.ipv4_address


async def _load_device_group_badges(
    db: AsyncSession,
    device_id: int | None = None,
) -> dict[int, list[DeviceGroupBadge]]:
    """Fetch group badge assignments for all devices or a single device."""
    groups = list((await db.execute(select(DeviceGroup))).scalars().all())
    if not groups:
        return {}
    stmt = select(DeviceGroupMembership)
    if device_id is not None:
        stmt = stmt.where(DeviceGroupMembership.device_id == device_id)
    memberships = list((await db.execute(stmt)).scalars().all())
    return build_device_group_badge_map(groups, memberships)


async def sync_devices_from_opnsense(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
) -> None:
    """Fetch live ARP, Dnsmasq leases, and blocked alias IPs from OPNsense and reconcile SQLite."""
    arp_rows = await opnsense.get_arp_table()
    lease_rows = await opnsense.get_dnsmasq_leases()
    blocked_ips = set(await opnsense.list_blocked_alias_ips())

    now = utc_now()
    discovered, online_macs = merge_opnsense_discovery_payloads(arp_rows, lease_rows)

    existing_rows = list((await db.execute(select(Device))).scalars().all())
    new_devices = _reconcile_ORM_devices(
        existing_rows, discovered, online_macs, blocked_ips, settings, now
    )
    for dev in new_devices:
        db.add(dev)

    meta = (
        await db.execute(
            select(SystemMetadata).where(SystemMetadata.key == LAST_SYNC_METADATA_KEY)
        )
    ).scalar_one_or_none()
    if meta:
        meta.value = now.isoformat()
        meta.updated_at = now
    else:
        db.add(
            SystemMetadata(
                key=LAST_SYNC_METADATA_KEY,
                value=now.isoformat(),
                updated_at=now,
            )
        )

    await db.commit()


async def list_devices_inventory(
    db: AsyncSession,
    settings: Settings,
    *,
    client_ip: str | None = None,
    search: str | None = None,
    status_filter: DeviceStatusFilter = "all",
    group_id: int | None = None,
) -> DeviceListResponse:
    """Return KPI summary counts and filtered/sorted device inventory from SQLite."""
    rows = list((await db.execute(select(Device))).scalars().all())
    badges_by_device = await _load_device_group_badges(db)
    overrides_by_device, _ = await load_active_override_maps(db)
    schedules_by_device, _ = await get_active_schedule_maps(db)
    meta = (
        await db.execute(
            select(SystemMetadata).where(SystemMetadata.key == LAST_SYNC_METADATA_KEY)
        )
    ).scalar_one_or_none()

    return _filter_and_summarize_devices(
        rows,
        settings,
        client_ip=client_ip,
        search=search,
        status_filter=status_filter,
        group_id=group_id,
        badges_by_device=badges_by_device,
        overrides_by_device=overrides_by_device,
        schedules_by_device=schedules_by_device,
        last_synced_at=meta.value if meta else None,
    )


async def update_device_metadata(
    db: AsyncSession,
    settings: Settings,
    device_id: int,
    payload: DeviceUpdateRequest,
    *,
    actor: str,
    client_ip: str | None = None,
) -> DeviceResponse:
    """Update user-editable metadata (`display_name`, `notes`, `is_protected`) on a device."""
    raw_dev = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    dev = _apply_device_metadata_updates(raw_dev, device_id, payload, settings)

    db.add(
        AuditLog(
            actor=actor,
            action="device.update",
            target=f"{dev.mac_address} ({dev.ipv4_address or 'no-ip'})",
            status="success",
            details=f"Updated display_name={dev.display_name!r}, is_protected={dev.is_protected}",
        )
    )
    await db.commit()
    await db.refresh(dev)
    badges = await _load_device_group_badges(db, device_id=dev.id)
    return build_device_response(dev, settings, client_ip, groups=badges.get(dev.id, []))


async def block_device_internet(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    device_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> DeviceActionResponse:
    """Block internet access for a single device via OPNsense alias + kill_states."""
    raw_dev = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    dev, target_ip = _validate_device_blockable(raw_dev, device_id, settings, client_ip)

    try:
        await opnsense.add_ip_to_block_alias(target_ip)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        db.add(
            AuditLog(
                actor=actor,
                action="device.block",
                target=f"{dev.mac_address} ({target_ip})",
                status="failed",
                details=f"OPNsense alias add failed: {exc}",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to update OPNsense block alias: {exc}",
        ) from exc

    states_killed = False
    warning_msg: str | None = None
    try:
        await opnsense.kill_states_for_ip(target_ip)
        states_killed = True
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        warning_msg = (
            f"Device added to OPNsense block alias, but active state termination "
            f"(kill_states) reported a warning: {exc}"
        )

    dev.is_blocked = True
    if not actor.startswith(("timer", "schedule")):
        dev.is_manually_blocked = True
    dev.updated_at = utc_now()
    await cancel_active_overrides_for_device(db, dev.id, dev.updated_at)
    db.add(
        AuditLog(
            actor=actor,
            action="device.block",
            target=f"{dev.mac_address} ({target_ip})",
            status="success" if states_killed else "warning",
            details=warning_msg or "Device added to block alias and states killed.",
        )
    )
    await db.commit()
    await db.refresh(dev)
    badges = await _load_device_group_badges(db, device_id=dev.id)

    return DeviceActionResponse(
        device=build_device_response(dev, settings, client_ip, groups=badges.get(dev.id, [])),
        action="block",
        states_killed=states_killed,
        warning=warning_msg,
    )


async def unblock_device_internet(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    device_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> DeviceActionResponse:
    """Restore internet access for a single device by removing its IP from the OPNsense alias."""
    dev = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    if not dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found.",
        )

    if dev.ipv4_address:
        try:
            await opnsense.remove_ip_from_block_alias(dev.ipv4_address)
        except (OPNsenseClientError, httpx.HTTPError) as exc:
            db.add(
                AuditLog(
                    actor=actor,
                    action="device.unblock",
                    target=f"{dev.mac_address} ({dev.ipv4_address})",
                    status="failed",
                    details=f"OPNsense alias remove failed: {exc}",
                )
            )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to remove IP from OPNsense block alias: {exc}",
            ) from exc

    dev.is_blocked = False
    if not actor.startswith(("timer", "schedule")):
        dev.is_manually_blocked = False
    dev.updated_at = utc_now()
    await cancel_active_overrides_for_device(db, dev.id, dev.updated_at)
    db.add(
        AuditLog(
            actor=actor,
            action="device.unblock",
            target=f"{dev.mac_address} ({dev.ipv4_address or 'no-ip'})",
            status="success",
            details="Device removed from OPNsense block alias.",
        )
    )
    await db.commit()
    await db.refresh(dev)
    badges = await _load_device_group_badges(db, device_id=dev.id)

    return DeviceActionResponse(
        device=build_device_response(dev, settings, client_ip, groups=badges.get(dev.id, [])),
        action="unblock",
        states_killed=False,
        warning=None,
    )


async def block_device_youtube(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    device_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> DeviceActionResponse:
    """Block YouTube access for a single device while keeping Plex and general internet allowed."""
    raw_dev = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    dev, target_ip = _validate_device_blockable(raw_dev, device_id, settings, client_ip)

    try:
        await opnsense.add_ip_to_youtube_block_alias(target_ip)
    except (OPNsenseClientError, httpx.HTTPError) as exc:
        db.add(
            AuditLog(
                actor=actor,
                action="device.youtube_block",
                target=f"{dev.mac_address} ({target_ip})",
                status="failed",
                details=f"OPNsense YouTube alias add failed: {exc}",
            )
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to update OPNsense YouTube block alias: {exc}",
        ) from exc

    dev.is_youtube_blocked = True
    dev.updated_at = utc_now()
    db.add(
        AuditLog(
            actor=actor,
            action="device.youtube_block",
            target=f"{dev.mac_address} ({target_ip})",
            status="success",
            details=(
                "Device added to OPNsense YouTube block alias "
                "(Plex and general internet remain allowed)."
            ),
        )
    )
    await db.commit()
    await db.refresh(dev)
    badges = await _load_device_group_badges(db, device_id=dev.id)

    return DeviceActionResponse(
        device=build_device_response(dev, settings, client_ip, groups=badges.get(dev.id, [])),
        action="youtube_block",
        states_killed=False,
        warning=None,
    )


async def unblock_device_youtube(
    db: AsyncSession,
    opnsense: OPNsenseClient,
    settings: Settings,
    device_id: int,
    *,
    actor: str,
    client_ip: str | None = None,
) -> DeviceActionResponse:
    """Restore YouTube access for a single device."""
    dev = (
        await db.execute(select(Device).where(Device.id == device_id))
    ).scalar_one_or_none()
    if not dev:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device {device_id} not found.",
        )

    if dev.ipv4_address:
        try:
            await opnsense.remove_ip_from_youtube_block_alias(dev.ipv4_address)
        except (OPNsenseClientError, httpx.HTTPError) as exc:
            db.add(
                AuditLog(
                    actor=actor,
                    action="device.youtube_unblock",
                    target=f"{dev.mac_address} ({dev.ipv4_address})",
                    status="failed",
                    details=f"OPNsense YouTube alias remove failed: {exc}",
                )
            )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to remove IP from OPNsense YouTube block alias: {exc}",
            ) from exc

    dev.is_youtube_blocked = False
    dev.updated_at = utc_now()
    db.add(
        AuditLog(
            actor=actor,
            action="device.youtube_unblock",
            target=f"{dev.mac_address} ({dev.ipv4_address or 'no-ip'})",
            status="success",
            details="Device removed from OPNsense YouTube block alias.",
        )
    )
    await db.commit()
    await db.refresh(dev)
    badges = await _load_device_group_badges(db, device_id=dev.id)

    return DeviceActionResponse(
        device=build_device_response(dev, settings, client_ip, groups=badges.get(dev.id, [])),
        action="youtube_unblock",
        states_killed=False,
        warning=None,
    )
