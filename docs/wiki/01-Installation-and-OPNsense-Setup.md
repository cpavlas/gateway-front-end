# 01 — Installation, First-Boot & OPNsense Setup

> **Quick Navigation:** [Wiki Home](Home.md) · **01. Setup & OPNsense** · [02. Devices & Quotas](02-Devices-Groups-and-YouTube-Quotas.md) · [03. Timers & Schedules](03-Timers-and-Recurring-Schedules.md) · [04. Analytics & Blocking](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md) · [05. Firewall & WAN Blocking](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md) · [06. System & Admin](06-System-Administration-HA-and-Troubleshooting.md)

---

## 1. Prerequisites

| Component | Recommended / Validated Version | Purpose |
| :--- | :--- | :--- |
| **Docker Engine & Compose** | Docker `24+` with `docker compose` v2 | Runs the unified backend (`FastAPI` + `Python 3.12`) and frontend SPA (`React` + `Vite`) in one container on port `8080`. |
| **OPNsense Gateway** | `OPNsense 26.7.7-amd64` (25.7+ MVC snake_case API compatible) | ARP table, Dnsmasq DHCP leases, Firewall Aliases, Destination NAT mappings, and state termination (`kill_states`). |
| **Elasticsearch** | `Elasticsearch 9.4.3` with **Elastic `pfSense` Integration (`v1.25.4`)** | Stores Unbound DNS logs and Firewall `filterlog` events in `logs-pfsense.log*`. |
| **Plex Media Server** *(Optional)* | Modern Plex Media Server with `X-Plex-Token` | Supplies live *Now Playing* session details and playback history correlation (`FB-P9-005`). |

---

## 2. Single-Container Docker Deployment

1. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```
2. **Generate a strong session signing secret** (`>= 32` characters, 64 hex recommended):
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
   Paste the output into `APP_SECRET_KEY` inside `.env`.
3. **Configure upstream connection defaults and protected IPs** inside `.env`:
   - `OPNSENSE_BASE_URL`, `OPNSENSE_API_KEY`, `OPNSENSE_API_SECRET`
   - `OPNSENSE_PROTECTED_IPS`: Comma-separated list of gateway, server, and DNS IPs that must **never** be blocked (for example, `192.168.1.1`).
   - `ELASTICSEARCH_URL` *(supports comma-separated multi-node cluster URLs)*, `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_INDEX_PATTERNS=logs-pfsense.log*`
   - *(Optional)* `PLEX_BASE_URL`, `PLEX_API_TOKEN`
   - `ENABLED_TELEMETRY_APPS=youtube,plex` *(initial default visible application telemetry categories; editable later in the UI).*
4. **Build and launch the container:**
   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env up -d --build
   ```
5. Verify the container reaches `Up ... (healthy)` on `0.0.0.0:8080->8000/tcp` and open `http://localhost:8080`.

> **Persistence Note:** All SQLite data (`devices`, `device_groups`, `temporary_overrides`, `recurring_schedules`, `blocked_targets`, `users`, `runtime_settings`, `plex_session_logs`, `audit_logs`) is stored on the host bind volume mapped to `/app/data/gateway.db`.

---

## 3. First-Boot Admin Setup vs. `.env` Seeding

- **Clean Container First-Boot UI Setup:** If `ADMIN_PASSWORD` is left blank or set to a placeholder in `.env` and no `admin` user exists in SQLite yet, `http://localhost:8080` displays a **First-Boot Administrator Setup** screen on launch. Set your `admin` password directly in the browser to initialize the database and sign in immediately.
- **Automated `.env` Seeding:** If a non-placeholder `ADMIN_PASSWORD` is configured in `.env`, the backend seeds the initial `admin` user automatically on startup so upgrades and automated deployments require no interactive prompt.
- **Additional Users:** Once signed in as `admin`, you can create additional `Admin` or read-only `Operator` accounts in **`System -> User Accounts & Access Management`**.

---

## 4. OPNsense Aliases & Least-Privilege API Setup

For complete step-by-step screenshots/instructions for creating firewall rules and least-privilege accounts, see [`docs/API_KEYS_SETUP.md`](../API_KEYS_SETUP.md). Below is the `v1.3.0` summary reference:

### Managed Firewall Aliases (`Firewall -> Aliases`)

| Alias Name (Default) | Type | Auto-Managed By | Enforcement Rule Location & Action |
| :--- | :---: | :--- | :--- |
| **`gateway_blocked_devices`** | `Host(s)` | `Devices` & `Schedules` | **LAN Rule (`Reject`)**: Source `gateway_blocked_devices` -> Destination `!RFC1918_Private_Networks` *(blocks internet while keeping local LAN/DHCP working)*. |
| **`gateway_youtube_blocked_devices`** | `Host(s)` | `Devices`, `Schedules` & Group Quotas | **LAN Rule (`Reject`)**: Source `gateway_youtube_blocked_devices` -> Destination `gateway_youtube_domains` *(blocks YouTube QUIC/HTTPS only; keeps Plex & web working)*. |
| **`gateway_youtube_domains`** | `Host(s)` | Auto-seeded (`13` domains) | Holds YouTube / Google Video FQDNs resolved via OPNsense `filterdns`. |
| **`gateway_custom_blocked_domains`** | `Host(s)` | `Analytics` Custom Domain Blocking | **LAN Rule (`Reject`)**: Destination `gateway_custom_blocked_domains`. |
| **`gateway_custom_blocked_asns`** | `BGP ASN` | `Analytics` Custom ASN Blocking | **LAN Rule (`Reject`)**: Destination `gateway_custom_blocked_asns`. |
| **`gateway_custom_blocked_devices`** | `Host(s)` | `Analytics` Per-Device Custom Rules | Source alias when scoping custom domain/ASN rules to selected devices. |
| **`gateway_wan_blocked_ips`** | `Host(s)` | Startup boot & `Firewall` WAN Blocking | **WAN Rule (`Block`/`Drop`)**: Interface `WAN`, Direction `in`, Source `gateway_wan_blocked_ips` -> Destination `any`. |

### Required OPNsense `svc_gateway_ui` Group Privileges (`System -> Access -> Groups`)
Never use a `root` API key. Assign **only** these 7 privileges to `gateway_controller` and create a scrambled-password API user (`svc_gateway_ui`):
1. `Firewall: Aliases`
2. `Firewall: Alias: Edit`
3. `Diagnostics: PF Table IP addresses`
4. `Diagnostics: ARP Table`
5. `Diagnostics: Show States`
6. `Services: Dnsmasq DNS/DHCP: Settings`
7. `Firewall: NAT: Port Forward` *(required to read D-NAT descriptions on open WAN ports)*

---

## 5. Elasticsearch & Plex Credentials

- **Elasticsearch (`9.4.3`):** Generate a scoped API key in Kibana Console (`"cluster": ["monitor"]` + `"indices": [{"names": ["logs-pfsense.log*"], "privileges": ["read", "view_index_metadata"]}]`) and paste its Base64 `encoded` token into `ELASTICSEARCH_API_KEY`. Multiple comma-separated node URLs are supported for automatic HA failover.
- **Live Settings Overrides:** All OPNsense, Elasticsearch, and Plex credentials can also be modified live inside **`System -> Integration Settings`** (encrypted at rest in SQLite, with a 1-click **Reset to `.env`** fallback).

---

**Next Chapter:** [02 — Managing Devices, Groups & Daily YouTube Quotas ->](02-Devices-Groups-and-YouTube-Quotas.md)
