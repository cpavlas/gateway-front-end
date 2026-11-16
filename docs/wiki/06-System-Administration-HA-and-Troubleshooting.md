# 06 — System Administration, HA, Users & Backups (`System` Tab)

> **Quick Navigation:** [Wiki Home](Home.md) · [01. Setup & OPNsense](01-Installation-and-OPNsense-Setup.md) · [02. Devices & Quotas](02-Devices-Groups-and-YouTube-Quotas.md) · [03. Timers & Schedules](03-Timers-and-Recurring-Schedules.md) · [04. Analytics & Blocking](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md) · [05. Firewall & WAN Blocking](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md) · **06. System & Admin**

The **`System`** tab provides live upstream diagnostics, multi-node High Availability runtime configuration, Application Telemetry visibility management, multi-user access control, filterable audit logs, and full JSON configuration backup/restore.

---

## 1. Dynamic Connectivity Header & 4 Service Health Cards

- **Live Connected Server Version Header (`v1.3.0`):** Under **"System Connectivity & Telemetry Status"**, the page header automatically interpolates the live connected **OPNsense** and **Elasticsearch** server versions reported by `/api/v1/system/health`.
- **4 Vertical Service Cards:**
  1. **OPNsense:** Gateway reachability, alias availability, and latency (`ms`).
  2. **Elasticsearch:** Cluster status (`GREEN` / `YELLOW` / `RED`), node count, assigned/unassigned/relocating shard counts, total indexed document count, per-node health breakdown, and latency.
  3. **Plex Media Server:** Reachability, active streaming session count, and latency *(or unconfigured badge if omitted)*.
  4. **Local SQLite Store:** On-disk database size *(including WAL/SHM bytes)*, total SQLite record count (`devices`, `groups`, `timers`, `schedules`, `custom_blocked_targets`, `audit_logs`), and latency.
- **Collapsible Technical Details:** Expand **Technical Details** inside any card for structured diagnostic metadata, alongside the **Gateway Enforcement & Inventory Synchronization Summary** panel (showing tracked devices, YouTube-blocked devices, custom Domain/ASN rules, and active schedules).

---

## 2. Runtime Integration Settings, Multi-Node HA & **`Test All Connections`**

Admins can manage upstream endpoints directly in the browser under **Integration Settings** *(persisted encrypted-at-rest in SQLite, overriding `.env` dynamically with a **Reset to `.env`** button)*:
- **Multi-Node HA URL Inputs (`+ Add URL` / `Remove`):** Add multiple node URLs for **Elasticsearch** or **Plex Media Server** with per-URL live health dots; failed primary nodes fail over automatically to healthy cluster peers.
- **Custom CA Certificates:** Supply `OPNsense CA Cert Path` or `Elasticsearch CA Cert Path` for internal PKI / self-signed TLS.
- **`Test All Connections` Popup Modal:** Tests OPNsense, every configured Elasticsearch node, Plex, and SQLite concurrently. When a service has multiple configured nodes (such as a 3-node Elasticsearch cluster), the header summarizes `OK (XX.X ms)` using the **rounded average latency** alongside individual per-node results underneath.

### Application Telemetry Visibility (`System` <-> `Analytics` Sync)
Check or uncheck any of the **9 telemetry categories** (`YouTube` and `Plex` enabled by default; `Netflix`, `Disney+`, `Twitch`, `TikTok`, `Discord`, `Facebook & Threads`, `Gaming` opt-in). Changes save to SQLite (`enabled_telemetry_apps`) and stay bi-directionally synchronized with the **Configure Apps** modal on the **`Analytics`** tab.

---

## 3. Multi-User Accounts, RBAC & User Preferences

### Role-Based Access Control (`Admin` vs. `Operator`)
Under **User Accounts & Access Management**:
- **`Admin` Role:** Full control over device blocking, groups, quotas, timers, schedules, firewall WAN/domain/ASN blocking, runtime settings, user management, and backup/restore.
- **`Operator` Role:** Read-only visibility across dashboard telemetry, inventory, and health without access to mutating policy/admin endpoints (`403 Forbidden` enforced server-side).
- **Protected Default `admin`:** The built-in primary `admin` account cannot be deleted or disabled. Admins can create accounts, reset passwords, or toggle `Admin` <-> `Operator` roles on secondary accounts.

