"""SQLAlchemy declarative base and models for Phases 1–4."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

_HEX_MAC_RE = re.compile(r"^[0-9a-f]{12}$")
_PLACEHOLDER_HOSTNAMES = frozenset({"", "*", "?", "(none)", "none", "unknown"})
VALID_GROUP_COLORS = frozenset(
    {"indigo", "emerald", "amber", "rose", "cyan", "violet", "slate"}
)


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
    target: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="success")
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False, index=True
    )


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
