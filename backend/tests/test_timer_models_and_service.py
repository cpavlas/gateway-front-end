"""Unit tests for Phase 5 TemporaryOverride model and pure timer calculation helpers (Step 5.1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from freezegun import freeze_time
from sqlalchemy import select

from app.config import Settings
from app.db import get_session_factory
from app.models import (
    Device,
    DeviceGroup,
    TemporaryOverride,
    normalize_override_mode,
    normalize_override_target_type,
)
from app.services.timer_service import (
    TimerStartRequest,
    _build_override_maps_from_entities,
    _build_timer_list_response,
    _create_override_and_audit_objects,
    _finalize_cancelled_override,
    build_active_override_maps,
    build_override_info,
    calculate_override_expiry,
    compute_remaining_seconds,
    ensure_utc,
    mark_overrides_cancelled,
    resolve_timezone,
    select_expired_overrides,
    validate_timer_start_payload,
)


def test_normalize_override_mode_and_target_type() -> None:
    """Verify validation and normalization of override mode and target_type."""
    assert normalize_override_mode("PAUSE") == "pause"
    assert normalize_override_mode(" bonus ") == "bonus"
    with pytest.raises(ValueError, match="Unsupported override mode"):
        normalize_override_mode("forever")
    with pytest.raises(ValueError, match="must be a string"):
        normalize_override_mode(123)  # type: ignore[arg-type]

    assert normalize_override_target_type("DEVICE") == "device"
    assert normalize_override_target_type(" group ") == "group"
    with pytest.raises(ValueError, match="Unsupported override target_type"):
        normalize_override_target_type("network")
    with pytest.raises(ValueError, match="must be a string"):
        normalize_override_target_type(None)  # type: ignore[arg-type]


def test_ensure_utc_and_resolve_timezone() -> None:
    """Verify naive datetime coercion to UTC and safe timezone fallback."""
    naive = datetime(2026, 10, 31, 12, 0, 0)
    aware = ensure_utc(naive)
    assert aware.tzinfo == UTC
    assert aware.hour == 12

    assert resolve_timezone(None).key == "UTC"
    assert resolve_timezone("Invalid/Zone_Name").key == "UTC"
    assert resolve_timezone("America/Los_Angeles").key == "America/Los_Angeles"


@freeze_time("2026-10-31 20:00:00+00:00")
def test_calculate_override_expiry_presets_and_minutes() -> None:
    """Verify preset durations (15m, 30m, 1h, 2h, 4h) and explicit duration_minutes."""
    now = datetime(2026, 10, 31, 20, 0, 0, tzinfo=UTC)

    exp_30, mins_30 = calculate_override_expiry(now, preset="30m")
    assert mins_30 == 30
    assert exp_30 == datetime(2026, 10, 31, 20, 30, 0, tzinfo=UTC)

    exp_custom, mins_custom = calculate_override_expiry(now, duration_minutes=45)
    assert mins_custom == 45
    assert exp_custom == datetime(2026, 10, 31, 20, 45, 0, tzinfo=UTC)

    with pytest.raises(ValueError, match="Unsupported timer preset"):
        calculate_override_expiry(now, preset="99h")

    with pytest.raises(ValueError, match="Either 'duration_minutes' or 'preset'"):
        calculate_override_expiry(now)

    with pytest.raises(ValueError, match="between 1 and 1440"):
        calculate_override_expiry(now, duration_minutes=0)


def test_calculate_override_expiry_until_tomorrow_0700() -> None:
    """Verify 'until_tomorrow_0700' preset across evening and post-midnight local times."""
    # Case 1: 2026-10-20 21:00 PDT (UTC-7 -> 2026-10-21 04:00 UTC) -> next 07:00 PDT is +600m
    evening_utc = datetime(2026, 10, 21, 4, 0, 0, tzinfo=UTC)
    exp_utc, mins = calculate_override_expiry(
        evening_utc,
        preset="until_tomorrow_0700",
        tz_name="America/Los_Angeles",
    )
    assert mins == 600
    assert exp_utc == datetime(2026, 10, 21, 14, 0, 0, tzinfo=UTC)

    # Case 2: 2026-10-21 01:30 PDT (UTC-7 -> 2026-10-21 08:30 UTC) -> next 07:00 PDT is +330m
    early_morning_utc = datetime(2026, 10, 21, 8, 30, 0, tzinfo=UTC)
    exp_utc_2, mins_2 = calculate_override_expiry(
        early_morning_utc,
        preset="until_morning",
        tz_name="America/Los_Angeles",
    )
    assert mins_2 == 330
    assert exp_utc_2 == datetime(2026, 10, 21, 14, 0, 0, tzinfo=UTC)


def test_build_override_maps_and_select_expired() -> None:
    """Verify active override map partitioning, remaining seconds, and expired selection."""
    now = datetime(2026, 10, 31, 20, 0, 0, tzinfo=UTC)
    active_dev_ov = TemporaryOverride(
        id=1,
        target_type="device",
        device_id=10,
        group_id=None,
        mode="pause",
        duration_minutes=30,
        created_by="admin",
        reason="Homework",
        is_active=True,
        created_at=now - timedelta(minutes=10),
        expires_at=now + timedelta(minutes=20),
    )
    active_grp_ov = TemporaryOverride(
        id=2,
        target_type="group",
        device_id=None,
        group_id=5,
        mode="bonus",
        duration_minutes=15,
        created_by="admin",
        reason="Movie night",
        is_active=True,
        created_at=now - timedelta(minutes=5),
        expires_at=now + timedelta(minutes=10),
    )
    expired_ov = TemporaryOverride(
        id=3,
        target_type="device",
        device_id=11,
        group_id=None,
        mode="pause",
        duration_minutes=15,
        created_by="admin",
        reason="",
        is_active=True,
        created_at=now - timedelta(minutes=20),
        expires_at=now - timedelta(minutes=5),
    )
    inactive_ov = TemporaryOverride(
        id=4,
        target_type="device",
        device_id=12,
        group_id=None,
        mode="pause",
        duration_minutes=15,
        created_by="admin",
        reason="",
        is_active=False,
        created_at=now - timedelta(minutes=10),
        expires_at=now + timedelta(minutes=5),
    )

    by_dev, by_grp = build_active_override_maps(
        [active_dev_ov, active_grp_ov, expired_ov, inactive_ov],
        device_names={10: "Kids iPad"},
        group_names={5: "Kids Profile"},
        now_utc=now,
    )
    assert set(by_dev.keys()) == {10}
    assert by_dev[10].target_name == "Kids iPad"
    assert by_dev[10].remaining_seconds == 1200

    assert set(by_grp.keys()) == {5}
    assert by_grp[5].target_name == "Kids Profile"
    assert by_grp[5].mode == "bonus"
    assert by_grp[5].remaining_seconds == 600

    expired_list = select_expired_overrides(
        [active_dev_ov, active_grp_ov, expired_ov, inactive_ov], now_utc=now
    )
    assert [o.id for o in expired_list] == [3]

    cancelled_count = mark_overrides_cancelled([active_dev_ov, inactive_ov], now_utc=now)
    assert cancelled_count == 1
    assert active_dev_ov.is_active is False
    assert active_dev_ov.cancelled_at == now


def test_validate_timer_start_payload() -> None:
    """Verify TimerStartRequest validation and HTTP 400 on invalid preset."""
    now = datetime(2026, 10, 31, 20, 0, 0, tzinfo=UTC)
    req = TimerStartRequest(mode="pause", preset="1h", reason="  Dinner  ")
    mode, exp, mins, reason = validate_timer_start_payload(req, "UTC", now)
    assert mode == "pause"
    assert mins == 60
    assert exp == now + timedelta(minutes=60)
    assert reason == "Dinner"

    bad_req = TimerStartRequest(mode="pause", preset="invalid_preset")
    with pytest.raises(HTTPException) as exc_info:
        validate_timer_start_payload(bad_req, "UTC", now)
    assert exc_info.value.status_code == 400


def test_sync_entity_override_helpers() -> None:
    """Verify synchronous entity override builders for 100% sys.monitoring coverage."""
    now = datetime(2026, 10, 31, 20, 0, 0, tzinfo=UTC)
    dev = Device(
        id=10,
        mac_address="aa:bb:cc:00:00:10",
        ipv4_address="192.168.50.10",
        display_name="Tablet",
        lease_type="dynamic",
    )
    grp = DeviceGroup(id=5, name="Family", description="", color_badge="indigo", icon="users")
    ov_dev, audit_dev = _create_override_and_audit_objects(
        target_type="device",
        device_id=10,
        group_id=None,
        target_label="Tablet (192.168.50.10)",
        mode="pause",
        minutes=30,
        actor="admin",
        reason="Bedtime",
        now_aware=now,
        expires_utc=now + timedelta(minutes=30),
    )
    ov_dev.id = 100
    assert audit_dev.action == "timer.device.pause"

    by_dev, by_grp = _build_override_maps_from_entities([ov_dev], [dev], [grp], now_utc=now)
    timer_list = _build_timer_list_response(by_dev, by_grp)
    assert len(timer_list.timers) == 1
    assert timer_list.timers[0].target_name == "Tablet"

    cancel_audit, cancel_resp = _finalize_cancelled_override(
        ov_dev,
        actor="admin",
        reverted=True,
        warnings=["warn1"],
        now_aware=now,
    )
    assert cancel_audit.action == "timer.cancel"
    assert cancel_resp.cancelled_override_id == 100
    assert cancel_resp.reverted_state is True
    assert cancel_resp.warnings == ["warn1"]


@pytest.mark.asyncio
async def test_temporary_override_orm_cascade_delete(
    initialized_db: Settings,
) -> None:
    """Verify TemporaryOverride persistence and ON DELETE CASCADE for Device and DeviceGroup."""
    session_factory = get_session_factory(initialized_db)
    now = datetime(2026, 10, 31, 20, 0, 0, tzinfo=UTC)

    async with session_factory() as session:
        dev = Device(
            mac_address="aa:bb:cc:00:11:22",
            ipv4_address="192.168.50.88",
            hostname="gaming-pc",
            lease_type="dynamic",
        )
        grp = DeviceGroup(
            name="Gaming Devices",
            description="Test cascade",
            color_badge="indigo",
            icon="gamepad",
        )
        session.add_all([dev, grp])
        await session.flush()

        ov_dev = TemporaryOverride(
            target_type="device",
            device_id=dev.id,
            mode="pause",
            duration_minutes=30,
            created_by="admin",
            is_active=True,
            created_at=now,
            expires_at=now + timedelta(minutes=30),
        )
        ov_grp = TemporaryOverride(
            target_type="group",
            group_id=grp.id,
            mode="bonus",
            duration_minutes=60,
            created_by="admin",
            is_active=True,
            created_at=now,
            expires_at=now + timedelta(minutes=60),
        )
        session.add_all([ov_dev, ov_grp])
        await session.commit()

        info = build_override_info(ov_dev, target_name="gaming-pc", now_utc=now)
        assert info.remaining_seconds == 1800
        assert compute_remaining_seconds(ov_dev.expires_at, now + timedelta(minutes=45)) == 0

        await session.delete(dev)
        await session.delete(grp)
        await session.commit()

        remaining_rows = (
            await session.execute(select(TemporaryOverride))
        ).scalars().all()
        assert len(remaining_rows) == 0

