"""Unit tests for the SQLite Device model and MAC/hostname normalization (Step 2.1)."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db import get_session_factory
from app.models import Device, clean_discovered_hostname, normalize_mac_address


@pytest.mark.parametrize(
    ("raw_mac", "expected"),
    [
        ("AA:BB:CC:DD:EE:FF", "aa:bb:cc:dd:ee:ff"),
        ("aa-bb-cc-dd-ee-ff", "aa:bb:cc:dd:ee:ff"),
        ("aabb.ccdd.eeff", "aa:bb:cc:dd:ee:ff"),
        ("  001122334455  ", "00:11:22:33:44:55"),
    ],
)
def test_normalize_mac_address_valid_formats(raw_mac: str, expected: str) -> None:
    """normalize_mac_address converts common delimiter styles to canonical colon format."""
    assert normalize_mac_address(raw_mac) == expected


@pytest.mark.parametrize(
    "invalid_mac",
    [
        "",
        "not-a-mac",
        "aa:bb:cc:dd:ee",
        "aa:bb:cc:dd:ee:ff:00",
        "gg:hh:ii:jj:kk:ll",
    ],
)
def test_normalize_mac_address_rejects_invalid_strings(invalid_mac: str) -> None:
    """normalize_mac_address raises ValueError on malformed MAC strings."""
    with pytest.raises(ValueError, match="Invalid MAC address"):
        normalize_mac_address(invalid_mac)


def test_normalize_mac_address_rejects_non_string() -> None:
    """normalize_mac_address raises ValueError when passed a non-string."""
    with pytest.raises(ValueError, match="must be a string"):
        normalize_mac_address(None)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("raw_hostname", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("*", None),
        (" * ", None),
        ("?", None),
        ("(none)", None),
        ("unknown", None),
        ("livingroom-appletv", "livingroom-appletv"),
        ("  iphone-16.local  ", "iphone-16.local"),
    ],
)
def test_clean_discovered_hostname_strips_placeholders(
    raw_hostname: str | None, expected: str | None
) -> None:
    """clean_discovered_hostname strips Dnsmasq '*' and empty placeholders (Waterfall Update 2A)."""
    assert clean_discovered_hostname(raw_hostname) == expected


@pytest.mark.asyncio
async def test_device_model_crud_and_unique_mac_constraint(
    initialized_db: Settings,
) -> None:
    """Verify Device persistence, default flags, and unique mac_address constraint in SQLite."""
    factory = get_session_factory(initialized_db)

    async with factory() as session:
        device = Device(
            mac_address=normalize_mac_address("AA:BB:CC:11:22:33"),
            ipv4_address="192.168.1.25",
            hostname=clean_discovered_hostname("kids-ipad"),
            display_name="Kids iPad",
            vendor="Apple, Inc.",
            interface_name="LAN",
            lease_type="dynamic",
            is_online=True,
        )
        session.add(device)
        await session.commit()
        await session.refresh(device)

        assert device.id is not None
        assert device.mac_address == "aa:bb:cc:11:22:33"
        assert device.is_blocked is False
        assert device.is_protected is False
        assert device.notes == ""
        assert device.first_seen_at is not None

    # Verify duplicate MAC address raises IntegrityError
    async with factory() as session:
        duplicate = Device(
            mac_address="aa:bb:cc:11:22:33",
            ipv4_address="192.168.1.99",
        )
        session.add(duplicate)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    # Verify querying and updating display_name across DHCP IP change
    async with factory() as session:
        stmt = select(Device).where(Device.mac_address == "aa:bb:cc:11:22:33")
        fetched = (await session.execute(stmt)).scalar_one()
        fetched.ipv4_address = "192.168.1.42"
        await session.commit()

    async with factory() as session:
        stmt = select(Device).where(Device.mac_address == "aa:bb:cc:11:22:33")
        updated = (await session.execute(stmt)).scalar_one()
        assert updated.ipv4_address == "192.168.1.42"
        assert updated.display_name == "Kids iPad"
