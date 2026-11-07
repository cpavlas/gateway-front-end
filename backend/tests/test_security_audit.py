"""Phase 14 automated security audit, PERFORMANCE_ANALYSIS, and WAN port sessions tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.routing import APIRoute
from httpx import AsyncClient

from app.api.system import get_elasticsearch_client
from app.auth import (
    SESSION_COOKIE_NAME,
    create_session_token,
    require_admin_role,
    require_admin_session,
)
from app.clients.elasticsearch import (
    ElasticsearchQueryError,
    ElasticsearchServiceClient,
    build_open_wan_port_sessions_query,
    format_connection_duration,
    format_geo_location_label,
    normalize_open_wan_port_sessions_response,
)
from app.config import Settings
from app.db import get_session_factory
from app.main import create_app, run_telemetry_cache_prewarm
from app.models import Device, infer_audit_label
from app.services.analytics_service import get_analytics_cache
from app.services.audit_and_backup_service import (
    _should_record_performance_analysis,
    clear_performance_analysis_dedup_cache,
    clear_upstream_error_dedup_cache,
    format_performance_analysis_details,
    record_performance_analysis_audit_log,
)
from app.services.firewall_service import build_open_wan_port_sessions_response

PUBLIC_API_ROUTES: set[tuple[str, str]] = {
    ("GET", "/api/v1/system/ping"),
    ("GET", "/api/v1/auth/setup-status"),
    ("POST", "/api/v1/auth/setup-admin"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/logout"),
}


def _collect_dependant_callables(dependant: Any) -> set[Any]:
    """Recursively collect all dependency callables registered on a FastAPI route."""
    found: set[Any] = set()
    if dependant is None:
        return found
    call = getattr(dependant, "call", None)
    if call is not None:
        found.add(call)
    for sub in getattr(dependant, "dependencies", []) or []:
        found.update(_collect_dependant_callables(sub))
    return found


def _collect_api_routes(routes: Any) -> list[APIRoute]:
    """Recursively collect all `APIRoute` instances from FastAPI routes and `_IncludedRouter`s."""
    collected: list[APIRoute] = []
    for r in routes or []:
        if isinstance(r, APIRoute):
            if r.path.startswith("/api/v1/"):
                collected.append(r)
        elif hasattr(r, "original_router"):
            collected.extend(_collect_api_routes(getattr(r.original_router, "routes", [])))
        elif hasattr(r, "routes"):
            collected.extend(_collect_api_routes(getattr(r, "routes", [])))
    return collected


@pytest.mark.asyncio
async def test_all_api_routes_enforce_authentication_and_rbac(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify 100% of non-public `/api/v1/*` routes enforce authentication (`401`)
    and all strict-admin routes reject `operator` tokens (`403`) (`FB-P11-004`).
    """
    target_app = getattr(async_client._transport, "app", None) or create_app()
    api_routes = _collect_api_routes(target_app.routes)
    assert len(api_routes) >= 25

    operator_token, _ = create_session_token(
        username="operator_user",
        settings=test_settings,
        role="operator",
    )

    checked_protected_count = 0
    checked_strict_admin_count = 0

    for route in api_routes:
        deps = _collect_dependant_callables(route.dependant)
        sample_path = (
            route.path.replace("{device_id}", "1")
            .replace("{group_id}", "1")
            .replace("{schedule_id}", "1")
            .replace("{user_id}", "2")
        )
        for method in sorted(route.methods or []):
            if method in ("HEAD", "OPTIONS"):
                continue
            key = (method, route.path)
            if key in PUBLIC_API_ROUTES:
                continue

            # 1. Every non-public route MUST depend on require_admin_session or require_admin_role
            assert (
                require_admin_session in deps or require_admin_role in deps
            ), f"Route {method} {route.path} is missing authentication dependency!"

            # 2. Calling without authentication cookie must return 401 Unauthorized
            unauth_resp = await async_client.request(method, sample_path)
            assert unauth_resp.status_code == 401, (
                f"Unauthenticated {method} {sample_path} got {unauth_resp.status_code}"
            )
            checked_protected_count += 1

            # 3. If route requires admin role, operator token must return 403 Forbidden
            if require_admin_role in deps:
                op_resp = await async_client.request(
                    method,
                    sample_path,
                    headers={"Cookie": f"{SESSION_COOKIE_NAME}={operator_token}"},
                )
                assert op_resp.status_code == 403, (
                    f"Operator escalation on {method} {sample_path}: {op_resp.status_code}"
                )
                checked_strict_admin_count += 1

    assert checked_protected_count >= 25
    assert checked_strict_admin_count >= 6


