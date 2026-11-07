"""SQLAlchemy declarative base and models for Phases 1–6."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

_HEX_MAC_RE = re.compile(r"^[0-9a-f]{12}$")
_TIME_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_PLACEHOLDER_HOSTNAMES = frozenset({"", "*", "?", "(none)", "none", "unknown"})
VALID_GROUP_COLORS = frozenset(
    {"indigo", "emerald", "amber", "rose", "cyan", "violet", "slate"}
)
VALID_OVERRIDE_MODES = frozenset({"pause", "bonus"})
VALID_OVERRIDE_TARGETS = frozenset({"device", "group"})
VALID_USER_ROLES = frozenset({"admin", "operator"})
VALID_USER_THEMES = frozenset({"default", "crimson", "ocean"})
VALID_AUDIT_LABELS = frozenset(
    {
        "AUTH_EVENT",
        "USER_MGMT",
        "SETTINGS_CHANGE",
        "DIAGNOSTIC_ERROR",
        "DEVICE_CONTROL",
        "YOUTUBE_CONTROL",
        "GROUP_CONTROL",
        "TIMER_OVERRIDE",
        "SCHEDULE_CHANGE",
        "CONFIG_BACKUP",
        "SYSTEM",
    }
)


def infer_audit_label(action: str, audit_label: str | None = None) -> str:
    """Resolve or infer a canonical `audit_label` badge category from an audit action."""
    if audit_label and audit_label.strip() and audit_label.strip().upper() != "SYSTEM":
        cleaned_label = audit_label.strip().upper()
        if cleaned_label in VALID_AUDIT_LABELS:
            return cleaned_label
    act = (action or "").strip().lower()
    if not act:
        return "SYSTEM"
    if act.startswith(("auth.", "login", "logout")):
        return "AUTH_EVENT"
    if act.startswith("user"):
        return "USER_MGMT"
    if act.startswith(("diagnostic", "upstream.")):
        return "DIAGNOSTIC_ERROR"
    if act.startswith("settings"):
        return "SETTINGS_CHANGE"
    if "youtube" in act:
        return "YOUTUBE_CONTROL"
    if act.startswith("device"):
        return "DEVICE_CONTROL"
    if act.startswith("group"):
        return "GROUP_CONTROL"
    if act.startswith("timer"):
        return "TIMER_OVERRIDE"
    if act.startswith("schedule"):
        return "SCHEDULE_CHANGE"
    if (
        act.startswith(("config", "backup", "restore"))
        or "restore" in act
        or "backup" in act
    ):
        return "CONFIG_BACKUP"
    return "SYSTEM"


def utc_now() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(UTC)


def normalize_group_color(color: str | None) -> str:
    """Validate and normalize a group badge color token."""
    if not color:
        return "indigo"
    cleaned = color.strip().lower()
    if cleaned not in VALID_GROUP_COLORS:
        raise ValueError(
            f"Unsupported group color '{color}'. Allowed: {sorted(VALID_GROUP_COLORS)}"
        )
    return cleaned


def normalize_override_mode(mode: str) -> str:
    """Validate and normalize a temporary override mode ('pause' or 'bonus')."""
    if not isinstance(mode, str):
        raise ValueError("Override mode must be a string.")
    cleaned = mode.strip().lower()
    if cleaned not in VALID_OVERRIDE_MODES:
        raise ValueError(
            f"Unsupported override mode '{mode}'. Allowed: {sorted(VALID_OVERRIDE_MODES)}"
        )
    return cleaned


def normalize_override_target_type(target_type: str) -> str:
    """Validate and normalize a temporary override or schedule target type ('device' or 'group')."""
    if not isinstance(target_type, str):
        raise ValueError("Override target_type must be a string.")
    cleaned = target_type.strip().lower()
    if cleaned not in VALID_OVERRIDE_TARGETS:
        allowed_targets = sorted(VALID_OVERRIDE_TARGETS)
        raise ValueError(
            f"Unsupported override target_type '{target_type}'. Allowed: {allowed_targets}"
        )
    return cleaned


def parse_days_of_week(days: str | list[int]) -> list[int]:
    """Validate and normalize days of week (0=Monday .. 6=Sunday) into a sorted unique list."""
    raw_items: list[int] = []
    if isinstance(days, str):
        parts = [p.strip() for p in days.split(",") if p.strip()]
        for part in parts:
            try:
                raw_items.append(int(part))
            except ValueError as exc:
                raise ValueError(f"Invalid day of week '{part}'. Expected 0..6.") from exc
    elif isinstance(days, list):
        for item in days:
            if isinstance(item, bool) or not isinstance(item, int):
                raise ValueError(f"Invalid day of week '{item}'. Expected integer 0..6.")
            raw_items.append(item)
    else:
        raise ValueError("days_of_week must be a comma-separated string or list of integers 0..6.")

    unique_days = sorted(set(raw_items))
    if not unique_days:
        raise ValueError("At least one day of the week (0..6) must be selected.")
    for day in unique_days:
        if day < 0 or day > 6:
            raise ValueError(f"Day of week {day} is out of range (must be 0=Mon .. 6=Sun).")
    return unique_days


def format_days_of_week(days: str | list[int]) -> str:
    """Format validated days of week into canonical comma-separated string ('0,1,2,3,6')."""
    return ",".join(str(d) for d in parse_days_of_week(days))


def validate_time_hhmm(time_str: str) -> str:
    """Validate a 24-hour 'HH:MM' time string ('00:00'..'23:59')."""
    if not isinstance(time_str, str):
        raise ValueError("Time must be a string in 'HH:MM' 24-hour format.")
    cleaned = time_str.strip()
    if not _TIME_HHMM_RE.match(cleaned):
        raise ValueError(
            f"Invalid time '{time_str}'. Must be 24-hour 'HH:MM' between 00:00 and 23:59."
        )
    return cleaned


def normalize_mac_address(mac: str) -> str:
    """Normalize a MAC address string to canonical lowercase colon format (aa:bb:cc:dd:ee:ff)."""
    if not isinstance(mac, str):
        raise ValueError("MAC address must be a string.")
    cleaned = re.sub(r"[:\-\.\s]", "", mac.strip().lower())
    if not _HEX_MAC_RE.match(cleaned):
        raise ValueError(f"Invalid MAC address format: '{mac}'")
    return ":".join(cleaned[i : i + 2] for i in range(0, 12, 2))


def clean_discovered_hostname(raw: str | None) -> str | None:
    """Strip OPNsense Dnsmasq/ARP placeholder hostnames such as '*' or empty strings."""
    if raw is None:
        return None
    stripped = raw.strip()
    if stripped.lower() in _PLACEHOLDER_HOSTNAMES:
        return None
    return stripped


class Base(DeclarativeBase):
    """Base declarative class for all SQLite models."""


class SystemMetadata(Base):
    """Key-value metadata store for schema/system state."""

    __tablename__ = "system_metadata"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class AuditLog(Base):
    """Audit trail of authentication and network access control actions."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    audit_label: Mapped[str] = mapped_column(
        String(32), nullable=False, default="SYSTEM", index=True
    )
    target: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="success")
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False, index=True
    )

    def __init__(self, **kwargs: Any) -> None:
        kwargs["audit_label"] = infer_audit_label(
            str(kwargs.get("action", "")),
            kwargs.get("audit_label"),
        )
        super().__init__(**kwargs)


