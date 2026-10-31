# Live Environment & Elasticsearch Schema Discovery Report

> **Generated At:** `2026-10-31 20:43:02 UTC`  
> **OPNsense Status:** `HEALTHY` (348.3 ms)  
> **Elasticsearch Status:** `HEALTHY` (38.71 ms)

---

## 1. OPNsense `26.7.7-amd64` API Probe (`https://gateway.sparkle-pony.com`)

- **Status Message:** OPNsense API connected (ARP, Dnsmasq leases, and block alias verified).
- **Live ARP Entries (`/api/diagnostics/interface/get_arp`):** `59`
  - **ARP Item Keys:** `expired, expires, hostname, intf, intf_description, ip, mac, manufacturer, permanent, type`
- **Dnsmasq DHCP Leases (`/api/dnsmasq/leases/search`):** `61`
  - **Lease Item Keys:** `address, client_id, expire, hostname, hwaddr, iaid, if, if_descr, if_name, is_reserved, lease_type, mac_info, sort_address, sort_client_id, sort_hwaddr`
- **Block Alias (`gateway_blocked_devices`):** `0` currently blocked IPs

### Redacted Sample ARP Entry
```json
{
  "mac": "<REDACTED_MAC>",
  "ip": "<REDACTED_IP>",
  "intf": "vtnet0",
  "expired": false,
  "expires": 758,
  "permanent": false,
  "type": "ethernet",
  "manufacturer": "Juniper Networks",
  "hostname": "",
  "intf_description": "WAN"
}
```

### Redacted Sample Dnsmasq Lease Entry
```json
{
  "expire": 1793529658,
  "hwaddr": "<REDACTED_MAC>",
  "iaid": "",
  "address": "<REDACTED_IP>",
  "hostname": "*",
  "client_id": "*",
  "if": "vtnet1",
  "if_descr": "LAN",
  "if_name": "lan",
  "mac_info": "Private",
  "is_reserved": [],
  "lease_type": "dynamic",
  "sort_address": "<REDACTED_IP>.005",
  "sort_hwaddr": "<REDACTED_IP>.041.046",
  "sort_client_id": ""
}
```

---

## 2. Elasticsearch `9.4.3` & `pfSense 1.25.4` Schema (`logs-pfsense.log*`)

- **Status Message:** Elasticsearch 9.4.3 connected (6,672,331 docs in logs-pfsense.log*).
- **Target Index Pattern:** `logs-pfsense.log*`
- **Backing Indices Found:** `1` (`.ds-logs-pfsense.log-default-2026.10.25-000001`)
- **Total Mapped Fields:** `268`
- **Documents with `network.bytes`:** `3,633,389`
- **Documents with `dns.question.name`:** `3,021,039`

### 2.1 Active `process.name` / `event.provider` / `event.action` Breakdown

| Category | Key | Document Count |
| :--- | :--- | ---: |
| `process.name` | `filterlog` | 3,633,416 |
| `process.name` | `unbound` | 3,025,435 |
| `process.name` | `dnsmasq-dhcp` | 13,202 |
| `event.provider` | `filterlog` | 3,633,416 |
| `event.provider` | `unbound` | 3,025,435 |
| `event.provider` | `dhcpd` | 13,202 |
| `event.action` | `pass` | 2,938,386 |
| `event.action` | `block` | 695,003 |
| `event.action` | `dhcpack` | 3,437 |
| `event.action` | `dhcprequest` | 3,437 |
| `event.action` | `dhcpdiscover` | 3,162 |
| `event.action` | `dhcpoffer` | 3,162 |
| `event.action` | `dhcprelease` | 4 |

### 2.2 Key Elastic Common Schema (ECS) Fields Verified for Phase 3

