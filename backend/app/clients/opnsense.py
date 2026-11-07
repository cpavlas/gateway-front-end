"""Async OPNsense 26.7.7-amd64 REST API client (httpx)."""

from __future__ import annotations

import ipaddress
import ssl
import time
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from app.config import Settings

YOUTUBE_BLOCK_DOMAINS: tuple[str, ...] = (
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "googlevideo.com",
    "ytimg.com",
    "i.ytimg.com",
    "s.ytimg.com",
    "youtubei.googleapis.com",
    "youtube-nocookie.com",
)


def validate_ipv4_address(ip: str) -> str:
    """Validate that `ip` is a single canonical IPv4 address (no CIDR, wildcards, or IPv6)."""
    if not isinstance(ip, str):
        raise ValueError("IPv4 address must be a string.")
    cleaned = ip.strip()
    try:
        addr = ipaddress.IPv4Address(cleaned)
    except ValueError as exc:
        raise ValueError(f"Invalid IPv4 address: '{ip}'") from exc
    if addr.is_unspecified or str(addr) == "255.255.255.255":
        raise ValueError(f"Refusing wildcard/broadcast IPv4 address: '{ip}'")
    return str(addr)


def _extract_selected_option(field_val: Any, default: str = "") -> str:
    """Extract the selected key(s) from an OPNsense MVC option dictionary."""
    if isinstance(field_val, str):
        return field_val
    if isinstance(field_val, dict):
        selected = [
            str(key)
            for key, meta in field_val.items()
            if key and isinstance(meta, dict) and int(meta.get("selected", 0)) == 1
        ]
        return ",".join(selected) if selected else default
    return default


