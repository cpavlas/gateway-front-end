# 05 — Firewall Inspector, GeoIP Maps & WAN Blocking (`Firewall` Tab)

> **Quick Navigation:** [Wiki Home](Home.md) · [01. Setup & OPNsense](01-Installation-and-OPNsense-Setup.md) · [02. Devices & Quotas](02-Devices-Groups-and-YouTube-Quotas.md) · [03. Timers & Schedules](03-Timers-and-Recurring-Schedules.md) · [04. Analytics & Blocking](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md) · **05. Firewall & WAN Blocking** · [06. System & Admin](06-System-Administration-HA-and-Troubleshooting.md)

The **`Firewall`** tab delivers live OPNsense `filterlog` packet visibility, D-NAT open port inspection, external WAN scanner GeoIP mapping, persistent OPNsense WAN IP blocking (`gateway_wan_blocked_ips`), and an interactive packet log explorer.

---

## 1. Firewall KPIs & `Pass` / `Block` Timeline

- **KPI Summary Cards:** Total Packets, Allowed Packets, Blocked Packets *(with `%`)*, Inbound vs. Outbound packet split, Total Bytes, and Active Open WAN Ports.
- **Timeline Bar Graph (`Stacked` | `Total`):** Switch time windows (`Today`, `1h`, `24h`, `7d`, `30d`) and configure **Auto-Refresh** (`Off`, `5s`, `30s`, `1m`, `5m`). Periodic ticks update live window snapshots across all panels and advance `Updated: HH:MM:SS`.

---

## 2. `Noisy LAN Devices` & `Active Inbound WAN Exposure (Open Ports)`

### Noisy LAN Devices
- Highlights internal LAN hosts generating the highest blocked or abnormal firewall event volume.
- Each row features compact icon-only **Block / Unblock** controls *(for non-protected devices)* alongside a Magnifying Glass (**`Inspect`**) button that opens **`DeviceAnalyticsDrawer`** directly over the **`Firewall`** tab.

### Active Inbound WAN Exposure (Open Ports)
- Combines **30-day open WAN port discovery** with configured OPNsense **Destination NAT (`/api/firewall/d_nat/searchRule`)** rules so forwarded ports remain visible even when traffic during a short window (`Today`, `1h`) is zero *(e.g., WireGuard `51820/UDP`)*.
- Displays `external_port:destination_port`, transport protocol, friendly **OPNsense D-NAT descriptions** (for example, *Plex Media Server* or *WireGuard VPN*), **`Last Seen`** timestamps, and a clickable **External IPs** count badge.

---

## 3. Open Port Connected External IPs Side-Drawer (`FirewallOpenPortSessionsDrawer`)

Click any **External IPs** badge inside **Active Inbound WAN Exposure (Open Ports)** to slide open the session drilldown drawer *(powered by Elasticsearch Batch-5 `docvalue_fields` + `breadth_first` queries)*:
- **Country Breakdown Summary Bar:** Visual distribution of connecting countries at the top of the drawer.
- **Per-IP Session Details:** Shows external IP, ISP / BGP ASN organization, GeoIP city/region/country **clickable Google Maps link**, connection duration (`first_seen -> last_seen` + active minutes), source ports, TCP flags, IP TTL, and recent packet rows.
- **`Block External IP at WAN` Toggle:** Immediately adds a public WAN IP to OPNsense alias `gateway_wan_blocked_ips` (persisting via OPNsense config API + `alias_util`) and severs live connections via `kill_states`, toggling the button state cleanly to **`Blocked at WAN`** *(clicking again unblocks)*.

---

## 4. `Top Blocked External WAN Scanners` & Clickable Google Maps GeoIP Links

- **GeoIP Badges & Google Maps Links:** Each top blocked WAN scanner displays Country/City GeoIP badges when resolved. Clicking a GeoIP location link opens a **new browser tab** to Google Maps (`maps.google.com/?api=1&query=...`) centered with a marker pin at those coordinates (or encoded location).
- **Click-to-Filter Scanner IP:** Click any external scanner IP to filter the **Packet Log Explorer** below to traffic from/to that IP.
- **1-Click WAN Block / Unblock:** Block or unblock persistent WAN scanners directly from the scanner card.

---

## 5. `Blocked External WAN IPs` (`gateway_wan_blocked_ips`) Management Card

Added in **`v1.3.0`**, this dedicated panel synchronizes directly with OPNsense **Firewall -> Aliases -> `gateway_wan_blocked_ips`**:
- **Auto-Provisioned & Persistent:** Created automatically by the backend on startup if absent, and kept in sync across both OPNsense saved config (`get_item` -> `set_item` -> `reconfigure`) and live `pf` tables (`alias_util`).
- **Manual Public IPv4 Block Input:** Enter any valid public WAN IPv4 address *(private RFC1918 LAN IPs and `OPNSENSE_PROTECTED_IPS` are automatically rejected with a validation error)* and optional reason to add it to `gateway_wan_blocked_ips`.
- **Click-to-Filter & 1-Click Unblock:** Click any listed IP pill to filter the Packet Log Explorer below, or click **`Unblock`** to remove the IP from OPNsense `gateway_wan_blocked_ips` immediately.

---

## 6. Interactive Searchable Packet Log Explorer & CSV / JSON Export

1. **Click-to-Filter Table Cells:** Click any **`Interface`**, **`Protocol`**, **`Source IP`**, **`Destination IP`**, or **`Port`** cell directly inside the packet log table to add a removable filter chip above the table.
2. **Stackable Filters & Quick Clear:** Combine multiple active filter chips simultaneously (e.g., Protocol `tcp` + Port `443`), remove individual chips via `×`, or reset filters in one click.
3. **Row Limit Selector:** Switch between **`50`**, **`100`**, and **`250`** recent packet log rows.
4. **Structured Export:** Click **Export CSV** or **Export JSON** to download the active packet log view for offline analysis.

---

**Previous:** [<- 04. Analytics, App Telemetry & Domain/ASN Blocking](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md) · **Next:** [06. System Administration, HA, Users & Backups ->](06-System-Administration-HA-and-Troubleshooting.md)
