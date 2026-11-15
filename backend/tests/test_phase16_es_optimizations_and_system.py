"""Unit & API tests for Phase 16 (ES optimizations, Multi-Node HA, System overhaul & Themes)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import respx
from httpx import AsyncClient

from app.clients.elasticsearch import (
    RFC1918_CIDRS,
    ElasticsearchServiceClient,
    _extract_hit_fields,
    _round_es_gte,
    build_device_analytics_query,
    build_device_recent_domains_query,
    build_group_analytics_query,
    build_group_recent_domains_query,
    build_open_wan_port_sessions_query,
    normalize_open_wan_port_sessions_response,
    parse_elasticsearch_hosts,
)
from app.clients.opnsense import OPNsenseClient, ServiceHealthStatus
from app.clients.plex import PlexServiceClient, parse_plex_urls
from app.config import Settings
from app.db import get_session_factory
from app.models import AuditLog, Device, SystemSetting, utc_now
from app.services.analytics_service import resolve_telemetry_cache_ttl
from app.services.device_service import _reconcile_ORM_devices
from app.services.runtime_settings_service import (
    sync_runtime_cache_and_build_view,
    validate_and_normalize_elasticsearch_urls,
    validate_and_normalize_plex_urls,
)


def test_phase16_batch5_es_query_optimizations_and_ttl() -> None:
    """Verify Batch 5 Q1-Q4 optimizations: rounding, breadth_first, docvalues, track_total."""
    assert _round_es_gte("now/d") == "now/d"
    assert _round_es_gte("now-1h") == "now-1h/m"
    assert _round_es_gte("now-24h") == "now-24h/m"
    assert _round_es_gte("now-7d") == "now-7d/h"
    assert _round_es_gte("now-30d") == "now-30d/h"
    assert _round_es_gte("now-30d/h") == "now-30d/h"

    assert resolve_telemetry_cache_ttl("30d") == 1800.0
    assert resolve_telemetry_cache_ttl("7d") == 900.0
    assert resolve_telemetry_cache_ttl("today") == 180.0
    assert resolve_telemetry_cache_ttl("24h") == 90.0
    assert resolve_telemetry_cache_ttl("1h") == 90.0

    dev_q = build_device_analytics_query("192.168.1.50", window="30d")
    assert dev_q["query"]["bool"]["filter"][0] == {"range": {"@timestamp": {"gte": "now-30d/h"}}}

    grp_q = build_group_analytics_query(["192.168.1.50"], window="24h")
    assert grp_q["query"]["bool"]["filter"][0] == {"range": {"@timestamp": {"gte": "now-24h/m"}}}

    dev_recent = build_device_recent_domains_query("192.168.1.50", window="1h")
    assert dev_recent["track_total_hits"] is False

    grp_recent = build_group_recent_domains_query(["192.168.1.50"], window="1h")
    assert grp_recent["track_total_hits"] is False

    aggs_body, recent_body = build_open_wan_port_sessions_query(
        destination_ip="192.168.1.50",
        destination_port=32400,
        protocol="tcp",
        window="7d",
    )
    ext_terms = aggs_body["aggs"]["external_ips"]["terms"]
    assert ext_terms["collect_mode"] == "breadth_first"
    top_hits_cfg = aggs_body["aggs"]["external_ips"]["aggs"]["latest_sample"]["top_hits"]
    assert top_hits_cfg["_source"] is False
    assert isinstance(top_hits_cfg["docvalue_fields"], list)
    assert "source.ip" in top_hits_cfg["docvalue_fields"]
    assert recent_body["_source"] is False
    assert isinstance(recent_body["docvalue_fields"], list)


def test_phase16_extract_hit_fields_and_docvalue_normalization() -> None:
    """Verify _extract_hit_fields and WAN port normalizer handle docvalue_fields."""
    hit_docvalues = {
        "fields": {
            "@timestamp": ["2026-11-14T18:00:00.000Z"],
            "source.ip": ["93.184.216.34"],
            "source.port": [54321],
            "source.as.number": [15169],
            "source.as.organization.name": ["Example ISP"],
            "source.geo.city_name": ["Seattle"],
            "source.geo.region_name": ["Washington"],
            "source.geo.country_name": ["United States"],
            "source.geo.country_iso_code": ["US"],
            "source.geo.location": ["47.6062, -122.3321"],
            "network.transport": ["tcp"],
            "network.bytes": [2048],
            "observer.ingress.interface.name": ["vtnet1"],
            "rule.id": ["105"],
            "pfsense.ip.ttl": [52],
            "pfsense.tcp.flags": ["S"],
        }
    }
    extracted = _extract_hit_fields(hit_docvalues)
    assert extracted["source"]["ip"] == "93.184.216.34"
    assert extracted["source"]["geo"]["location"] == {"lat": 47.6062, "lon": -122.3321}
    assert extracted["network"]["bytes"] == 2048

    # Also test GeoJSON coordinates dict in source.geo.location
    extracted_geojson = _extract_hit_fields(
        {"fields": {"source.geo.location": [{"coordinates": [-122.3321, 47.6062]}]}}
    )
    assert extracted_geojson["source"]["geo"]["location"] == {"lat": 47.6062, "lon": -122.3321}

    norm = normalize_open_wan_port_sessions_response(
        {
            "aggregations": {
                "total_packets": {"value": 3},
                "total_bytes": {"value": 4096},
                "unique_sources": {"value": 1},
                "external_ips": {
                    "buckets": [
                        {
                            "key": "93.184.216.34",
                            "doc_count": 3,
                            "bytes": {"value": 4096},
                            "first_seen": {
                                "value": 1000,
                                "value_as_string": "2026-11-14T17:55:00Z",
                            },
                            "last_seen": {
                                "value": 61000,
                                "value_as_string": "2026-11-14T18:00:00Z",
                            },
                            "active_slots": {
                                "buckets": [
                                    {"key_as_string": "2026-11-14T18:00:00Z", "doc_count": 3}
                                ]
                            },
                            "source_ports": {"buckets": [{"key": 54321, "doc_count": 3}]},
                            "latest_sample": {"hits": {"hits": [hit_docvalues]}},
                        }
                    ]
                },
            }
        },
        {"hits": {"hits": [hit_docvalues]}},
        destination_ip="192.168.1.50",
        destination_port=32400,
        protocol="tcp",
        window="24h",
    )
    assert norm["external_ips"][0]["organization"] == "Example ISP"
    assert norm["external_ips"][0]["latitude"] == 47.6062
    assert norm["external_ips"][0]["longitude"] == -122.3321
    assert norm["recent_events"][0]["source_port"] == 54321


@pytest.mark.asyncio
async def test_phase16_q3_rfc1918_prefilter_and_msearch_request_cache(
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify Q3 RFC1918_CIDRS filter in q_lan/q_app and _msearch request_cache."""
    captured_searches: list[list[dict[str, Any]]] = []
    mock_es = AsyncMock()

    async def fake_msearch(**kwargs: Any) -> dict[str, Any]:
        searches = kwargs.get("searches") or []
        captured_searches.append(searches)
        if len(searches) == 6:
            return {
                "responses": [
                    {"hits": {"total": {"value": 0}}, "aggregations": {}},
                    {"aggregations": {"lan_devices": {"top_ips": {"buckets": []}}}},
                    {"aggregations": {"app_usage": {"buckets": {}}}},
                ]
            }
        return {
            "responses": [
                {"aggregations": {}},
                {"aggregations": {}},
                {"aggregations": {}},
                {"aggregations": {}},
                {"hits": {"hits": []}},
            ]
        }

    mock_es.msearch = AsyncMock(side_effect=fake_msearch)
    mock_es.close = AsyncMock()
    svc = ElasticsearchServiceClient(test_settings)
    monkeypatch.setattr(svc, "create_es_client", lambda: mock_es)

    await svc.fetch_network_overview(window="7d")
    net_searches = captured_searches[0]
    assert net_searches[0]["request_cache"] is True
    assert net_searches[2]["request_cache"] is True
    assert net_searches[4]["request_cache"] is True
    q_lan = net_searches[3]
    q_app = net_searches[5]
    assert {"terms": {"source.ip": RFC1918_CIDRS}} in q_lan["query"]["bool"]["filter"]
    assert q_app["aggs"]["app_usage"]["aggs"]["by_device"]["filter"] == {
        "terms": {"source.ip": RFC1918_CIDRS}
    }

    await svc.fetch_firewall_overview(window="24h")
    fw_searches = captured_searches[1]
    assert fw_searches[0]["request_cache"] is True
    assert fw_searches[6]["request_cache"] is True
    assert fw_searches[8]["request_cache"] is False
    q_wan = fw_searches[7]
    assert {"range": {"@timestamp": {"gte": "now-30d/h"}}} in q_wan["query"]["bool"]["filter"]


