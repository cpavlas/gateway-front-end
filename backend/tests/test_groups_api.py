"""Unit and API integration tests for Phase 4 Step 4.2 GroupService & /api/v1/groups routes."""

from __future__ import annotations

from typing import Any

import pytest
import respx
from fastapi import HTTPException
from httpx import AsyncClient, Response

from app.clients.elasticsearch import ElasticsearchQueryError, ElasticsearchServiceClient
from app.config import Settings
from app.db import get_session_factory
from app.models import Device, DeviceGroup, DeviceGroupMembership, utc_now
from app.services.analytics_service import get_analytics_cache
from app.services.device_service import build_device_response
from app.services.group_service import (
    _assemble_group_analytics_response,
    _build_empty_group_analytics_response,
    _require_group_or_404,
    assemble_group_responses,
    compute_group_access_status,
    plan_group_bulk_action,
    validate_group_fields,
)


def test_synchronous_group_helpers_and_state_calculation(test_settings: Settings) -> None:
    """Verify pure synchronous helpers for validation, group state, and bulk action planning."""
    name, color, icon = validate_group_fields("  Living Room Media ", "EMERALD", "tv")
    assert name == "Living Room Media"
    assert color == "emerald"
    assert icon == "tv"

    with pytest.raises(HTTPException) as exc1:
        validate_group_fields("   ")
    assert exc1.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        validate_group_fields("Kids", color_badge="chartreuse")
    assert exc2.value.status_code == 400

    with pytest.raises(HTTPException) as exc3:
        _require_group_or_404(None, 999)
    assert exc3.value.status_code == 404

    now = utc_now()
    d_allowed = Device(
        id=1,
        mac_address="aa:bb:cc:00:00:01",
        ipv4_address="192.168.1.11",
        hostname="ipad-1",
        display_name="Kids iPad",
        is_online=True,
        is_blocked=False,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    d_blocked = Device(
        id=2,
        mac_address="aa:bb:cc:00:00:02",
        ipv4_address="192.168.1.12",
        hostname="switch-2",
        display_name="Kids Switch",
        is_online=True,
        is_blocked=True,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    d_protected = Device(
        id=3,
        mac_address="aa:bb:cc:00:00:03",
        ipv4_address="192.168.1.13",
        hostname="proxmox",
        display_name="Proxmox Host",
        is_online=True,
        is_blocked=False,
        is_protected=True,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    d_no_ip = Device(
        id=4,
        mac_address="aa:bb:cc:00:00:04",
        ipv4_address=None,
        hostname="old-kindle",
        display_name="Old Kindle",
        is_online=False,
        is_blocked=False,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )

    r_allowed = build_device_response(d_allowed, test_settings)
    r_blocked = build_device_response(d_blocked, test_settings)
    r_protected = build_device_response(d_protected, test_settings)
    r_no_ip = build_device_response(d_no_ip, test_settings)

    assert compute_group_access_status([]) == "empty"
    assert compute_group_access_status([r_protected, r_no_ip]) == "empty"
    assert compute_group_access_status([r_allowed, r_protected]) == "allowed"
    assert compute_group_access_status([r_blocked, r_protected]) == "blocked"
    assert compute_group_access_status([r_allowed, r_blocked]) == "partially_blocked"

    block_plan = plan_group_bulk_action(
        [r_allowed, r_blocked, r_protected, r_no_ip],
        action="block",
    )
    assert block_plan["eligible_device_ids"] == [1, 2]
    assert block_plan["eligible_ips"] == ["192.168.1.11", "192.168.1.12"]
    assert block_plan["skipped_protected_names"] == ["Proxmox Host"]
    assert block_plan["skipped_no_ip_names"] == ["Old Kindle"]

    unblock_plan = plan_group_bulk_action(
        [r_allowed, r_blocked, r_no_ip],
        action="unblock",
    )
    assert unblock_plan["eligible_device_ids"] == [1, 2, 4]
    assert unblock_plan["eligible_ips"] == ["192.168.1.11", "192.168.1.12"]
    assert unblock_plan["skipped_no_ip_names"] == ["Old Kindle"]

    grp = DeviceGroup(
        id=10,
        name="Kids Profile",
        description="Kids devices",
        color_badge="indigo",
        icon="users",
        created_at=now,
        updated_at=now,
    )
    m1 = DeviceGroupMembership(id=1, group_id=10, device_id=1, created_at=now)
    m2 = DeviceGroupMembership(id=2, group_id=10, device_id=2, created_at=now)
    assembled = assemble_group_responses(
        [grp], [m1, m2], [d_allowed, d_blocked], test_settings
    )
    assert len(assembled) == 1
    grp_resp = assembled[0]
    assert grp_resp.access_status == "partially_blocked"
    assert grp_resp.total_devices == 2

    empty_analytics = _build_empty_group_analytics_response(
        grp_resp,
        tracked_ips=["192.168.1.11", "192.168.1.12"],
        window="24h",
        warning="ES offline",
        es_reachable=False,
    )
    assert empty_analytics.es_reachable is False
    assert len(empty_analytics.member_breakdown) == 2

    full_analytics = _assemble_group_analytics_response(
        grp_resp,
        tracked_ips=["192.168.1.11", "192.168.1.12"],
        es_data={
            "summary": {
                "total_events": 500,
                "total_bytes": 250000,
                "dns_query_count": 300,
                "firewall_event_count": 200,
                "allowed_packet_count": 190,
                "blocked_packet_count": 10,
                "active_hours_in_day": 6,
                "first_active_at": "2026-10-31T08:00:00Z",
                "last_active_at": "2026-10-31T17:00:00Z",
            },
            "member_ip_breakdown": [
                {
                    "ip": "192.168.1.11",
                    "total_events": 400,
                    "bytes": 200000,
                    "dns_query_count": 250,
                    "allowed_packet_count": 140,
                    "blocked_packet_count": 10,
                }
            ],
            "timeline": [],
            "hourly_access_profile": [],
            "top_domains": [{"domain": "youtube.com", "query_count": 80}],
            "top_registered_domains": [{"domain": "youtube.com", "query_count": 80}],
            "top_organizations": [
                {"organization": "Google LLC", "packet_count": 120, "bytes": 180000}
            ],
            "recent_queries": [
                {
                    "timestamp": "2026-10-31T17:00:00Z",
                    "domain": "m.youtube.com",
                    "registered_domain": "youtube.com",
                    "record_type": "AAAA",
                    "source_ip": "192.168.1.11",
                }
            ],
        },
        window="24h",
    )
    assert full_analytics.summary.total_bytes == 250000
    assert full_analytics.member_breakdown[0].effective_name == "Kids iPad"
    assert full_analytics.member_breakdown[0].bytes == 200000
    assert full_analytics.recent_queries[0].device_name == "Kids iPad"


@pytest.mark.asyncio
async def test_groups_crud_bulk_block_unblock_and_analytics_endpoints(
    async_client: AsyncClient,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify /api/v1/groups CRUD, device badges/filters, bulk block/unblock, and analytics."""
    get_analytics_cache().clear()

    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200

    factory = get_session_factory(test_settings)
    now = utc_now()
    async with factory() as session:
        d1 = Device(
            mac_address="aa:bb:cc:11:22:01",
            ipv4_address="192.168.1.61",
            hostname="kid-tablet",
            display_name="Kid Tablet",
            vendor="Apple",
            interface_name="lan",
            lease_type="dynamic",
            is_online=True,
            is_blocked=False,
            is_protected=False,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        d2 = Device(
            mac_address="aa:bb:cc:11:22:02",
            ipv4_address="192.168.1.62",
            hostname="kid-laptop",
            display_name="Kid Laptop",
            vendor="Dell",
            interface_name="lan",
            lease_type="dynamic",
            is_online=True,
            is_blocked=False,
            is_protected=False,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        d3_protected = Device(
            mac_address="aa:bb:cc:11:22:03",
            ipv4_address="192.168.1.63",
            hostname="nas-server",
            display_name="Home NAS",
            vendor="Synology",
            interface_name="lan",
            lease_type="static",
            is_online=True,
            is_blocked=False,
            is_protected=True,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        d4_no_ip = Device(
            mac_address="aa:bb:cc:11:22:04",
            ipv4_address=None,
            hostname="offline-watch",
            display_name="Offline Watch",
            vendor="Garmin",
            interface_name="lan",
            lease_type="dynamic",
            is_online=False,
            is_blocked=False,
            is_protected=False,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        session.add_all([d1, d2, d3_protected, d4_no_ip])
        await session.commit()
        await session.refresh(d1)
        await session.refresh(d2)
        await session.refresh(d3_protected)
        await session.refresh(d4_no_ip)
        d1_id, d2_id, d3_id, d4_id = d1.id, d2.id, d3_protected.id, d4_no_ip.id

    # 1. Create group
    create_resp = await async_client.post(
        "/api/v1/groups",
        json={
            "name": "Kids Profile",
            "description": "Tablet and laptop",
            "color_badge": "indigo",
            "icon": "users",
            "device_ids": [d1_id, d2_id, d3_id, d4_id],
        },
    )
    assert create_resp.status_code == 201
    grp_data = create_resp.json()
    grp_id = grp_data["id"]
    assert grp_data["access_status"] == "allowed"
    assert grp_data["total_devices"] == 4
    assert grp_data["blockable_devices"] == 2

    # Duplicate name conflict (409)
    dup_resp = await async_client.post(
        "/api/v1/groups",
        json={"name": "kids profile", "color_badge": "rose"},
    )
    assert dup_resp.status_code == 409

    # Missing device IDs (404)
    missing_dev_resp = await async_client.post(
        "/api/v1/groups",
        json={"name": "Invalid Members", "device_ids": [99999]},
    )
    assert missing_dev_resp.status_code == 404

    # 2. Check /api/v1/devices includes group badges and supports group_id & status=unassigned
    devs_by_group = await async_client.get(f"/api/v1/devices?group_id={grp_id}")
    assert devs_by_group.status_code == 200
    assert len(devs_by_group.json()["devices"]) == 4
    assert devs_by_group.json()["devices"][0]["groups"][0]["name"] == "Kids Profile"

    unassigned_resp = await async_client.get("/api/v1/devices?status=unassigned")
    assert unassigned_resp.status_code == 200
    assert len(unassigned_resp.json()["devices"]) == 0

    # 3. Bulk block group against mocked OPNsense
    with respx.mock(
        base_url=test_settings.opnsense_base_url, assert_all_called=False
    ) as respx_mock:
        respx_mock.get(
            "/api/firewall/alias_util/list/gateway_blocked_devices"
        ).mock(return_value=Response(200, json={"rows": []}))
        respx_mock.post(
            "/api/firewall/alias_util/add/gateway_blocked_devices"
        ).mock(return_value=Response(200, json={"status": "done"}))
        respx_mock.post("/api/diagnostics/firewall/kill_states").mock(
            return_value=Response(200, json={"result": "ok", "dropped": 5})
        )

        block_resp = await async_client.post(f"/api/v1/groups/{grp_id}/block")
        assert block_resp.status_code == 200
        b_body = block_resp.json()
        assert b_body["action"] == "block"
        assert b_body["group"]["access_status"] == "blocked"
        assert sorted(b_body["affected_ips"]) == ["192.168.1.61", "192.168.1.62"]
        assert b_body["skipped_protected_names"] == ["Home NAS"]
        assert b_body["skipped_no_ip_names"] == ["Offline Watch"]

    # 4. Bulk unblock group against mocked OPNsense
    with respx.mock(
        base_url=test_settings.opnsense_base_url, assert_all_called=False
    ) as respx_mock:
        respx_mock.get(
            "/api/firewall/alias_util/list/gateway_blocked_devices"
        ).mock(
            return_value=Response(
                200,
                json={
                    "rows": [
                        {"ip": "192.168.1.61"},
                        {"ip": "192.168.1.62"},
                    ]
                },
            )
        )
        respx_mock.post(
            "/api/firewall/alias_util/delete/gateway_blocked_devices"
        ).mock(return_value=Response(200, json={"status": "done"}))

        unblock_resp = await async_client.post(f"/api/v1/groups/{grp_id}/unblock")
        assert unblock_resp.status_code == 200
        u_body = unblock_resp.json()
        assert u_body["action"] == "unblock"
        assert u_body["group"]["access_status"] == "allowed"

    # 5. Group Analytics endpoint (mock ES)
    async def mock_fetch_group_analytics(
        self: ElasticsearchServiceClient,
        ipv4_addresses: list[str],
        window: str = "24h",
        domain_search: str | None = None,
        top_n: int = 15,
        recent_limit: int = 40,
    ) -> dict[str, Any]:
        return {
            "window": window,
            "summary": {
                "total_events": 420,
                "total_bytes": 98000,
                "dns_query_count": 300,
                "firewall_event_count": 120,
                "allowed_packet_count": 110,
                "blocked_packet_count": 10,
                "active_hours_in_day": 4,
                "first_active_at": "2026-10-31T10:00:00Z",
                "last_active_at": "2026-10-31T17:00:00Z",
            },
            "member_ip_breakdown": [
                {
                    "ip": "192.168.1.61",
                    "total_events": 300,
                    "bytes": 70000,
                    "dns_query_count": 200,
                    "allowed_packet_count": 90,
                    "blocked_packet_count": 10,
                }
            ],
            "timeline": [],
            "hourly_access_profile": [],
            "top_domains": [{"domain": "disneyplus.com", "query_count": 55}],
            "top_registered_domains": [{"domain": "disneyplus.com", "query_count": 55}],
            "top_organizations": [],
            "recent_queries": [
                {
                    "timestamp": "2026-10-31T17:00:00Z",
                    "domain": "disneyplus.com",
                    "registered_domain": "disneyplus.com",
                    "record_type": "A",
                    "source_ip": "192.168.1.61",
                }
            ],
        }

    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_group_analytics",
        mock_fetch_group_analytics,
    )

    analytics_resp = await async_client.get(f"/api/v1/groups/{grp_id}/analytics?window=24h")
    assert analytics_resp.status_code == 200
    a_body = analytics_resp.json()
    assert a_body["es_reachable"] is True
    assert a_body["summary"]["total_bytes"] == 98000
    assert a_body["member_breakdown"][0]["effective_name"] == "Kid Tablet"
    assert a_body["recent_queries"][0]["device_name"] == "Kid Tablet"

    # Cached hit
    analytics_cached = await async_client.get(f"/api/v1/groups/{grp_id}/analytics?window=24h")
    assert analytics_cached.status_code == 200

    # ES error fallback
    async def mock_fetch_group_analytics_error(
        self: ElasticsearchServiceClient,
        *args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        raise ElasticsearchQueryError("ES timeout", status_code=503)

    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_group_analytics",
        mock_fetch_group_analytics_error,
    )
    analytics_err = await async_client.get(
        f"/api/v1/groups/{grp_id}/analytics?window=24h&refresh=true"
    )
    assert analytics_err.status_code == 200
    assert analytics_err.json()["es_reachable"] is False

    # 6. Patch group & Put members
    patch_resp = await async_client.patch(
        f"/api/v1/groups/{grp_id}",
        json={"name": "Kids Devices Updated", "color_badge": "emerald", "description": "Updated"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["name"] == "Kids Devices Updated"

    put_members_resp = await async_client.put(
        f"/api/v1/groups/{grp_id}/members",
        json={"device_ids": [d4_id]},  # Only the IP-less device
    )
    assert put_members_resp.status_code == 200
    assert put_members_resp.json()["access_status"] == "empty"

    # Analytics on group with no IPs
    no_ip_analytics = await async_client.get(f"/api/v1/groups/{grp_id}/analytics")
    assert no_ip_analytics.status_code == 200
    assert "No member devices with an IPv4 address" in (no_ip_analytics.json()["warning"] or "")

    # Blocking group with no blockable IPs returns 400
    no_ip_block = await async_client.post(f"/api/v1/groups/{grp_id}/block")
    assert no_ip_block.status_code == 400

    # List & Get single group & Delete group
    list_resp = await async_client.get("/api/v1/groups")
    assert list_resp.status_code == 200
    assert len(list_resp.json()["groups"]) == 1

    single_resp = await async_client.get(f"/api/v1/groups/{grp_id}")
    assert single_resp.status_code == 200

    del_resp = await async_client.delete(f"/api/v1/groups/{grp_id}")
    assert del_resp.status_code == 204

    empty_list = await async_client.get("/api/v1/groups")
    assert empty_list.json()["groups"] == []
