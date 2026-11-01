"""Unit and API integration tests for Phase 5 Temporary Overrides & Timer Reconciliation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from freezegun import freeze_time
from httpx import AsyncClient

from app.clients.opnsense import OPNsenseClient
from app.config import Settings
from app.db import get_session_factory
from app.main import run_scheduled_override_reconciliation
from app.models import Device, DeviceGroup, DeviceGroupMembership, TemporaryOverride
from app.services.timer_service import cancel_override, reconcile_expired_overrides


async def _seed_devices_and_group(test_settings: Settings) -> tuple[int, int, int]:
    """Seed two devices and one group containing both devices."""
    session_factory = get_session_factory(test_settings)
    async with session_factory() as session:
        d1 = Device(
            mac_address="aa:bb:cc:11:22:01",
            ipv4_address="192.168.50.101",
            hostname="kids-ipad",
            display_name="Kids iPad",
            lease_type="dynamic",
            is_online=True,
            is_blocked=False,
        )
        d2 = Device(
            mac_address="aa:bb:cc:11:22:02",
            ipv4_address="192.168.50.102",
            hostname="kids-switch",
            display_name="Kids Switch",
            lease_type="dynamic",
            is_online=True,
            is_blocked=False,
        )
        grp = DeviceGroup(
            name="Kids Devices",
            description="All kids tablets & consoles",
            color_badge="indigo",
            icon="gamepad",
        )
        session.add_all([d1, d2, grp])
        await session.flush()

        session.add_all(
            [
                DeviceGroupMembership(group_id=grp.id, device_id=d1.id),
                DeviceGroupMembership(group_id=grp.id, device_id=d2.id),
            ]
        )
        await session.commit()
        return d1.id, d2.id, grp.id


def _mock_opnsense_mutations(router: respx.MockRouter, base_url: str) -> None:
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
        return_value=httpx.Response(200, json={"result": "ok", "dropped": 3})
    )


@pytest.mark.asyncio
async def test_device_pause_timer_lifecycle_and_expiry_reconciliation(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify starting a device pause timer blocks immediately and unblocks upon expiry."""
    d1_id, _, _ = await _seed_devices_and_group(test_settings)

    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_mutations(respx_mock, test_settings.opnsense_base_url)

        with freeze_time("2026-11-05 18:00:00+00:00"):
            login_res = await async_client.post(
                "/api/v1/auth/login",
                json={
                    "username": test_settings.admin_username,
                    "password": test_settings.admin_password.get_secret_value(),
                },
            )
            assert login_res.status_code == 200

            start_res = await async_client.post(
                f"/api/v1/timers/devices/{d1_id}",
                json={"mode": "pause", "preset": "30m", "reason": "Dinner time"},
            )
            assert start_res.status_code == 201
            timer_data = start_res.json()
            assert timer_data["mode"] == "pause"
            assert timer_data["duration_minutes"] == 30
            assert timer_data["remaining_seconds"] == 1800

            # Verify device list embeds active_override and is_blocked=True
            devs_res = await async_client.get("/api/v1/devices")
            assert devs_res.status_code == 200
            d1_payload = next(
                d for d in devs_res.json()["devices"] if d["id"] == d1_id
            )
            assert d1_payload["is_blocked"] is True
            assert d1_payload["active_override"]["id"] == timer_data["id"]

            # Verify GET /api/v1/timers lists the active timer
            timers_res = await async_client.get("/api/v1/timers")
            assert timers_res.status_code == 200
            assert len(timers_res.json()["timers"]) == 1

        # Advance time 35 minutes past expiry and trigger reconcile
        with freeze_time("2026-11-05 18:35:00+00:00"):
            rec_res = await async_client.post("/api/v1/timers/reconcile")
            assert rec_res.status_code == 200
            rec_data = rec_res.json()
            assert rec_data["expired_processed_count"] == 1
            assert "Kids iPad" in rec_data["unblocked_targets"]

            devs_after = await async_client.get("/api/v1/devices")
            d1_after = next(
                d for d in devs_after.json()["devices"] if d["id"] == d1_id
            )
            assert d1_after["is_blocked"] is False
            assert d1_after["active_override"] is None


