# 04 — Network Analytics, App Telemetry & Domain/ASN Blocking (`Analytics` Tab)

> **Quick Navigation:** [Wiki Home](Home.md) · [01. Setup & OPNsense](01-Installation-and-OPNsense-Setup.md) · [02. Devices & Quotas](02-Devices-Groups-and-YouTube-Quotas.md) · [03. Timers & Schedules](03-Timers-and-Recurring-Schedules.md) · **04. Analytics & Blocking** · [05. Firewall & WAN Blocking](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md) · [06. System & Admin](06-System-Administration-HA-and-Troubleshooting.md)

The **`Analytics`** tab transforms raw **Elasticsearch (`9.4.3` `logs-pfsense.log*`)** Unbound DNS and OPNsense `filterlog` telemetry (plus **Plex Media Server** API sessions) into actionable network insights, per-application duration tracking, client attribution drilldowns, and 1-click Domain/ASN blocking.

---

## 1. Time Windows, Chart Controls & Auto-Refresh

- **Time Window Selector:** Switch between **`Today`** *(default — `00:00` local time to now with 1-hour buckets)*, **`1h`**, **`24h`**, **`7d`**, and **`30d`**.
- **Timeline View Mode (`Stacked` | `Total`):** Toggle stacked bar charts between stacked breakdown series (Allowed vs. Blocked / DNS Queries vs. Firewall Events) and unified Total view, with explicit X-axis time ticks and Y-axis scales.
- **KPI Summary:** Displays Total Events, Allowed vs. Blocked Firewall Packets *(including blocked `%`)*, DNS Query Volume, and Total Traffic Bytes.
- **Auto-Refresh Selector & Live Clock:** Set auto-polling to `Off`, `5s`, `30s`, `1m`, or `5m`. Periodic ticks automatically send `refresh=true` to bypass short-TTL backend caches and advance the `Updated: HH:MM:SS` clock. *(Default background pre-warming keeps standard `24h` and cached views under 25ms.)*

---

## 2. 9-App Telemetry Catalog & Bidirectional **Configure Apps** Modal

Rather than counting noisy background keepalives, active duration (`active_minutes`) is calculated from **5-minute activity slots** exceeding an active traffic/DNS threshold—plus direct **Plex Media Server** heartbeat correlation for L2 Smart TVs that bypass firewall logs.

### Supported Telemetry Categories (`9` Apps)
1. **YouTube** (`youtube`) — *Enabled by default*
2. **Plex** (`plex`) — *Enabled by default (with Tautulli-style live streams)*
3. **Netflix** (`netflix`)
4. **Disney+** (`disney_plus`)
5. **Twitch** (`twitch`)
6. **TikTok** (`tiktok`)
7. **Discord** (`discord`)
8. **Facebook & Threads** (`facebook_threads`) — Combines `facebook.com`, `fbcdn.net`, `instagram.com`, `threads.net`, `threads.com`, and Meta ASN correlation into a single category
9. **Gaming** (`gaming`) — PlayStation Network, Xbox Live, Nintendo, Steam/Valve, and Epic Games

### Configuring Visible Apps (`Analytics` <-> `System` Sync)
- Click **Configure Apps** directly in the **Application Usage Stats** card header on the **`Analytics`** tab to open the modal and check/uncheck which of the 9 categories are displayed.
- Changes save to SQLite (`GET`/`PUT /api/v1/system/telemetry-apps`), immediately re-render **Overview**, **Device Analytics Drawer**, and **Group Analytics Drawer**, and remain synchronized bi-directionally with **`System -> Application Telemetry Visibility`**.

### Expandable App Detail Modal & Plex *Now Playing*
- Click any **Application Usage Card** (such as **Plex** or **YouTube**) to open the centered **`AppUsageDetailModal`**:
  - Displays full untruncated **Plex *Now Playing*** stream cards (media/episode title, Plex user, player/platform, resolution, direct-play vs. transcode status/bitrate, and playback progress `%` bar).
  - Lists the complete ranked **Top Active LAN Devices** breakdown (active minutes, event count, DNS queries, and traffic volume).

---

## 3. Searchable & Sortable Top Active LAN Devices

- **Search & Column Sort:** Filter LAN hosts in real time or click column headers (**Device**, **IPv4 & Vendor**, **DNS Queries**, **Firewall Bytes**, **Total Events**) to sort.
- **Mobile View (`< 640px`):** Streams cleanly to **Device**, **Total Events**, and **Inspect (`Search`)** columns with zero horizontal overflow.
- **Inspect Any Device:** Click any device's Magnifying Glass icon button to open **`DeviceAnalyticsDrawer`** directly over the current tab.

---

## 4. Client Attribution Drilldowns & 1-Click Domain / ASN Blocking

### Client Attribution Breakdown Modal
Click any entry inside **Top Queried Domains (FQDN)**, **Top Registered Root Domains**, or **Top Destination Organizations (ASN)** to open the **Client Attribution** modal:
- Shows which local LAN devices queried that domain or communicated with that BGP ASN (`query_count`, packet count, bytes, and device status).
- Jump straight to a device's Analytics Drawer or block the domain/ASN for that specific device or globally.

### Blocking Domains & ASN Organizations (Per-Device or Global)
1. Click the **`Block`** button next to any domain (`target_type: "domain"`) or ASN (`target_type: "asn"`), either:
   - Globally from the **`Analytics`** Overview panels, OR
   - Scoped to a single device from inside **`DeviceAnalyticsDrawer`**.
2. Blocked rules persist in SQLite (`blocked_targets`, preserved in JSON Config Backups) and sync to OPNsense aliases (`gateway_custom_blocked_domains`, `gateway_custom_blocked_asns`, and `gateway_custom_blocked_devices`).
3. Manage active rules inside the **Blocked Domains & ASN Organizations** panel to **Enable/Disable** toggles or **1-click Unblock / Remove** any rule.

---

## 5. Device & Group Analytics Drawers (`DeviceAnalyticsDrawer` & `GroupAnalyticsDrawer`)

Slide-over drawers open cleanly from **`Devices`**, **`Analytics`**, or **`Firewall`** (`Noisy LAN Devices`) without losing your current page context:
- **Inline Header Controls:** Block/Allow Internet, toggle YouTube access, start/cancel a Temporary Timer directly inside the drawer header, and switch time windows (`Today`, `1h`, `24h`, `7d`, `30d`).
- **24-Hour Hourly Access Profile:** Highlights peak hours of activity (`00:00` – `23:00`).
- **Group Quota Banner & Member Breakdown:** `GroupAnalyticsDrawer` shows daily YouTube quota usage progress and per-member event/byte totals.
- **Searchable Recent DNS Queries:** Filter recent domain lookups by keyword inside any device or group drawer.

---

**Previous:** [<- 03. Temporary Timers & Recurring Schedules](03-Timers-and-Recurring-Schedules.md) · **Next:** [05. Firewall Security Inspector, GeoIP & WAN Blocking ->](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md)
