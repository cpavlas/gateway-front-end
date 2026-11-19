"""Phase 19 (`v1.3.0` Final Release) unit & API test suite."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import select

from app.clients.elasticsearch import (
    ElasticsearchServiceClient,
    _build_app_usage_agg,
    _extract_app_usage,
    _extract_geo_metadata,
    build_firewall_overview_query,
    normalize_firewall_overview_response,
    normalize_open_wan_port_sessions_response,
)
from app.clients.opnsense import (
    OPNsenseClient,
    OPNsenseClientError,
    ServiceHealthStatus,
    extract_opnsense_version,
)
from app.config import Settings
from app.db import get_session_factory
from app.models import Device, DeviceGroup, DeviceGroupMembership, TemporaryOverride, utc_now
from app.services.analytics_service import (
    _build_zero_app_usage,
    _parse_app_usage_items,
    get_analytics_cache,
)
from app.services.firewall_service import (
    WanBlockedIpCreateRequest,
    block_external_wan_ip,
    build_firewall_overview_response,
    build_open_wan_port_sessions_response,
    list_wan_blocked_ips,
    unblock_external_wan_ip,
    validate_public_wan_ipv4,
)
from app.services.group_service import (
    GroupUpdateRequest,
    select_group_devices_to_auto_unblock_youtube,
    update_group,
)
from app.services.runtime_settings_service import (
    IntegrationSettingsUpdatePayload,
    _probe_elasticsearch_with_nodes,
    _probe_plex_with_nodes,
    build_temporary_settings_for_test,
    validate_and_normalize_enabled_telemetry_apps,
)
from app.services.timer_service import ActiveOverrideInfo


def test_app_telemetry_catalog_facebook_threads_and_config_filter(
    test_settings: Settings,
) -> None:
    """Verify `facebook_threads` Meta ASN/DNS filter and configurable app list (`FB-P18-008`)."""
    agg_def = _build_app_usage_agg("UTC")
    fb_filter = agg_def["filters"]["filters"]["facebook_threads"]
    should_clauses = fb_filter["bool"]["should"]
    assert {"term": {"destination.as.number": 32934}} in should_clauses
    assert any(
        "facebook.com" in (c.get("terms") or {}).get("dns.question.registered_domain", [])
        for c in should_clauses
    )

    fake_aggs = {
        "app_usage": {
            "buckets": {
                "youtube": {
                    "doc_count": 20,
                    "bytes": {"value": 1000},
                    "dns_queries": {"doc_count": 10},
                    "active_slots": {
                        "buckets": [{"key_as_string": "2026-11-15T10:00:00Z", "doc_count": 10}]
                    },
                },
                "plex": {"doc_count": 5, "bytes": {"value": 500}, "dns_queries": {"doc_count": 2}},
                "facebook_threads": {
                    "doc_count": 30,
                    "bytes": {"value": 4500},
                    "dns_queries": {"doc_count": 12},
                    "active_slots": {
                        "buckets": [
                            {"key_as_string": "2026-11-15T10:00:00Z", "doc_count": 15},
                            {"key_as_string": "2026-11-15T10:05:00Z", "doc_count": 15},
                        ]
                    },
                },
            }
        }
    }
    extracted = _extract_app_usage(fake_aggs)
    assert len(extracted) == 9
    fb_item = next(item for item in extracted if item["app_key"] == "facebook_threads")
    assert fb_item["display_name"] == "Facebook & Threads"
    assert fb_item["active_minutes"] == 10

    # Default settings filter down to youtube + plex only
    default_filtered = _parse_app_usage_items({"application_usage": extracted}, [], test_settings)
    assert [a.app_key for a in default_filtered] == ["youtube", "plex"]

    # Custom settings include facebook_threads
    expanded_settings = test_settings.model_copy(
        update={"enabled_telemetry_apps": "youtube,plex,facebook_threads"}
    )
    expanded_filtered = _parse_app_usage_items(
        {"application_usage": extracted}, [], expanded_settings
    )
    assert [a.app_key for a in expanded_filtered] == ["youtube", "plex", "facebook_threads"]
    assert [a.app_key for a in _build_zero_app_usage(expanded_settings)] == [
        "youtube",
        "plex",
        "facebook_threads",
    ]
    normalized_apps = validate_and_normalize_enabled_telemetry_apps(
        ["invalid", "facebook_threads", "youtube"]
    )
    assert normalized_apps == "facebook_threads,youtube"
    assert validate_and_normalize_enabled_telemetry_apps([]) == "youtube,plex"


@pytest.mark.asyncio
async def test_multi_node_diagnostics_compute_average_latency(
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify multi-node ES & Plex diagnostics average node latencies (`FB-P18-012`)."""
    multi_es_settings = test_settings.model_copy(
        update={"elasticsearch_url": "https://es1.example.local:9200, https://es2.example.local:9200"}
    )
    latencies = iter([10.0, 20.0, 30.0])  # overall check + 2 nodes -> avg(20, 30) = 25.0

    async def fake_es_health(self: ElasticsearchServiceClient) -> ServiceHealthStatus:
        lat = next(latencies)
        return ServiceHealthStatus(
            service="elasticsearch",
            status="healthy",
            latency_ms=lat,
            message="ok",
            details={"url": self._url},
        )

    monkeypatch.setattr(ElasticsearchServiceClient, "check_health", fake_es_health)
    es_health, es_nodes = await _probe_elasticsearch_with_nodes(multi_es_settings)
    assert len(es_nodes) == 2
    assert es_health.latency_ms == 25.0

    multi_plex_settings = test_settings.model_copy(
        update={
            "plex_base_url": "http://plex1.example.local:32400, http://plex2.example.local:32400",
            "plex_api_token": "plex-tok",
        }
    )
    from app.clients.plex import PlexServiceClient

    plex_latencies = iter([12.0, 18.0])

    async def fake_plex_health(self: PlexServiceClient) -> ServiceHealthStatus:
        lat = next(plex_latencies)
        return ServiceHealthStatus(
            service="plex",
            status="healthy",
            latency_ms=lat,
            message="ok",
            details={"url": self._base_url},
        )

    monkeypatch.setattr(PlexServiceClient, "check_health", fake_plex_health)
    plex_health, plex_nodes = await _probe_plex_with_nodes(multi_plex_settings)
    assert len(plex_nodes) == 2
    assert plex_health.latency_ms == 15.0

    temp_with_apps = build_temporary_settings_for_test(
        test_settings,
        IntegrationSettingsUpdatePayload(enabled_telemetry_apps=["youtube", "plex", "discord"]),
    )
    assert temp_with_apps.enabled_telemetry_app_list == ["youtube", "plex", "discord"]


