"""Async client for Plex Media Server HTTP/JSON API (`FB-P9-005` / Tautulli-style telemetry)."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import httpx
from pydantic import BaseModel, SecretStr

from app.clients.opnsense import ServiceHealthStatus
from app.config import Settings


class PlexQueryError(Exception):
    """Raised when a Plex Media Server API request fails or returns an error status."""

    def __init__(self, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class PlexActiveSessionItem(BaseModel):
    """Live active Plex stream item for `Now Playing` telemetry (`FB-P9-005`)."""

    session_key: str
    client_ip: str
    device_id: int | None = None
    effective_name: str
    player_title: str
    player_product: str = ""
    player_platform: str = ""
    state: str = "playing"
    user_name: str = ""
    media_title: str
    media_type: str = ""
    stream_decision: str = "direct play"
    bandwidth_kbps: int = 0
    progress_percent: float = 0.0


def clean_plex_client_ip(raw_ip: str | None) -> str:
    """Normalize a Plex player address (stripping `::ffff:` IPv4-mapped IPv6 prefixes)."""
    cleaned = (raw_ip or "").strip()
    if cleaned.lower().startswith("::ffff:"):
        cleaned = cleaned[7:].strip()
    return cleaned


def format_plex_media_title(item: dict[str, Any]) -> str:
    """Format a Plex metadata item into a descriptive media title (`Show · SxxExx · Title`)."""
    media_type = str(item.get("type") or "").strip().lower()
    title = str(item.get("title") or "Unknown Media").strip()
    grandparent = str(item.get("grandparentTitle") or "").strip()
    parent_index = item.get("parentIndex")
    index = item.get("index")
    year = item.get("year")

    if media_type == "episode" and grandparent:
        if parent_index is not None and index is not None:
            try:
                ep_code = f"S{int(parent_index):02d}E{int(index):02d}"
                return f"{grandparent} · {ep_code} · {title}"
            except (TypeError, ValueError):
                pass
        return f"{grandparent} - {title}"
    if media_type == "track" and grandparent:
        return f"{grandparent} - {title}"
    if year:
        return f"{title} ({year})"
    return title


def normalize_plex_sessions_payload(raw_json: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize Plex `GET /status/sessions` JSON response into structured session dicts."""
    container = raw_json.get("MediaContainer")
    if not isinstance(container, dict):
        return []
    metadata_raw = container.get("Metadata")
    if isinstance(metadata_raw, dict):
        metadata_list = [metadata_raw]
    elif isinstance(metadata_raw, list):
        metadata_list = [m for m in metadata_raw if isinstance(m, dict)]
    else:
        return []

    sessions: list[dict[str, Any]] = []
    for item in metadata_list:
        raw_player = item.get("Player")
        player: dict[str, Any] = raw_player if isinstance(raw_player, dict) else {}
        raw_user = item.get("User")
        user: dict[str, Any] = raw_user if isinstance(raw_user, dict) else {}
        raw_session = item.get("Session")
        session_obj: dict[str, Any] = raw_session if isinstance(raw_session, dict) else {}
        raw_transcode = item.get("TranscodeSession")
        transcode: dict[str, Any] | None = (
            raw_transcode if isinstance(raw_transcode, dict) else None
        )

        client_ip = clean_plex_client_ip(
            str(player.get("address") or player.get("remotePublicAddress") or "")
        )
        player_title = str(
            player.get("title") or player.get("device") or player.get("product") or ""
        ).strip()
        player_product = str(player.get("product") or "").strip()
        player_platform = str(player.get("platform") or "").strip()
        state = str(player.get("state") or "playing").strip().lower()
        session_key = str(
            item.get("sessionKey")
            or session_obj.get("id")
            or player.get("machineIdentifier")
            or f"{client_ip}:{player_title}"
        ).strip()

        video_decision = (
            str(transcode.get("videoDecision") or "").strip().lower()
            if transcode is not None
            else ""
        )
        if video_decision == "transcode":
            stream_decision = "transcode"
        elif video_decision == "copy":
            stream_decision = "direct stream"
        else:
            stream_decision = "direct play"

        try:
            bandwidth_kbps = int(float(session_obj.get("bandwidth") or 0))
        except (TypeError, ValueError):
            bandwidth_kbps = 0

        try:
            view_offset = float(item.get("viewOffset") or 0.0)
            duration_ms = float(item.get("duration") or 0.0)
            progress_pct = (
                round(min(100.0, max(0.0, (view_offset / duration_ms) * 100.0)), 1)
                if duration_ms > 0
                else 0.0
            )
        except (TypeError, ValueError):
            progress_pct = 0.0

        sessions.append(
            {
                "session_key": session_key,
                "client_ip": client_ip,
                "player_title": player_title,
                "player_product": player_product,
                "player_platform": player_platform,
                "state": state,
                "user_name": str(user.get("title") or "").strip(),
                "media_title": format_plex_media_title(item),
                "media_type": str(item.get("type") or "").strip(),
                "stream_decision": stream_decision,
                "bandwidth_kbps": bandwidth_kbps,
                "progress_percent": progress_pct,
            }
        )
    return sessions


