"""Unit tests for Phase 7 Step 7.1: Selective YouTube Blocking & SQLite Storage/Record Telemetry."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
import respx
from httpx import AsyncClient

from app.api.system import (
    build_sqlite_health_details,
    compute_sqlite_file_bytes,
    format_storage_size,
)
from app.clients.opnsense import (
    YOUTUBE_BLOCK_DOMAINS,
    OPNsenseClient,
)
from app.config import Settings


def test_sqlite_storage_formatting_and_file_bytes(tmp_path: Path) -> None:
    """Verify SQLite storage size formatting, file byte summation, and health details."""
    assert format_storage_size(512) == "512 B"
    assert format_storage_size(4096) == "4.0 KB"
    assert format_storage_size(2 * 1024 * 1024) == "2.00 MB"

    db_file = tmp_path / "test_gateway.db"
    wal_file = tmp_path / "test_gateway.db-wal"
    db_file.write_bytes(b"x" * 8192)
    wal_file.write_bytes(b"y" * 2048)

    total_bytes = compute_sqlite_file_bytes(str(db_file), pragma_bytes=4096)
    assert total_bytes == 10240
    assert compute_sqlite_file_bytes(":memory:", pragma_bytes=16384) == 16384

    details = build_sqlite_health_details(
        sqlite_db_path=str(db_file),
        pragma_bytes=4096,
        counts={
            "devices_count": 12,
            "groups_count": 3,
            "timers_count": 1,
            "schedules_count": 2,
            "audit_logs_count": 20,
        },
    )
    assert details["storage_bytes"] == 10240
    assert details["storage_size_formatted"] == "10.0 KB"
    assert details["total_records"] == 38
    assert details["devices_count"] == 12
    assert details["groups_count"] == 3


@pytest.mark.asyncio
async def test_opnsense_youtube_alias_auto_provisioning(
    test_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify `OPNsenseClient` auto-provisions YouTube aliases on 404."""
    call_log: list[tuple[str, str]] = []
    alias_created = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal alias_created
        path = request.url.path
        call_log.append((request.method, path))
        if path.endswith("/alias_util/add/gateway_youtube_blocked_devices"):
            if not alias_created:
                return httpx.Response(404, json={"status": "not_found"})
            return httpx.Response(200, json={"status": "done"})
        if path.endswith("/alias_util/list/gateway_youtube_blocked_devices"):
            if not alias_created:
                return httpx.Response(404, json={"status": "not_found"})
            return httpx.Response(200, json={"rows": [{"ip": "192.168.1.60"}]})
        if "/api/firewall/alias/get_alias_uuid/" in path:
            return httpx.Response(200, json={})
        if path == "/api/firewall/alias/add_item":
            return httpx.Response(200, json={"result": "saved", "uuid": "u-123"})
        if path == "/api/firewall/alias/reconfigure":
            alias_created = True
            return httpx.Response(200, json={"status": "ok"})
        if path.endswith("/alias_util/delete/gateway_youtube_blocked_devices"):
            return httpx.Response(200, json={"status": "done"})
        return httpx.Response(200, json={})

    client = OPNsenseClient(test_settings)
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        client,
        "_create_http_client",
        lambda: httpx.AsyncClient(base_url="https://opnsense.local", transport=transport),
    )

    assert "youtube.com" in YOUTUBE_BLOCK_DOMAINS
    assert "googlevideo.com" in YOUTUBE_BLOCK_DOMAINS
    assert await client.list_youtube_blocked_ips() == []

    ips = await client.add_ip_to_youtube_block_alias("192.168.1.60")
    assert ips == ["192.168.1.60"]
    assert alias_created is True

    await client.remove_ip_from_youtube_block_alias("192.168.1.60")


