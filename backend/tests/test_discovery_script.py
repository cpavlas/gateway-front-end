"""Unit tests for Step 1.4 discovery probe and report generation."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

from app.clients.elasticsearch import ElasticsearchServiceClient
from app.config import Settings
from app.services.discovery_probe import (
    flatten_es_mappings,
    redact_sensitive_value,
    render_discovery_markdown,
    run_full_discovery,
)


def test_redact_sensitive_value_masks_ips_and_macs() -> None:
    """redact_sensitive_value replaces IPv4 and MAC strings while preserving keys."""
    sample = {
        "source": {"ip": "192.168.1.42", "mac": "aa:bb:cc:11:22:33", "port": 51234},
        "message": "DHCPACK on 192.168.1.42 to aa:bb:cc:11:22:33 via igb0",
        "nested": ["10.0.0.1", 123],
    }
    redacted = redact_sensitive_value(sample)
    assert redacted["source"]["ip"] == "<REDACTED_IP>"
    assert redacted["source"]["mac"] == "<REDACTED_MAC>"
    assert redacted["source"]["port"] == 51234
    assert "<REDACTED_IP>" in redacted["message"]
    assert "<REDACTED_MAC>" in redacted["message"]
    assert redacted["nested"][0] == "<REDACTED_IP>"


def test_flatten_es_mappings_extracts_nested_and_multifields() -> None:
    """flatten_es_mappings flattens nested properties and multi-fields into dot-notation."""
    raw_mapping = {
        ".ds-logs-pfsense.log-default-2026.10.31-000001": {
            "mappings": {
                "properties": {
                    "@timestamp": {"type": "date"},
                    "source": {
                        "properties": {
                            "ip": {"type": "ip"},
                            "port": {"type": "long"},
                        }
                    },
                    "dns": {
                        "properties": {
                            "question": {
                                "properties": {
                                    "name": {
                                        "type": "keyword",
                                        "fields": {"text": {"type": "text"}},
                                    }
                                }
                            }
                        }
                    },
                }
            }
        }
    }
    flat = flatten_es_mappings(raw_mapping)
    assert flat["@timestamp"] == "date"
    assert flat["source.ip"] == "ip"
    assert flat["source.port"] == "long"
    assert flat["dns.question.name"] == "keyword"
    assert flat["dns.question.name.text"] == "text"


@respx.mock
async def test_run_full_discovery_generates_markdown_report(
    test_settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """run_full_discovery probes OPNsense and ES and writes a complete markdown report."""
    respx.get("https://opnsense.example.local/api/diagnostics/interface/get_arp").mock(
        return_value=httpx.Response(
            200,
            json=[{"ip": "192.168.1.10", "mac": "aa:bb:cc:dd:ee:ff", "intf": "lan"}],
        )
    )
    respx.get("https://opnsense.example.local/api/dnsmasq/leases/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "rows": [
                    {"address": "192.168.1.10", "hwaddr": "aa:bb:cc:dd:ee:ff", "hostname": "tv"}
                ]
            },
        )
    )
    respx.get(
        "https://opnsense.example.local/api/firewall/alias_util/list/gateway_blocked_devices"
    ).mock(return_value=httpx.Response(200, json={"rows": []}))

    mock_es = AsyncMock()
    mock_es.info.return_value = {"cluster_name": "es-prod", "version": {"number": "9.4.3"}}
    mock_es.count.return_value = {"count": 500}
    mock_es.indices.get_mapping.return_value = {
        ".ds-logs-pfsense.log-default-000001": {
            "mappings": {
                "properties": {
                    "@timestamp": {"type": "date"},
                    "source": {"properties": {"ip": {"type": "ip"}}},
                    "network": {"properties": {"bytes": {"type": "long"}}},
                    "dns": {
                        "properties": {"question": {"properties": {"name": {"type": "keyword"}}}}
                    },
                }
            }
        }
    }
    mock_es.search.return_value = {
        "hits": {
            "hits": [
                {
                    "_source": {
                        "@timestamp": "2026-10-31T12:00:00Z",
                        "source": {"ip": "192.168.1.10"},
                        "process": {"name": "filterlog"},
                    }
                }
            ]
        },
        "aggregations": {
            "ProcessNames": {"buckets": [{"key": "filterlog", "doc_count": 480}]},
            "EventProviders": {"buckets": [{"key": "filterlog", "doc_count": 480}]},
            "EventActions": {"buckets": [{"key": "pass", "doc_count": 450}]},
            "HasDnsQuestion": {"doc_count": 20},
            "HasNetworkBytes": {"doc_count": 480},
        },
    }

    monkeypatch.setattr(ElasticsearchServiceClient, "create_es_client", lambda self: mock_es)

    report_path = tmp_path / "ES_SCHEMA_DISCOVERY.md"
    opn_data, es_data = await run_full_discovery(test_settings, report_path)

    assert opn_data["arp_entry_count"] == 1
    assert es_data["dns_question_doc_count"] == 20
    assert report_path.exists()
    content = report_path.read_text(encoding="utf-8")
    assert "source.ip" in content
    assert "<REDACTED_IP>" in content
    assert "192.168.1.10" not in content


def test_render_discovery_markdown_handles_errors() -> None:
    """render_discovery_markdown renders warning callout when probe encounters an error."""
    md = render_discovery_markdown(
        opn_data={
            "health": {"status": "unhealthy", "latency_ms": 12.0, "message": "403 Forbidden"}
        },
        es_data={
            "health": {"status": "unhealthy", "latency_ms": 5.0, "message": "401 Unauthorized"},
            "error": "401 Unauthorized",
        },
    )
    assert "WARNING" in md
    assert "401 Unauthorized" in md