def normalize_plex_history_payload(
    history_json: dict[str, Any],
    devices_json: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Normalize Plex `GET /status/sessions/history/all` joined with `GET /devices`."""
    device_map: dict[int, dict[str, str]] = {}
    if isinstance(devices_json, dict):
        dev_container = devices_json.get("MediaContainer")
        if isinstance(dev_container, dict):
            raw_devs = dev_container.get("Device")
            dev_list = (
                [raw_devs]
                if isinstance(raw_devs, dict)
                else (raw_devs if isinstance(raw_devs, list) else [])
            )
            for d in dev_list:
                if not isinstance(d, dict):
                    continue
                try:
                    d_id = int(d.get("id"))  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    continue
                device_map[d_id] = {
                    "name": str(d.get("name") or "").strip(),
                    "platform": str(d.get("platform") or "").strip(),
                    "client_identifier": str(d.get("clientIdentifier") or "").strip(),
                }

    container = history_json.get("MediaContainer")
    if not isinstance(container, dict):
        return []
    metadata_raw = container.get("Metadata")
    if isinstance(metadata_raw, dict):
        metadata_list = [metadata_raw]
    elif isinstance(metadata_raw, list):
        metadata_list = [m for m in metadata_raw if isinstance(m, dict)]
    else:
        return []

    records: list[dict[str, Any]] = []
    for item in metadata_list:
        try:
            viewed_at_ts = int(item.get("viewedAt") or 0)
        except (TypeError, ValueError):
            viewed_at_ts = 0
        if viewed_at_ts <= 0:
            continue

        viewed_at_dt = datetime.fromtimestamp(viewed_at_ts, tz=UTC)
        raw_dev_id = item.get("deviceID")
        try:
            dev_id = int(raw_dev_id) if raw_dev_id is not None else None
        except (TypeError, ValueError):
            dev_id = None

        dev_info = device_map.get(dev_id, {}) if dev_id is not None else {}
        player_title = str(
            dev_info.get("name") or item.get("deviceName") or ""
        ).strip()
        player_platform = str(dev_info.get("platform") or "").strip()

        raw_dur = item.get("duration")
        duration_minutes = 20
        if raw_dur is not None:
            try:
                dur_val = float(raw_dur)
                if dur_val > 36000:
                    duration_minutes = max(5, min(240, round(dur_val / 60000.0)))
                elif dur_val > 0:
                    duration_minutes = max(5, min(240, round(dur_val / 60.0)))
            except (TypeError, ValueError):
                duration_minutes = 20

        records.append(
            {
                "history_key": str(item.get("historyKey") or f"{viewed_at_ts}:{dev_id}"),
                "viewed_at": viewed_at_dt,
                "viewed_at_iso": viewed_at_dt.isoformat(),
                "device_id": dev_id,
                "player_title": player_title,
                "player_platform": player_platform,
                "media_title": format_plex_media_title(item),
                "media_type": str(item.get("type") or "").strip(),
                "duration_minutes": duration_minutes,
            }
        )
    return records


class PlexServiceClient:
    """Async HTTP client for Plex Media Server session and playback telemetry (`FB-P9-005`)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._base_url = settings.plex_base_url.strip().rstrip("/")
        raw_tok = (
            settings.plex_api_token.get_secret_value()
            if isinstance(settings.plex_api_token, SecretStr)
            else str(settings.plex_api_token)
        )
        self._api_token = raw_tok.strip()
        self._verify_ssl = bool(settings.plex_verify_ssl)
        self._timeout = max(float(settings.plex_timeout_seconds), 2.0)

    @property
    def is_configured(self) -> bool:
        """Return True if both base URL and X-Plex-Token are configured."""
        return bool(self._base_url) and bool(self._api_token)

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "X-Plex-Token": self._api_token,
            "X-Plex-Product": "GatewayControl",
            "X-Plex-Client-Identifier": "gateway-front-end",
        }

    def create_http_client(self) -> httpx.AsyncClient:
        """Instantiate an httpx.AsyncClient configured for Plex Media Server."""
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            verify=self._verify_ssl,
            timeout=self._timeout,
        )

    async def check_health(self) -> ServiceHealthStatus:
        """Verify Plex Media Server connectivity, token validity, and active stream count."""
        if not self.is_configured:
            return ServiceHealthStatus(
                service="plex",
                status="unhealthy",
                latency_ms=0.0,
                message="Plex Media Server URL or API Token (X-Plex-Token) is not configured.",
                details={"url": self._base_url, "configured": False},
            )

        start = time.perf_counter()
        client = self.create_http_client()
        try:
            root_resp = await client.get("/")
            if root_resp.status_code in (401, 403):
                elapsed = round((time.perf_counter() - start) * 1000, 2)
                return ServiceHealthStatus(
                    service="plex",
                    status="unhealthy",
                    latency_ms=elapsed,
                    message=(
                        f"Plex authentication rejected (HTTP {root_resp.status_code}). "
                        "Check X-Plex-Token."
                    ),
                    details={
                        "url": self._base_url,
                        "status_code": root_resp.status_code,
                        "configured": True,
                    },
                )
            root_resp.raise_for_status()
            root_json = root_resp.json()
            mc = (
                root_json.get("MediaContainer")
                if isinstance(root_json, dict)
                else {}
            )
            if not isinstance(mc, dict):
                mc = {}
            server_name = str(mc.get("friendlyName") or "Plex Media Server")
            version = str(mc.get("version") or "unknown")
            machine_id = str(mc.get("machineIdentifier") or "")

            sess_resp = await client.get("/status/sessions")
            active_sessions = 0
            if sess_resp.status_code == 200:
                parsed_sessions = normalize_plex_sessions_payload(sess_resp.json())
                active_sessions = len(parsed_sessions)

            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="plex",
                status="healthy",
                latency_ms=elapsed,
                message=(
                    f"Plex Media Server '{server_name}' ({version}) connected "
                    f"({active_sessions} active stream(s))."
                ),
                details={
                    "url": self._base_url,
                    "configured": True,
                    "server_name": server_name,
                    "version": version,
                    "machine_identifier": machine_id,
                    "active_sessions": active_sessions,
                },
            )
        except httpx.HTTPStatusError as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="plex",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"Plex HTTP {exc.response.status_code} error: {exc}",
                details={
                    "url": self._base_url,
                    "status_code": exc.response.status_code,
                    "configured": True,
                },
            )
        except Exception as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="plex",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"Plex connection failed: {exc.__class__.__name__}: {exc}",
                details={"url": self._base_url, "configured": True},
            )
        finally:
            await client.aclose()

    async def fetch_active_sessions(self) -> list[dict[str, Any]]:
        """Query `GET /status/sessions` and return normalized active session dictionaries."""
        if not self.is_configured:
            return []
        client = self.create_http_client()
        try:
            resp = await client.get("/status/sessions")
            if resp.status_code in (401, 403):
                raise PlexQueryError(
                    f"Plex authentication rejected (HTTP {resp.status_code})",
                    status_code=resp.status_code,
                )
            resp.raise_for_status()
            return normalize_plex_sessions_payload(resp.json())
        except PlexQueryError:
            raise
        except Exception as exc:
            raise PlexQueryError(
                f"Plex /status/sessions query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.aclose()

    async def fetch_playback_history(self, limit: int = 200) -> list[dict[str, Any]]:
        """Query `GET /status/sessions/history/all` and `GET /devices` for recent watch history."""
        if not self.is_configured:
            return []
        client = self.create_http_client()
        try:
            hist_resp = await client.get(
                "/status/sessions/history/all",
                params={
                    "sort": "viewedAt:desc",
                    "X-Plex-Container-Start": "0",
                    "X-Plex-Container-Size": str(max(10, min(limit, 500))),
                },
            )
            if hist_resp.status_code in (401, 403):
                raise PlexQueryError(
                    f"Plex authentication rejected (HTTP {hist_resp.status_code})",
                    status_code=hist_resp.status_code,
                )
            hist_resp.raise_for_status()
            devices_json: dict[str, Any] | None = None
            try:
                dev_resp = await client.get("/devices")
                if dev_resp.status_code == 200:
                    devices_json = dev_resp.json()
            except Exception:  # noqa: S110
                pass
            return normalize_plex_history_payload(hist_resp.json(), devices_json)
        except PlexQueryError:
            raise
        except Exception as exc:
            raise PlexQueryError(
                f"Plex playback history query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.aclose()
