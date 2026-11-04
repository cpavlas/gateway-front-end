"""Unit and integration tests for Phase 9 (`v1.0.3`):
- FB-P8-008 (BUG-P8-003): Plex local LAN client streaming detection
- FB-P9-001: NGINX-style First-Boot `admin` password setup
- FB-P9-002: Runtime integration settings & live connectivity diagnostics
- FB-P9-003: Multi-user RBAC & built-in `admin` protection
- FB-P9-004: Per-user action attribution & `audit_label` badges
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient

from app.auth import SetupAdminRequest
from app.clients.elasticsearch import (
    _build_app_usage_agg,
    _extract_app_usage,
)
from app.clients.opnsense import ServiceHealthStatus
from app.config import Settings, get_settings
from app.db import dispose_db, init_db
from app.main import create_app
from app.models import infer_audit_label, utc_now
from app.services.runtime_settings_service import (
    IntegrationSettingsUpdatePayload,
    build_temporary_settings_for_test,
    build_troubleshooting_hint,
    decrypt_secret_value,
    encrypt_secret_value,
    evaluate_connectivity_diagnostic_result,
    parse_setting_rows_to_overrides,
    prepare_persisted_settings_rows,
    sync_runtime_cache_and_build_view,
    validate_and_normalize_protected_ips,
    validate_and_normalize_url,
)
from app.services.user_service import (
    UserCreatePayload,
    UserUpdatePayload,
    apply_user_updates,
    build_sorted_user_list_response,
    enforce_protected_admin_mutation,
    evaluate_user_authentication,
    normalize_theme_preference,
    normalize_user_role,
    normalize_username,
    prepare_created_user,
    prepare_deleted_user_audit,
    prepare_initial_setup_admin,
    prepare_seeded_admin_user,
    validate_initial_admin_passwords,
)


def test_plex_lan_client_detection_and_server_poller_exclusion() -> None:
    """FB-P8-008: Plex captures LAN Smart TV (.243) and excludes Plex servers/pollers."""
    agg_def = _build_app_usage_agg("America/Los_Angeles", excluded_ips=["192.168.1.1"])
    plex_should = agg_def["filters"]["filters"]["plex"]["bool"]["should"]
    assert any(" terms" in str(item) or "plex.direct" in str(item) for item in plex_should)

    mock_aggs = {
        "app_usage": {
            "buckets": {
                "youtube": {
                    "doc_count": 120,
                    "dns_queries": {"doc_count": 100},
                    "bytes": {"value": 50000},
                    "last_active": {"value_as_string": "2026-11-03T20:00:00Z"},
                    "by_device": {
                        "devices": {
                            "buckets": [
                                {
                                    "key": "192.168.1.242",
                                    "doc_count": 120,
                                    "dns_queries": {"doc_count": 100},
                                    "bytes": {"value": 50000},
                                    "port_32400": {"doc_count": 0},
                                    "server_registrations": {"doc_count": 0},
                                    "playback_signals": {"doc_count": 0},
                                    "active_slots": {
                                        "buckets": [
                                            {"key_as_string": "t1", "doc_count": 8},
                                            {"key_as_string": "t2", "doc_count": 2},
                                        ]
                                    },
                                }
                            ]
                        }
                    },
                },
                "plex": {
                    "doc_count": 21000,
                    "dns_queries": {"doc_count": 21000},
                    "bytes": {"value": 0},
                    "last_active": {"value_as_string": "2026-11-03T20:05:00Z"},
                    "by_device": {
                        "devices": {
                            "buckets": [
                                # 1. Plex Media Server (.2): server_registrations > 0 -> excluded
                                {
                                    "key": "192.168.1.2",
                                    "doc_count": 2500,
                                    "dns_queries": {"doc_count": 2500},
                                    "bytes": {"value": 0},
                                    "port_32400": {"doc_count": 0},
                                    "server_registrations": {"doc_count": 640},
                                    "playback_signals": {"doc_count": 400},
                                    "active_slots": {
                                        "buckets": [
                                            {"key_as_string": f"srv-{i}", "doc_count": 15}
                                            for i in range(150)
                                        ]
                                    },
                                },
                                # 2. 24/7 Poller (.3): >= 140 slots, low playback -> excluded
                                {
                                    "key": "192.168.1.3",
                                    "doc_count": 17300,
                                    "dns_queries": {"doc_count": 17300},
                                    "bytes": {"value": 0},
                                    "port_32400": {"doc_count": 0},
                                    "server_registrations": {"doc_count": 0},
                                    "playback_signals": {"doc_count": 12},
                                    "active_slots": {
                                        "buckets": [
                                            {"key_as_string": f"poll-{i}", "doc_count": 60}
                                            for i in range(288)
                                        ]
                                    },
                                },
                                # 3. LGwebOSTV (.243): LAN client with plex.direct -> included!
                                {
                                    "key": "192.168.1.243",
                                    "doc_count": 420,
                                    "dns_queries": {"doc_count": 420},
                                    "bytes": {"value": 0},
                                    "port_32400": {"doc_count": 0},
                                    "server_registrations": {"doc_count": 0},
                                    "playback_signals": {"doc_count": 150},
                                    "active_slots": {
                                        "buckets": [
                                            {"key_as_string": f"tv-{i}", "doc_count": 2}
                                            for i in range(24)
                                        ]
                                    },
                                },
                            ]
                        }
                    },
                },
            }
        }
    }

    extracted = _extract_app_usage(mock_aggs)
    yt = next(item for item in extracted if item["app_key"] == "youtube")
    plex = next(item for item in extracted if item["app_key"] == "plex")

    assert yt["active_minutes"] == 5
    assert len(yt["top_devices"]) == 1

    # Plex includes ONLY .243 (24 slots * 5m = 120m) and excludes .2 server and .3 poller!
    assert plex["active_minutes"] == 120
    assert len(plex["top_devices"]) == 1
    assert plex["top_devices"][0]["ipv4_address"] == "192.168.1.243"
    assert plex["top_devices"][0]["active_minutes"] == 120


def test_secret_encryption_and_pure_validators() -> None:
    """Verify AEAD secret encryption/decryption and pure helper validators."""
    secret_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    encrypted = encrypt_secret_value("my-super-secret-api-key", secret_key)
    assert encrypted.startswith("ENC:v1:")
    assert "my-super-secret-api-key" not in encrypted
    assert decrypt_secret_value(encrypted, secret_key) == "my-super-secret-api-key"

    with pytest.raises(ValueError, match="HMAC"):
        decrypt_secret_value(encrypted[:-4] + "AAAA", secret_key)

    assert normalize_username("  Admin ") == "admin"
    assert normalize_username("operator_1") == "operator_1"
    with pytest.raises(ValueError):
        normalize_username("ab")

    assert normalize_user_role("ADMIN") == "admin"
    assert normalize_user_role("operator") == "operator"
    with pytest.raises(ValueError):
        normalize_user_role("superadmin")

    assert normalize_theme_preference("crimson") == "crimson"
    with pytest.raises(ValueError):
        normalize_theme_preference("neon-green")

    assert validate_initial_admin_passwords("StrongPass!123", "StrongPass!123") == "StrongPass!123"
    with pytest.raises(ValueError, match="do not match"):
        validate_initial_admin_passwords("StrongPass!123", "Mismatch!123")

    with pytest.raises(PermissionError, match="cannot be deleted"):
        enforce_protected_admin_mutation("admin", action="delete")
    with pytest.raises(PermissionError, match="cannot be disabled"):
        enforce_protected_admin_mutation("admin", action="update", new_is_active=False)
    with pytest.raises(PermissionError, match="retain the 'admin' role"):
        enforce_protected_admin_mutation("admin", action="update", new_role="operator")

    assert validate_and_normalize_url("https://fw.example.local/", "url") == "https://fw.example.local"
    assert "192.168.1.1" in validate_and_normalize_protected_ips("192.168.1.50")

    diag, hint = build_troubleshooting_hint(
        "opnsense", "HTTP 403 Forbidden", {"status_code": 403, "url": "https://fw.local"}
    )
    assert "403" in diag
    assert "svc_gateway_ui" in hint

    assert infer_audit_label("auth.login") == "AUTH_EVENT"
    assert infer_audit_label("user.create") == "USER_MGMT"
    assert infer_audit_label("settings.update") == "SETTINGS_CHANGE"
    assert infer_audit_label("diagnostic.opnsense") == "DIAGNOSTIC_ERROR"
    assert infer_audit_label("device.youtube.block") == "YOUTUBE_CONTROL"
    assert infer_audit_label("device.block") == "DEVICE_CONTROL"
    assert infer_audit_label("group.block") == "GROUP_CONTROL"
    assert infer_audit_label("timer.start") == "TIMER_OVERRIDE"
    assert infer_audit_label("schedule.create") == "SCHEDULE_CHANGE"
    assert infer_audit_label("system.restore") == "CONFIG_BACKUP"
    assert infer_audit_label("unknown.event") == "SYSTEM"

    # Exercise synchronous user & settings service helpers directly
    dummy_settings = Settings(
        _env_file=None,
        app_env="testing",
        app_secret_key=secret_key,
        admin_username="admin",
        admin_password="ValidAdminPassword!123",
    )
    seeded_user = prepare_seeded_admin_user(dummy_settings)
    assert seeded_user is not None
    assert seeded_user.username == "admin"

    unseeded = prepare_seeded_admin_user(
        dummy_settings.model_copy(
            update={"admin_password": "REPLACE_WITH_STRONG_ADMIN_PASSWORD"}
        )
    )
    assert unseeded is None

    init_user, init_audit = prepare_initial_setup_admin(
        SetupAdminRequest(
            password="InitialAdminPassword!1",
            confirm_password="InitialAdminPassword!1",
        ),
        "192.168.1.20",
    )
    assert init_user.username == "admin"
    assert init_audit.audit_label == "AUTH_EVENT"

    init_user.id = 1
    init_user.created_at = utc_now()
    init_user.updated_at = utc_now()
    assert (
        evaluate_user_authentication(
            init_user, "admin", "InitialAdminPassword!1", dummy_settings
        )
        is init_user
    )
    assert (
        evaluate_user_authentication(init_user, "admin", "WrongPassword", dummy_settings)
        is None
    )

    new_op, create_audit = prepare_created_user(
        UserCreatePayload(
            username="bob_op",
            password="BobOperatorPassword!1",
            role="operator",
        ),
        None,
        actor="admin",
    )
    new_op.id = 2
    new_op.created_at = utc_now()
    new_op.updated_at = utc_now()
    assert create_audit.audit_label == "USER_MGMT"

    sorted_list = build_sorted_user_list_response([new_op, init_user])
    assert [u.username for u in sorted_list.users] == ["admin", "bob_op"]

    updated_op, update_audit = apply_user_updates(
        new_op,
        2,
        UserUpdatePayload(
            password="NewBobPassword!2",
            role="admin",
            is_active=False,
            theme_preference="crimson",
        ),
        actor="admin",
    )
    assert updated_op.role == "admin"
    assert updated_op.is_active is False
    assert update_audit.audit_label == "USER_MGMT"

    with pytest.raises( PermissionError):
        evaluate_user_authentication(
            updated_op, "bob_op", "NewBobPassword!2", dummy_settings
        )

    del_target, del_audit, del_summary = prepare_deleted_user_audit(
        updated_op, 2, actor="admin"
    )
    assert del_target is updated_op
    assert del_audit.action == "user.delete"
    assert del_summary["username"] == "bob_op"

    # Synchronous runtime settings helpers
    new_rows, settings_audit = prepare_persisted_settings_rows(
        [],
        dummy_settings,
        IntegrationSettingsUpdatePayload(
            opnsense_base_url="https://fw2.example.local",
            opnsense_api_key="key123",
            opnsense_api_secret="sec123",
            opnsense_verify_ssl=False,
            opnsense_timeout_seconds=12.0,
            opnsense_protected_ips="192.168.1.1,192.168.1.99",
            elasticsearch_url="https://es2.example.local:9200",
            elasticsearch_api_key="eskey123",
            elasticsearch_verify_ssl=False,
            elasticsearch_timeout_seconds=15.0,
            elasticsearch_index_patterns="logs-pfsense.log*",
        ),
        actor="admin",
    )
    for row in new_rows:
        row.updated_at = utc_now()
    assert settings_audit.audit_label == "SETTINGS_CHANGE"

    parsed_overrides = parse_setting_rows_to_overrides(new_rows, secret_key)
    assert parsed_overrides["opnsense_base_url"] == "https://fw2.example.local"
    view = sync_runtime_cache_and_build_view(dummy_settings, new_rows)
    assert view.source == "ui_override"
    temp_cfg = build_temporary_settings_for_test(
        dummy_settings,
        IntegrationSettingsUpdatePayload(opnsense_base_url="https://fw3.example.local"),
    )
    assert temp_cfg.opnsense_base_url == "https://fw3.example.local"

    unhealthy_resp, unhealthy_audit = evaluate_connectivity_diagnostic_result(
        "opnsense",
        "https://fw3.example.local",
        ServiceHealthStatus(
            service="opnsense",
            status="unhealthy",
            latency_ms=45.0,
            message="SSL certificate verify failed",
            details={"url": "https://fw3.example.local"},
        ),
        actor="admin",
    )
    assert unhealthy_resp.reachable is False
    assert unhealthy_audit.audit_label == "DIAGNOSTIC_ERROR"

    healthy_resp, healthy_audit = evaluate_connectivity_diagnostic_result(
        "elasticsearch",
        "https://es2.example.local:9200",
        ServiceHealthStatus(
            service="elasticsearch",
            status="healthy",
            latency_ms=8.0,
            message="Connected",
            details={"cluster_status": "green"},
        ),
        actor="admin",
    )
    assert healthy_resp.reachable is True
    assert healthy_audit.audit_label == "SETTINGS_CHANGE"
    sync_runtime_cache_and_build_view(dummy_settings, [])


async def test_first_boot_admin_setup_flow(tmp_path: Path) -> None:
    """FB-P9-001: Clean build without ADMIN_PASSWORD requires setup-admin on first login."""
    await dispose_db()
    clean_db = tmp_path / "clean_first_boot.db"
    clean_settings = Settings(
        _env_file=None,
        app_env="testing",
        app_secret_key="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        admin_username="admin",
        admin_password="REPLACE_WITH_STRONG_ADMIN_PASSWORD",
        database_url=f"sqlite+aiosqlite:///{clean_db.as_posix()}",
    )
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: clean_settings
    await init_db(clean_settings)

    transport = ASGITransport(app=app, client=("192.168.1.25", 54321))
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        status_resp = await client.get("/api/v1/auth/setup-status")
        assert status_resp.status_code == 200
        assert status_resp.json()["needs_initial_setup"] is True
        assert status_resp.json()["admin_username"] == "admin"

        # Mismatched confirm_password returns 400
        bad_setup = await client.post(
            "/api/v1/auth/setup-admin",
            json={"password": "NewAdminPassword!2026", "confirm_password": "Different!"},
        )
        assert bad_setup.status_code == 400

        # Valid initial setup creates admin and issues session cookie
        ok_setup = await client.post(
            "/api/v1/auth/setup-admin",
            json={
                "password": "NewAdminPassword!2026",
                "confirm_password": "NewAdminPassword!2026",
            },
        )
        assert ok_setup.status_code == 200
        assert ok_setup.json()["username"] == "admin"
        assert ok_setup.json()["role"] == "admin"

        # Subsequent setup-status reports needs_initial_setup == False
        status_after = await client.get("/api/v1/auth/setup-status")
        assert status_after.json()["needs_initial_setup"] is False

        # Repeating setup-admin is rejected with 400
        dup_setup = await client.post(
            "/api/v1/auth/setup-admin",
            json={"password": "AnotherPassword!2026"},
        )
        assert dup_setup.status_code == 400

    app.dependency_overrides.clear()
    await dispose_db()


async def test_multi_user_management_rbac_and_protected_admin(
    async_client: AsyncClient, test_settings: Settings
) -> None:
    """FB-P9-003 & FB-P9-004: Multi-user CRUD, Operator RBAC, and default admin protection."""
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login_resp.status_code == 200

    # List users — seeded 'admin' is present and marked is_protected_admin
    users_resp = await async_client.get("/api/v1/users")
    assert users_resp.status_code == 200
    users = users_resp.json()["users"]
    assert len(users) == 1
    admin_user = users[0]
    assert admin_user["username"] == "admin"
    assert admin_user["is_protected_admin"] is True

    # Attempting to delete, disable, or demote 'admin' returns 403 Forbidden
    del_admin = await async_client.delete(f"/api/v1/users/{admin_user['id']}")
    assert del_admin.status_code == 403

    disable_admin = await async_client.patch(
        f"/api/v1/users/{admin_user['id']}", json={"is_active": False}
    )
    assert disable_admin.status_code == 403

    demote_admin = await async_client.patch(
        f"/api/v1/users/{admin_user['id']}", json={"role": "operator"}
    )
    assert demote_admin.status_code == 403

    # Create a Standard User ('operator')
    create_op = await async_client.post(
        "/api/v1/users",
        json={
            "username": "alice_op",
            "password": "AliceOperatorPass!123",
            "role": "operator",
        },
    )
    assert create_op.status_code == 201
    alice = create_op.json()
    assert alice["username"] == "alice_op"
    assert alice["role"] == "operator"
    assert alice["is_protected_admin"] is False

    # Log in as alice_op
    op_login = await async_client.post(
        "/api/v1/auth/login",
        json={"username": "alice_op", "password": "AliceOperatorPass!123"},
    )
    assert op_login.status_code == 200
    assert op_login.json()["username"] == "alice_op"
    assert op_login.json()["role"] == "operator"

    # Operator cannot access /api/v1/users or /api/v1/system/settings (403 Forbidden)
    op_users = await async_client.get("/api/v1/users")
    assert op_users.status_code == 403
    op_settings = await async_client.get("/api/v1/system/settings")
    assert op_settings.status_code == 403

    # Switch back to admin to disable and then delete alice_op
    await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    patch_alice = await async_client.patch(
        f"/api/v1/users/{alice['id']}",
        json={"is_active": False, "theme_preference": "ocean"},
    )
    assert patch_alice.status_code == 200
    assert patch_alice.json()["is_active"] is False
    assert patch_alice.json()["theme_preference"] == "ocean"

    # Disabled user login returns 403 Forbidden
    disabled_login = await async_client.post(
        "/api/v1/auth/login",
        json={"username": "alice_op", "password": "AliceOperatorPass!123"},
    )
    assert disabled_login.status_code == 403

    # Re-authenticate as admin and delete alice_op
    await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    del_alice = await async_client.delete(f"/api/v1/users/{alice['id']}")
    assert del_alice.status_code == 200
    assert del_alice.json()["username"] == "alice_op"

    # Verify USER_MGMT audit logs were recorded with audit_label
    audit_resp = await async_client.get("/api/v1/audit-logs?audit_label=USER_MGMT")
    assert audit_resp.status_code == 200
    audit_items = audit_resp.json()["items"]
    assert len(audit_items) >= 3
    assert all(item["audit_label"] == "USER_MGMT" for item in audit_items)


@respx.mock
async def test_runtime_integration_settings_and_connectivity_diagnostics(
    async_client: AsyncClient, test_settings: Settings
) -> None:
    """FB-P9-002: UI settings override .env, test connectivity, and log diagnostic errors."""
    await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )

    # 1. Initial GET /api/v1/system/settings reflects .env source
    get_init = await async_client.get("/api/v1/system/settings")
    assert get_init.status_code == 200
    init_data = get_init.json()
    assert init_data["source"] == "env"
    assert init_data["opnsense_base_url"] == "https://opnsense.example.local"
    assert init_data["has_opnsense_api_key"] is True

    # 2. Save UI overrides via PUT /api/v1/system/settings
    put_resp = await async_client.put(
        "/api/v1/system/settings",
        json={
            "opnsense_base_url": "https://opnsense-ui.example.local",
            "opnsense_api_key": "new_ui_opn_key",
            "opnsense_verify_ssl": False,
            "elasticsearch_url": "https://es-ui.example.local:9200",
            "elasticsearch_index_patterns": "logs-pfsense.log*,logs-custom*",
        },
    )
    assert put_resp.status_code == 200
    updated = put_resp.json()
    assert updated["source"] == "ui_override"
    assert updated["opnsense_base_url"] == "https://opnsense-ui.example.local"
    assert updated["opnsense_verify_ssl"] is False
    assert updated["elasticsearch_url"] == "https://es-ui.example.local:9200"
    assert updated["updated_by"] == "admin"

    # 3. Test OPNsense connectivity failure -> returns error_diagnostic + logs DIAGNOSTIC_ERROR
    respx.get("https://opnsense-ui.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(403, json={"message": "Forbidden"})
    )
    test_opn_fail = await async_client.post(
        "/api/v1/system/settings/test-opnsense",
        json={},
    )
    assert test_opn_fail.status_code == 200
    fail_body = test_opn_fail.json()
    assert fail_body["reachable"] is False
    assert fail_body["status"] == "unhealthy"
    assert "403" in fail_body["error_diagnostic"]
    assert "svc_gateway_ui" in fail_body["troubleshooting_hint"]

    # Verify DIAGNOSTIC_ERROR was logged in audit_logs
    diag_logs = await async_client.get("/api/v1/audit-logs?audit_label=DIAGNOSTIC_ERROR")
    assert diag_logs.status_code == 200
    assert diag_logs.json()["total_count"] >= 1
    assert diag_logs.json()["items"][0]["audit_label"] == "DIAGNOSTIC_ERROR"

    # 4. Test Elasticsearch connectivity success
    with patch(
        "app.clients.elasticsearch.ElasticsearchServiceClient.check_health",
        new=AsyncMock(
            return_value=ServiceHealthStatus(
                service="elasticsearch",
                status="healthy",
                latency_ms=11.4,
                message="Elasticsearch 9.4.3 connected.",
                details={"cluster_status": "green", "assigned_shards": 12},
            )
        ),
    ):
        test_es_ok = await async_client.post(
            "/api/v1/system/settings/test-elasticsearch",
            json={},
        )
        assert test_es_ok.status_code == 200
        assert test_es_ok.json()["reachable"] is True
        assert test_es_ok.json()["status"] == "healthy"

    # 5. Reset to .env defaults via DELETE /api/v1/system/settings
    del_resp = await async_client.delete("/api/v1/system/settings")
    assert del_resp.status_code == 200
    assert del_resp.json()["source"] == "env"
    assert del_resp.json()["opnsense_base_url"] == "https://opnsense.example.local"