def test_open_wan_port_sessions_query_and_normalizer_helpers() -> None:
    """Verify `format_connection_duration`, `format_geo_location_label`,
    `build_open_wan_port_sessions_query`, and `normalize_open_wan_port_sessions_response`.
    """
    assert format_connection_duration(0) == "< 1s (Single Packet)"
    assert format_connection_duration(45) == "45s"
    assert format_connection_duration(3725) == "1h 2m 5s"
    assert format_connection_duration(90060) == "1d 1h 1m"

    assert (
        format_geo_location_label(
            city_name="Montrose",
            region_name="Colorado",
            country_name="United States",
            country_iso_code="US",
        )
        == "Montrose, Colorado, United States"
    )
    assert format_geo_location_label() == "Unknown Location"

    aggs_body, recent_body = build_open_wan_port_sessions_query(
        destination_ip="192.168.1.50",
        destination_port=32400,
        protocol="tcp",
        window="24h",
        search="8.8.8.8",
        recent_limit=50,
    )
    assert aggs_body["track_total_hits"] is False
    assert recent_body["track_total_hits"] is False
    assert recent_body["size"] == 50

    mock_aggs_resp = {
        "aggregations": {
            "total_packets": {"value": 120},
            "total_bytes": {"value": 65536},
            "unique_sources": {"value": 1},
            "first_seen": {"value_as_string": "2026-11-06T18:00:00Z"},
            "last_seen": {"value_as_string": "2026-11-06T19:05:00Z"},
            "top_countries": {"buckets": [{"key": "United States", "doc_count": 120}]},
            "external_ips": {
                "buckets": [
                    {
                        "key": "8.8.8.8",
                        "doc_count": 120,
                        "bytes": {"value": 65536},
                        "first_seen": {
                            "value": 1762452000000,
                            "value_as_string": "2026-11-06T18:00:00Z",
                        },
                        "last_seen": {
                            "value": 1762455900000,
                            "value_as_string": "2026-11-06T19:05:00Z",
                        },
                        "active_slots": {"buckets": [{"key": 1}, {"key": 2}, {"key": 3}]},
                        "source_ports": {"buckets": [{"key": 51234, "doc_count": 80}]},
                        "latest_sample": {
                            "hits": {
                                "hits": [
                                    {
                                        "_source": {
                                            "@timestamp": "2026-11-06T19:05:00Z",
                                            "source": {
                                                "ip": "8.8.8.8",
                                                "port": 51234,
                                                "as": {
                                                    "number": 395555,
                                                    "organization": {"name": "ELEVATE"},
                                                },
                                                "geo": {
                                                    "city_name": "Montrose",
                                                    "region_name": "Colorado",
                                                    "region_iso_code": "US-CO",
                                                    "country_name": "United States",
                                                    "country_iso_code": "US",
                                                    "continent_name": "North America",
                                                    "location": {"lat": 38.4687, "lon": -107.88},
                                                },
                                            },
                                            "network": {
                                                "transport": "tcp",
                                                "community_id": "1:abc=",
                                            },
                                            "observer": {
                                                "ingress": {"interface": {"name": "vtnet1"}}
                                            },
                                            "rule": {"id": "rule-32400"},
                                            "pfsense": {
                                                "ip": {"ttl": 52},
                                                "tcp": {"flags": "PA"},
                                            },
                                        }
                                    }
                                ]
                            }
                        },
                    }
                ]
            },
        }
    }
    mock_recent_resp = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        "@timestamp": "2026-11-06T19:05:00Z",
                        "source": {
                            "ip": "8.8.8.8",
                            "port": 51234,
                            "as": {"number": 395555, "organization": {"name": "ELEVATE"}},
                            "geo": {
                                "city_name": "Montrose",
                                "region_name": "Colorado",
                                "country_name": "United States",
                                "country_iso_code": "US",
                            },
                        },
                        "network": {"transport": "tcp", "bytes": 1024},
                        "observer": {"ingress": {"interface": {"name": "vtnet1"}}},
                        "rule": {"id": "rule-32400"},
                        "pfsense": {"ip": {"ttl": 52}, "tcp": {"flags": "S"}},
                    }
                }
            ]
        }
    }

    normalized = normalize_open_wan_port_sessions_response(
        mock_aggs_resp,
        mock_recent_resp,
        destination_ip="192.168.1.50",
        destination_port=32400,
        protocol="tcp",
        window="24h",
    )
    assert normalized["summary"]["total_passed_packets"] == 120
    assert normalized["summary"]["unique_external_ips"] == 1
    assert normalized["summary"]["top_country"] == "United States"
    assert len(normalized["external_ips"]) == 1
    ext_ip = normalized["external_ips"][0]
    assert ext_ip["source_ip"] == "8.8.8.8"
    assert ext_ip["asn"] == 395555
    assert ext_ip["organization"] == "ELEVATE"
    assert ext_ip["location_label"] == "Montrose, Colorado, United States"
    assert ext_ip["connection_duration_seconds"] == 3900
    assert ext_ip["connection_duration_label"] == "1h 5m"
    assert ext_ip["active_duration_minutes"] == 15
    assert ext_ip["tcp_flags"] == "PA"
    assert ext_ip["ttl"] == 52
    assert len(normalized["recent_events"]) == 1

    # Also test synchronous service response builder (reachable and unreachable)
    dev = Device(
        mac_address="aa:bb:cc:dd:ee:50",
        ipv4_address="192.168.1.50",
        display_name="Plex Media Server",
    )
    built_ok = build_open_wan_port_sessions_response(
        normalized,
        [dev],
        destination_ip="192.168.1.50",
        destination_port=32400,
        external_port=32401,
        protocol="tcp",
        window="24h",
        es_reachable=True,
    )
    assert built_ok.effective_name == "Plex Media Server"
    assert built_ok.port_mapping == "32401:32400"
    assert len(built_ok.external_ips) == 1

    built_err = build_open_wan_port_sessions_response(
        None,
        [dev],
        destination_ip="192.168.1.50",
        destination_port=32400,
        protocol="tcp",
        window="24h",
        es_reachable=False,
        warning="ES down",
    )
    assert built_err.es_reachable is False
    assert built_err.warning == "ES down"


