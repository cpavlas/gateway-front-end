"""Unit and API tests for Phase 3 Step 3.2 AnalyticsService & /api/v1/analytics endpoints."""

from __future__ import annotations

import time
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.clients.elasticsearch import ElasticsearchQueryError, ElasticsearchServiceClient
from app.config import Settings
from app.db import get_session_factory
from app.models import Device, utc_now
from app.services.analytics_service import (
    AnalyticsCache,
    _assemble_device_analytics_response,
    _assemble_network_overview_response,
    _build_empty_device_analytics_response,
    _build_empty_overview_response,
    _enrich_top_devices_with_sqlite,
    _require_device_or_404,
    get_analytics_cache,
)
from app.services.device_service import build_device_response


def test_analytics_cache_ttl_and_synchronous_helpers(test_settings: Settings) -> None:
    cache = AnalyticsCache(ttl_seconds=0.01)
    assert cache.get("missing") is None
    cache.set("k1", {"ok": True})
    assert cache.get("k1") == {"ok": True}
    time.sleep(0.02)
    assert cache.get("k1") is None
    cache.set("k2", 123)
    cache.clear()
    assert cache.get("k2") is None

    now = utc_now()
    dev = Device(
        id=10,
        mac_address="aa:bb:cc:dd:ee:10",
        ipv4_address="192.168.1.10",
        hostname="ipad-air",
        display_name="Kids iPad Air",
        vendor="Apple",
        interface_name="lan",
        lease_type="dynamic",
        is_online=True,
        is_blocked=False,
        is_protected=False,
        notes="",
        first_seen_at=now,
        last_seen_at=now,
        updated_at=now,
    )

    enriched = _enrich_top_devices_with_sqlite(
        raw_top_devices=[
            {
                "ipv4_address": "192.168.1.10",
                "total_events": 1500,
                "bytes": 64000,
                "dns_queries": 1400,
                "allowed_packets": 90,
                "blocked_packets": 10,
                "last_seen_at": "2026-10-31T23:00:00Z",
            },
            {
                "ipv4_address": "192.168.1.199",
                "total_events": 200,
                "bytes": 4096,
                "dns_queries": 180,
                "allowed_packets": 20,
                "blocked_packets": 0,
                "last_seen_at": None,
            },
            {"ipv4_address": ""},
        ],
        sqlite_devices=[dev],
        settings=test_settings,
    )
    assert len(enriched) == 2
    assert enriched[0].device_id == 10
    assert enriched[0].effective_name == "Kids iPad Air"
    assert enriched[1].device_id is None
    assert enriched[1].effective_name == "192.168.1.199"

    overview = _assemble_network_overview_response(
        es_data={
            "summary": {
                "total_events": 1700,
                "total_bytes": 68096,
                "dns_query_count": 1580,
                "firewall_event_count": 120,
                "allowed_packet_count": 110,
                "blocked_packet_count": 10,
            },
            "timeline": [
                {
                    "timestamp": "2026-10-31T16:00:00-07:00",
                    "total_events": 1700,
                    "bytes": 68096,
                    "dns_queries": 1580,
                    "allowed_packets": 110,
                    "blocked_packets": 10,
                }
            ],
            "top_devices": [{"ipv4_address": "192.168.1.10", "total_events": 1500}],
            "top_domains": [{"domain": "discord.com", "query_count": 400}],
            "top_registered_domains": [{"domain": "discord.com", "query_count": 400}],
            "top_organizations": [
                {"organization": "Cloudflare", "packet_count": 80, "bytes": 32000}
            ],
        },
        sqlite_devices=[dev],
        settings=test_settings,
        window="24h",
    )
    assert overview.es_reachable is True
    assert overview.top_devices[0].effective_name == "Kids iPad Air"

    fallback_overview = _build_empty_overview_response("24h", "ES timeout", es_reachable=False)
    assert fallback_overview.es_reachable is False
    assert fallback_overview.warning == "ES timeout"

    dev_resp = build_device_response(dev, test_settings, None)
    empty_dev = _build_empty_device_analytics_response(dev_resp, "24h", "No IP", es_reachable=True)
    assert len(empty_dev.hourly_access_profile) == 24

    assembled_dev = _assemble_device_analytics_response(
        device_resp=dev_resp,
        es_data={
            "summary": {
                "total_events": 500,
                "total_bytes": 12000,
                "dns_query_count": 450,
                "firewall_event_count": 50,
                "allowed_packet_count": 48,
                "blocked_packet_count": 2,
                "active_hours_in_day": 5,
                "first_active_at": "2026-10-31T08:00:00Z",
                "last_active_at": "2026-10-31T22:00:00Z",
            },
            "timeline": [],
            "hourly_access_profile": [
                {
                    "hour": h,
                    "label": f"{h:02d}:00",
                    "total_events": 10 if h == 14 else 0,
                    "dns_queries": 10 if h == 14 else 0,
                    "bytes": 512 if h == 14 else 0,
                    "active_hours_count": 1 if h == 14 else 0,
                }
                for h in range(24)
            ],
            "top_domains": [{"domain": "github.com", "query_count": 45}],
            "top_registered_domains": [{"domain": "github.com", "query_count": 45}],
            "top_organizations": [{"organization": "GitHub", "packet_count": 30, "bytes": 8000}],
            "recent_queries": [
                {
                    "timestamp": "2026-10-31T22:00:00Z",
                    "domain": "api.github.com",
                    "registered_domain": "github.com",
                    "record_type": "A",
                }
            ],
        },
        window="24h",
    )
    assert assembled_dev.summary.active_hours_in_day == 5
    assert assembled_dev.recent_queries[0].domain == "api.github.com"

    assert _require_device_or_404(dev, 10) is dev
    with pytest.raises(HTTPException) as exc_info:
        _require_device_or_404(None, 999)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_analytics_api_endpoints_enrichment_cache_and_fallback(
    async_client: AsyncClient,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_analytics_cache().clear()

    # 1. Unauthenticated requests should return 401
    unauth1 = await async_client.get("/api/v1/analytics/overview")
    assert unauth1.status_code == 401
    unauth2 = await async_client.get("/api/v1/devices/1/analytics")
    assert unauth2.status_code == 401

    # 2. Seed two devices in SQLite: one with IPv4, one offline without IPv4
    now = utc_now()
    session_factory = get_session_factory(test_settings)
    async with session_factory() as session:
        d1 = Device(
            mac_address="aa:bb:cc:00:11:22",
            ipv4_address="192.168.1.134",
            hostname="workstation",
            display_name="Office Workstation",
            vendor="Intel",
            interface_name="lan",
            lease_type="dynamic",
            is_online=True,
            is_blocked=False,
            is_protected=False,
            notes="",
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        d2 = Device(
            mac_address="aa:bb:cc:00:11:33",
            ipv4_address=None,
            hostname="old-kindle",
            display_name=None,
            vendor="Amazon",
            interface_name="lan",
            lease_type="dynamic",
            is_online=False,
            is_blocked=False,
            is_protected=False,
            notes="",
            first_seen_at=now,
            last_seen_at=now,
            updated_at=now,
        )
        session.add_all([d1, d2])
        await session.commit()
        await session.refresh(d1)
        await session.refresh(d2)
        d1_id = d1.id
        d2_id = d2.id

    # 3. Log in as admin
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200

    # 4. Mock ElasticsearchServiceClient
    mock_es_client = AsyncMock(spec=ElasticsearchServiceClient)
    mock_es_client.fetch_network_overview = AsyncMock(
        return_value={
            "window": "24h",
            "summary": {
                "total_events": 50000,
                "total_bytes": 1048576,
                "dns_query_count": 45000,
                "firewall_event_count": 5000,
                "allowed_packet_count": 4800,
                "blocked_packet_count": 200,
            },
            "timeline": [
                {
                    "timestamp": "2026-10-31T15:00:00-07:00",
                    "total_events": 5000,
                    "bytes": 102400,
                    "dns_queries": 4500,
                    "allowed_packets": 480,
                    "blocked_packets": 20,
                }
            ],
            "top_devices": [
                {
                    "ipv4_address": "192.168.1.134",
                    "total_events": 30000,
                    "bytes": 524288,
                    "dns_queries": 28000,
                    "allowed_packets": 1900,
                    "blocked_packets": 100,
                    "last_seen_at": "2026-10-31T23:30:00Z",
                }
            ],
            "top_domains": [{"domain": "discord.com", "query_count": 1294}],
            "top_registered_domains": [{"domain": "discord.com", "query_count": 1294}],
            "top_organizations": [
                {"organization": "Google LLC", "packet_count": 1200, "bytes": 256000}
            ],
        }
    )
    mock_es_client.fetch_device_analytics = AsyncMock(
        return_value={
            "window": "24h",
            "summary": {
                "total_events": 30000,
                "total_bytes": 524288,
                "dns_query_count": 28000,
                "firewall_event_count": 2000,
                "allowed_packet_count": 1900,
                "blocked_packet_count": 100,
                "active_hours_in_day": 12,
                "first_active_at": "2026-10-31T07:00:00Z",
                "last_active_at": "2026-10-31T23:30:00Z",
            },
            "timeline": [],
            "hourly_access_profile": [
                {
                    "hour": h,
                    "label": f"{h:02d}:00",
                    "total_events": 2500 if h < 12 else 0,
                    "dns_queries": 2300 if h < 12 else 0,
                    "bytes": 40000 if h < 12 else 0,
                    "active_hours_count": 1 if h < 12 else 0,
                }
                for h in range(24)
            ],
            "top_domains": [{"domain": "discord.com", "query_count": 1294}],
            "top_registered_domains": [{"domain": "discord.com", "query_count": 1294}],
            "top_organizations": [
                {"organization": "Google LLC", "packet_count": 1200, "bytes": 256000}
            ],
            "recent_queries": [
                {
                    "timestamp": "2026-10-31T23:30:00Z",
                    "domain": "discord.com",
                    "registered_domain": "discord.com",
                    "record_type": "A",
                }
            ],
        }
    )

    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_network_overview",
        mock_es_client.fetch_network_overview,
    )
    monkeypatch.setattr(
        ElasticsearchServiceClient,
        "fetch_device_analytics",
        mock_es_client.fetch_device_analytics,
    )

    # 5. GET /api/v1/analytics/overview (cache miss -> populates cache)
    ov1 = await async_client.get("/api/v1/analytics/overview?window=24h")
    assert ov1.status_code == 200
    ov1_json: dict[str, Any] = ov1.json()
    assert ov1_json["es_reachable"] is True
    assert ov1_json["top_devices"][0]["device_id"] == d1_id
    assert ov1_json["top_devices"][0]["effective_name"] == "Office Workstation"
    assert mock_es_client.fetch_network_overview.call_count == 1

    # Second call -> served from TTL cache
    ov2 = await async_client.get("/api/v1/analytics/overview?window=24h")
    assert ov2.status_code == 200
    assert mock_es_client.fetch_network_overview.call_count == 1

    # Refresh=true -> bypasses cache
    ov3 = await async_client.get("/api/v1/analytics/overview?window=24h&refresh=true")
    assert ov3.status_code == 200
    assert mock_es_client.fetch_network_overview.call_count == 2

    # 6. GET /api/v1/devices/{id}/analytics
    dev1 = await async_client.get(f"/api/v1/devices/{d1_id}/analytics?window=24h")
    assert dev1.status_code == 200
    dev1_json = dev1.json()
    assert dev1_json["es_reachable"] is True
    assert dev1_json["device"]["effective_name"] == "Office Workstation"
    assert dev1_json["summary"]["active_hours_in_day"] == 12
    assert mock_es_client.fetch_device_analytics.call_count == 1

    # Second call -> served from TTL cache
    dev1_cached = await async_client.get(f"/api/v1/devices/{d1_id}/analytics?window=24h")
    assert dev1_cached.status_code == 200
    assert mock_es_client.fetch_device_analytics.call_count == 1

    # Device without IPv4 -> returns zero-state payload without calling ES
    dev2 = await async_client.get(f"/api/v1/devices/{d2_id}/analytics?window=24h")
    assert dev2.status_code == 200
    dev2_json = dev2.json()
    assert dev2_json["es_reachable"] is True
    assert "does not currently have an IPv4 address" in dev2_json["warning"]
    assert mock_es_client.fetch_device_analytics.call_count == 1

    # Non-existent device -> 404
    not_found = await async_client.get("/api/v1/devices/99999/analytics")
    assert not_found.status_code == 404

    # 7. Simulate Elasticsearch outage -> graceful fallback (200 with es_reachable=False)
    mock_es_client.fetch_network_overview.side_effect = ElasticsearchQueryError(
        "Elasticsearch connection timed out", status_code=503
    )
    mock_es_client.fetch_device_analytics.side_effect = ElasticsearchQueryError(
        "Elasticsearch connection timed out", status_code=503
    )

    ov_err = await async_client.get("/api/v1/analytics/overview?window=1h&refresh=true")
    assert ov_err.status_code == 200
    assert ov_err.json()["es_reachable"] is False
    assert "timed out" in ov_err.json()["warning"]

    dev_err = await async_client.get(
        f"/api/v1/devices/{d1_id}/analytics?window=1h&refresh=true"
    )
    assert dev_err.status_code == 200
    assert dev_err.json()["es_reachable"] is False
    assert "timed out" in dev_err.json()["warning"]
