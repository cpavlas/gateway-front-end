"""Unit and API integration tests for Phase 17 (device archive/delete & schedule enhancements)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select, text

from app.config import Settings
from app.db import get_engine, get_session_factory, init_db
from app.models import Device, DeviceGroup, DeviceGroupMembership, RecurringSchedule
from app.services.audit_and_backup_service import (
    ConfigBackupDeviceItem,
    ConfigBackupScheduleItem,
    assemble_backup_payload,
    prepare_restored_devices,
    prepare_restored_schedules,
)
from app.services.device_service import (
    DeviceUpdateRequest,
    _apply_device_metadata_updates,
    _filter_and_summarize_devices,
    _validate_device_blockable,
    apply_device_archive_mutation,
    build_device_group_badge_map,
    build_device_response,
    build_device_update_audit,
    prepare_device_delete_audit,
    validate_and_build_device_group_memberships,
    validate_device_archive,
    validate_device_delete,
)
from app.services.group_service import (
    _assemble_group_analytics_response,
    _build_empty_group_analytics_response,
    _require_group_or_404,
    assemble_group_responses,
    build_group_response,
    compute_group_access_status,
    compute_group_youtube_status,
    plan_group_bulk_action,
)
from app.services.schedule_service import (
    ActiveScheduleInfo,
    ScheduleSnoozeRequest,
    ScheduleUpdateRequest,
    apply_schedule_snooze_mutation,
    apply_schedule_update_orm,
    build_active_schedule_maps,
    build_cloned_schedule_row,
    compute_snooze_until,
    evaluate_device_effective_policy,
    is_schedule_snoozed,
    is_schedule_window_active,
    normalize_schedule_block_mode,
    plan_youtube_schedule_actions,
    prepare_schedule_update_params,
    validate_schedule_payload,
)
from app.services.timer_service import ActiveOverrideInfo


def _mock_opnsense_with_youtube(router: respx.MockRouter, base_url: str) -> None:
    """Register standard OPNsense internet + YouTube alias mocks."""
    for alias_name in ("gateway_blocked_devices", "gateway_youtube_blocked_devices"):
        router.get(f"{base_url}/api/firewall/alias_util/list/{alias_name}").mock(
            return_value=httpx.Response(200, json={"rows": []})
        )
        router.post(f"{base_url}/api/firewall/alias_util/add/{alias_name}").mock(
            return_value=httpx.Response(200, json={"status": "done"})
        )
        router.post(f"{base_url}/api/firewall/alias_util/delete/{alias_name}").mock(
            return_value=httpx.Response(200, json={"status": "done"})
        )
    router.post(f"{base_url}/api/diagnostics/firewall/kill_states").mock(
        return_value=httpx.Response(200, json={"result": "ok", "dropped": 0})
    )


async def _login_admin(client: AsyncClient, settings: Settings) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "username": settings.admin_username,
            "password": settings.admin_password.get_secret_value(),
        },
    )
    assert resp.status_code == 200


def test_pure_device_archive_delete_and_schedule_snooze_helpers(
    test_settings: Settings,
) -> None:
    """Pure helpers validate archive/delete constraints, snooze math, and block_mode policy."""
    validate_device_archive(False)
    with pytest.raises(HTTPException) as exc_arch:
        validate_device_archive(True)
    assert exc_arch.value.status_code == 400

    validate_device_delete(False, False)
    with pytest.raises(HTTPException) as exc_del_on:
        validate_device_delete(True, False)
    assert exc_del_on.value.status_code == 400
    with pytest.raises(HTTPException) as exc_del_prot:
        validate_device_delete(False, True)
    assert exc_del_prot.value.status_code == 400

    assert normalize_schedule_block_mode("youtube") == "youtube"
    assert normalize_schedule_block_mode("INTERNET") == "internet"
    assert normalize_schedule_block_mode(None) == "internet"

    ref = datetime(2026, 11, 14, 18, 0, tzinfo=UTC)
    assert is_schedule_snoozed(None, now_utc=ref) is False
    assert is_schedule_snoozed(datetime(2026, 11, 14, 17, 59), now_utc=ref) is False
    assert is_schedule_snoozed(datetime(2026, 11, 14, 18, 30), now_utc=ref) is True

    snoozed_1h = compute_snooze_until("23:00", "UTC", 60, False, now_utc=ref)
    assert snoozed_1h == ref + timedelta(minutes=60)

    snoozed_window = compute_snooze_until("23:00", "UTC", None, True, now_utc=ref)
    assert snoozed_window == datetime(2026, 11, 14, 23, 0, tzinfo=UTC)

    now_ts = ref
    dev_active = Device(
        id=1,
        mac_address="aa:bb:cc:00:00:01",
        ipv4_address="192.168.1.50",
        hostname="ipad",
        is_online=True,
        is_blocked=False,
        is_protected=False,
        is_archived=False,
        first_seen_at=now_ts,
        last_seen_at=now_ts,
        updated_at=now_ts,
    )
    dev_archived = Device(
        id=2,
        mac_address="aa:bb:cc:00:00:02",
        ipv4_address="192.168.1.51",
        hostname="old-phone",
        is_online=False,
        is_blocked=False,
        is_protected=False,
        is_archived=True,
        first_seen_at=now_ts,
        last_seen_at=now_ts,
        updated_at=now_ts,
    )

    default_resp = _filter_and_summarize_devices(
        [dev_active, dev_archived], test_settings, status_filter="all"
    )
    assert default_resp.summary.total_devices == 1
    assert default_resp.summary.archived_devices == 1
    assert [d.id for d in default_resp.devices] == [1]

    archived_resp = _filter_and_summarize_devices(
        [dev_active, dev_archived], test_settings, status_filter="archived"
    )
    assert [d.id for d in archived_resp.devices] == [2]

    yt_sched = RecurringSchedule(
        id=10,
        name="YouTube Focus",
        description="",
        target_type="device",
        device_id=1,
        group_id=None,
        block_mode="youtube",
        days_of_week="0,1,2,3,4,5,6",
        start_time="00:00",
        end_time="23:59",
        timezone="UTC",
        is_enabled=True,
        snoozed_until=None,
    )
    snoozed_sched = RecurringSchedule(
        id=11,
        name="Snoozed Rule",
        description="",
        target_type="device",
        device_id=1,
        group_id=None,
        block_mode="internet",
        days_of_week="0,1,2,3,4,5,6",
        start_time="00:00",
        end_time="23:59",
        timezone="UTC",
        is_enabled=True,
        snoozed_until=ref + timedelta(hours=2),
    )

    dev_map, _ = build_active_schedule_maps(
        [yt_sched, snoozed_sched], {1: "ipad"}, {}, {}, now_utc=ref
    )
    assert dev_map[1].schedule_id == 10
    assert dev_map[1].block_mode == "youtube"

    internet_only_map, _ = build_active_schedule_maps(
        [yt_sched, snoozed_sched],
        {1: "ipad"},
        {},
        {},
        now_utc=ref,
        mode_filter="internet",
    )
    assert 1 not in internet_only_map

    # YouTube-only schedule should NOT trigger full-internet block
    decision = evaluate_device_effective_policy(
        dev_active, frozenset(), None, dev_map[1]
    )
    assert decision.should_be_blocked is False
    assert decision.reason == "default_allowed"

    # Pure archive / restore / delete helpers
    arch_dev, arch_audit = apply_device_archive_mutation(dev_archived, 2, True, "admin")
    assert arch_dev.is_archived is True
    assert arch_audit.action == "device.archive"
    rest_dev, rest_audit = apply_device_archive_mutation(dev_archived, 2, False, "admin")
    assert rest_dev.is_archived is False
    assert rest_audit.action == "device.restore"
    with pytest.raises(HTTPException):
        apply_device_archive_mutation(None, 99, True, "admin")

    del_dev, del_audit = prepare_device_delete_audit(
        dev_archived, 2, test_settings, "admin", client_ip="192.168.1.99"
    )
    assert del_dev.id == 2
    assert del_audit.action == "device.delete"
    with pytest.raises(HTTPException):
        prepare_device_delete_audit(None, 99, test_settings, "admin")

    # Pure clone / snooze / youtube action planning helpers
    cloned_row, clone_audit = build_cloned_schedule_row(yt_sched, actor_ip="127.0.0.1")
    assert cloned_row.name == "YouTube Focus (Copy)"
    assert cloned_row.block_mode == "youtube"
    assert clone_audit.action == "schedule_clone"

    snooze_audit = apply_schedule_snooze_mutation(
        yt_sched, ScheduleSnoozeRequest(duration_minutes=45), actor_ip="127.0.0.1", now_utc=ref
    )
    assert yt_sched.snoozed_until == ref + timedelta(minutes=45)
    assert snooze_audit.action == "schedule_snooze"
    clear_audit = apply_schedule_snooze_mutation(
        yt_sched, ScheduleSnoozeRequest(clear=True), actor_ip="127.0.0.1", now_utc=ref
    )
    assert yt_sched.snoozed_until is None
    assert "Cleared" in clear_audit.details

    grp_yt_sched = RecurringSchedule(
        id=12,
        name="Group YT",
        description="",
        target_type="group",
        device_id=None,
        group_id=5,
        block_mode="youtube",
        days_of_week="0,1,2,3,4,5,6",
        start_time="00:00",
        end_time="23:59",
        timezone="UTC",
        is_enabled=True,
    )
    dev_archived.is_youtube_blocked = True
    bonus_ov = ActiveOverrideInfo(
        id=50,
        target_type="device",
        device_id=1,
        target_name="ipad",
        mode="bonus",
        duration_minutes=20,
        created_by="admin",
        reason="reward",
        is_active=True,
        created_at=ref.isoformat(),
        expires_at=(ref + timedelta(minutes=20)).isoformat(),
        remaining_seconds=1200,
    )
    yt_info = ActiveScheduleInfo(
        schedule_id=10,
        name="YouTube Focus",
        target_type="device",
        target_id=1,
        target_name="ipad",
        block_mode="youtube",
        start_time="00:00",
        end_time="23:59",
        timezone="UTC",
    )
    # Without bonus -> block dev 1, unblock stale dev 2
    to_yt_block, to_yt_unblock = plan_youtube_schedule_actions(
        [dev_active, dev_archived],
        [yt_sched, grp_yt_sched],
        {1: yt_info},
        {},
        {5: [2]},
        {"192.168.1.51"},
        frozenset(),
    )
    assert [d.id for d, _ in to_yt_block] == [1]
    assert [d.id for d in to_yt_unblock] == [2]

    # With active bonus override -> dev 1 skipped (even if blocked earlier)
    dev_active.is_youtube_blocked = True
    to_yt_block_b, to_yt_unblock_b = plan_youtube_schedule_actions(
        [dev_active],
        [yt_sched],
        {1: yt_info},
        {1: bonus_ov},
        {},
        {"192.168.1.50"},
        frozenset(),
    )
    assert to_yt_block_b == []
    assert [d.id for d in to_yt_unblock_b] == [1]

    # Additional branch coverage on pure device & schedule helpers
    assert compute_snooze_until("06:00", "Invalid/Zone", None, True, now_utc=ref) > ref
    assert is_schedule_window_active("0,1,2,3,4,5,6", "00:00", "00:00", "Invalid/Zone", ref)
    assert is_schedule_window_active("0,1,2,3,4,5,6", "22:00", "06:00", "UTC", ref) is False
    grp_yt_map, grp_only_map = build_active_schedule_maps(
        [grp_yt_sched], {2: "old-phone"}, {5: "Kids"}, {5: [2]}, now_utc=ref
    )
    assert grp_yt_map[2].target_type == "group"
    assert grp_only_map[5].block_mode == "youtube"
    with pytest.raises(HTTPException):
        validate_schedule_payload("Test", "device", None, None, [0], "08:00", "09:00", "UTC")
    with pytest.raises(HTTPException):
        validate_schedule_payload("Test", "group", None, None, [0], "08:00", "09:00", "UTC")
    with pytest.raises(HTTPException):
        validate_schedule_payload("Test", "device", 1, None, [0], "08:00", "09:00", "Bad/TZ")

    # Device validation & badge helpers
    assert build_device_group_badge_map([], []) == {}
    gw_dev = Device(
        id=9,
        mac_address="aa:bb:cc:00:00:09",
        ipv4_address="192.168.1.1",
        is_online=True,
        is_blocked=False,
        is_protected=True,
        first_seen_at=now_ts,
        last_seen_at=now_ts,
        updated_at=now_ts,
    )
    assert build_device_response(gw_dev, test_settings).is_protected is True
    with pytest.raises(HTTPException):
        _apply_device_metadata_updates(
            gw_dev, 9, DeviceUpdateRequest(is_protected=False), test_settings
        )
    with pytest.raises(HTTPException):
        _validate_device_blockable(None, 99, test_settings)
    with pytest.raises(HTTPException):
        _validate_device_blockable(
            Device(
                id=10,
                mac_address="aa:bb:cc:00:00:10",
                ipv4_address=None,
                is_protected=False,
            ),
            10,
            test_settings,
        )
    with pytest.raises(HTTPException):
        _validate_device_blockable(gw_dev, 9, test_settings)
    with pytest.raises(HTTPException):
        _validate_device_blockable(dev_active, 1, test_settings, client_ip="192.168.1.50")
    dev_active.is_protected = True
    with pytest.raises(HTTPException):
        _validate_device_blockable(dev_active, 1, test_settings)
    dev_active.is_protected = False

    # Pure membership builder + audit + schedule update helpers
    mems = validate_and_build_device_group_memberships([5, 5], {5}, 1)
    assert len(mems) == 1
    with pytest.raises(HTTPException):
        validate_and_build_device_group_memberships([5, 9], {5}, 1)
    upd_audit = build_device_update_audit(dev_active, "admin", [5])
    assert "group_ids=[5]" in upd_audit.details

    upd_params = prepare_schedule_update_params(
        yt_sched,
        ScheduleUpdateRequest(
            name="Edited YT",
            target_type="group",
            group_id=5,
            device_id=None,
            block_mode="internet",
        ),
        "UTC",
    )
    sched_audit = apply_schedule_update_orm(yt_sched, 10, upd_params, actor_ip="127.0.0.1")
    assert yt_sched.target_type == "group"
    assert yt_sched.group_id == 5
    assert yt_sched.device_id is None
    assert yt_sched.block_mode == "internet"
    assert "Edited YT" in sched_audit.details


def test_backup_and_restore_preserve_is_archived_and_block_mode() -> None:
    """ConfigBackupDeviceItem.is_archived and ConfigBackupScheduleItem.block_mode round-trip."""
    now = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
    dev = Device(
        id=1,
        mac_address="aa:bb:cc:dd:ee:01",
        display_name="Old Laptop",
        is_archived=True,
        is_protected=False,
        is_manually_blocked=False,
        is_youtube_blocked=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    sched = RecurringSchedule(
        id=2,
        name="YT Study",
        description="",
        target_type="device",
        device_id=1,
        group_id=None,
        block_mode="youtube",
        days_of_week="0,1,2,3,4",
        start_time="15:00",
        end_time="17:00",
        timezone="UTC",
        is_enabled=True,
    )

    payload = assemble_backup_payload([dev], [], [], [sched])
    assert payload.devices[0].is_archived is True
    assert payload.schedules[0].block_mode == "youtube"

    dev_map, new_devs, updated_devs = prepare_restored_devices(
        [],
        [ConfigBackupDeviceItem(mac_address="aa:bb:cc:dd:ee:01", is_archived=True)],
        now,
    )
    assert updated_devs == 1
    assert new_devs[0].is_archived is True
    new_devs[0].id = 1

    new_scheds, upserted_scheds = prepare_restored_schedules(
        [],
        [
            ConfigBackupScheduleItem(
                name="YT Study",
                target_type="device",
                device_mac="aa:bb:cc:dd:ee:01",
                days_of_week=[0, 1],
                start_time="15:00",
                end_time="17:00",
                block_mode="youtube",
            )
        ],
        dev_map,
        {},
        now,
    )
    assert upserted_scheds == 1
    assert new_scheds[0].block_mode == "youtube"


async def test_init_db_adds_phase17_columns_to_existing_tables(
    test_settings: Settings,
) -> None:
    """init_db non-destructively adds devices.is_archived and schedules.block_mode/snoozed_until."""
    engine = get_engine(test_settings)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE devices ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "mac_address VARCHAR(17) UNIQUE NOT NULL, "
                "ipv4_address VARCHAR(45), hostname VARCHAR(255), "
                "display_name VARCHAR(255), vendor VARCHAR(255), "
                "interface_name VARCHAR(64), "
                "lease_type VARCHAR(32) NOT NULL DEFAULT 'unknown', "
                "is_online BOOLEAN NOT NULL DEFAULT 0, "
                "is_blocked BOOLEAN NOT NULL DEFAULT 0, "
                "is_protected BOOLEAN NOT NULL DEFAULT 0, "
                "notes TEXT NOT NULL DEFAULT '', "
                "first_seen_at DATETIME NOT NULL, "
                "last_seen_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"
            )
        )
        await conn.execute(
            text(
                "CREATE TABLE schedules ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "name VARCHAR(128) NOT NULL, description TEXT NOT NULL DEFAULT '', "
                "target_type VARCHAR(16) NOT NULL, device_id INTEGER, "
                "group_id INTEGER, days_of_week VARCHAR(32) NOT NULL, "
                "start_time VARCHAR(8) NOT NULL, end_time VARCHAR(8) NOT NULL, "
                "timezone VARCHAR(64) NOT NULL, is_enabled BOOLEAN NOT NULL DEFAULT 1, "
                "created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"
            )
        )
    await init_db(test_settings)

    async with engine.begin() as conn:
        dev_cols = {
            str(r[1])
            for r in (await conn.execute(text("PRAGMA table_info(devices)"))).fetchall()
        }
        sched_cols = {
            str(r[1])
            for r in (await conn.execute(text("PRAGMA table_info(schedules)"))).fetchall()
        }
    assert "is_archived" in dev_cols
    assert "block_mode" in sched_cols
    assert "snoozed_until" in sched_cols


async def test_devices_archive_restore_delete_and_inline_groups_api(
    async_client: AsyncClient,
    initialized_db: object,
    test_settings: Settings,
) -> None:
    """API supports archive/restore/delete for offline devices and group_ids PATCH."""
    await _login_admin(async_client, test_settings)

    factory = get_session_factory(test_settings)
    async with factory() as db:
        online_dev = Device(
            mac_address="aa:bb:cc:11:22:01",
            ipv4_address="192.168.1.60",
            display_name="Online Tablet",
            is_online=True,
            is_blocked=False,
            is_protected=False,
        )
        offline_dev = Device(
            mac_address="aa:bb:cc:11:22:02",
            ipv4_address="192.168.1.61",
            display_name="Stale Kindle",
            is_online=False,
            is_blocked=False,
            is_protected=False,
        )
        grp = DeviceGroup(name="Kids", description="", color_badge="indigo", icon="users")
        db.add_all([online_dev, offline_dev, grp])
        await db.commit()
        await db.refresh(online_dev)
        await db.refresh(offline_dev)
        await db.refresh(grp)
        online_id = online_dev.id
        offline_id = offline_dev.id
        grp_id = grp.id

    # Inline group assignment via PATCH /devices/{id}
    patch_resp = await async_client.patch(
        f"/api/v1/devices/{online_id}",
        json={"group_ids": [grp_id]},
    )
    assert patch_resp.status_code == 200
    assert [g["id"] for g in patch_resp.json()["groups"]] == [grp_id]

    # Missing group_ids or non-existent device paths return 404
    assert (
        await async_client.patch(
            f"/api/v1/devices/{online_id}", json={"group_ids": [9999]}
        )
    ).status_code == 404
    assert (await async_client.post("/api/v1/devices/9999/archive")).status_code == 404
    assert (await async_client.post("/api/v1/devices/9999/restore")).status_code == 404
    assert (await async_client.delete("/api/v1/devices/9999")).status_code == 404

    # Archiving or deleting online device must fail 400
    assert (await async_client.post(f"/api/v1/devices/{online_id}/archive")).status_code == 400
    assert (
        await async_client.patch(
            f"/api/v1/devices/{online_id}", json={"is_archived": True}
        )
    ).status_code == 400
    assert (await async_client.delete(f"/api/v1/devices/{online_id}")).status_code == 400

    # Archive offline device (and test PATCH is_archived=False restore)
    arch_resp = await async_client.post(f"/api/v1/devices/{offline_id}/archive")
    assert arch_resp.status_code == 200
    assert arch_resp.json()["is_archived"] is True

    # Excluded from default list, visible under status=archived
    list_all = (await async_client.get("/api/v1/devices")).json()
    assert [d["id"] for d in list_all["devices"]] == [online_id]
    assert list_all["summary"]["archived_devices"] == 1

    list_arch = (await async_client.get("/api/v1/devices?status=archived")).json()
    assert [d["id"] for d in list_arch["devices"]] == [offline_id]

    # Restore offline device
    rest_resp = await async_client.post(f"/api/v1/devices/{offline_id}/restore")
    assert rest_resp.status_code == 200
    assert rest_resp.json()["is_archived"] is False

    # Re-archive via PATCH is_archived=True then restore and delete
    patch_arch = await async_client.patch(
        f"/api/v1/devices/{offline_id}", json={"is_archived": True}
    )
    assert patch_arch.status_code == 200
    assert patch_arch.json()["is_archived"] is True

    # Delete offline device permanently
    del_resp = await async_client.delete(f"/api/v1/devices/{offline_id}")
    assert del_resp.status_code == 204
    async with factory() as db:
        assert (
            await db.execute(select(Device).where(Device.id == offline_id))
        ).scalar_one_or_none() is None


async def test_schedules_youtube_mode_target_edit_clone_and_snooze_api(
    async_client: AsyncClient,
    initialized_db: object,
    test_settings: Settings,
) -> None:
    """API supports youtube block_mode, editable target, clone, and snooze/clear."""
    await _login_admin(async_client, test_settings)

    factory = get_session_factory(test_settings)
    async with factory() as db:
        dev = Device(
            mac_address="aa:bb:cc:33:44:01",
            ipv4_address="192.168.1.77",
            display_name="Kids TV",
            is_online=True,
            is_blocked=False,
            is_youtube_blocked=False,
            is_protected=False,
        )
        grp = DeviceGroup(name="Living Room", description="", color_badge="emerald", icon="tv")
        db.add_all([dev, grp])
        await db.commit()
        await db.refresh(dev)
        await db.refresh(grp)
        dev_id = dev.id
        grp_id = grp.id

    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_with_youtube(respx_mock, test_settings.opnsense_base_url)

        # Create 24h YouTube-Only schedule on device
        create_resp = await async_client.post(
            "/api/v1/schedules",
            json={
                "name": "YouTube Curfew",
                "description": "No YT during homework",
                "target_type": "device",
                "device_id": dev_id,
                "block_mode": "youtube",
                "days_of_week": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "00:00",
                "end_time": "00:00",
                "timezone": "UTC",
                "is_enabled": True,
            },
        )
        assert create_resp.status_code == 201
        sched = create_resp.json()
        sched_id = sched["id"]
        assert sched["block_mode"] == "youtube"
        assert sched["is_active_now"] is True

        # Device should be YouTube-blocked, NOT full-internet blocked
        async with factory() as db:
            db_dev = await db.get(Device, dev_id)
            assert db_dev is not None
            assert db_dev.is_youtube_blocked is True
            assert db_dev.is_blocked is False

        # Snooze active YouTube schedule for 60m
        snooze_resp = await async_client.post(
            f"/api/v1/schedules/{sched_id}/snooze",
            json={"duration_minutes": 60},
        )
        assert snooze_resp.status_code == 200
        assert snooze_resp.json()["is_snoozed"] is True
        assert snooze_resp.json()["is_active_now"] is False

        async with factory() as db:
            db_dev = await db.get(Device, dev_id)
            assert db_dev is not None
            assert db_dev.is_youtube_blocked is False

        # Clear snooze -> re-enforces YouTube block
        unsnooze_resp = await async_client.post(
            f"/api/v1/schedules/{sched_id}/snooze",
            json={"clear": True},
        )
        assert unsnooze_resp.status_code == 200
        assert unsnooze_resp.json()["is_snoozed"] is False
        assert unsnooze_resp.json()["is_active_now"] is True

        # Clone schedule
        clone_resp = await async_client.post(f"/api/v1/schedules/{sched_id}/clone")
        assert clone_resp.status_code == 201
        cloned = clone_resp.json()
        assert cloned["name"] == "YouTube Curfew (Copy)"
        assert cloned["block_mode"] == "youtube"

        # Edit schedule target from device -> group and block_mode -> internet
        patch_resp = await async_client.patch(
            f"/api/v1/schedules/{sched_id}",
            json={
                "target_type": "group",
                "group_id": grp_id,
                "device_id": None,
                "block_mode": "internet",
            },
        )
        assert patch_resp.status_code == 200
        edited = patch_resp.json()
        assert edited["target_type"] == "group"
        assert edited["group_id"] == grp_id
        assert edited["device_id"] is None
        assert edited["block_mode"] == "internet"

        # Test snooze until_end_of_window on non-24h schedule and delete cloned youtube rule
        snooze_eow = await async_client.post(
            f"/api/v1/schedules/{sched_id}/snooze",
            json={"until_end_of_window": True},
        )
        assert snooze_eow.status_code == 200
        assert snooze_eow.json()["is_snoozed"] is True

        del_clone = await async_client.delete(f"/api/v1/schedules/{cloned['id']}")
        assert del_clone.status_code == 204

        assert (await async_client.post("/api/v1/schedules/9999/clone")).status_code == 404
        assert (
            await async_client.post(
                "/api/v1/schedules/9999/snooze", json={"duration_minutes": 30}
            )
        ).status_code == 404

        # Error resilience in reconcile when YouTube alias fails
        respx_mock.get(
            f"{test_settings.opnsense_base_url}/api/firewall/alias_util/list/gateway_youtube_blocked_devices"
        ).mock(return_value=httpx.Response(500, json={"error": "boom"}))
        # Ensure active non-snoozed youtube rule exists for reconcile
        await async_client.post(
            "/api/v1/schedules",
            json={
                "name": "YT Fail Test",
                "target_type": "device",
                "device_id": dev_id,
                "block_mode": "youtube",
                "days_of_week": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "00:00",
                "end_time": "00:00",
                "is_enabled": True,
            },
        )
        reconcile_err = await async_client.post("/api/v1/schedules/reconcile")
        assert reconcile_err.status_code == 200
        assert len(reconcile_err.json()["errors"]) >= 1

        # Alias add/remove errors inside YouTube reconcile
        respx_mock.get(
            f"{test_settings.opnsense_base_url}/api/firewall/alias_util/list/gateway_youtube_blocked_devices"
        ).mock(return_value=httpx.Response(200, json={"rows": []}))
        respx_mock.post(
            f"{test_settings.opnsense_base_url}/api/firewall/alias_util/add/gateway_youtube_blocked_devices"
        ).mock(return_value=httpx.Response(500, json={"error": "add-fail"}))
        reconcile_add_err = await async_client.post("/api/v1/schedules/reconcile")
        assert reconcile_add_err.status_code == 200
        assert any("YouTube" in e for e in reconcile_add_err.json()["errors"])


async def test_device_block_unblock_and_youtube_action_branches_api(
    async_client: AsyncClient,
    initialized_db: object,
    test_settings: Settings,
) -> None:
    """Device block/unblock/youtube endpoints handle success, kill_states warning, and 502/404."""
    await _login_admin(async_client, test_settings)

    factory = get_session_factory(test_settings)
    async with factory() as db:
        dev = Device(
            mac_address="aa:bb:cc:55:66:01",
            ipv4_address="192.168.1.88",
            display_name="PlayStation",
            is_online=True,
            is_blocked=False,
            is_youtube_blocked=False,
            is_protected=False,
        )
        db.add(dev)
        await db.commit()
        await db.refresh(dev)
        dev_id = dev.id

    base = test_settings.opnsense_base_url
    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_with_youtube(respx_mock, base)

        # YouTube block & unblock success + 404
        yt_blk = await async_client.post(f"/api/v1/devices/{dev_id}/youtube/block")
        assert yt_blk.status_code == 200
        assert yt_blk.json()["device"]["is_youtube_blocked"] is True
        yt_unblk = await async_client.post(f"/api/v1/devices/{dev_id}/youtube/unblock")
        assert yt_unblk.status_code == 200
        assert yt_unblk.json()["device"]["is_youtube_blocked"] is False
        assert (await async_client.post("/api/v1/devices/9999/youtube/unblock")).status_code == 404
        assert (await async_client.post("/api/v1/devices/9999/unblock")).status_code == 404

        # kill_states failure produces warning while still blocking
        respx_mock.post(f"{base}/api/diagnostics/firewall/kill_states").mock(
            return_value=httpx.Response(500, json={"error": "state-err"})
        )
        blk_warn = await async_client.post(f"/api/v1/devices/{dev_id}/block")
        assert blk_warn.status_code == 200
        assert blk_warn.json()["states_killed"] is False
        assert blk_warn.json()["warning"] is not None

        # OPNsense alias failures return 502 cleanly for block, unblock, yt-block, yt-unblock
        respx_mock.post(f"{base}/api/firewall/alias_util/delete/gateway_blocked_devices").mock(
            return_value=httpx.Response(500, json={"error": "del-fail"})
        )
        assert (await async_client.post(f"/api/v1/devices/{dev_id}/unblock")).status_code == 502

        respx_mock.post(f"{base}/api/firewall/alias_util/add/gateway_blocked_devices").mock(
            return_value=httpx.Response(500, json={"error": "add-fail"})
        )
        assert (await async_client.post(f"/api/v1/devices/{dev_id}/block")).status_code == 502

        respx_mock.post(
            f"{base}/api/firewall/alias_util/add/gateway_youtube_blocked_devices"
        ).mock(return_value=httpx.Response(500, json={"error": "yt-add-fail"}))
        assert (
            await async_client.post(f"/api/v1/devices/{dev_id}/youtube/block")
        ).status_code == 502

        respx_mock.post(
            f"{base}/api/firewall/alias_util/delete/gateway_youtube_blocked_devices"
        ).mock(return_value=httpx.Response(500, json={"error": "yt-del-fail"}))
        assert (
            await async_client.post(f"/api/v1/devices/{dev_id}/youtube/unblock")
        ).status_code == 502


def test_group_service_pure_helpers_and_alembic_0008(
    test_settings: Settings,
    tmp_path: object,
) -> None:
    """Cover pure group analytics/status helpers and Alembic 0008 upgrade/downgrade paths."""
    import importlib.util
    from pathlib import Path

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    now = datetime.now(UTC)
    dev_a = Device(
        id=1,
        mac_address="aa:bb:cc:77:88:01",
        ipv4_address="192.168.1.91",
        display_name="Kid Phone",
        is_online=True,
        is_blocked=True,
        is_youtube_blocked=True,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    dev_b = Device(
        id=2,
        mac_address="aa:bb:cc:77:88:02",
        ipv4_address="192.168.1.92",
        display_name="Kid Tablet",
        is_online=False,
        is_blocked=False,
        is_youtube_blocked=False,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    dev_prot = Device(
        id=3,
        mac_address="aa:bb:cc:77:88:03",
        ipv4_address="192.168.1.1",
        display_name="Gateway",
        is_online=True,
        is_blocked=False,
        is_youtube_blocked=False,
        is_protected=True,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    dev_noip = Device(
        id=4,
        mac_address="aa:bb:cc:77:88:04",
        ipv4_address=None,
        display_name="Offline NoIP",
        is_online=False,
        is_blocked=False,
        is_youtube_blocked=False,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    resp_a = build_device_response(dev_a, test_settings)
    resp_b = build_device_response(dev_b, test_settings)
    resp_prot = build_device_response(dev_prot, test_settings)
    build_device_response(dev_noip, test_settings)

    assert compute_group_access_status([]) == "empty"
    assert compute_group_access_status([resp_prot]) == "empty"
    assert compute_group_access_status([resp_a]) == "blocked"
    assert compute_group_access_status([resp_b]) == "allowed"
    assert compute_group_access_status([resp_a, resp_b]) == "partially_blocked"

    assert compute_group_youtube_status([]) == "empty"
    assert compute_group_youtube_status([resp_prot]) == "empty"
    assert compute_group_youtube_status([resp_a]) == "blocked"
    assert compute_group_youtube_status([resp_b]) == "allowed"
    assert compute_group_youtube_status([resp_a, resp_b]) == "partially_blocked"

    grp = DeviceGroup(
        id=7,
        name="Family",
        description="Kids & shared",
        color_badge="indigo",
        icon="users",
        created_at=now,
        updated_at=now,
    )
    memberships = [
        DeviceGroupMembership(group_id=7, device_id=1, created_at=now),
        DeviceGroupMembership(group_id=7, device_id=2, created_at=now),
        DeviceGroupMembership(group_id=7, device_id=3, created_at=now),
        DeviceGroupMembership(group_id=7, device_id=4, created_at=now),
    ]
    assembled = assemble_group_responses(
        [grp], memberships, [dev_a, dev_b, dev_prot, dev_noip], test_settings
    )
    assert len(assembled) == 1
    grp_resp = assembled[0]
    assert grp_resp.access_status == "partially_blocked"
    assert grp_resp.youtube_status == "partially_blocked"

    plan_blk = plan_group_bulk_action(grp_resp.members, "block")
    assert plan_blk["eligible_ips"] == ["192.168.1.91", "192.168.1.92"]
    assert "Gateway" in plan_blk["skipped_protected_names"]
    assert "Offline NoIP" in plan_blk["skipped_no_ip_names"]

    plan_unblk = plan_group_bulk_action(grp_resp.members, "unblock")
    assert len(plan_unblk["eligible_device_ids"]) == 4

    empty_analytics = _build_empty_group_analytics_response(
        grp_resp, ["192.168.1.91"], "today", "no events"
    )
    assert empty_analytics.warning == "no events"
    assert len(empty_analytics.member_breakdown) == 4

    populated = _assemble_group_analytics_response(
        grp_resp,
        ["192.168.1.91", "192.168.1.92"],
        {
            "summary": {
                "total_events": 25,
                "total_bytes": 4096,
                "dns_query_count": 10,
                "firewall_event_count": 15,
                "allowed_packet_count": 12,
                "blocked_packet_count": 3,
                "active_hours_in_day": 2,
            },
            "member_ip_breakdown": [
                {
                    "ip": "192.168.1.91",
                    "total_events": 20,
                    "bytes": 3072,
                    "dns_query_count": 8,
                    "allowed_packet_count": 10,
                    "blocked_packet_count": 2,
                }
            ],
            "recent_queries": [
                {
                    "timestamp": now.isoformat(),
                    "domain": "youtube.com",
                    "registered_domain": "youtube.com",
                    "record_type": "A",
                    "source_ip": "192.168.1.91",
                }
            ],
            "timeline": [],
            "hourly_access_profile": [],
            "top_domains": [],
            "top_registered_domains": [],
            "top_organizations": [],
            "application_usage": [],
        },
        "today",
    )
    assert populated.summary.total_events == 25
    assert populated.member_breakdown[0].effective_name == "Kid Phone"
    assert populated.recent_queries[0].device_name == "Kid Phone"

    with pytest.raises(HTTPException) as exc_nf:
        _require_group_or_404(None, 404)
    assert exc_nf.value.status_code == 404

    # Exercise Alembic 0008 upgrade + downgrade against a baseline pre-Phase17 SQLite file
    db_file = Path(str(tmp_path)) / "alembic_0008_test.db"
    sync_engine = sa.create_engine(f"sqlite:///{db_file}")
    with sync_engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE devices (id INTEGER PRIMARY KEY, mac_address TEXT)"))
        conn.execute(sa.text("CREATE TABLE schedules (id INTEGER PRIMARY KEY, name TEXT)"))

    mig_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0008_phase17_archive_and_schedule_modes.py"
    )
    spec = importlib.util.spec_from_file_location("mig0008", mig_path)
    assert spec is not None and spec.loader is not None
    mod0008 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod0008)

    with sync_engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            mod0008.upgrade()
            insp = sa.inspect(conn)
            assert "is_archived" in {c["name"] for c in insp.get_columns("devices")}
            sched_cols = {c["name"] for c in insp.get_columns("schedules")}
            assert {"block_mode", "snoozed_until"}.issubset(sched_cols)
            mod0008.downgrade()
            insp_after = sa.inspect(conn)
            assert "is_archived" not in {c["name"] for c in insp_after.get_columns("devices")}
    sync_engine.dispose()
    _ = build_group_response(grp, [])


async def test_group_crud_unblock_and_youtube_actions_api(
    async_client: AsyncClient,
    initialized_db: object,
    test_settings: Settings,
) -> None:
    """Exercise group create/update/unblock/youtube/delete endpoints for complete coverage."""
    await _login_admin(async_client, test_settings)

    factory = get_session_factory(test_settings)
    async with factory() as db:
        d1 = Device(
            mac_address="aa:bb:cc:99:00:01",
            ipv4_address="192.168.1.101",
            display_name="Living TV",
            is_online=True,
            is_blocked=False,
            is_youtube_blocked=False,
            is_protected=False,
        )
        d2 = Device(
            mac_address="aa:bb:cc:99:00:02",
            ipv4_address=None,
            display_name="Offline Speaker",
            is_online=False,
            is_blocked=False,
            is_youtube_blocked=False,
            is_protected=False,
        )
        db.add_all([d1, d2])
        await db.commit()
        await db.refresh(d1)
        await db.refresh(d2)
        d1_id, d2_id = d1.id, d2.id

    base = test_settings.opnsense_base_url
    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_with_youtube(respx_mock, base)

        create_g = await async_client.post(
            "/api/v1/groups",
            json={
                "name": "Media Room",
                "description": "Shared media",
                "color_badge": "emerald",
                "icon": "tv",
                "device_ids": [d1_id, d2_id],
            },
        )
        assert create_g.status_code == 201
        gid = create_g.json()["id"]

        # Duplicate group name returns 409; missing device id returns 404
        assert (
            await async_client.post("/api/v1/groups", json={"name": "media room"})
        ).status_code == 409
        assert (
            await async_client.patch(
                f"/api/v1/groups/{gid}", json={"device_ids": [9999]}
            )
        ).status_code == 404

        patch_g = await async_client.patch(
            f"/api/v1/groups/{gid}",
            json={
                "name": "Media Lounge",
                "description": "Updated",
                "device_ids": [d1_id, d2_id],
            },
        )
        assert patch_g.status_code == 200
        assert patch_g.json()["name"] == "Media Lounge"

        # Group YouTube block + unblock and internet block + unblock
        yt_blk = await async_client.post(f"/api/v1/groups/{gid}/youtube/block")
        assert yt_blk.status_code == 200
        assert yt_blk.json()["group"]["youtube_status"] == "blocked"

        yt_unblk = await async_client.post(f"/api/v1/groups/{gid}/youtube/unblock")
        assert yt_unblk.status_code == 200
        assert yt_unblk.json()["group"]["youtube_status"] == "allowed"

        blk_g = await async_client.post(f"/api/v1/groups/{gid}/block")
        assert blk_g.status_code == 200
        unblk_g = await async_client.post(f"/api/v1/groups/{gid}/unblock")
        assert unblk_g.status_code == 200
        assert unblk_g.json()["group"]["access_status"] == "allowed"

        # Delete group cleanly
        assert (await async_client.delete(f"/api/v1/groups/{gid}")).status_code == 204
        assert (await async_client.delete(f"/api/v1/groups/{gid}")).status_code == 404


async def test_opnsense_nat_discovery_youtube_alias_merge_and_settings_helpers(
    test_settings: Settings,
) -> None:
    """Cover OPNsense YouTube alias domain merge/DNAT discovery & runtime settings helpers."""
    from app.clients.opnsense import OPNsenseClient
    from app.models import SystemSetting
    from app.services.runtime_settings_service import (
        build_troubleshooting_hint,
        decrypt_secret_value,
        encrypt_secret_value,
        parse_setting_rows_to_overrides,
        validate_and_normalize_elasticsearch_urls,
        validate_and_normalize_plex_urls,
        validate_and_normalize_protected_ips,
    )

    secret = "unit-test-secret-key"
    enc = encrypt_secret_value("my-token", secret)
    assert decrypt_secret_value(enc, secret) == "my-token"
    assert decrypt_secret_value("plain-val", secret) == "plain-val"
    with pytest.raises(ValueError):
        decrypt_secret_value("ENC:v1:bad", secret)
    with pytest.raises(ValueError):
        validate_and_normalize_elasticsearch_urls("   ")
    assert validate_and_normalize_plex_urls("") == ""
    assert validate_and_normalize_protected_ips("192.168.1.50").startswith("192.168.")
    with pytest.raises(ValueError):
        validate_and_normalize_protected_ips("not-an-ip")

    hint_401 = build_troubleshooting_hint("opnsense", "401", {"status_code": 401})[0]
    hint_403 = build_troubleshooting_hint("opnsense", "forbidden", {"status_code": 403})[0]
    assert "Privilege" in hint_401 or "Rejected" in hint_403
    assert "Plex" in build_troubleshooting_hint("plex", "auth failed", {"status_code": 401})[1]
    assert "monitor" in build_troubleshooting_hint("elasticsearch", "auth", {"status_code": 403})[1]
    assert "TLS" in build_troubleshooting_hint("opnsense", "certificate verify failed", {})[0]
    assert "Timed Out" in build_troubleshooting_hint("opnsense", "request timed out", {})[0]
    assert "Connection Failed" in build_troubleshooting_hint("opnsense", "dns refused", {})[0]

    parsed = parse_setting_rows_to_overrides(
        [
            SystemSetting(key="opnsense_api_key", value_text=enc, is_secret=True),
            SystemSetting(key="opnsense_api_secret", value_text="ENC:v1:bad", is_secret=True),
            SystemSetting(key="opnsense_verify_ssl", value_text="true", is_secret=False),
            SystemSetting(key="opnsense_timeout_seconds", value_text="12.5", is_secret=False),
            SystemSetting(
                key="elasticsearch_timeout_seconds", value_text="bad-float", is_secret=False
            ),
            SystemSetting(key="opnsense_base_url", value_text="https://gw.local", is_secret=False),
        ],
        secret,
    )
    assert parsed["opnsense_api_key"].get_secret_value() == "my-token"
    assert "opnsense_api_secret" not in parsed
    assert parsed["opnsense_verify_ssl"] is True
    assert parsed["opnsense_timeout_seconds"] == 12.5
    assert parsed["opnsense_base_url"] == "https://gw.local"

    base = test_settings.opnsense_base_url.rstrip("/")
    client = OPNsenseClient(test_settings)
    with respx.mock(assert_all_called=False) as respx_mock:
        respx_mock.post(f"{base}/api/firewall/d_nat/searchRule").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {"disabled": "1", "target": "192.168.1.99", "local-port": "80"},
                        {
                            "disabled": "0",
                            "target": "192.168.1.10",
                            "local-port": "32400",
                            "destination_port": "32400",
                            "protocol": "tcp",
                        },
                    ]
                },
            )
        )
        respx_mock.post(f"{base}/api/diagnostics/firewall/query_states").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {"direction": "out", "nat_addr": "1.2.3.4"},
                        {
                            "direction": "in",
                            "nat_addr": "192.168.1.2",
                            "nat_port": "51820",
                            "dst_addr": "192.168.1.1",
                            "dst_port": "51820",
                            "proto": "udp",
                        },
                        {
                            "direction": "in",
                            "nat_addr": "203.0.113.5",
                            "nat_port": "51820",
                            "dst_addr": "192.168.1.1",
                            "dst_port": "51820",
                            "proto": "udp",
                        },
                    ]
                },
            )
        )
        nats = await client.get_destination_nat_mappings()
        assert nats[("192.168.1.10", 32400, "tcp")] == 32400
        assert nats[("192.168.1.1", 51820, "udp")] == 51820

        # ensure_youtube_aliases_exist: one missing alias created; domains updated
        respx_mock.get(
            f"{base}/api/firewall/alias/get_alias_uuid/gateway_youtube_blocked_devices"
        ).mock(return_value=httpx.Response(200, json={}))
        respx_mock.get(
            f"{base}/api/firewall/alias/get_alias_uuid/gateway_youtube_domains"
        ).mock(return_value=httpx.Response(200, json={"uuid": "uuid-yt-dom"}))
        respx_mock.get(f"{base}/api/firewall/alias/get_item/uuid-yt-dom").mock(
            return_value=httpx.Response(
                200,
                json={
                    "alias": {
                        "enabled": "1",
                        "name": "gateway_youtube_domains",
                        "type": {"host": {"selected": 1}},
                        "proto": {},
                        "interface": {},
                        "content": {"youtube.com": {"selected": 1}},
                        "description": "YT domains",
                    }
                },
            )
        )
        respx_mock.post(f"{base}/api/firewall/alias/add_item").mock(
            return_value=httpx.Response(200, json={"result": "saved"})
        )
        respx_mock.post(f"{base}/api/firewall/alias/set_item/uuid-yt-dom").mock(
            return_value=httpx.Response(200, json={"result": "saved"})
        )
        respx_mock.post(f"{base}/api/firewall/alias/reconfigure").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        ensured = await client.ensure_youtube_aliases_exist()
        assert "gateway_youtube_blocked_devices" in ensured["created_aliases"]
        assert "gateway_youtube_domains" in ensured["created_aliases"]