@pytest.mark.asyncio
async def test_performance_analysis_audit_logging_and_wan_port_sessions_api(
    async_client: AsyncClient,
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify `PERFORMANCE_ANALYSIS` audit logs are recorded for telemetry windows
    and `GET /api/v1/firewall/open-ports/sessions` returns external IP details.
    """
    clear_performance_analysis_dedup_cache()
    clear_upstream_error_dedup_cache()
    get_analytics_cache().clear()

    assert infer_audit_label("performance.analytics_overview") == "PERFORMANCE_ANALYSIS"
    status_val, details_str = format_performance_analysis_details(
        window="30d",
        elapsed_ms=612.4,
        cache_hit=False,
        force_refresh=True,
        total_events=14278985,
    )
    assert status_val == "success"
    assert "612.4 ms" in details_str
    assert _should_record_performance_analysis("analytics_overview", "24h", cache_hit=True) is True
    assert _should_record_performance_analysis("analytics_overview", "24h", cache_hit=True) is False
    assert _should_record_performance_analysis("analytics_overview", "24h", cache_hit=False) is True

    # Test ElasticsearchServiceClient.fetch_open_wan_port_sessions with mocked msearch
    es_service = ElasticsearchServiceClient(test_settings)
    fake_es = AsyncMock()
    fake_es.msearch = AsyncMock(
        return_value={
            "responses": [
                {
                    "aggregations": {
                        "total_packets": {"value": 42},
                        "total_bytes": {"value": 20480},
                        "unique_sources": {"value": 1},
                        "external_ips": {
                            "buckets": [
                                {
                                    "key": "1.1.1.1",
                                    "doc_count": 42,
                                    "bytes": {"value": 20480},
                                    "first_seen": {
                                        "value": 1762452000000,
                                        "value_as_string": "2026-11-06T18:00:00Z",
                                    },
                                    "last_seen": {
                                        "value": 1762452600000,
                                        "value_as_string": "2026-11-06T18:10:00Z",
                                    },
                                    "active_slots": {"buckets": [{"key": 1}, {"key": 2}]},
                                    "source_ports": {"buckets": [{"key": 44112, "doc_count": 42}]},
                                    "latest_sample": {
                                        "hits": {
                                            "hits": [
                                                {
                                                    "_source": {
                                                        "source": {
                                                            "ip": "1.1.1.1",
                                                            "as": {
                                                                "number": 15169,
                                                                "organization": {"name": "GOOGLE"},
                                                            },
                                                            "geo": {
                                                                "city_name": "Mountain View",
                                                                "region_name": "California",
                                                                "country_name": "United States",
                                                                "country_iso_code": "US",
                                                            },
                                                        },
                                                        "pfsense": {
                                                            "ip": {"ttl": 56},
                                                            "tcp": {"flags": "S"},
                                                        },
                                                    }
                                                }
                                            ]
                                        }
                                    },
                                }
                            ]
                        },
                    }
                },
                {"hits": {"hits": []}},
            ]
        }
    )
    monkeypatch.setattr(es_service, "create_es_client", lambda: fake_es)
    direct_sessions = await es_service.fetch_open_wan_port_sessions(
        destination_ip="192.168.1.50",
        destination_port=32400,
        protocol="tcp",
        window="24h",
    )
    assert direct_sessions["summary"]["unique_external_ips"] == 1
    assert direct_sessions["external_ips"][0]["source_ip"] == "1.1.1.1"
    assert direct_sessions["external_ips"][0]["location_label"] == (
        "Mountain View, California, United States"
    )

    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "TestStrongPassword!2026"},
    )
    assert login_resp.status_code == 200

    target_app = getattr(async_client._transport, "app", None)
    mock_api_es = AsyncMock()
    mock_api_es.fetch_open_wan_port_sessions = AsyncMock(return_value=direct_sessions)
    if target_app is not None:
        target_app.dependency_overrides[get_elasticsearch_client] = lambda: mock_api_es
    try:
        clear_performance_analysis_dedup_cache()
        resp = await async_client.get(
            "/api/v1/firewall/open-ports/sessions?destination_ip=192.168.1.50&destination_port=32400&external_port=32401&protocol=tcp&window=24h"
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["es_reachable"] is True
        assert payload["port_mapping"] == "32401:32400"
        assert len(payload["external_ips"]) == 1
        assert payload["external_ips"][0]["organization"] == "GOOGLE"

        # Second call hits warm cache
        resp_cached = await async_client.get(
            "/api/v1/firewall/open-ports/sessions?destination_ip=192.168.1.50&destination_port=32400&external_port=32401&protocol=tcp&window=24h"
        )
        assert resp_cached.status_code == 200

        # Invalid IP returns 400
        bad_resp = await async_client.get(
            "/api/v1/firewall/open-ports/sessions?destination_ip=not-an-ip&destination_port=32400"
        )
        assert bad_resp.status_code == 400

        # Error fallback records DIAGNOSTIC_ERROR and returns es_reachable=False
        mock_api_es.fetch_open_wan_port_sessions = AsyncMock(
            side_effect=ElasticsearchQueryError("Simulated WAN session timeout", status_code=504)
        )
        err_resp = await async_client.get(
            "/api/v1/firewall/open-ports/sessions?destination_ip=192.168.1.50&destination_port=32400&refresh=true"
        )
        assert err_resp.status_code == 200
        assert err_resp.json()["es_reachable"] is False

        # Verify PERFORMANCE_ANALYSIS logs are returned by /api/v1/system/audit-logs
        audit_resp = await async_client.get(
            "/api/v1/system/audit-logs?audit_label=PERFORMANCE_ANALYSIS"
        )
        assert audit_resp.status_code == 200
        audit_items = audit_resp.json()["items"]
        assert len(audit_items) >= 1
        assert audit_items[0]["audit_label"] == "PERFORMANCE_ANALYSIS"
        assert "loaded in" in (audit_items[0]["details"] or "")
    finally:
        if target_app is not None:
            target_app.dependency_overrides.pop(get_elasticsearch_client, None)

    # Also verify extended window pre-warming (7d and 30d)
    session_factory = get_session_factory(test_settings)
    async with session_factory() as db_sess:
        wrote = await record_performance_analysis_audit_log(
            db_sess,
            view="analytics_overview",
            window="30d",
            elapsed_ms=420.5,
            cache_hit=False,
            force_refresh=True,
            total_events=14000000,
        )
        assert wrote is True

    prewarm_windows: list[str] = []

    async def _fake_overview(**kwargs: Any) -> Any:
        prewarm_windows.append(f"overview:{kwargs.get('window')}")

    async def _fake_fw(**kwargs: Any) -> Any:
        prewarm_windows.append(f"fw:{kwargs.get('window')}")

    monkeypatch.setattr("app.main.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.main.get_network_overview_analytics", _fake_overview)
    monkeypatch.setattr("app.main.get_firewall_overview_analytics", _fake_fw)
    get_analytics_cache().clear()
    await run_telemetry_cache_prewarm(force=True, include_extended_windows=True)
    assert "overview:24h" in prewarm_windows
    assert "overview:7d" in prewarm_windows
    assert "overview:30d" in prewarm_windows
    assert "fw:30d" in prewarm_windows
