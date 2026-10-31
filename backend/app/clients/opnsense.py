"""Async OPNsense 26.7.7-amd64 REST API client (httpx)."""

from __future__ import annotations

import ssl
import time
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from app.config import Settings


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

    async def _list_alias_ips_via_config_api(
        self, client: httpx.AsyncClient, target_alias: str
    ) -> list[str]:
        """Fallback reader using `/api/firewall/alias/get_alias_uuid` and `get_item`."""
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
        content = (
            item_payload.get("alias", {}).get("content", {})
            if isinstance(item_payload, dict)
            else {}
        )
        if isinstance(content, dict):
            selected_ips: list[str] = []
            for key, meta in content.items():
                if key and isinstance(meta, dict) and int(meta.get("selected", 0)) == 1:
                    selected_ips.append(str(key))
            return selected_ips
        if isinstance(content, str):
            return [line.strip() for line in content.splitlines() if line.strip()]
        return []

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
