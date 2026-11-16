# 02 — Devices, Groups & Daily YouTube Quotas (`Devices` Tab)

> **Quick Navigation:** [Wiki Home](Home.md) · [01. Setup & OPNsense](01-Installation-and-OPNsense-Setup.md) · **02. Devices & Quotas** · [03. Timers & Schedules](03-Timers-and-Recurring-Schedules.md) · [04. Analytics & Blocking](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md) · [05. Firewall & WAN Blocking](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md) · [06. System & Admin](06-System-Administration-HA-and-Troubleshooting.md)

The **`Devices`** tab is the live command center for LAN host discovery, per-device access toggles, Device Groups & Profiles, temporary overrides, and Group Daily YouTube Quotas.

---

## 1. Device Discovery & IP-Drift Reconciliation

- **Automatic Inventory Sync:** Clicking the **Sync** (refresh icon) button—or letting **Auto-Refresh** (`5s`, `30s`, `1m`, `5m`) tick—queries OPNsense ARP (`get_arp`) and Dnsmasq DHCP leases (`/api/dnsmasq/leases/search`) plus active alias tables (`gateway_blocked_devices`, `gateway_youtube_blocked_devices`).
- **Live Sync Clock:** Next to the header refresh control, `Synced: HH:MM:SS` shows the exact time of the latest OPNsense reconciliation.
- **Automatic IP-Drift Healing:** Devices are keyed in SQLite by normalized **MAC address**. If DHCP assigns a device a new IPv4 address, the backend automatically updates the device record and migrates active full-internet and YouTube alias rules from the old IP to the new IP.

---

## 2. Filtering, Searching & Sorting the Device Table

### Status Filter Pills (`gateway_devices_status_filter`)
On first load, **`Online`** is selected by default and your selected pill is remembered automatically in `localStorage`:
- **`All`**: Shows all active (non-archived) devices.
- **`Online`** *(default)*: Devices currently present in OPNsense live ARP/DHCP tables.
- **`Offline`**: Previously seen devices currently absent from ARP/DHCP.
- **`Blocked`**: Unified filter showing devices with **either** Full Internet Blocked **or** YouTube Blocked (`YT Blocked`).
- **`Protected`**: Critical infrastructure locked against accidental blocking.
- **`Unassigned`**: Devices that do not yet belong to any Device Group.
- **`Archived`**: Previously archived offline devices *(excluded from `All` by default)*.

### Clickable Column Sorting & Search
- **Client-Side Search:** Filter instantaneously by hostname, nickname, IPv4 address, MAC address, vendor OUI, or group name.
- **Sortable Headers:** Click **Online / Status**, **Device / Hostname**, **IPv4**, **Vendor**, or **Access** headers to sort ascending or descending (`IPv4` sorts numerically by octets).
- **Mobile View (`< 640px`):** Displays only **Device / Friendly Name** and **Action Buttons** (`hidden sm:table-cell` hides secondary MAC/vendor/guardrail metadata) so every row fits without horizontal scrolling.

---

## 3. Per-Device Controls (`Actions` Column & Inline Editing)

Each device row provides unified touch-friendly action controls:

| Control | Function |
| :--- | :--- |
| **Inline Nickname / Notes Edit** | Click the pencil icon on a device row to assign a human-friendly display name (e.g., *Alex iPad*), notes, Protected guardrail toggle, or group assignments without leaving the table. |
| **`+ Group` Popover** | Add or remove group memberships for that device in 1 click directly from the table row. |
| **Protected Lock (`Shield`)** | Prevents manual blocking, timers, quotas, or schedules from ever cutting off critical infrastructure (such as your router, switch, NAS, or server). IPs in `OPNSENSE_PROTECTED_IPS` remain permanently locked. |
| **Inspect / Analytics (`BarChart`)** | Opens the slide-over **`DeviceAnalyticsDrawer`** showing live traffic, hourly patterns, app usage, DNS queries, and 1-click Domain/ASN blocking. |
| **YouTube Toggle (`YouTube Logo`)** | Bright red when YouTube is allowed; dimmed/muted when **YouTube Blocked** (`gateway_youtube_blocked_devices` + `kill_states`). Keeps Plex and normal websites accessible. |
| **Timer Popover (`Clock`)** | Starts or cancels a **Pause** or **Bonus Reward** timer override directly from the row and displays a live remaining countdown (`Paused: 25m` / `Bonus: 40m`). |
| **Internet Access (`Allowed` / `Blocked`)** | Immediately blocks or restores full WAN internet access (`gateway_blocked_devices` + `kill_states`) while preserving local LAN/DHCP traffic. |
| **Archive / Restore / Delete** | For **Offline** non-protected devices, click **Archive** to hide stale guest devices from active views, or switch to the **`Archived`** filter pill to **Restore** or permanently **Delete** the record. |

