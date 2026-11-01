"""API integration tests for Phase 6 /api/v1/schedules, 5-tier policy & Bonus presets."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import respx
from httpx import AsyncClient
from sqlalchemy import select

from app.config import Settings
from app.db import get_session_factory
from app.models import Device, TemporaryOverride


def _mock_opnsense_endpoints(router: respx.MockRouter, base_url: str) -> None:
    """Register standard 200 OK mocks for OPNsense alias list/add/delete and kill_states."""
    router.get(f"{base_url}/api/firewall/alias_util/list/gateway_blocked_devices").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )
    router.post(f"{base_url}/api/firewall/alias_util/add/gateway_blocked_devices").mock(
        return_value=httpx.Response(200, json={"status": "done"})
    )
    router.post(
        f"{base_url}/api/firewall/alias_util/delete/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"status": "done"}))
    router.post(f"{base_url}/api/diagnostics/firewall/kill_states").mock(
        return_value=httpx.Response(200, json={"result": "ok", "dropped": 2})
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


async def test_schedules_api_crud_and_bonus_timer_precedence(
    async_client: AsyncClient,
    initialized_db: object,
    test_settings: Settings,
) -> None:
    """Verify /api/v1/schedules CRUD, active_schedule badges, and 20m/40m/60m Bonus override."""
    await _login_admin(async_client, test_settings)

    factory = get_session_factory(test_settings)
    async with factory() as db:
        dev = Device(
            mac_address="aa:bb:cc:dd:ee:99",
            ipv4_address="192.168.50.120",
            display_name="Gaming Console",
            is_online=True,
            is_blocked=False,
            is_manually_blocked=False,
            is_protected=False,
        )
        db.add(dev)
        await db.commit()
        await db.refresh(dev)
        dev_id = dev.id

    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_endpoints(respx_mock, test_settings.opnsense_base_url)

        # 1. Create a group via API
        grp_resp = await async_client.post(
            "/api/v1/groups",
            json={
                "name": "Gaming Room",
                "description": "Consoles & PCs",
                "color_badge": "violet",
                "icon": "gamepad",
                "device_ids": [dev_id],
            },
        )
        assert grp_resp.status_code == 201
        group_id = grp_resp.json()["id"]

        # 2. Create an active 24h recurring schedule on the group
        create_resp = await async_client.post(
            "/api/v1/schedules",
            json={
                "name": "School Night Bedtime",
                "description": "No gaming during bedtime",
                "target_type": "group",
                "group_id": group_id,
                "days_of_week": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "00:00",
                "end_time": "00:00",
                "timezone": "America/Los_Angeles",
                "is_enabled": True,
            },
        )
        assert create_resp.status_code == 201
        sched_data = create_resp.json()
        sched_id = sched_data["id"]
        assert sched_data["is_active_now"] is True
        assert sched_data["target_name"] == "Gaming Room"

        # 3. Verify GET /api/v1/devices and GET /api/v1/groups include active_schedule
        devices_resp = await async_client.get("/api/v1/devices")
        assert devices_resp.status_code == 200
        dev_item = devices_resp.json()["devices"][0]
        assert dev_item["is_blocked"] is True
        assert dev_item["active_schedule"]["name"] == "School Night Bedtime"

        groups_resp = await async_client.get("/api/v1/groups")
        assert groups_resp.status_code == 200
        grp_item = groups_resp.json()["groups"][0]
        assert grp_item["active_schedule"]["name"] == "School Night Bedtime"

        # 4. Grant a 20m Bonus Access timer (FB-P5-004 preset) during active bedtime schedule!
        bonus_resp = await async_client.post(
            f"/api/v1/timers/devices/{dev_id}",
            json={"mode": "bonus", "preset": "20m", "reason": "Finished homework"},
        )
        assert bonus_resp.status_code == 201
        assert bonus_resp.json()["duration_minutes"] == 20

        # Also verify 40m and 60m presets work
        bonus_40 = await async_client.post(
            f"/api/v1/timers/devices/{dev_id}",
            json={"mode": "bonus", "preset": "40m"},
        )
        assert bonus_40.status_code == 201
        assert bonus_40.json()["duration_minutes"] == 40

        bonus_60 = await async_client.post(
            f"/api/v1/timers/devices/{dev_id}",
            json={"mode": "bonus", "preset": "60m"},
        )
        assert bonus_60.status_code == 201
        assert bonus_60.json()["duration_minutes"] == 60

        # Reconcile policies while bonus timer is active -> device stays unblocked (Tier 2 > Tier 4)
        rec1 = await async_client.post("/api/v1/schedules/reconcile")
        assert rec1.status_code == 200
        assert rec1.json()["newly_blocked_ips"] == []

        # 5. Expire the bonus timer and run timer reconciliation -> device re-blocked by schedule!
        async with factory() as db:
            ov_rows = list((await db.execute(select(TemporaryOverride))).scalars().all())
            for ov in ov_rows:
                ov.expires_at = datetime.now(UTC) - timedelta(minutes=5)
            await db.commit()

        rec_timer = await async_client.post("/api/v1/timers/reconcile")
        assert rec_timer.status_code == 200
        assert rec_timer.json()["expired_processed_count"] == 1

        devices_after = (await async_client.get("/api/v1/devices")).json()["devices"]
        assert devices_after[0]["is_blocked"] is True

        # 6. Update schedule, toggle schedule off, list schedules, and delete schedule
        upd_resp = await async_client.put(
            f"/api/v1/schedules/{sched_id}",
            json={
                "name": "Updated Bedtime",
                "description": "Updated desc",
                "target_type": "device",
                "device_id": dev_id,
                "days_of_week": [0, 1, 2, 3, 4, 5, 6],
                "start_time": "00:00",
                "end_time": "00:00",
                "timezone": "America/Los_Angeles",
                "is_enabled": True,
            },
        )
        assert upd_resp.status_code == 200
        assert upd_resp.json()["name"] == "Updated Bedtime"

        tog_resp = await async_client.patch(
            f"/api/v1/schedules/{sched_id}/toggle",
            json={"is_enabled": False},
        )
        assert tog_resp.status_code == 200
        assert tog_resp.json()["is_enabled"] is False

        list_resp = await async_client.get("/api/v1/schedules")
        assert list_resp.status_code == 200
        assert len(list_resp.json()["schedules"]) == 1

        del_resp = await async_client.delete(f"/api/v1/schedules/{sched_id}")
        assert del_resp.status_code == 204

        # 7. Verify 404 responses on missing schedule/target
        not_found_tog = await async_client.patch(
            "/api/v1/schedules/9999/toggle",
            json={"is_enabled": True},
        )
        assert not_found_tog.status_code == 404

        not_found_del = await async_client.delete("/api/v1/schedules/9999")
        assert not_found_del.status_code == 404

        not_found_dev = await async_client.post(
            "/api/v1/schedules",
            json={
                "name": "Missing Dev",
                "target_type": "device",
                "device_id": 9999,
                "days_of_week": [0],
                "start_time": "21:00",
                "end_time": "07:00",
            },
        )
        assert not_found_dev.status_code == 404
