"""Unit tests for OPNsenseClient, ElasticsearchServiceClient, and /api/v1/system/health."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import respx
from elastic_transport import ApiResponseMeta
from elasticsearch import AuthenticationException
from httpx import AsyncClient

from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient, OPNsenseClientError, ServiceHealthStatus
from app.config import Settings


@respx.mock
async def test_opnsense_client_healthy_probe(test_settings: Settings) -> None:
    """OPNsenseClient.check_health succeeds when ARP, Dnsmasq leases, and alias_util return 200."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"ip": "192.168.1.1", "mac": "aa:bb:cc:dd:ee:01", "intf": "igb0"},
                {"ip": "192.168.1.101", "mac": "aa:bb:cc:dd:ee:02", "intf": "igb0"},
            ],
        )
    )
    respx.get("https://opnsense.example.local/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "rows": [
                    {
                        "address": "192.168.1.101",
                        "hwaddr": "aa:bb:cc:dd:ee:02",
                        "hostname": "kids-ipad",
                    }
                ]
            },
        )
    )
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(
        return_value=httpx.Response(
            200,
            json={"rows": [{"ip": "192.168.1.200"}]},
        )
    )

    client = OPNsenseClient(test_settings)
    health = await client.check_health()

    assert health.status == "healthy"
    assert health.details["arp_count"] == 2
    assert health.details["dnsmasq_lease_count"] == 1
    assert health.details["blocked_ip_count"] == 1


@respx.mock
async def test_opnsense_client_auth_failure(test_settings: Settings) -> None:
    """OPNsenseClient.check_health returns unhealthy when API returns 401/403."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(403, json={"message": "Forbidden"})
    )

    client = OPNsenseClient(test_settings)
    health = await client.check_health()

    assert health.status == "unhealthy"
    assert health.details["status_code"] == 403
    assert "403" in health.message


@respx.mock
async def test_opnsense_client_missing_alias_returns_degraded(test_settings: Settings) -> None:
    """If ARP and Dnsmasq succeed but block alias returns 404/error, status is degraded."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(200, json={"rows": [{"ip": "192.168.1.1"}]})
    )
    respx.get("https://opnsense.example.local/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(200, json=[])
    )
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(404, json={"error": "alias not found"}))

    client = OPNsenseClient(test_settings)
    health = await client.check_health()

    assert health.status == "degraded"
    assert "gateway_blocked_devices" in health.message


@respx.mock
async def test_opnsense_client_alias_util_403_falls_back_to_alias_config_api(
    test_settings: Settings,
) -> None:
    """When alias_util/list returns 403, OPNsenseClient falls back to alias config API."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(200, json=[{"ip": "192.168.1.1"}])
    )
    respx.get("https://opnsense.example.local/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(403, json={"status": 403, "message": "Forbidden"}))
    respx.get(
        "https://opnsense.example.local/api/firewall/alias/get_alias_uuid/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"uuid": "7eb9bc75-bcba-42f9-8193-f5b14090488a"}))
    respx.get(
        "https://opnsense.example.local/api/firewall/alias/get_item/7eb9bc75-bcba-42f9-8193-f5b14090488a"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "alias": {
                    "enabled": "1",
                    "name": "gateway_blocked_devices",
                    "content": {
                        "": {"value": "", "selected": 0},
                        "192.168.1.155": {"value": "192.168.1.155", "selected": 1},
                        "Theater_Room_TV": {"value": "Theater_Room_TV", "selected": 0},
                    },
                }
            },
        )
    )

    client = OPNsenseClient(test_settings)
    health = await client.check_health()

    assert health.status == "healthy"
    assert health.details["blocked_ip_count"] == 1


@respx.mock
async def test_opnsense_client_timeout_returns_unhealthy(test_settings: Settings) -> None:
    """Network timeout during OPNsense probe returns unhealthy status cleanly."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        side_effect=httpx.ConnectTimeout("Timed out connecting to opnsense.example.local")
    )

    client = OPNsenseClient(test_settings)
    health = await client.check_health()

    assert health.status == "unhealthy"
    assert "ConnectTimeout" in health.message


@respx.mock
async def test_opnsense_raise_for_status_500(test_settings: Settings) -> None:
    """HTTP 500 from OPNsense raises OPNsenseClientError with status_code 500."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(500, text="Internal Server Error")
    )
    client = OPNsenseClient(test_settings)
    with pytest.raises(OPNsenseClientError) as exc_info:
        await client.get_arp_table()
    assert exc_info.value.status_code == 500


async def test_elasticsearch_client_healthy_probe(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ElasticsearchServiceClient.check_health returns healthy with cluster and shard stats."""
    mock_es = AsyncMock()
    mock_es.info.return_value = {
        "cluster_name": "gateway-es",
        "version": {"number": "9.4.3"},
    }
    mock_es.count.return_value = {"count": 14250}
    mock_es.cluster.health.return_value = {
        "status": "green",
        "active_shards": 1638,
        "unassigned_shards": 0,
        "relocating_shards": 2,
    }

    es_service = ElasticsearchServiceClient(test_settings)
    monkeypatch.setattr(es_service, "create_es_client", lambda: mock_es)

    health = await es_service.check_health()

    assert health.status == "healthy"
    assert health.details["version"] == "9.4.3"
    assert health.details["document_count"] == 14250
    assert health.details["cluster_status"] == "green"
    assert health.details["assigned_shards"] == 1638
    assert health.details["unassigned_shards"] == 0
    assert health.details["relocating_shards"] == 2
    mock_es.close.assert_awaited_once()


async def test_elasticsearch_client_auth_error(
    test_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ElasticsearchServiceClient.check_health handles 401 AuthenticationException cleanly."""
    mock_es = AsyncMock()
    meta = ApiResponseMeta(
        status=401,
        http_version="1.1",
        headers={},
        duration=0.05,
        node=None,  # type: ignore[arg-type]
    )
    mock_es.info.side_effect = AuthenticationException("Invalid API key", meta=meta, body=None)

    es_service = ElasticsearchServiceClient(test_settings)
    monkeypatch.setattr(es_service, "create_es_client", lambda: mock_es)

    health = await es_service.check_health()

    assert health.status == "unhealthy"
    assert health.details["status_code"] == 401
    mock_es.close.assert_awaited_once()


async def test_system_health_endpoint_requires_auth(async_client: AsyncClient) -> None:
    """GET /api/v1/system/health rejects unauthenticated requests with 401."""
    resp = await async_client.get("/api/v1/system/health")
    assert resp.status_code == 401


@respx.mock
async def test_system_health_endpoint_authenticated_aggregation(
    async_client: AsyncClient,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Authenticated GET /api/v1/system/health aggregates SQLite, OPNsense, and ES health."""
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
            latency_ms=4.2,
            message="ES 9.4.3 OK",
            details={"version": "9.4.3"},
        )

    monkeypatch.setattr(ElasticsearchServiceClient, "check_health", fake_es_health)

    await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )

    resp = await async_client.get("/api/v1/system/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["overall_status"] == "healthy"
    assert payload["services"]["sqlite"]["status"] == "healthy"
    assert payload["services"]["opnsense"]["status"] == "healthy"
    assert payload["services"]["elasticsearch"]["status"] == "healthy"
