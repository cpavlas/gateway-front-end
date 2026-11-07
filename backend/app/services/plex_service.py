"""Tautulli-style Plex session poller, SQLite heartbeat logger, and analytics (`FB-P9-005`)."""

from __future__ import annotations

import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.plex import (
    PlexActiveSessionItem,
    PlexQueryError,
    PlexServiceClient,
    clean_plex_client_ip,
)
from app.config import Settings, apply_runtime_overrides
from app.models import Device, PlexSessionLog, utc_now

_PLEX_CACHE_TTL_SECONDS = 30.0
_plex_live_cache: dict[str, tuple[float, Any]] = {}


def clear_plex_live_cache() -> None:
    """Clear the in-memory Plex active-sessions and history cache."""
    _plex_live_cache.clear()


def resolve_window_cutoff_datetime(
    window: str,
    now_dt: datetime | None = None,
) -> datetime:
    """Return the UTC start `datetime` for a telemetry window (`1h`, `24h`, `7d`, `30d`)."""
    base_now = now_dt if now_dt is not None else datetime.now(UTC)
    clean_win = (window or "24h").strip().lower()
    if clean_win == "1h":
        return base_now - timedelta(hours=1)
    if clean_win == "7d":
        return base_now - timedelta(days=7)
    if clean_win == "30d":
        return base_now - timedelta(days=30)
    return base_now - timedelta(hours=24)


def _normalize_device_token(text: str | None) -> str:
    """Normalize a hostname or player title into lowercase alphanumeric chars."""
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def match_plex_player_to_sqlite_device(
    *,
    client_ip: str | None,
    player_title: str | None,
    player_product: str | None = None,
    player_platform: str | None = None,
    sqlite_devices: list[Device],
) -> Device | None:
    """Correlate a Plex player (IP, title, product, platform) to a SQLite `Device` (`FB-P9-005`)."""
    clean_ip = clean_plex_client_ip(client_ip)
    if clean_ip:
        for dev in sqlite_devices:
            if dev.ipv4_address and dev.ipv4_address.strip() == clean_ip:
                return dev

    candidates = [
        _normalize_device_token(player_title),
        _normalize_device_token(player_product),
        _normalize_device_token(player_platform),
    ]
    candidates = [c for c in candidates if len(c) >= 3]
    if not candidates:
        return None

    for dev in sqlite_devices:
        dev_tokens = [
            _normalize_device_token(dev.display_name),
            _normalize_device_token(dev.hostname),
        ]
        dev_tokens = [dt for dt in dev_tokens if len(dt) >= 3]
        for cand in candidates:
            for dt in dev_tokens:
                if cand == dt or cand in dt or dt in cand:
                    return dev
                if ("webos" in cand or "lgtv" in cand) and (
                    "webos" in dt or "lgtv" in dt
                ):
                    return dev
    return None


def prepare_plex_session_log_rows(
    active_sessions: list[dict[str, Any]],
    *,
    recorded_at: datetime | None = None,
    poll_interval_seconds: int = 30,
) -> list[PlexSessionLog]:
    """Synchronously convert active `playing` Plex sessions into `PlexSessionLog` ORM rows."""
    ts = recorded_at if recorded_at is not None else utc_now()
    rows: list[PlexSessionLog] = []
    for sess in active_sessions:
        state = str(sess.get("state") or "playing").strip().lower()
        if state != "playing":
            continue
        rows.append(
            PlexSessionLog(
                session_key=str(sess.get("session_key") or "unknown")[:128],
                client_ip=clean_plex_client_ip(str(sess.get("client_ip") or ""))[:64],
                player_title=str(sess.get("player_title") or "")[:255],
                player_product=str(sess.get("player_product") or "")[:128],
                player_platform=str(sess.get("player_platform") or "")[:128],
                state=state[:32],
                user_name=str(sess.get("user_name") or "")[:128],
                media_title=str(sess.get("media_title") or "")[:512],
                media_type=str(sess.get("media_type") or "")[:64],
                stream_decision=str(sess.get("stream_decision") or "direct play")[:64],
                bandwidth_kbps=int(sess.get("bandwidth_kbps") or 0),
                duration_seconds=max(5, int(poll_interval_seconds)),
                recorded_at=ts,
            )
        )
    return rows


