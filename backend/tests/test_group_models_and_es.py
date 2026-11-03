"""Unit tests for Phase 4 Step 4.1: DeviceGroup models and Multi-IP ES query builders."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from elastic_transport import ConnectionError as ESConnectionError
from elasticsearch import AuthenticationException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    build_group_analytics_query,
    build_group_recent_domains_query,
    normalize_group_analytics_response,
    validate_ipv4_list,
)
from app.config import Settings
from app.db import get_session_factory
from app.models import (
    Device,
    DeviceGroup,
    DeviceGroupMembership,
    normalize_group_color,
)


def test_normalize_group_color_validation() -> None:
    """Verify valid group badge colors normalize cleanly and invalid colors raise ValueError."""
    assert normalize_group_color(None) == "indigo"
    assert normalize_group_color("  EMERALD ") == "emerald"
    assert normalize_group_color("rose") == "rose"
    with pytest.raises(ValueError, match="Unsupported group color"):
        normalize_group_color("neon-pink")


def test_validate_ipv4_list_deduplicates_and_rejects_empty() -> None:
    """Verify validate_ipv4_list deduplicates valid IPs and rejects empty or invalid lists."""
    ips = validate_ipv4_list(["192.168.1.10", " 192.168.1.20 ", "192.168.1.10", ""])
    assert ips == ["192.168.1.10", "192.168.1.20"]

    with pytest.raises(ValueError, match="At least one valid IPv4"):
        validate_ipv4_list(["", "   "])

    with pytest.raises(ValueError, match="Invalid IPv4"):
        validate_ipv4_list(["192.168.1.10", "not-an-ip"])


def test_build_group_analytics_and_recent_domains_queries() -> None:
    """Verify multi-IP terms filters and by_source_ip/by_destination_ip aggregations."""
    ips = ["192.168.1.10", "192.168.1.20"]
    q = build_group_analytics_query(
        ipv4_addresses=ips,
        window="7d",
        tz_name="America/Los_Angeles",
        top_n=12,
    )
    filters = q["query"]["bool"]["filter"]
    assert filters[0] == {"range": {"@timestamp": {"gte": "now-7d"}}}
    should_clauses = filters[1]["bool"]["should"]
    assert {"terms": {"source.ip": ips}} in should_clauses
    assert {"terms": {"destination.ip": ips}} in should_clauses
    assert {"terms": {"client.ip": ips}} in should_clauses
    assert "by_source_ip" in q["aggs"]
    assert "by_destination_ip" in q["aggs"]

    recent_q = build_group_recent_domains_query(
        ipv4_addresses=ips,
        window="24h",
        domain_search="youtube.com",
        limit=25,
    )
    assert recent_q["size"] == 25
    r_filters = recent_q["query"]["bool"]["filter"]
    assert len(r_filters) == 4
    assert r_filters[2]["bool"]["should"] == [
        {"terms": {"source.ip": ips}},
        {"terms": {"client.ip": ips}},
    ]


def test_normalize_group_analytics_response_computes_member_breakdown() -> None:
    """Verify normalize_group_analytics_response computes per-member IP traffic and DNS stats."""
    raw_aggs: dict[str, Any] = {
        "hits": {"total": {"value": 350}},
        "aggregations": {
            "total_bytes": {"value": 150000},
            "by_provider": {
                "buckets": [
                    {"key": "filterlog", "doc_count": 200},
                    {"key": "unbound", "doc_count": 150},
                ]
            },
            "by_action": {
                "buckets": [
                    {"key": "pass", "doc_count": 180},
                    {"key": "block", "doc_count": 20},
                ]
            },
            "first_activity": {"value_as_string": "2026-10-31T08:00:00.000Z"},
            "last_activity": {"value_as_string": "2026-10-31T17:00:00.000Z"},
            "timeline": {"buckets": []},
            "hourly_profile": {
                "buckets": [
                    {
                        "key_as_string": "2026-10-31T15:00:00.000-07:00",
                        "doc_count": 100,
                        "bytes": {"value": 50000},
                        "dns_queries": {"doc_count": 40},
                    }
                ]
            },
            "by_source_ip": {
                "buckets": [
                    {
                        "key": "192.168.1.10",
                        "doc_count": 220,
                        "bytes": {"value": 90000},
                        "dns_queries": {"doc_count": 100},
                        "allowed_packets": {"doc_count": 110},
                        "blocked_packets": {"doc_count": 10},
                    },
                    {
                        "key": "192.168.1.20",
                        "doc_count": 80,
                        "bytes": {"value": 30000},
                        "dns_queries": {"doc_count": 50},
                        "allowed_packets": {"doc_count": 20},
                        "blocked_packets": {"doc_count": 10},
                    },
                    {
                        "key": "8.8.8.8",
                        "doc_count": 999,
                        "bytes": {"value": 999999},
                    },
                ]
            },
            "by_destination_ip": {
                "buckets": [
                    {
                        "key": "192.168.1.10",
                        "doc_count": 50,
                        "bytes": {"value": 30000},
                        "allowed_packets": {"doc_count": 50},
                        "blocked_packets": {"doc_count": 0},
                    }
                ]
            },
            "unbound_dns": {
                "top_domains": {"buckets": [{"key": "roblox.com", "doc_count": 45}]},
                "top_registered_domains": {"buckets": [{"key": "roblox.com", "doc_count": 45}]},
            },
            "filterlog_orgs": {
                "top_asn_orgs": {
                    "buckets": [
                        {"key": "Cloudflare, Inc.", "doc_count": 90, "bytes": {"value": 80000}}
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
                        "@timestamp": "2026-10-31T17:00:00.000Z",
                        "source": {"ip": "192.168.1.10"},
                        "dns": {
                            "question": {
                                "name": "www.roblox.com",
                                "registered_domain": "roblox.com",
                                "type": "AAAA",
                            }
                        },
                    }
                }
            ]
        }
    }

    normalized = normalize_group_analytics_response(
        raw_aggs,
        raw_recent,
        member_ips=["192.168.1.10", "192.168.1.20"],
        window="24h",
    )
    assert normalized["summary"]["total_events"] == 350
    assert normalized["summary"]["total_bytes"] == 150000
    assert len(normalized["member_ip_breakdown"]) == 2
    first_member = normalized["member_ip_breakdown"][0]
    assert first_member["ip"] == "192.168.1.10"
    assert first_member["bytes"] == 120000  # 90000 source + 30000 dest
    assert first_member["total_events"] == 270  # 220 source + 50 dest
    assert first_member["dns_query_count"] == 100
    assert normalized["recent_queries"][0]["source_ip"] == "192.168.1.10"


@pytest.mark.asyncio
async def test_es_service_client_fetch_group_analytics_and_errors(
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify ElasticsearchServiceClient.fetch_group_analytics handles success and ES errors."""
    client = ElasticsearchServiceClient(test_settings)
    mock_es = AsyncMock()
    mock_es.search = AsyncMock(
        side_effect=[
            {"hits": {"total": {"value": 12}}, "aggregations": {}},
            {"hits": {"hits": []}},
        ]
    )
    mock_es.close = AsyncMock()
    monkeypatch.setattr(client, "create_es_client", lambda: mock_es)

    res = await client.fetch_group_analytics(["192.168.1.10", "192.168.1.20"], window="1h")
    assert res["window"] == "1h"
    assert res["summary"]["total_events"] == 12
    assert len(res["member_ip_breakdown"]) == 2

    # Auth error (403)
    mock_es_auth = AsyncMock()
    mock_es_auth.search = AsyncMock(
        side_effect=AuthenticationException("Forbidden", meta=None, body=None)
    )
    mock_es_auth.close = AsyncMock()
    monkeypatch.setattr(client, "create_es_client", lambda: mock_es_auth)
    with pytest.raises(ElasticsearchQueryError) as exc_info:
        await client.fetch_group_analytics(["192.168.1.10"])
    assert exc_info.value.status_code == 403

    # Transport error (503)
    mock_es_conn = AsyncMock()
    mock_es_conn.search = AsyncMock(side_effect=ESConnectionError("Connection refused"))
    mock_es_conn.close = AsyncMock()
    monkeypatch.setattr(client, "create_es_client", lambda: mock_es_conn)
    with pytest.raises(ElasticsearchQueryError) as exc_info2:
        await client.fetch_group_analytics(["192.168.1.10"])
    assert exc_info2.value.status_code == 503