@pytest.mark.asyncio
async def test_group_youtube_auto_unblock_when_quota_cleared_or_raised(
    initialized_db: Settings,
) -> None:
    """Verify clearing or raising a group's YouTube quota unblocks members (`FB-P18-004`)."""
    now = utc_now()
    session_factory = get_session_factory(initialized_db)
    async with session_factory() as session:
        dev_eligible = Device(
            mac_address="aa:bb:cc:11:22:01",
            ipv4_address="192.168.1.71",
            display_name="Kids iPad",
            is_online=True,
            is_youtube_blocked=True,
            is_protected=False,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        dev_paused = Device(
            mac_address="aa:bb:cc:11:22:02",
            ipv4_address="192.168.1.72",
            display_name="Paused Phone",
            is_online=True,
            is_youtube_blocked=True,
            is_protected=False,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        dev_protected = Device(
            mac_address="aa:bb:cc:11:22:03",
            ipv4_address="192.168.1.73",
            display_name="Admin Tablet",
            is_online=True,
            is_youtube_blocked=True,
            is_protected=True,
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        grp = DeviceGroup(
            name="Kids Devices",
            description="Test quota",
            color_badge="indigo",
            icon="users",
            daily_youtube_limit_minutes=30,
            created_at=now,
            updated_at=now,
        )
        session.add_all([dev_eligible, dev_paused, dev_protected, grp])
        await session.flush()
        session.add_all(
            [
                DeviceGroupMembership(group_id=grp.id, device_id=dev_eligible.id),
                DeviceGroupMembership(group_id=grp.id, device_id=dev_paused.id),
                DeviceGroupMembership(group_id=grp.id, device_id=dev_protected.id),
                TemporaryOverride(
                    target_type="device",
                    device_id=dev_paused.id,
                    mode="pause",
                    duration_minutes=30,
                    is_active=True,
                    expires_at=(now + timedelta(minutes=30)).replace(tzinfo=None),
                    created_by="admin",
                ),
            ]
        )
        await session.commit()
        grp_id = grp.id
        el_id = dev_eligible.id
        paused_id = dev_paused.id

        # Pure helper check
        chosen = select_group_devices_to_auto_unblock_youtube(
            [dev_eligible, dev_paused, dev_protected],
            group_override=None,
            group_schedule=None,
            overrides_by_device={
                paused_id: ActiveOverrideInfo(
                    id=1,
                    target_type="device",
                    device_id=paused_id,
                    mode="pause",
                    duration_minutes=30,
                    created_by="admin",
                    is_active=True,
                    created_at=now.isoformat(),
                    expires_at=(datetime.now(UTC) + timedelta(minutes=30)).isoformat(),
                    remaining_seconds=1800,
                )
            },
            schedules_by_device={},
        )
        assert [d.id for d in chosen] == [el_id]

        mock_opn = AsyncMock(spec=OPNsenseClient)
        mock_opn.remove_ip_from_youtube_block_alias = AsyncMock(return_value=[])

        # Clear quota (`daily_youtube_limit_minutes=None`)
        updated = await update_group(
            session,
            initialized_db,
            grp_id,
            GroupUpdateRequest(daily_youtube_limit_minutes=None),
            actor="admin",
            opnsense=mock_opn,
        )
        assert updated.daily_youtube_limit_minutes is None
        mock_opn.remove_ip_from_youtube_block_alias.assert_awaited_once_with("192.168.1.71")

        # Verify eligible was unblocked, paused stayed blocked
        refreshed_eligible = (
            await session.execute(select(Device).where(Device.id == el_id))
        ).scalar_one()
        refreshed_paused = (
            await session.execute(select(Device).where(Device.id == paused_id))
        ).scalar_one()
        assert refreshed_eligible.is_youtube_blocked is False
        assert refreshed_paused.is_youtube_blocked is True


def test_scanner_geo_coordinates_and_dnat_descriptions(test_settings: Settings) -> None:
    """Verify scanner GeoIP coords, open-port country breakdown, D-NAT desc, and row limits."""
    geo_coords = _extract_geo_metadata(
        {
            "as": {"number": 14061, "organization": {"name": "DigitalOcean"}},
            "geo": {
                "city_name": "Frankfurt",
                "country_name": "Germany",
                "country_iso_code": "DE",
                "location": {"coordinates": [8.6821, 50.1109]},
            },
        }
    )
    assert geo_coords["latitude"] == 50.1109
    assert geo_coords["longitude"] == 8.6821
    assert geo_coords["location_label"] == "Frankfurt, Germany"

    q = build_firewall_overview_query(window="24h", recent_limit=250)
    assert q["size"] == 250
    assert (
        "latest_geo"
        in q["aggs"]["blocked_sources"]["aggs"]["external_sources"]["aggs"]["sources"]["aggs"]
    )

    norm = normalize_firewall_overview_response(
        {
            "hits": {"total": {"value": 10}, "hits": []},
            "aggregations": {
                "blocked_sources": {
                    "sources": {"buckets": []},
                    "external_sources": {
                        "sources": {
                            "buckets": [
                                {
                                    "key": "45.33.32.156",
                                    "doc_count": 22,
                                    "bytes": {"value": 1400},
                                    "top_ports": {"buckets": [{"key": 22}]},
                                    "latest_geo": {
                                        "hits": {
                                            "hits": [
                                                {
                                                    "fields": {
                                                        "source.as.number": [63949],
                                                        "source.as.organization.name": ["Linode"],
                                                        "source.geo.city_name": ["Fremont"],
                                                        "source.geo.country_name": [
                                                            "United States"
                                                        ],
                                                        "source.geo.country_iso_code": ["US"],
                                                        "source.geo.location": [
                                                            "37.5483,-121.9886"
                                                        ],
                                                    }
                                                }
                                            ]
                                        }
                                    },
                                }
                            ]
                        }
                    },
                },
                "inbound_wan_passed": {
                    "by_dest_ip": {
                        "buckets": [
                            {
                                "key": "192.168.1.50",
                                "by_port": {
                                    "buckets": [
                                        {
                                            "key": 32400,
                                            "doc_count": 40,
                                            "protocols": {"buckets": [{"key": "tcp"}]},
                                            "bytes": {"value": 50000},
                                            "unique_sources": {"value": 3},
                                        }
                                    ]
                                },
                            }
                        ]
                    }
                },
            },
        },
        window="24h",
    )
    scanner = norm["external_scanners"][0]
    assert scanner["latitude"] == 37.5483
    assert scanner["longitude"] == -121.9886
    assert scanner["location_label"] == "Fremont, United States"

    ov = build_firewall_overview_response(
        norm,
        [],
        test_settings,
        window="24h",
        es_reachable=True,
        nat_descriptions={("192.168.1.50", 32400, "tcp"): "Custom Plex Forward"},
        wan_blocked_ips={"45.33.32.156"},
    )
    assert ov.external_scanners[0].is_wan_blocked is True
    assert ov.open_wan_ports[0].rule_description == "Custom Plex Forward"

    sessions_norm = normalize_open_wan_port_sessions_response(
        {
            "aggregations": {
                "total_packets": {"value": 15},
                "total_bytes": {"value": 9000},
                "unique_sources": {"value": 1},
                "top_countries": {"buckets": [{"key": "United States", "doc_count": 15}]},
                "external_ips": {"buckets": []},
            }
        },
        {"hits": {"hits": []}},
        destination_ip="192.168.1.50",
        destination_port=32400,
        window="24h",
    )
    assert sessions_norm["summary"]["country_breakdown"] == [
        {"country_name": "United States", "doc_count": 15}
    ]
    sess_resp = build_open_wan_port_sessions_response(
        sessions_norm,
        [],
        destination_ip="192.168.1.50",
        destination_port=32400,
        window="24h",
        wan_blocked_ips={"45.33.32.156"},
    )
    assert sess_resp.summary.country_breakdown[0]["country_name"] == "United States"
    assert sess_resp.effective_name == "192.168.1.50"


@pytest.mark.asyncio
async def test_wan_blocklist_validation_service_and_routes(
    async_client: AsyncClient,
    initialized_db: Settings,
) -> None:
    """Verify public-only WAN IP validation and WAN blocklist endpoints (`FB-P19-002`)."""
    with pytest.raises(ValueError, match="private/RFC1918"):
        validate_public_wan_ipv4("192.168.1.10", initialized_db.protected_ip_set)
    with pytest.raises(ValueError, match="protected"):
        validate_public_wan_ipv4("1.1.1.1", frozenset({"1.1.1.1"}))
    assert (
        validate_public_wan_ipv4("45.33.32.156", initialized_db.protected_ip_set)
        == "45.33.32.156"
    )

    # Log in as admin
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": initialized_db.admin_username,
            "password": initialized_db.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200

    # Reject private LAN IP via HTTP 400
    bad_resp = await async_client.post(
        "/api/v1/firewall/wan-blocks",
        json={"ip_address": "192.168.1.25", "reason": "Mistake"},
    )
    assert bad_resp.status_code == 400

    alias_name = initialized_db.opnsense_wan_block_alias
    base_url = initialized_db.opnsense_base_url.rstrip("/")
    alias_ips: list[str] = []

    def _get_item_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "alias": {
                    "enabled": "1",
                    "name": alias_name,
                    "type": "host",
                    "content": {
                        ip: {"value": ip, "selected": 1} for ip in alias_ips
                    },
                }
            },
        )

    def _set_item_handler(request: httpx.Request) -> httpx.Response:
        body: dict[str, Any] = json.loads(request.content.decode("utf-8"))
        raw_content = str(body.get("alias", {}).get("content", ""))
        alias_ips[:] = [line.strip() for line in raw_content.splitlines() if line.strip()]
        return httpx.Response(200, json={"result": "saved"})

    with respx.mock(base_url=base_url, assert_all_called=False) as mock_api:
        mock_api.get(f"/api/firewall/alias/get_alias_uuid/{alias_name}").mock(
            return_value=httpx.Response(200, json={"uuid": "wan-uuid-1"})
        )
        mock_api.get("/api/firewall/alias/get_item/wan-uuid-1").mock(
            side_effect=_get_item_handler
        )
        mock_api.post("/api/firewall/alias/set_item/wan-uuid-1").mock(
            side_effect=_set_item_handler
        )
        mock_api.post("/api/firewall/alias/reconfigure").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        mock_api.post(f"/api/firewall/alias_util/add/{alias_name}").mock(
            return_value=httpx.Response(200, json={"status": "done"})
        )
        mock_api.post("/api/diagnostics/firewall/kill_states").mock(
            return_value=httpx.Response(200, json={"dropped_states": 1})
        )
        mock_api.get(f"/api/firewall/alias_util/list/{alias_name}").mock(
            return_value=httpx.Response(200, json={"rows": [{"ip": "45.33.32.156"}]})
        )
        mock_api.post(f"/api/firewall/alias_util/delete/{alias_name}").mock(
            return_value=httpx.Response(200, json={"status": "done"})
        )

        add_resp = await async_client.post(
            "/api/v1/firewall/wan-blocks",
            json={"ip_address": "45.33.32.156", "reason": "SSH scanner"},
        )
        assert add_resp.status_code == 200
        assert add_resp.json()["blocked"] is True
        assert add_resp.json()["opnsense_synced"] is True
        assert alias_ips == ["45.33.32.156"]

        list_resp = await async_client.get("/api/v1/firewall/wan-blocks")
        assert list_resp.status_code == 200
        assert list_resp.json()["ips"] == ["45.33.32.156"]

        del_resp = await async_client.delete("/api/v1/firewall/wan-blocks/45.33.32.156")
        assert del_resp.status_code == 200
        assert del_resp.json()["blocked"] is False
        assert alias_ips == []

    # Also test service helpers directly with session
    mock_opn = AsyncMock(spec=OPNsenseClient)
    mock_opn.list_wan_blocked_ips = AsyncMock(return_value=["45.33.32.156"])
    mock_opn.add_ip_to_wan_block_alias = AsyncMock(return_value=["45.33.32.156"])
    mock_opn.remove_ip_from_wan_block_alias = AsyncMock(return_value=[])
    session_factory = get_session_factory(initialized_db)
    async with session_factory() as session:
        res_list = await list_wan_blocked_ips(initialized_db, mock_opn)
        assert res_list.total_count == 1
        res_blk = await block_external_wan_ip(
            session,
            mock_opn,
            initialized_db,
            WanBlockedIpCreateRequest(ip_address="8.8.4.4", reason="Test"),
            actor="admin",
        )
        assert res_blk.opnsense_synced is True
        res_unblk = await unblock_external_wan_ip(
            session,
            mock_opn,
            initialized_db,
            "8.8.4.4",
            actor="admin",
        )
        assert res_unblk.opnsense_synced is True

        # Verify OPNsense error fallback preserves API response with warning
        failing_opn = AsyncMock(spec=OPNsenseClient)
        failing_opn.add_ip_to_wan_block_alias = AsyncMock(
            side_effect=OPNsenseClientError("Permission denied", status_code=403)
        )
        failing_opn.remove_ip_from_wan_block_alias = AsyncMock(
            side_effect=httpx.ConnectError("timeout")
        )
        fail_blk = await block_external_wan_ip(
            session,
            failing_opn,
            initialized_db,
            WanBlockedIpCreateRequest(ip_address="8.8.8.8", reason="Err test"),
            actor="admin",
        )
        assert fail_blk.opnsense_synced is False
        assert fail_blk.warning is not None
        fail_unblk = await unblock_external_wan_ip(
            session,
            failing_opn,
            initialized_db,
            "8.8.8.8",
            actor="admin",
        )
        assert fail_unblk.opnsense_synced is False


@pytest.mark.asyncio
async def test_opnsense_dnat_descriptions_and_wan_block_alias_client(
    test_settings: Settings,
) -> None:
    """Exercise OPNsense D-NAT descriptions and WAN blocklist alias CRUD (`FB-P19-001/002`)."""
    opn = OPNsenseClient(test_settings)
    base_url = test_settings.opnsense_base_url.rstrip("/")
    alias_name = test_settings.opnsense_wan_block_alias

    with respx.mock(base_url=base_url) as mock_api:
        mock_api.post("/api/firewall/d_nat/searchRule").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "disabled": "0",
                            "target": "192.168.1.50",
                            "local-port": "32400",
                            "destination_port": "32400",
                            "protocol": "TCP",
                            "descr": "Plex Server Port Forward",
                        },
                        {
                            "disabled": "1",
                            "target": "192.168.1.51",
                            "local-port": "22",
                            "destination_port": "22",
                            "protocol": "TCP",
                            "descr": "Disabled SSH",
                        },
                    ]
                },
            )
        )
        mock_api.post("/api/diagnostics/firewall/query_states").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "direction": "in",
                            "nat_addr": "198.51.100.1",
                            "nat_port": "51820",
                            "dst_addr": "192.168.1.1",
                            "dst_port": "51820",
                            "proto": "udp",
                        }
                    ]
                },
            )
        )
        mappings, descs = await opn.get_destination_nat_details()
        assert mappings[("192.168.1.50", 32400, "tcp")] == 32400
        assert descs[("192.168.1.50", 32400, "tcp")] == "Plex Server Port Forward"
        assert ("192.168.1.51", 22, "tcp") not in mappings
        assert mappings[("192.168.1.1", 51820, "udp")] == 51820
        assert (await opn.get_destination_nat_mappings())[("192.168.1.50", 32400, "tcp")] == 32400

        # Ensure WAN blocklist alias creation handles OPNsense `200 []` list (`BUG-P19-002`)
        alias_state: dict[str, Any] = {"exists": False, "ips": []}

        def _uuid_handler(_request: httpx.Request) -> httpx.Response:
            if not alias_state["exists"]:
                return httpx.Response(200, json=[])
            return httpx.Response(200, json={"uuid": "wan-uuid-1"})

        def _add_item_handler(_request: httpx.Request) -> httpx.Response:
            alias_state["exists"] = True
            return httpx.Response(200, json={"result": "saved", "uuid": "wan-uuid-1"})

        def _get_item_handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "alias": {
                        "enabled": "1",
                        "name": alias_name,
                        "type": "host",
                        "content": {
                            ip: {"value": ip, "selected": 1} for ip in alias_state["ips"]
                        },
                    }
                },
            )

        def _set_item_handler(request: httpx.Request) -> httpx.Response:
            body: dict[str, Any] = json.loads(request.content.decode("utf-8"))
            raw_content = str(body.get("alias", {}).get("content", ""))
            alias_state["ips"] = [
                line.strip() for line in raw_content.splitlines() if line.strip()
            ]
            return httpx.Response(200, json={"result": "saved"})

        mock_api.get(f"/api/firewall/alias/get_alias_uuid/{alias_name}").mock(
            side_effect=_uuid_handler
        )
        mock_api.post("/api/firewall/alias/add_item").mock(side_effect=_add_item_handler)
        mock_api.get("/api/firewall/alias/get_item/wan-uuid-1").mock(
            side_effect=_get_item_handler
        )
        mock_api.post("/api/firewall/alias/set_item/wan-uuid-1").mock(
            side_effect=_set_item_handler
        )
        mock_api.post("/api/firewall/alias/reconfigure").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        mock_api.post(f"/api/firewall/alias_util/add/{alias_name}").mock(
            return_value=httpx.Response(200, json={"status": "done"})
        )
        mock_api.post("/api/diagnostics/firewall/kill_states").mock(
            return_value=httpx.Response(200, json={"dropped_states": 1})
        )
        mock_api.post(f"/api/firewall/alias_util/delete/{alias_name}").mock(
            return_value=httpx.Response(200, json={"status": "done"})
        )

        assert await opn.ensure_wan_block_alias_exists() == alias_name
        assert alias_state["exists"] is True
        assert await opn.list_wan_blocked_ips() == []

        added = await opn.add_ip_to_wan_block_alias("45.33.32.156")
        assert added == ["45.33.32.156"]
        assert await opn.list_wan_blocked_ips() == ["45.33.32.156"]

        removed = await opn.remove_ip_from_wan_block_alias("45.33.32.156")
        assert removed == []
        assert await opn.list_wan_blocked_ips() == []

        # OPNsense version extraction & probing helper
        assert extract_opnsense_version({"product_version": "26.7.7-amd64"}) == "26.7.7"
        assert extract_opnsense_version({"version": "26.8.1"}) == "26.8.1"
        assert extract_opnsense_version({}) == "26.7.7"
        prod_settings = test_settings.model_copy(update={"app_env": "production"})
        prod_opn = OPNsenseClient(prod_settings)
        mock_api.get("/api/core/firmware/running").mock(
            return_value=httpx.Response(200, json={"product_version": "26.7.9-amd64"})
        )
        assert await prod_opn._detect_opnsense_version() == "26.7.9"

        mock_api.get("/api/core/firmware/running").mock(return_value=httpx.Response(403))
        mock_api.get("/api/core/firmware/info").mock(return_value=httpx.Response(403))
        mock_api.get("/api/core/firmware/status").mock(return_value=httpx.Response(403))
        assert await prod_opn._detect_opnsense_version() == "26.7.7"

        # Fallback path when get_item returns 403
        mock_api.get("/api/firewall/alias/get_item/wan-uuid-1").mock(
            return_value=httpx.Response(403, json={"message": "Forbidden"})
        )
        mock_api.get(f"/api/firewall/alias_util/list/{alias_name}").mock(
            return_value=httpx.Response(200, json={"rows": [{"ip": "45.33.32.99"}]})
        )
        assert await opn.list_wan_blocked_ips() == ["45.33.32.99"]
        mock_api.post(f"/api/firewall/alias_util/delete/{alias_name}").mock(
            return_value=httpx.Response(404, json={"message": "Missing"})
        )
        assert await opn.remove_ip_from_wan_block_alias("45.33.32.99") == []