def aggregate_plex_usage_for_window(
    *,
    window: str,
    session_logs: list[PlexSessionLog],
    active_sessions: list[dict[str, Any]],
    history_records: list[dict[str, Any]],
    sqlite_devices: list[Device],
    target_ips: set[str] | None = None,
    fallback_plex_dict: dict[str, Any] | None = None,
    now_dt: datetime | None = None,
) -> dict[str, Any]:
    """Aggregate SQLite `PlexSessionLog` heartbeats, live `/status/sessions`, and `/history/all`
    into an enriched `application_usage` dictionary for `app_key="plex"` (`FB-P9-005`).
    """
    cutoff_dt = resolve_window_cutoff_datetime(window, now_dt=now_dt)

    # Per-device accumulator keyed by resolved IPv4 address (or synthetic player key)
    device_stats: dict[str, dict[str, Any]] = {}

    def _get_or_init_entry(
        *,
        ip_val: str | None,
        p_title: str | None,
        p_prod: str | None = None,
        p_plat: str | None = None,
    ) -> dict[str, Any] | None:
        matched_dev = match_plex_player_to_sqlite_device(
            client_ip=ip_val,
            player_title=p_title,
            player_product=p_prod,
            player_platform=p_plat,
            sqlite_devices=sqlite_devices,
        )
        resolved_ip = (
            matched_dev.ipv4_address
            if (matched_dev and matched_dev.ipv4_address)
            else clean_plex_client_ip(ip_val)
        )
        if not resolved_ip:
            resolved_ip = (p_title or "Plex Player").strip()
        if target_ips is not None and resolved_ip not in target_ips:
            return None

        if matched_dev is not None:
            dev_id: int | None = matched_dev.id
            eff_name = (
                (matched_dev.display_name or "").strip()
                or (matched_dev.hostname or "").strip()
                or resolved_ip
            )
        else:
            dev_id = None
            eff_name = (p_title or "").strip() or resolved_ip

        if resolved_ip not in device_stats:
            device_stats[resolved_ip] = {
                "device_id": dev_id,
                "ipv4_address": resolved_ip,
                "effective_name": eff_name,
                "heartbeat_seconds": 0,
                "history_minutes": 0,
                "event_count": 0,
                "bytes": 0,
                "last_active_dt": None,
            }
        return device_stats[resolved_ip]

    # 1. Accumulate verified SQLite heartbeat logs within window
    for log_row in session_logs:
        rec_dt = log_row.recorded_at
        if rec_dt.tzinfo is None:
            rec_dt = rec_dt.replace(tzinfo=UTC)
        if rec_dt < cutoff_dt:
            continue
        entry = _get_or_init_entry(
            ip_val=log_row.client_ip,
            p_title=log_row.player_title,
            p_prod=log_row.player_product,
            p_plat=log_row.player_platform,
        )
        if entry is None:
            continue
        dur_s = max(5, int(log_row.duration_seconds or 30))
        entry["heartbeat_seconds"] += dur_s
        entry["event_count"] += 1
        bw_kbps = max(0, int(log_row.bandwidth_kbps or 0))
        entry["bytes"] += int((bw_kbps * 1000 / 8) * dur_s)
        prev_dt = entry["last_active_dt"]
        if prev_dt is None or rec_dt > prev_dt:
            entry["last_active_dt"] = rec_dt

    # 2. Accumulate Plex playback history records within window
    for hist in history_records:
        v_dt = hist.get("viewed_at")
        if not isinstance(v_dt, datetime):
            continue
        if v_dt.tzinfo is None:
            v_dt = v_dt.replace(tzinfo=UTC)
        if v_dt < cutoff_dt:
            continue
        entry = _get_or_init_entry(
            ip_val=None,
            p_title=str(hist.get("player_title") or ""),
            p_plat=str(hist.get("player_platform") or ""),
        )
        if entry is None:
            continue
        entry["history_minutes"] += max(5, int(hist.get("duration_minutes") or 20))
        entry["event_count"] += 1
        prev_dt = entry["last_active_dt"]
        if prev_dt is None or v_dt > prev_dt:
            entry["last_active_dt"] = v_dt

    # 3. Process live active sessions (`Now Playing`)
    now_playing_items: list[PlexActiveSessionItem] = []
    current_dt = now_dt if now_dt is not None else datetime.now(UTC)
    for sess in active_sessions:
        matched_dev = match_plex_player_to_sqlite_device(
            client_ip=str(sess.get("client_ip") or ""),
            player_title=str(sess.get("player_title") or ""),
            player_product=str(sess.get("player_product") or ""),
            player_platform=str(sess.get("player_platform") or ""),
            sqlite_devices=sqlite_devices,
        )
        resolved_ip = (
            matched_dev.ipv4_address
            if (matched_dev and matched_dev.ipv4_address)
            else clean_plex_client_ip(str(sess.get("client_ip") or ""))
        )
        if target_ips is not None and resolved_ip not in target_ips:
            continue

        eff_name = (
            (
                (matched_dev.display_name or "").strip()
                or (matched_dev.hostname or "").strip()
            )
            if matched_dev
            else ""
        ) or str(sess.get("player_title") or resolved_ip or "Plex Player")

        now_playing_items.append(
            PlexActiveSessionItem(
                session_key=str(sess.get("session_key") or "live"),
                client_ip=resolved_ip or str(sess.get("client_ip") or ""),
                device_id=matched_dev.id if matched_dev else None,
                effective_name=eff_name,
                player_title=str(sess.get("player_title") or eff_name),
                player_product=str(sess.get("player_product") or ""),
                player_platform=str(sess.get("player_platform") or ""),
                state=str(sess.get("state") or "playing"),
                user_name=str(sess.get("user_name") or ""),
                media_title=str(sess.get("media_title") or "Unknown Media"),
                media_type=str(sess.get("media_type") or ""),
                stream_decision=str(sess.get("stream_decision") or "direct play"),
                bandwidth_kbps=int(sess.get("bandwidth_kbps") or 0),
                progress_percent=float(sess.get("progress_percent") or 0.0),
            )
        )

        entry = _get_or_init_entry(
            ip_val=resolved_ip,
            p_title=str(sess.get("player_title") or ""),
            p_prod=str(sess.get("player_product") or ""),
            p_plat=str(sess.get("player_platform") or ""),
        )
        if entry is not None:
            entry["event_count"] = max(1, int(entry["event_count"]))
            if entry["heartbeat_seconds"] == 0 and entry["history_minutes"] == 0:
                entry["heartbeat_seconds"] = 300
            prev_dt = entry["last_active_dt"]
            if prev_dt is None or current_dt > prev_dt:
                entry["last_active_dt"] = current_dt

    # 4. Compute final per-device active minutes & top devices
    top_devices_list: list[dict[str, Any]] = []
    total_active_minutes = 0
    total_events = 0
    total_bytes = 0
    latest_overall_dt: datetime | None = None

    for stats in device_stats.values():
        hb_mins = (
            max(1, round(stats["heartbeat_seconds"] / 60.0))
            if stats["heartbeat_seconds"] > 0
            else 0
        )
        hist_mins = int(stats["history_minutes"] or 0)
        dev_minutes = max(hb_mins, hist_mins)
        if dev_minutes <= 0:
            continue

        total_active_minutes += dev_minutes
        total_events += int(stats["event_count"] or 0)
        total_bytes += int(stats["bytes"] or 0)
        last_dt = stats["last_active_dt"]
        if isinstance(last_dt, datetime) and (
            latest_overall_dt is None or last_dt > latest_overall_dt
        ):
            latest_overall_dt = last_dt

        top_devices_list.append(
            {
                "device_id": stats["device_id"],
                "ipv4_address": stats["ipv4_address"],
                "effective_name": stats["effective_name"],
                "active_minutes": dev_minutes,
                "event_count": int(stats["event_count"] or 0),
                "dns_queries": 0,
                "bytes": int(stats["bytes"] or 0),
            }
        )

    top_devices_list.sort(
        key=lambda d: (d["active_minutes"], d["event_count"], d["bytes"]),
        reverse=True,
    )

    if not top_devices_list and not now_playing_items and fallback_plex_dict:
        return {
            **fallback_plex_dict,
            "active_sessions": [],
        }

    return {
        "app_key": "plex",
        "display_name": "Plex",
        "active_minutes": total_active_minutes,
        "event_count": total_events,
        "dns_queries": int((fallback_plex_dict or {}).get("dns_queries") or 0),
        "bytes": max(total_bytes, int((fallback_plex_dict or {}).get("bytes") or 0)),
        "last_active_at": (
            latest_overall_dt.isoformat()
            if latest_overall_dt is not None
            else (fallback_plex_dict or {}).get("last_active_at")
        ),
        "top_devices": top_devices_list[:3],
        "active_sessions": [s.model_dump() for s in now_playing_items],
    }


