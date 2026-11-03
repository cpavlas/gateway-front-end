"""Unit tests for Phase 6 RecurringSchedule models, 5-tier policy evaluator & SQLite volume fix."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.models import (
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    RecurringSchedule,
    format_days_of_week,
    parse_days_of_week,
    validate_time_hhmm,
)
from app.services.schedule_service import (
    ActiveScheduleInfo,
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
    build_active_schedule_maps,
    create_schedule,
    delete_schedule,
    evaluate_device_effective_policy,
    is_schedule_window_active,
    list_schedules,
    plan_policy_and_ip_drift_actions,
    reconcile_schedules_and_policies,
    toggle_schedule,
    update_schedule,
    validate_schedule_payload,
)
from app.services.timer_service import ActiveOverrideInfo


def test_sqlite_db_path_resolves_into_database_url(test_settings: Settings) -> None:
    """FB-P5-010: Setting SQLITE_DB_PATH binds database_url to the persistent volume path."""
    s1 = Settings(
        app_secret_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        admin_password="test-password-123",
        opnsense_api_key="k",
        opnsense_api_secret="s",
        elasticsearch_api_key="e",
        sqlite_db_path="/app/data/gateway.db",
    )
    assert s1.database_url == "sqlite+aiosqlite:////app/data/gateway.db"

    # Explicit custom database_url is preserved even if sqlite_db_path is set
    s2 = Settings(
        app_secret_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        admin_password="test-password-123",
        opnsense_api_key="k",
        opnsense_api_secret="s",
        elasticsearch_api_key="e",
        database_url="sqlite+aiosqlite:///custom.db",
        sqlite_db_path="/app/data/gateway.db",
    )
    assert s2.database_url == "sqlite+aiosqlite:///custom.db"


def test_schedule_validation_helpers_and_errors() -> None:
    """parse_days_of_week, validate_time_hhmm, and validate_schedule_payload validate inputs."""
    assert parse_days_of_week("6, 0, 1, 2, 3, 0") == [0, 1, 2, 3, 6]
    assert parse_days_of_week([4, 5]) == [4, 5]
    assert format_days_of_week([6, 0, 2]) == "0,2,6"
    assert validate_time_hhmm(" 21:05 ") == "21:05"
    assert validate_time_hhmm("00:00") == "00:00"

    with pytest.raises(ValueError, match="At least one day"):
        parse_days_of_week([])
    with pytest.raises(ValueError, match="out of range"):
        parse_days_of_week([0, 7])
    with pytest.raises(ValueError, match="Invalid day"):
        parse_days_of_week("mon,tue")
    with pytest.raises(ValueError, match="Expected integer"):
        parse_days_of_week([True])  # type: ignore[list-item]
    with pytest.raises(ValueError, match="Invalid time"):
        validate_time_hhmm("25:00")
    with pytest.raises(ValueError, match="Invalid time"):
        validate_time_hhmm("9:00")

    with pytest.raises(HTTPException) as exc1:
        validate_schedule_payload("  ", "device", 1, None, [0], "21:00", "07:00", "UTC")
    assert exc1.value.status_code == 422

    with pytest.raises(HTTPException) as exc2:
        validate_schedule_payload("Bedtime", "device", None, None, [0], "21:00", "07:00", "UTC")
    assert exc2.value.status_code == 422

    with pytest.raises(HTTPException) as exc3:
        validate_schedule_payload("Bedtime", "group", None, None, [0], "21:00", "07:00", "UTC")
    assert exc3.value.status_code == 422

    with pytest.raises(HTTPException) as exc4:
        validate_schedule_payload(
            "Bedtime", "device", 1, None, [0], "21:00", "07:00", "Not/AZone"
        )
    assert exc4.value.status_code == 422


def test_is_schedule_window_active_same_day_overnight_and_dst() -> None:
    """Verify same-day, overnight midnight-spanning, and 24h windows across days of week."""
    # School Nights: Sun(6), Mon(0), Tue(1), Wed(2), Thu(3) from 21:00 -> 07:00 America/Los_Angeles
    school_nights = [0, 1, 2, 3, 6]

    # 1. Thursday 2026-10-29 22:30 PDT (UTC-7 -> 2026-10-30 05:30 UTC): Active (Thu evening)
    thu_evening_utc = datetime(2026, 10, 30, 5, 30, tzinfo=UTC)
    assert is_schedule_window_active(
        school_nights, "21:00", "07:00", "America/Los_Angeles", now_utc=thu_evening_utc
    ) is True

    # 2. Friday 2026-10-30 06:15 PDT (2026-10-30 13:15 UTC): Active! (Yesterday was Thu=3)
    fri_morning_utc = datetime(2026, 10, 30, 13, 15, tzinfo=UTC)
    assert is_schedule_window_active(
        school_nights, "21:00", "07:00", "America/Los_Angeles", now_utc=fri_morning_utc
    ) is True

    # 3. Friday 2026-10-30 07:00 PDT (2026-10-30 14:00 UTC): Inactive (Window ended at 07:00)
    fri_0700_utc = datetime(2026, 10, 30, 14, 0, tzinfo=UTC)
    assert is_schedule_window_active(
        school_nights, "21:00", "07:00", "America/Los_Angeles", now_utc=fri_0700_utc
    ) is False

    # 4. Friday 2026-10-30 22:30 PDT (2026-10-31 05:30 UTC): Inactive (Fri=4 not in school_nights)
    fri_evening_utc = datetime(2026, 10, 31, 5, 30, tzinfo=UTC)
    assert is_schedule_window_active(
        school_nights, "21:00", "07:00", "America/Los_Angeles", now_utc=fri_evening_utc
    ) is False

    # 5. Saturday 2026-10-31 02:00 PDT (2026-10-31 09:00 UTC): Inactive (Yesterday was Fri=4)
    sat_morning_utc = datetime(2026, 10, 31, 9, 0, tzinfo=UTC)
    assert is_schedule_window_active(
        school_nights, "21:00", "07:00", "America/Los_Angeles", now_utc=sat_morning_utc
    ) is False

    # 6. Same-day window (15:00 -> 17:00 on Friday=4)
    fri_1600_utc = datetime(2026, 10, 30, 23, 0, tzinfo=UTC)  # 16:00 PDT Friday
    assert is_schedule_window_active(
        [4], "15:00", "17:00", "America/Los_Angeles", now_utc=fri_1600_utc
    ) is True

    # 7. Full-day 24h window (00:00 -> 00:00 on Friday=4)
    assert is_schedule_window_active(
        [4], "00:00", "00:00", "America/Los_Angeles", now_utc=fri_1600_utc
    ) is True


def test_five_tier_policy_precedence_matrix() -> None:
    """Verify the complete 5-tier policy precedence matrix across all combinations."""
    protected_ips = frozenset({"192.168.1.1", "192.168.1.5"})

    active_sched = ActiveScheduleInfo(
        schedule_id=1,
        name="School Night Bedtime",
        target_type="group",
        target_id=2,
        target_name="Kids Devices",
        start_time="21:00",
        end_time="07:00",
        timezone="America/Los_Angeles",
    )
    bonus_timer = ActiveOverrideInfo(
        id=10,
        target_type="device",
        device_id=1,
        mode="bonus",
        duration_minutes=40,
        created_by="admin",
        created_at="2026-11-01T05:20:00+00:00",
        expires_at="2026-11-01T06:00:00+00:00",
        remaining_seconds=1800,
        is_active=True,
    )
    pause_timer = ActiveOverrideInfo(
        id=11,
        target_type="device",
        device_id=1,
        mode="pause",
        duration_minutes=30,
        created_by="admin",
        created_at="2026-11-01T05:30:00+00:00",
        expires_at="2026-11-01T06:00:00+00:00",
        remaining_seconds=1200,
        is_active=True,
    )

    dev = Device(
        id=1,
        mac_address="aa:bb:cc:dd:ee:01",
        ipv4_address="192.168.1.101",
        is_blocked=False,
        is_manually_blocked=False,
        is_protected=False,
    )

    # Tier 5: Default allowed
    d5 = evaluate_device_effective_policy(dev, protected_ips, None, None)
    assert d5.should_be_blocked is False
    assert d5.reason == "default_allowed"

    # Tier 4: Active schedule blocks device
    d4 = evaluate_device_effective_policy(dev, protected_ips, None, active_sched)
    assert d4.should_be_blocked is True
    assert d4.reason == "schedule_block"

    # Tier 3: Manual block overrides inactive schedule
    dev.is_manually_blocked = True
    d3 = evaluate_device_effective_policy(dev, protected_ips, None, None)
    assert d3.should_be_blocked is True
    assert d3.reason == "manual_block"

    # Tier 2a: Bonus timer grants access even during active schedule + manual block!
    d2_bonus = evaluate_device_effective_policy(
        dev, protected_ips, bonus_timer, active_sched
    )
    assert d2_bonus.should_be_blocked is False
    assert d2_bonus.reason == "bonus_timer"

    # Tier 2b: Pause timer blocks even when manual_block=False and schedule=None
    dev.is_manually_blocked = False
    d2_pause = evaluate_device_effective_policy(dev, protected_ips, pause_timer, None)
    assert d2_pause.should_be_blocked is True
    assert d2_pause.reason == "pause_timer"

    # Tier 1: Protected flag or protected IP always allows internet
    dev.is_protected = True
    d1 = evaluate_device_effective_policy(
        dev, protected_ips, pause_timer, active_sched
    )
    assert d1.should_be_blocked is False
    assert d1.reason == "protected"


def test_plan_policy_and_dhcp_ip_drift_actions() -> None:
    """Verify DHCP IP drift detection swaps old blocked IP for new IP in OPNsense alias."""
    protected_ips = frozenset({"192.168.1.1"})
    # Device #1 was blocked at 192.168.1.200, but Dnsmasq gave it a new IP 192.168.1.205
    dev1 = Device(
        id=1,
        mac_address="aa:bb:cc:dd:ee:10",
        ipv4_address="192.168.1.205",
        is_blocked=True,
        is_manually_blocked=True,
        is_protected=False,
    )
    # Device #2 was blocked by schedule, now schedule ended -> should be unblocked
    dev2 = Device(
        id=2,
        mac_address="aa:bb:cc:dd:ee:20",
        ipv4_address="192.168.1.210",
        is_blocked=True,
        is_manually_blocked=False,
        is_protected=False,
    )
    decisions = {
        1: evaluate_device_effective_policy(dev1, protected_ips, None, None),
        2: evaluate_device_effective_policy(dev2, protected_ips, None, None),
    }
    current_alias_ips = {"192.168.1.200", "192.168.1.210"}

    to_block, to_unblock, drift_ips = plan_policy_and_ip_drift_actions(
        [dev1, dev2], decisions, current_alias_ips, protected_ips
    )
    assert [d.ipv4_address for d, _ in to_block] == ["192.168.1.205"]
    assert [d.ipv4_address for d, _ in to_unblock] == ["192.168.1.210"]
    assert drift_ips == ["192.168.1.200"]


async def test_schedule_crud_and_policy_reconciliation_lifecycle(
    initialized_db: object, test_settings: Settings
) -> None:
    """Create, update, toggle, list, and delete schedules with OPNsense policy enforcement."""
    from app.db import get_session_factory

    factory = get_session_factory(test_settings)
    mock_opnsense = AsyncMock()
    mock_opnsense.list_blocked_alias_ips.return_value = []
    mock_opnsense.add_ip_to_block_alias.return_value = ["192.168.1.150"]
    mock_opnsense.kill_states_for_ip.return_value = {"result": "ok"}
    mock_opnsense.remove_ip_from_block_alias.return_value = []

    async with factory() as db:
        dev = Device(
            mac_address="aa:bb:cc:00:11:22",
            ipv4_address="192.168.1.150",
            display_name="Kids Tablet",
            is_online=True,
            is_blocked=False,
            is_manually_blocked=False,
            is_protected=False,
        )
        grp = DeviceGroup(name="Kids Profile", color_badge="indigo", icon="users")
        db.add_all([dev, grp])
        await db.commit()
        await db.refresh(dev)
        await db.refresh(grp)
        db.add(DeviceGroupMembership(group_id=grp.id, device_id=dev.id))
        await db.commit()

        # Create a 24h every-day schedule on the group -> immediately active!
        created = await create_schedule(
            db,
            mock_opnsense,
            test_settings,
            ScheduleCreateRequest(
                name="All Day Study Mode",
                description="Block during study",
                target_type="group",
                group_id=grp.id,
                days_of_week=[0, 1, 2, 3, 4, 5, 6],
                start_time="00:00",
                end_time="00:00",
                timezone="America/Los_Angeles",
                is_enabled=True,
            ),
        )
        assert created.name == "All Day Study Mode"
        assert created.is_active_now is True
        assert created.target_name == "Kids Profile"

        await db.refresh(dev)
        assert dev.is_blocked is True

        # Update schedule to device target
        updated = await update_schedule(
            db,
            mock_opnsense,
            test_settings,
            created.id,
            ScheduleUpdateRequest(
                name="Tablet Bedtime",
                description="Updated",
                target_type="device",
                device_id=dev.id,
                days_of_week=[0, 1, 2, 3, 4, 5, 6],
                start_time="00:00",
                end_time="00:00",
                timezone="America/Los_Angeles",
                is_enabled=True,
            ),
        )
        assert updated.target_type == "device"
        assert updated.target_name == "Kids Tablet"

        # Toggle schedule off -> device should automatically unblock!
        mock_opnsense.list_blocked_alias_ips.return_value = ["192.168.1.150"]
        toggled = await toggle_schedule(
            db, mock_opnsense, test_settings, created.id, is_enabled=False
        )
        assert toggled.is_enabled is False
        assert toggled.is_active_now is False
        await db.refresh(dev)
        assert dev.is_blocked is False

        listed = await list_schedules(db)
        assert len(listed.schedules) == 1

        # Delete schedule
        await delete_schedule(db, mock_opnsense, test_settings, created.id)
        listed_after = await list_schedules(db)
        assert len(listed_after.schedules) == 0

        # Also verify build_active_schedule_maps priority (device schedule over group schedule)
        s_dev = RecurringSchedule(
            id=1,
            name="Device Rule",
            target_type="device",
            device_id=dev.id,
            days_of_week="0,1,2,3,4,5,6",
            start_time="00:00",
            end_time="00:00",
            timezone="UTC",
            is_enabled=True,
        )
        s_grp = RecurringSchedule(
            id=2,
            name="Group Rule",
            target_type="group",
            group_id=grp.id,
            days_of_week="0,1,2,3,4,5,6",
            start_time="00:00",
            end_time="00:00",
            timezone="UTC",
            is_enabled=True,
        )
        d_map, g_map = build_active_schedule_maps(
            [s_dev, s_grp],
            {dev.id: "Kids Tablet"},
            {grp.id: "Kids Profile"},
            {grp.id: [dev.id]},
        )
        assert d_map[dev.id].name == "Device Rule"
        assert g_map[grp.id].name == "Group Rule"

        # Verify reconcile_schedules_and_policies cleans up drifted IPs
        mock_opnsense.list_blocked_alias_ips.return_value = ["192.168.1.250"]
        rec_summary = await reconcile_schedules_and_policies(
            db, mock_opnsense, test_settings
        )
        assert rec_summary.ip_drift_swaps == ["192.168.1.250"]
