"""Async Elasticsearch 9.4.3 client wrapper targeting logs-pfsense.log* (pfSense 1.25.4)."""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any

from elastic_transport import TransportError
from elasticsearch import AsyncElasticsearch, AuthenticationException, AuthorizationException

from app.clients.opnsense import ServiceHealthStatus, validate_ipv4_address
from app.config import Settings

RFC1918_CIDRS: list[str] = ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]

TIME_WINDOW_CONFIG: dict[str, dict[str, str]] = {
    "1h": {"es_gte": "now-1h", "interval": "5m", "label": "Last 1 Hour"},
    "24h": {"es_gte": "now-24h", "interval": "1h", "label": "Last 24 Hours"},
    "7d": {"es_gte": "now-7d", "interval": "6h", "label": "Last 7 Days"},
    "30d": {"es_gte": "now-30d", "interval": "1d", "label": "Last 30 Days"},
}

_SAFE_DOMAIN_SEARCH_RE = re.compile(r"[^a-zA-Z0-9._-]")


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


def sanitize_domain_search(raw_search: str | None) -> str | None:
    """Sanitize a user-supplied domain substring for safe wildcard querying."""
    if not raw_search:
        return None
    cleaned = _SAFE_DOMAIN_SEARCH_RE.sub("", raw_search.strip().lower())
    if not cleaned:
        return None
    return cleaned[:120]


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


def build_network_overview_query(
    window: str = "24h",
    tz_name: str = "UTC",
    top_n: int = 10,
) -> dict[str, Any]:
    """Construct the Elasticsearch aggregation DSL for network-wide traffic and DNS overview."""
    _, es_gte, interval = resolve_time_window(window)
    safe_tz = (tz_name or "UTC").strip() or "UTC"
    capped_top_n = max(1, min(int(top_n), 50))

    return {
        "size": 0,
        "track_total_hits": True,
        "query": {
            "range": {
                "@timestamp": {
                    "gte": es_gte,
                }
            }
        },
        "aggs": {
            "total_bytes": {"sum": {"field": "network.bytes"}},
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
        total_events = int(hits_total_obj.get("value") or 0)
    else:
        total_events = int(hits_total_obj or 0)

    total_bytes = int(float((aggs.get("total_bytes") or {}).get("value") or 0))
    provider_counts = _extract_bucket_map((aggs.get("by_provider") or {}).get("buckets") or [])
    action_counts = _extract_bucket_map((aggs.get("by_action") or {}).get("buckets") or [])

    timeline_buckets = (aggs.get("timeline") or {}).get("buckets") or []
    timeline = _normalize_timeline_buckets(timeline_buckets)

    lan_ip_buckets = (
        ((aggs.get("lan_devices") or {}).get("top_ips") or {}).get("buckets") or []
    )
    top_devices_by_ip: list[dict[str, Any]] = []
    for b in lan_ip_buckets:
        ip_str = str(b.get("key") or "").strip()
        if not ip_str:
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
        "track_total_hits": True,
        "query": {
            "bool": {
                "filter": [
                    {"range": {"@timestamp": {"gte": es_gte}}},
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
) -> dict[str, Any]:
    """Construct the Elasticsearch search query for chronological recent DNS queries by a device."""
    clean_ip = validate_ipv4_address(ipv4_address)
    _, es_gte, _ = resolve_time_window(window)
    safe_limit = max(1, min(int(limit), 100))
    safe_search = sanitize_domain_search(domain_search)

    filters: list[dict[str, Any]] = [
        {"range": {"@timestamp": {"gte": es_gte}}},
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
        total_events = int(hits_total_obj.get("value") or 0)
    else:
        total_events = int(hits_total_obj or 0)

    total_bytes = int(float((aggs.get("total_bytes") or {}).get("value") or 0))
    provider_counts = _extract_bucket_map((aggs.get("by_provider") or {}).get("buckets") or [])
    action_counts = _extract_bucket_map((aggs.get("by_action") or {}).get("buckets") or [])

    first_active_at = (aggs.get("first_activity") or {}).get("value_as_string")
    last_active_at = (aggs.get("last_activity") or {}).get("value_as_string")

    timeline_buckets = (aggs.get("timeline") or {}).get("buckets") or []
    timeline = _normalize_timeline_buckets(timeline_buckets)

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
        "track_total_hits": True,
        "query": {
            "bool": {
                "filter": [
                    {"range": {"@timestamp": {"gte": es_gte}}},
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
) -> dict[str, Any]:
    """Construct the ES search query for chronological recent DNS queries across a group."""
    clean_ips = validate_ipv4_list(ipv4_addresses)
    _, es_gte, _ = resolve_time_window(window)
    safe_limit = max(1, min(int(limit), 100))
    safe_search = sanitize_domain_search(domain_search)

    filters: list[dict[str, Any]] = [
        {"range": {"@timestamp": {"gte": es_gte}}},
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


class ElasticsearchServiceClient:
    """Async client wrapper for Elasticsearch 9.4.3 read-only operations."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._url = settings.elasticsearch_url
        self._api_key = settings.elasticsearch_api_key.get_secret_value()
        self._verify_certs = settings.elasticsearch_verify_ssl
        self._ca_certs = settings.elasticsearch_ca_cert_path.strip() or None
        self._timeout = settings.elasticsearch_timeout_seconds
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
    ) -> dict[str, Any]:
        """Execute network-wide traffic and DNS aggregation query against logs-pfsense.log*."""
        win_key, _, _ = resolve_time_window(window)
        body = build_network_overview_query(window=win_key, tz_name=self._tz, top_n=top_n)
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            resp = await client.search(
                index=target_pattern,
                body=body,
                ignore_unavailable=True,
                allow_no_indices=True,
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
        )
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            aggs_resp = await client.search(
                index=target_pattern,
                body=aggs_body,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            recent_resp = await client.search(
                index=target_pattern,
                body=recent_body,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            return normalize_device_analytics_response(
                dict(aggs_resp),
                dict(recent_resp),
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
        )
        target_pattern = ",".join(self._index_patterns)
        client = self.create_es_client()
        try:
            aggs_resp = await client.search(
                index=target_pattern,
                body=aggs_body,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            recent_resp = await client.search(
                index=target_pattern,
                body=recent_body,
                ignore_unavailable=True,
                allow_no_indices=True,
            )
            return normalize_group_analytics_response(
                dict(aggs_resp),
                dict(recent_resp),
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