@pytest.mark.asyncio
async def test_telemetry_apps_endpoints_and_analytics_override_sync(
    async_client: AsyncClient,
    initialized_db: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify `/system/telemetry-apps` updates apply across Analytics endpoints (`BUG-P19-001`)."""
    get_analytics_cache().clear()

    login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": initialized_db.admin_username,
            "password": initialized_db.admin_password.get_secret_value(),
        },
    )
    assert login.status_code == 200

    # Default telemetry apps view comes from .env defaults
    get_resp = await async_client.get("/api/v1/system/telemetry-apps")
    assert get_resp.status_code == 200
    assert get_resp.json()["enabled_telemetry_apps"] == ["youtube", "plex"]
    assert "facebook_threads" in get_resp.json()["available_telemetry_apps"]

    # Reject empty or unknown telemetry keys with HTTP 400
    empty_resp = await async_client.put(
        "/api/v1/system/telemetry-apps",
        json={"enabled_telemetry_apps": []},
    )
    assert empty_resp.status_code == 400
    bad_resp = await async_client.put(
        "/api/v1/system/telemetry-apps",
        json={"enabled_telemetry_apps": ["youtube", "invalid_app"]},
    )
    assert bad_resp.status_code == 400

    # Create sample device + group for device & group analytics verification
    session_factory = get_session_factory(initialized_db)
    async with session_factory() as session:
        dev = Device(
            mac_address="aa:bb:cc:19:99:01",
            ipv4_address="192.168.1.99",
            hostname="telemetry-sync-tv",
            is_online=True,
        )
        session.add(dev)
        await session.flush()
        grp = DeviceGroup(name="Telemetry Sync Group", color_badge="indigo", icon="tv")
        session.add(grp)
        await session.flush()
        session.add(DeviceGroupMembership(device_id=dev.id, group_id=grp.id))
        await session.commit()
        dev_id = dev.id
        grp_id = grp.id

    extracted_apps = _extract_app_usage(
        {
            "app_usage": {
                "buckets": {
                    "youtube": {
                        "doc_count": 20,
                        "bytes": {"value": 2000},
                        "dns_queries": {"doc_count": 5},
                        "active_slots": {
                            "buckets": [
                                {"key_as_string": "2026-11-15T10:00:00Z", "doc_count": 5}
                            ]
                        },
                    },
                    "plex": {
                        "doc_count": 10,
                        "bytes": {"value": 1000},
                        "dns_queries": {"doc_count": 2},
                    },
                    "facebook_threads": {
                        "doc_count": 30,
                        "bytes": {"value": 3000},
                        "dns_queries": {"doc_count": 6},
                    },
                    "gaming": {
                        "doc_count": 40,
                        "bytes": {"value": 4000},
                        "dns_queries": {"doc_count": 8},
                    },
                }
            }
        }
    )
    shared_summary = {
        "total_events": 100,
        "total_bytes": 10000,
        "dns_query_count": 21,
        "firewall_event_count": 79,
        "allowed_packet_count": 75,
        "blocked_packet_count": 4,
        "active_hours_in_day": 2,
    }
    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_network_overview",
        AsyncMock(
            return_value={
                "summary": shared_summary,
                "timeline": [],
                "top_devices": [],
                "top_domains": [],
                "top_registered_domains": [],
                "top_organizations": [],
                "application_usage": extracted_apps,
            }
        ),
    )
    device_payload = {
        "summary": shared_summary,
        "timeline": [],
        "hourly_access_profile": [],
        "top_domains": [],
        "top_registered_domains": [],
        "top_organizations": [],
        "recent_queries": [],
        "application_usage": extracted_apps,
    }
    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_device_analytics",
        AsyncMock(return_value=device_payload),
    )
    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_group_analytics",
        AsyncMock(return_value={**device_payload, "member_ip_breakdown": []}),
    )
    monkeypatch.setattr(
        "app.services.analytics_service.fetch_plex_telemetry_for_analytics",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "app.services.group_service.fetch_plex_telemetry_for_analytics",
        AsyncMock(return_value=None),
    )

    # First query overview -> cached with default 2 apps
    ov1 = await async_client.get("/api/v1/analytics/overview?window=today")
    assert ov1.status_code == 200
    assert [a["app_key"] for a in ov1.json()["application_usage"]] == ["youtube", "plex"]

    # Enable facebook_threads + gaming via PUT /api/v1/system/telemetry-apps
    put_resp = await async_client.put(
        "/api/v1/system/telemetry-apps",
        json={"enabled_telemetry_apps": ["youtube", "plex", "facebook_threads", "gaming"]},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["source"] == "ui_override"

    # Without ?refresh=true, Analytics Overview, Device Drawer & Group Drawer all show 4 apps
    ov2 = await async_client.get("/api/v1/analytics/overview?window=today")
    assert ov2.status_code == 200
    assert [a["app_key"] for a in ov2.json()["application_usage"]] == [
        "youtube",
        "plex",
        "facebook_threads",
        "gaming",
    ]

    dev_ov = await async_client.get(f"/api/v1/devices/{dev_id}/analytics?window=today")
    assert dev_ov.status_code == 200
    assert [a["app_key"] for a in dev_ov.json()["application_usage"]] == [
        "youtube",
        "plex",
        "facebook_threads",
        "gaming",
    ]

    grp_ov = await async_client.get(f"/api/v1/groups/{grp_id}/analytics?window=today")
    assert grp_ov.status_code == 200
    assert [a["app_key"] for a in grp_ov.json()["application_usage"]] == [
        "youtube",
        "plex",
        "facebook_threads",
        "gaming",
    ]

    # Updating back to youtube & plex immediately drops the extra cards on next request
    put_back = await async_client.put(
        "/api/v1/system/telemetry-apps",
        json={"enabled_telemetry_apps": ["youtube", "plex"]},
    )
    assert put_back.status_code == 200
    ov3 = await async_client.get("/api/v1/analytics/overview?window=today")
    assert [a["app_key"] for a in ov3.json()["application_usage"]] == ["youtube", "plex"]


def test_phase19_1_bug_p19_004_adaptive_app_usage_slots_and_enabled_scope() -> None:
    """Verify BUG-P19-004 Option C: adaptive slot interval, breadth_first & enabled_apps scope."""
    from app.clients.elasticsearch import (
        _resolve_app_usage_slot_config,
        build_device_analytics_query,
        build_network_overview_query,
    )

    assert _resolve_app_usage_slot_config("today") == ("5m", 5, 140)
    assert _resolve_app_usage_slot_config("1h") == ("5m", 5, 140)
    assert _resolve_app_usage_slot_config("24h") == ("5m", 5, 140)
    assert _resolve_app_usage_slot_config("7d") == ("15m", 15, 47)
    assert _resolve_app_usage_slot_config("30d") == ("30m", 30, 24)

    q_30d = build_network_overview_query(
        window="30d",
        tz_name="America/Los_Angeles",
        enabled_apps=["youtube", "plex"],
    )
    app_agg = q_30d["aggs"]["app_usage"]
    assert set(app_agg["filters"]["filters"].keys()) == {"youtube", "plex"}
    assert "active_slots" not in app_agg["aggs"]
    dev_terms = app_agg["aggs"]["by_device"]["aggs"]["devices"]["terms"]
    assert dev_terms["collect_mode"] == "breadth_first"
    assert dev_terms["size"] == 10
    dev_slots = app_agg["aggs"]["by_device"]["aggs"]["devices"]["aggs"]["active_slots"]
    assert dev_slots["date_histogram"]["fixed_interval"] == "30m"

    q_7d_dev = build_device_analytics_query(
        "192.168.1.50",
        window="7d",
        enabled_apps=["youtube"],
    )
    dev_app_agg = q_7d_dev["aggs"]["app_usage"]
    assert set(dev_app_agg["filters"]["filters"].keys()) == {"youtube"}
    assert (
        dev_app_agg["aggs"]["by_device"]["aggs"]["devices"]["aggs"]["active_slots"][
            "date_histogram"
        ]["fixed_interval"]
        == "15m"
    )

    sample_aggs = {
        "app_usage": {
            "buckets": {
                "youtube": {
                    "doc_count": 20,
                    "by_device": {
                        "devices": {
                            "buckets": [
                                {
                                    "key": "192.168.1.60",
                                    "doc_count": 20,
                                    "bytes": {"value": 1024},
                                    "dns_queries": {"doc_count": 10},
                                    "active_slots": {
                                        "buckets": [
                                            {"key_as_string": "s1", "doc_count": 8},
                                            {"key_as_string": "s2", "doc_count": 12},
                                        ]
                                    },
                                }
                            ]
                        }
                    },
                }
            }
        }
    }
    res_30d = _extract_app_usage(sample_aggs, window="30d")
    yt_30d = next(a for a in res_30d if a["app_key"] == "youtube")
    assert yt_30d["active_minutes"] == 60
    assert yt_30d["top_devices"][0]["active_minutes"] == 60

    res_7d = _extract_app_usage(sample_aggs, window="7d")
    yt_7d = next(a for a in res_7d if a["app_key"] == "youtube")
    assert yt_7d["active_minutes"] == 30

    # Top-level active_slots option uses the scaled slot_interval too
    top_slots_agg = _build_app_usage_agg(
        "UTC",
        window="30d",
        enabled_apps=["youtube"],
        include_top_level_slots=True,
    )
    assert top_slots_agg["aggs"]["active_slots"]["date_histogram"]["fixed_interval"] == "30m"


@pytest.mark.asyncio
async def test_phase19_1_es_client_enabled_apps_and_legacy_fallback(
    test_settings: Settings,
    initialized_db: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Option C `enabled_apps` propagation and legacy ES mock signature fallback."""
    from app.services.analytics_service import (
        get_device_analytics,
        get_network_overview_analytics,
    )

    get_analytics_cache().clear()
    svc = ElasticsearchServiceClient(test_settings)
    captured_bodies: list[dict[str, Any]] = []

    class _MockEsClient:
        async def search(self, *, body: dict[str, Any], **_kwargs: Any) -> dict[str, Any]:
            captured_bodies.append(body)
            return {"hits": {"total": {"value": 5}}, "aggregations": {}}

        async def close(self) -> None:
            return None

    monkeypatch.setattr(svc, "create_es_client", lambda: _MockEsClient())
    await svc.fetch_network_overview(window="30d", enabled_apps=["youtube"])
    await svc.fetch_device_analytics("192.168.1.50", window="30d", enabled_apps=["plex"])
    await svc.fetch_group_analytics(["192.168.1.50"], window="30d", enabled_apps=["youtube"])
    assert set(captured_bodies[0]["aggs"]["app_usage"]["filters"]["filters"].keys()) == {"youtube"}
    assert set(captured_bodies[1]["aggs"]["app_usage"]["filters"]["filters"].keys()) == {"plex"}
    assert set(captured_bodies[3]["aggs"]["app_usage"]["filters"]["filters"].keys()) == {"youtube"}

    # Verify TypeError fallback when unit mocks omit `enabled_apps` / `excluded_ips`
    session_factory = get_session_factory(initialized_db)
    async with session_factory() as session:
        dev = Device(mac_address="aa:bb:cc:dd:ee:91", ipv4_address="192.168.1.191")
        session.add(dev)
        await session.commit()
        await session.refresh(dev)
        dev_id = dev.id

        class _LegacyEs:
            async def fetch_network_overview(
                self,
                window: str = "24h",
                top_n: int = 12,
            ) -> dict[str, Any]:
                return {
                    "window": window,
                    "summary": {},
                    "timeline": [],
                    "top_devices": [],
                    "top_domains": [],
                    "top_registered_domains": [],
                    "top_organizations": [],
                    "application_usage": [],
                }

            async def fetch_device_analytics(
                self,
                ipv4_address: str,
                window: str = "24h",
                domain_search: str | None = None,
            ) -> dict[str, Any]:
                return {
                    "window": window,
                    "summary": {},
                    "timeline": [],
                    "hourly_access_profile": [],
                    "top_domains": [],
                    "top_registered_domains": [],
                    "top_organizations": [],
                    "recent_queries": [],
                    "application_usage": [],
                }

        monkeypatch.setattr(
            "app.services.analytics_service.fetch_plex_telemetry_for_analytics",
            AsyncMock(return_value=None),
        )
        ov = await get_network_overview_analytics(
            session, test_settings, _LegacyEs(), window="30d", refresh=True, record_perf=False  # type: ignore[arg-type]
        )
        dv = await get_device_analytics(
            session, test_settings, _LegacyEs(), dev_id, window="30d", refresh=True  # type: ignore[arg-type]
        )
        assert ov.window == "30d"
        assert dv.window == "30d"