class ServiceHealthStatus(BaseModel):
    """Standardized health check status for an external or local dependency."""

    service: str
    status: Literal["healthy", "degraded", "unhealthy"]
    latency_ms: float
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class OPNsenseClientError(Exception):
    """Raised when an OPNsense API request fails."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class OPNsenseClient:
    """Async client for OPNsense 26.7.7-amd64 MVC endpoints."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._base_url = settings.opnsense_base_url
        self._alias_name = settings.opnsense_block_alias
        self._youtube_block_alias = getattr(
            settings, "opnsense_youtube_block_alias", "gateway_youtube_blocked_devices"
        )
        self._youtube_domains_alias = getattr(
            settings, "opnsense_youtube_domains_alias", "gateway_youtube_domains"
        )
        self._auth = (
            settings.opnsense_api_key.get_secret_value(),
            settings.opnsense_api_secret.get_secret_value(),
        )
        self._timeout = settings.opnsense_timeout_seconds
        self._verify: bool | ssl.SSLContext = self._build_ssl_verify(settings)

    @staticmethod
    def _build_ssl_verify(settings: Settings) -> bool | ssl.SSLContext:
        if not settings.opnsense_verify_ssl:
            return False
        if settings.opnsense_ca_cert_path.strip():
            return ssl.create_default_context(cafile=settings.opnsense_ca_cert_path.strip())
        return True

    def _create_http_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            auth=self._auth,
            verify=self._verify,
            timeout=self._timeout,
            headers={"Accept": "application/json"},
        )

    async def get_arp_table(self) -> list[dict[str, Any]]:
        """Fetch live ARP entries via OPNsense 26.7 /api/diagnostics/interface/get_arp."""
        async with self._create_http_client() as client:
            resp = await client.get("/api/diagnostics/interface/get_arp")
            self._raise_for_status(resp, "get_arp")
            payload = resp.json()
            if isinstance(payload, list):
                return payload
            if isinstance(payload, dict):
                rows = payload.get("rows") or payload.get("arp") or []
                if isinstance(rows, list):
                    return rows
            return []

    async def get_dnsmasq_leases(self) -> list[dict[str, Any]]:
        """Fetch Dnsmasq DHCP leases via /api/dnsmasq/leases/search."""
        async with self._create_http_client() as client:
            resp = await client.get("/api/dnsmasq/leases/search")
            self._raise_for_status(resp, "dnsmasq/leases/search")
            payload = resp.json()
            if isinstance(payload, dict):
                rows = payload.get("rows") or payload.get("leases") or []
                if isinstance(rows, list):
                    return rows
            if isinstance(payload, list):
                return payload
            return []

    async def list_blocked_alias_ips(self, alias_name: str | None = None) -> list[str]:
        """List IP addresses currently present in the target OPNsense firewall alias.

        Attempts runtime `/api/firewall/alias_util/list/{alias}` first; if the API key only has
        `Firewall: Aliases` (`api/firewall/alias/*`) and not `page-diagnostics-table`, falls back
        to `/api/firewall/alias/get_alias_uuid/{alias}` + `/api/firewall/alias/get_item/{uuid}`.
        """
        target_alias = alias_name or self._alias_name
        async with self._create_http_client() as client:
            resp = await client.get(f"/api/firewall/alias_util/list/{target_alias}")
            if resp.status_code == 403:
                return await self._list_alias_ips_via_config_api(client, target_alias)
            self._raise_for_status(resp, f"alias_util/list/{target_alias}")
            payload = resp.json()
            if isinstance(payload, dict):
                rows = payload.get("rows") or []
                extracted: list[str] = []
                for row in rows:
                    if isinstance(row, dict) and "ip" in row:
                        extracted.append(str(row["ip"]))
                    elif isinstance(row, str):
                        extracted.append(row)
                return extracted
            if isinstance(payload, list):
                return [
                    str(item["ip"]) if isinstance(item, dict) and "ip" in item else str(item)
                    for item in payload
                ]
            return []

    async def _get_alias_uuid_and_item(
        self, client: httpx.AsyncClient, target_alias: str
    ) -> tuple[str, dict[str, Any], list[str]]:
        """Fetch `(uuid, alias_dict, current_ips)` via `/api/firewall/alias/*` config endpoints."""
        uuid_resp = await client.get(f"/api/firewall/alias/get_alias_uuid/{target_alias}")
        self._raise_for_status(uuid_resp, f"alias/get_alias_uuid/{target_alias}")
        uuid_payload = uuid_resp.json()
        uuid = uuid_payload.get("uuid") if isinstance(uuid_payload, dict) else None
        if not uuid:
            raise OPNsenseClientError(
                f"OPNsense alias '{target_alias}' does not exist in Firewall -> Aliases.",
                status_code=404,
            )

        item_resp = await client.get(f"/api/firewall/alias/get_item/{uuid}")
        self._raise_for_status(item_resp, f"alias/get_item/{uuid}")
        item_payload = item_resp.json()
        alias_dict = (
            item_payload.get("alias", {}) if isinstance(item_payload, dict) else {}
        )
        content = alias_dict.get("content", {})
        current_ips: list[str] = []
        if isinstance(content, dict):
            for key, meta in content.items():
                if key and isinstance(meta, dict) and int(meta.get("selected", 0)) == 1:
                    current_ips.append(str(key))
        elif isinstance(content, str):
            current_ips = [line.strip() for line in content.splitlines() if line.strip()]

        return str(uuid), alias_dict, current_ips

    async def _list_alias_ips_via_config_api(
        self, client: httpx.AsyncClient, target_alias: str
    ) -> list[str]:
        """Fallback reader using `/api/firewall/alias/get_alias_uuid` and `get_item`."""
        _uuid, _alias_dict, current_ips = await self._get_alias_uuid_and_item(
            client, target_alias
        )
        return current_ips

    async def _mutate_alias_ips_via_config_api(
        self,
        client: httpx.AsyncClient,
        target_alias: str,
        *,
        add_ip: str | None = None,
        remove_ip: str | None = None,
    ) -> list[str]:
        """Update an OPNsense alias via `get_item` -> `set_item` -> `reconfigure` (Update 2B)."""
        uuid, alias_dict, current_ips = await self._get_alias_uuid_and_item(
            client, target_alias
        )
        updated_ips = list(dict.fromkeys(current_ips))
        if add_ip and add_ip not in updated_ips:
            updated_ips.append(add_ip)
        if remove_ip and remove_ip in updated_ips:
            updated_ips = [item for item in updated_ips if item != remove_ip]

        set_payload = {
            "alias": {
                "enabled": str(alias_dict.get("enabled", "1")),
                "name": str(alias_dict.get("name", target_alias)),
                "type": _extract_selected_option(alias_dict.get("type"), default="host"),
                "proto": _extract_selected_option(alias_dict.get("proto"), default=""),
                "interface": _extract_selected_option(
                    alias_dict.get("interface"), default=""
                ),
                "counters": str(alias_dict.get("counters", "1")),
                "updatefreq": str(alias_dict.get("updatefreq", "")),
                "content": "\n".join(updated_ips),
                "description": str(
                    alias_dict.get("description", "Managed by Gateway Front-End Container")
                ),
            }
        }
        set_resp = await client.post(
            f"/api/firewall/alias/set_item/{uuid}", json=set_payload
        )
        self._raise_for_status(set_resp, f"alias/set_item/{uuid}")
        set_data = set_resp.json()
        if isinstance(set_data, dict) and set_data.get("result") not in (
            None,
            "saved",
            "ok",
        ):
            raise OPNsenseClientError(
                f"OPNsense alias set_item rejected update: {set_data}",
                status_code=400,
            )

        reconf_resp = await client.post("/api/firewall/alias/reconfigure", json={})
        self._raise_for_status(reconf_resp, "alias/reconfigure")
        return updated_ips

    async def add_ip_to_block_alias(
        self, ip: str, alias_name: str | None = None
    ) -> list[str]:
        """Add an IPv4 address to the OPNsense block alias (with 403 config API fallback)."""
        valid_ip = validate_ipv4_address(ip)
        target_alias = alias_name or self._alias_name
        async with self._create_http_client() as client:
            resp = await client.post(
                f"/api/firewall/alias_util/add/{target_alias}",
                json={"address": valid_ip},
            )
            if resp.status_code == 403:
                return await self._mutate_alias_ips_via_config_api(
                    client, target_alias, add_ip=valid_ip
                )
            self._raise_for_status(resp, f"alias_util/add/{target_alias}")
        return await self.list_blocked_alias_ips(target_alias)

    async def remove_ip_from_block_alias(
        self, ip: str, alias_name: str | None = None
    ) -> list[str]:
        """Remove an IPv4 address from the OPNsense block alias (with 403 config API fallback)."""
        valid_ip = validate_ipv4_address(ip)
        target_alias = alias_name or self._alias_name
        async with self._create_http_client() as client:
            resp = await client.post(
                f"/api/firewall/alias_util/delete/{target_alias}",
                json={"address": valid_ip},
            )
            if resp.status_code == 403:
                return await self._mutate_alias_ips_via_config_api(
                    client, target_alias, remove_ip=valid_ip
                )
            self._raise_for_status(resp, f"alias_util/delete/{target_alias}")
        return await self.list_blocked_alias_ips(target_alias)

    async def kill_states_for_ip(self, ip: str) -> dict[str, Any]:
        """Sever active firewall states for a single validated IPv4 address."""
        valid_ip = validate_ipv4_address(ip)
        async with self._create_http_client() as client:
            resp = await client.post(
                "/api/diagnostics/firewall/kill_states",
                json={"filter": valid_ip},
            )
            self._raise_for_status(resp, "diagnostics/firewall/kill_states")
            data = resp.json()
            return data if isinstance(data, dict) else {"result": "ok"}

    async def ensure_youtube_aliases_exist(self) -> dict[str, Any]:
        """Ensure `gateway_youtube_domains` and `gateway_youtube_blocked_devices` exist."""
        created_aliases: list[str] = []
        async with self._create_http_client() as client:
            for alias_name, content, description in (
                (
                    self._youtube_domains_alias,
                    "\n".join(YOUTUBE_BLOCK_DOMAINS),
                    "YouTube destination domains managed by Gateway Controller",
                ),
                (
                    self._youtube_block_alias,
                    "",
                    "YouTube blocked client IPs managed by Gateway Controller",
                ),
            ):
                uuid_resp = await client.get(
                    f"/api/firewall/alias/get_alias_uuid/{alias_name}"
                )
                uuid_val: str | None = None
                if uuid_resp.status_code == 200:
                    payload = uuid_resp.json()
                    if isinstance(payload, dict) and payload.get("uuid"):
                        uuid_val = str(payload["uuid"])
                if not uuid_val:
                    add_resp = await client.post(
                        "/api/firewall/alias/add_item",
                        json={
                            "alias": {
                                "enabled": "1",
                                "name": alias_name,
                                "type": "host",
                                "content": content,
                                "description": description,
                            }
                        },
                    )
                    self._raise_for_status(add_resp, f"alias/add_item/{alias_name}")
                    created_aliases.append(alias_name)
            if created_aliases:
                reconf_resp = await client.post(
                    "/api/firewall/alias/reconfigure", json={}
                )
                self._raise_for_status(reconf_resp, "alias/reconfigure")
        return {
            "youtube_block_alias": self._youtube_block_alias,
            "youtube_domains_alias": self._youtube_domains_alias,
            "created_aliases": created_aliases,
        }

    async def list_youtube_blocked_ips(self) -> list[str]:
        """List IPv4 addresses currently in `gateway_youtube_blocked_devices`."""
        try:
            return await self.list_blocked_alias_ips(self._youtube_block_alias)
        except OPNsenseClientError as exc:
            if exc.status_code in (400, 404):
                return []
            raise

    async def add_ip_to_youtube_block_alias(self, ip: str) -> list[str]:
        """Add an IPv4 address to `gateway_youtube_blocked_devices` (auto-creating if missing)."""
        valid_ip = validate_ipv4_address(ip)
        try:
            return await self.add_ip_to_block_alias(
                valid_ip, alias_name=self._youtube_block_alias
            )
        except OPNsenseClientError as exc:
            if exc.status_code in (400, 404):
                await self.ensure_youtube_aliases_exist()
                return await self.add_ip_to_block_alias(
                    valid_ip, alias_name=self._youtube_block_alias
                )
            raise

    async def remove_ip_from_youtube_block_alias(self, ip: str) -> list[str]:
        """Remove an IPv4 address from `gateway_youtube_blocked_devices`."""
        valid_ip = validate_ipv4_address(ip)
        try:
            return await self.remove_ip_from_block_alias(
                valid_ip, alias_name=self._youtube_block_alias
            )
        except OPNsenseClientError as exc:
            if exc.status_code in (400, 404):
                return []
            raise

    @staticmethod
    def _raise_for_status(resp: httpx.Response, endpoint_label: str) -> None:
        if resp.status_code in (401, 403):
            raise OPNsenseClientError(
                f"OPNsense authentication/privilege rejected "
                f"({resp.status_code}) on {endpoint_label}",
                status_code=resp.status_code,
            )
        if resp.status_code == 404:
            raise OPNsenseClientError(
                f"OPNsense endpoint or resource not found (404) on {endpoint_label}",
                status_code=404,
            )
        if resp.status_code >= 400:
            raise OPNsenseClientError(
                f"OPNsense HTTP {resp.status_code} error on {endpoint_label}",
                status_code=resp.status_code,
            )

    async def check_health(self) -> ServiceHealthStatus:
        """Probe OPNsense ARP, Dnsmasq leases, and block alias readiness."""
        start = time.perf_counter()
        try:
            arp_entries = await self.get_arp_table()
            lease_entries = await self.get_dnsmasq_leases()
        except OPNsenseClientError as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="opnsense",
                status="unhealthy",
                latency_ms=elapsed,
                message=str(exc),
                details={"base_url": self._base_url, "status_code": exc.status_code},
            )
        except httpx.HTTPError as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="opnsense",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"OPNsense connection failed: {exc.__class__.__name__}: {exc}",
                details={"base_url": self._base_url},
            )

        # Check whether the configured block alias exists and is queryable
        try:
            blocked_ips = await self.list_blocked_alias_ips()
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="opnsense",
                status="healthy",
                latency_ms=elapsed,
                message="OPNsense API connected (ARP, Dnsmasq leases, and block alias verified).",
                details={
                    "base_url": self._base_url,
                    "arp_count": len(arp_entries),
                    "dnsmasq_lease_count": len(lease_entries),
                    "block_alias": self._alias_name,
                    "blocked_ip_count": len(blocked_ips),
                },
            )
        except (OPNsenseClientError, httpx.HTTPError) as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="opnsense",
                status="degraded",
                latency_ms=elapsed,
                message=(
                    f"OPNsense connected, but block alias '{self._alias_name}' "
                    f"could not be listed: {exc}"
                ),
                details={
                    "base_url": self._base_url,
                    "arp_count": len(arp_entries),
                    "dnsmasq_lease_count": len(lease_entries),
                    "block_alias": self._alias_name,
                },
            )

    async def get_destination_nat_mappings(
        self,
    ) -> dict[tuple[str, int, str], int]:
        """Discover external WAN port -> internal `(lan_ip, lan_port, proto)` mappings
        from OPNsense Destination NAT rules (`/api/firewall/d_nat/searchRule`) and
        active PF state table entries (`/api/diagnostics/firewall/query_states`).
        """
        mappings: dict[tuple[str, int, str], int] = {}
        try:
            async with self._create_http_client() as client:
                # 1. Try MVC Destination NAT rules if privilege is assigned
                try:
                    dnat_resp = await client.post(
                        "/api/firewall/d_nat/searchRule", json={}
                    )
                    if dnat_resp.status_code == 200:
                        rows = (dnat_resp.json() or {}).get("rows") or []
                        for row in rows:
                            if str(row.get("disabled", "0")) == "1":
                                continue
                            target_ip = str(
                                row.get("target") or row.get("dst_addr") or ""
                            ).strip()
                            local_p = str(
                                row.get("local-port")
                                or row.get("local_port")
                                or row.get("dst_port")
                                or ""
                            ).strip()
                            ext_p = str(
                                row.get("destination_port")
                                or row.get("dst_port")
                                or local_p
                            ).strip()
                            proto = (
                                str(row.get("protocol") or row.get("proto") or "tcp")
                                .strip()
                                .lower()
                            )
                            if (
                                target_ip
                                and local_p.isdigit()
                                and ext_p.isdigit()
                            ):
                                mappings[(target_ip, int(local_p), proto)] = int(ext_p)
                except httpx.HTTPError:
                    pass

                # 2. Inspect active PF states for inbound NAT port translations
                try:
                    states_resp = await client.post(
                        "/api/diagnostics/firewall/query_states",
                        json={"rowCount": 1500},
                    )
                    if states_resp.status_code == 200:
                        for row in (states_resp.json() or {}).get("rows") or []:
                            if str(row.get("direction") or "").lower() != "in":
                                continue
                            nat_addr = str(row.get("nat_addr") or "").strip()
                            nat_port = str(row.get("nat_port") or "").strip()
                            dst_addr = str(row.get("dst_addr") or "").strip()
                            dst_port = str(row.get("dst_port") or "").strip()
                            proto = (
                                str(row.get("proto") or "tcp").strip().lower()
                            )
                            if (
                                not nat_addr
                                or nat_addr.startswith("192.168.")
                                or nat_addr.startswith("10.")
                                or nat_addr.startswith("127.")
                            ):
                                continue
                            if (
                                dst_addr
                                and nat_port.isdigit()
                                and dst_port.isdigit()
                            ):
                                mappings[(dst_addr, int(dst_port), proto)] = int(
                                    nat_port
                                )
                except httpx.HTTPError:
                    pass
        except Exception:  # noqa: S110
            pass
        return mappings