@pytest.mark.asyncio
async def test_device_group_and_membership_persistence_and_cascade(
    initialized_db: Settings,
) -> None:
    """Verify DeviceGroup and DeviceGroupMembership constraints and ON DELETE CASCADE."""
    factory = get_session_factory(initialized_db)
    async with factory() as session:
        d1 = Device(mac_address="aa:bb:cc:00:11:01", ipv4_address="192.168.1.101")
        d2 = Device(mac_address="aa:bb:cc:00:11:02", ipv4_address="192.168.1.102")
        grp = DeviceGroup(
            name="Kids Devices",
            description="Phones and tablets",
            color_badge="indigo",
            icon="users",
        )
        session.add_all([d1, d2, grp])
        await session.commit()
        await session.refresh(d1)
        await session.refresh(d2)
        await session.refresh(grp)

        m1 = DeviceGroupMembership(group_id=grp.id, device_id=d1.id)
        m2 = DeviceGroupMembership(group_id=grp.id, device_id=d2.id)
        session.add_all([m1, m2])
        await session.commit()

        # Duplicate membership in same group must fail
        dup = DeviceGroupMembership(group_id=grp.id, device_id=d1.id)
        session.add(dup)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

        # Deleting a group cascades to device_group_memberships
        await session.delete(grp)
        await session.commit()

        remaining = (await session.execute(select(DeviceGroupMembership))).scalars().all()
        assert remaining == []
