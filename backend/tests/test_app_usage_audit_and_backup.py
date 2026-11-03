"""Unit tests for Phase 7 Step 7.2: YouTube/Plex Usage Time, Audit Logs, and Backup/Restore."""

from __future__ import annotations

import json
from datetime import timedelta

import httpx
import pytest
import respx
from httpx import AsyncClient

from app.clients.elasticsearch import (
    _build_app_usage_agg,
    _extract_app_usage,
    build_device_analytics_query,
    build_group_analytics_query,
    build_network_overview_query,
    normalize_device_analytics_response,
    normalize_network_overview_response,
)
from app.config import Settings
from app.db import get_session_factory
from app.models import AuditLog, utc_now
from app.services.audit_and_backup_service import (
    ConfigBackupDeviceItem,
    ConfigBackupGroupItem,
    ConfigBackupScheduleItem,
    prepare_restored_devices,
    prepare_restored_groups,
    prepare_restored_schedules,
)


def test_elasticsearch_youtube_and_plex_usage_aggregation_and_extraction() -> None:
    """Verify `_build_app_usage_agg` and `_extract_app_usage` compute 5-min active buckets."""
    agg_dsl = _build_app_usage_agg("America/Los_Angeles")
    assert "youtube" in agg_dsl["filters"]["filters"]
    assert "plex" in agg_dsl["filters"]["filters"]

    overview_q = build_network_overview_query("24h", "UTC")
    device_q = build_device_analytics_query("192.168.1.60", "24h", "UTC")
    group_q = build_group_analytics_query(["192.168.1.60", "192.168.1.61"], "24h", "UTC")
    assert "app_usage" in overview_q["aggs"]
    assert "app_usage" in device_q["aggs"]
    assert "app_usage" in group_q["aggs"]

    fake_aggs = {
        "app_usage": {
            "buckets": {
                "youtube": {
                    "doc_count": 48,
                    "active_slots": {
                        "buckets": [
                            {"key_as_string": "2026-11-01T18:00:00Z", "doc_count": 12},
                            {"key_as_string": "2026-11-01T18:05:00Z", "doc_count": 19},
                            {"key_as_string": "2026-11-01T18:10:00Z", "doc_count": 17},
                        ]
                    },
                    "bytes": {"value": 125_000_000},
                    "dns_queries": {"doc_count": 32},
                    "last_active": {"value_as_string": "2026-11-01T18:12:40Z"},
                },
                "plex": {
                    "doc_count": 90,
                    "active_slots": {
                        "buckets": [
                            {"key_as_string": "2026-11-01T19:00:00Z", "doc_count": 30},
                            {"key_as_string": "2026-11-01T19:05:00Z", "doc_count": 25},
                            {"key_as_string": "2026-11-01T19:10:00Z", "doc_count": 20},
                            {"key_as_string": "2026-11-01T19:15:00Z", "doc_count": 15},
                        ]
                    },
                    "bytes": {"value": 840_000_000},
                    "dns_queries": {"doc_count": 14},
                    "last_active": {"value_as_string": "2026-11-01T19:18:10Z"},
                },
            }
        }
    }

    extracted = _extract_app_usage(fake_aggs)
    assert len(extracted) == 2
    yt, plex = extracted[0], extracted[1]
    assert yt["app_key"] == "youtube"
    assert yt["display_name"] == "YouTube"
    assert yt["active_minutes"] == 15  # 3 slots * 5m
    assert yt["event_count"] == 48
    assert yt["dns_queries"] == 32
    assert yt["bytes"] == 125_000_000
    assert yt["last_active_at"] == "2026-11-01T18:12:40Z"

    assert plex["app_key"] == "plex"
    assert plex["display_name"] == "Plex"
    assert plex["active_minutes"] == 20  # 4 slots * 5m
    assert plex["bytes"] == 840_000_000

    norm_ov = normalize_network_overview_response(
        {"hits": {"total": {"value": 138}}, "aggregations": fake_aggs},
        window="24h",
    )
    assert norm_ov["application_usage"][0]["active_minutes"] == 15
    assert norm_ov["application_usage"][1]["active_minutes"] == 20

    norm_dev = normalize_device_analytics_response(
        {"hits": {"total": {"value": 138}}, "aggregations": fake_aggs},
        {"hits": {"hits": []}},
        window="24h",
    )
    assert norm_dev["application_usage"][0]["active_minutes"] == 15

    # Test pure synchronous backup/restore reconciliation helpers
    now = utc_now()
    dev_map, new_devs, dev_cnt = prepare_restored_devices(
        [],
        [
            ConfigBackupDeviceItem(
                mac_address="aa:bb:cc:dd:ee:01",
                display_name="TV",
                is_youtube_blocked=True,
            )
        ],
        now,
    )
    assert dev_cnt == 1 and len(new_devs) == 1
    new_devs[0].id = 10
    grp_map, new_grps, grp_cnt = prepare_restored_groups(
        [],
        [
            ConfigBackupGroupItem(
                name="Kids", color_badge="emerald", member_macs=["aa:bb:cc:dd:ee:01"]
            )
        ],
        now,
    )
    assert grp_cnt == 1 and len(new_grps) == 1
    new_grps[0].id = 20
    new_scheds, sched_cnt = prepare_restored_schedules(
        [],
        [
            ConfigBackupScheduleItem(
                name="Device Bedtime",
                target_type="device",
                device_mac="aa:bb:cc:dd:ee:01",
                days_of_week=[0, 1],
                start_time="21:00",
                end_time="06:00",
            )
        ],
        dev_map,
        grp_map,
        now,
    )
    assert sched_cnt == 1 and len(new_scheds) == 1


