"""Async Elasticsearch 9.4.3 client wrapper targeting logs-pfsense.log* (pfSense 1.25.4)."""

from __future__ import annotations

import ipaddress
import re
import time
from datetime import datetime
from typing import Any

from elastic_transport import TransportError
from elasticsearch import AsyncElasticsearch, AuthenticationException, AuthorizationException

from app.clients.opnsense import ServiceHealthStatus, validate_ipv4_address
from app.config import Settings

RFC1918_CIDRS: list[str] = ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]

NON_PUBLIC_WAN_CIDRS: list[str] = [
    "192.168.0.0/16",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "0.0.0.0/8",
    "224.0.0.0/4",
    "255.255.255.255/32",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
    "::/128",
    "::1/128",
]

TIME_WINDOW_CONFIG: dict[str, dict[str, str]] = {
    "today": {"es_gte": "now/d", "interval": "1h", "label": "Today"},
    "1h": {"es_gte": "now-1h", "interval": "5m", "label": "Last 1 Hour"},
    "24h": {"es_gte": "now-24h", "interval": "1h", "label": "Last 24 Hours"},
    "7d": {"es_gte": "now-7d", "interval": "6h", "label": "Last 7 Days"},
    "30d": {"es_gte": "now-30d", "interval": "1d", "label": "Last 30 Days"},
}

_SAFE_DOMAIN_SEARCH_RE = re.compile(r"[^a-zA-Z0-9._-]")
_SAFE_FIREWALL_SEARCH_RE = re.compile(r"[^a-zA-Z0-9._:/-]")


class ElasticsearchQueryError(Exception):
    """Raised when an Elasticsearch analytics query fails."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def resolve_time_window(window: str | None) -> tuple[str, str, str]:
    """Validate and return (normalized_window_key, es_gte_expr, fixed_interval)."""
    cleaned = (window or "24h").strip().lower()
    if cleaned not in TIME_WINDOW_CONFIG:
        raise ValueError(
            f"Unsupported time window '{window}'. Allowed: {', '.join(TIME_WINDOW_CONFIG)}"
        )
    cfg = TIME_WINDOW_CONFIG[cleaned]
    return cleaned, cfg["es_gte"], cfg["interval"]


def _round_es_gte(es_gte: str) -> str:
    """Round relative ES date math to `/m` for shard cache reuse, preserving `/d`."""
    if es_gte.endswith(("/m", "/d", "/h")):
        return es_gte
    return f"{es_gte}/m"


def _build_timestamp_range_filter(
    es_gte: str,
    tz_name: str = "UTC",
    *,
    round_to_minute: bool = False,
) -> dict[str, Any]:
    """Construct an Elasticsearch `@timestamp` range filter (with `time_zone` for `now/d`)."""
    target_gte = _round_es_gte(es_gte) if round_to_minute else es_gte
    safe_tz = (tz_name or "UTC").strip() or "UTC"
    if target_gte == "now/d":
        return {"range": {"@timestamp": {"gte": target_gte, "time_zone": safe_tz}}}
    return {"range": {"@timestamp": {"gte": target_gte}}}


def sanitize_domain_search(raw_search: str | None) -> str | None:
    """Sanitize a user-supplied domain substring for safe wildcard querying."""
    if not raw_search:
        return None
    cleaned = _SAFE_DOMAIN_SEARCH_RE.sub("", raw_search.strip().lower())
    if not cleaned:
        return None
    return cleaned[:120]


def sanitize_firewall_search(raw_search: str | None) -> str | None:
    """Sanitize a user-supplied firewall log search string (IP, port, interface, protocol)."""
    if not raw_search:
        return None
    cleaned = _SAFE_FIREWALL_SEARCH_RE.sub("", raw_search.strip().lower())
    if not cleaned:
        return None
    return cleaned[:120]


def is_private_lan_ip(raw_ip: str | None) -> bool:
    """Return True if `raw_ip` is a unicast RFC1918/private/loopback/link-local address."""
    if not raw_ip:
        return False
    try:
        ip_obj = ipaddress.ip_address(raw_ip.strip())
    except ValueError:
        return False
    if ip_obj.is_unspecified or ip_obj.is_multicast or str(ip_obj) == "255.255.255.255":
        return False
    return bool(ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local)


def validate_ipv4_list(ipv4_addresses: list[str]) -> list[str]:
    """Validate and deduplicate a list of IPv4 strings while preserving order."""
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw_ip in ipv4_addresses:
        if not raw_ip or not str(raw_ip).strip():
            continue
        valid_ip = validate_ipv4_address(raw_ip)
        if valid_ip not in seen:
            seen.add(valid_ip)
            cleaned.append(valid_ip)
    if not cleaned:
        raise ValueError("At least one valid IPv4 address is required for group analytics.")
    return cleaned


_PLEX_SERVER_NOISE_DOMAINS: list[str] = [
    "pubsub.plex.tv",
]

_PLEX_PLAYBACK_SIGNAL_DOMAINS: list[str] = [
    "analytics.plex.tv",
    "discover.provider.plex.tv",
    "luma.plex.tv",
    "images.plex.tv",
    "watch.plex.tv",
    "scrobbles.plex.tv",
    "metadata.provider.plex.tv",
    "app.plex.tv",
    "clients.plex.tv",
    "api.plex.tv",
    "www.plex.tv",
]

_YOUTUBE_BACKGROUND_NOISE_DOMAINS: list[str] = [
    "googlevideo.com",
    "youtube-nocookie.com",
    "youtubei.googleapis.com",
    "accounts.youtube.com",
    "youtube.googleapis.com",
]


def _build_app_usage_agg(
    safe_tz: str,
    excluded_ips: list[str] | None = None,
) -> dict[str, Any]:
    """Build Elasticsearch filters aggregation for YouTube and Plex 5-minute active windows."""
    common_must_not: list[dict[str, Any]] = [
        {"term": {"event.action": "block"}},
    ]
    clean_excluded = [ip.strip() for ip in (excluded_ips or []) if ip and ip.strip()]
    if clean_excluded:
        common_must_not.append({"terms": {"source.ip": clean_excluded}})

    youtube_must_not = [
        *common_must_not,
        {"terms": {"dns.question.name": _YOUTUBE_BACKGROUND_NOISE_DOMAINS}},
    ]

    plex_must_not = [
        *common_must_not,
        {"terms": {"dns.question.name": _PLEX_SERVER_NOISE_DOMAINS}},
    ]

    return {
        "filters": {
            "filters": {
                "youtube": {
                    "bool": {
                        "must_not": youtube_must_not,
                        "should": [
                            {
                                "terms": {
                                    "dns.question.registered_domain": [
                                        "youtube.com",
                                        "youtu.be",
                                        "googlevideo.com",
                                        "ytimg.com",
                                    ]
                                }
                            },
                            {
                                "terms": {
                                    "dns.question.name": [
                                        "youtubei.googleapis.com",
                                        "www.youtube.com",
                                        "m.youtube.com",
                                    ]
                                }
                            },
                        ],
                        "minimum_should_match": 1,
                    }
                },
                "plex": {
                    "bool": {
                        "must_not": plex_must_not,
                        "should": [
                            {"term": {"destination.port": 32400}},
                            {
                                "terms": {
                                    "dns.question.registered_domain": [
                                        "plex.tv",
                                        "plex.direct",
                                        "plex.bz",
                                        "plexapp.com",
                                    ]
                                }
                            },
                        ],
                        "minimum_should_match": 1,
                    }
                },
            }
        },
        "aggs": {
            "active_slots": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": "5m",
                    "min_doc_count": 1,
                }
            },
            "bytes": {"sum": {"field": "network.bytes"}},
            "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
            "last_active": {"max": {"field": "@timestamp"}},
            "by_device": {
                "filter": {"terms": {"source.ip": RFC1918_CIDRS}},
                "aggs": {
                    "devices": {
                        "terms": {"field": "source.ip", "size": 15},
                        "aggs": {
                            "active_slots": {
                                "date_histogram": {
                                    "field": "@timestamp",
                                    "fixed_interval": "5m",
                                    "min_doc_count": 1,
                                }
                            },
                            "port_32400": {
                                "filter": {"term": {"destination.port": 32400}}
                            },
                            "server_registrations": {
                                "filter": {
                                    "term": {"dns.question.name": "servers.plex.tv"}
                                }
                            },
                            "playback_signals": {
                                "filter": {
                                    "terms": {
                                        "dns.question.name": _PLEX_PLAYBACK_SIGNAL_DOMAINS
                                    }
                                }
                            },
                            "bytes": {"sum": {"field": "network.bytes"}},
                            "dns_queries": {
                                "filter": {"term": {"event.provider": "unbound"}}
                            },
                            "last_active": {"max": {"field": "@timestamp"}},
                        },
                    }
                },
            },
        },
    }


def _extract_app_usage(aggs: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract YouTube/Plex active usage (`active_minutes`), queries, bytes, and top 3 devices."""
    buckets = ((aggs.get("app_usage") or {}).get("buckets")) or {}
    items: list[dict[str, Any]] = []
    for app_key, display_name in (("youtube", "YouTube"), ("plex", "Plex")):
        b = buckets.get(app_key) if isinstance(buckets, dict) else {}
        if not isinstance(b, dict):
            b = {}
        event_count = int(b.get("doc_count") or 0)
        dns_queries = int((b.get("dns_queries") or {}).get("doc_count") or 0)
        bytes_val = int(float((b.get("bytes") or {}).get("value") or 0))
        last_active_at = (b.get("last_active") or {}).get("value_as_string")

        min_slot_docs = 5 if app_key == "youtube" else 1

        device_buckets = (
            ((b.get("by_device") or {}).get("devices") or {}).get("buckets")
        ) or []
        top_devices: list[dict[str, Any]] = []
        active_slot_keys: set[str] = set()

        if device_buckets:
            for db in device_buckets:
                ip_str = str(db.get("key") or "").strip()
                if not ip_str or not is_private_lan_ip(ip_str):
                    continue
                dev_events = int(db.get("doc_count") or 0)
                dev_dns = int((db.get("dns_queries") or {}).get("doc_count") or 0)
                dev_bytes = int(float((db.get("bytes") or {}).get("value") or 0))
                dev_port_32400 = int(
                    (db.get("port_32400") or {}).get("doc_count") or 0
                )
                dev_server_reg = int(
                    (db.get("server_registrations") or {}).get("doc_count") or 0
                )
                dev_playback_sig = int(
                    (db.get("playback_signals") or {}).get("doc_count") or 0
                )
                dev_slot_buckets = (
                    (db.get("active_slots") or {}).get("buckets")
                ) or []
                valid_slots = [
                    sb
                    for sb in dev_slot_buckets
                    if int(sb.get("doc_count") or 0) >= min_slot_docs
                ]
                dev_active_slots = len(valid_slots)

                # Ignore Plex Media Server hosts (which register via servers.plex.tv),
                # 24/7 automated DNS health pollers on Plex, and router filterdns on YouTube
                if app_key == "plex" and (
                    dev_server_reg > 0
                    or (
                        dev_active_slots >= 140
                        and dev_port_32400 == 0
                        and dev_bytes == 0
                        and (dev_playback_sig * 20 < dev_events)
                    )
                ):
                    continue
                if (
                    app_key == "youtube"
                    and dev_active_slots >= 140
                    and dev_bytes == 0
                    and ip_str.endswith(".1")
                ):
                    continue

                if dev_active_slots <= 0:
                    continue

                for idx, sb in enumerate(valid_slots):
                    slot_key = str(
                        sb.get("key_as_string") or sb.get("key") or f"{ip_str}:{idx}"
                    )
                    active_slot_keys.add(slot_key)

                dev_active_minutes = dev_active_slots * 5
                top_devices.append(
                    {
                        "ipv4_address": ip_str,
                        "effective_name": ip_str,
                        "active_minutes": dev_active_minutes,
                        "event_count": dev_events,
                        "dns_queries": dev_dns,
                        "bytes": dev_bytes,
                    }
                )

            top_devices.sort(
                key=lambda d: (
                    int(d["active_minutes"]),
                    int(d["bytes"]),
                    int(d["event_count"]),
                ),
                reverse=True,
            )
            active_minutes = len(active_slot_keys) * 5
        else:
            slot_buckets = ((b.get("active_slots") or {}).get("buckets")) or []
            active_slots = sum(
                1
                for sb in slot_buckets
                if int(sb.get("doc_count") or 0) >= min_slot_docs
            )
            active_minutes = active_slots * 5

        items.append(
            {
                "app_key": app_key,
                "display_name": display_name,
                "active_minutes": active_minutes,
                "event_count": event_count,
                "dns_queries": dns_queries,
                "bytes": bytes_val,
                "last_active_at": last_active_at,
                "top_devices": top_devices[:3],
            }
        )
    return items


