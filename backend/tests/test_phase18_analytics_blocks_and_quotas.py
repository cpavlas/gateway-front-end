"""Unit & API integration tests for Phase 18 (`FB-P18-001`..`003`, `FB-P17-006`)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
import respx
from fastapi import HTTPException
from httpx import AsyncClient, Response
from sqlalchemy import select

from app.api.system import get_elasticsearch_client
from app.clients.elasticsearch import (
    _build_app_usage_agg,
    _extract_app_usage,
    _extract_asn_number,
    build_target_attribution_query,
    normalize_network_overview_response,
    normalize_target_attribution_response,
)
from app.clients.opnsense import OPNsenseClient
from app.clients.plex import format_plex_video_resolution, normalize_plex_sessions_payload
from app.config import Settings
from app.db import get_session_factory
from app.models import (
    BlockedTarget,
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    TemporaryOverride,
    normalize_block_scope_type,
    normalize_block_target_type,
    normalize_block_target_value,
    utc_now,
    validate_daily_youtube_limit_minutes,
)
from app.services.analytics_service import (
    BlockedTargetCreateRequest,
    _apply_plex_override_to_es_data,
    _assemble_device_analytics_response,
    _assemble_network_overview_response,
    _build_empty_device_analytics_response,
    _build_empty_overview_response,
    _build_zero_app_usage,
    _enrich_top_devices_with_sqlite,
    _parse_app_usage_items,
    apply_blocked_target_toggle,
    assemble_target_attribution_response,
    build_blocked_target_response,
    collect_opnsense_custom_block_inputs,
    enrich_attribution_clients_with_sqlite,
    get_analytics_cache,
    prepare_blocked_target_delete_audit,
    prepare_blocked_target_upsert,
    validate_attribution_params,
)
from app.services.audit_and_backup_service import (
    ConfigBackupBlockedTargetItem,
    ConfigBackupGroupItem,
    assemble_backup_payload,
    prepare_restored_blocked_targets,
    prepare_restored_groups,
)
from app.services.group_service import (
    _assemble_group_analytics_response,
    _build_empty_group_analytics_response,
    assemble_group_responses,
    compute_group_access_status,
    compute_group_youtube_quota_state,
    compute_group_youtube_status,
    plan_group_bulk_action,
    resolve_group_today_youtube_minutes,
    validate_group_fields,
)
from app.services.schedule_service import (
    collect_quota_exceeded_youtube_targets,
    plan_youtube_schedule_actions,
    reconcile_schedules_and_policies,
)
from app.services.timer_service import ActiveOverrideInfo


async def _login_admin(
    client: AsyncClient,
    password: str = "TestStrongPassword!2026",  # noqa: S107
) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": password},
    )
    assert resp.status_code == 200


def test_phase18_domain_asn_and_quota_validators() -> None:
    """Verify domain, ASN, scope, and daily YouTube limit normalization helpers."""
    assert normalize_block_target_type(" DOMAIN ") == "domain"
    assert normalize_block_target_type("ASN") == "asn"
    with pytest.raises(ValueError):
        normalize_block_target_type("cidr")

    assert normalize_block_scope_type(None) == "global"
    assert normalize_block_scope_type(" DEVICE ") == "device"
    with pytest.raises(ValueError):
        normalize_block_scope_type("group")

    assert normalize_block_target_value("domain", " *.Ads.TikTok.COM. ") == "ads.tiktok.com"
    with pytest.raises(ValueError):
        normalize_block_target_value("domain", "not_a_domain")

    assert normalize_block_target_value("asn", "15169") == "AS15169"
    assert normalize_block_target_value("asn", " as32934 ") == "AS32934"
    with pytest.raises(ValueError):
        normalize_block_target_value("asn", "bad-asn")

    assert validate_daily_youtube_limit_minutes(None) is None
    assert validate_daily_youtube_limit_minutes(60) == 60
    with pytest.raises(ValueError):
        validate_daily_youtube_limit_minutes(0)
    with pytest.raises(ValueError):
        validate_daily_youtube_limit_minutes(2000)


def test_phase18_multi_app_asn_attribution_and_plex_normalization(
    test_settings: Settings,
) -> None:
    """Verify 8-app extraction, numeric ASN parsing, attribution normalization, and Plex fields."""
    agg = _build_app_usage_agg("America/Los_Angeles", excluded_ips=["192.168.1.1"])
    filters = agg["filters"]["filters"]
    for key in (
        "youtube",
        "plex",
        "netflix",
        "disney_plus",
        "twitch",
        "tiktok",
        "discord",
        "gaming",
    ):
        assert key in filters

    fake_aggs = {
        "app_usage": {
            "buckets": {
                "netflix": {
                    "doc_count": 14,
                    "bytes": {"value": 450_000_000},
                    "dns_queries": {"doc_count": 14},
                    "last_active": {"value_as_string": "2026-11-15T01:10:00Z"},
                    "by_device": {
                        "devices": {
                            "buckets": [
                                {
                                    "key": "192.168.1.60",
                                    "doc_count": 14,
                                    "bytes": {"value": 450_000_000},
                                    "dns_queries": {"doc_count": 14},
                                    "active_slots": {
                                        "buckets": [
                                            {"key_as_string": "s1", "doc_count": 4},
                                            {"key_as_string": "s2", "doc_count": 10},
                                        ]
                                    },
                                }
                            ]
                        }
                    },
                },
                "gaming": {
                    "doc_count": 20,
                    "bytes": {"value": 120_000_000},
                    "dns_queries": {"doc_count": 20},
                    "active_slots": {
                        "buckets": [
                            {"key_as_string": "g1", "doc_count": 6},
                        ]
                    },
                },
            }
        },
        "filterlog_orgs": {
            "top_asn_orgs": {
                "buckets": [
                    {
                        "key": "GOOGLE",
                        "doc_count": 320,
                        "bytes": {"value": 85_000_000},
                        "asn": {"buckets": [{"key": 15169, "doc_count": 320}]},
                    },
                    {
                        "key": "UNKNOWN-NO-ASN",
                        "doc_count": 10,
                        "bytes": {"value": 1000},
                        "asn": {"buckets": []},
                    },
                ]
            }
        },
    }
    extracted = _extract_app_usage(fake_aggs)
    by_key = {item["app_key"]: item for item in extracted}
    assert len(extracted) == 9
    assert by_key["netflix"]["active_minutes"] == 10
    assert by_key["netflix"]["top_devices"][0]["ipv4_address"] == "192.168.1.60"
    assert by_key["gaming"]["active_minutes"] == 5

    assert _extract_asn_number(fake_aggs["filterlog_orgs"]["top_asn_orgs"]["buckets"][0]) == 15169
    assert _extract_asn_number(fake_aggs["filterlog_orgs"]["top_asn_orgs"]["buckets"][1]) is None

    overview = normalize_network_overview_response(
        {"hits": {"total": {"value": 400}}, "aggregations": fake_aggs},
        window="today",
    )
    assert overview["top_organizations"][0]["asn"] == 15169
    assert overview["top_organizations"][1]["asn"] is None

    attr_q = build_target_attribution_query("asn", "AS15169", window="today", tz_name="UTC")
    assert {"term": {"destination.as.number": 15169}} in attr_q["query"]["bool"]["filter"]

    attr_dom_q = build_target_attribution_query("domain", "www.netflix.com", window="today")
    assert {"term": {"dns.question.name": "www.netflix.com"}} in attr_dom_q["query"]["bool"][
        "filter"
    ]

    norm_attr = normalize_target_attribution_response(
        {
            "hits": {"total": {"value": 45}},
            "aggregations": {
                "total_bytes": {"value": 9_500_000},
                "by_client_ip": {
                    "buckets": [
                        {
                            "key": "192.168.1.60",
                            "doc_count": 40,
                            "bytes": {"value": 9_000_000},
                            "dns_queries": {"doc_count": 5},
                            "allowed_packets": {"doc_count": 35},
                            "blocked_packets": {"doc_count": 0},
                            "last_seen": {"value_as_string": "2026-11-15T01:15:00Z"},
                        },
                        {
                            "key": "8.8.8.8",
                            "doc_count": 5,
                            "bytes": {"value": 500_000},
                        },
                    ]
                },
            },
        },
        target_type="asn",
        target_value="AS15169",
        window="today",
    )
    assert norm_attr["total_events"] == 45
    assert len(norm_attr["clients"]) == 1
    assert norm_attr["clients"][0]["ipv4_address"] == "192.168.1.60"

    now = utc_now()
    dev = Device(
        id=7,
        mac_address="aa:bb:cc:dd:ee:07",
        ipv4_address="192.168.1.60",
        display_name="Kids Apple TV",
        is_online=True,
        is_blocked=False,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    enriched_clients = enrich_attribution_clients_with_sqlite(
        norm_attr["clients"], [dev], test_settings
    )
    assert enriched_clients[0].device_id == 7
    assert enriched_clients[0].effective_name == "Kids Apple TV"

    # Synchronous analytics_service helper coverage (pure functions)
    zero_apps = _build_zero_app_usage()
    assert len(zero_apps) == 9
    plex_overridden = _apply_plex_override_to_es_data(
        {"application_usage": []},
        {"app_key": "plex", "display_name": "Plex", "active_minutes": 15},
    )
    parsed_apps = _parse_app_usage_items(plex_overridden, [dev], test_settings)
    assert any(a.app_key == "plex" and a.active_minutes == 15 for a in parsed_apps)

    enriched_top_devs = _enrich_top_devices_with_sqlite(
        [
            {
                "ipv4_address": "192.168.1.60",
                "total_events": 25,
                "bytes": 1000,
                "dns_queries": 5,
                "allowed_packets": 20,
                "blocked_packets": 0,
                "last_seen_at": now.isoformat(),
            }
        ],
        [dev],
        test_settings,
    )
    assert enriched_top_devs[0].device_id == 7
    assembled_overview = _assemble_network_overview_response(
        {"summary": {"total_events": 25}, "top_devices": [], "application_usage": extracted},
        [dev],
        test_settings,
        "today",
    )
    assert assembled_overview.summary.total_events == 25
    empty_ov = _build_empty_overview_response("today", "ES down")
    assert empty_ov.es_reachable is False

    from app.services.device_service import build_device_response

    dev_resp = build_device_response(dev, test_settings, None)
    empty_dev = _build_empty_device_analytics_response(dev_resp, "today", "ES down")
    assert empty_dev.es_reachable is False
    assembled_dev = _assemble_device_analytics_response(
        dev_resp, {"summary": {"total_events": 12}}, "today"
    )
    assert assembled_dev.summary.total_events == 12
    bt_row = BlockedTarget(
        id=5,
        target_type="domain",
        target_value="ads.example.com",
        scope_type="device",
        device_id=7,
        organization_name="",
        reason="Ad",
        is_enabled=True,
        created_at=now,
        updated_at=now,
    )
    bt_resp = build_blocked_target_response(bt_row, {7: dev})
    assert bt_resp.device_ip == "192.168.1.60"

    assert format_plex_video_resolution("1080") == "1080p"
    assert format_plex_video_resolution("4k") == "4K"
    plex_sessions = normalize_plex_sessions_payload(
        {
            "MediaContainer": {
                "Metadata": [
                    {
                        "sessionKey": "55",
                        "type": "movie",
                        "title": "Dune",
                        "year": 2021,
                        "viewOffset": 300000,
                        "duration": 1200000,
                        "User": {"title": "alex"},
                        "Player": {
                            "address": "::ffff:192.168.1.60",
                            "title": "Apple TV",
                            "product": "Plex for tvOS",
                            "platform": "tvOS",
                            "state": "playing",
                        },
                        "Media": [{"videoResolution": "1080", "bitrate": 12500}],
                        "Session": {"id": "s-55", "bandwidth": 8400},
                        "TranscodeSession": {
                            "videoDecision": "transcode",
                            "bitrate": 8000,
                        },
                    }
                ]
            }
        }
    )
    assert plex_sessions[0]["video_resolution"] == "1080p"
    assert plex_sessions[0]["transcode_bitrate_kbps"] == 8000
    assert plex_sessions[0]["user_name"] == "alex"
    assert plex_sessions[0]["progress_percent"] == 25.0


def test_phase18_group_youtube_quota_bonus_precedence_and_backup() -> None:
    """Verify daily group YouTube quota enforcement, bonus timer override, and backup round-trip."""
    assert compute_group_youtube_quota_state(None, 50) == (50, False)
    assert compute_group_youtube_quota_state(60, 45) == (45, False)
    assert compute_group_youtube_quota_state(60, 60) == (60, True)

    now = utc_now()
    kids_grp = DeviceGroup(
        id=1,
        name="Kids",
        description="Kids tablets",
        color_badge="indigo",
        icon="users",
        daily_youtube_limit_minutes=60,
        created_at=now,
        updated_at=now,
    )
    d_kid = Device(
        id=11,
        mac_address="aa:bb:cc:11:22:33",
        ipv4_address="192.168.1.70",
        display_name="Kids iPad",
        is_online=True,
        is_blocked=False,
        is_youtube_blocked=False,
        is_protected=False,
    )
    d_prot = Device(
        id=12,
        mac_address="aa:bb:cc:11:22:34",
        ipv4_address="192.168.1.71",
        display_name="Admin Laptop",
        is_online=True,
        is_blocked=False,
        is_youtube_blocked=False,
        is_protected=True,
    )

    quota_map, managed_ids = collect_quota_exceeded_youtube_targets(
        [kids_grp],
        {1: [11, 12]},
        {1: 65},
    )
    assert 11 in quota_map
    assert managed_ids == {11, 12}

    to_block, to_unblock = plan_youtube_schedule_actions(
        [d_kid, d_prot],
        [],
        {},
        {},
        {1: [11, 12]},
        set(),
        frozenset({"192.168.1.1"}),
        youtube_quota_map=quota_map,
        quota_managed_device_ids=managed_ids,
    )
    assert [d.id for d, _ in to_block] == [11]
    assert to_unblock == []

    # Reward / Bonus timer overrides reached quota and unblocks YouTube!
    d_kid.is_youtube_blocked = True
    bonus_ov = ActiveOverrideInfo(
        id=99,
        target_type="group",
        target_id=1,
        mode="bonus",
        duration_minutes=30,
        reason="Finished homework",
        created_by="admin",
        created_at=now.isoformat(),
        expires_at=(now + timedelta(minutes=30)).isoformat(),
        remaining_seconds=1800,
        is_active=True,
    )
    to_block_b, to_unblock_b = plan_youtube_schedule_actions(
        [d_kid, d_prot],
        [],
        {},
        {11: bonus_ov},
        {1: [11, 12]},
        {"192.168.1.70"},
        frozenset({"192.168.1.1"}),
        youtube_quota_map=quota_map,
        quota_managed_device_ids=managed_ids,
    )
    assert to_block_b == []
    assert [d.id for d in to_unblock_b] == [11]

    # Backup / Restore round-trip preserves daily_youtube_limit_minutes & blocked_targets
    bt_global = BlockedTarget(
        id=1,
        target_type="domain",
        target_value="doubleclick.net",
        scope_type="global",
        device_id=None,
        organization_name="",
        reason="Ads",
        is_enabled=True,
    )
    bt_dev = BlockedTarget(
        id=2,
        target_type="asn",
        target_value="AS32934",
        scope_type="device",
        device_id=11,
        organization_name="FACEBOOK",
        reason="Social",
        is_enabled=True,
    )
    domains, asns, dev_ips = collect_opnsense_custom_block_inputs(
        [bt_global, bt_dev], {11: d_kid}
    )
    assert domains == ["doubleclick.net"]
    assert asns == ["AS32934"]
    assert dev_ips == ["192.168.1.70"]

    payload = assemble_backup_payload(
        [d_kid],
        [kids_grp],
        [DeviceGroupMembership(group_id=1, device_id=11, created_at=now)],
        [],
        blocked_targets=[bt_global, bt_dev],
    )
    assert payload.groups[0].daily_youtube_limit_minutes == 60
    assert len(payload.blocked_targets) == 2

    # Synchronous group_service helper coverage
    d_kid.first_seen_at = now
    d_kid.last_seen_at = now
    d_kid.updated_at = now
    d_prot.first_seen_at = now
    d_prot.last_seen_at = now
    d_prot.updated_at = now
    assembled_groups = assemble_group_responses(
        [kids_grp],
        [
            DeviceGroupMembership(group_id=1, device_id=11, created_at=now),
            DeviceGroupMembership(group_id=1, device_id=12, created_at=now),
        ],
        [d_kid, d_prot],
        Settings(
            _env_file=None,
            app_secret_key="test-secret-key-at-least-32-chars!",
            opnsense_protected_ips="192.168.1.1",
        ),
        group_today_youtube_minutes={1: 65},
    )
    assert len(assembled_groups) == 1
    assert assembled_groups[0].is_youtube_quota_reached is True
    plan = plan_group_bulk_action(assembled_groups[0].members, "block")
    assert 11 in plan["eligible_device_ids"]
    empty_ga = _build_empty_group_analytics_response(
        assembled_groups[0], ["192.168.1.70"], "today", "ES down"
    )
    assert empty_ga.es_reachable is False
    assembled_ga = _assemble_group_analytics_response(
        assembled_groups[0],
        ["192.168.1.70"],
        {
            "summary": {"total_events": 10},
            "member_ip_breakdown": [
                {"ip": "192.168.1.70", "total_events": 10, "bytes": 500, "dns_queries": 2}
            ],
            "application_usage": [],
        },
        "today",
    )
    assert assembled_ga.summary.total_events == 10

    _, new_grps, g_cnt = prepare_restored_groups(
        [],
        [ConfigBackupGroupItem(name="Kids", daily_youtube_limit_minutes=90)],
        now,
    )
    assert g_cnt == 1 and new_grps[0].daily_youtube_limit_minutes == 90

    new_bts, bt_cnt = prepare_restored_blocked_targets(
        [],
        [
            ConfigBackupBlockedTargetItem(
                target_type="asn",
                target_value="15169",
                scope_type="global",
                organization_name="GOOGLE",
            )
        ],
        {d_kid.mac_address: d_kid},
        now,
    )
    assert bt_cnt == 1 and new_bts[0].target_value == "AS15169"


@pytest.mark.asyncio
async def test_phase18_blocked_targets_attribution_and_group_quota_api(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Test custom domain/ASN CRUD, attribution endpoint, health count, and quota reconcile."""
    await _login_admin(async_client)
    get_analytics_cache().clear()

    session_factory = get_session_factory(test_settings)
    opn_base = test_settings.opnsense_base_url
    async with session_factory() as db:
        dev = Device(
            mac_address="aa:bb:cc:88:99:01",
            ipv4_address="192.168.1.80",
            display_name="Living Room TV",
            vendor="LG",
            is_online=True,
            is_blocked=False,
            is_manually_blocked=False,
            is_youtube_blocked=False,
            is_protected=False,
        )
        prot_dev = Device(
            mac_address="aa:bb:cc:88:99:02",
            ipv4_address="192.168.1.81",
            display_name="Parent Work PC",
            is_online=True,
            is_blocked=False,
            is_protected=True,
        )
        db.add_all([dev, prot_dev])
        await db.commit()
        await db.refresh(dev)
        await db.refresh(prot_dev)
        dev_id = dev.id
        prot_id = prot_dev.id

    with respx.mock(assert_all_called=False) as router:
        for alias_name in (
            "gateway_custom_blocked_domains",
            "gateway_custom_blocked_asns",
            "gateway_custom_blocked_devices",
        ):
            router.get(f"{opn_base}/api/firewall/alias/get_alias_uuid/{alias_name}").mock(
                return_value=Response(200, json={})
            )
        router.post(f"{opn_base}/api/firewall/alias/add_item").mock(
            return_value=Response(200, json={"result": "saved", "uuid": "uuid-custom"})
        )
        router.post(f"{opn_base}/api/firewall/alias/reconfigure").mock(
            return_value=Response(200, json={"status": "ok"})
        )

        # Create global domain block
        r1 = await async_client.post(
            "/api/v1/analytics/blocked-targets",
            json={
                "target_type": "domain",
                "target_value": "ads.tiktok.com",
                "scope_type": "global",
                "reason": "Block trackers",
            },
        )
        assert r1.status_code == 201
        d1 = r1.json()
        assert d1["opnsense_synced"] is True
        assert d1["item"]["target_value"] == "ads.tiktok.com"
        block_id = d1["item"]["id"]

        # Create device-scoped ASN block
        r2 = await async_client.post(
            "/api/v1/analytics/blocked-targets",
            json={
                "target_type": "asn",
                "target_value": "AS32934",
                "scope_type": "device",
                "device_id": dev_id,
                "organization_name": "FACEBOOK",
            },
        )
        assert r2.status_code == 201
        assert r2.json()["item"]["device_ip"] == "192.168.1.80"

        # Protected device custom block rejected (403)
        r_prot = await async_client.post(
            "/api/v1/analytics/blocked-targets",
            json={
                "target_type": "domain",
                "target_value": "example.com",
                "scope_type": "device",
                "device_id": prot_id,
            },
        )
        assert r_prot.status_code == 403

        # List and check error paths (missing device, toggle 404, delete 404)
        r_list = await async_client.get("/api/v1/analytics/blocked-targets")
        assert r_list.status_code == 200
        assert r_list.json()["enabled_count"] == 2

        r_miss_dev = await async_client.post(
            "/api/v1/analytics/blocked-targets",
            json={
                "target_type": "domain",
                "target_value": "bad.example.com",
                "scope_type": "device",
                "device_id": 999999,
            },
        )
        assert r_miss_dev.status_code == 404

        r_tog_miss = await async_client.patch("/api/v1/analytics/blocked-targets/999999/toggle")
        assert r_tog_miss.status_code == 404

        r_del_miss = await async_client.delete("/api/v1/analytics/blocked-targets/999999")
        assert r_del_miss.status_code == 404

        # Toggle disable & delete
        r_tog = await async_client.patch(f"/api/v1/analytics/blocked-targets/{block_id}/toggle")
        assert r_tog.status_code == 200
        assert r_tog.json()["item"]["is_enabled"] is False

        r_del = await async_client.delete(f"/api/v1/analytics/blocked-targets/{block_id}")
        assert r_del.status_code == 200
        assert r_del.json()["deleted_id"] == block_id

    # Check system health exposes custom_blocked_targets_count
    health_resp = await async_client.get("/api/v1/system/health")
    assert health_resp.status_code == 200
    assert (
        health_resp.json()["services"]["sqlite"]["details"]["custom_blocked_targets_count"] == 1
    )

    # Attribution drilldown API with mocked ES client
    class _FakeEs:
        async def fetch_target_attribution(
            self,
            *,
            target_type: str,
            target_value: str,
            window: str = "today",
            top_n: int = 20,
        ) -> dict[str, Any]:
            return {
                "target_type": target_type,
                "target_value": target_value,
                "window": window,
                "total_events": 25,
                "total_bytes": 500000,
                "clients": [
                    {
                        "ipv4_address": "192.168.1.80",
                        "event_count": 25,
                        "dns_queries": 4,
                        "bytes": 500000,
                        "allowed_packets": 21,
                        "blocked_packets": 0,
                        "last_seen_at": "2026-11-15T01:20:00Z",
                    }
                ],
            }

    target_app = getattr(async_client._transport, "app", None)
    assert target_app is not None
    target_app.dependency_overrides[get_elasticsearch_client] = lambda: _FakeEs()
    try:
        attr_resp = await async_client.get(
            "/api/v1/analytics/attribution",
            params={"target_type": "domain", "target_value": "youtube.com", "window": "today"},
        )
        assert attr_resp.status_code == 200
        attr_json = attr_resp.json()
        assert attr_json["total_events"] == 25
        assert attr_json["clients"][0]["effective_name"] == "Living Room TV"
    finally:
        target_app.dependency_overrides.pop(get_elasticsearch_client, None)

    # Group Daily YouTube Limit CRUD + policy enforcement + bonus timer precedence
    class _FakeYtEsList:
        async def fetch_group_analytics(self, **_kwargs: Any) -> dict[str, Any]:
            return {"application_usage": [{"app_key": "youtube", "active_minutes": 15}]}

    target_app.dependency_overrides[get_elasticsearch_client] = lambda: _FakeYtEsList()
    try:
        grp_resp = await async_client.post(
            "/api/v1/groups",
            json={
                "name": "Media Kids",
                "color_badge": "rose",
                "device_ids": [dev_id],
                "daily_youtube_limit_minutes": 60,
            },
        )
        assert grp_resp.status_code == 201
        grp_id = grp_resp.json()["id"]
        assert grp_resp.json()["daily_youtube_limit_minutes"] == 60

        # Update & list group with daily quota (mocked ES prevents network timeout)
        upd_grp = await async_client.patch(
            f"/api/v1/groups/{grp_id}",
            json={"daily_youtube_limit_minutes": 45},
        )
        assert upd_grp.status_code == 200
        assert upd_grp.json()["daily_youtube_limit_minutes"] == 45

        list_grp = await async_client.get("/api/v1/groups")
        assert list_grp.status_code == 200
        assert any(g["id"] == grp_id for g in list_grp.json()["groups"])
    finally:
        target_app.dependency_overrides.pop(get_elasticsearch_client, None)

    with respx.mock(assert_all_called=False) as yt_router:
        yt_router.get(
            f"{opn_base}/api/firewall/alias_util/list/gateway_blocked_devices"
        ).mock(return_value=Response(200, json={"rows": []}))
        yt_router.get(
            f"{opn_base}/api/firewall/alias_util/list/gateway_youtube_blocked_devices"
        ).mock(return_value=Response(200, json={"rows": []}))
        yt_router.post(
            f"{opn_base}/api/firewall/alias_util/add/gateway_youtube_blocked_devices"
        ).mock(return_value=Response(200, json={"status": "done"}))
        yt_router.post(
            f"{opn_base}/api/firewall/alias_util/delete/gateway_youtube_blocked_devices"
        ).mock(return_value=Response(200, json={"status": "done"}))

        async with session_factory() as db:
            opn = OPNsenseClient(test_settings)
            await reconcile_schedules_and_policies(
                db,
                opn,
                test_settings,
                group_today_youtube_minutes={grp_id: 75},
            )
            refreshed_dev = (
                await db.execute(select(Device).where(Device.id == dev_id))
            ).scalar_one()
            assert refreshed_dev.is_youtube_blocked is True

            # Activate a group Reward/Bonus timer and verify reconciliation unblocks YouTube
            now = utc_now()
            db.add(
                TemporaryOverride(
                    target_type="group",
                    group_id=grp_id,
                    mode="bonus",
                    duration_minutes=30,
                    reason="Chores completed",
                    expires_at=now + timedelta(minutes=30),
                )
            )
            await db.commit()
            await reconcile_schedules_and_policies(
                db,
                opn,
                test_settings,
                group_today_youtube_minutes={grp_id: 75},
            )
            refreshed_dev2 = (
                await db.execute(select(Device).where(Device.id == dev_id))
            ).scalar_one()
            assert refreshed_dev2.is_youtube_blocked is False

    # Backup & Restore round-trip via HTTP endpoints
    backup_resp = await async_client.get("/api/v1/system/backup")
    assert backup_resp.status_code == 200
    backup_json = backup_resp.json()
    assert len(backup_json["blocked_targets"]) >= 1
    assert backup_json["groups"][0]["daily_youtube_limit_minutes"] == 45

    restore_resp = await async_client.post("/api/v1/system/restore", json=backup_json)
    assert restore_resp.status_code == 200
    assert restore_resp.json()["blocked_targets_upserted"] >= 1

    # Verify resolve_group_today_youtube_minutes with a mocked ES client
    class _FakeYtEs:
        async def fetch_group_analytics(self, **_kwargs: Any) -> dict[str, Any]:
            return {
                "application_usage": [
                    {"app_key": "youtube", "active_minutes": 42},
                ]
            }

    async with session_factory() as db:
        groups_rows = list((await db.execute(select(DeviceGroup))).scalars().all())
        mems_rows = list((await db.execute(select(DeviceGroupMembership))).scalars().all())
        dev_rows = list((await db.execute(select(Device))).scalars().all())
        yt_map = await resolve_group_today_youtube_minutes(
            test_settings,
            groups_rows,
            mems_rows,
            dev_rows,
            es_client=_FakeYtEs(),  # type: ignore[arg-type]
        )
        assert yt_map[grp_id] == 42

    del_grp = await async_client.delete(f"/api/v1/groups/{grp_id}")
    assert del_grp.status_code == 204

    # Invalid blocked-target / attribution query parameter 400 checks
    bad_scope = await async_client.post(
        "/api/v1/analytics/blocked-targets",
        json={"target_type": "domain", "target_value": "ads.test", "scope_type": "device"},
    )
    assert bad_scope.status_code == 400

    bad_attr = await async_client.get(
        "/api/v1/analytics/attribution",
        params={"target_type": "invalid", "target_value": "youtube.com", "window": "today"},
    )
    assert bad_attr.status_code == 422