| Field Path | Mapped Type | Phase 3 Usage |
| :--- | :--- | :--- |
| `@timestamp` | `date` | Verified in mapping |
| `event.action` | `keyword` | Verified in mapping |
| `event.dataset` | `constant_keyword` | Verified in mapping |
| `event.provider` | `keyword` | Verified in mapping |
| `process.name` | `keyword` | Verified in mapping |
| `source.ip` | `ip` | Verified in mapping |
| `source.port` | `long` | Verified in mapping |
| `source.mac` | `keyword` | Verified in mapping |
| `source.bytes` | `long` | Verified in mapping |
| `client.ip` | `ip` | Verified in mapping |
| `destination.ip` | `ip` | Verified in mapping |
| `destination.port` | `long` | Verified in mapping |
| `destination.bytes` | `long` | Verified in mapping |
| `destination.as.organization.name` | `keyword` | Verified in mapping |
| `destination.geo.country_iso_code` | `keyword` | Verified in mapping |
| `network.bytes` | `long` | Verified in mapping |
| `network.packets` | `long` | Verified in mapping |
| `network.transport` | `keyword` | Verified in mapping |
| `network.direction` | `keyword` | Verified in mapping |
| `network.protocol` | `keyword` | Verified in mapping |
| `observer.ingress.interface.name` | `keyword` | Verified in mapping |
| `dns.question.name` | `keyword` | Verified in mapping |
| `dns.question.registered_domain` | `keyword` | Verified in mapping |
| `dns.question.subdomain` | `keyword` | Verified in mapping |
| `dns.question.type` | `keyword` | Verified in mapping |
| `url.domain` | `keyword` | Verified in mapping |
| `url.full` | `wildcard` | Verified in mapping |
| `http.request.method` | `keyword` | Verified in mapping |
| `message` | `match_only_text` | Verified in mapping |

### 2.3 Redacted Sample Document from `logs-pfsense.log*`
```json
{
  "@timestamp": "2026-10-31T20:42:59.000Z",
  "agent": {
    "ephemeral_id": "8fe2fef5-bf43-4745-b2ab-1dc3a86c5896",
    "id": "a17d44cd-9f66-4a3e-b877-06084083af81",
    "name": "proxmoxpony",
    "type": "filebeat",
    "version": "9.4.8"
  },
  "client": {
    "address": "<REDACTED_IP>",
    "ip": "<REDACTED_IP>"
  },
  "data_stream": {
    "dataset": "pfsense.log",
    "namespace": "default",
    "type": "logs"
  },
  "dns": {
    "question": {
      "class": "IN",
      "name": "es1.sparkle-pony.com",
      "registered_domain": "sparkle-pony.com",
      "subdomain": "es1",
      "top_level_domain": "com",
      "type": "AAAA"
    },
    "type": "question"
  },
  "ecs": {
    "version": "8.17.0"
  },
  "elastic_agent": {
    "id": "a17d44cd-9f66-4a3e-b877-06084083af81",
    "snapshot": false,
    "version": "9.4.8"
  },
  "event": {
    "agent_id_status": "verified",
    "category": [
      "network"
    ],
    "dataset": "pfsense.log",
    "ingested": "2026-10-31T20:42:59Z",
    "kind": "event",
    "provider": "unbound",
    "timezone": "-07:00",
    "type": [
      "connection"
    ]
  },
  "input": {
    "type": "udp"
  },
  "log": {
    "level": "info",
    "source": {
      "address": "<REDACTED_IP>:37866"
    },
    "syslog": {
      "priority": 30
    }
  },
  "message": "[44777:0] info: <REDACTED_IP> es1.sparkle-pony.com. AAAA IN",
  "network": {
    "protocol": "dns",
    "type": "ipv4"
  },
  "observer": {
    "name": "gateway.sparkle-pony.com",
    "type": "firewall",
    "vendor": "netgate"
  },
  "process": {
    "name": "unbound",
    "pid": 44777
  },
  "related": {
    "ip": [
      "<REDACTED_IP>"
    ]
  },
  "source": {
    "address": "<REDACTED_IP>",
    "ip": "<REDACTED_IP>"
  },
  "tags": [
    "pfsense",
    "forwarded"
  ]
}
```
