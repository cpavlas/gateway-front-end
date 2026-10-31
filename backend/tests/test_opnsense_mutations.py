"""Unit tests for OPNsenseClient block/unblock alias mutations and kill_states (Step 2.2)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.clients.opnsense import (
    OPNsenseClient,
    OPNsenseClientError,
    validate_ipv4_address,
)
from app.config import Settings


@pytest.mark.parametrize(
    ("raw_ip", "expected"),
    [
        ("192.168.50.42", "192.168.50.42"),
        ("  10.0.0.15  ", "10.0.0.15"),
    ],
)
def test_validate_ipv4_address_accepts_valid_ips(raw_ip: str, expected: str) -> None:
    """validate_ipv4_address returns canonical IPv4 string."""
    assert validate_ipv4_address(raw_ip) == expected


@pytest.mark.parametrize(
    "invalid_ip",
    [
        "",
        "192.168.50.0/24",
        "0.0.0.0",
        "255.255.255.255",
        "fe80::1",
        "192.168.50.42; rm -rf /",
        "not-an-ip",
    ],
)
def test_validate_ipv4_address_rejects_invalid_or_dangerous_inputs(
    invalid_ip: str,
) -> None:
    """validate_ipv4_address rejects CIDR, wildcards, IPv6, and injection strings."""
    with pytest.raises(ValueError, match="IPv4 address"):
        validate_ipv4_address(invalid_ip)


def test_validate_ipv4_address_rejects_non_string() -> None:
    """validate_ipv4_address rejects non-string inputs."""
    with pytest.raises(ValueError, match="must be a string"):
        validate_ipv4_address(12345)  # type: ignore[arg-type]


@respx.mock
@pytest.mark.asyncio
async def test_add_and_remove_ip_via_alias_util_primary_path(
    test_settings: Settings,
) -> None:
    """Verify add_ip_to_block_alias and remove_ip_from_block_alias when alias_util returns 200."""
    add_route = respx.post(
        "https://gateway.sparkle-pony.com/api/firewall/alias_util/add/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"status": "done"}))
    del_route = respx.post(
        "https://gateway.sparkle-pony.com/api/firewall/alias_util/delete/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"status": "done"}))

    list_route = respx.get(
        "https://gateway.sparkle-pony.com/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(
        side_effect=[
            httpx.Response(200, json={"rows": [{"ip": "192.168.50.55"}]}),
            httpx.Response(200, json={"rows": []}),
        ]
    )

    client = OPNsenseClient(test_settings)
    blocked_after_add = await client.add_ip_to_block_alias("192.168.50.55")
    assert blocked_after_add == ["192.168.50.55"]
    assert add_route.called

    blocked_after_remove = await client.remove_ip_from_block_alias("192.168.50.55")
    assert blocked_after_remove == []
    assert del_route.called
    assert list_route.call_count == 2


@respx.mock
@pytest.mark.asyncio
async def test_add_and_remove_ip_fallback_to_config_api_on_403(
    test_settings: Settings,
) -> None:
    """Verify Waterfall Update 2B: 403 on alias_util falls back to set_item + reconfigure."""
    respx.post(
        "https://gateway.sparkle-pony.com/api/firewall/alias_util/add/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(403, json={"message": "Forbidden"}))
    respx.post(
        "https://gateway.sparkle-pony.com/api/firewall/alias_util/delete/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(403, json={"message": "Forbidden"}))

    uuid = "7eb9bc75-bcba-42f9-8193-f5b14090488a"
    respx.get(
        "https://gateway.sparkle-pony.com/api/firewall/alias/get_alias_uuid/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"uuid": uuid}))

    respx.get(f"https://gateway.sparkle-pony.com/api/firewall/alias/get_item/{uuid}").mock(
        side_effect=[
            # First call (during add): 192.168.50.20 already selected
            httpx.Response(
                200,
                json={
                    "alias": {
                        "enabled": "1",
                        "name": "gateway_blocked_devices",
                        "type": {"host": {"value": "Host(s)", "selected": 1}},
                        "proto": {"IPv4": {"value": "IPv4", "selected": 0}},
                        "interface": {"": {"value": "None", "selected": 1}},
                        "counters": "1",
                        "updatefreq": "",
                        "content": {
                            "192.168.50.20": {"value": "192.168.50.20", "selected": 1},
                            "other_alias": {"value": "other_alias", "selected": 0},
                        },
                        "description": "Managed by Gateway Front-End Container",
                    }
                },
            ),
            # Second call (during remove): both .20 and .55 selected
            httpx.Response(
                200,
                json={
                    "alias": {
                        "enabled": "1",
                        "name": "gateway_blocked_devices",
                        "type": "host",
                        "proto": "",
                        "interface": "",
                        "counters": "1",
                        "updatefreq": "",
                        "content": "192.168.50.20\n192.168.50.55",
                        "description": "Managed by Gateway Front-End Container",
                    }
                },
            ),
        ]
    )

    set_route = respx.post(
        f"https://gateway.sparkle-pony.com/api/firewall/alias/set_item/{uuid}"
    ).mock(return_value=httpx.Response(200, json={"result": "saved"}))
    reconf_route = respx.post(
        "https://gateway.sparkle-pony.com/api/firewall/alias/reconfigure"
    ).mock(return_value=httpx.Response(200, json={"status": "ok"}))

    client = OPNsenseClient(test_settings)

    # 1. Add 192.168.50.55 via config API fallback
    after_add = await client.add_ip_to_block_alias("192.168.50.55")
    assert after_add == ["192.168.50.20", "192.168.50.55"]
    first_sent = json.loads(set_route.calls[0].request.content)
    assert first_sent["alias"]["type"] == "host"
    assert first_sent["alias"]["content"] == "192.168.50.20\n192.168.50.55"

    # 2. Remove 192.168.50.20 via config API fallback
    after_remove = await client.remove_ip_from_block_alias("192.168.50.20")
    assert after_remove == ["192.168.50.55"]
    second_sent = json.loads(set_route.calls[1].request.content)
    assert second_sent["alias"]["content"] == "192.168.50.55"
    assert reconf_route.call_count == 2


@respx.mock
@pytest.mark.asyncio
async def test_config_api_fallback_raises_on_validation_failure(
    test_settings: Settings,
) -> None:
    """Verify OPNsenseClientError is raised if set_item returns a validation failure."""
    respx.post(
        "https://gateway.sparkle-pony.com/api/firewall/alias_util/add/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(403))
    uuid = "7eb9bc75-bcba-42f9-8193-f5b14090488a"
    respx.get(
        "https://gateway.sparkle-pony.com/api/firewall/alias/get_alias_uuid/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"uuid": uuid}))
    respx.get(f"https://gateway.sparkle-pony.com/api/firewall/alias/get_item/{uuid}").mock(
        return_value=httpx.Response(200, json={"alias": {"content": {}}})
    )
    respx.post(
        f"https://gateway.sparkle-pony.com/api/firewall/alias/set_item/{uuid}"
    ).mock(
        return_value=httpx.Response(
            200, json={"result": "failed", "validations": {"alias.content": "Invalid"}}
        )
    )

    client = OPNsenseClient(test_settings)
    with pytest.raises(OPNsenseClientError, match="set_item rejected update"):
        await client.add_ip_to_block_alias("192.168.50.55")


@respx.mock
@pytest.mark.asyncio
async def test_kill_states_for_ip_success_and_error(
    test_settings: Settings,
) -> None:
    """Verify kill_states_for_ip sends {'filter': ip} and handles HTTP errors."""
    kill_route = respx.post(
        "https://gateway.sparkle-pony.com/api/diagnostics/firewall/kill_states"
    ).mock(
        side_effect=[
            httpx.Response(200, json={"result": "ok", "dropped_states": 14}),
            httpx.Response(500, json={"error": "pfctl failure"}),
        ]
    )

    client = OPNsenseClient(test_settings)
    res = await client.kill_states_for_ip("192.168.50.55")
    assert res["dropped_states"] == 14
    sent_body = json.loads(kill_route.calls[0].request.content)
    assert sent_body == {"filter": "192.168.50.55"}

    with pytest.raises(OPNsenseClientError, match="HTTP 500"):
        await client.kill_states_for_ip("192.168.50.55")