class Device(Base):
    """Discovered network device persisted by normalized MAC address."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mac_address: Mapped[str] = mapped_column(
        String(17), unique=True, nullable=False, index=True
    )
    ipv4_address: Mapped[str | None] = mapped_column(String(45), nullable=True, index=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    interface_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_type: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    is_online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    is_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    is_manually_blocked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    is_youtube_blocked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    is_protected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class DeviceGroup(Base):
    """Named profile/group of network devices for bulk control and group analytics."""

    __tablename__ = "device_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    color_badge: Mapped[str] = mapped_column(String(32), nullable=False, default="indigo")
    icon: Mapped[str] = mapped_column(String(32), nullable=False, default="users")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class DeviceGroupMembership(Base):
    """Many-to-many association linking devices to device groups."""

    __tablename__ = "device_group_memberships"
    __table_args__ = (
        UniqueConstraint("group_id", "device_id", name="uq_device_group_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("device_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class TemporaryOverride(Base):
    """Timed temporary internet access override ('pause' or 'bonus') for a device or group."""

    __tablename__ = "temporary_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    device_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    group_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("device_groups.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="admin")
    reason: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class RecurringSchedule(Base):
    """Recurring weekly block schedule assignable to a single device or device group."""

    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    target_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    device_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    group_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("device_groups.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    days_of_week: Mapped[str] = mapped_column(String(32), nullable=False)
    start_time: Mapped[str] = mapped_column(String(8), nullable=False)
    end_time: Mapped[str] = mapped_column(String(8), nullable=False)
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="America/Los_Angeles"
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )



class User(Base):
    """Platform user account supporting multi-user RBAC ('admin' vs 'operator')."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(32), nullable=False, default="operator", index=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, index=True
    )
    theme_preference: Mapped[str] = mapped_column(
        String(32), nullable=False, default="default"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )


class SystemSetting(Base):
    """Runtime UI-configured integration settings overriding .env defaults."""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_secret: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_by: Mapped[str] = mapped_column(String(64), nullable=False, default="admin")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
