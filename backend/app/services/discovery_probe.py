"""Read-only environment & schema discovery probe for OPNsense 26.7 and Elasticsearch 9.4.3."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.clients.elasticsearch import ElasticsearchServiceClient
from app.clients.opnsense import OPNsenseClient, ServiceHealthStatus
from app.config import Settings

IPV4_REGEX = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
MAC_REGEX = re.compile(r"\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b")

KEY_ECS_CANDIDATES = (
    "@timestamp",
    "event.action",
    "event.dataset",
    "event.provider",
    "process.name",
    "source.ip",
    "source.port",
    "source.mac",
    "source.bytes",
    "client.ip",
    "destination.ip",
    "destination.port",
    "destination.domain",
    "destination.bytes",
    "destination.as.organization.name",
    "destination.geo.country_iso_code",
    "network.bytes",
    "network.packets",
    "network.transport",
    "network.direction",
    "network.protocol",
    "observer.ingress.interface.name",
    "observer.egress.interface.name",
    "dns.question.name",
    "dns.question.registered_domain",
    "dns.question.subdomain",
    "dns.question.type",
    "dns.answers.data",
    "url.domain",
    "url.full",
    "tls.client.server_name",
    "http.request.method",
    "rule.name",
    "rule.description",
    "message",
)


def redact_sensitive_value(value: Any) -> Any:
    """Recursively redact IPv4 and MAC addresses in sample documents while keeping structure."""
    if isinstance(value, dict):
        return {k: redact_sensitive_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_sensitive_value(item) for item in value]
    if isinstance(value, str):
        redacted = IPV4_REGEX.sub("<REDACTED_IP>", value)
        redacted = MAC_REGEX.sub("<REDACTED_MAC>", redacted)
        return redacted
    return value


def flatten_es_mappings(mappings_response: dict[str, Any]) -> dict[str, str]:
    """Flatten nested Elasticsearch index mappings into dot-notation field -> type pairs."""
    flat_fields: dict[str, str] = {}

    def _walk_properties(props: dict[str, Any], prefix: str = "") -> None:
        for field_name, field_def in props.items():
            if not isinstance(field_def, dict):
                continue
            full_path = f"{prefix}.{field_name}" if prefix else field_name
            field_type = field_def.get("type")
            if field_type:
                flat_fields[full_path] = str(field_type)
            nested_props = field_def.get("properties")
            if isinstance(nested_props, dict):
                _walk_properties(nested_props, full_path)
            multi_fields = field_def.get("fields")
            if isinstance(multi_fields, dict):
                for sub_name, sub_def in multi_fields.items():
                    if isinstance(sub_def, dict) and sub_def.get("type"):
                        flat_fields[f"{full_path}.{sub_name}"] = str(sub_def["type"])

    for _index_name, index_data in mappings_response.items():
        if not isinstance(index_data, dict):
            continue
        mappings_obj = index_data.get("mappings", {})
        if isinstance(mappings_obj, dict):
            props = mappings_obj.get("properties", {})
            if isinstance(props, dict):
                _walk_properties(props)

    return dict(sorted(flat_fields.items()))


async def probe_opnsense_environment(settings: Settings) -> dict[str, Any]:
    """Run read-only discovery against OPNsense ARP, Dnsmasq leases, and block alias."""
    client = OPNsenseClient(settings)
    health: ServiceHealthStatus = await client.check_health()

    arp_keys: list[str] = []
    arp_sample: dict[str, Any] = {}
    lease_keys: list[str] = []
    lease_sample: dict[str, Any] = {}

    try:
        arp_rows = await client.get_arp_table()
        if arp_rows and isinstance(arp_rows[0], dict):
            arp_keys = sorted(arp_rows[0].keys())
            arp_sample = redact_sensitive_value(arp_rows[0])
    except Exception:
        arp_rows = []

    try:
        lease_rows = await client.get_dnsmasq_leases()
        if lease_rows and isinstance(lease_rows[0], dict):
            lease_keys = sorted(lease_rows[0].keys())
            lease_sample = redact_sensitive_value(lease_rows[0])
    except Exception:
        lease_rows = []

    return {
        "health": health.model_dump(),
        "arp_entry_count": len(arp_rows),
        "arp_item_keys": arp_keys,
        "arp_redacted_sample": arp_sample,
        "dnsmasq_lease_count": len(lease_rows),
        "dnsmasq_item_keys": lease_keys,
        "dnsmasq_redacted_sample": lease_sample,
    }


async def probe_elasticsearch_environment(settings: Settings) -> dict[str, Any]:
    """Run read-only schema and aggregation discovery against Elasticsearch 9.4.3."""
    es_service = ElasticsearchServiceClient(settings)
    health = await es_service.check_health()
    target_pattern = ",".join(settings.es_index_pattern_list)

    result: dict[str, Any] = {
        "health": health.model_dump(),
        "index_pattern": target_pattern,
        "backing_indices": [],
        "total_mapped_fields": 0,
        "matched_ecs_fields": {},
        "all_mapped_fields": {},
        "process_buckets": [],
        "provider_buckets": [],
        "action_buckets": [],
        "dns_question_doc_count": 0,
        "network_bytes_doc_count": 0,
        "sample_documents": [],
        "error": None,
    }

    if health.status == "unhealthy":
        result["error"] = health.message
        return result

    client = es_service.create_es_client()
    try:
        mapping_resp = await client.indices.get_mapping(
            index=target_pattern,
            ignore_unavailable=True,
            allow_no_indices=True,
        )
        mapping_dict = dict(mapping_resp)
        result["backing_indices"] = sorted(mapping_dict.keys())

        flat_fields = flatten_es_mappings(mapping_dict)
        result["total_mapped_fields"] = len(flat_fields)
        result["all_mapped_fields"] = flat_fields
        result["matched_ecs_fields"] = {
            field: flat_fields[field] for field in KEY_ECS_CANDIDATES if field in flat_fields
        }

        # Run lightweight aggregation to inspect active processes/providers/actions
        agg_body: dict[str, Any] = {
            "ProcessNames": {"terms": {"field": "process.name", "size": 15}},
            "EventProviders": {"terms": {"field": "event.provider", "size": 15}},
            "EventActions": {"terms": {"field": "event.action", "size": 15}},
            "HasDnsQuestion": {"filter": {"exists": {"field": "dns.question.name"}}},
            "HasNetworkBytes": {"filter": {"exists": {"field": "network.bytes"}}},
        }
        search_resp = await client.search(
            index=target_pattern,
            size=2,
            sort=[{"@timestamp": {"order": "desc"}}],
            aggs=agg_body,
        )
        aggs = search_resp.get("aggregations", {})
        result["process_buckets"] = aggs.get("ProcessNames", {}).get("buckets", [])
        result["provider_buckets"] = aggs.get("EventProviders", {}).get("buckets", [])
        result["action_buckets"] = aggs.get("EventActions", {}).get("buckets", [])
        result["dns_question_doc_count"] = int(aggs.get("HasDnsQuestion", {}).get("doc_count", 0))
        result["network_bytes_doc_count"] = int(aggs.get("HasNetworkBytes", {}).get("doc_count", 0))

        hits = search_resp.get("hits", {}).get("hits", [])
        result["sample_documents"] = [
            redact_sensitive_value(hit.get("_source", {})) for hit in hits
        ]
    except Exception as exc:
        result["error"] = f"{exc.__class__.__name__}: {exc}"
    finally:
        await client.close()

    return result


def render_discovery_markdown(
    opn_data: dict[str, Any],
    es_data: dict[str, Any],
    generated_at: str | None = None,
) -> str:
    """Render the complete docs/ES_SCHEMA_DISCOVERY.md report from discovery probe results."""
    ts = generated_at or datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    opn_health = opn_data.get("health", {})
    es_health = es_data.get("health", {})

    opn_status = opn_health.get("status", "unknown").upper()
    opn_latency = opn_health.get("latency_ms", 0)
    es_status = es_health.get("status", "unknown").upper()
    es_latency = es_health.get("latency_ms", 0)
    arp_count = opn_data.get("arp_entry_count", 0)
    lease_count = opn_data.get("dnsmasq_lease_count", 0)
    opn_details = opn_health.get("details", {})
    alias_name = opn_details.get("block_alias", "gateway_blocked_devices")
    blocked_count = opn_details.get("blocked_ip_count", "N/A")

    lines: list[str] = [
        "# Live Environment & Elasticsearch Schema Discovery Report",
        "",
        f"> **Generated At:** `{ts}`  ",
        f"> **OPNsense Status:** `{opn_status}` ({opn_latency} ms)  ",
        f"> **Elasticsearch Status:** `{es_status}` ({es_latency} ms)",
        "",
        "---",
        "",
        "## 1. OPNsense `26.7.7-amd64` API Probe (`https://gateway.sparkle-pony.com`)",
        "",
        f"- **Status Message:** {opn_health.get('message', 'N/A')}",
        f"- **Live ARP Entries (`/api/diagnostics/interface/get_arp`):** `{arp_count}`",
        f"  - **ARP Item Keys:** `{', '.join(opn_data.get('arp_item_keys', [])) or 'None'}`",
        f"- **Dnsmasq DHCP Leases (`/api/dnsmasq/leases/search`):** `{lease_count}`",
        f"  - **Lease Item Keys:** `{', '.join(opn_data.get('dnsmasq_item_keys', [])) or 'None'}`",
        f"- **Block Alias (`{alias_name}`):** `{blocked_count}` currently blocked IPs",
        "",
    ]

    if opn_data.get("arp_redacted_sample"):
        lines.extend(
            [
                "### Redacted Sample ARP Entry",
                "```json",
                json.dumps(opn_data["arp_redacted_sample"], indent=2),
                "```",
                "",
            ]
        )

    if opn_data.get("dnsmasq_redacted_sample"):
        lines.extend(
            [
                "### Redacted Sample Dnsmasq Lease Entry",
                "```json",
                json.dumps(opn_data["dnsmasq_redacted_sample"], indent=2),
                "```",
                "",
            ]
        )

    lines.extend(
        [
            "---",
            "",
            "## 2. Elasticsearch `9.4.3` & `pfSense 1.25.4` Schema (`logs-pfsense.log*`)",
            "",
            f"- **Status Message:** {es_health.get('message', 'N/A')}",
            f"- **Target Index Pattern:** `{es_data.get('index_pattern', 'logs-pfsense.log*')}`",
            f"- **Backing Indices Found:** `{len(es_data.get('backing_indices', []))}` "
            f"(`{', '.join(es_data.get('backing_indices', [])[:5])}`)",
            f"- **Total Mapped Fields:** `{es_data.get('total_mapped_fields', 0)}`",
            f"- **Documents with `network.bytes`:** "
            f"`{es_data.get('network_bytes_doc_count', 0):,}`",
            f"- **Documents with `dns.question.name`:** "
            f"`{es_data.get('dns_question_doc_count', 0):,}`",
            "",
        ]
    )

    if es_data.get("error"):
        lines.extend(
            [
                f"> [!WARNING]\n> **Probe Error / Warning:** `{es_data['error']}`",
                "",
            ]
        )

    lines.extend(
        [
            "### 2.1 Active `process.name` / `event.provider` / `event.action` Breakdown",
            "",
            "| Category | Key | Document Count |",
            "| :--- | :--- | ---: |",
        ]
    )
    for b in es_data.get("process_buckets", []):
        lines.append(f"| `process.name` | `{b.get('key')}` | {b.get('doc_count', 0):,} |")
    for b in es_data.get("provider_buckets", []):
        lines.append(f"| `event.provider` | `{b.get('key')}` | {b.get('doc_count', 0):,} |")
    for b in es_data.get("action_buckets", []):
        lines.append(f"| `event.action` | `{b.get('key')}` | {b.get('doc_count', 0):,} |")
    if not (
        es_data.get("process_buckets")
        or es_data.get("provider_buckets")
        or es_data.get("action_buckets")
    ):
        lines.append("| *(None found)* | — | 0 |")

    lines.extend(
        [
            "",
            "### 2.2 Key Elastic Common Schema (ECS) Fields Verified for Phase 3",
            "",
            "| Field Path | Mapped Type | Phase 3 Usage |",
            "| :--- | :--- | :--- |",
        ]
    )
    matched_ecs: dict[str, str] = es_data.get("matched_ecs_fields", {})
    for field_path, field_type in matched_ecs.items():
        lines.append(f"| `{field_path}` | `{field_type}` | Verified in mapping |")
    if not matched_ecs:
        lines.append("| *(No ECS fields matched yet)* | — | — |")

    if es_data.get("sample_documents"):
        lines.extend(
            [
                "",
                "### 2.3 Redacted Sample Document from `logs-pfsense.log*`",
                "```json",
                json.dumps(es_data["sample_documents"][0], indent=2),
                "```",
            ]
        )

    lines.append("")
    return "\n".join(lines)


async def run_full_discovery(
    settings: Settings, output_path: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Execute both OPNsense and Elasticsearch probes and write docs/ES_SCHEMA_DISCOVERY.md."""
    opn_data = await probe_opnsense_environment(settings)
    es_data = await probe_elasticsearch_environment(settings)
    markdown = render_discovery_markdown(opn_data, es_data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown, encoding="utf-8")
    return opn_data, es_data