### Header User Menu (`Change My Password` & 5 Color Themes)
Click your signed-in username in the top-right header:
- **`Change My Password`:** Opens a centered modal popup (`Current Password`, `New Password`, `Confirm Password`) for self-service password updates.
- **5 Dark-Room Color Themes** *(persisted per user in SQLite)*:
  1. `Default Slate`
  2. `Crimson & Obsidian`
  3. `Ocean & Navy`
  4. `Emerald & Forest`
  5. `Amber & Carbon`

---

## 4. Audit & Event History + Performance Analysis

Auto-loads in a collapsible panel (`System -> Audit & Event History`) with per-user action attribution (`actor`), paginated navigation (`50` / `100` / `250` page sizes), **Export CSV**, and category filters covering all 12 `audit_label` badges:
- `AUTH_EVENT`, `USER_MGMT`, `SETTINGS_CHANGE`, `DEVICE_CONTROL`, `YOUTUBE_CONTROL`, `GROUP_CONTROL`, `TIMER_OVERRIDE`, `SCHEDULE_CHANGE`, `CONFIG_BACKUP`, `DIAGNOSTIC_ERROR` *(auto-logged upstream timeouts/errors)*, `PERFORMANCE_ANALYSIS` *(telemetry load-time ms, cache hit vs. miss, window & event count)*, and `SYSTEM`.
- **Maintenance:** Admins can run **Prune / Clear Old Performance Logs** (`90`-day general retention + selective `PERFORMANCE_ANALYSIS` log cleanup) to keep SQLite compact.

---

## 5. Configuration Backup & Restore + Troubleshooting Quick Checks

### JSON Configuration Backup & Restore
- **Export Backup:** Downloads a portable JSON snapshot of devices *(nicknames, notes, protected flags, manual block states, archive status keyed by MAC)*, Device Groups *(including member MACs and Daily YouTube Quotas)*, Custom Domain/ASN blocked targets, and Recurring Schedules.
- **Restore Backup:** Upload any exported JSON file to restore policies cleanly onto a fresh container or new SQLite volume.

### Troubleshooting Quick Checks

| Symptom | Likely Cause & Where to Check |
| :--- | :--- |
| **`YouTube` block toggle fails or shows a warning banner** | Verify `svc_gateway_ui` has `Firewall: Alias: Edit` and `Diagnostics: Show States` privileges in OPNsense and that `gateway_youtube_blocked_devices` / `gateway_youtube_domains` LAN Reject rules exist ([Setup Guide](../API_KEYS_SETUP.md#step-1d-enable-selective-youtube-blocking-on-opnsense-keep-plex--general-internet-allowed)). |
| **Open WAN port shows zero traffic or missing friendly label** | Confirm `svc_gateway_ui` has the `Firewall: NAT: Port Forward` privilege so D-NAT descriptions (`/api/firewall/d_nat/searchRule`) load properly. |
| **WAN IP block does not block external probes in OPNsense** | Confirm `Firewall -> Rules -> WAN` has the top-priority `Block`/`Drop` rule matching Source `gateway_wan_blocked_ips` ([Setup Guide](../API_KEYS_SETUP.md#step-1f-external-wan-ip-blocklist-alias-gateway_wan_blocked_ips)). |
| **Elasticsearch card shows `degraded` or missing Plex card** | Open **`System -> Test All Connections`** and inspect **`Audit & Event History`** (`DIAGNOSTIC_ERROR`) for exact node URL, TLS CA, or API key errors. |

---

**Previous:** [<- 05. Firewall Inspector, GeoIP Maps & WAN Blocking](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md) · [Back to Wiki Home](Home.md) · [Back to Project README ->](../../README.md)