def build_network_overview_query(
    window: str = "24h",
    tz_name: str = "UTC",
    top_n: int = 10,
    excluded_ips: list[str] | None = None,
) -> dict[str, Any]:
    """Construct the Elasticsearch aggregation DSL for network-wide traffic and DNS overview."""
    _, es_gte, interval = resolve_time_window(window)
    safe_tz = (tz_name or "UTC").strip() or "UTC"
    capped_top_n = max(1, min(int(top_n), 50))

    return {
        "size": 0,
        "track_total_hits": False,
        "query": _build_timestamp_range_filter(es_gte, safe_tz),
        "aggs": {
            "total_bytes": {"sum": {"field": "network.bytes"}},
            "app_usage": _build_app_usage_agg(safe_tz, excluded_ips=excluded_ips),
            "by_provider": {"terms": {"field": "event.provider", "size": 10}},
            "by_action": {"terms": {"field": "event.action", "size": 10}},
            "timeline": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": interval,
                    "time_zone": safe_tz,
                    "min_doc_count": 0,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                    "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                    "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                },
            },
            "lan_devices": {
                "filter": {
                    "terms": {
                        "source.ip": RFC1918_CIDRS,
                    }
                },
                "aggs": {
                    "top_ips": {
                        "terms": {"field": "source.ip", "size": capped_top_n},
                        "aggs": {
                            "bytes": {"sum": {"field": "network.bytes"}},
                            "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                            "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                            "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                            "last_seen": {"max": {"field": "@timestamp"}},
                        },
                    }
                },
            },
            "unbound_dns": {
                "filter": {"term": {"event.provider": "unbound"}},
                "aggs": {
                    "top_domains": {
                        "terms": {"field": "dns.question.name", "size": capped_top_n}
                    },
                    "top_registered_domains": {
                        "terms": {"field": "dns.question.registered_domain", "size": capped_top_n}
                    },
                },
            },
            "filterlog_orgs": {
                "filter": {"term": {"event.provider": "filterlog"}},
                "aggs": {
                    "top_asn_orgs": {
                        "terms": {
                            "field": "destination.as.organization.name",
                            "size": capped_top_n,
                        },
                        "aggs": {
                            "bytes": {"sum": {"field": "network.bytes"}},
                        },
                    }
                },
            },
        },
    }


def _extract_bucket_map(buckets: list[dict[str, Any]]) -> dict[str, int]:
    """Convert Elasticsearch terms buckets into a {key: doc_count} dictionary."""
    result: dict[str, int] = {}
    for b in buckets:
        key = str(b.get("key", "")).strip()
        if key:
            result[key] = int(b.get("doc_count", 0))
    return result


def _normalize_timeline_buckets(buckets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize date_histogram buckets into a uniform timeline list."""
    series: list[dict[str, Any]] = []
    for b in buckets:
        ts_str = str(b.get("key_as_string") or b.get("key") or "")
        bytes_val = int(float((b.get("bytes") or {}).get("value") or 0))
        dns_count = int((b.get("dns_queries") or {}).get("doc_count") or 0)
        allowed_count = int((b.get("allowed_packets") or {}).get("doc_count") or 0)
        blocked_count = int((b.get("blocked_packets") or {}).get("doc_count") or 0)
        total_events = int(b.get("doc_count") or 0)
        series.append(
            {
                "timestamp": ts_str,
                "total_events": total_events,
                "bytes": bytes_val,
                "dns_queries": dns_count,
                "allowed_packets": allowed_count,
                "blocked_packets": blocked_count,
            }
        )
    return series


def normalize_network_overview_response(
    raw: dict[str, Any],
    window: str = "24h",
) -> dict[str, Any]:
    """Normalize raw Elasticsearch aggregation output for network overview."""
    aggs = raw.get("aggregations") or {}
    hits_total_obj = (raw.get("hits") or {}).get("total")
    if isinstance(hits_total_obj, dict):
        hits_total = int(hits_total_obj.get("value") or 0)
    else:
        hits_total = int(hits_total_obj or 0)

    total_bytes = int(float((aggs.get("total_bytes") or {}).get("value") or 0))
    provider_counts = _extract_bucket_map((aggs.get("by_provider") or {}).get("buckets") or [])
    action_counts = _extract_bucket_map((aggs.get("by_action") or {}).get("buckets") or [])

    timeline_buckets = (aggs.get("timeline") or {}).get("buckets") or []
    timeline = _normalize_timeline_buckets(timeline_buckets)
    timeline_total = sum(int(b.get("total_events") or 0) for b in timeline)
    provider_total = sum(provider_counts.values())
    total_events = max(hits_total, timeline_total, provider_total)

    lan_ip_buckets = (
        ((aggs.get("lan_devices") or {}).get("top_ips") or {}).get("buckets") or []
    )
    top_devices_by_ip: list[dict[str, Any]] = []
    for b in lan_ip_buckets:
        ip_str = str(b.get("key") or "").strip()
        if not ip_str or not is_private_lan_ip(ip_str):
            continue
        last_seen_str = (b.get("last_seen") or {}).get("value_as_string")
        top_devices_by_ip.append(
            {
                "ipv4_address": ip_str,
                "total_events": int(b.get("doc_count") or 0),
                "bytes": int(float((b.get("bytes") or {}).get("value") or 0)),
                "dns_queries": int((b.get("dns_queries") or {}).get("doc_count") or 0),
                "allowed_packets": int((b.get("allowed_packets") or {}).get("doc_count") or 0),
                "blocked_packets": int((b.get("blocked_packets") or {}).get("doc_count") or 0),
                "last_seen_at": last_seen_str,
            }
        )

    unbound_agg = aggs.get("unbound_dns") or {}
    top_domains = [
        {"domain": str(b.get("key")), "query_count": int(b.get("doc_count") or 0)}
        for b in (unbound_agg.get("top_domains") or {}).get("buckets") or []
        if b.get("key")
    ]
    top_registered_domains = [
        {"domain": str(b.get("key")), "query_count": int(b.get("doc_count") or 0)}
        for b in (unbound_agg.get("top_registered_domains") or {}).get("buckets") or []
        if b.get("key")
    ]

    org_buckets = (
        ((aggs.get("filterlog_orgs") or {}).get("top_asn_orgs") or {}).get("buckets") or []
    )
    top_organizations = [
        {
            "organization": str(b.get("key")),
            "packet_count": int(b.get("doc_count") or 0),
            "bytes": int(float((b.get("bytes") or {}).get("value") or 0)),
        }
        for b in org_buckets
        if b.get("key")
    ]

    return {
        "window": window,
        "summary": {
            "total_events": total_events,
            "total_bytes": total_bytes,
            "dns_query_count": provider_counts.get("unbound", 0),
            "firewall_event_count": provider_counts.get("filterlog", 0),
            "allowed_packet_count": action_counts.get("pass", 0),
            "blocked_packet_count": action_counts.get("block", 0),
        },
        "timeline": timeline,
        "top_devices": top_devices_by_ip,
        "top_domains": top_domains,
        "top_registered_domains": top_registered_domains,
        "top_organizations": top_organizations,
        "application_usage": _extract_app_usage(aggs),
    }


def build_device_analytics_query(
    ipv4_address: str,
    window: str = "24h",
    tz_name: str = "UTC",
    top_n: int = 15,
) -> dict[str, Any]:
    """Construct the Elasticsearch aggregation DSL for a single device's usage & access time."""
    clean_ip = validate_ipv4_address(ipv4_address)
    _, es_gte, interval = resolve_time_window(window)
    safe_tz = (tz_name or "UTC").strip() or "UTC"
    capped_top_n = max(1, min(int(top_n), 50))

    return {
        "size": 0,
        "track_total_hits": False,
        "query": {
            "bool": {
                "filter": [
                    _build_timestamp_range_filter(es_gte, safe_tz),
                    {
                        "bool": {
                            "should": [
                                {"term": {"source.ip": clean_ip}},
                                {"term": {"destination.ip": clean_ip}},
                                {"term": {"client.ip": clean_ip}},
                            ],
                            "minimum_should_match": 1,
                        }
                    },
                ]
            }
        },
        "aggs": {
            "total_bytes": {"sum": {"field": "network.bytes"}},
            "app_usage": _build_app_usage_agg(safe_tz),
            "by_provider": {"terms": {"field": "event.provider", "size": 10}},
            "by_action": {"terms": {"field": "event.action", "size": 10}},
            "first_activity": {"min": {"field": "@timestamp"}},
            "last_activity": {"max": {"field": "@timestamp"}},
            "timeline": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": interval,
                    "time_zone": safe_tz,
                    "min_doc_count": 0,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                    "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                    "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                },
            },
            "hourly_profile": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": "1h",
                    "time_zone": safe_tz,
                    "min_doc_count": 1,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                },
            },
            "unbound_dns": {
                "filter": {"term": {"event.provider": "unbound"}},
                "aggs": {
                    "top_domains": {
                        "terms": {"field": "dns.question.name", "size": capped_top_n}
                    },
                    "top_registered_domains": {
                        "terms": {"field": "dns.question.registered_domain", "size": capped_top_n}
                    },
                },
            },
            "filterlog_orgs": {
                "filter": {"term": {"event.provider": "filterlog"}},
                "aggs": {
                    "top_asn_orgs": {
                        "terms": {
                            "field": "destination.as.organization.name",
                            "size": capped_top_n,
                        },
                        "aggs": {
                            "bytes": {"sum": {"field": "network.bytes"}},
                        },
                    }
                },
            },
        },
    }


