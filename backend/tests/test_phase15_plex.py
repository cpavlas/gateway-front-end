"""Phase 15 unit and API tests for Direct Plex Media Server API Integration (`FB-P9-005`)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient

from app.clients.opnsense import ServiceHealthStatus
from app.clients.plex import (
    PlexQueryError,
    PlexServiceClient,
    clean_plex_client_ip,
    format_plex_media_title,
    normalize_plex_history_payload,
    normalize_plex_sessions_payload,
)
from app.config import Settings
from app.db import get_session_factory
from app.main import run_plex_session_poller
from app.models import Device
from app.services.analytics_service import (
    _apply_plex_override_to_es_data,
    get_analytics_cache,
)
from app.services.plex_service import (
    aggregate_plex_usage_for_window,
    clear_plex_live_cache,
    fetch_plex_telemetry_for_analytics,
    match_plex_player_to_sqlite_device,
    poll_and_record_plex_sessions,
    prepare_plex_session_log_rows,
    resolve_window_cutoff_datetime,
)


def test_plex_normalizer_and_matcher_helpers() -> None:
    """Verify pure synchronous Plex normalizers, IP cleaner, title formatter, and device matcher."""
    assert clean_plex_client_ip("::ffff:192.168.1.243") == "192.168.1.243"
    assert clean_plex_client_ip("192.168.1.66") == "192.168.1.66"
    assert clean_plex_client_ip(None) == ""

    assert (
        format_plex_media_title(
            {
                "type": "episode",
                "grandparentTitle": "Bluey",
                "parentIndex": 2,
                "index": 14,
                "title": "Sleepytime",
            }
        )
        == "Bluey · S02E14 · Sleepytime"
    )
    assert (
        format_plex_media_title(
            {"type": "movie", "title": "The Matrix", "year": 1999}
        )
        == "The Matrix (1999)"
    )
    assert (
        format_plex_media_title(
            {"type": "track", "grandparentTitle": "Daft Punk", "title": "One More Time"}
        )
        == "Daft Punk - One More Time"
    )

    raw_sessions: dict[str, Any] = {
        "MediaContainer": {
            "size": 2,
            "Metadata": [
                {
                    "sessionKey": "101",
                    "type": "episode",
                    "grandparentTitle": "Bluey",
                    "parentIndex": 1,
                    "index": 5,
                    "title": "Keepy Uppy",
                    "viewOffset": 300000,
                    "duration": 600000,
                    "Player": {
                        "address": "::ffff:192.168.1.243",
                        "title": "LG OLED65C1PUB",
                        "product": "Plex for LG",
                        "platform": "webOS",
                        "state": "playing",
                    },
                    "User": {"title": "KidsProfile"},
                    "Session": {"id": "sess-lg", "bandwidth": 12500},
                },
                {
                    "sessionKey": "102",
                    "type": "movie",
                    "title": "Dune",
                    "year": 2021,
                    "viewOffset": 1800000,
                    "duration": 9000000,
                    "Player": {
                        "address": "192.168.1.66",
                        "title": "Living Room Apple TV",
                        "product": "Plex for Apple TV",
                        "platform": "tvOS",
                        "state": "paused",
                    },
                    "User": {"title": "Family"},
                    "Session": {"id": "sess-atv", "bandwidth": 24000},
                    "TranscodeSession": {"videoDecision": "transcode"},
                },
            ],
        }
    }
    norm_sessions = normalize_plex_sessions_payload(raw_sessions)
    assert len(norm_sessions) == 2
    assert norm_sessions[0]["client_ip"] == "192.168.1.243"
    assert norm_sessions[0]["state"] == "playing"
    assert norm_sessions[0]["stream_decision"] == "direct play"
    assert norm_sessions[0]["progress_percent"] == 50.0
    assert norm_sessions[1]["stream_decision"] == "transcode"

    now_ts = int(datetime.now(UTC).timestamp()) - 600
    raw_history: dict[str, Any] = {
        "MediaContainer": {
            "Metadata": [
                {
                    "historyKey": "/status/sessions/history/1",
                    "viewedAt": now_ts,
                    "deviceID": 7,
                    "type": "movie",
                    "title": "Moana",
                    "year": 2016,
                    "duration": 5400000,
                }
            ]
        }
    }
    raw_devices: dict[str, Any] = {
        "MediaContainer": {
            "Device": [
                {
                    "id": 7,
                    "name": "LGwebOSTV",
                    "platform": "webOS",
                    "clientIdentifier": "lg-tv-1",
                }
            ]
        }
    }
    norm_history = normalize_plex_history_payload(raw_history, raw_devices)
    assert len(norm_history) == 1
    assert norm_history[0]["player_title"] == "LGwebOSTV"
    assert norm_history[0]["duration_minutes"] == 90

    lg_tv = Device(
        id=42,
        mac_address="aa:bb:cc:dd:ee:f3",
        ipv4_address="192.168.1.243",
        hostname="LGwebOSTV",
        display_name="Living Room LG TV",
    )
    apple_tv = Device(
        id=43,
        mac_address="aa:bb:cc:dd:ee:66",
        ipv4_address="192.168.1.66",
        hostname="apple-tv",
        display_name="Living Room Apple TV",
    )
    # Match by IP
    assert (
        match_plex_player_to_sqlite_device(
            client_ip="192.168.1.243",
            player_title="Unknown",
            sqlite_devices=[lg_tv, apple_tv],
        )
        == lg_tv
    )
    # Match by hostname/title when IP is missing (history lookup)
    assert (
        match_plex_player_to_sqlite_device(
            client_ip=None,
            player_title="LGwebOSTV",
            player_platform="webOS",
            sqlite_devices=[lg_tv, apple_tv],
        )
        == lg_tv
    )

    log_rows = prepare_plex_session_log_rows(norm_sessions, poll_interval_seconds=30)
    assert len(log_rows) == 1
    assert log_rows[0].client_ip == "192.168.1.243"

    agg = aggregate_plex_usage_for_window(
        window="24h",
        session_logs=log_rows,
        active_sessions=norm_sessions,
        history_records=norm_history,
        sqlite_devices=[lg_tv, apple_tv],
    )
    assert agg["app_key"] == "plex"
    assert agg["active_minutes"] >= 90
    assert len(agg["top_devices"]) == 2
    assert agg["top_devices"][0]["effective_name"] == "Living Room LG TV"
    assert len(agg["active_sessions"]) == 2

    merged_es = _apply_plex_override_to_es_data(
        {"application_usage": [{"app_key": "youtube", "display_name": "YouTube"}]},
        agg,
    )
    assert len(merged_es["application_usage"]) == 2

    assert resolve_window_cutoff_datetime("1h") > resolve_window_cutoff_datetime("24h")
    assert resolve_window_cutoff_datetime("7d") > resolve_window_cutoff_datetime("30d")


@pytest.mark.asyncio
async def test_plex_service_client_and_settings_api(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify `PlexServiceClient`, poller, and `POST /api/v1/system/settings/test-plex`."""
    clear_plex_live_cache()
    get_analytics_cache().clear()

    # Unconfigured client health check
    unconf_client = PlexServiceClient(test_settings)
    assert unconf_client.is_configured is False
    unconf_health = await unconf_client.check_health()
    assert unconf_health.status == "unhealthy"
    assert await unconf_client.fetch_active_sessions() == []
    assert await unconf_client.fetch_playback_history() == []

    # Configured client with mocked httpx
    plex_settings = test_settings.model_copy(
        update={
            "plex_base_url": "http://192.168.1.250:32400",
            "plex_api_token": "test-plex-token-123",
            "plex_verify_ssl": False,
        }
    )
    assert plex_settings.has_plex_configured is True
    conf_client = PlexServiceClient(plex_settings)
    assert conf_client.is_configured is True

    mock_http = AsyncMock()
    root_resp = MagicMock(status_code=200)
    root_resp.json.return_value = {
        "MediaContainer": {
            "friendlyName": "HomePlex",
            "version": "1.41.2",
            "machineIdentifier": "abc-123",
        }
    }
    sess_resp = MagicMock(status_code=200)
    sess_resp.json.return_value = {
        "MediaContainer": {
            "Metadata": [
                {
                    "sessionKey": "55",
                    "type": "movie",
                    "title": "Cars",
                    "Player": {
                        "address": "192.168.1.243",
                        "title": "LGwebOSTV",
                        "state": "playing",
                    },
                    "Session": {"bandwidth": 8000},
                }
            ]
        }
    }
    hist_resp = MagicMock(status_code=200)
    hist_resp.json.return_value = {
        "MediaContainer": {
            "Metadata": [
                {
                    "historyKey": "h1",
                    "viewedAt": int((datetime.now(UTC) - timedelta(hours=2)).timestamp()),
                    "deviceID": 1,
                    "type": "movie",
                    "title": "Cars",
                    "duration": 3600000,
                }
            ]
        }
    }
    dev_resp = MagicMock(status_code=200)
    dev_resp.json.return_value = {
        "MediaContainer": {"Device": [{"id": 1, "name": "LGwebOSTV", "platform": "webOS"}]}
    }

    async def _mock_get(path: str, **_kwargs: Any) -> Any:
        if path == "/":
            return root_resp
        if path == "/status/sessions":
            return sess_resp
        if path == "/status/sessions/history/all":
            return hist_resp
        return dev_resp

    mock_http.get.side_effect = _mock_get

    with patch.object(conf_client, "create_http_client", return_value=mock_http):
        health = await conf_client.check_health()
        assert health.status == "healthy"
        assert "HomePlex" in health.message
        assert health.details["active_sessions"] == 1

        sessions = await conf_client.fetch_active_sessions()
        assert len(sessions) == 1
        history = await conf_client.fetch_playback_history()
        assert len(history) == 1

        sf = get_session_factory(test_settings)
        async with sf() as db:
            dev = Device(
                mac_address="aa:bb:cc:dd:ee:99",
                ipv4_address="192.168.1.243",
                hostname="LGwebOSTV",
                display_name="LG OLED TV",
            )
            db.add(dev)
            await db.commit()

            recorded = await poll_and_record_plex_sessions(
                db, plex_settings, plex_client=conf_client
            )
            assert recorded == 1

            clear_plex_live_cache()
            plex_telemetry = await fetch_plex_telemetry_for_analytics(
                db,
                plex_settings,
                window="24h",
                sqlite_devices=[dev],
                plex_client=conf_client,
                refresh=True,
            )
            assert plex_telemetry is not None
            assert plex_telemetry["active_minutes"] >= 60
            assert plex_telemetry["top_devices"][0]["effective_name"] == "LG OLED TV"
            assert len(plex_telemetry["active_sessions"]) == 1

    # Also test 401 auth rejection on check_health and fetch_active_sessions
    unauth_resp = MagicMock(status_code=401)
    mock_http_401 = AsyncMock()
    mock_http_401.get.return_value = unauth_resp
    with patch.object(conf_client, "create_http_client", return_value=mock_http_401):
        h401 = await conf_client.check_health()
        assert h401.status == "unhealthy"
        with pytest.raises(PlexQueryError):
            await conf_client.fetch_active_sessions()

    # Test API endpoint POST /api/v1/system/settings/test-plex & PUT /api/v1/system/settings
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200

    with patch(
        "app.services.runtime_settings_service.PlexServiceClient.check_health",
        new=AsyncMock(
            return_value=ServiceHealthStatus(
                service="plex",
                status="healthy",
                latency_ms=14.2,
                message="Plex Media Server 'HomePlex' (1.41.2) connected (1 active stream(s)).",
                details={"url": "http://192.168.1.250:32400", "active_sessions": 1},
            )
        ),
    ):
        diag_resp = await async_client.post(
            "/api/v1/system/settings/test-plex",
            json={
                "plex_base_url": "http://192.168.1.250:32400",
                "plex_api_token": "my-plex-secret-token",
                "plex_verify_ssl": False,
            },
        )
        assert diag_resp.status_code == 200
        assert diag_resp.json()["service"] == "plex"
        assert diag_resp.json()["reachable"] is True

    put_resp = await async_client.put(
        "/api/v1/system/settings",
        json={
            "plex_base_url": "http://192.168.1.250:32400",
            "plex_api_token": "my-plex-secret-token",
            "plex_verify_ssl": False,
        },
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["plex_base_url"] == "http://192.168.1.250:32400"
    assert put_resp.json()["has_plex_api_token"] is True

    with (
        patch("app.main.get_settings", return_value=test_settings),
        patch(
            "app.main.poll_and_record_plex_sessions",
            new=AsyncMock(return_value=1),
        ),
    ):
        polled = await run_plex_session_poller()
        assert polled == 1