@respx.mock
@pytest.mark.asyncio
async def test_audit_logs_pruning_backup_restore_and_security_headers(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify `/api/v1/audit-logs`, 90d pruning, `/api/v1/system/{backup,restore}`, and headers."""
    base = test_settings.opnsense_base_url
    respx.get(f"{base}/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "ip": "192.168.1.60",
                    "mac": "AA:BB:CC:DD:EE:60",
                    "hostname": "livingroom-appletv",
                    "intf_description": "LAN",
                    "expired": False,
                }
            ],
        )
    )
    respx.get(f"{base}/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )
    respx.get(f"{base}/api/firewall/alias_util/list/gateway_blocked_devices").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )

    # Check security headers on ping
    ping_resp = await async_client.get("/api/v1/system/ping")
    assert ping_resp.status_code == 200
    assert ping_resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert ping_resp.headers.get("X-Frame-Options") == "DENY"
    assert ping_resp.headers.get("Referrer-Policy") == "same-origin"

    login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login.status_code == 200

    # Insert an expired (>90 days old) audit log row to test pruning
    factory = get_session_factory(test_settings)
    async with factory() as session:
        session.add(
            AuditLog(
                actor="legacy",
                action="legacy.event",
                target="old-device",
                status="success",
                details="Should be pruned",
                created_at=utc_now() - timedelta(days=95),
            )
        )
        await session.commit()

    # Sync devices, rename device, create group, create schedule
    sync_resp = await async_client.post("/api/v1/devices/sync")
    dev_id = sync_resp.json()["devices"][0]["id"]

    await async_client.patch(
        f"/api/v1/devices/{dev_id}",
        json={"display_name": "Living Room Apple TV", "notes": "4K Media Box"},
    )
    grp_resp = await async_client.post(
        "/api/v1/groups",
        json={
            "name": "Living Room Media",
            "description": "Streaming devices",
            "color_badge": "cyan",
            "icon": "tv",
            "device_ids": [dev_id],
        },
    )
    assert grp_resp.status_code == 201
    grp_id = grp_resp.json()["id"]

    sched_resp = await async_client.post(
        "/api/v1/schedules",
        json={
            "name": "Late Night Media Off",
            "description": "Turn off media at 23:00",
            "target_type": "group",
            "group_id": grp_id,
            "days_of_week": [0, 1, 2, 3, 4],
            "start_time": "23:00",
            "end_time": "06:00",
            "timezone": "America/Los_Angeles",
            "is_enabled": True,
        },
    )
    assert sched_resp.status_code == 201

    # Query audit logs (verifies >90d record was pruned and filters work)
    logs_resp = await async_client.get("/api/v1/audit-logs")
    assert logs_resp.status_code == 200
    logs_data = logs_resp.json()
    assert logs_data["total_count"] >= 2
    assert all(item["action"] != "legacy.event" for item in logs_data["items"])

    filtered_logs = await async_client.get(
        "/api/v1/audit-logs",
        params={"action": "device.update", "search": "Apple TV"},
    )
    assert filtered_logs.status_code == 200
    assert filtered_logs.json()["total_count"] == 1

    # Export configuration backup and verify no secrets are included
    backup_resp = await async_client.get("/api/v1/system/backup")
    assert backup_resp.status_code == 200
    backup_payload = backup_resp.json()
    raw_json_str = json.dumps(backup_payload)
    assert test_settings.opnsense_api_key.get_secret_value() not in raw_json_str
    assert test_settings.elasticsearch_api_key.get_secret_value() not in raw_json_str
    assert len(backup_payload["devices"]) == 1
    assert len(backup_payload["groups"]) == 1
    assert len(backup_payload["schedules"]) == 1

    # Modify backup payload and restore
    backup_payload["devices"][0]["display_name"] = "Restored Apple TV"
    backup_payload["devices"].append(
        {
            "mac_address": "AA:BB:CC:DD:EE:99",
            "display_name": "New Pre-Provisioned Tablet",
            "notes": "Imported via JSON restore",
            "is_protected": False,
            "is_manually_blocked": False,
            "is_youtube_blocked": True,
        }
    )
    restore_resp = await async_client.post("/api/v1/system/restore", json=backup_payload)
    assert restore_resp.status_code == 200
    restore_summary = restore_resp.json()
    assert restore_summary["devices_updated"] == 2
    assert restore_summary["groups_upserted"] == 1
    assert restore_summary["schedules_upserted"] == 1