def build_device_recent_domains_query(
    ipv4_address: str,
    window: str = "24h",
    domain_search: str | None = None,
    limit: int = 40,
    tz_name: str = "UTC",
) -> dict[str, Any]:
    """Construct the Elasticsearch search query for chronological recent DNS queries by a device."""
    clean_ip = validate_ipv4_address(ipv4_address)
    _, es_gte, _ = resolve_time_window(window)
    safe_limit = max(1, min(int(limit), 100))
    safe_search = sanitize_domain_search(domain_search)

    filters: list[dict[str, Any]] = [
        _build_timestamp_range_filter(es_gte, tz_name),
        {"term": {"event.provider": "unbound"}},
        {
            "bool": {
                "should": [
                    {"term": {"source.ip": clean_ip}},
                    {"term": {"client.ip": clean_ip}},
                ],
                "minimum_should_match": 1,
            }
        },
    ]
    if safe_search:
        filters.append(
            {
                "wildcard": {
                    "dns.question.name": {
                        "value": f"*{safe_search}*",
                        "case_insensitive": True,
                    }
                }
            }
        )

    return {
        "size": safe_limit,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "_source": [
            "@timestamp",
            "dns.question.name",
            "dns.question.registered_domain",
            "dns.question.type",
            "source.ip",
        ],
        "query": {"bool": {"filter": filters}},
    }


