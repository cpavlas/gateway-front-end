"""Unit tests for Phase 3 Step 3.1 Elasticsearch 9.4.3 query builders & normalizers."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from elastic_transport import ConnectionTimeout
from elasticsearch import AuthenticationException

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    _compute_24h_access_profile,
    build_device_analytics_query,
    build_device_recent_domains_query,
    build_network_overview_query,
    normalize_device_analytics_response,
    normalize_network_overview_response,
    resolve_time_window,
    sanitize_domain_search,
)
from app.config import Settings


def test_resolve_time_window_valid_and_invalid() -> None:
    assert resolve_time_window(None) == ("24h", "now-24h", "1h")
    assert resolve_time_window("1h") == ("1h", "now-1h", "5m")
    assert resolve_time_window(" 7D ") == ("7d", "now-7d", "6h")
    assert resolve_time_window("30d") == ("30d", "now-30d", "1d")

    with pytest.raises(ValueError, match="Unsupported time window"):
        resolve_time_window("90d")


def test_sanitize_domain_search() -> None:
    assert sanitize_domain_search(None) is None
    assert sanitize_domain_search("   ") is None
    assert sanitize_domain_search("***???") is None
    assert sanitize_domain_search("  Discord.COM*? ") == "discord.com"


def test_build_and_normalize_network_overview() -> None:
    q = build_network_overview_query(window="24h", tz_name="America/Los_Angeles", top_n=8)
    assert q["query"]["range"]["@timestamp"]["gte"] == "now-24h"
    assert q["aggs"]["timeline"]["date_histogram"]["fixed_interval"] == "1h"
    assert q["aggs"]["timeline"]["date_histogram"]["time_zone"] == "America/Los_Angeles"
    assert q["aggs"]["lan_devices"]["aggs"]["top_ips"]["terms"]["size"] == 8

    raw_es: dict[str, Any] = {
        "hits": {"total": {"value": 120500, "relation": "eq"}},
        "aggregations": {
            "total_bytes": {"value": 9876543.0},
            "by_provider": {
                "buckets": [
                    {"key": "unbound", "doc_count": 90000},
                    {"key": "filterlog", "doc_count": 30000},
                ]
            },
            "by_action": {
                "buckets": [
                    {"key": "pass", "doc_count": 25000},
                    {"key": "block", "doc_count": 5000},
                ]
            },
            "timeline": {
                "buckets": [
                    {
                        "key_as_string": "2026-10-31T14:00:00.000-07:00",
                        "doc_count": 5000,
                        "bytes": {"value": 102400.0},
                        "dns_queries": {"doc_count": 4200},
                        "allowed_packets": {"doc_count": 700},
                        "blocked_packets": {"doc_count": 100},
                    }
                ]
            },
            "lan_devices": {
                "top_ips": {
                    "buckets": [
                        {
                            "key": "192.168.1.134",
                            "doc_count": 61892,
                            "bytes": {"value": 33604.0},
                            "dns_queries": {"doc_count": 61225},
                            "allowed_packets": {"doc_count": 469},
                            "blocked_packets": {"doc_count": 198},
                            "last_seen": {"value_as_string": "2026-10-31T23:30:00Z"},
                        },
                        {"key": "", "doc_count": 1},
                    ]
                }
            },
            "unbound_dns": {
                "top_domains": {
                    "buckets": [
                        {"key": "discord.com", "doc_count": 1294},
                        {"key": "elasticsearch.example.local", "doc_count": 8956},
                    ]
                },
                "top_registered_domains": {
                    "buckets": [
                        {"key": "example.local", "doc_count": 12208},
                        {"key": "discord.com", "doc_count": 1294},
                    ]
                },
            },
            "filterlog_orgs": {
                "top_asn_orgs": {
                    "buckets": [
                        {
                            "key": "Google LLC",
                            "doc_count": 167955,
                            "bytes": {"value": 4500000.0},
                        }
                    ]
                }
            },
        },
    }

    norm = normalize_network_overview_response(raw_es, window="24h")
    assert norm["window"] == "24h"
    assert norm["summary"]["total_events"] == 120500
    assert norm["summary"]["total_bytes"] == 9876543
    assert norm["summary"]["dns_query_count"] == 90000
    assert norm["summary"]["firewall_event_count"] == 30000
    assert norm["summary"]["allowed_packet_count"] == 25000
    assert norm["summary"]["blocked_packet_count"] == 5000
    assert len(norm["timeline"]) == 1
    assert norm["timeline"][0]["bytes"] == 102400
    assert len(norm["top_devices"]) == 1
    assert norm["top_devices"][0]["ipv4_address"] == "192.168.1.134"
    assert norm["top_domains"][0]["domain"] == "discord.com"
    assert norm["top_organizations"][0]["organization"] == "Google LLC"

    # Also test integer hits.total fallback
    norm_empty = normalize_network_overview_response({"hits": {"total": 42}}, window="1h")
    assert norm_empty["summary"]["total_events"] == 42


def test_build_and_normalize_device_analytics_and_24h_profile() -> None:
    aggs_q = build_device_analytics_query("192.168.1.134", window="7d", tz_name="", top_n=12)
    assert aggs_q["aggs"]["timeline"]["date_histogram"]["fixed_interval"] == "6h"
    assert aggs_q["aggs"]["timeline"]["date_histogram"]["time_zone"] == "UTC"

    recent_q = build_device_recent_domains_query(
        "192.168.1.134",
        window="24h",
        domain_search="discord",
        limit=25,
    )
    assert recent_q["size"] == 25
    filters = recent_q["query"]["bool"]["filter"]
    assert any("wildcard" in f for f in filters)

    # Test 24h access profile calculation including malformed timestamp fallback
    profile = _compute_24h_access_profile(
        [
            {
                "key_as_string": "2026-10-31T14:00:00.000-07:00",
                "doc_count": 500,
                "dns_queries": {"doc_count": 480},
                "bytes": {"value": 12000.0},
            },
            {
                "key_as_string": "bad-dateT14:30",
                "doc_count": 50,
                "dns_queries": {"doc_count": 40},
                "bytes": {"value": 800.0},
            },
            {
                "key_as_string": "bad-dateTxx:30",
                "doc_count": 10,
            },
            {
                "key_as_string": "2026-10-31T03:00:00Z",
                "doc_count": 0,
            },
        ]
    )
    assert len(profile) == 24
    assert profile[14]["total_events"] == 550
    assert profile[14]["dns_queries"] == 520
    assert profile[14]["bytes"] == 12800
    assert profile[14]["active_hours_count"] == 2
    assert profile[0]["total_events"] == 10

    raw_dev_aggs: dict[str, Any] = {
        "hits": {"total": 61912},
        "aggregations": {
            "total_bytes": {"value": 33604.0},
            "by_provider": {"buckets": [{"key": "unbound", "doc_count": 61225}]},
            "by_action": {"buckets": [{"key": "pass", "doc_count": 469}]},
            "first_activity": {"value_as_string": "2026-10-31T00:01:00Z"},
            "last_activity": {"value_as_string": "2026-10-31T23:31:04Z"},
            "timeline": {
                "buckets": [
                    {
                        "key_as_string": "2026-10-31T15:00:00.000-07:00",
                        "doc_count": 5274,
                        "bytes": {"value": 3484.0},
                        "dns_queries": {"doc_count": 5207},
                        "allowed_packets": {"doc_count": 67},
                        "blocked_packets": {"doc_count": 0},
                    }
                ]
            },
            "hourly_profile": {
                "buckets": [
                    {
                        "key_as_string": "2026-10-31T15:00:00.000-07:00",
                        "doc_count": 5274,
                        "bytes": {"value": 3484.0},
                        "dns_queries": {"doc_count": 5207},
                    }
                ]
            },
            "unbound_dns": {
                "top_domains": {"buckets": [{"key": "discord.com", "doc_count": 1294}]},
                "top_registered_domains": {"buckets": [{"key": "discord.com", "doc_count": 1294}]},
            },
            "filterlog_orgs": {
                "top_asn_orgs": {
                    "buckets": [
                        {
                            "key": "Cloudflare, Inc.",
                            "doc_count": 320,
                            "bytes": {"value": 18000.0},
                        }
                    ]
                }
            },
        },
    }
    raw_recent: dict[str, Any] = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        "@timestamp": "2026-10-31T23:31:04.000Z",
                        "dns": {
                            "question": {
                                "name": "discord.com",
                                "registered_domain": "discord.com",
                                "type": "AAAA",
                            }
                        },
                    }
                },
                {"_source": {"@timestamp": "2026-10-31T23:31:00.000Z", "dns": {}}},
            ]
        }
    }

    dev_norm = normalize_device_analytics_response(raw_dev_aggs, raw_recent, window="24h")
    assert dev_norm["summary"]["total_events"] == 61912
    assert dev_norm["summary"]["active_hours_in_day"] == 1
    assert len(dev_norm["recent_queries"]) == 1
    assert dev_norm["recent_queries"][0]["domain"] == "discord.com"
    assert dev_norm["recent_queries"][0]["record_type"] == "AAAA"


@pytest.mark.asyncio
async def test_es_service_client_fetch_methods_and_error_wrapping(
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    svc = ElasticsearchServiceClient(test_settings)

    mock_es = AsyncMock()
    mock_es.search = AsyncMock(
        return_value={
            "hits": {"total": {"value": 10}},
            "aggregations": {
                "total_bytes": {"value": 512.0},
            },
        }
    )
    mock_es.close = AsyncMock()
    monkeypatch.setattr(svc, "create_es_client", lambda: mock_es)

    overview = await svc.fetch_network_overview(window="1h")
    assert overview["window"] == "1h"
    assert overview["summary"]["total_bytes"] == 512

    dev_analytics = await svc.fetch_device_analytics("192.168.1.134", window="24h")
    assert dev_analytics["window"] == "24h"
    assert dev_analytics["summary"]["total_bytes"] == 512

    # Test AuthenticationException -> ElasticsearchQueryError(403)
    mock_es.search.side_effect = AuthenticationException(
        message="Invalid API key", meta=None, body=None
    )
    with pytest.raises(ElasticsearchQueryError) as exc_info:
        await svc.fetch_network_overview("24h")
    assert exc_info.value.status_code == 403

    with pytest.raises(ElasticsearchQueryError) as exc_info2:
        await svc.fetch_device_analytics("192.168.1.134", "24h")
    assert exc_info2.value.status_code == 403

    # Test TransportError -> ElasticsearchQueryError(503)
    mock_es.search.side_effect = ConnectionTimeout("Timed out")
    with pytest.raises(ElasticsearchQueryError) as exc_info3:
        await svc.fetch_network_overview("24h")
    assert exc_info3.value.status_code == 503

    with pytest.raises(ElasticsearchQueryError) as exc_info4:
        await svc.fetch_device_analytics("192.168.1.134", "24h")
    assert exc_info4.value.status_code == 503