@respx.mock
@pytest.mark.asyncio
async def test_device_and_group_youtube_blocking_and_sqlite_health(
    async_client: AsyncClient,
    test_settings: Settings,
) -> None:
    """Verify device & group YouTube block/unblock API and SQLite health details."""
    base = test_settings.opnsense_base_url
    es_base = test_settings.elasticsearch_url
    yt_blocked: set[str] = set()

    respx.get(f"{base}/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "ip": "192.168.1.60",
                    "mac": "AA:BB:CC:DD:EE:60",
                    "hostname": "livingroom-appletv",
                    "intf_description": "LAN",
                    "expired": False,
                },
                {
                    "ip": "192.168.1.61",
                    "mac": "AA:BB:CC:DD:EE:61",
                    "hostname": "kids-ipad",
                    "intf_description": "LAN",
                    "expired": False,
                },
                {
                    "ip": "192.168.1.1",
                    "mac": "AA:BB:CC:DD:EE:01",
                    "hostname": "gateway",
                    "intf_description": "LAN",
                    "expired": False,
                },
            ],
        )
    )
    respx.get(f"{base}/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )
    respx.get(f"{base}/api/firewall/alias_util/list/gateway_blocked_devices").mock(
        return_value=httpx.Response(200, json={"rows": []})
    )

    def add_yt(req: httpx.Request) -> httpx.Response:
        import json

        ip = json.loads(req.content.decode()).get("address", "")
        yt_blocked.add(ip)
        return httpx.Response(200, json={"status": "done"})

    def del_yt(req: httpx.Request) -> httpx.Response:
        import json

        ip = json.loads(req.content.decode()).get("address", "")
        yt_blocked.discard(ip)
        return httpx.Response(200, json={"status": "done"})

    respx.post(f"{base}/api/firewall/alias_util/add/gateway_youtube_blocked_devices").mock(
        side_effect=add_yt
    )
    respx.post(f"{base}/api/firewall/alias_util/delete/gateway_youtube_blocked_devices").mock(
        side_effect=del_yt
    )
    respx.get(f"{base}/api/firewall/alias_util/list/gateway_youtube_blocked_devices").mock(
        side_effect=lambda _req: httpx.Response(
            200, json={"rows": [{"ip": ip} for ip in sorted(yt_blocked)]}
        )
    )
    respx.get(f"{es_base}/_cluster/health").mock(
        return_value=httpx.Response(
            200,
            json={"cluster_name": "es-test", "status": "green", "number_of_nodes": 1},
        )
    )
    respx.post(f"{es_base}/logs-pfsense.log*/_count").mock(
        return_value=httpx.Response(200, json={"count": 42})
    )

    login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": test_settings.admin_username,
            "password": test_settings.admin_password.get_secret_value(),
        },
    )
    assert login.status_code == 200

    # 1. Sync devices
    sync_resp = await async_client.post("/api/v1/devices/sync")
    assert sync_resp.status_code == 200
    devices = sync_resp.json()["devices"]
    appletv = next(d for d in devices if d["ipv4_address"] == "192.168.1.60")
    ipad = next(d for d in devices if d["ipv4_address"] == "192.168.1.61")
    assert appletv["is_youtube_blocked"] is False
    assert appletv["is_blocked"] is False

    # 2. Block YouTube on AppleTV while keeping general internet allowed
    yt_block = await async_client.post(f"/api/v1/devices/{appletv['id']}/youtube/block")
    assert yt_block.status_code == 200
    body = yt_block.json()
    assert body["action"] == "youtube_block"
    assert body["device"]["is_youtube_blocked"] is True
    assert body["device"]["is_blocked"] is False
    assert "192.168.1.60" in yt_blocked

    # 3. Unblock YouTube on AppleTV
    yt_unblock = await async_client.post(f"/api/v1/devices/{appletv['id']}/youtube/unblock")
    assert yt_unblock.status_code == 200
    assert yt_unblock.json()["device"]["is_youtube_blocked"] is False
    assert "192.168.1.60" not in yt_blocked

    # 4. Create a Group with AppleTV and iPad and test group YouTube block/unblock
    grp_create = await async_client.post(
        "/api/v1/groups",
        json={
            "name": "Media & Tablets",
            "description": "Living room and kids media devices",
            "color_badge": "rose",
            "icon": "tv",
            "device_ids": [appletv["id"], ipad["id"]],
        },
    )
    assert grp_create.status_code == 201
    group_id = grp_create.json()["id"]
    assert grp_create.json()["youtube_status"] == "allowed"
    assert grp_create.json()["youtube_blocked_devices"] == 0

    grp_yt_block = await async_client.post(f"/api/v1/groups/{group_id}/youtube/block")
    assert grp_yt_block.status_code == 200
    grp_block_data = grp_yt_block.json()
    assert grp_block_data["action"] == "youtube_block"
    assert grp_block_data["group"]["youtube_status"] == "blocked"
    assert grp_block_data["group"]["youtube_blocked_devices"] == 2
    assert grp_block_data["group"]["access_status"] == "allowed"
    assert yt_blocked == {"192.168.1.60", "192.168.1.61"}

    grp_yt_unblock = await async_client.post(f"/api/v1/groups/{group_id}/youtube/unblock")
    assert grp_yt_unblock.status_code == 200
    assert grp_yt_unblock.json()["group"]["youtube_status"] == "allowed"
    assert grp_yt_unblock.json()["group"]["youtube_blocked_devices"] == 0
    assert len(yt_blocked) == 0

    # 5. Check /api/v1/system/health includes SQLite storage size & record counts (FB-P6-003)
    health_resp = await async_client.get("/api/v1/system/health")
    assert health_resp.status_code == 200
    sqlite_details = health_resp.json()["services"]["sqlite"]["details"]
    assert sqlite_details["storage_bytes"] > 0
    assert isinstance(sqlite_details["storage_size_formatted"], str)
    assert sqlite_details["devices_count"] == 3
    assert sqlite_details["groups_count"] == 1
    assert sqlite_details["total_records"] >= 4