def _compute_24h_access_profile(hourly_buckets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate 1-hour date_histogram buckets into a 24-hour (00:00..23:00) access distribution."""
    hours: dict[int, dict[str, int]] = {
        h: {"total_events": 0, "dns_queries": 0, "bytes": 0, "active_Windows": 0}
        for h in range(24)
    }

    for b in hourly_buckets:
        doc_count = int(b.get("doc_count") or 0)
        if doc_count <= 0:
            continue
        key_str = str(b.get("key_as_string") or "")
        hour_idx = 0
        try:
            dt = datetime.fromisoformat(key_str.replace("Z", "+00:00"))
            hour_idx = dt.hour
        except ValueError:
            # Fallback if key_as_string has unexpected format
            if "T" in key_str and len(key_str.split("T")[1]) >= 2:
                try:
                    hour_idx = int(key_str.split("T")[1][:2]) % 24
                except ValueError:
                    hour_idx = 0

        slot = hours[hour_idx]
        slot["total_events"] += doc_count
        slot["dns_queries"] += int((b.get("dns_queries") or {}).get("doc_count") or 0)
        slot["bytes"] += int(float((b.get("bytes") or {}).get("value") or 0))
        slot["active_Windows"] += 1

    return [
        {
            "hour": h,
            "label": f"{h:02d}:00",
            "total_events": hours[h]["total_events"],
            "dns_queries": hours[h]["dns_queries"],
            "bytes": hours[h]["bytes"],
            "active_hours_count": hours[h]["active_Windows"],
        }
        for h in range(24)
    ]


def normalize_device_analytics_response(
    raw_aggs_resp: dict[str, Any],
    raw_recent_resp: dict[str, Any],
    window: str = "24h",
) -> dict[str, Any]:
    """Normalize per-device aggregation and recent DNS query responses into a clean structure."""
    aggs = raw_aggs_resp.get("aggregations") or {}
    hits_total_obj = (raw_aggs_resp.get("hits") or {}).get("total")
    if isinstance(hits_total_obj, dict):
        hits_total = int(hits_total_obj.get("value") or 0)
    else:
        hits_total = int(hits_total_obj or 0)

    total_bytes = int(float((aggs.get("total_bytes") or {}).get("value") or 0))
    provider_counts = _extract_bucket_map((aggs.get("by_provider") or {}).get("buckets") or [])
    action_counts = _extract_bucket_map((aggs.get("by_action") or {}).get("buckets") or [])

    first_active_at = (aggs.get("first_activity") or {}).get("value_as_string")
    last_active_at = (aggs.get("last_activity") or {}).get("value_as_string")

    timeline_buckets = (aggs.get("timeline") or {}).get("buckets") or []
    timeline = _normalize_timeline_buckets(timeline_buckets)
    timeline_total = sum(int(b.get("total_events") or 0) for b in timeline)
    provider_total = sum(provider_counts.values())
    total_events = max(hits_total, timeline_total, provider_total)

    hourly_buckets = (aggs.get("hourly_profile") or {}).get("buckets") or []
    hourly_access_profile = _compute_24h_access_profile(hourly_buckets)
    active_hours = sum(1 for h in hourly_access_profile if h["total_events"] > 0)

    unbound_agg = aggs.get("unbound_dns") or {}
    top_domains = [
        {"domain": str(b.get("key")), "query_count": int(b.get("doc_count") or 0)}
        for b in (unbound_agg.get("top_domains") or {}).get("buckets") or []
        if b.get("key")
    ]
    top_registered_domains = [
        {"domain": str(b.get("key")), "query_count": int(b.get("doc_count") or 0)}
        for b in (unbound_agg.get("top_registered_domains") or {}).get("buckets") or []
        if b.get("key")
    ]

    org_buckets = (
        ((aggs.get("filterlog_orgs") or {}).get("top_asn_orgs") or {}).get("buckets") or []
    )
    top_organizations = [
        {
            "organization": str(b.get("key")),
            "packet_count": int(b.get("doc_count") or 0),
            "bytes": int(float((b.get("bytes") or {}).get("value") or 0)),
        }
        for b in org_buckets
        if b.get("key")
    ]

    recent_hits = ((raw_recent_resp.get("hits") or {}).get("hits")) or []
    recent_queries: list[dict[str, Any]] = []
    for hit in recent_hits:
        src = hit.get("_source") or {}
        dns_q = (src.get("dns") or {}).get("question") or {}
        domain_name = str(dns_q.get("name") or "").strip()
        if not domain_name:
            continue
        source_ip_raw = (
            (src.get("source") or {}).get("ip")
            or (src.get("client") or {}).get("ip")
            or ""
        )
        recent_queries.append(
            {
                "timestamp": str(src.get("@timestamp") or ""),
                "domain": domain_name,
                "registered_domain": dns_q.get("registered_domain"),
                "record_type": str(dns_q.get("type") or "A"),
                "source_ip": str(source_ip_raw).strip() or None,
            }
        )

    return {
        "window": window,
        "summary": {
            "total_events": total_events,
            "total_bytes": total_bytes,
            "dns_query_count": provider_counts.get("unbound", 0),
            "firewall_event_count": provider_counts.get("filterlog", 0),
            "allowed_packet_count": action_counts.get("pass", 0),
            "blocked_packet_count": action_counts.get("block", 0),
            "active_hours_in_day": active_hours,
            "first_active_at": first_active_at,
            "last_active_at": last_active_at,
        },
        "timeline": timeline,
        "hourly_access_profile": hourly_access_profile,
        "top_domains": top_domains,
        "top_registered_domains": top_registered_domains,
        "top_organizations": top_organizations,
        "application_usage": _extract_app_usage(aggs),
        "recent_queries": recent_queries,
    }


def build_group_analytics_query(
    ipv4_addresses: list[str],
    window: str = "24h",
    tz_name: str = "UTC",
    top_n: int = 15,
) -> dict[str, Any]:
    """Construct the multi-IP Elasticsearch aggregation DSL for a device group/profile."""
    clean_ips = validate_ipv4_list(ipv4_addresses)
    _, es_gte, interval = resolve_time_window(window)
    safe_tz = (tz_name or "UTC").strip() or "UTC"
    capped_top_n = max(1, min(int(top_n), 50))
    member_bucket_size = max(25, len(clean_ips) * 2)

    return {
        "size": 0,
        "track_total_hits": False,
        "query": {
            "bool": {
                "filter": [
                    _build_timestamp_range_filter(es_gte, safe_tz),
                    {
                        "bool": {
                            "should": [
                                {"terms": {"source.ip": clean_ips}},
                                {"terms": {"destination.ip": clean_ips}},
                                {"terms": {"client.ip": clean_ips}},
                            ],
                            "minimum_should_match": 1,
                        }
                    },
                ]
            }
        },
        "aggs": {
            "total_bytes": {"sum": {"field": "network.bytes"}},
            "app_usage": _build_app_usage_agg(safe_tz),
            "by_provider": {"terms": {"field": "event.provider", "size": 10}},
            "by_action": {"terms": {"field": "event.action", "size": 10}},
            "first_activity": {"min": {"field": "@timestamp"}},
            "last_activity": {"max": {"field": "@timestamp"}},
            "timeline": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": interval,
                    "time_zone": safe_tz,
                    "min_doc_count": 0,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                    "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                    "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                },
            },
            "hourly_profile": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": "1h",
                    "time_zone": safe_tz,
                    "min_doc_count": 1,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                },
            },
            "by_source_ip": {
                "terms": {"field": "source.ip", "size": member_bucket_size},
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "dns_queries": {"filter": {"term": {"event.provider": "unbound"}}},
                    "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                    "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                },
            },
            "by_destination_ip": {
                "terms": {"field": "destination.ip", "size": member_bucket_size},
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                    "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                },
            },
            "unbound_dns": {
                "filter": {"term": {"event.provider": "unbound"}},
                "aggs": {
                    "top_domains": {
                        "terms": {"field": "dns.question.name", "size": capped_top_n}
                    },
                    "top_registered_domains": {
                        "terms": {"field": "dns.question.registered_domain", "size": capped_top_n}
                    },
                },
            },
            "filterlog_orgs": {
                "filter": {"term": {"event.provider": "filterlog"}},
                "aggs": {
                    "top_asn_orgs": {
                        "terms": {
                            "field": "destination.as.organization.name",
                            "size": capped_top_n,
                        },
                        "aggs": {
                            "bytes": {"sum": {"field": "network.bytes"}},
                        },
                    }
                },
            },
        },
    }


def build_group_recent_domains_query(
    ipv4_addresses: list[str],
    window: str = "24h",
    domain_search: str | None = None,
    limit: int = 40,
    tz_name: str = "UTC",
) -> dict[str, Any]:
    """Construct the ES search query for chronological recent DNS queries across a group."""
    clean_ips = validate_ipv4_list(ipv4_addresses)
    _, es_gte, _ = resolve_time_window(window)
    safe_limit = max(1, min(int(limit), 100))
    safe_search = sanitize_domain_search(domain_search)

    filters: list[dict[str, Any]] = [
        _build_timestamp_range_filter(es_gte, tz_name),
        {"term": {"event.provider": "unbound"}},
        {
            "bool": {
                "should": [
                    {"terms": {"source.ip": clean_ips}},
                    {"terms": {"client.ip": clean_ips}},
                ],
                "minimum_should_match": 1,
            }
        },
    ]
    if safe_search:
        filters.append(
            {
                "wildcard": {
                    "dns.question.name": {
                        "value": f"*{safe_search}*",
                        "case_insensitive": True,
                    }
                }
            }
        )

    return {
        "size": safe_limit,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "_source": [
            "@timestamp",
            "dns.question.name",
            "dns.question.registered_domain",
            "dns.question.type",
            "source.ip",
            "client.ip",
        ],
        "query": {"bool": {"filter": filters}},
    }


def normalize_group_analytics_response(
    raw_aggs_resp: dict[str, Any],
    raw_recent_resp: dict[str, Any],
    member_ips: list[str],
    window: str = "24h",
) -> dict[str, Any]:
    """Normalize multi-IP group analytics and per-member IP traffic/DNS breakdown."""
    base = normalize_device_analytics_response(
        raw_aggs_resp,
        raw_recent_resp,
        window=window,
    )
    clean_ips = validate_ipv4_list(member_ips)
    member_set = set(clean_ips)

    per_ip: dict[str, dict[str, int]] = {
        ip: {
            "total_events": 0,
            "bytes": 0,
            "dns_query_count": 0,
            "allowed_packet_count": 0,
            "blocked_packet_count": 0,
        }
        for ip in clean_ips
    }

    aggs = raw_aggs_resp.get("aggregations") or {}
    for b in (aggs.get("by_source_ip") or {}).get("buckets") or []:
        ip_key = str(b.get("key") or "")
        if ip_key not in member_set:
            continue
        entry = per_ip[ip_key]
        entry["total_events"] += int(b.get("doc_count") or 0)
        entry["bytes"] += int(float((b.get("bytes") or {}).get("value") or 0))
        entry["dns_query_count"] += int((b.get("dns_queries") or {}).get("doc_count") or 0)
        entry["allowed_packet_count"] += int(
            (b.get("allowed_packets") or {}).get("doc_count") or 0
        )
        entry["blocked_packet_count"] += int(
            (b.get("blocked_packets") or {}).get("doc_count") or 0
        )

    for b in (aggs.get("by_destination_ip") or {}).get("buckets") or []:
        ip_key = str(b.get("key") or "")
        if ip_key not in member_set:
            continue
        entry = per_ip[ip_key]
        entry["total_events"] += int(b.get("doc_count") or 0)
        entry["bytes"] += int(float((b.get("bytes") or {}).get("value") or 0))
        entry["allowed_packet_count"] += int(
            (b.get("allowed_packets") or {}).get("doc_count") or 0
        )
        entry["blocked_packet_count"] += int(
            (b.get("blocked_packets") or {}).get("doc_count") or 0
        )

    base["member_ip_breakdown"] = [
        {
            "ip": ip,
            **stats,
        }
        for ip, stats in sorted(
            per_ip.items(),
            key=lambda kv: (kv[1]["bytes"], kv[1]["total_events"]),
            reverse=True,
        )
    ]
    return base


def build_firewall_overview_query(
    window: str = "24h",
    tz_name: str = "UTC",
    *,
    action: str | None = None,
    direction: str | None = None,
    protocol: str | None = None,
    search: str | None = None,
    recent_limit: int = 80,
) -> dict[str, Any]:
    """Construct the Elasticsearch DSL for the Phase 10 Firewall & Security
    overview (`FB-P10-001`).
    """
    _, es_gte, interval = resolve_time_window(window)
    safe_tz = (tz_name or "UTC").strip() or "UTC"
    safe_limit = max(1, min(int(recent_limit), 150))

    filters: list[dict[str, Any]] = [
        _build_timestamp_range_filter(es_gte, safe_tz, round_to_minute=True),
        {"term": {"event.provider": "filterlog"}},
    ]

    post_filters: list[dict[str, Any]] = []

    clean_action = (action or "").strip().lower()
    if clean_action in ("pass", "block"):
        post_filters.append({"term": {"event.action": clean_action}})

    clean_dir = (direction or "").strip().lower()
    if clean_dir in ("inbound", "in"):
        post_filters.append({"terms": {"network.direction": ["inbound", "in"]}})
    elif clean_dir in ("outbound", "out"):
        post_filters.append({"terms": {"network.direction": ["outbound", "out"]}})

    clean_proto = (protocol or "").strip().lower()
    if clean_proto and clean_proto != "all":
        post_filters.append({"term": {"network.transport": clean_proto}})

    safe_search = sanitize_firewall_search(search)
    if safe_search:
        search_should: list[dict[str, Any]] = [
            {
                "wildcard": {
                    "observer.ingress.interface.name": {
                        "value": f"*{safe_search}*",
                        "case_insensitive": True,
                    }
                }
            },
            {
                "wildcard": {
                    "network.transport": {
                        "value": f"*{safe_search}*",
                        "case_insensitive": True,
                    }
                }
            },
            {
                "wildcard": {
                    "source.as.organization.name": {
                        "value": f"*{safe_search}*",
                        "case_insensitive": True,
                    }
                }
            },
            {
                "wildcard": {
                    "destination.as.organization.name": {
                        "value": f"*{safe_search}*",
                        "case_insensitive": True,
                    }
                }
            },
        ]
        if safe_search.isdigit():
            port_num = int(safe_search)
            search_should.append({"term": {"source.port": port_num}})
            search_should.append({"term": {"destination.port": port_num}})
        try:
            ipaddress.ip_address(safe_search)
            search_should.append({"term": {"source.ip": safe_search}})
            search_should.append({"term": {"destination.ip": safe_search}})
        except ValueError:
            try:
                ipaddress.ip_network(safe_search, strict=False)
                search_should.append({"term": {"source.ip": safe_search}})
                search_should.append({"term": {"destination.ip": safe_search}})
            except ValueError:
                pass
        post_filters.append(
            {"bool": {"should": search_should, "minimum_should_match": 1}}
        )

    query_body: dict[str, Any] = {
        "size": safe_limit,
        "track_total_hits": False,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "_source": [
            "@timestamp",
            "event.action",
            "network.direction",
            "network.transport",
            "network.bytes",
            "observer.ingress.interface.name",
            "source.ip",
            "source.port",
            "source.as.organization.name",
            "destination.ip",
            "destination.port",
            "destination.as.organization.name",
            "rule.id",
        ],
        "query": {"bool": {"filter": filters}},
        "aggs": {
            "total_bytes": {"sum": {"field": "network.bytes"}},
            "by_action": {"terms": {"field": "event.action", "size": 10}},
            "by_direction": {"terms": {"field": "network.direction", "size": 10}},
            "timeline": {
                "date_histogram": {
                    "field": "@timestamp",
                    "fixed_interval": interval,
                    "time_zone": safe_tz,
                    "min_doc_count": 0,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "allowed_packets": {"filter": {"term": {"event.action": "pass"}}},
                    "blocked_packets": {"filter": {"term": {"event.action": "block"}}},
                },
            },
            "blocked_sources": {
                "filter": {"term": {"event.action": "block"}},
                "aggs": {
                    "sources": {
                        "terms": {
                            "field": "source.ip",
                            "size": 60,
                            "collect_mode": "breadth_first",
                        },
                        "aggs": {
                            "bytes": {"sum": {"field": "network.bytes"}},
                            "last_seen": {"max": {"field": "@timestamp"}},
                            "top_ports": {
                                "terms": {"field": "destination.port", "size": 5}
                            },
                            "top_org": {
                                "terms": {
                                    "field": "source.as.organization.name",
                                    "size": 1,
                                }
                            },
                        },
                    },
                    "external_sources": {
                        "filter": {"exists": {"field": "source.as.number"}},
                        "aggs": {
                            "sources": {
                                "terms": {
                                    "field": "source.ip",
                                    "size": 15,
                                    "collect_mode": "breadth_first",
                                },
                                "aggs": {
                                    "bytes": {"sum": {"field": "network.bytes"}},
                                    "last_seen": {"max": {"field": "@timestamp"}},
                                    "top_ports": {
                                        "terms": {"field": "destination.port", "size": 5}
                                    },
                                    "top_org": {
                                        "terms": {
                                            "field": "source.as.organization.name",
                                            "size": 1,
                                        }
                                    },
                                },
                            }
                        },
                    },
                },
            },
            "inbound_wan_passed": {
                "filter": {
                    "bool": {
                        "filter": [
                            {"term": {"event.action": "pass"}},
                            {"term": {"observer.ingress.interface.name": "vtnet1"}},
                            {"exists": {"field": "source.as.number"}},
                        ],
                    }
                },
                "aggs": {
                    "by_dest_ip": {
                        "terms": {"field": "destination.ip", "size": 15},
                        "aggs": {
                            "by_port": {
                                "terms": {"field": "destination.port", "size": 10},
                                "aggs": {
                                    "protocols": {
                                        "terms": {
                                            "field": "network.transport",
                                            "size": 3,
                                        }
                                    },
                                    "bytes": {"sum": {"field": "network.bytes"}},
                                    "unique_sources": {
                                        "cardinality": {
                                            "field": "source.ip",
                                            "execution_hint": "direct",
                                        }
                                    },
                                    "last_seen": {"max": {"field": "@timestamp"}},
                                },
                            }
                        },
                    }
                },
            },
        },
    }
    if post_filters:
        query_body["post_filter"] = {"bool": {"filter": post_filters}}
    return query_body


def normalize_firewall_overview_response(
    raw_resp: dict[str, Any],
    window: str = "24h",
) -> dict[str, Any]:
    """Normalize Elasticsearch `filterlog` aggregations and hits for
    `FirewallPage.tsx` (`FB-P10-001`).
    """
    hits_meta = raw_resp.get("hits") or {}
    total_obj = hits_meta.get("total")
    if isinstance(total_obj, dict):
        total_packets = int(total_obj.get("value") or 0)
    else:
        total_packets = int(total_obj or 0)

    aggs = raw_resp.get("aggregations") or {}
    total_bytes = int(float((aggs.get("total_bytes") or {}).get("value") or 0))

    action_counts: dict[str, int] = {}
    for b in (aggs.get("by_action") or {}).get("buckets") or []:
        key = str(b.get("key") or "")
        action_counts[key] = int(b.get("doc_count") or 0)

    direction_counts: dict[str, int] = {}
    for b in (aggs.get("by_direction") or {}).get("buckets") or []:
        key = str(b.get("key") or "").lower()
        direction_counts[key] = int(b.get("doc_count") or 0)

    allowed_packets = action_counts.get("pass", 0)
    blocked_packets = action_counts.get("block", 0)
    total_packets = max(total_packets, sum(action_counts.values()))
    inbound_packets = direction_counts.get("inbound", 0) + direction_counts.get("in", 0)
    outbound_packets = direction_counts.get("outbound", 0) + direction_counts.get(
        "out", 0
    )

    timeline_buckets = (aggs.get("timeline") or {}).get("buckets") or []
    timeline: list[dict[str, Any]] = []
    for tb in timeline_buckets:
        allowed_cnt = int((tb.get("allowed_packets") or {}).get("doc_count") or 0)
        blocked_cnt = int((tb.get("blocked_packets") or {}).get("doc_count") or 0)
        timeline.append(
            {
                "timestamp": tb.get("key_as_string") or str(tb.get("key") or ""),
                "total_events": int(tb.get("doc_count") or 0),
                "bytes": int(float((tb.get("bytes") or {}).get("value") or 0)),
                "dns_queries": 0,
                "allowed_packets": allowed_cnt,
                "blocked_packets": blocked_cnt,
            }
        )

    noisy_lan_sources: list[dict[str, Any]] = []
    external_scanners: list[dict[str, Any]] = []
    seen_external_ips: set[str] = set()
    blocked_obj = aggs.get("blocked_sources") or {}
    blocked_source_buckets = list(
        ((blocked_obj.get("sources") or {}).get("buckets")) or []
    )
    ext_source_buckets = list(
        (((blocked_obj.get("external_sources") or {}).get("sources") or {}).get("buckets"))
        or []
    )
    for sb in [*blocked_source_buckets, *ext_source_buckets]:
        ip_str = str(sb.get("key") or "").strip()
        if not ip_str or ip_str in ("0.0.0.0", "::", "255.255.255.255"):  # noqa: S104
            continue
        pkt_count = int(sb.get("doc_count") or 0)
        byte_count = int(float((sb.get("bytes") or {}).get("value") or 0))
        last_seen_str = (sb.get("last_seen") or {}).get("value_as_string")
        top_ports = [
            int(pb.get("key"))
            for pb in (sb.get("top_ports") or {}).get("buckets") or []
            if pb.get("key") is not None
        ]
        top_org_obj = sb.get("top_org") or {}
        org_buckets = top_org_obj.get("buckets") or []
        org_hits = (top_org_obj.get("hits") or {}).get("hits") or []
        if org_buckets:
            org_name = str(org_buckets[0].get("key")) if org_buckets[0].get("key") else None
        elif org_hits:
            hit_src = org_hits[0].get("_source") or {}
            raw_org = (
                (((hit_src.get("source") or {}).get("as") or {}).get("organization") or {})
                .get("name")
            )
            org_name = str(raw_org) if raw_org else None
        else:
            org_name = None

        if is_private_lan_ip(ip_str):
            if len(noisy_lan_sources) < 12:
                noisy_lan_sources.append(
                    {
                        "ipv4_address": ip_str,
                        "blocked_packets": pkt_count,
                        "bytes": byte_count,
                        "target_ports": top_ports,
                        "last_seen_at": last_seen_str,
                    }
                )
        else:
            if ip_str not in seen_external_ips and len(external_scanners) < 12:
                seen_external_ips.add(ip_str)
                external_scanners.append(
                    {
                        "source_ip": ip_str,
                        "organization": org_name,
                        "blocked_packets": pkt_count,
                        "bytes": byte_count,
                        "target_ports": top_ports,
                        "last_seen_at": last_seen_str,
                    }
                )

    open_wan_ports: list[dict[str, Any]] = []
    dest_ip_buckets = (
        ((aggs.get("inbound_wan_passed") or {}).get("by_dest_ip") or {}).get("buckets")
        or []
    )
    for db_item in dest_ip_buckets:
        dest_ip = str(db_item.get("key") or "").strip()
        if not dest_ip or not is_private_lan_ip(dest_ip):
            continue
        for pb in (db_item.get("by_port") or {}).get("buckets") or []:
            port_val = pb.get("key")
            if port_val is None:
                continue
            d_port = int(port_val)
            total_doc_cnt = int(pb.get("doc_count") or 0)
            proto_buckets = (pb.get("protocols") or {}).get("buckets") or []
            proto = str(proto_buckets[0].get("key") or "tcp") if proto_buckets else "tcp"
            if proto.lower() == "udp" and d_port >= 52000 and total_doc_cnt < 2:
                continue
            if "in_window" in pb and isinstance(pb.get("in_window"), dict):
                win_b = pb["in_window"]
                passed_cnt = int(win_b.get("doc_count") or 0)
                bytes_val = int(float((win_b.get("bytes") or {}).get("value") or 0))
                uniq_src_val = int((win_b.get("unique_sources") or {}).get("value") or 0)
                last_seen_val = (
                    (win_b.get("last_seen") or {}).get("value_as_string")
                    or (pb.get("last_seen") or {}).get("value_as_string")
                )
            else:
                passed_cnt = total_doc_cnt
                bytes_val = int(float((pb.get("bytes") or {}).get("value") or 0))
                uniq_src_val = int((pb.get("unique_sources") or {}).get("value") or 0)
                last_seen_val = (pb.get("last_seen") or {}).get("value_as_string")
            open_wan_ports.append(
                {
                    "destination_ip": dest_ip,
                    "destination_port": d_port,
                    "protocol": proto,
                    "passed_packets": passed_cnt,
                    "bytes": bytes_val,
                    "unique_external_sources": uniq_src_val,
                    "last_seen_at": last_seen_val,
                }
            )
    open_wan_ports.sort(
        key=lambda item: (item["passed_packets"], item["destination_port"]),
        reverse=True,
    )

    recent_events: list[dict[str, Any]] = []
    for hit in hits_meta.get("hits") or []:
        src = hit.get("_source") or {}
        event_obj = src.get("event") or {}
        net_obj = src.get("network") or {}
        obs_obj = src.get("observer") or {}
        ing_if = ((obs_obj.get("ingress") or {}).get("interface") or {}).get("name")
        source_obj = src.get("source") or {}
        dest_obj = src.get("destination") or {}
        rule_obj = src.get("rule") or {}

        src_org = ((source_obj.get("as") or {}).get("organization") or {}).get("name")
        dst_org = ((dest_obj.get("as") or {}).get("organization") or {}).get("name")

        recent_events.append(
            {
                "timestamp": str(src.get("@timestamp") or ""),
                "action": str(event_obj.get("action") or "unknown"),
                "direction": str(net_obj.get("direction") or "unknown"),
                "protocol": str(net_obj.get("transport") or "unknown"),
                "interface": str(ing_if or ""),
                "source_ip": str(source_obj.get("ip") or ""),
                "source_port": (
                    int(source_obj["port"])
                    if source_obj.get("port") is not None
                    else None
                ),
                "source_org": str(src_org) if src_org else None,
                "destination_ip": str(dest_obj.get("ip") or ""),
                "destination_port": (
                    int(dest_obj["port"])
                    if dest_obj.get("port") is not None
                    else None
                ),
                "destination_org": str(dst_org) if dst_org else None,
                "bytes": int(net_obj.get("bytes") or 0),
                "rule_id": str(rule_obj.get("id") or ""),
            }
        )

    return {
        "window": window,
        "summary": {
            "total_packets": total_packets,
            "allowed_packets": allowed_packets,
            "blocked_packets": blocked_packets,
            "inbound_packets": inbound_packets,
            "outbound_packets": outbound_packets,
            "total_bytes": total_bytes,
            "open_wan_port_count": len(open_wan_ports),
        },
        "timeline": timeline,
        "noisy_lan_sources": noisy_lan_sources,
        "external_scanners": external_scanners,
        "open_wan_ports": open_wan_ports[:25],
        "recent_events": recent_events,
    }


def format_connection_duration(duration_seconds: int) -> str:
    """Format a connection span in seconds into a concise human-readable duration (`FB-P13-002`)."""
    secs = max(0, int(duration_seconds))
    if secs <= 0:
        return "< 1s (Single Packet)"
    days, rem = divmod(secs, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, seconds = divmod(rem, 60)
    parts: list[str] = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0:
        parts.append(f"{hours}h")
    if minutes > 0:
        parts.append(f"{minutes}m")
    if seconds > 0 and days == 0:
        parts.append(f"{seconds}s")
    return " ".join(parts) if parts else "< 1s"


def format_geo_location_label(
    *,
    city_name: str | None = None,
    region_name: str | None = None,
    country_name: str | None = None,
    country_iso_code: str | None = None,
) -> str:
    """Format GeoIP city, region, and country fields into a clean display label (`FB-P13-002`)."""
    parts = [
        p.strip()
        for p in (city_name, region_name, country_name or country_iso_code)
        if p and str(p).strip()
    ]
    if not parts:
        return "Unknown Location"
    deduped: list[str] = []
    for part in parts:
        if part not in deduped:
            deduped.append(part)
    return ", ".join(deduped)


def build_open_wan_port_sessions_query(
    *,
    destination_ip: str,
    destination_port: int,
    protocol: str = "tcp",
    window: str = "24h",
    search: str | None = None,
    recent_limit: int = 60,
    tz_name: str = "UTC",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build paired `(aggs_body, recent_body)` queries for inspecting external WAN IPs
    connected to a specific active inbound open port (`FB-P13-002`).
    """
    valid_dest_ip = validate_ipv4_address(destination_ip)
    valid_port = max(1, min(int(destination_port), 65535))
    clean_proto = (protocol or "tcp").strip().lower()
    if clean_proto not in ("tcp", "udp", "icmp", "ipv6-icmp", "igmp"):
        clean_proto = "tcp"
    _, es_gte, _ = resolve_time_window(window)
    clean_search = sanitize_firewall_search(search)

    filters: list[dict[str, Any]] = [
        _build_timestamp_range_filter(es_gte, tz_name, round_to_minute=True),
        {"term": {"event.provider": "filterlog"}},
        {"term": {"event.action": "pass"}},
        {"term": {"destination.ip": valid_dest_ip}},
        {"term": {"destination.port": valid_port}},
        {"term": {"network.transport": clean_proto}},
        {"exists": {"field": "source.as.number"}},
        {
            "bool": {
                "should": [
                    {"term": {"observer.ingress.interface.name": "vtnet1"}},
                    {"terms": {"network.direction": ["inbound", "in"]}},
                ],
                "minimum_should_match": 1,
            }
        },
    ]

    if clean_search:
        wc = {"value": f"*{clean_search}*", "case_insensitive": True}
        should_clauses: list[dict[str, Any]] = [
            {"wildcard": {"source.as.organization.name": wc}},
            {"wildcard": {"source.geo.country_name": wc}},
            {"wildcard": {"source.geo.region_name": wc}},
            {"wildcard": {"source.geo.city_name": wc}},
            {"term": {"source.geo.country_iso_code": clean_search.upper()}},
        ]
        try:
            ip_val = str(ipaddress.ip_address(clean_search))
            should_clauses.append({"term": {"source.ip": ip_val}})
        except ValueError:
            pass
        if clean_search.isdigit():
            port_or_asn = int(clean_search)
            should_clauses.append({"term": {"source.as.number": port_or_asn}})
            if 1 <= port_or_asn <= 65535:
                should_clauses.append({"term": {"source.port": port_or_asn}})
        filters.append({"bool": {"should": should_clauses, "minimum_should_match": 1}})

    source_fields = [
        "@timestamp",
        "source.ip",
        "source.port",
        "source.as.number",
        "source.as.organization.name",
        "source.geo.city_name",
        "source.geo.region_name",
        "source.geo.region_iso_code",
        "source.geo.country_name",
        "source.geo.country_iso_code",
        "source.geo.continent_name",
        "source.geo.location",
        "destination.ip",
        "destination.port",
        "network.transport",
        "network.direction",
        "network.bytes",
        "network.community_id",
        "observer.ingress.interface.name",
        "rule.id",
        "pfsense.ip.ttl",
        "pfsense.tcp.flags",
        "pfsense.tcp.window",
    ]

    slot_interval = "30m" if window == "30d" else ("15m" if window == "7d" else "5m")

    aggs_body: dict[str, Any] = {
        "size": 0,
        "track_total_hits": False,
        "query": {"bool": {"filter": filters}},
        "aggs": {
            "total_packets": {"value_count": {"field": "@timestamp"}},
            "total_bytes": {"sum": {"field": "network.bytes"}},
            "unique_sources": {
                "cardinality": {"field": "source.ip", "execution_hint": "direct"}
            },
            "first_seen": {"min": {"field": "@timestamp"}},
            "last_seen": {"max": {"field": "@timestamp"}},
            "top_countries": {
                "terms": {"field": "source.geo.country_name", "size": 10}
            },
            "external_ips": {
                "terms": {
                    "field": "source.ip",
                    "size": 50,
                },
                "aggs": {
                    "bytes": {"sum": {"field": "network.bytes"}},
                    "first_seen": {"min": {"field": "@timestamp"}},
                    "last_seen": {"max": {"field": "@timestamp"}},
                    "active_slots": {
                        "date_histogram": {
                            "field": "@timestamp",
                            "fixed_interval": slot_interval,
                            "min_doc_count": 1,
                        }
                    },
                    "source_ports": {"terms": {"field": "source.port", "size": 8}},
                    "latest_sample": {
                        "top_hits": {
                            "size": 1,
                            "_source": source_fields,
                        }
                    },
                },
            },
        },
    }

    capped_limit = max(1, min(int(recent_limit), 200))
    recent_body: dict[str, Any] = {
        "size": capped_limit,
        "track_total_hits": False,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "query": {"bool": {"filter": filters}},
        "_source": source_fields,
    }
    return aggs_body, recent_body


def normalize_open_wan_port_sessions_response(
    aggs_resp: dict[str, Any],
    recent_resp: dict[str, Any],
    *,
    destination_ip: str,
    destination_port: int,
    protocol: str = "tcp",
    window: str = "24h",
) -> dict[str, Any]:
    """Normalize Elasticsearch aggregations and recent hits for an open WAN port (`FB-P13-002`)."""
    aggs = aggs_resp.get("aggregations") or {}
    ext_buckets = ((aggs.get("external_ips") or {}).get("buckets")) or []
    total_packets = int(
        (aggs.get("total_packets") or {}).get("value")
        or sum(int(b.get("doc_count") or 0) for b in ext_buckets)
    )
    total_bytes = int(float((aggs.get("total_bytes") or {}).get("value") or 0))
    unique_ips = int(
        (aggs.get("unique_sources") or {}).get("value") or len(ext_buckets)
    )
    first_seen_at = (aggs.get("first_seen") or {}).get("value_as_string")
    last_seen_at = (aggs.get("last_seen") or {}).get("value_as_string")
    country_buckets = ((aggs.get("top_countries") or {}).get("buckets")) or []
    top_country = (
        str(country_buckets[0].get("key"))
        if country_buckets and country_buckets[0].get("key")
        else None
    )

    external_ips: list[dict[str, Any]] = []
    for eb in ext_buckets:
        src_ip = str(eb.get("key") or "").strip()
        if not src_ip or is_private_lan_ip(src_ip):
            continue
        pkt_cnt = int(eb.get("doc_count") or 0)
        byte_cnt = int(float((eb.get("bytes") or {}).get("value") or 0))
        first_obj = eb.get("first_seen") or {}
        last_obj = eb.get("last_seen") or {}
        ip_first_str = first_obj.get("value_as_string")
        ip_last_str = last_obj.get("value_as_string")
        first_ms = first_obj.get("value")
        last_ms = last_obj.get("value")
        duration_secs = 0
        if isinstance(first_ms, (int, float)) and isinstance(last_ms, (int, float)):
            duration_secs = max(0, int((float(last_ms) - float(first_ms)) / 1000.0))

        slot_buckets = ((eb.get("active_slots") or {}).get("buckets")) or []
        slot_mins = 30 if window == "30d" else (15 if window == "7d" else 5)
        active_minutes = max(5 if pkt_cnt > 0 else 0, len(slot_buckets) * slot_mins)

        src_ports = [
            int(sp.get("key"))
            for sp in ((eb.get("source_ports") or {}).get("buckets") or [])
            if sp.get("key") is not None
        ]

        sample_hits = (
            ((eb.get("latest_sample") or {}).get("hits") or {}).get("hits") or []
        )
        sample_src = (sample_hits[0].get("_source") or {}) if sample_hits else {}
        source_obj = sample_src.get("source") or {}
        as_obj = source_obj.get("as") or {}
        geo_obj = source_obj.get("geo") or {}
        loc_obj = geo_obj.get("location") or {}
        net_obj = sample_src.get("network") or {}
        obs_obj = sample_src.get("observer") or {}
        ing_if = ((obs_obj.get("ingress") or {}).get("interface") or {}).get("name")
        rule_obj = sample_src.get("rule") or {}
        pf_obj = sample_src.get("pfsense") or {}
        pf_ip = pf_obj.get("ip") or {}
        pf_tcp = pf_obj.get("tcp") or {}

        asn_val = int(as_obj["number"]) if as_obj.get("number") is not None else None
        org_val = ((as_obj.get("organization") or {}).get("name")) or None
        city_val = geo_obj.get("city_name") or None
        region_val = geo_obj.get("region_name") or None
        region_iso_val = geo_obj.get("region_iso_code") or None
        country_val = geo_obj.get("country_name") or None
        country_iso_val = geo_obj.get("country_iso_code") or None
        continent_val = geo_obj.get("continent_name") or None
        lat_val = (
            round(float(loc_obj["lat"]), 4)
            if isinstance(loc_obj, dict) and loc_obj.get("lat") is not None
            else None
        )
        lon_val = (
            round(float(loc_obj["lon"]), 4)
            if isinstance(loc_obj, dict) and loc_obj.get("lon") is not None
            else None
        )
        loc_label = format_geo_location_label(
            city_name=city_val,
            region_name=region_val,
            country_name=country_val,
            country_iso_code=country_iso_val,
        )
        ttl_val = int(pf_ip["ttl"]) if pf_ip.get("ttl") is not None else None
        tcp_flags_val = str(pf_tcp["flags"]) if pf_tcp.get("flags") else None

        external_ips.append(
            {
                "source_ip": src_ip,
                "asn": asn_val,
                "organization": str(org_val) if org_val else None,
                "city_name": str(city_val) if city_val else None,
                "region_name": str(region_val) if region_val else None,
                "region_iso_code": str(region_iso_val) if region_iso_val else None,
                "country_name": str(country_val) if country_val else None,
                "country_iso_code": str(country_iso_val) if country_iso_val else None,
                "continent_name": str(continent_val) if continent_val else None,
                "location_label": loc_label,
                "latitude": lat_val,
                "longitude": lon_val,
                "passed_packets": pkt_cnt,
                "bytes": byte_cnt,
                "first_seen_at": ip_first_str,
                "last_seen_at": ip_last_str,
                "connection_duration_seconds": duration_secs,
                "connection_duration_label": format_connection_duration(duration_secs),
                "active_duration_minutes": active_minutes,
                "source_ports": src_ports,
                "tcp_flags": tcp_flags_val,
                "ttl": ttl_val,
                "interface": str(ing_if) if ing_if else None,
                "rule_id": str(rule_obj.get("id")) if rule_obj.get("id") else None,
                "community_id": (
                    str(net_obj.get("community_id"))
                    if net_obj.get("community_id")
                    else None
                ),
            }
        )

    recent_events: list[dict[str, Any]] = []
    hits_list = ((recent_resp.get("hits") or {}).get("hits")) or []
    for hit in hits_list:
        src = hit.get("_source") or {}
        s_obj = src.get("source") or {}
        s_as = s_obj.get("as") or {}
        s_geo = s_obj.get("geo") or {}
        n_obj = src.get("network") or {}
        o_obj = src.get("observer") or {}
        r_obj = src.get("rule") or {}
        p_obj = src.get("pfsense") or {}
        p_ip = p_obj.get("ip") or {}
        p_tcp = p_obj.get("tcp") or {}
        ing_name = ((o_obj.get("ingress") or {}).get("interface") or {}).get("name")
        org_name = ((s_as.get("organization") or {}).get("name")) or None
        loc_str = format_geo_location_label(
            city_name=s_geo.get("city_name"),
            region_name=s_geo.get("region_name"),
            country_name=s_geo.get("country_name"),
            country_iso_code=s_geo.get("country_iso_code"),
        )
        recent_events.append(
            {
                "timestamp": str(src.get("@timestamp") or ""),
                "source_ip": str(s_obj.get("ip") or ""),
                "source_port": (
                    int(s_obj["port"]) if s_obj.get("port") is not None else None
                ),
                "asn": (
                    int(s_as["number"]) if s_as.get("number") is not None else None
                ),
                "organization": str(org_name) if org_name else None,
                "location_label": loc_str,
                "country_iso_code": (
                    str(s_geo["country_iso_code"])
                    if s_geo.get("country_iso_code")
                    else None
                ),
                "protocol": str(n_obj.get("transport") or protocol),
                "bytes": int(n_obj.get("bytes") or 0),
                "tcp_flags": str(p_tcp["flags"]) if p_tcp.get("flags") else None,
                "ttl": int(p_ip["ttl"]) if p_ip.get("ttl") is not None else None,
                "interface": str(ing_name or ""),
                "rule_id": str(r_obj.get("id") or ""),
            }
        )

    return {
        "window": window,
        "destination_ip": destination_ip,
        "destination_port": int(destination_port),
        "protocol": protocol.lower(),
        "summary": {
            "total_passed_packets": total_packets,
            "total_bytes": total_bytes,
            "unique_external_ips": unique_ips,
            "top_country": top_country,
            "first_seen_at": first_seen_at,
            "last_seen_at": last_seen_at,
        },
        "external_ips": external_ips,
        "recent_events": recent_events,
    }


class ElasticsearchServiceClient:
    """Async client wrapper for Elasticsearch 9.4.3 read-only operations."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.elasticsearch_url
        self._api_key = settings.elasticsearch_api_key.get_secret_value()
        self._verify_certs = settings.elasticsearch_verify_ssl
        self._ca_certs = settings.elasticsearch_ca_cert_path.strip() or None
        self._timeout = max(float(settings.elasticsearch_timeout_seconds), 25.0)
        self._index_patterns = settings.es_index_pattern_list
        self._tz = settings.tz

    def create_es_client(self) -> AsyncElasticsearch:
        """Instantiate an AsyncElasticsearch v9 client."""
        kwargs: dict[str, Any] = {
            "hosts": [self._url],
            "api_key": self._api_key,
            "verify_certs": self._verify_certs,
            "request_timeout": self._timeout,
        }
        if self._ca_certs:
            kwargs["ca_certs"] = self._ca_certs
        return AsyncElasticsearch(**kwargs)

    async def _execute_aggs_and_recent_search(
        self,
        client: Any,
        *,
        target_pattern: str,
        aggs_body: dict[str, Any],
        recent_body: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Execute paired aggregation + recent-events queries in a single _msearch round-trip.

        Falls back to sequential `client.search()` calls when a unit-test mock client does not
        define `msearch`.
        """
        use_msearch = isinstance(client, AsyncElasticsearch) or (
            "msearch" in getattr(client, "__dict__", {})
        )
        if use_msearch:
            searches: list[dict[str, Any]] = [
                {"index": target_pattern},
                aggs_body,
                {"index": target_pattern},
                recent_body,
            ]
            mresp = await client.msearch(
                searches=searches,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            responses = list((dict(mresp).get("responses")) or [])
            if len(responses) >= 2:
                r0 = dict(responses[0] or {})
                r1 = dict(responses[1] or {})
                for sub in (r0, r1):
                    if "error" in sub:
                        err_info = sub["error"]
                        raise ElasticsearchQueryError(
                            f"Elasticsearch msearch sub-query failed: {err_info}",
                            status_code=int(sub.get("status") or 503),
                        )
                return r0, r1

        aggs_resp = await client.search(
            index=target_pattern,
            body=aggs_body,
            ignore_unavailable=True,
            allow_no_indices=True,
            request_cache=True,
        )
        recent_resp = await client.search(
            index=target_pattern,
            body=recent_body,
            ignore_unavailable=True,
            allow_no_indices=True,
        )
        return dict(aggs_resp), dict(recent_resp)

    async def check_health(self) -> ServiceHealthStatus:
        """Verify cluster connectivity and read access to configured index patterns."""
        start = time.perf_counter()
        client = self.create_es_client()
        target_pattern = ",".join(self._index_patterns)
        try:
            info_resp = await client.info()
            cluster_name = info_resp.get("cluster_name", "unknown")
            es_version = info_resp.get("version", {}).get("number", "unknown")

            count_resp = await client.count(
                index=target_pattern,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            doc_count = int(count_resp.get("count", 0))

            cluster_status = "unknown"
            assigned_shards = 0
            unassigned_shards = 0
            relocating_shards = 0
            try:
                health_resp = await client.cluster.health()
                if hasattr(health_resp, "get"):
                    raw_status = health_resp.get("status", "unknown")
                    if isinstance(raw_status, str):
                        cluster_status = raw_status.lower()
                        assigned_shards = int(health_resp.get("active_shards", 0) or 0)
                        unassigned_shards = int(health_resp.get("unassigned_shards", 0) or 0)
                        relocating_shards = int(health_resp.get("relocating_shards", 0) or 0)
            except Exception:  # noqa: S110
                pass

            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="elasticsearch",
                status="healthy",
                latency_ms=elapsed,
                message=(
                    f"Elasticsearch {es_version} connected "
                    f"({doc_count:,} docs in {target_pattern})."
                ),
                details={
                    "url": self._url,
                    "cluster_name": cluster_name,
                    "version": es_version,
                    "index_patterns": self._index_patterns,
                    "document_count": doc_count,
                    "cluster_status": cluster_status,
                    "assigned_shards": assigned_shards,
                    "unassigned_shards": unassigned_shards,
                    "relocating_shards": relocating_shards,
                },
            )
        except (AuthenticationException, AuthorizationException) as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="elasticsearch",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"Elasticsearch auth/permission rejected: {exc.message}",
                details={"url": self._url, "status_code": exc.status_code},
            )
        except (TransportError, Exception) as exc:
            elapsed = round((time.perf_counter() - start) * 1000, 2)
            return ServiceHealthStatus(
                service="elasticsearch",
                status="unhealthy",
                latency_ms=elapsed,
                message=f"Elasticsearch connection failed: {exc.__class__.__name__}: {exc}",
                details={"url": self._url},
            )
        finally:
            await client.close()

    async def fetch_network_overview(
        self,
        window: str = "24h",
        top_n: int = 10,
        excluded_ips: list[str] | None = None,
    ) -> dict[str, Any]:
        """Execute network-wide traffic and DNS aggregation query against logs-pfsense.log*."""
        win_key, _, _ = resolve_time_window(window)
        merged_excluded = sorted(
            set(self._settings.protected_ip_set).union(excluded_ips or [])
        )
        body = build_network_overview_query(
            window=win_key,
            tz_name=self._tz,
            top_n=top_n,
            excluded_ips=merged_excluded,
        )
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            use_msearch = isinstance(client, AsyncElasticsearch) or (
                "msearch" in getattr(client, "__dict__", {})
            )
            if use_msearch:
                aggs_all = dict(body.get("aggs") or {})
                app_agg = aggs_all.pop("app_usage", None)
                lan_agg = aggs_all.pop("lan_devices", None)
                ts_range = dict(
                    ((body.get("query") or {}).get("range") or {}).get("@timestamp") or {}
                )
                raw_gte = str(ts_range.get("gte", "now-24h"))
                rounded_gte = _round_es_gte(raw_gte)
                range_inner: dict[str, Any] = {"gte": rounded_gte}
                if "time_zone" in ts_range:
                    range_inner["time_zone"] = ts_range["time_zone"]
                range_q = {"range": {"@timestamp": range_inner}}

                q_core = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": range_q,
                    "aggs": aggs_all,
                }
                if isinstance(lan_agg, dict):
                    lan_agg_opt = dict(lan_agg)
                    lan_agg_opt["filter"] = {"match_all": {}}
                    lan_sub = dict(lan_agg_opt.get("aggs") or {})
                    top_ips_obj = dict(lan_sub.get("top_ips") or {})
                    if "terms" in top_ips_obj:
                        orig_terms = dict(top_ips_obj["terms"])
                        orig_size = int(orig_terms.get("size") or top_n or 10)
                        top_ips_obj["terms"] = {
                            **orig_terms,
                            "size": max(orig_size * 3, 25),
                            "collect_mode": "breadth_first",
                        }
                        lan_sub["top_ips"] = top_ips_obj
                        lan_agg_opt["aggs"] = lan_sub
                else:
                    lan_agg_opt = lan_agg
                q_lan = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": range_q,
                    "aggs": {"lan_devices": lan_agg_opt} if lan_agg_opt else {},
                }
                if isinstance(app_agg, dict):
                    app_agg_opt = dict(app_agg)
                    app_sub = dict(app_agg_opt.get("aggs") or {})
                    by_dev_obj = dict(app_sub.get("by_device") or {})
                    if "filter" in by_dev_obj:
                        by_dev_obj["filter"] = {"match_all": {}}
                        app_sub["by_device"] = by_dev_obj
                        app_agg_opt["aggs"] = app_sub
                else:
                    app_agg_opt = app_agg
                yt_f = (
                    ((app_agg_opt or {}).get("filters") or {})
                    .get("filters", {})
                    .get("youtube")
                )
                pl_f = (
                    ((app_agg_opt or {}).get("filters") or {})
                    .get("filters", {})
                    .get("plex")
                )
                q_app = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": {
                        "bool": {
                            "filter": [
                                range_q,
                                {
                                    "bool": {
                                        "should": [f for f in (yt_f, pl_f) if f],
                                        "minimum_should_match": 1,
                                    }
                                },
                            ]
                        }
                    },
                    "aggs": {"app_usage": app_agg_opt} if app_agg_opt else {},
                }
                mresp = await client.msearch(
                    searches=[
                        {"index": target_pattern},
                        q_core,
                        {"index": target_pattern},
                        q_lan,
                        {"index": target_pattern},
                        q_app,
                    ],
                    ignore_unavailable=True,
                    allow_no_indices=True,
                )
                responses = list((dict(mresp).get("responses")) or [])
                if len(responses) >= 3:
                    merged_aggs: dict[str, Any] = {}
                    for sub_r in responses[:3]:
                        sub_dict = dict(sub_r or {})
                        if "error" in sub_dict:
                            raise ElasticsearchQueryError(
                                f"Elasticsearch msearch sub-query failed: {sub_dict['error']}",
                                status_code=int(sub_dict.get("status") or 503),
                            )
                        merged_aggs.update(dict(sub_dict.get("aggregations") or {}))
                    merged_resp = dict(responses[0] or {})
                    merged_resp["aggregations"] = merged_aggs
                    return normalize_network_overview_response(merged_resp, window=win_key)

            resp = await client.search(
                index=target_pattern,
                body=body,
                ignore_unavailable=True,
                allow_no_indices=True,
                request_cache=True,
            )
            return normalize_network_overview_response(dict(resp), window=win_key)
        except (AuthenticationException, AuthorizationException) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch authentication/authorization failed: {exc.message}",
                status_code=403,
            ) from exc
        except (TransportError, Exception) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.close()

    async def fetch_device_analytics(
        self,
        ipv4_address: str,
        window: str = "24h",
        domain_search: str | None = None,
        top_n: int = 15,
        recent_limit: int = 40,
    ) -> dict[str, Any]:
        """Execute per-device usage, 24h access profile, and DNS domain queries."""
        win_key, _, _ = resolve_time_window(window)
        aggs_body = build_device_analytics_query(
            ipv4_address=ipv4_address,
            window=win_key,
            tz_name=self._tz,
            top_n=top_n,
        )
        recent_body = build_device_recent_domains_query(
            ipv4_address=ipv4_address,
            window=win_key,
            domain_search=domain_search,
            limit=recent_limit,
            tz_name=self._tz,
        )
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            aggs_resp, recent_resp = await self._execute_aggs_and_recent_search(
                client,
                target_pattern=target_pattern,
                aggs_body=aggs_body,
                recent_body=recent_body,
            )
            return normalize_device_analytics_response(
                aggs_resp,
                recent_resp,
                window=win_key,
            )
        except (AuthenticationException, AuthorizationException) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch authentication/authorization failed: {exc.message}",
                status_code=403,
            ) from exc
        except (TransportError, Exception) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.close()

    async def fetch_group_analytics(
        self,
        ipv4_addresses: list[str],
        window: str = "24h",
        domain_search: str | None = None,
        top_n: int = 15,
        recent_limit: int = 40,
    ) -> dict[str, Any]:
        """Execute multi-IP group usage, 24h access profile, member breakdown, and DNS queries."""
        win_key, _, _ = resolve_time_window(window)
        clean_ips = validate_ipv4_list(ipv4_addresses)
        aggs_body = build_group_analytics_query(
            ipv4_addresses=clean_ips,
            window=win_key,
            tz_name=self._tz,
            top_n=top_n,
        )
        recent_body = build_group_recent_domains_query(
            ipv4_addresses=clean_ips,
            window=win_key,
            domain_search=domain_search,
            limit=recent_limit,
            tz_name=self._tz,
        )
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            aggs_resp, recent_resp = await self._execute_aggs_and_recent_search(
                client,
                target_pattern=target_pattern,
                aggs_body=aggs_body,
                recent_body=recent_body,
            )
            return normalize_group_analytics_response(
                aggs_resp,
                recent_resp,
                member_ips=clean_ips,
                window=win_key,
            )
        except (AuthenticationException, AuthorizationException) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch authentication/authorization failed: {exc.message}",
                status_code=403,
            ) from exc
        except (TransportError, Exception) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.close()

    async def fetch_firewall_overview(
        self,
        window: str = "24h",
        *,
        action: str | None = None,
        direction: str | None = None,
        protocol: str | None = None,
        search: str | None = None,
        recent_limit: int = 80,
    ) -> dict[str, Any]:
        """Execute Phase 10 Firewall & Security overview query against
        logs-pfsense.log* (`FB-P10-001`).
        """
        win_key, _, _ = resolve_time_window(window)
        body = build_firewall_overview_query(
            window=win_key,
            tz_name=self._tz,
            action=action,
            direction=direction,
            protocol=protocol,
            search=search,
            recent_limit=recent_limit,
        )
        post_f = body.pop("post_filter", None)
        limit = int(body.get("size") or 80)
        sort_spec = body.pop("sort", [{"@timestamp": {"order": "desc"}}])
        src_spec = body.pop("_source", None)
        body["size"] = 0
        recent_filters = list(body["query"]["bool"]["filter"])
        if post_f:
            recent_filters.extend((post_f.get("bool") or {}).get("filter") or [])
        recent_body: dict[str, Any] = {
            "size": limit,
            "track_total_hits": False,
            "sort": sort_spec,
            "query": {"bool": {"filter": recent_filters}},
        }
        if src_spec is not None:
            recent_body["_source"] = src_spec

        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            use_msearch = isinstance(client, AsyncElasticsearch) or (
                "msearch" in getattr(client, "__dict__", {})
            )
            if use_msearch:
                base_filters = list(body["query"]["bool"]["filter"])
                aggs_all = dict(body.get("aggs") or {})
                blocked_agg = aggs_all.pop("blocked_sources", None)
                wan_agg = aggs_all.pop("inbound_wan_passed", None)

                q_core: dict[str, Any] = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": {"bool": {"filter": base_filters}},
                    "aggs": aggs_all,
                }
                blocked_opt = dict(blocked_agg) if isinstance(blocked_agg, dict) else {}
                blocked_opt["filter"] = {"match_all": {}}
                blocked_sub = dict(blocked_opt.get("aggs") or {})
                ext_blocked_agg = blocked_sub.pop("external_sources", None)
                if isinstance(blocked_sub.get("sources"), dict):
                    lan_src = dict(blocked_sub["sources"])
                    lan_src_aggs = dict(lan_src.get("aggs") or {})
                    lan_src_aggs.pop("top_org", None)
                    lan_src["aggs"] = lan_src_aggs
                    blocked_sub["sources"] = lan_src
                blocked_opt["aggs"] = blocked_sub
                q_blocked: dict[str, Any] = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": {
                        "bool": {
                            "filter": [*base_filters, {"term": {"event.action": "block"}}],
                            "must_not": [{"exists": {"field": "source.as.number"}}],
                        }
                    },
                    "aggs": {"blocked_sources": blocked_opt} if blocked_opt else {},
                }
                ext_opt = (
                    dict(ext_blocked_agg) if isinstance(ext_blocked_agg, dict) else {}
                )
                ext_opt["filter"] = {"match_all": {}}
                q_ext_blocked: dict[str, Any] = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": {
                        "bool": {
                            "filter": [
                                *base_filters,
                                {"term": {"event.action": "block"}},
                                {"exists": {"field": "source.as.number"}},
                            ]
                        }
                    },
                    "aggs": {"external_sources": ext_opt} if ext_opt else {},
                }
                wan_opt = dict(wan_agg) if isinstance(wan_agg, dict) else {}
                wan_opt["filter"] = {"match_all": {}}
                if win_key != "30d" and wan_opt:
                    wan_aggs = dict(wan_opt.get("aggs") or {})
                    by_dest = dict(wan_aggs.get("by_dest_ip") or {})
                    by_dest_aggs = dict(by_dest.get("aggs") or {})
                    by_port = dict(by_dest_aggs.get("by_port") or {})
                    by_port_aggs = dict(by_port.get("aggs") or {})
                    by_port_aggs["in_window"] = {
                        "filter": base_filters[0],
                        "aggs": {
                            "bytes": {"sum": {"field": "network.bytes"}},
                            "unique_sources": {
                                "cardinality": {
                                    "field": "source.ip",
                                    "execution_hint": "direct",
                                }
                            },
                            "last_seen": {"max": {"field": "@timestamp"}},
                        },
                    }
                    by_port["aggs"] = by_port_aggs
                    by_dest_aggs["by_port"] = by_port
                    by_dest["aggs"] = by_dest_aggs
                    wan_aggs["by_dest_ip"] = by_dest
                    wan_opt["aggs"] = wan_aggs
                wan_time_filter = (
                    base_filters[0]
                    if win_key == "30d"
                    else {"range": {"@timestamp": {"gte": "now-30d/m"}}}
                )
                q_wan: dict[str, Any] = {
                    "size": 0,
                    "track_total_hits": False,
                    "query": {
                        "bool": {
                            "filter": [
                                wan_time_filter,
                                {"term": {"event.provider": "filterlog"}},
                                {"term": {"event.action": "pass"}},
                                {"term": {"observer.ingress.interface.name": "vtnet1"}},
                                {"exists": {"field": "source.as.number"}},
                            ]
                        }
                    },
                    "aggs": {"inbound_wan_passed": wan_opt} if wan_opt else {},
                }
                mresp = await client.msearch(
                    searches=[
                        {"index": target_pattern},
                        q_core,
                        {"index": target_pattern},
                        q_blocked,
                        {"index": target_pattern},
                        q_ext_blocked,
                        {"index": target_pattern},
                        q_wan,
                        {"index": target_pattern},
                        recent_body,
                    ],
                    ignore_unavailable=True,
                    allow_no_indices=True,
                )
                responses = list((dict(mresp).get("responses")) or [])
                if len(responses) >= 5:
                    merged_aggs: dict[str, Any] = {}
                    for sub_r in responses[:4]:
                        sub_dict = dict(sub_r or {})
                        if "error" in sub_dict:
                            raise ElasticsearchQueryError(
                                f"Elasticsearch msearch sub-query failed: {sub_dict['error']}",
                                status_code=int(sub_dict.get("status") or 503),
                            )
                        merged_aggs.update(dict(sub_dict.get("aggregations") or {}))
                    if "external_sources" in merged_aggs and isinstance(
                        merged_aggs.get("blocked_sources"), dict
                    ):
                        merged_aggs["blocked_sources"]["external_sources"] = (
                            merged_aggs.pop("external_sources")
                        )
                    r_recent = dict(responses[4] or {})
                    if "error" in r_recent:
                        raise ElasticsearchQueryError(
                            f"Elasticsearch msearch sub-query failed: {r_recent['error']}",
                            status_code=int(r_recent.get("status") or 503),
                        )
                    merged_resp = dict(responses[0] or {})
                    merged_resp["aggregations"] = merged_aggs
                    merged_resp["hits"] = r_recent.get("hits", {})
                    return normalize_firewall_overview_response(merged_resp, window=win_key)
                if len(responses) == 2:
                    r0 = dict(responses[0] or {})
                    r1 = dict(responses[1] or {})
                    for sub in (r0, r1):
                        if "error" in sub:
                            raise ElasticsearchQueryError(
                                f"Elasticsearch msearch sub-query failed: {sub['error']}",
                                status_code=int(sub.get("status") or 503),
                            )
                    r0["hits"] = r1.get("hits", {})
                    return normalize_firewall_overview_response(r0, window=win_key)

            aggs_resp, recent_resp = await self._execute_aggs_and_recent_search(
                client,
                target_pattern=target_pattern,
                aggs_body=body,
                recent_body=recent_body,
            )
            merged_resp = dict(aggs_resp)
            merged_resp["hits"] = dict(recent_resp).get("hits", {})
            return normalize_firewall_overview_response(merged_resp, window=win_key)
        except (AuthenticationException, AuthorizationException) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch authentication/authorization failed: {exc.message}",
                status_code=403,
            ) from exc
        except (TransportError, Exception) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.close()

    async def fetch_open_wan_port_sessions(
        self,
        *,
        destination_ip: str,
        destination_port: int,
        protocol: str = "tcp",
        window: str = "24h",
        search: str | None = None,
        recent_limit: int = 60,
    ) -> dict[str, Any]:
        """Execute external WAN IP session inspection query for an open WAN port (`FB-P13-002`)."""
        win_key, _, _ = resolve_time_window(window)
        aggs_body, recent_body = build_open_wan_port_sessions_query(
            destination_ip=destination_ip,
            destination_port=destination_port,
            protocol=protocol,
            window=win_key,
            search=search,
            recent_limit=recent_limit,
            tz_name=self._tz,
        )
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            aggs_resp, recent_resp = await self._execute_aggs_and_recent_search(
                client,
                target_pattern=target_pattern,
                aggs_body=aggs_body,
                recent_body=recent_body,
            )
            return normalize_open_wan_port_sessions_response(
                aggs_resp,
                recent_resp,
                destination_ip=destination_ip,
                destination_port=destination_port,
                protocol=protocol,
                window=win_key,
            )
        except (AuthenticationException, AuthorizationException) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch authentication/authorization failed: {exc.message}",
                status_code=403,
            ) from exc
        except (TransportError, Exception) as exc:
            raise ElasticsearchQueryError(
                f"Elasticsearch query failed: {exc.__class__.__name__}: {exc}",
                status_code=503,
            ) from exc
        finally:
            await client.close()