---

## 4. Device Groups & Profiles

Groups allow you to manage families of devices (for example, *Kids Tablets*, *Media Players*, *Guest IoT*) as a single policy unit.

### Collapsible Panel & Unified Card Buttons
- Click the collapse chevron next to **Device Groups & Profiles** to collapse or expand the cards (`localStorage` remembers your preference).
- Each Group Card renders **5 uniform square icon buttons** (`Filter`, `Analytics`, `YouTube`, `Timer`, and `Internet Access`) with identical `h-9 w-9` sizing so bulk actions line up cleanly on desktop and mobile:
  - **Filter (`Filter`):** Filters the Device Inventory table below to members of that group.
  - **Analytics (`BarChart`):** Opens **`GroupAnalyticsDrawer`** combining traffic, top domains, and app usage across all member IPs.
  - **YouTube (`YouTube Logo`):** Bulk-blocks or unblocks YouTube for all non-protected group members.
  - **Timer (`Clock`):** Starts a group-wide **Pause** or **Bonus Reward** timer for all non-protected members.
  - **Internet (`Power` / `Shield`):** Bulk-blocks or restores full internet for all non-protected group members.

### Editing a Group & **Current Group Members** Card
1. Click **Create Group** or the **Edit** icon on any existing Group Card to open `GroupFormModal`.
2. Configure **Name**, **Description**, **Badge Color**, and optional **Daily YouTube Limit (minutes)**.
3. **Current Group Members Card (`v1.3.0`):** When editing an existing profile, the top summary card immediately lists every device currently belonging to the group with a **1-click `Remove` button**, allowing quick cleanup without scrolling through the full device checklist below.
4. Use the searchable **Assign Members** checklist to add additional devices and click **Save Changes**.

---

## 5. Group Daily YouTube Time Quotas (`daily_youtube_limit_minutes`)

1. Set **Daily YouTube Limit (minutes)** (e.g., `60` for `1h / day`) on any Device Group.
2. During background reconciliation (`60s`), the backend sums today's active YouTube watch minutes (from 5-minute active slots since `00:00` local time) across the group's members:
   - **Under Quota:** Group quota allows YouTube (subject to manual blocks or schedules).
   - **Quota Reached (`>= limit`):** Non-protected group members are automatically added to `gateway_youtube_blocked_devices` with `kill_states`. Group cards and `GroupAnalyticsDrawer` display the live quota consumption progress bar.
   - **Strict Bonus Timer Precedence:** If a user grants a **Bonus Reward Timer** (`20m`, `40m`, `60m`, or custom minutes) to a device or group, **YouTube is immediately unlocked for the duration of that Bonus Timer**, overriding the daily quota and any active schedules until the timer expires.
   - **Quota Removal / Increase Auto-Unblock:** If an administrator edits the group to **clear (`None`)** or **increase** the daily limit above today's usage, eligible non-protected members *(excluding any covered by an active `Pause` timer or active `YouTube Only` schedule)* have YouTube unblocked immediately.

---

**Previous:** [<- 01. Installation & OPNsense Setup](01-Installation-and-OPNsense-Setup.md) · **Next:** [03. Temporary Timers & Recurring Schedules ->](03-Timers-and-Recurring-Schedules.md)