def test_v101_sqlite_permission_fallback_and_entrypoint_helpers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify v1.0.1 Proxmox Linux bind-mount permission handling and entrypoint privilege drop."""
    import sqlite3

    from app.config import Settings
    from app.db import _ensure_sqlite_parent_dir, extract_sqlite_file_path
    from app.entrypoint import (
        drop_privileges_if_root,
        main,
        prepare_sqlite_directories,
        resolve_target_data_dirs,
    )

    # 1. Settings normalizes 3-slash /app/data/ URL to 4-slash absolute URL
    s = Settings(
        app_secret_key="a" * 64,  # type: ignore[arg-type]
        admin_password="strong-password-123",  # type: ignore[arg-type]
        opnsense_api_key="k",  # type: ignore[arg-type]
        opnsense_api_secret="s",  # type: ignore[arg-type]
        elasticsearch_api_key="e",  # type: ignore[arg-type]
        database_url='"sqlite+aiosqlite:///app/data/gateway.db"',
    )
    assert s.database_url == "sqlite+aiosqlite:////app/data/gateway.db"

    # 2. extract_sqlite_file_path handles memory and file URLs
    assert extract_sqlite_file_path("sqlite+aiosqlite:///:memory:") is None
    extracted = extract_sqlite_file_path("sqlite+aiosqlite:////app/data/gateway.db")
    assert extracted is not None
    assert extracted.name == "gateway.db"

    # 3. _ensure_sqlite_parent_dir falls back to writable temp path on OperationalError
    original_connect = sqlite3.connect

    def _mock_unwritable_connect(path: str, *args: object, **kwargs: object) -> sqlite3.Connection:
        if "unwritable_dir" in str(path):
            raise sqlite3.OperationalError("unable to open database file")
        return original_connect(path, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(sqlite3, "connect", _mock_unwritable_connect)
    bad_url = f"sqlite+aiosqlite:///{(tmp_path / 'unwritable_dir' / 'gateway.db').as_posix()}"
    fallback_url = _ensure_sqlite_parent_dir(bad_url)
    assert fallback_url != bad_url
    assert "gateway-data/gateway.db" in fallback_url

    # 4. entrypoint resolve_target_data_dirs & prepare_sqlite_directories
    custom_db = tmp_path / "proxmox_data" / "gateway.db"
    dirs = resolve_target_data_dirs(
        {
            "SQLITE_DB_PATH": str(custom_db),
            "DATABASE_URL": "sqlite+aiosqlite:///app/data/gateway.db",
        }
    )
    assert custom_db.parent in dirs

    chown_calls: list[tuple[Path, int, int]] = []
    ( custom_db.parent ).mkdir(parents=True, exist_ok=True)
    ( custom_db.parent / "gateway.db" ).write_bytes(b"test")

    monkeypatch.setattr("os.geteuid", lambda: 0, raising=False)
    monkeypatch.setattr(
        "os.chown",
        lambda p, u, g: chown_calls.append((Path(p), u, g)),
        raising=False,
    )
    prepared = prepare_sqlite_directories([custom_db.parent], uid=10001, gid=10001)
    assert custom_db.parent in prepared
    assert len(chown_calls) >= 2

    # 5. drop_privileges_if_root & main execvp
    uid_set: list[int] = []
    gid_set: list[int] = []
    exec_calls: list[tuple[str, list[str]]] = []
    monkeypatch.setattr("os.initgroups", lambda u, g: None, raising=False)
    monkeypatch.setattr("os.setgid", lambda g: gid_set.append(g), raising=False)
    monkeypatch.setattr("os.setuid", lambda u: uid_set.append(u), raising=False)
    monkeypatch.setattr(
        "os.execvp",
        lambda file, args: exec_calls.append((file, list(args))),
    )
    monkeypatch.setattr(
        "app.entrypoint.resolve_target_data_dirs",
        lambda env=None: [custom_db.parent],
    )

    main(["uvicorn", "app.main:app", "--port", "8000"])
    assert gid_set == [10001]
    assert uid_set == [10001]
    assert exec_calls == [("uvicorn", ["uvicorn", "app.main:app", "--port", "8000"])]

    # When not root, drop_privileges_if_root returns False
    monkeypatch.setattr("os.geteuid", lambda: 10001, raising=False)
    assert drop_privileges_if_root() is False

