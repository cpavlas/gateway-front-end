"""Unit and integration tests for Phase 10 (`v1.0.4` — `FB-P10-001`):
Dedicated `Firewall & Security` Tab, Elasticsearch `filterlog` query builder,
LAN vs. WAN classification, Open Inbound WAN Port exposure, and SQLite device correlation.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    build_firewall_overview_query,
    is_private_lan_ip,
    normalize_firewall_overview_response,
    sanitize_firewall_search,
)
from app.config import Settings
from app.db import get_session_factory
from app.models import Device, utc_now
from app.services.analytics_service import get_analytics_cache
from app.services.firewall_service import build_firewall_overview_response


def test_firewall_search_sanitization_and_ip_classification() -> None:
    """Verify `sanitize_firewall_search` and `is_private_lan_ip` helpers."""
    assert sanitize_firewall_search(None) is None
    assert sanitize_firewall_search("   ") is None
    assert sanitize_firewall_search(" 192.168.1.50; DROP ") == "192.168.1.50drop"
    assert sanitize_firewall_search("443") == "443"
    assert sanitize_firewall_search("vtnet0") == "vtnet0"

    assert is_private_lan_ip("192.168.1.42") is True
    assert is_private_lan_ip("10.0.0.5") is True
    assert is_private_lan_ip("172.16.5.10") is True
    assert is_private_lan_ip("127.0.0.1") is True
    assert is_private_lan_ip("fe80::1") is True
    assert is_private_lan_ip("0.0.0.0") is False
    assert is_private_lan_ip("255.255.255.255") is False
    assert is_private_lan_ip("224.0.0.251") is False
    assert is_private_lan_ip("8.8.8.8") is False
    assert is_private_lan_ip("185.220.101.5") is False
    assert is_private_lan_ip("not-an-ip") is False
    assert is_private_lan_ip(None) is False


def test_build_and_normalize_firewall_overview_query_and_response() -> None:
    """Verify `build_firewall_overview_query` and `normalize_firewall_overview_response`."""
    q_basic = build_firewall_overview_query(
        window="24h",
        tz_name="America/Los_Angeles",
        action="block",
        direction="inbound",
        protocol="tcp",
        search="443",
    )
    filters = q_basic["query"]["bool"]["filter"]
    post_filters = q_basic["post_filter"]["bool"]["filter"]
    assert {"term": {"event.provider": "filterlog"}} in filters
    assert {"term": {"event.action": "block"}} in post_filters
    assert {"terms": {"network.direction": ["inbound", "in"]}} in post_filters
    assert {"term": {"network.transport": "tcp"}} in post_filters
    assert any("should" in (f.get("bool") or {}) for f in post_filters)

    # Test IP search branch
    q_ip = build_firewall_overview_query(
        window="1h",
        direction="outbound",
        search="192.168.1.55",
    )
    assert any("outbound" in str(f) for f in q_ip["post_filter"]["bool"]["filter"])

    mock_raw_es: dict[str, Any] = {
        "hits": {
            "total": {"value": 1500},
            "hits": [
                {
                    "_source": {
                        "@timestamp": "2026-11-04T12:00:00Z",
                        "event": {"action": "block"},
                        "network": {
                            "direction": "inbound",
                            "transport": "tcp",
                            "bytes": 60,
                        },
                        "observer": {
                            "ingress": {"interface": {"name": "vtnet1"}},
                        },
                        "source": {
                            "ip": "192.168.1.55",
                            "port": 51234,
                        },
                        "destination": {
                            "ip": "93.184.216.34",
                            "port": 443,
                            "as": {"organization": {"name": "Edgecast"}},
                        },
                        "rule": {"id": "rule-abc"},
                    }
                }
            ],
        },
        "aggregations": {
            "total_bytes": {"value": 2048000},
            "by_action": {
                "buckets": [
                    {"key": "pass", "doc_count": 1200},
                    {"key": "block", "doc_count": 300},
                ]
            },
            "by_direction": {
                "buckets": [
                    {"key": "outbound", "doc_count": 1100},
                    {"key": "inbound", "doc_count": 400},
                ]
            },
            "timeline": {
                "buckets": [
                    {
                        "key_as_string": "2026-11-04T11:00:00Z",
                        "doc_count": 1500,
                        "bytes": {"value": 2048000},
                        "allowed_packets": {"doc_count": 1200},
                        "blocked_packets": {"doc_count": 300},
                    }
                ]
            },
            "blocked_sources": {
                "sources": {
                    "buckets": [
                        {
                            "key": "192.168.1.55",
                            "doc_count": 180,
                            "bytes": {"value": 18000},
                            "last_seen": {"value_as_string": "2026-11-04T12:00:00Z"},
                            "top_ports": {"buckets": [{"key": 443, "doc_count": 150}]},
                            "top_org": {"buckets": []},
                        },
                        {
                            "key": "185.220.101.9",
                            "doc_count": 120,
                            "bytes": {"value": 7200},
                            "last_seen": {"value_as_string": "2026-11-04T11:58:00Z"},
                            "top_ports": {
                                "buckets": [
                                    {"key": 22, "doc_count": 80},
                                    {"key": 3389, "doc_count": 40},
                                ]
                            },
                            "top_org": {
                                "buckets": [{"key": "Tor Exit Org", "doc_count": 120}]
                            },
                        },
                    ]
                }
            },
            "inbound_wan_passed": {
                "by_dest_ip": {
                    "buckets": [
                        {
                            "key": "192.168.1.200",
                            "doc_count": 45,
                            "by_port": {
                                "buckets": [
                                    {
                                        "key": 32400,
                                        "doc_count": 45,
                                        "protocols": {
                                            "buckets": [{"key": "tcp", "doc_count": 45}]
                                        },
                                        "bytes": {"value": 512000},
                                        "unique_sources": {"value": 3},
                                        "last_seen": {
                                            "value_as_string": "2026-11-04T11:55:00Z"
                                        },
                                    }
                                ]
                            },
                        }
                    ]
                }
            },
        },
    }

    normalized = normalize_firewall_overview_response(mock_raw_es, window="24h")
    assert normalized["summary"]["total_packets"] == 1500
    assert normalized["summary"]["allowed_packets"] == 1200
    assert normalized["summary"]["blocked_packets"] == 300
    assert normalized["summary"]["inbound_packets"] == 400
    assert normalized["summary"]["outbound_packets"] == 1100
    assert normalized["summary"]["open_wan_port_count"] == 1

    assert len(normalized["noisy_lan_sources"]) == 1
    assert normalized["noisy_lan_sources"][0]["ipv4_address"] == "192.168.1.55"
    assert normalized["noisy_lan_sources"][0]["target_ports"] == [443]

    assert len(normalized["external_scanners"]) == 1
    assert normalized["external_scanners"][0]["source_ip"] == "185.220.101.9"
    assert normalized["external_scanners"][0]["organization"] == "Tor Exit Org"

    assert len(normalized["open_wan_ports"]) == 1
    assert normalized["open_wan_ports"][0]["destination_ip"] == "192.168.1.200"
    assert normalized["open_wan_ports"][0]["destination_port"] == 32400

    # Enrich with SQLite Device rows via synchronous helper
    dev1 = Device(
        id=10,
        mac_address="AA:BB:CC:DD:EE:55",
        ipv4_address="192.168.1.55",
        hostname="iot-camera",
        display_name="Garage IoT Camera",
        is_online=True,
        is_blocked=False,
        is_protected=False,
        first_seen_at=utc_now(),
        last_seen_at=utc_now(),
        updated_at=utc_now(),
    )
    dev2 = Device(
        id=20,
        mac_address="AA:BB:CC:DD:EE:C8",
        ipv4_address="192.168.1.200",
        hostname="media-nas",
        display_name="Media NAS Server",
        is_online=True,
        is_blocked=False,
        is_protected=True,
        first_seen_at=utc_now(),
        last_seen_at=utc_now(),
        updated_at=utc_now(),
    )
    settings = Settings(
        _env_file=None,
        app_env="testing",
        app_secret_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    overview = build_firewall_overview_response(
        normalized,
        [dev1, dev2],
        settings,
        window="24h",
        es_reachable=True,
    )
    assert overview.es_reachable is True
    assert overview.noisy_lan_devices[0].device_id == 10
    assert overview.noisy_lan_devices[0].effective_name == "Garage IoT Camera"
    assert overview.open_wan_ports[0].device_id == 20
    assert overview.open_wan_ports[0].effective_name == "Media NAS Server"
    assert overview.open_wan_ports[0].external_port == 32400
    assert overview.open_wan_ports[0].port_mapping == "32400:32400"
    assert overview.recent_events[0].source_name == "Garage IoT Camera"

    # Test multi-host shared redirect port deduplication (e.g. 32400:32400 and 32401:32400)
    shared_port_es = {
        **normalized,
        "open_wan_ports": [
            {
                "destination_ip": "192.168.1.200",
                "destination_port": 32400,
                "protocol": "tcp",
                "passed_packets": 450,
                "bytes": 512000,
                "unique_external_sources": 4,
                "last_seen_at": "2026-11-04T11:55:00Z",
            },
            {
                "destination_ip": "192.168.1.55",
                "destination_port": 32400,
                "protocol": "tcp",
                "passed_packets": 5,
                "bytes": 4000,
                "unique_external_sources": 1,
                "last_seen_at": "2026-11-04T11:50:00Z",
            },
        ],
    }
    shared_overview = build_firewall_overview_response(
        shared_port_es,
        [dev1, dev2],
        settings,
        window="24h",
        es_reachable=True,
    )
    assert shared_overview.open_wan_ports[0].port_mapping == "32400:32400"
    assert shared_overview.open_wan_ports[1].port_mapping == "32401:32400"

    unreachable = build_firewall_overview_response(
        None,
        [dev1],
        settings,
        window="24h",
        es_reachable=False,
        warning="ES down",
    )
    assert unreachable.es_reachable is False
    assert unreachable.warning == "ES down"


async def test_firewall_overview_api_endpoint(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify `GET /api/v1/firewall/overview` end-to-end with SQLite device correlation."""
    get_analytics_cache().clear()
    await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )

    session_factory = get_session_factory(test_settings)
    async with session_factory() as db_session:
        device = Device(
            mac_address="AA:BB:CC:11:22:33",
            ipv4_address="192.168.1.77",
            hostname="smart-plug",
            display_name="Office Smart Plug",
            is_online=True,
            is_blocked=False,
            is_protected=False,
        )
        db_session.add(device)
        await db_session.commit()

    mock_es_payload = {
        "window": "24h",
        "summary": {
            "total_packets": 800,
            "allowed_packets": 650,
            "blocked_packets": 150,
            "inbound_packets": 200,
            "outbound_packets": 600,
            "total_bytes": 512000,
            "open_wan_port_count": 1,
        },
        "timeline": [
            {
                "timestamp": "2026-11-04T12:00:00Z",
                "total_events": 800,
                "bytes": 512000,
                "dns_queries": 0,
                "allowed_packets": 650,
                "blocked_packets": 150,
            }
        ],
        "noisy_lan_sources": [
            {
                "ipv4_address": "192.168.1.77",
                "blocked_packets": 95,
                "bytes": 9500,
                "target_ports": [443, 8883],
                "last_seen_at": "2026-11-04T12:00:00Z",
            }
        ],
        "external_scanners": [
            {
                "source_ip": "45.33.32.156",
                "organization": "Linode",
                "blocked_packets": 55,
                "bytes": 3300,
                "target_ports": [22, 80],
                "last_seen_at": "2026-11-04T11:50:00Z",
            }
        ],
        "open_wan_ports": [
            {
                "destination_ip": "192.168.1.77",
                "destination_port": 8443,
                "protocol": "tcp",
                "passed_packets": 12,
                "bytes": 14400,
                "unique_external_sources": 2,
                "last_seen_at": "2026-11-04T11:45:00Z",
            }
        ],
        "recent_events": [
            {
                "timestamp": "2026-11-04T12:00:00Z",
                "action": "block",
                "direction": "outbound",
                "protocol": "tcp",
                "interface": "vtnet1",
                "source_ip": "192.168.1.77",
                "source_port": 54321,
                "source_org": None,
                "destination_ip": "1.1.1.1",
                "destination_port": 443,
                "destination_org": "Cloudflare",
                "bytes": 60,
                "rule_id": "rule-1",
            }
        ],
    }

    with patch(
        "app.clients.elasticsearch.ElasticsearchServiceClient.fetch_firewall_overview",
        new=AsyncMock(return_value=mock_es_payload),
    ):
        resp = await async_client.get(
            "/api/v1/firewall/overview?window=24h&action=all&direction=all&protocol=all"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["es_reachable"] is True
        assert body["summary"]["total_packets"] == 800
        assert body["noisy_lan_devices"][0]["effective_name"] == "Office Smart Plug"
        assert body["open_wan_ports"][0]["effective_name"] == "Office Smart Plug"
        assert body["recent_events"][0]["source_name"] == "Office Smart Plug"

        # Second call hits short-TTL cache
        cached_resp = await async_client.get("/api/v1/firewall/overview?window=24h")
        assert cached_resp.status_code == 200

    # Test graceful fallback when Elasticsearch raises ElasticsearchQueryError
    with patch(
        "app.clients.elasticsearch.ElasticsearchServiceClient.fetch_firewall_overview",
        new=AsyncMock(side_effect=ElasticsearchQueryError("ES timeout", status_code=503)),
    ):
        fallback_resp = await async_client.get(
            "/api/v1/firewall/overview?window=24h&refresh=true"
        )
        assert fallback_resp.status_code == 200
        assert fallback_resp.json()["es_reachable"] is False
        assert "temporarily unavailable" in fallback_resp.json()["warning"]
