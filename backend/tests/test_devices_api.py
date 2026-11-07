"""Unit and API tests for device discovery, reconciliation, and block/unblock (Step 2.3)."""

from __future__ import annotations

import httpx
import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import select

from app.config import Settings
from app.db import get_session_factory
from app.models import AuditLog, Device


async def _login_admin(client: AsyncClient, settings: Settings) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "username": settings.admin_username,
            "password": settings.admin_password.get_secret_value(),
        },
    )
    assert resp.status_code == 200


def _mock_opnsense_discovery_endpoints(
    *,
    kids_ip: str = "192.168.1.55",
    blocked_ips: list[str] | None = None,
) -> None:
    """Mock OPNsense ARP, Dnsmasq leases, and block alias with realistic payloads."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "mac": "00:11:22:33:44:01",
                    "ip": "192.168.1.1",
                    "intf": "vtnet1",
                    "intf_description": "LAN",
                    "expired": False,
                    "permanent": True,
                    "hostname": "opnsense.example.local",
                    "manufacturer": "Protectli",
                },
                {
                    "mac": "00:11:22:33:44:25",
                    "ip": "192.168.1.25",
                    "intf": "vtnet1",
                    "intf_description": "LAN",
                    "expired": False,
                    "permanent": False,
                    "hostname": "admin-workstation",
                    "manufacturer": "Intel Corporate",
                },
                {
                    "mac": "AA:BB:CC:DD:EE:55",
                    "ip": kids_ip,
                    "intf": "vtnet1",
                    "intf_description": "LAN",
                    "expired": False,
                    "permanent": False,
                    "hostname": "",
                    "manufacturer": "Apple, Inc.",
                },
            ],
        )
    )
    respx.get("https://opnsense.example.local/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "rows": [
                    {
                        "hwaddr": "aa:bb:cc:dd:ee:55",
                        "address": kids_ip,
                        "hostname": "kids-ipad",
                        "client_id": "*",
                        "if_descr": "LAN",
                        "mac_info": "Private",
                        "lease_type": "dynamic",
                    },
                    {
                        "hwaddr": "aa:bb:cc:dd:ee:99",
                        "address": "192.168.1.99",
                        "hostname": "*",
                        "client_id": "*",
                        "if_descr": "LAN",
                        "mac_info": "Sony Interactive",
                        "lease_type": "dynamic",
                    },
                ]
            },
        )
    )
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"rows": [{"ip": ip} for ip in (blocked_ips or [])]},
        )
    )


@pytest.mark.asyncio
async def test_devices_endpoints_require_authentication(
    async_client: AsyncClient,
) -> None:
    """Verify all /api/v1/devices endpoints return 401 when unauthenticated."""
    assert (await async_client.get("/api/v1/devices")).status_code == 401
    assert (await async_client.post("/api/v1/devices/sync")).status_code == 401
    assert (await async_client.patch("/api/v1/devices/1", json={})).status_code == 401
    assert (await async_client.post("/api/v1/devices/1/block")).status_code == 401
    assert (await async_client.post("/api/v1/devices/1/unblock")).status_code == 401


@respx.mock
@pytest.mark.asyncio
async def test_device_discovery_reconciliation_search_and_rename_across_ip_drift(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify initial auto-sync, '*' stripping, vendor merging, filtering, and DHCP IP drift."""
    await _login_admin(async_client, test_settings)
    _mock_opnsense_discovery_endpoints(kids_ip="192.168.1.55", blocked_ips=[])

    resp = await async_client.get("/api/v1/devices")
    assert resp.status_code == 200
    body = resp.json()

    assert body["summary"] == {
        "total_devices": 4,
        "online_devices": 3,
        "blocked_devices": 0,
        "protected_devices": 2,  # 192.168.1.1 (gateway) + 192.168.1.25 (admin session IP)
    }
    assert body["last_synced_at"] is not None

    by_mac = {d["mac_address"]: d for d in body["devices"]}

    # 1. Gateway IP is protected via OPNSENSE_PROTECTED_IPS
    gw = by_mac["00:11:22:33:44:01"]
    assert gw["is_protected"] is True
    assert "OPNSENSE_PROTECTED_IPS" in gw["protection_reason"]

    # 2. Admin session IP (192.168.1.25) is protected dynamically
    admin_dev = by_mac["00:11:22:33:44:25"]
    assert admin_dev["is_protected"] is True
    assert "administrator session IP" in admin_dev["protection_reason"]

    # 3. Kids iPad merged ARP manufacturer ("Apple, Inc.") over Dnsmasq ("Private")
    kids = by_mac["aa:bb:cc:dd:ee:55"]
    assert kids["hostname"] == "kids-ipad"
    assert kids["vendor"] == "Apple, Inc."
    assert kids["is_online"] is True

    # 4. Offline Dnsmasq device had '*' hostname stripped to None
    offline_ps5 = by_mac["aa:bb:cc:dd:ee:99"]
    assert offline_ps5["hostname"] is None
    assert offline_ps5["effective_name"] == "192.168.1.99"
    assert offline_ps5["is_online"] is False

    # 5. Filter by status=online and search query
    online_resp = await async_client.get("/api/v1/devices?status=online&search=apple")
    assert online_resp.status_code == 200
    online_list = online_resp.json()["devices"]
    assert len(online_list) == 1
    assert online_list[0]["mac_address"] == "aa:bb:cc:dd:ee:55"

    # 6. Inline rename Kids iPad and verify it persists when DHCP IP changes to .77
    patch_resp = await async_client.patch(
        f"/api/v1/devices/{kids['id']}",
        json={"display_name": "Living Room iPad", "notes": "Kids tablet"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["display_name"] == "Living Room iPad"
    assert patch_resp.json()["effective_name"] == "Living Room iPad"

    _mock_opnsense_discovery_endpoints(
        kids_ip="192.168.1.77", blocked_ips=["192.168.1.77"]
    )
    sync_resp = await async_client.post("/api/v1/devices/sync")
    assert sync_resp.status_code == 200
    synced_by_mac = {d["mac_address"]: d for d in sync_resp.json()["devices"]}
    updated_kids = synced_by_mac["aa:bb:cc:dd:ee:55"]
    assert updated_kids["ipv4_address"] == "192.168.1.77"
    assert updated_kids["display_name"] == "Living Room iPad"
    assert updated_kids["is_blocked"] is True


@respx.mock
@pytest.mark.asyncio
async def test_block_unblock_self_lockout_guardrails_and_partial_kill_states_warning(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify protected IP/device 403 guardrails, block/unblock flow, and kill_states warning."""
    await _login_admin(async_client, test_settings)
    _mock_opnsense_discovery_endpoints(kids_ip="192.168.1.55", blocked_ips=[])

    initial = (await async_client.get("/api/v1/devices")).json()
    by_mac = {d["mac_address"]: d for d in initial["devices"]}
    gw_id = by_mac["00:11:22:33:44:01"]["id"]
    admin_id = by_mac["00:11:22:33:44:25"]["id"]
    kids_id = by_mac["aa:bb:cc:dd:ee:55"]["id"]

    # 1. Cannot unprotect gateway infrastructure IP
    unprot_gw = await async_client.patch(
        f"/api/v1/devices/{gw_id}", json={"is_protected": False}
    )
    assert unprot_gw.status_code == 403

    # 2. Cannot block gateway IP (192.168.1.1)
    block_gw = await async_client.post(f"/api/v1/devices/{gw_id}/block")
    assert block_gw.status_code == 403
    assert "protected gateway" in block_gw.json()["detail"].lower()

    # 3. Cannot block active admin session IP (192.168.1.25)
    block_admin = await async_client.post(f"/api/v1/devices/{admin_id}/block")
    assert block_admin.status_code == 403
    assert "active administrator session ip" in block_admin.json()["detail"].lower()

    # 4. Cannot block a manually protected device
    await async_client.patch(f"/api/v1/devices/{kids_id}", json={"is_protected": True})
    block_protected = await async_client.post(f"/api/v1/devices/{kids_id}/block")
    assert block_protected.status_code == 403
    await async_client.patch(f"/api/v1/devices/{kids_id}", json={"is_protected": False})

    # 5. Block kids_id -> succeeds with kill_states
    respx.post(
        "https://opnsense.example.local/api/firewall/alias_util/add/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"status": "done"}))
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"rows": [{"ip": "192.168.1.55"}]}))
    kill_route = respx.post(
        "https://opnsense.example.local/api/diagnostics/firewall/kill_states"
    ).mock(
        side_effect=[
            httpx.Response(200, json={"result": "ok", "dropped_states": 5}),
            httpx.Response(500, json={"error": "pfctl timeout"}),
        ]
    )

    block_ok = await async_client.post(f"/api/v1/devices/{kids_id}/block")
    assert block_ok.status_code == 200
    block_data = block_ok.json()
    assert block_data["action"] == "block"
    assert block_data["states_killed"] is True
    assert block_data["warning"] is None
    assert block_data["device"]["is_blocked"] is True
    assert kill_route.called

    # 6. Block when kill_states fails -> still blocks device and returns non-fatal warning
    block_warn = await async_client.post(f"/api/v1/devices/{kids_id}/block")
    assert block_warn.status_code == 200
    warn_data = block_warn.json()
    assert warn_data["device"]["is_blocked"] is True
    assert warn_data["states_killed"] is False
    assert "kill_states" in warn_data["warning"]

    # 7. Unblock kids_id -> removes from alias and sets is_blocked=False
    respx.post(
        "https://opnsense.example.local/api/firewall/alias_util/delete/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"status": "done"}))
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"rows": []}))

    unblock_ok = await async_client.post(f"/api/v1/devices/{kids_id}/unblock")
    assert unblock_ok.status_code == 200
    assert unblock_ok.json()["device"]["is_blocked"] is False

    # 8. Verify AuditLog entries were persisted in SQLite
    factory = get_session_factory(test_settings)
    async with factory() as session:
        logs = (await session.execute(select(AuditLog))).scalars().all()
        actions = [log.action for log in logs]
        assert "device.block" in actions
        assert "device.unblock" in actions
        assert "device.update" in actions


@respx.mock
@pytest.mark.asyncio
async def test_device_not_found_missing_ip_and_opnsense_502_errors(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify 404 on unknown device, 400 on device without IPv4, and 502 on OPNsense failure."""
    await _login_admin(async_client, test_settings)

    # Insert a device without an IPv4 address directly into SQLite
    factory = get_session_factory(test_settings)
    async with factory() as session:
        no_ip_dev = Device(
            mac_address="de:ad:be:ef:00:01",
            ipv4_address=None,
            hostname="layer2-only-switch",
            is_online=False,
        )
        session.add(no_ip_dev)
        await session.commit()
        await session.refresh(no_ip_dev)
        no_ip_id = no_ip_dev.id

    # 1. 404 Not Found on non-existent device ID
    assert (
        await async_client.patch("/api/v1/devices/9999", json={"display_name": "Ghost"})
    ).status_code == 404
    assert (await async_client.post("/api/v1/devices/9999/block")).status_code == 404
    assert (await async_client.post("/api/v1/devices/9999/unblock")).status_code == 404

    # 2. 400 Bad Request when attempting to block a device with no IPv4 address
    no_ip_block = await async_client.post(f"/api/v1/devices/{no_ip_id}/block")
    assert no_ip_block.status_code == 400
    assert "without a known ipv4" in no_ip_block.json()["detail"].lower()

    # 3. 502 Bad Gateway when OPNsense fails during POST /api/v1/devices/sync
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(500, json={"error": "OPNsense error"})
    )
    sync_err = await async_client.post("/api/v1/devices/sync")
    assert sync_err.status_code == 502
    get_sync_err = await async_client.get("/api/v1/devices?sync=true")
    assert get_sync_err.status_code == 502


@pytest.mark.asyncio
async def test_devices_unified_blocked_filter_and_kpi_counts(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify status_filter='blocked' returns both internet and YT blocked devices (FB-P11-006)."""
    await _login_admin(async_client, test_settings)

    factory = get_session_factory(test_settings)
    async with factory() as session:
        d1 = Device(
            mac_address="02:00:00:00:01:01",
            ipv4_address="192.168.1.101",
            hostname="normal-laptop",
            is_blocked=False,
            is_youtube_blocked=False,
            is_online=True,
        )
        d2 = Device(
            mac_address="02:00:00:00:01:02",
            ipv4_address="192.168.1.102",
            hostname="fully-blocked-pc",
            is_blocked=True,
            is_youtube_blocked=False,
            is_online=True,
        )
        d3 = Device(
            mac_address="02:00:00:00:01:03",
            ipv4_address="192.168.1.103",
            hostname="youtube-blocked-tablet",
            is_blocked=False,
            is_youtube_blocked=True,
            is_online=True,
        )
        session.add_all([d1, d2, d3])
        await session.commit()

    resp = await async_client.get("/api/v1/devices?status=blocked")
    assert resp.status_code == 200
    data = resp.json()

    blocked_names = [d["hostname"] for d in data["devices"]]
    assert "fully-blocked-pc" in blocked_names
    assert "youtube-blocked-tablet" in blocked_names
    assert "normal-laptop" not in blocked_names

    # Summary KPI blocked_devices count includes YouTube-blocked devices
    assert data["summary"]["blocked_devices"] >= 2