def test_phase18_sync_block_and_group_helpers() -> None:
    """Directly exercise synchronous analytics/group helpers for sys.monitoring coverage."""
    now = utc_now()
    cfg = Settings(
        _env_file=None,
        app_secret_key="test-secret-key-at-least-32-chars!",
        opnsense_protected_ips="192.168.1.1",
    )
    dev = Device(
        id=44,
        mac_address="aa:bb:cc:44:55:66",
        ipv4_address="192.168.1.144",
        display_name="PlayStation",
        is_online=True,
        is_blocked=False,
        is_youtube_blocked=True,
        is_protected=False,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    req = BlockedTargetCreateRequest(
        target_type="domain",
        target_value="ads.example.com",
        scope_type="device",
        device_id=44,
        organization_name="Example",
        reason="No ads",
    )
    new_row, new_audit, is_new = prepare_blocked_target_upsert(
        req,
        "domain",
        "ads.example.com",
        "device",
        dev,
        None,
        cfg,
        None,
        "admin",
        now,
    )
    assert is_new is True
    assert new_row.device_id == 44
    assert new_audit.action == "device.block_domain"

    # Re-enable / update existing rule
    new_row.is_enabled = False
    upd_req = BlockedTargetCreateRequest(
        target_type="domain",
        target_value="ads.example.com",
        scope_type="device",
        device_id=44,
        organization_name="Updated Org",
        reason="Updated Reason",
    )
    upd_row, _, is_new2 = prepare_blocked_target_upsert(
        upd_req,
        "domain",
        "ads.example.com",
        "device",
        dev,
        new_row,
        cfg,
        None,
        "admin",
        now,
    )
    assert is_new2 is False
    assert upd_row.is_enabled is True
    assert upd_row.organization_name == "Updated Org"

    # Toggle & delete helper validation
    tog_row, tog_audit = apply_blocked_target_toggle(upd_row, 1, "admin", now)
    assert tog_row.is_enabled is False
    assert "Disabled" in tog_audit.details
    with pytest.raises(HTTPException) as exc_tog:
        apply_blocked_target_toggle(None, 999, "admin", now)
    assert exc_tog.value.status_code == 404

    del_row, del_audit = prepare_blocked_target_delete_audit(tog_row, 1, "admin")
    assert del_row.id == upd_row.id
    assert del_audit.action == "device.unblock_domain"
    with pytest.raises(HTTPException) as exc_del:
        prepare_blocked_target_delete_audit(None, 999, "admin")
    assert exc_del.value.status_code == 404

    # Attribution validation + ES unreachable fallback + SQLite enrichment (known + unknown IP)
    assert validate_attribution_params("DOMAIN", "youtube.com", "today") == (
        "domain",
        "youtube.com",
        "today",
    )
    for bad_args in (
        ("domain", "youtube.com", "invalid_win"),
        ("badtype", "youtube.com", "today"),
        ("domain", "   ", "today"),
    ):
        with pytest.raises(HTTPException):
            validate_attribution_params(*bad_args)

    err_attr = assemble_target_attribution_response(
        "domain", "youtube.com", "today", None, [dev], cfg, warning="ES timeout"
    )
    assert err_attr.es_reachable is False
    assert err_attr.warning == "ES timeout"

    ok_attr = assemble_target_attribution_response(
        "domain",
        "youtube.com",
        "today",
        {
            "total_events": 12,
            "total_bytes": 4096,
            "clients": [
                {"ipv4_address": "", "event_count": 1},
                {"ipv4_address": "192.168.1.144", "event_count": 7, "dns_queries": 3},
                {"ipv4_address": "192.168.1.1", "event_count": 5, "bytes": 2048},
            ],
        },
        [dev],
        cfg,
    )
    assert ok_attr.es_reachable is True
    assert len(ok_attr.clients) == 2
    assert ok_attr.clients[0].effective_name == "PlayStation"
    assert ok_attr.clients[1].is_protected is True

    # Group synchronous validation & status helpers
    assert validate_group_fields("  Kids  ", "INDIGO", "USERS") == ("Kids", "indigo", "users")
    with pytest.raises(HTTPException):
        validate_group_fields("   ")
    with pytest.raises(HTTPException):
        validate_group_fields("Kids", color_badge="not_a_real_color")

    from app.services.device_service import build_device_response

    d_resp_1 = build_device_response(dev, cfg, None)
    d_prot = Device(
        id=45,
        mac_address="aa:bb:cc:44:55:99",
        ipv4_address="192.168.1.1",
        display_name="Router",
        is_online=True,
        is_blocked=True,
        is_youtube_blocked=True,
        is_protected=True,
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    d_resp_prot = build_device_response(d_prot, cfg, None)
    assert compute_group_access_status([]) == "empty"
    assert compute_group_access_status([d_resp_prot]) == "blocked"
    assert compute_group_access_status([d_resp_1]) == "allowed"
    assert compute_group_youtube_status([]) == "empty"
    assert compute_group_youtube_status([d_resp_prot]) == "blocked"
    assert compute_group_youtube_status([d_resp_1]) == "blocked"