@pytest.mark.asyncio
async def test_device_bonus_timer_and_manual_toggle_conflict_cancellation(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify bonus access timer re-blocks on expiry, and manual toggle cancels active timer."""
    d1_id, _, _ = await _seed_devices_and_group(test_settings)

    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_mutations(respx_mock, test_settings.opnsense_base_url)

        with freeze_time("2026-11-05 19:00:00+00:00"):
            await async_client.post(
                "/api/v1/auth/login",
                json={
                    "username": test_settings.admin_username,
                    "password": test_settings.admin_password.get_secret_value(),
                },
            )

            # 1. Start a 15m bonus timer -> unblocks device
            bonus_res = await async_client.post(
                f"/api/v1/timers/devices/{d1_id}",
                json={"mode": "bonus", "preset": "15m"},
            )
            assert bonus_res.status_code == 201
            assert bonus_res.json()["mode"] == "bonus"

        # 2. Expire at +20m -> re-blocks device
        with freeze_time("2026-11-05 19:20:00+00:00"):
            rec_res = await async_client.post("/api/v1/timers/reconcile")
            assert rec_res.status_code == 200
            assert "Kids iPad" in rec_res.json()["reblocked_targets"]

        # 3. Start a 1h pause timer, then perform a manual permanent unblock -> cancels timer
        with freeze_time("2026-11-05 19:25:00+00:00"):
            await async_client.post(
                f"/api/v1/timers/devices/{d1_id}",
                json={"mode": "pause", "preset": "1h"},
            )
            unblock_res = await async_client.post(f"/api/v1/devices/{d1_id}/unblock")
            assert unblock_res.status_code == 200
            timers_res = await async_client.get("/api/v1/timers")
            assert timers_res.json()["timers"] == []


@pytest.mark.asyncio
async def test_group_pause_and_bonus_timers_and_cancel_endpoint(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify group-level pause/bonus timers, cancel endpoint, and group expiry reconciliation."""
    _, _, grp_id = await _seed_devices_and_group(test_settings)

    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_mutations(respx_mock, test_settings.opnsense_base_url)

        with freeze_time("2026-11-05 20:00:00+00:00"):
            await async_client.post(
                "/api/v1/auth/login",
                json={
                    "username": test_settings.admin_username,
                    "password": test_settings.admin_password.get_secret_value(),
                },
            )

            # Start group pause timer
            grp_pause = await async_client.post(
                f"/api/v1/timers/groups/{grp_id}",
                json={"mode": "pause", "preset": "until_tomorrow_0700"},
            )
            assert grp_pause.status_code == 201
            ov_id = grp_pause.json()["id"]

            # Verify group response includes active_override
            grp_get = await async_client.get(f"/api/v1/groups/{grp_id}")
            assert grp_get.status_code == 200
            assert grp_get.json()["access_status"] == "blocked"
            assert grp_get.json()["active_override"]["id"] == ov_id

            # Cancel the group pause timer with revert_state=True -> unblocks group
            cancel_res = await async_client.delete(
                f"/api/v1/timers/{ov_id}?revert_state=true"
            )
            assert cancel_res.status_code == 200
            assert cancel_res.json()["reverted_state"] is True

            # Start group bonus timer and let it expire
            grp_bonus = await async_client.post(
                f"/api/v1/timers/groups/{grp_id}",
                json={"mode": "bonus", "duration_minutes": 15},
            )
            assert grp_bonus.status_code == 201

        with freeze_time("2026-11-05 20:20:00+00:00"):
            rec_res = await async_client.post("/api/v1/timers/reconcile")
            assert rec_res.status_code == 200
            assert "Group:Kids Devices" in rec_res.json()["reblocked_targets"]

            # Start a group pause timer and let it expire to test group pause expiry
            grp_pause2 = await async_client.post(
                f"/api/v1/timers/groups/{grp_id}",
                json={"mode": "pause", "duration_minutes": 10},
            )
            assert grp_pause2.status_code == 201

        with freeze_time("2026-11-05 20:35:00+00:00"):
            rec_res2 = await async_client.post("/api/v1/timers/reconcile")
            assert rec_res2.status_code == 200
            assert "Group:Kids Devices" in rec_res2.json()["unblocked_targets"]

            # 404 on unknown override cancel
            not_found = await async_client.delete("/api/v1/timers/99999")
            assert not_found.status_code == 404


@pytest.mark.asyncio
async def test_cancel_device_override_and_reconcile_error_handling(
    initialized_db: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify cancelling device pause/bonus timers directly and handling reconciliation errors."""
    monkeypatch.setattr("app.main.get_settings", lambda: initialized_db)
    d1_id, _, grp_id = await _seed_devices_and_group(initialized_db)

    session_factory = get_session_factory(initialized_db)
    opnsense = OPNsenseClient(initialized_db)

    with respx.mock(assert_all_called=False) as respx_mock:
        _mock_opnsense_mutations(respx_mock, initialized_db.opnsense_base_url)

        now = datetime(2026, 11, 5, 21, 0, 0, tzinfo=UTC)
        async with session_factory() as session:
            ov_pause = TemporaryOverride(
                target_type="device",
                device_id=d1_id,
                mode="pause",
                duration_minutes=15,
                created_by="admin",
                is_active=True,
                created_at=now,
                expires_at=now + timedelta(minutes=15),
            )
            session.add(ov_pause)
            await session.commit()
            await session.refresh(ov_pause)

            res_cancel_pause = await cancel_override(
                session,
                opnsense,
                initialized_db,
                ov_pause.id,
                actor="admin",
                revert_state=True,
                now_utc=now,
            )
            assert res_cancel_pause.reverted_state is True

            ov_bonus = TemporaryOverride(
                target_type="device",
                device_id=d1_id,
                mode="bonus",
                duration_minutes=15,
                created_by="admin",
                is_active=True,
                created_at=now,
                expires_at=now + timedelta(minutes=15),
            )
            session.add(ov_bonus)
            await session.commit()
            await session.refresh(ov_bonus)

            res_cancel_bonus = await cancel_override(
                session,
                opnsense,
                initialized_db,
                ov_bonus.id,
                actor="admin",
                revert_state=True,
                now_utc=now,
            )
            assert res_cancel_bonus.reverted_state is True

            ov_grp_bonus = TemporaryOverride(
                target_type="group",
                group_id=grp_id,
                mode="bonus",
                duration_minutes=15,
                created_by="admin",
                is_active=True,
                created_at=now,
                expires_at=now + timedelta(minutes=15),
            )
            session.add(ov_grp_bonus)
            await session.commit()
            await session.refresh(ov_grp_bonus)

            res_cancel_grp_bonus = await cancel_override(
                session,
                opnsense,
                initialized_db,
                ov_grp_bonus.id,
                actor="admin",
                revert_state=True,
                now_utc=now,
            )
            assert res_cancel_grp_bonus.reverted_state is True

            # Clear d1's IPv4 address and insert an expired bonus override to test error capture
            d1_obj = await session.get(Device, d1_id)
            assert d1_obj is not None
            d1_obj.ipv4_address = None
            ov_bad = TemporaryOverride(
                target_type="device",
                device_id=d1_id,
                mode="bonus",
                duration_minutes=5,
                created_by="admin",
                is_active=True,
                created_at=now - timedelta(minutes=10),
                expires_at=now - timedelta(minutes=5),
            )
            session.add(ov_bad)
            await session.commit()

            summary = await reconcile_expired_overrides(
                session, opnsense, initialized_db, now_utc=now
            )
            assert len(summary.errors) == 1

        await run_scheduled_override_reconciliation()