async def poll_and_record_plex_sessions(
    db: AsyncSession,
    settings: Settings,
    plex_client: PlexServiceClient | None = None,
    *,
    poll_interval_seconds: int = 30,
) -> int:
    """Poll Plex `/status/sessions`, record `playing` heartbeats into SQLite `plex_session_logs`,
    and prune logs older than 35 days (`FB-P9-005`).
    """
    effective = apply_runtime_overrides(settings)
    client = plex_client or PlexServiceClient(effective)
    if not client.is_configured:
        return 0

    active_sessions = await client.fetch_active_sessions()
    _plex_live_cache["active_sessions"] = (
        time.monotonic() + _PLEX_CACHE_TTL_SECONDS,
        active_sessions,
    )

    rows = prepare_plex_session_log_rows(
        active_sessions,
        poll_interval_seconds=poll_interval_seconds,
    )
    for row in rows:
        db.add(row)

    prune_cutoff = utc_now() - timedelta(days=35)
    await db.execute(
        delete(PlexSessionLog).where(PlexSessionLog.recorded_at < prune_cutoff)
    )
    await db.commit()
    return len(rows)


async def fetch_plex_telemetry_for_analytics(
    db: AsyncSession,
    settings: Settings,
    *,
    window: str,
    sqlite_devices: list[Device],
    target_ips: set[str] | None = None,
    fallback_plex_dict: dict[str, Any] | None = None,
    refresh: bool = False,
    plex_client: PlexServiceClient | None = None,
) -> dict[str, Any] | None:
    """Fetch SQLite `PlexSessionLog` rows + live Plex API sessions/history and return enriched
    Plex `application_usage` dictionary (`FB-P9-005`).
    """
    effective = apply_runtime_overrides(settings)
    client = plex_client or PlexServiceClient(effective)

    cutoff_dt = resolve_window_cutoff_datetime(window)
    stmt = select(PlexSessionLog).where(PlexSessionLog.recorded_at >= cutoff_dt)
    session_logs = list((await db.execute(stmt)).scalars().all())

    if not client.is_configured and not session_logs:
        return None

    active_sessions: list[dict[str, Any]] = []
    history_records: list[dict[str, Any]] = []

    if client.is_configured:
        now_m = time.monotonic()
        cached_sess = _plex_live_cache.get("active_sessions")
        if not refresh and cached_sess and now_m < cached_sess[0]:
            active_sessions = list(cached_sess[1])
        else:
            try:
                active_sessions = await client.fetch_active_sessions()
                _plex_live_cache["active_sessions"] = (
                    now_m + _PLEX_CACHE_TTL_SECONDS,
                    active_sessions,
                )
            except PlexQueryError:
                active_sessions = []

        cached_hist = _plex_live_cache.get("history_records")
        if not refresh and cached_hist and now_m < cached_hist[0]:
            history_records = list(cached_hist[1])
        else:
            try:
                history_records = await client.fetch_playback_history(limit=200)
                _plex_live_cache["history_records"] = (
                    now_m + 120.0,
                    history_records,
                )
            except PlexQueryError:
                history_records = []

    return aggregate_plex_usage_for_window(
        window=window,
        session_logs=session_logs,
        active_sessions=active_sessions,
        history_records=history_records,
        sqlite_devices=sqlite_devices,
        target_ips=target_ips,
        fallback_plex_dict=fallback_plex_dict,
    )