def test_phase16_multi_node_elasticsearch_host_parsing(test_settings: Settings) -> None:
    """Verify comma-separated multi-node ES URLs parse and validate cleanly (`FB-P16-002`)."""
    hosts = parse_elasticsearch_hosts(
        "https://es1.example.local:9200/, https://es2.example.local:9200, https://es1.example.local:9200"
    )
    assert hosts == ["https://es1.example.local:9200", "https://es2.example.local:9200"]

    normalized = validate_and_normalize_elasticsearch_urls(
        "https://es1.example.local:9200/, https://es2.example.local:9200"
    )
    assert normalized == "https://es1.example.local:9200, https://es2.example.local:9200"

    with pytest.raises(ValueError):
        validate_and_normalize_elasticsearch_urls("ftp://es1.example.local:9200")

    multi_settings = test_settings.model_copy(
        update={"elasticsearch_url": "https://es1.example.local:9200, https://es2.example.local:9200"}
    )
    svc = ElasticsearchServiceClient(multi_settings)
    assert len(svc._hosts) == 2
    es_client = svc.create_es_client()
    assert es_client is not None


@respx.mock
@pytest.mark.asyncio
async def test_phase16_health_includes_plex_test_all_themes_password_and_audit_prune(
    async_client: AsyncClient,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify 4th Plex card, /test-all, 5 themes, change-password, and audit paginate/prune."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(200, json=[{"ip": "192.168.1.1"}])
    )
    respx.get("https://opnsense.example.local/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"rows": []}))

    async def fake_es_health(self: Any) -> ServiceHealthStatus:
        return ServiceHealthStatus(
            service="elasticsearch",
            status="healthy",
            latency_ms=4.1,
            message="ES connected",
            details={"configured_nodes": self._hosts, "configured_node_count": len(self._hosts)},
        )

    async def fake_plex_health(self: Any) -> ServiceHealthStatus:
        return ServiceHealthStatus(
            service="plex",
            status="healthy",
            latency_ms=5.0,
            message="Plex connected",
            details={"configured": True, "active_sessions": 1},
        )

    monkeypatch.setattr(ElasticsearchServiceClient, "check_health", fake_es_health)
    monkeypatch.setattr(PlexServiceClient, "check_health", fake_plex_health)
    monkeypatch.setattr(
        OPNsenseClient,
        "check_health",
        AsyncMock(
            return_value=ServiceHealthStatus(
                service="opnsense",
                status="healthy",
                latency_ms=3.2,
                message="OPNsense connected",
            )
        ),
    )

    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200

    # 1. /api/v1/system/health includes plex service card cleanly when unconfigured
    health_resp = await async_client.get("/api/v1/system/health")
    assert health_resp.status_code == 200
    health_data = health_resp.json()
    assert health_data["overall_status"] == "healthy"
    assert "plex" in health_data["services"]

    # 2. POST /api/v1/system/settings/test-all tests OPNsense, ES, and Plex together
    test_all_resp = await async_client.post(
        "/api/v1/system/settings/test-all",
        json={
            "elasticsearch_url": "https://es1.example.local:9200, https://es2.example.local:9200",
            "plex_base_url": "http://192.168.1.99:32400",
            "plex_api_token": "plex-tok-123",
        },
    )
    assert test_all_resp.status_code == 200
    all_data = test_all_resp.json()
    assert all_data["overall_reachable"] is True
    assert set(all_data["results"].keys()) == {"opnsense", "elasticsearch", "plex"}
    assert len(all_data["results"]["elasticsearch"]["details"]["node_results"]) == 2
    assert len(all_data["results"]["plex"]["details"]["node_results"]) == 1

    # 3. Emerald & Amber themes
    for theme_name in ("emerald", "amber"):
        pref_resp = await async_client.patch(
            "/api/v1/auth/preferences",
            json={"theme_preference": theme_name},
        )
        assert pref_resp.status_code == 200
        assert pref_resp.json()["theme_preference"] == theme_name

    # 4. Self-service password change
    bad_pwd = await async_client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "WrongPassword123",
            "new_password": "NewStrongPassword!999",
            "confirm_password": "NewStrongPassword!999",
        },
    )
    assert bad_pwd.status_code == 401

    good_pwd = await async_client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": test_settings.admin_password.get_secret_value(),
            "new_password": "NewStrongPassword!999",
            "confirm_password": "NewStrongPassword!999",
        },
    )
    assert good_pwd.status_code == 200
    assert good_pwd.json()["status"] == "password_updated"

    # 5. Audit log pagination & prune
    session_factory = get_session_factory(test_settings)
    async with session_factory() as db:
        old_ts = utc_now() - timedelta(days=10)
        db.add(
            AuditLog(
                actor="system",
                action="performance.analytics_overview",
                audit_label="PERFORMANCE_ANALYSIS",
                target="analytics_overview:24h",
                status="success",
                details="Old perf log",
                created_at=old_ts,
            )
        )
        await db.commit()

    page_resp = await async_client.get("/api/v1/audit-logs?offset=1&limit=2")
    assert page_resp.status_code == 200
    page_data = page_resp.json()
    assert page_data["offset"] == 1
    assert page_data["limit"] == 2
    assert page_data["total_count"] >= 3

    prune_resp = await async_client.post(
        "/api/v1/system/audit-logs/prune?retention_days=7&audit_label=PERFORMANCE_ANALYSIS"
    )
    assert prune_resp.status_code == 200
    assert prune_resp.json()["deleted_count"] >= 1

    # 6. Multi-URL Plex test with mixed pass/fail node_results
    async def fake_multi_plex_health(self: Any) -> ServiceHealthStatus:
        ok = "192.168.1.99" in self._base_url
        return ServiceHealthStatus(
            service="plex",
            status="healthy" if ok else "unhealthy",
            latency_ms=4.2 if ok else 11.0,
            message="Plex reachable" if ok else "Connection refused",
            details={"url": self._base_url, "configured": True},
        )

    monkeypatch.setattr(PlexServiceClient, "check_health", fake_multi_plex_health)
    multi_plex_resp = await async_client.post(
        "/api/v1/system/settings/test-plex",
        json={
            "plex_base_url": "http://192.168.1.99:32400/, http://192.168.1.100:32400",
            "plex_api_token": "plex-tok-123",
        },
    )
    assert multi_plex_resp.status_code == 200
    mp_data = multi_plex_resp.json()
    assert mp_data["reachable"] is True
    assert mp_data["status"] == "degraded"
    assert [n["url"] for n in mp_data["details"]["node_results"]] == [
        "http://192.168.1.99:32400",
        "http://192.168.1.100:32400",
    ]
    assert [n["reachable"] for n in mp_data["details"]["node_results"]] == [True, False]

    # 7. Consecutive PUT /api/v1/system/settings saves (BUG-P16-005 regression)
    put_first = await async_client.put(
        "/api/v1/system/settings",
        json={"elasticsearch_timeout_seconds": 25.0},
    )
    assert put_first.status_code == 200
    assert put_first.json()["source"] == "ui_override"

    put_second = await async_client.put(
        "/api/v1/system/settings",
        json={"plex_timeout_seconds": 12.0},
    )
    assert put_second.status_code == 200
    assert put_second.json()["source"] == "ui_override"
    assert put_second.json()["plex_timeout_seconds"] == 12.0


def test_phase16_round2_plex_multi_url_and_youtube_sync_reconciliation(
    test_settings: Settings,
) -> None:
    """Verify multi-URL Plex normalization and YouTube block reconciliation during sync."""
    parsed = parse_plex_urls(
        "http://10.0.0.10:32400/, http://10.0.0.11:32400, http://10.0.0.10:32400"
    )
    assert parsed == [
        "http://10.0.0.10:32400",
        "http://10.0.0.11:32400",
    ]
    assert (
        validate_and_normalize_plex_urls("http://10.0.0.10:32400/ , http://10.0.0.11:32400")
        == "http://10.0.0.10:32400, http://10.0.0.11:32400"
    )
    assert validate_and_normalize_plex_urls("  ") == ""

    now = utc_now()
    existing = Device(
        mac_address="aa:bb:cc:dd:ee:10",
        ipv4_address="192.168.1.50",
        hostname="kid-tv",
        is_online=True,
        is_blocked=False,
        is_youtube_blocked=True,
        is_protected=False,
        notes="",
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )
    discovered = {
        "aa:bb:cc:dd:ee:10": {
            "ipv4_address": "192.168.1.50",
            "hostname": "kid-tv",
            "arp_vendor": None,
            "lease_vendor": None,
            "interface_name": "LAN",
            "lease_type": "dynamic",
        },
        "aa:bb:cc:dd:ee:11": {
            "ipv4_address": "192.168.1.51",
            "hostname": "kid-tablet",
            "arp_vendor": None,
            "lease_vendor": None,
            "interface_name": "LAN",
            "lease_type": "dynamic",
        },
    }
    created = _reconcile_ORM_devices(
        [existing],
        discovered,
        {"aa:bb:cc:dd:ee:10", "aa:bb:cc:dd:ee:11"},
        set(),
        test_settings,
        now,
        youtube_blocked_ips={"192.168.1.51"},
    )
    assert existing.is_youtube_blocked is False
    assert len(created) == 1
    assert created[0].is_youtube_blocked is True

    # Mixed offset-naive + offset-aware SystemSetting rows (BUG-P16-005 unit test)
    naive_row = SystemSetting(
        key="elasticsearch_timeout_seconds",
        value_text="20.0",
        is_secret=False,
        updated_by="admin_old",
        updated_at=datetime(2026, 11, 14, 12, 0, 0),
    )
    aware_row = SystemSetting(
        key="plex_timeout_seconds",
        value_text="8.0",
        is_secret=False,
        updated_by="admin_new",
        updated_at=datetime(2026, 11, 14, 13, 0, 0, tzinfo=UTC),
    )
    view = sync_runtime_cache_and_build_view(test_settings, [naive_row, aware_row])
    assert view.updated_by == "admin_new"
    assert view.updated_at == aware_row.updated_at.isoformat()
