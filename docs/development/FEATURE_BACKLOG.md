# Feature & UI Feedback Backlog (`docs/development/FEATURE_BACKLOG.md`)

> **Living Governance Document:** This backlog records all user UI feedback, enhancement requests, and design evaluations captured during interactive phase reviews.  
> **Mandatory Review Protocol:** At the **Entry** and **Exit Checkpoint** of every development phase (`Phase 4` → `Phase 7`), every `OPEN` or `EVALUATING` item in this file is reviewed to determine:
> 1. Whether it should be pulled into the current/next phase (`SCHEDULED — Phase X`),
> 2. Whether any architectural prerequisites (e.g., OPNsense firewall rules/aliases, ACL privileges, or SQLite migrations) are needed first, and
> 3. When completed, its status is updated to `COMPLETED` with the resolving Git commit reference and unit test coverage.

---

## 1. Summary Ledger of Backlog Items

| ID | UI Area / Tab | Short Summary | Category | Complexity | Recommended Target Phase | Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **`FB-P4-001`** | Page Header | Remove `SYSTEM:` prefix from health badge (`HEALTHY`, `DEGRADED`, `UNHEALTHY`) | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-002`** | Page Header / Versioning | Increment application version (`v0.1.0` → `v0.4.0` / `v0.5.0`...) on each phase push to match GitHub | Release & Versioning | `1 / 5` | **Phase 4 Exit / Every Phase Push** | `COMPLETED (Ongoing Rule — v1.0.0 in Phase 7)` |
| **`FB-P4-003`** | Devices & Access Control Tab | Change Telemetry column button label from `Usage & Domains` to `Analytics` | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-004`** | Devices & Access Control Tab | Internet Access column button: remove `— Click to Block` / `— Click to Allow` and show only current state (`Blocked` / `Allowed`) | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-005`** | Analytics Pop-Out Drawer | Remove ``(`dns.question.name`)`` from `Top Visited Domains` panel title | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-006`** | Analytics Pop-Out Drawer | Convert `Usage & Activity Timeline` bar chart to a **Stacked Bar Graph** (distinct colors for **DNS Queries** vs. **Firewall Events**, visible color legend, and breakdown in hover tooltip) | Data Visualization | `1.5 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-007`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each domain in `Top Visited Domains` to block that domain on the viewed device | New Control Feature (Per-Device Domain Block) | `4 / 5` | **Phase 18 (`v1.3.0-rc3`)** *(Bundled with `FB-P18-001`)* | `SCHEDULED (Phase 18)` |
| **`FB-P4-008`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each organization in `Top Destination Organizations (ASN)` to block that ASN on the viewed device | New Control Feature (Per-Device ASN Block) | `4 / 5` | **Phase 18 (`v1.3.0-rc3`)** *(Bundled with `FB-P18-001`)* | `SCHEDULED (Phase 18)` |
| **`FB-P4-009`** | Analytics Pop-Out Drawer | Add **Blocked Domains & ASN Organizations** panel below `Chronological Recent DNS Queries` with an **Unblock / Remove** button per item | New Control Feature (Per-Device Block Management UI) | `3 / 5` | **Phase 18 (`v1.3.0-rc3`)** *(Paired with `FB-P4-007` & `008`)* | `SCHEDULED (Phase 18)` |
| **`FB-P4-010`** | Traffic & DNS Analytics Tab | Remove ``(`logs-pfsense.log*`)`` from page title and change `Inspect Device` button label to `Inspect` in `Top Active LAN Devices` | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-011`** | System Connectivity Tab | Evaluate & replace/remove stale Phase 1 `Network Device Inventory & Internet Access Control` placeholder box at bottom of `StatusPage.tsx` | Architecture / Design Review | `1.5 / 5` | **Phase 5** *(Design Decision Below)* | `COMPLETED (Phase 5 — Option A)` |
| **`FB-P5-001`** | Timer Controls (Modal) | Open Timer controls as a **centered screen modal dialog** instead of an inline dropdown so it never requires scrolling and prevents multiple menus from opening simultaneously | UX / Modal Interaction | `1.5 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-002`** | Timer Controls (Active Button) | When a timer is active, display the **live countdown directly inside the Timer button** (`Paused: 28m left` / `Bonus: 19m left`) and color the button (`amber` for Pause, `emerald` for Bonus) instead of rendering a separate pill | UI / Control Polish | `1.5 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-003`** | Timer Controls (Preset Labels) | Show only durations (`15m`, `30m`, `1h`, `2h`, `Until 07:00`) on preset buttons inside the Timer modal without repeating `Pause` or `Bonus` inside each button | UI Copy / Polish | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-004`** | Timer Controls (Bonus Presets) | Change Bonus Access default preset values to **`20m`**, **`40m`**, and **`60m`** | Control Feature Update | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-005`** | Device Groups & Profiles | Match the `Timer` button height (`py-1.5 text-xs`) to the adjacent buttons (`Filter`, `Analytics`, `Allow All`, `Block All`) in the Device Groups & Profiles cards | UI Alignment | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-006`** | Top Page Header | Change the header `Sign Out` button label to simply say `Logout` | UI Copy / Polish | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-007`** | Device Groups & Profiles | When clicking `Filter` on a Group card, highlight the button (`Filter` active state) **without changing button text width or rearranging/stacking** the card's buttons | UI Layout Stability | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-008`** | Devices & Access Control Header | Remove ``(`gateway_blocked_devices`)`` from the page header description | UI Copy / Polish | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-009`** | Devices & Access Control Header | Format `Synced: HH:MM:SS` as a **24-hour clock** (single line, no `AM/PM`) and move it directly underneath the `Sync from OPNsense` button | UI Layout / Formatting | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P5-010`** | Container & SQLite Persistence | Ensure saved groups, nicknames, timers, and schedules persist across container restarts/rebuilds (`SQLITE_DB_PATH=/app/data/gateway.db` bound to `../data:/app/data` in `Settings.database_url`) | Infrastructure / Persistence | `1.5 / 5` | **Phase 6 & 7** *(Scheduled Batch)* | `COMPLETED (Phase 6)` |
| **`FB-P6-001`** | Schedules & Bedtime Modal | When creating a schedule for a single device, add a **search input field** above the target device selector to quickly filter devices by name, IP, or MAC | UX / Search Polish | `1 / 5` | **Phase 7** *(Scheduled Batch)* | `COMPLETED (Phase 7)` |
| **`FB-P6-002`** | Top Page Header | Add live **system time** (updating every 1 second) directly below the `Logout` button in the top-right header | UI / Live Clock | `1 / 5` | **Phase 7** *(Scheduled Batch)* | `COMPLETED (Phase 7)` |
| **`FB-P6-003`** | System Connectivity Tab | For the `Local SQLite Store` service card, display **storage size** (on-disk DB + WAL size) and **record count** stats | Observability / Telemetry | `1.5 / 5` | **Phase 7** *(Scheduled Batch)* | `COMPLETED (Phase 7)` |
| **`FB-P6-004`** | Application Usage Stats (YouTube & Plex) | Track and display **active usage time** (minutes/hours, query/packet volume, and last active timestamp) for **YouTube** and **Plex** across devices, groups, and network overview | Application Analytics (`logs-pfsense.log*`) | `2.5 / 5` | **Phase 7** *(Scheduled Batch)* | `COMPLETED (Phase 7)` |
| **`FB-P10-002`** | Global Auto-Refresh Controls | Add a user-configurable **Auto-Refresh Interval Selector (`Off`, `5s`, `30s`, `1m`, `5m`)** next to every Refresh button that auto-polls data across all tabs and analytics drawers (persisted in `localStorage`) | UX / Polling Control | `1.5 / 5` | **Phase 10 (`v1.0.4`)** | `COMPLETED (Phase 10)` |
| **FB-P6-005** | Selective Application Blocking (YouTube vs. Plex) | Application blocking control to **prevent access to YouTube** while **allowing access to Plex and everything else** (per-device and per-group toggle via OPNsense alias enforcement) | New Control Feature (App Control) | 3.5 / 5 | **Phase 7** *(Scheduled Batch)* | COMPLETED (Phase 7) |
| **FB-P8-001** | Traffic & DNS Analytics Tab | Fix YouTube & Plex near-100% active time inflation by aggregating 5m slots per LAN device (source.ip) with an active-streaming event threshold (min_doc_count >= 5) | Bug Fix / Analytics Accuracy | 2 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P8-002** | Traffic & DNS Analytics Tab | Display the **Top 3 Devices** and their active usage duration inside each Application Usage Stats card (YouTube & Plex) | Analytics Enhancement | 1.5 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P8-003** | Analytics Overview & Drawers | Append blocked traffic percentage ((XX.X%)) after the number in the Blocked Firewall Packets KPI box | Analytics / UI Polish | 1 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P8-004** | All Bar Graphs | Add a **Stacked \| Total** view selector on all bar graphs to toggle between component breakout and total view | Data Visualization | 1.5 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P8-005** | All Bar Graphs | Add horizontal (X-axis) and vertical (Y-axis) labels/scales to all bar graphs for at-a-glance readability without hovering | Data Visualization | 1.5 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P8-006** | System Connectivity Tab (Elasticsearch 9.4.3) | Report **Cluster Health** (GREEN/YELLOW/RED) and **Shard Counts** (Assigned, Unassigned, Relocating) via GET /_cluster/health | Observability / ES Telemetry | 1.5 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P8-007** | Global UI & Refresh Buttons | Remove all EM dashes (—) across the UI (e.g., shorten to "Application Usage Stats") and display Updated: HH:MM:SS below every Refresh button | Global UI Polish | 1.5 / 5 | **Phase 8 (1.0.2)** | COMPLETED (Phase 8) |
| **FB-P9-001** | Initial Admin Login (LoginPage) | NGINX-style **First-Boot Password Setup** for dmin on clean container builds (with seamless upgrade auto-seeding when ADMIN_PASSWORD is already set in .env) | Auth & Onboarding | 2.5 / 5 | **Phase 9 (1.0.3)** | COMPLETED (Phase 9) |
| **FB-P9-002** | System & Admin Tab (Integration Settings) | Expose OPNsense & Elasticsearch connection variables in the UI Admin Panel (persisted in SQLite with runtime precedence over .env + Reset to .env) and add a live **Connectivity Test** that surfaces errors in the UI and logs diagnostic failures to udit_logs | Admin Console & Diagnostics | 3.5 / 5 | **Phase 9 (1.0.3)** | COMPLETED (Phase 9) |
| **FB-P9-003** | System & Admin Tab (User Management) | Multi-user account creation & password management via Admin Console (Admin vs. Standard User / Operator roles), strictly preventing the default dmin user from being deleted or disabled | Multi-User RBAC | 3 / 5 | **Phase 9 (1.0.3)** | COMPLETED (Phase 9) |
| **FB-P9-004** | Audit Trail (udit_logs) | Track per-user attribution (ctor = current_user.username) and structured udit_label category badges across all UI actions | Security & Audit | 2 / 5 | **Phase 9 (1.0.3)** | COMPLETED (Phase 9) |
| **FB-P10-001** | New Firewall & Security Tab | Dedicated Firewall log explorer & security dashboard showing passed/blocked packet metrics, direction, searchable ilterlog stream, **Suspected Bad Actors / Scanners** (with 1-click LAN block), and **Active Inbound WAN Exposure (Open Ports)** | Security & Firewall Telemetry | 3.5 / 5 | **Phase 10 (1.0.4)** | COMPLETED (Phase 10) |
| **FB-P11-001** | Header Logo & Browser Favicon | Replace the shield icon with a custom **side-profile Unicorn with Rainbow Horn** SVG icon in the app header, login screen, and browser tab favicon | Branding & Iconography | 1.5 / 5 | **Phase 11 (1.1.0)** | SCHEDULED (Phase 11) |
| **FB-P11-002** | Header User Menu & Color Themes | Clicking the user's Name in the top header opens User Settings with **3 Eye-Friendly Dark-Room Color Themes** (Default Slate, Crimson & Obsidian light/dark red on black, and Ocean & Navy light/dark blue on deep navy) persisted per user | User Preferences & Theming | 2.5 / 5 | **Phase 11 (1.1.0)** | SCHEDULED (Phase 11) |

| **`FB-P15-001`** | Global Time Selectors | Add `Today` filter (`now/d` local timezone) as the first and default selection across all views and drawers | UX / Time Filtering | `1.5 / 5` | **Phase 15.1 (`v1.2.1`)** | `COMPLETED (Phase 15.1)` |
| **`FB-P16-001`** | Elasticsearch 9.4.3 (`logsdb`) | Apply Batch 5 ES read optimizations (`Q1` `docvalue_fields` + `breadth_first`, `Q2` `30d` WAN port cache decoupling & TTL tuning, `Q3` `RFC1918_CIDRS` pre-filter on `q_lan`/`q_app`, `Q4` `/5m` & `/h` rounding + `_msearch` `request_cache: True`) | Performance / Elasticsearch | `2.5 / 5` | **Phase 16 (`v1.3.0-rc1`)** | `COMPLETED (Phase 16 — v1.3.0-rc1)` |
| **`FB-P16-002`** | Elasticsearch HA & Integration Settings | Support comma-separated multi-node `ELASTICSEARCH_URL` failover + optional `ELASTICSEARCH_CA_CERT_PATH`, per-node status on ES Health Card, and `Test All Connections` button | Infrastructure / HA | `2 / 5` | **Phase 16 (`v1.3.0-rc1`)** | `COMPLETED (Phase 16 — v1.3.0-rc1)` |
| **`FB-P16-003`** | System Tab (Service Cards & Enforcement Summary) | Add 4th Service Health Card for `Plex Media Server`, format raw Service Card `details` with human-readable labels + collapsible Technical Details, and add `YouTube Blocked` & Enforcement KPI counters | Observability / UI Polish | `2 / 5` | **Phase 16 (`v1.3.0-rc1`)** | `COMPLETED (Phase 16 — v1.3.0-rc1)` |
| **`FB-P16-004`** | System Tab (User Mgmt & Audit History) | Add Admin password reset & role toggle (`Admin` <-> `Operator`) for existing users, self-service `Change My Password` in Header User Menu, auto-loaded Audit History with pagination (`50`/`100`/`250`) + CSV export, and `Prune Old Performance Logs` button | Admin & Security | `2.5 / 5` | **Phase 16 (`v1.3.0-rc1`)** | `COMPLETED (Phase 16 — v1.3.0-rc1)` |
| **`FB-P16-005`** | Global Header, Themes & Navigation | Make `HEALTHY`/`DEGRADED`/`DOWN` badge click navigate to `System` tab, add 2 new color themes (`Emerald & Forest`, `Amber & Carbon`), add `Ctrl+K` global quick-search modal, and add mobile bottom navigation bar | UX / Theming / Navigation | `2.5 / 5` | **Phase 16 (`v1.3.0-rc1`)** | `COMPLETED (Phase 16 — v1.3.0-rc1)` |
| **`FB-P17-001`** | Devices Tab (Device Groups & Profiles) | Add collapsible/compact toggle for `Device Groups & Profiles` section and convert Group Card action buttons (`Filter`, `Analytics`, `YouTube`, `Timer`, `Allow/Block Group`) to compact icon buttons | UX / Layout | `2 / 5` | **Phase 17 (`v1.3.0-rc2`)** | `COMPLETED (Phase 17 — v1.3.0-rc2)` |
| **`FB-P17-002`** | Devices Tab (Inventory Table) | Merge `Telemetry` + `Internet Access` into a single right-aligned `Actions` column, add clickable column sorting, add inline `+ Group` assignment popover on device rows, and allow archiving/deleting offline devices with an `Archived` filter pill | UX / Device Management | `3 / 5` | **Phase 17 (`v1.3.0-rc2`)** | `COMPLETED (Phase 17 — v1.3.0-rc2)` |
| **`FB-P17-003`** | Device & Group Analytics Drawers | Upgrade Drawer headers with compact icon buttons for `Internet Access`, `YouTube`, and inline `Timer` (`TimerPopoverMenu`) | UX / Control Consistency | `1.5 / 5` | **Phase 17 (`v1.3.0-rc2`)** | `COMPLETED (Phase 17 — v1.3.0-rc2)` |
| **`FB-P17-004`** | Schedules Tab (Rule Capabilities) | Allow Schedules to block either `Full Internet Access` or `YouTube Only`, allow changing Target (Group/Device) when editing a schedule, and add `Duplicate / Clone Schedule` action | Policy Engine & Schedules | `2.5 / 5` | **Phase 17 (`v1.3.0-rc2`)** | `COMPLETED (Phase 17 — v1.3.0-rc2)` |
| **`FB-P17-005`** | Schedules Tab (Visual Weekly Timeline & Controls) | Add visual 7-Day / 24-Hour Weekly Schedule Coverage Timeline bar, convert Schedule Card controls to compact buttons, add `Snooze / Skip Active Schedule` button, and add `AutoRefreshSelector` to Schedules header | Data Visualization & UX | `2.5 / 5` | **Phase 17 (`v1.3.0-rc2`)** | `COMPLETED (Phase 17 — v1.3.0-rc2)` |
| **`FB-P17-006`** | Devices / Groups & Policy Engine | Configure a daily YouTube viewing time quota (e.g., `1h / day`) on a Device Group so YouTube is automatically blocked once today's active YouTube usage reaches the quota, while Reward / Bonus Timers always take strict precedence over daily limits | Policy Engine & Quotas | `3 / 5` | **Phase 18 (`v1.3.0-rc3`)** | `SCHEDULED (Phase 18 — v1.3.0-rc3)` |
| **`FB-P17-007`** | Devices Tab (Mobile UX) | On mobile viewports showing the bottom nav bar, display only Device/Friendly Name and Action buttons in the `Devices` inventory table so the table stays compact with zero horizontal scroll | Mobile UX | `1.5 / 5` | **Phase 18 (`v1.3.0-rc3`)** | `SCHEDULED (Phase 18 — v1.3.0-rc3)` |
| **`FB-P17-008`** | Devices Tab (Default Filter & Persistence) | Default the `Devices` inventory status filter to `Online` on initial load and persist the user's selected status filter in `localStorage` | UX / Persistence | `1 / 5` | **Phase 18 (`v1.3.0-rc3`)** | `SCHEDULED (Phase 18 — v1.3.0-rc3)` |
| **`FB-P18-001`** | Analytics & Device Drawer (`FB-P4-007`..`009`) | Per-device & global Domain and ASN Organization blocking (OPNsense aliases/rules + Unbound), `destination.as.number` enrichment, Blocked Domains & ASNs management panel, and Backup/Restore support | New Control Feature (Domain/ASN Filtering) | `4 / 5` | **Phase 18 (`v1.3.0-rc3`)** | `SCHEDULED (Phase 18)` |
| **`FB-P18-002`** | Analytics Tab (Expanded App Usage & Plex Details) | Track additional apps (`Netflix`, `Disney+`, `Twitch`, `TikTok`, `Discord`, `Gaming`) with expandable device/bandwidth breakdown, and enhance Plex `Now Playing` with username, progress bar %, and bitrate | Application Analytics | `3 / 5` | **Phase 18 (`v1.3.0-rc3`)** | `SCHEDULED (Phase 18)` |
| **`FB-P18-003`** | Analytics Tab (LAN Table & Domain/ASN Drilldowns) | Add column sorting + search input to `Top Active LAN Devices` table, and make Domain/FQDN/ASN items clickable to inspect which LAN devices queried/contacted them | Analytics Drilldown | `2.5 / 5` | **Phase 18 (`v1.3.0-rc3`)** | `SCHEDULED (Phase 18)` |
| **`FB-P19-001`** | Firewall Tab (Noisy LAN & Open WAN Ports) | Convert `Noisy LAN Devices` Block/Unblock to compact icon buttons + add `Inspect` (`DeviceAnalyticsDrawer`) button, and show friendly NAT service descriptions (`Plex Media Server`, `WireGuard VPN`) + `Last Seen` in `Open WAN Ports` | Security UX & Polish | `2 / 5` | **Phase 19 (`v1.3.0`)** | `SCHEDULED (Phase 19)` |
| **`FB-P19-002`** | Firewall Tab (External Scanners & WAN IP Blocklist) | Display GeoIP Country/City badges on `Top Blocked External WAN Scanners` (clickable to filter logs), and add Country summary bar + `Block External IP at WAN` (`gateway_wan_blocked_ips`) in `FirewallOpenPortSessionsDrawer` | Security & WAN Enforcement | `3 / 5` | **Phase 19 (`v1.3.0`)** | `SCHEDULED (Phase 19)` |
| **`FB-P19-003`** | Firewall Tab (Packet Log Explorer) | Make `Source IP`, `Destination IP`, `Port`, `Protocol`, and `Interface` cells clickable to filter with active filter chips, and add row limit selector (`50`/`100`/`250`) + CSV/JSON export | Log Explorer UX | `2 / 5` | **Phase 19 (`v1.3.0`)** | `SCHEDULED (Phase 19)` |

---

## 2. Detailed Item Specifications & Technical Evaluations

### Area 1 — Page Header (`frontend/src/components/AppLayout.tsx`, `backend/app/__init__.py`)

#### `FB-P4-001` — Remove `SYSTEM:` Prefix from Header Health Status Pill
- **User Feedback:** *"Remove the word SYSTEM: from SYSTEM: HEALTHY and instead just show the health status (HEALTHY, DOWN, etc)"*
- **Current Implementation:**
  - In [frontend/src/components/AppLayout.tsx](frontend/src/components/AppLayout.tsx#L140-L149), the top navigation status badge renders:
    ```tsx
    <span>System: {overallStatus}</span>
    ```
    with `uppercase` styling, resulting in `SYSTEM: HEALTHY`, `SYSTEM: DEGRADED`, or `SYSTEM: UNHEALTHY`.
- **Planned Change:**
  - Render `{overallStatus === 'unhealthy' ? 'DOWN' : overallStatus}` (or `{overallStatus}`) directly inside the badge without the `System:` prefix so the pill displays `HEALTHY`, `DEGRADED`, or `DOWN` / `UNHEALTHY`.
  - Update unit tests in `frontend/src/__tests__/App.test.tsx` if any assertion matches `/System:/i`.
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-002` — Application Version Incrementing Across Phase Pushes
- **User Feedback:** *"Version still shows v0.1.0 even after multiple updates. Ensure this increments after each push to match the current version in GitHub"*
- **Current Implementation:**
  - [backend/app/__init__.py](backend/app/__init__.py#L3) hardcodes `__version__ = "0.1.0"`, which is returned by `/api/v1/system/health` (`app_version`) and rendered in [frontend/src/components/AppLayout.tsx](frontend/src/components/AppLayout.tsx#L151) (`v{health?.app_version || '0.1.0'}`).
  - [backend/pyproject.toml](backend/pyproject.toml#L7) and [frontend/package.json](frontend/package.json#L4) also declare `"0.1.0"`.
- **Planned Change & Governance Rule:**
  - Synchronize version numbers across `backend/app/__init__.py`, `backend/pyproject.toml`, `frontend/package.json`, and the fallback string in `frontend/src/components/AppLayout.tsx` (plus `backend/tests/test_health.py` assertions) using semantic phase versioning:
    - **Phase 4 check-in:** `0.4.0`
    - **Phase 5 check-in:** `0.5.0`
    - **Phase 6 check-in:** `0.6.0`
    - **Phase 7 check-in (Production Release):** `1.0.0`
  - Add a mandatory **Version Bump Check** to the Step `X.5` Phase Exit Checklist in `PLAN.md` so every phase push increments the version and tags/matches GitHub.
- **Complexity:** `1 / 5` (Low).

---

### Area 2 — Devices & Access Control Tab (`DevicesPage.tsx`, `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`)

#### `FB-P4-003` — Change Telemetry Column Button Label to `Analytics`
- **User Feedback:** *"For items in Telemetry column, change label to Analytics instead of Usage & Domains"*
- **Current Implementation:**
  - In [frontend/src/pages/DevicesPage.tsx](frontend/src/pages/DevicesPage.tsx#L535), the Telemetry button on each row renders `Usage & Domains`.
- **Planned Change:**
  - Change the button label from `Usage & Domains` to `Analytics` in `DevicesPage.tsx` and update matching queries in `frontend/src/__tests__/DeviceAnalytics.test.tsx`.
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-004` — Internet Access Column Button: Show Only Current State (`Blocked` / `Allowed`)
- **User Feedback:** *"For internet access column, remove the -- Click to block and instead just show the current state. Clicking will still change the state appropriately"*
- **Current Implementation:**
  - In [frontend/src/pages/DevicesPage.tsx](frontend/src/pages/DevicesPage.tsx#L563-L578), the toggle button displays `Blocked — Click to Allow` when blocked and `Allowed — Click to Block` when allowed.
- **Planned Change:**
  - Simplify the visible button text to `Blocked` (when `device.is_blocked === true`) and `Allowed` (when `device.is_blocked === false`), preserving the click handler, hover styling, `title` tooltip, and `aria-label` accessibility attributes.
  - Update matching button text assertions in `frontend/src/__tests__/DevicesPage.test.tsx`.
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-005` — Remove ``(`dns.question.name`)`` from `Top Visited Domains` Label in Analytics Drawer
- **User Feedback:** *"Analytics pop out drawer, remove ('dns.question.name') from Top Visited Domains label"*
- **Current Implementation:**
  - In [frontend/src/components/DeviceAnalyticsDrawer.tsx](frontend/src/components/DeviceAnalyticsDrawer.tsx#L431-L435), the card header reads:
    `Top Visited Domains (dns.question.name)`.
- **Planned Change:**
  - Change the header to `Top Visited Domains` (matching `GroupAnalyticsDrawer.tsx`).
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-006` — Stacked Usage & Activity Timeline Bar Graph with Color Key & Hover Breakdown
- **User Feedback:** *"Analytics pop out drawer, For Usage & Activity Timeline graph, change graph to a stacked graph that shows different colors for DNS and Firewall Events stacked on the bar. Show the key for the colors as a label in the graph and have it reflected in the pop up when mouse over for details"*
- **Current Implementation:**
  - In [frontend/src/components/DeviceAnalyticsDrawer.tsx](frontend/src/components/DeviceAnalyticsDrawer.tsx#L330-L371) (and [frontend/src/components/GroupAnalyticsDrawer.tsx](frontend/src/components/GroupAnalyticsDrawer.tsx#L382-L414)), each timeline bucket already receives `total_events`, `dns_queries`, `allowed_events`, `blocked_events`, and `bytes_total` from the backend, but renders a single solid cyan bar sized by `total_events`.
- **Planned Change:**
  - Compute for each bucket:
    - `dnsEvents = bucket.dns_queries`
    - `firewallEvents = Math.max(0, bucket.total_events - bucket.dns_queries)` (or `bucket.allowed_events + bucket.blocked_events`)
  - Render each timeline bar as a vertical flex/stack container whose total height is proportional to `(dnsEvents + firewallEvents) / maxTimelineEvents`, containing two stacked segments:
    - **Firewall Events segment** (e.g., `bg-indigo-500/80`)
    - **DNS Queries segment** (e.g., `bg-cyan-400/85`)
  - Add a **Color Key / Legend** in the `Usage & Activity Timeline` card header (`[■ Firewall Events]` and `[■ DNS Queries]`).
  - Add a styled **Mouse-Over Tooltip / Popover** on each bar showing:
    - Bucket timestamp (`formatShortTime(bucket.timestamp)`)
    - `Firewall Events: X` (`Allowed: A / Blocked: B`, `Bytes: formatBytes(...)`)
    - `DNS Queries: Y`
    - `Total Events: X + Y`
  - Apply consistently to `DeviceAnalyticsDrawer.tsx` and `GroupAnalyticsDrawer.tsx`.
- **Complexity:** `1.5 / 5` (Low–Medium; zero backend changes required because `dns_queries`, `allowed_events`, `blocked_events`, and `total_events` are already returned in every `UsageTimelineBucket`).

---

#### `FB-P4-007`, `FB-P4-008` & `FB-P4-009` — Per-Device Domain Blocking, Per-Device ASN Organization Blocking & Blocked Items Panel
- **User Feedback:**
  - **`FB-P4-007`:** *"Analytics pop out drawer, Top Visited Domains panel add a small block button next to each domain to the right of the list to automatically block that domain on that specific device being viewed"*
  - **`FB-P4-008`:** *"Analytics pop out drawer, Top Desitionation Organizations panel add a block button to the right of each element in the list to block that organization (ASN) on the specific device being viewed"*
  - **`FB-P4-009`:** *"With the block functions added, add another panel below Chronological Recent DNS Queries that shows all the blocked Domains / ASN organizations with a button to remove the block for that domain / ANS on the selected device"*
- **Architectural & OPNsense `26.7.7-amd64` Feasibility Evaluation:**
  - **Why Per-Device Granularity Matters:**
    - Currently, whole-device blocking works via a single OPNsense firewall rule whose **Source** is the `gateway_blocked_devices` `Host(s)` alias and whose **Destination** is `!RFC1918` (all internet).
    - Standard DNS blocklists in OPNsense Unbound (`/api/unbound/settings/*`) are **global across the entire LAN** (blocking a domain in Unbound blocks it for *every* device on the network, not just the single selected device).
    - Similarly, blocking an **ASN** (e.g., `AS15169 Google LLC` or `AS32934 Meta/Facebook`) or a **Domain** (e.g., `tiktok.com`) for **one specific device (`source.ip`)** requires matching **both** the **Source Device IP** and the **Destination Domain / ASN** in OPNsense `pf` firewall rules.
  - **How OPNsense `26.7.7` Supports Per-Device Domain & ASN Blocking via API:**
    1. **OPNsense Native Alias Types (`/api/firewall/alias/*`):**
       - OPNsense `Firewall → Aliases` natively supports:
         - **`type: "host"`** — accepts both IPv4/IPv6 addresses **and FQDNs / domain names** (OPNsense's `filterdns` daemon periodically resolves FQDNs in host aliases into the underlying `pf` table!).
         - **`type: "asn"` (`BGP ASN`)** — OPNsense natively supports `BGP ASN` aliases where content is an ASN number (e.g., `15169`, `32934`), which OPNsense expands into the ASN's announced IPv4/IPv6 CIDR prefixes in `pf`.
    2. **Two Clean Enforcement Patterns on OPNsense:**
       - **Pattern 1 — Per-Device Dynamic Destination Alias + Automation Filter Rule (`/api/firewall/filter/*`):**
         - For each device that has custom Domain/ASN blocks, maintain a device-scoped destination alias (e.g., `gw_dev_{id}_domains` of type `host` and `gw_dev_{id}_asns` of type `asn`) and a corresponding OPNsense Automation Firewall Rule (`source = <device_ip>`, `destination = gw_dev_{id}_domains / asns`, `action = block`, `quick = true`) via `/api/firewall/filter/addRule` + `/api/firewall/filter/apply`.
         - *Note on OPNsense Privileges:* Using `/api/firewall/filter/*` requires granting `Firewall: Rules: Edit` (`page-firewall-rules-edit`, or `API: Firewall: Filter`) to `svc_gateway_ui`.
       - **Pattern 2 — Fixed Template Aliases (Zero Dynamic Firewall Rule Creation):**
         - If you prefer **not** to grant firewall rule creation privileges to the API user, we can use OPNsense's existing alias privileges (`page-firewall-alias-edit`) or Unbound DNS overrides, though pure aliases without a per-device firewall rule can only match `<source_alias> -> <dest_alias>` (meaning all devices in `<source_alias>` would share the same blocked domains/ASNs unless paired with per-device rules).
    3. **Elasticsearch ASN Number Requirement (`destination.as.number`):**
       - Currently, `top_destination_orgs` in `backend/app/clients/elasticsearch.py` aggregates on `destination.as.organization.name` (e.g., `"Google LLC"`). To block an ASN in OPNsense, we also need the numeric **ASN ID** (`destination.as.number`, e.g., `15169`), which is populated by the `pfSense 1.25.4` GeoIP/ASN processor alongside `destination.as.organization.name`.
       - We can add a sub-aggregation (`top_metrics` or `terms` on `destination.as.number`) so every organization row in `Top Destination Organizations (ASN)` carries both `organization: "Google LLC"` and `asn: 15169`.
- **Recommendation for Phase Scheduling:**
  - Keep `FB-P4-007`, `FB-P4-008`, and `FB-P4-009` grouped together as a dedicated feature module (**Control Feature #5: Per-Device Domain & ASN Filtering**) to be reviewed and scheduled into **Phase 6 or Phase 7** (or a dedicated sub-phase) once we confirm whether you want `svc_gateway_ui` to manage per-device firewall rules (`/api/firewall/filter/*`) or group/policy-scoped aliases.

---

### Area 3 — Traffic & DNS Analytics Tab (`frontend/src/pages/AnalyticsPage.tsx`)

#### `FB-P4-010` — Remove ``(`logs-pfsense.log*`)`` from Title & Change `Inspect Device` Button to `Inspect`
- **User Feedback:**
  - *"Remove ('logs-pfsense.log*') from title label"*
  - *"In Top Active LAN Devices list, change the button for the Inspect column to be Inspect instead of Inspect Device"*
- **Current Implementation:**
  - In [frontend/src/pages/AnalyticsPage.tsx](frontend/src/pages/AnalyticsPage.tsx#L91), the page `<h2>` reads:
    `Network Traffic & DNS Analytics (logs-pfsense.log*)`.
  - In [frontend/src/pages/AnalyticsPage.tsx](frontend/src/pages/AnalyticsPage.tsx#L285), the action button in the `Inspect` column of `Top Active LAN Devices` reads `Inspect Device`.
- **Planned Change:**
  - Change the page title to `Network Traffic & DNS Analytics`.
  - Change the button label from `Inspect Device` to `Inspect` (and update `frontend/src/__tests__/AnalyticsPage.test.tsx`).
- **Complexity:** `1 / 5` (Low).

---

### Area 4 — System Connectivity Tab (`frontend/src/pages/StatusPage.tsx`)

#### `FB-P4-011` — Design Evaluation of `Network Device Inventory & Internet Access Control` Section on `System Connectivity` Tab
- **User Feedback:** *"Network Device Inventory & Internet Access Control table is still not present but was planned initially for Phase 2. Review design documents to complete table and move to new phase for implementation and evaluate if it is still needed, or makes sense, to have."*
- **Design & Historical Root-Cause Evaluation:**
  1. **Why That Box Exists in `StatusPage.tsx`:**
     - In **Phase 1**, before any tabs existed, `StatusPage.tsx` was the *only* page in the app. At the bottom of [frontend/src/pages/StatusPage.tsx](frontend/src/pages/StatusPage.tsx#L203-L218), we placed a dashed placeholder card titled `Network Device Inventory & Internet Access Control` with a badge saying `"Phase 1 Foundation Ready"` and copy stating *"Phase 2 connects live ARP & Dnsmasq DHCP leases from OPNsense to populate the interactive device control table here."*
  2. **What Happened in Phase 2:**
     - When we built **Phase 2**, instead of cramming the 69-device control table underneath the 3 health cards on `StatusPage.tsx`, we introduced the top navigation bar in `AppLayout.tsx` with dedicated tabs:
       - **Tab 1 (Default Home View): `Devices & Access Control`** (`DevicesPage.tsx`) — containing the full KPI bar, Device Groups & Profiles, and the complete searchable/sortable **Network Device Inventory & Internet Access Control** table.
       - **Tab 2: `Traffic & DNS Analytics`** (`AnalyticsPage.tsx`).
       - **Tab 3: `System Connectivity`** (`StatusPage.tsx`).
     - However, we never removed the old Phase 1 `"Phase 1 Foundation Ready"` placeholder box at lines 203–218 of `StatusPage.tsx`!
  3. **Does It Make Sense to Duplicate the Full Device Table on `System Connectivity`?**
     - **No — duplicating the full 69-device interactive table on `System Connectivity` is redundant and hurts UX**, because `Devices & Access Control` (Tab 1) *is* that exact table (now enhanced with Groups, Filters, and Analytics Drawers).
  4. **Recommended Resolution (Two Clean Options):**
     - **Option A (Recommended — Replace Placeholder with Live Gateway Enforcement & Inventory Telemetry Summary Card):**
       - Remove the stale `"Phase 1 Foundation Ready"` placeholder box on `StatusPage.tsx` and replace it with a live **Gateway Enforcement & Inventory Sync Summary** panel showing:
         - **OPNsense Block Alias (`gateway_blocked_devices`) Status:** Active Blocked IPs count, Protected IPs count, Total Discovered Devices (`69`), Online Now (`57`), and Last Reconciliation Timestamp.
         - A one-click **"Open Devices & Access Control →"** button (`onNavigateToDevices`) and **"Trigger Manual OPNsense Sync"** button.
     - **Option B (Simply Remove the Stale Phase 1 Placeholder Box):**
       - Delete lines 202–218 from `StatusPage.tsx` so the `System Connectivity` tab focuses purely on the 3 live subsystem health cards (OPNsense Gateway, Elasticsearch Cluster, and Local SQLite State DB).
- **Complexity:** `1 / 5` (Option B) or `1.5 / 5` (Option A).

---

## 3. Phase 5 User Feedback & Planning Specifications (`FB-P5-001` – `FB-P5-010`)

### Area 5 — Timer Operations (`frontend/src/components/TimerPopoverMenu.tsx`, `backend/app/services/timer_service.py`)

#### `FB-P5-001` — Centered Screen Modal Dialog for Timer Controls
- **User Feedback:** *"Currently when clicking the timer controls, a small window opens below the button that contains the settings. This has a side effect of requiring scrolling down on a page when clicking on an object near the bottom of the window, or if using search and only one item shows. Review changing the action of clicking the timer button to instead open the pop up in the middle of the screen so that it is always visible without needing to scroll. Additionally, this will prevent multiple buttons from being opened at the same time since the window should be treated as a modal action."*
- **Planned Change:**
  - Replace the relative `absolute right-0 top-full` anchored popover in `TimerPopoverMenu.tsx` with a centered modal overlay (`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs`) with backdrop-click and `Escape`/close-button dismissal.
  - Because the modal backdrop covers the viewport (`fixed inset-0 z-50`), it is always centered on screen regardless of scroll position or table row count, and prevents clicking a second `Timer` button while open.
- **Complexity:** `1.5 / 5` (Low–Medium).

#### `FB-P5-002` — Active Countdown & Mode Coloring Directly on the Timer Button
- **User Feedback:** *"When a timer is set, change the timer button to show active countdown of time remaining and color the button appropriately if it is paused or on bonus time."*
- **Planned Change:**
  - Merge the separate active countdown pill into the **Timer button itself** so there is always a single unified Timer button per Group card / Device row:
    - **When no timer is active:** Neutral slate button (`Timer`).
    - **When `mode === 'pause'` is active:** Amber-styled button (`border-amber-500/40 bg-amber-500/15 text-amber-200`) displaying the clock icon + live countdown (`Paused · 28m left`) + inline cancel (`X`) action (or clicking the button opens the centered modal showing active timer details + `Cancel Active Timer` button + options to replace the timer).
    - **When `mode === 'bonus'` is active:** Emerald-styled button (`border-emerald-500/40 bg-emerald-500/15 text-emerald-200`) displaying the sparkles/clock icon + live countdown (`Bonus · 19m left`).
- **Complexity:** `1.5 / 5` (Low–Medium).

#### `FB-P5-003` — Duration-Only Preset Button Labels in Timer Modal
- **User Feedback:** *"Change Pause and Bonus access buttons in the pop up to show only the minutes. So, instead of Pause 15m, just 15m. The label above the buttons already states what it is doing, so we dont need the label in the button itself."*
- **Planned Change:**
  - Under **Pause Internet Access**, label the preset buttons `15m`, `30m`, `1h`, `2h`, and `Until 07:00`.
  - Under **Grant Bonus Access**, label the preset buttons `20m`, `40m`, and `60m` (`FB-P5-004`).
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-004` — Bonus Access Default Presets (`20m`, `40m`, `60m`)
- **User Feedback:** *"Change the Bonus Access default values to 20m, 40m and 60m"*
- **Planned Change:**
  - Add `"20m": 20`, `"40m": 40`, and `"60m": 60` to `PRESET_MINUTES` in `backend/app/services/timer_service.py` (and `TimerPresetKey` in `frontend/src/api/client.ts`).
  - Render `20m`, `40m`, and `60m` as the 3 Bonus Access preset buttons in `TimerPopoverMenu.tsx`.
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-005` — Match Timer Button Height in Device Groups & Profiles Cards
- **User Feedback:** *"The Timer button is slightly larger in height than the other buttons for the Device Groups & Profile block. Change Timer button to match other button elements for height."*
- **Planned Change:**
  - Standardize the Timer button classes in `TimerPopoverMenu.tsx` to `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold` (matching the exact `px-2.5 py-1.5 text-xs` height and padding of `Filter`, `Analytics`, `Allow All`, and `Block All` on the Group cards).
- **Complexity:** `1 / 5` (Low).

---

### Area 6 — Top Page Header & Devices & Access Control Tab (`AppLayout.tsx`, `DevicesPage.tsx`)

#### `FB-P5-006` — Change Header `Sign Out` Button Label to `Logout`
- **User Feedback:** *"Change the Sign Out button to simply say Logout"*
- **Planned Change:**
  - In [frontend/src/components/AppLayout.tsx](frontend/src/components/AppLayout.tsx#L166), change `Sign Out` to `Logout` (keep `aria-label="Logout"` / update unit tests in `App.test.tsx`).
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-007` — Keep Group Card Button Layout Fixed When `Filter` Is Clicked
- **User Feedback:** *"When clicking filter, the window reorganizes the buttons and stacks them. Update to instead only highlight the Filtered Button but not change the layout at all"*
- **Root Cause & Planned Change:**
  - In [frontend/src/pages/DevicesPage.tsx](frontend/src/pages/DevicesPage.tsx#L288-L300), clicking `Filter` currently changes the button label from `Filter` to `Filtered` (widening the button) AND wraps the flex row on narrower cards.
  - Keep the button text constant as `Filter` (with `whitespace-nowrap`) and only toggle the highlighted visual state (`border-indigo-400 bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/40` vs. default slate), so zero width or layout shift occurs when toggling a group filter.
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-008` — Remove ``(`gateway_blocked_devices`)`` from Devices Page Header Description
- **User Feedback:** *"In the page header for the view, remove (`gateway_blocked_services`) from the description"*
- **Planned Change:**
  - In [frontend/src/pages/DevicesPage.tsx](frontend/src/pages/DevicesPage.tsx#L162-L166), change the subtitle from:
    `Live OPNsense ARP & Dnsmasq DHCP inventory with instant firewall alias enforcement (gateway_blocked_devices)`
    to:
    `Live OPNsense ARP & Dnsmasq DHCP inventory with instant firewall enforcement`.
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-009` — 24-Hour Clock & Position for `Synced: HH:MM:SS` Under `Sync from OPNsense` Button
- **User Feedback:** *"In the page header the clock shows AM, which takes up a second row. Change this to a 24hr clock so it sits in a single line and move the Synced: XX:XX:XX data to show under the Sync from OPNsense button"*
- **Planned Change:**
  - Format `last_synced_at` using `new Date(data.last_synced_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })` so it outputs a single-line 24-hour timestamp (`Synced: 09:24:15`).
  - Place the `Synced: HH:MM:SS` badge directly below the `Sync from OPNsense` button inside a right-aligned vertical column (`flex flex-col items-end gap-1`).
- **Complexity:** `1 / 5` (Low).

---

### Area 7 — Container & SQLite Persistence Across Restarts / Rebuilds (`FB-P5-010`)

#### `FB-P5-010` — Preserve Saved Groups, Nicknames, Timers & Schedules Across Container Resets / Rebuilds
- **User Feedback:** *"For the final product, we need to ensure last saved settings for schedules, timers, etc are preserved through container resets / restarts. During development, it is reasonable that groups, and other data, is not preserved as we continue to make changes to the sql db."*
- **Root-Cause Discovery & Planned Fix:**
  - **Why data was resetting on `docker compose up -d --build`:**
    - `docker/docker-compose.yml` mounts host `../data:/app/data` and sets `SQLITE_DB_PATH=/app/data/gateway.db`.
    - However, `docker/Dockerfile` sets `WORKDIR /app/backend`, and `Settings.database_url` in `backend/app/config.py` defaults to `sqlite+aiosqlite:///./data/gateway.db` (without reading `SQLITE_DB_PATH`), which resolved to `/app/backend/data/gateway.db` *inside the ephemeral container filesystem* instead of `/app/data/gateway.db` on the mounted host volume!
  - **Planned Fix (Scheduled for Phase 6 Step 6.1):**
    1. Update `Settings` in `backend/app/config.py` (and `docker/Dockerfile` + `docker/docker-compose.yml`) so that when `SQLITE_DB_PATH` is set (or in container defaults), `database_url` resolves to `sqlite+aiosqlite:////app/data/gateway.db` (the host-mounted `<repo-root>\data\gateway.db` volume).
    2. Ensure startup initialization (`init_db()` / Alembic migrations) non-destructively creates/upgrades tables in `/app/data/gateway.db` so device nicknames, protection flags, groups, active timers, and recurring schedules all survive container restarts, rebuilds, and version upgrades.
- **Complexity:** `1.5 / 5` (Low–Medium).

---

### Area 8 — Phase 6 User Feedback & Feature Requests (`FB-P6-001` – `FB-P6-005`)

#### `FB-P6-001` — Single-Device Search Field in New Schedule Modal (`ScheduleFormModal.tsx`)
- **User Feedback:** *"When creating a new schedule for a single device, add a search field above the target device box to allow for quick searching of devices"*
- **Planned Change:**
  - In [`frontend/src/components/ScheduleFormModal.tsx`](frontend/src/components/ScheduleFormModal.tsx), when `targetType === 'device'`, render a search input (`Search device by name, IP, hostname, or MAC...`, `data-testid="schedule-device-search"`) directly above the `Target Device` selector.
  - Filter `blockableDevices` in real time by matching against `effective_name`, `display_name`, `hostname`, `ipv4_address`, `mac_address`, and `vendor`, and automatically select the first matching device when the current selection is filtered out.
- **Complexity:** `1 / 5` (Low).

#### `FB-P6-002` — Live Per-Second System Clock Below `Logout` Button in Top Header (`AppLayout.tsx`)
- **User Feedback:** *"Add system time to the top of the page below the logout button that does per second updates."*
- **Planned Change:**
  - In [`frontend/src/components/AppLayout.tsx`](frontend/src/components/AppLayout.tsx), wrap the `Logout` button in a right-aligned vertical column (`flex flex-col items-end gap-1`) and render a live 1-second updating clock (`data-testid="header-system-clock"`, formatted in 24-hour `HH:MM:SS` monospace) directly beneath the `Logout` button.
- **Complexity:** `1 / 5` (Low).

#### `FB-P6-003` — Local SQLite Store Storage Size & Record Count Stats (`system.py`, `StatusPage.tsx`)
- **User Feedback:** *"In system connectivity tab, for Local SQLite Store, add storage size and record count stat."*
- **Planned Change:**
  - In [`backend/app/api/system.py`](backend/app/api/system.py) (`_probe_sqlite()`), compute:
    - `storage_bytes` and `storage_size_formatted` (summing the on-disk size of `gateway.db`, `gateway.db-wal`, and `gateway.db-shm`, with fallback to `PRAGMA page_count * PRAGMA page_size` for in-memory test DBs).
    - `total_records` and per-table counts (`devices_count`, `groups_count`, `timers_count`, `schedules_count`, `audit_logs_count`).
  - In [`frontend/src/pages/StatusPage.tsx`](frontend/src/pages/StatusPage.tsx), display **Storage Size** (e.g., `140.0 KB`) and **Total Records** (with table breakdown) inside the `Local SQLite Store` service card (`data-testid="service-card-sqlite"`).
- **Complexity:** `1.5 / 5` (Low–Medium).

#### `FB-P6-004` — Application Usage Stats (`YouTube` & `Plex` Active Usage Time Tracking)
- **User Feedback:** *"Application usage stats that logs amount of time using the application. To start, only work on doing this for Youtube and Plex"*
- **Technical Design:**
  - **Application Signatures in Elasticsearch (`logs-pfsense.log*`):**
    - **YouTube:** DNS queries (`event.dataset: "pfsense.unbound"`) matching `youtube.com`, `*.youtube.com`, `googlevideo.com`, `*.googlevideo.com`, `ytimg.com`, `*.ytimg.com`, `youtu.be`, `youtubei.googleapis.com`, `youtube-nocookie.com`.
    - **Plex:** DNS queries matching `plex.tv`, `*.plex.tv`, `plex.direct`, `*.plex.direct`, `plex.bz`, `plexapp.com`, `*.plexapp.com` **PLUS** firewall events (`event.dataset: "pfsense.filterlog"`) on Plex Media Server port `destination.port: 32400` or `source.port: 32400`.
  - **Active Usage Time Calculation (`active_minutes`):**
    - Using an Elasticsearch `filters` aggregation (`youtube` and `plex`) with a nested `date_histogram` (`fixed_interval: "5m"`) and `sum(network.bytes)`:
      - Every 5-minute bucket in which a device/group generates YouTube or Plex activity counts as **5 minutes of active usage** (`active_minutes = active_5m_buckets * 5`), alongside `event_count` (DNS queries + firewall packets), `total_bytes`, and `last_active_at`.
  - **UI Integration:**
    - Render a dedicated **Application Usage (YouTube & Plex)** panel in:
      1. **Per-Device Analytics Drawer (`DeviceAnalyticsDrawer.tsx`)**
      2. **Per-Group Analytics Drawer (`GroupAnalyticsDrawer.tsx`)**
      3. **Traffic & DNS Analytics Tab (`AnalyticsPage.tsx`)**
    - Display formatted usage duration (e.g., `1h 25m` / `45m`), query/event counts, bandwidth, and last active time.
- **Complexity:** `2.5 / 5` (Medium).

#### `FB-P6-005` — Selective Application Blocking: Prevent Access to YouTube While Allowing Plex & Everything Else
- **User Feedback:** *"Application blocking feature to prevent access to Youtube, but allow access to Plex and everything else."*
- **Architectural Design:**
  - **Why Targeted Alias Enforcement Is Required:**
    - Full device blocking (`gateway_blocked_devices`) blocks all WAN access, whereas blocking all of Google's ASN (`AS15169`) would break Google Search, Gmail, and Classroom.
    - To block **YouTube** while keeping **Plex** (`plex.tv`, `plex.direct`, `:32400`) and all other websites working normally:
      1. **OPNsense Alias Pair (`gateway_youtube_blocked_devices` + `gateway_youtube_domains`):**
         - `gateway_youtube_blocked_devices` (`host` alias): holds the IPv4 addresses of LAN devices that have **YouTube Blocked** (`Device.is_youtube_blocked == True`).
         - `gateway_youtube_domains` (`host` alias): holds YouTube's FQDNs (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, `googlevideo.com`, `ytimg.com`, `i.ytimg.com`, `s.ytimg.com`, `youtubei.googleapis.com`, `youtube-nocookie.com`), which OPNsense's `filterdns` resolves into PF table entries for a LAN Reject rule (`Source: gateway_youtube_blocked_devices -> Destination: gateway_youtube_domains`).
         - `OPNsenseClient` automatically verifies/provisions `gateway_youtube_blocked_devices` and `gateway_youtube_domains` via `/api/firewall/alias/*` (using the existing `Firewall: Alias: Edit` privilege) and adds/removes device IPs via `/api/firewall/alias_util/{add,delete}/gateway_youtube_blocked_devices` + `kill_states`.
      2. **Per-Device & Per-Group YouTube Toggle UI:**
         - Add `is_youtube_blocked: bool` to `Device` (and `youtube_status` to `GroupResponse`) with `POST /api/v1/devices/{id}/youtube/block`, `POST /api/v1/devices/{id}/youtube/unblock`, `POST /api/v1/groups/{id}/youtube/block`, and `POST /api/v1/groups/{id}/youtube/unblock`.
         - Expose one-click **YouTube Allowed / YouTube Blocked** controls on Device rows, Group cards, and inside the Analytics Drawer's **Application Usage & Control (YouTube & Plex)** panel.
- **Complexity:** `3.5 / 5` (Medium–High).



---

### Area 9 — `v1.1` Release Roadmap & Observed `v1.0.1` Bug Resolutions (`FB-P8-001` – `FB-P11-002`)

#### `FB-P8-001` & `FB-P8-002` — Per-Device Active Streaming Calculation & Top 3 Devices per Application (YouTube & Plex)
- **User Feedback:**
  - *"Both the youtube and Plex stats appear inaccurate as they always report near 100% active time even when no devices on the network are actively using youtube or plex. Need to investigate what might be causing this."*
  - *"For application Usage Stats view, in the same box that shows the data for each item (currently just Youtube and Plex) also list the top 3 devices and the time they have spent on those applications below the current data"*
- **Root Cause & Planned Fix (Phase 8):**
  - Aggregating 5-minute buckets across all ~60 LAN devices simultaneously with `min_doc_count: 1` meant background keepalives and DNS refreshes caused almost every 5-minute bucket to register at least 1 event.
  - Aggregate 5-minute slots **per LAN device (`source.ip`)** first with an active-streaming event threshold (`min_doc_count >= 5` events per 5m slot per device), compute per-device active minutes, and surface the **Top 3 Devices** (with SQLite display names and active durations) inside each Application Usage Stats card.

#### `FB-P8-003` — Blocked Firewall Packets Percentage
- **User Feedback:** *"For the Blocked Firewall Packets data box, add a percentage value after the number to show percentage of traffic blocked"*
- **Planned Change (Phase 8):** Append `(XX.X%)` (computed as `blocked_packet_count / firewall_event_count * 100`) next to the number in the `Blocked Firewall Packets` KPI box across `AnalyticsPage`, `DeviceAnalyticsDrawer`, and `GroupAnalyticsDrawer`.

#### `FB-P8-004` & `FB-P8-005` — Bar Graph `Total` vs. `Stacked` Selector & Horizontal/Vertical Axis Keys
- **User Feedback:**
  - *"For all bar graphs that are shown add a selector in the view to change between total and stacked view where stacked shows the break out of the data used in the bar graph."*
  - *"For all bar graphs that are shown, there is no horizontle or verticle key to denote what the user is looking at. We should have labels to show at a glance data without the need to hover over the data to see what it is."*
- **Planned Change (Phase 8):** Add a `Stacked | Total` toggle pill and render explicit Y-axis scale ticks (`Max`, `Mid`, `0` + unit label) and X-axis time/hour labels on all bar charts.

#### `FB-P8-006` — Elasticsearch 9.4.3 Cluster Health & Shard Count Telemetry
- **User Feedback:** *"For the System Connectivity tab in the Elasticsearch 9.4.3 box, lets also report the current cluster health, shard count (split into assigned, unassigned, relocating) We may need new privileges for this as well since we will need access to the GET _clusterhealth and GET _cat calls"*
- **Planned Change (Phase 8):** Query `GET /_cluster/health` in `ElasticsearchServiceClient.check_health()` to populate `cluster_status`, `assigned_shards`, `unassigned_shards`, and `relocating_shards`, render them on `StatusPage.tsx`, and document `cluster: ["monitor"]` in `docs/API_KEYS_SETUP.md`.

#### `FB-P8-007` — Global Removal of EM Dashes (`—`) & `Updated: HH:MM:SS` Below All Refresh Buttons
- **User Feedback:**
  - *"Remove all the EM dashes or replace them with either commas if appropriate. For example, in the Traffic & DNS Analytics tab, for the Application Usage Stats box, it states 'Application Usage Stats — YouTube & Plex (24h)' This could just instead say Application Usage Stats only"*
  - *"For all areas where there is a refresh button, show below that button the last time it was updated."*
- **Planned Change (Phase 8):** Remove all EM dashes (`—`) across all UI views and backend messages, and display a 24-hour `Updated: HH:MM:SS` label directly below every `Refresh` button.

#### `FB-P9-001` — NGINX-Style First-Boot `admin` Password Creation
- **User Feedback:** *"Change initial admin to model other container apps, NGINX, where the first login on a clean build of the container instead asks for password creation using a defined user called admin"*
- **Planned Change (Phase 9):** Trigger a First-Boot Password Setup screen on clean builds when no SQLite `admin` user exists and `ADMIN_PASSWORD` is unset/placeholder in `.env` (while auto-seeding the SQLite `admin` user if a valid `ADMIN_PASSWORD` is already present in `.env` for seamless upgrades).

#### `FB-P9-002` — UI Admin Panel for OPNsense & Elasticsearch Variables + Live Connectivity Diagnostics
- **User Feedback:** *"In addition to allowing users to use the .env file to define the necessary variables to connect to OPNsense and ES, also expose these variables in the UI under and Admin panel that is used to define those variables as well as test them with a simple connectivity check. If the device cannot be reached, expose the errors and log them in the system so the user can diagnose"*
- **Planned Change (Phase 9):** Expand `System Connectivity` into `System & Admin` with an Integration Settings panel (persisted in SQLite with encrypted secrets, taking runtime precedence over `.env` with a `Reset to .env` option) and live `Test Connection` buttons that surface detailed errors in the UI and log diagnostic failures to `audit_logs`.

#### `FB-P9-003` & `FB-P9-004` — Multi-User Management (`Admin` vs. `Standard User`), Built-in `admin` Protection & Per-User Audit Labels
- **User Feedback:**
  - *"Add the ability to add new users that can login to the platform. The user should be able to be added to the platform via the Admin console and have their password set by the admin at that time"*
  - *"Ensure the default admin user cannot be deleted or disabled"*
  - *"Enable per user tracking for actions performed in the UI that is logged in the logs with an audit label"*
- **Planned Change (Phase 9):** Add multi-user management in `System & Admin` supporting `Admin` and `Standard User (Operator)` roles, enforce `403 Forbidden` if attempting to delete/disable the built-in `admin` user, and log every UI mutation with `actor = current_user.username` and a structured `audit_label` badge.

#### `FB-P10-001` — Dedicated `Firewall & Security` Tab (Bad Actors, Open Inbound WAN Ports & Searchable Log Explorer)
- **User Feedback:** *"Since we have access to all the firewall logs, lets add a Firewall section that reports all of the firewall activity that is also searchable and shows number of packets passed, blocked, direction etc. The goal of the view is to also be able to easily see bad actors on the network that may need to be blocked and show open ports that could allow for unintentional access into the network from the WAN that could be dangerous."*
- **Planned Change (Phase 10):** Add a `Firewall & Security` navigation tab with pass/block/direction KPIs, timeline bar chart, side-by-side security panels for **Noisy/Blocked LAN Devices & External Scanners** (with 1-click LAN block) and **Active Inbound WAN Exposure (Open Ports)**, and a searchable/filterable `filterlog` table.
- **Status:** `COMPLETED (Phase 10 — v1.0.4)`

#### `FB-P11-001` & `FB-P11-002` — Custom Unicorn Rainbow-Horn Logo/Favicon & Clickable Header User Name Menu with 3 Eye-Friendly Color Themes
- **User Feedback:**
  - *"Create an icon to replace the shield icon and have it display in the web browser next to the name of the page when its opened on a tab. The logo should be a side profile of a unicorn with rainbow colors for the horn"*
  - *"Add the ability for a user to customize their color preferences in their view. Lets target 3 total options for now with the default being what it is now, but then also have a light red / dark red and black theme and a light blue / dark blue theme. Ideally the color selection should be easy on the eyes and not neon bright or uncomfortable to use in a dark room."*
  - *(From `/grill-me`):* *"Have the theme be selectable by the user clicking on their Name in the header, which then shows user specific settings, including the themes."*
- **Planned Change (Phase 11):** Replace the shield icon and browser favicon with a custom side-profile Unicorn with a rainbow-gradient horn SVG, and make the user's Name in the top header clickable to open a User Settings menu containing the 3 dark-room-friendly color themes (`Default Slate`, `Crimson & Obsidian`, and `Ocean & Navy`).


#### `FB-P8-008` (`BUG-P8-003`) — Fix Plex Local LAN Client Streaming Detection (`*.plex.direct`, `plex.tv` Playback DNS & Server-vs-Client Separation)
- **User Feedback (Phase 8 Gate 2):** *"All items are confirmed working and correct as planned for everything except PLEX, which does not appear to be catching the correct time used and devices. I believe the reason is the code is looking at an input port to track and may be missing local traffic from LGwebOSTV (.243) as several hours of Plex time was done today on that device, but the data is not present. We may need to investigate why. Log this as a bug."*
- **Root Cause & Planned Fix (Scheduled for Phase 9 — `v1.0.3`):**
  1. **Intra-VLAN L2 Switching Bypasses Port `32400` in `filterlog`:** Local LAN streaming between a Smart TV (`LGwebOSTV` on `.243`) or Google TV streamer (`.66`) and a local Plex Media Server on the same `/24` subnet (`.2` / `.250`) is switched at Layer 2 and never crosses the OPNsense firewall interface (`filterlog`).
  2. **Restore `*.plex.direct` and `plex.tv` Client Playback Domains:** Include `dns.question.registered_domain: ["plex.direct", "plex.tv", "plexapp.com"]` and wildcard `*plex*` local hostnames in `_build_app_usage_agg()`, while using a sub-aggregation on `servers.plex.tv` (which only Plex Media Server hosts query) and 24/7 poller heuristics (`>= 140` slots with zero playback/scrobble domains) to exclude server/poller background noise and count client playback slots with `min_doc_count: 1`.
- **Status:** `SUPERSEDED BY FB-P9-005 (Direct Plex API / Tautulli-Style Integration)`

#### `FB-P9-005` (`BUG-P9-002`) — Direct Plex Media Server API Integration (Tautulli-Style Streaming & Device Telemetry)
- **User Feedback (Phase 9 Gate 2 — `PHASE9-Verify.md`):** *"Time accuracy is still incorrect. While there is some logging occurring, we still do not see the correct time for all devices. Yesterday I logged several hours on two LG televisions and neither of those are showing. I believe it might be easier to directly query the Plex API interface to get these details, much like the app Tautulli does. Lets plan for deeper Plex integration to bring a Tautulli like experience directly into our gateway app, but that is out of scope for this phase."*
- **Technical Evaluation & Planned Architecture (Future Release / Post-`v1.1`):**
  1. **Why Firewall/DNS Telemetry Cannot Accurately Track Local L2 Smart TV Plex Streams:** Same-subnet Layer-2 streaming between LG webOS TVs and the local Plex Media Server bypasses OPNsense's `filterlog` interface and uses cached `*.plex.direct` records or direct LAN IP (`GDM` discovery) without recurring Unbound DNS queries, while background media services/containers querying `*.plex.direct` skew DNS-based heuristics and `Last active` timestamps.
  2. **Direct Plex Media Server API Client (`PlexServiceClient`):**
     - Expose `PLEX_BASE_URL` and `PLEX_API_TOKEN` (`X-Plex-Token`) in `.env` and the `System & Admin` Integration Settings UI (`FB-P9-002` pattern) with a live **Test Plex Connection** diagnostic button.
     - Poll `/status/sessions` and `/status/sessions/history/all` (or Plex SQLite/API playback history, just like Tautulli) to record exact per-device (`player.address` correlated to SQLite `Device.ipv4_address` / `mac_address`), per-user, and per-media-title playback duration, active stream state, bandwidth, transcode vs. direct-play status, and accurate `last_active_at` timestamps.
- **Complexity:** `3.5 / 5`
- **Status:** `COMPLETED (Phase 15 — v1.2.0)`

#### `FB-P10-002` — User-Configurable Auto-Refresh Interval Selector (`Off`, `5s`, `30s`, `1m`, `5m`) Across All Refresh Buttons
- **User Feedback (Phase 10 Gate 2 — `PHASE10-Verify.md`):** *"For all Refresh buttons that automatically poll data, add a selector next to the refresh button to change the poll time. Values should be Off, 5s, 30s, 1m, 5m."*
- **Implemented Change (Phase 10 — `v1.0.4`):**
  - Created [`frontend/src/components/AutoRefreshSelector.tsx`](frontend/src/components/AutoRefreshSelector.tsx) exporting `AutoRefreshSelector`, `useAutoRefresh()`, and `resolveRefetchInterval()` with options `Auto: Off`, `Auto: 5s`, `Auto: 30s`, `Auto: 1m`, and `Auto: 5m` persisted in `localStorage` (`gateway_auto_refresh_interval`).
  - Placed `<AutoRefreshSelector />` directly adjacent to the Refresh button and wired `refetchInterval` into `useQuery` across `FirewallPage`, `AnalyticsPage`, `DevicesPage`, `SchedulesPage`, `StatusPage`, `DeviceAnalyticsDrawer`, and `GroupAnalyticsDrawer`.
- **Complexity:** `1.5 / 5`
- **Status:** `COMPLETED (Phase 10 — v1.0.4)`


---

### Area 10 — `v1.2` Planning Backlog (Captured at Phase 11 / `v1.1.0` Release Sign-Off — `PHASE11-Verify.md`)

#### `FB-P11-003` (`BUG-P11-001`) — Elasticsearch Analytics Cold-Load Query Optimization, Timeout Tuning & Runtime Error Audit Logging
- **User Feedback (`PHASE11-Verify.md`):**
  - *"Sometimes when we attempt to load data from ES for analytics, or on first load and refresh, we will get a timeout error. When this happens, I can typically refresh the page, and that will resolve the issue. What is the default timeout set for ES analytics requests? Addittionally, evaluate if we are using the most optimal calls to get the data we need efficiently, or if perhaps there is a more optimal way to retrieve this data based on Elastic search best practices."*
  - *"When we do get errors when trying to access ES or OPNsense, be sure those errors are logged in our System tab logs."*
- **Technical Evaluation & Planned Changes (`v1.2`):**
  1. **Current Default Timeout:** `ELASTICSEARCH_TIMEOUT_SECONDS` in `backend/app/config.py` defaults to **`10.0` seconds** (`ge=1.0, le=60.0`).
  2. **Why Cold Loads Occasionally Exceed `10.0s` on `Traffic & DNS Analytics`:**
     - Unlike `fetch_firewall_overview()` (which we optimized in Phase 10 with `track_total_hits: False` and `request_cache=True`), `build_network_overview_query()`, `build_device_analytics_query()`, and `build_group_analytics_query()` in `backend/app/clients/elasticsearch.py` currently omit `"track_total_hits": False` and `request_cache=True`.
     - Additionally, `_build_app_usage_agg()` executes a wildcard `query_string: {"query": "*plex*"}` and a nested `terms(source.ip, size=100) -> date_histogram(5m)` (`28,800` sub-buckets on `24h`) across all `1,638` shards. On a cold query, shard coordination takes `8–12s`, whereas the second refresh hits the OS/shard page cache and completes in `< 1s`.
  3. **Planned Elasticsearch Best-Practice Optimizations:**
     - Add `"track_total_hits": False` and `request_cache=True` to `fetch_network_overview`, `fetch_device_analytics`, and `fetch_group_analytics`.
     - Remove the expensive wildcard `query_string: "*plex*"` from `_build_app_usage_agg()` (relying on exact `terms` on `dns.question.registered_domain` and `destination.port: 32400`), reduce `by_device` `size` from `100` to `20`, and use `_msearch` or background cache pre-warming.
     - Increase the default `ELASTICSEARCH_TIMEOUT_SECONDS` from `10.0s` to `20.0s`.
     - Automatically write a deduplicated/throttled `AuditLog` (`audit_label="DIAGNOSTIC_ERROR"`, `action="upstream.elasticsearch.error"` / `"upstream.opnsense.error"`) whenever a runtime ES or OPNsense request fails or times out so all upstream errors are visible in the `System` tab's Audit & Event History.
- **Complexity:** `2 / 5`
- **Status:** `COMPLETED (Phase 13 — v1.2.0-rc2)`

#### `FB-P11-004` — Automated Code & Dependency Security Scanning (SAST, SCA, Container & Auth-Bypass Auditing in CI/CD)
- **User Feedback (`PHASE11-Verify.md`):** *"Code security scanning to ensure we do not have any open source vulnerabilites or code paths that could be used to bypass security or gain access to systems. We should determine the best methods for testing this, and the best tools to use. Perhaps there is a way to integrate this into our CI/CD pipeline."*
- **Technical Evaluation & Planned Changes (`v1.2`):**
  - Integrate a multi-layer security gate into local quality checks and `.github/workflows/ci.yml`:
    1. **Dependency Vulnerability Scanning (SCA):** `pip-audit` for Python packages and `npm audit --audit-level=moderate` for Node/frontend packages.
    2. **Static Application Security Testing (SAST):** Enable `ruff` flake8-bandit security rules (`select = [..., "S"]`), `bandit -r backend/app`, and `semgrep` OWASP Top 10 / FastAPI / React rulesets.
    3. **Container Image & Secret Scanning:** `trivy image` / `trivy fs` in GitHub Actions to catch OS package CVEs and accidental secret leaks.
    4. **Automated Route Auth-Bypass & RBAC Security Suite (`test_security_audit.py`):** Programmatically iterate over every registered FastAPI route in `app.routes`, asserting that zero `/api/v1/*` endpoints (outside `/api/v1/auth/{login,setup-status,setup-admin}`) accept unauthenticated requests (`401`) or allow `operator` role privilege escalation onto admin-only endpoints (`403`).
- **Complexity:** `2 / 5`
- **Status:** `COMPLETED (Phase 14 — v1.2.0-rc3)`

#### `FB-P11-005` — Top Header Alignment, Single-Word Tab Labels with Larger Icons, Streamlined Title & Larger Unicorn Icon
- **User Feedback (`PHASE11-Verify.md`):**
  - *"Page Header alignment is not even. Currently the logout button is sitting higher than the other elements in the header. This is probably due to the clocks location, perhaps we should find a better place to put the clock so that it does not cause the alignment to be skewed."*
  - *"Page Header labels are too verbose, I would rather increase the size of the icons for each item and reduce the label text to single words like Devices, Schedules, Analytics, Firewall, and System."*
  - *"Page header label OPNSense Gateway Control is too long. Lets change this to just say Gateway Control and also remove the OPNsense and Elasticsearch version labels, since this is available in the system tab. Leave Access & Telemetry portal though and move the current version of the code to be in line with the Access & Telemetry Portal label"*
  - *"The Unicorn icon in the page header is slightly difficult to make out. Perhaps we can make it slightly larger, and with a more defined border."*
- **Complexity:** `1.5 / 5`
- **Status:** `COMPLETED (Phase 12 — v1.2.0-rc1)`

#### `FB-P11-006` — Compact YouTube Logo Toggle Button & Unified `Blocked` Filter Including `YT Blocked` Devices
- **User Feedback (`PHASE11-Verify.md`):**
  - *"The buttons for YT Allowed are rather large. Change this to just be the Youtube logo and have it be bright if its allowing YT, but dim when it is not, like the Allowed button already operates"*
  - *"When clicking blocked in Devices & Access Control within the show list (All, Online,...) the blocked view should also include devices that have YT blocked for easier view and access."*
- **Complexity:** `1.5 / 5`
- **Status:** `COMPLETED (Phase 12 — v1.2.0-rc1)`

#### `FB-P11-007` — Visual Loading / Refreshing State (Greyed-Out + Slow Blink/Pulse) for Analytics Windows
- **User Feedback (`PHASE11-Verify.md`):** *"In the next planning phase, for the discussion, lets also include determining better ways of showing data that is is waiting to load from ES for presentation. Sometimes stale data, or no data, will show while the system is refreshing and it is not obvious that the stale data is bad. Perhaps we could do something like grey out the windows of where the data loads and slowly blink the data as it is loaded."*
- **Complexity:** `1.5 / 5`
- **Status:** `COMPLETED (Phase 12 — v1.2.0-rc1)`

#### `FB-P11-008` — Application Improvement & Performance Enhancement Proposals for Next (`v1.2`) Planning Phase
- **User Feedback (`PHASE11-Verify.md`):** *"Additionally as part of the next planning phase, present improvement options, performance enhancements or other changes that you think would improve the application for discussion."*
- **Approved Proposals (`v1_2_implementation_plan.md`):**
  - **Proposal A (`COMPLETED in Phase 13 — v1.2.0-rc2`):** Background APScheduler 60-second `24h` Cache Pre-Warming for `NetworkOverview` and `FirewallOverview`.
  - **Proposal B (`COMPLETED in Phase 13 — v1.2.0-rc2`):** Elasticsearch `/_msearch` Single-Round-Trip Consolidation across `fetch_device_analytics`, `fetch_group_analytics`, `fetch_firewall_overview`, and 3-way parallel `/_msearch` for `fetch_network_overview`.
  - **Proposal C (`SCHEDULED for Phase 15 — FB-P9-005`):** Direct Plex Media Server API (`X-Plex-Token` / Tautulli-style) Integration in a dedicated Plex Phase 15.
  - **Proposal D (`COMPLETED in Phase 14 — v1.2.0-rc3`):** Frontend Route Code-Splitting (`React.lazy()` + Vite `manualChunks`) to reduce initial bundle size (`21.15 kB` entry chunk, max vendor chunk `223.22 kB`) and eliminate Vite's `> 500 kB` chunk warning.
  - **Proposal E (`DEFERRED — Future Release`):** OPNsense Unbound DNS Blocklist / Secondary Service Quick-Action Toggle.
- **Status:** `COMPLETED (Proposals A, B, C & D Completed in v1.2.0)`

---

### Area 11 — Phase 13 (`v1.2.0-rc2`) User Validation Feedback (`PHASE13-Verify.md`)

#### `FB-P13-001` (`BUG-P13-001`) — `PERFORMANCE_ANALYSIS` Audit Label for Window Load-Time Tracking & `30d` Window Query Optimization
- **User Feedback (`PHASE13-Verify.md`):**
  - *"[PARTIAL] 3. Fast Manual Refresh (`Refresh Analytics`) & Window Switching (`1h`, `24h`, `7d`, `30d`): Much improved on load times. I was able to get timeouts occasionally on 30d window, but not consistently."*
  - *"Start tracking load times for each window to store in the audit logs using a new audit label named PERFORMANCE_ANALYSIS."*
- **Technical Evaluation & Planned Changes (`Phase 14 — v1.2.0-rc3`):**
  1. **New `PERFORMANCE_ANALYSIS` Audit Label & Window Load-Time Recorder:**
     - Add `"PERFORMANCE_ANALYSIS"` to `infer_audit_label()` in [`backend/app/models/__init__.py`](../../backend/app/models/__init__.py) (mapping `action.startswith("performance.")`), `AuditLogItem` schema/UI badge styles, and the Audit Label filter dropdown on `StatusPage.tsx` (`System -> Audit & Event History`).
     - Add `record_performance_analysis_audit_log()` in [`backend/app/services/audit_and_backup_service.py`](../../backend/app/services/audit_and_backup_service.py) to record telemetry window load times (`window` = `1h`/`24h`/`7d`/`30d`, `view` = `analytics.overview` / `firewall.overview` / `device.analytics` / `group.analytics`, `elapsed_ms`, `cache_hit`, `force_refresh`, `total_events`, and `status`) into `audit_logs` with `audit_label="PERFORMANCE_ANALYSIS"`.
  2. **`30d` Window Query Optimization & Pre-Warming (`BUG-P13-001`):**
     - Eliminated uncached `RFC1918_CIDRS` BKD range filter scans inside `by_device` and `lan_devices` sub-aggregations, added `"collect_mode": "breadth_first"` on `q_lan`, extended `AnalyticsCache` TTL to `300s` for `7d`/`30d`, and included `7d` and `30d` in background cache pre-warming (`30d` cold query reduced to `~2.6s` and warm cache load `< 5 ms`).
- **Complexity:** `2 / 5`
- **Status:** `COMPLETED (Phase 14 — v1.2.0-rc3)`

#### `FB-P13-002` — Firewall Active WAN Ports Connected External IPs Side-Drawer Inspector (GeoIP Location, ASN, Duration & Session Details)
- **User Feedback (`PHASE13-Verify.md`):**
  - *"In firewall tab, for the active WAN ports, add the ability to click on the number of external IP addresses count and have it open a side window, like analytics does, to show all the relevant details about the connected ip, including address, location, connection length and whatever else is available from the data in the logs. This should be possible given how the pfSense firewall dashboard works in Kibana."*
- **Technical Evaluation & Planned Changes (`Phase 14 — v1.2.0-rc3`):**
  - Live inspection of `logs-pfsense.log*` confirmed that inbound WAN `pass` documents carry rich Elastic `pfSense` Integration (`1.25.4`) GeoIP, ASN, and packet telemetry:
    - `source.ip`, `source.port`, `source.as.number` (`ASN`), `source.as.organization.name` (`ISP / Carrier`)
    - `source.geo.city_name`, `source.geo.region_name`, `source.geo.region_iso_code`, `source.geo.country_name`, `source.geo.country_iso_code`, `source.geo.continent_name`, `source.geo.location` (`lat`, `lon`)
    - `network.bytes`, `network.transport` (`tcp`/`udp`), `network.community_id`, `pfsense.ip.ttl`, `pfsense.tcp.flags`, `rule.id`, `observer.ingress.interface.name`
  - **Backend Endpoint (`GET /api/v1/firewall/open-ports/sessions`):**
    - Query Elasticsearch for the selected target (`destination_ip`, `destination_port`, `protocol`, `window`), aggregating by `source.ip` to compute per-external-IP:
      - **External IP & ASN/Organization** (`source.ip`, `ASN`, `Organization`)
      - **GeoIP Location** (`City, Region, Country (ISO)` + `lat, lon` coordinates)
      - **Connection Length / Span & Activity** (`first_seen_at`, `last_seen_at`, `connection_duration_seconds` = `last_seen - first_seen`, `active_duration_minutes` from active 5-minute slots, `passed_packets`, `total_bytes`, `source_ports`, `tcp_flags`, `ttl`)
      - **Recent Individual Connection Events** for that port.
  - **Frontend UI (`FirewallOpenPortSessionsDrawer.tsx` & `FirewallPage.tsx`):**
    - Make the **`External IPs`** count badge in the **Active Inbound WAN Exposure (Open Ports)** table a clickable interactive button (styled with an external-details icon/hover highlight).
    - Clicking the count opens a slide-over side drawer (`FirewallOpenPortSessionsDrawer`, matching the look and feel of `DeviceAnalyticsDrawer`) displaying KPI summary cards, a sortable/searchable table of all connected external IP addresses with their GeoIP location, ISP/ASN, connection length (`first_seen -> last_seen` & active minutes), packet/byte volume, source ports/TCP flags, and chronological packet history.
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 14 — v1.2.0-rc3)`

---

### Area 12 — Phase 14 (`v1.2.0-rc3`) User Validation Observations & Future UI Cleanup Tasks (`PHASE14-Verify.md`)

#### `FB-P14-001` — Icon-Only Refresh Buttons Across All Views & Drawers
- **User Feedback (`PHASE14-Verify.md`):**
  - *"For all the refresh buttons, get rid of the text and just display the icon."*
- **Technical Evaluation & Planned Changes:**
  - Across `DevicesPage.tsx` (`Sync from OPNsense`), `SchedulesPage.tsx`, `AnalyticsPage.tsx` (`Refresh Analytics`), `FirewallPage.tsx` (`Refresh Firewall`), `StatusPage.tsx`, `DeviceAnalyticsDrawer.tsx` (`Refresh Telemetry`), `GroupAnalyticsDrawer.tsx` (`Refresh Telemetry`), and `FirewallOpenPortSessionsDrawer.tsx` (`Refresh Telemetry`), replace the text label inside the refresh button with an icon-only `<RefreshCw />` button while preserving accessible `title` and `aria-label` attributes (`aria-label="Refresh ..."`).
- **Complexity:** `1 / 5` (Low)
- **Status:** `COMPLETED (Phase 15 — v1.2.0)`

#### `FB-P14-002` — Icon-Only, Larger Mobile-Friendly Action Buttons in `Devices` Inventory List
- **User Feedback (`PHASE14-Verify.md`):**
  - *"In the devices view: In the list of devices, remove the text from the buttons and just show the icons and make the buttons slightly larger for easy clicking on a mobile device."*
- **Technical Evaluation & Planned Changes:**
  - In [`frontend/src/pages/DevicesPage.tsx`](../../frontend/src/pages/DevicesPage.tsx) (and `TimerPopoverMenu.tsx` when rendered in device rows), convert the per-device action buttons (`Inspect` / `Analytics`, `Timer`, `YouTube`, and `Allowed` / `Blocked` internet access toggle) to slightly larger touch-friendly icon-only buttons (`min-h-9 min-w-9 p-2`) with clear color states and tooltips/`aria-label`s for effortless mobile tapping.
- **Complexity:** `1.5 / 5` (Low–Medium)
- **Status:** `COMPLETED (Phase 15 — v1.2.0)`

#### `FB-P14-003` — Magnifying Glass Icon-Only `Inspect` Button in `Analytics` Top Active LAN Devices List
- **User Feedback (`PHASE14-Verify.md`):**
  - *"In analytics view: For the LAN devices list, change the Inspect button to instead just be an Magnifying Glass icon for easy recognition and clicking."*
- **Technical Evaluation & Planned Changes:**
  - In [`frontend/src/pages/AnalyticsPage.tsx`](../../frontend/src/pages/AnalyticsPage.tsx), replace the text `Inspect` button in the **Top Active LAN Devices** table with an icon-only `<Search className="h-4 w-4" />` (magnifying glass) button with `title="Inspect device analytics"` and `aria-label`.
- **Complexity:** `1 / 5` (Low)
- **Status:** `COMPLETED (Phase 15 — v1.2.0)`


#### `FB-P14-004` — Clean Up Search Placeholder Text in External Connection Side-Drawer (`FirewallOpenPortSessionsDrawer.tsx`)
- **User Feedback:**
  - *"In the search field for the External Connection side drawer, the field ends with 'or ISP/,' instead of just 'or ISP'."*
- **Technical Evaluation & Planned Changes:**
  - In [`frontend/src/components/FirewallOpenPortSessionsDrawer.tsx`](../../frontend/src/components/FirewallOpenPortSessionsDrawer.tsx), change the search input `placeholder` from `"Filter by external IP, city, country, or ISP/ASN..."` (which clips after `"or ISP/"` inside the input width) to `"Filter by external IP, city, country, or ISP"`.
- **Complexity:** `1 / 5` (Low)
- **Status:** `COMPLETED (Phase 15 — v1.2.0)`


---

### Area 13 — Phase 15.1 (`v1.2.1`) Hotfix & Time Window Selector Enhancement (`FB-P15-001`)

#### `FB-P15-001` — Add `Today` Filter as the First & Default Time Window Selector Across All Views & Drawers
- **User Feedback:**
  - *"Lets also add one small item to this release to add a Today filter to time selectors that currently show 1hr / Last 24 hr / last 7 days etc. The today button should be the default and show as the first selection item."*
- **Technical Evaluation & Planned Changes (`Phase 15.1 — v1.2.1`):**
  - Add `"today": {"es_gte": "now/d", "interval": "1h", "label": "Today"}` (scoped to `00:00:00` in the configured local timezone `America/Los_Angeles` via `"time_zone": safe_tz` on `@timestamp` range queries and `resolve_window_cutoff_datetime()` in `plex_service.py`) and include `"today"` in `run_telemetry_cache_prewarm()`.
  - Update `AnalyticsPage.tsx`, `FirewallPage.tsx`, `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`, and `FirewallOpenPortSessionsDrawer.tsx` so `Today` (`'today'`) is the first option in the time window selector and the default active selection.
- **Complexity:** `1.5 / 5` (Low–Medium)
- **Status:** `COMPLETED (Phase 15.1 — v1.2.1)`

---

### Area 14 — `v1.3` Interactive UI & Architecture Q&A Backlog Specifications (`FB-P16-001` – `FB-P19-003`)

#### `FB-P16-001` — Apply Batch 5 Elasticsearch 9.4.3 (`logsdb`) Read Optimizations (`Q1`–`Q4`)
- **Source & Rationale:** Cluster-side Batch 5 optimization audit recorded in [`docs/development/Optimizations-suggestions.md`](Optimizations-suggestions.md).
- **Planned Changes (`Phase 16 — v1.3.0-rc1`):**
  1. **`Q1` (`build_open_wan_port_sessions_query` & `normalize_open_wan_port_sessions_response`):** Disable `_source` reconstruction (`"_source": False`) in `latest_sample.top_hits` and `recent_body`, use verified `docvalue_fields` decoded via a backwards-compatible `_extract_hit_fields()` helper, add `"collect_mode": "breadth_first"` on `external_ips.terms`, and sort `latest_sample.top_hits` deterministically by `[{"@timestamp": {"order": "desc"}}]` (`2–11 ms` vs `1.3s–17.2s`).
  2. **`Q3` (`fetch_network_overview`):** Move `{"terms": {"source.ip": RFC1918_CIDRS}}` into `q_lan.query.bool.filter` and preserve `RFC1918_CIDRS` filtering on `q_app`'s `lan_devices` / `by_device.filter` instead of overwriting with `{"match_all": {}}`, preventing high-cardinality external WAN scanner IPs from entering `top_ips` ordinal collection.
  3. **`Q2` (`run_telemetry_cache_prewarm` & `fetch_firewall_overview`):** Cache the `now-30d/h` open WAN port discovery aggregation (`q_wan`) in `AnalyticsCache` (`"firewall:wan_ports_30d"`, `ttl=1800.0`), raise `today`/`7d`/`30d` cache TTLs (`180s` / `900s` / `1800s`), and tune background pre-warmer cadence from `60s` to `180s`.
  4. **`Q4` (`_round_es_gte`, `_msearch` `request_cache`, & `track_total_hits`):** Round `7d`/`30d` queries to `/h` and `24h` to `/5m`, enable rounding across `build_network_overview_query`, `build_device_analytics_query`, and `build_group_analytics_query`, explicitly mark `size: 0` `_msearch` headers `"request_cache": True` (and `"request_cache": False` on `recent_body`), and add `"track_total_hits": False` on `build_device_recent_domains_query()` and `build_group_recent_domains_query()`.
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 16 — v1.3.0-rc1)`

#### `FB-P16-002` — Multi-Node Elasticsearch HA Failover, `CA Cert Path` & `Test All Connections`
- **User Feedback (`v1.3` Q&A):** Support comma-separated multi-node `ELASTICSEARCH_URL` + optional `ELASTICSEARCH_CA_CERT_PATH`, display cluster/node status on the ES Health Card, and add a `Test All Connections` button in Integration Settings.
- **Complexity:** `2 / 5`
- **Status:** `COMPLETED (Phase 16 — v1.3.0-rc1)`

#### `FB-P16-003` — `System` Tab 4th Service Card (`Plex Media Server`), Formatted Service Details & Enforcement Summary KPIs
- **User Feedback (`v1.3` Q&A):** Add a 4th Service Health Card for `Plex Media Server` (version, active streams, latency), format raw Service Card `details` with clean human-readable labels and a collapsible `Technical Details` toggle, and add `YouTube Blocked` + Enforcement Summary KPI counters.
- **Complexity:** `2 / 5`
- **Status:** `COMPLETED (Phase 16 — v1.3.0-rc1)`

#### `FB-P16-004` — User Password/Role Management, Self-Service Password Change & Audit History Pagination / CSV Export / Pruning
- **User Feedback (`v1.3` Q&A):** Allow Admins to reset an existing user's password or switch roles (`Admin` <-> `Operator`), add `Change My Password` inside the Header User Menu, auto-load Audit & Event History with pagination (`50` / `100` / `250`), CSV export, and a `Prune Old Performance Logs` maintenance action.
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 16 — v1.3.0-rc1)`

#### `FB-P16-005` — Global Header Health Link, 2 New Dark-Room Color Themes, `Ctrl+K` Quick-Search & Mobile Bottom Nav
- **User Feedback (`v1.3` Q&A + `PHASE16-Verify.md` Round 2):** Make clicking the top header `HEALTHY` / `DEGRADED` / `DOWN` badge navigate to the `System` tab, add `Emerald & Forest` and `Amber & Carbon` color themes to the User Menu (`5` total themes), add a global `Ctrl+K` / `Cmd+K` quick-search modal (documented in `README.md`, with header button removed in Round 2 to preserve clean header sizing), and add a mobile bottom navigation bar.
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 16 — v1.3.0-rc1)`

#### `FB-P16-006` — Holistic Mobile Responsive UI Redesign (Hamburger Navigation, Zero Horizontal Scroll & Core Mobile Focus)
- **User Feedback (`PHASE16-Verify.md`):**
  - *"All of the pages will need to be updated to fit in the default mobile view that displays properly in the default Chrome DevTools mobile view. The number of changes we will need to make to make this usable will need a lot of testing and UI/UX redesign. The goal will be to not need any left to right scrolling and easy button access through some method. Perhaps a hamburger menu that contains everything will be the easiest method. Aligning with applications like what Asus does with their router app. It might also make sense to reduce the number of features available in a mobile view and only target core features that are used most often on mobile and can be accessed easily."*
- **Technical Evaluation & Planned Scope (`v1.3` Backlog / Future Phase):**
  - Conduct a dedicated responsive mobile UX pass (`375px–430px` viewport target) introducing a clean slide-out / Asus-router-style hamburger drawer menu replacing multi-row toolbars on small viewports, responsive card layouts replacing wide tables without horizontal overflow, and mobile-prioritized quick controls for core tasks (`Devices` allow/block/YouTube/timer toggles, `Groups`, `Schedules` status).
- **Complexity:** `3.5 / 5` (High — requires multi-page UX audit & viewport testing)
- **Status:** `EVALUATING (Scheduled Post-v1.3 Core Stabilization / Phase 19+)`

#### `FB-P16-007` — Clickable GeoIP Locations Opening Google Maps with Centered Marker (`Firewall` & `Devices`/`Analytics` External Connection Views)
- **User Feedback (`PHASE16-Verify.md` Round 2):** *"When viewing data that shows GEOIP location, make the location clickable such that it opens google maps in a new tab with the location centered and a marker at the location."*
- **Technical Evaluation & Planned Scope:** Wherever GeoIP location data is rendered (`FirewallOpenPortSessionsDrawer.tsx`, `ExternalConnectionDrawer.tsx`, and **Top Blocked External WAN Scanners** on `FirewallPage.tsx`), render the GeoIP location badge/text as an interactive external link (`target="_blank" rel="noopener noreferrer"`) pointing to `https://www.google.com/maps/search/?api=1&query=<lat>,<lon>` (when `latitude`/`longitude` coordinates are present in ES `source.geo.location` / `destination.geo.location`) or `https://www.google.com/maps/search/?api=1&query=<encoded City, Region, Country>` so Google Maps opens in a new tab centered with a marker pin at that location.
- **Complexity:** `1.5 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P17-001` — `Devices` Tab Collapsible Group Section & Compact Icon Group Action Controls
- **User Feedback (`v1.3` Q&A):** Add a collapsible/compact mode for `Device Groups & Profiles` and convert Group Card action buttons (`Filter`, `Analytics`, `YouTube`, `Timer`, `Allow/Block Group`) to compact mobile-friendly icon buttons matching the Device Table rows.
- **Complexity:** `2 / 5`
- **Status:** `COMPLETED (Phase 17 — v1.3.0-rc2)`

#### `FB-P17-002` — `Devices` Tab Unified `Actions` Column, Column Sorting, Inline `+ Group` Popover & Offline Device Archiving
- **User Feedback (`v1.3` Q&A):** Merge `Telemetry` and `Internet Access` into a single right-aligned `Actions` column, add clickable column sorting (`Name`, `IPv4`, `Online`, `Vendor`, `Blocked`), add inline `+ Group` quick assignment on device rows and inline editing, and allow archiving/deleting stale offline devices with an `Archived` filter pill.
- **Complexity:** `3 / 5`
- **Status:** `COMPLETED (Phase 17 — v1.3.0-rc2)`

#### `FB-P17-003` — Device & Group Analytics Drawer Compact Header Controls & Inline Timer
- **User Feedback (`v1.3` Q&A):** Convert Drawer header controls (`Internet Access`, `YouTube`) to compact icons and add a `Timer` control (`TimerPopoverMenu`) directly inside the drawer header.
- **Complexity:** `1.5 / 5`
- **Status:** `COMPLETED (Phase 17 — v1.3.0-rc2)`

#### `FB-P17-004` — `Schedules` Tab Expanded Rule Capabilities (`YouTube Only` Mode, Editable Target & Clone Rule)
- **User Feedback (`v1.3` Q&A):** Allow recurring Schedules to block either `Full Internet Access` or `YouTube Only`, allow changing the Target (`Group` or `Device`) when editing an existing Schedule Rule, and add a `Duplicate / Clone Schedule` action.
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 17 — v1.3.0-rc2)`

#### `FB-P17-005` — `Schedules` Tab Visual 7-Day Weekly Timeline Bar, Compact Card Controls, Snooze & Auto-Refresh
- **User Feedback (`v1.3` Q&A):** Add a visual 7-Day / 24-Hour Weekly Schedule Coverage Timeline bar at the top of the `Schedules` tab, convert Schedule Card controls to consistent compact buttons, add a `Skip Next Occurrence / Snooze Schedule` action on active cards, and add `AutoRefreshSelector` to the `Schedules` header.
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 17 — v1.3.0-rc2)`

#### `FB-P17-006` — Device Group Daily YouTube Viewing Time Quota with Reward / Bonus Precedence
- **User Feedback (`PHASE17-Verify.md`):** Allow configuring a daily YouTube viewing time limit (e.g., `1h / day`) when creating/editing a Device Group (`daily_youtube_limit_minutes`) so no more than that quota of active YouTube watch time can be used per day, automatically blocking YouTube for the group once exceeded while ensuring **Reward / Bonus Timers always take strict precedence** over daily limits and schedules.
- **Complexity:** `3 / 5`
- **Status:** `COMPLETED (Phase 18 — v1.3.0-rc3)`

#### `FB-P17-007` — `Devices` Tab Mobile-Compact Layout (Friendly Name + Action Buttons Only)
- **User Feedback (`PHASE17-Verify.md`):** On mobile screen widths (where the bottom navigation bar is displayed), render only the **Device / Friendly Name** and the **Action Buttons** in the `Devices` inventory table (hiding secondary columns such as IPv4/MAC, Vendor, Lease, Groups, and Last Seen on `< sm` viewports) so rows stay compact and actionable without horizontal scrolling.
- **Complexity:** `1.5 / 5`
- **Status:** `COMPLETED (Phase 18 — v1.3.0-rc3)`

#### `FB-P17-008` — `Devices` Tab Default to `Online` Filter & Remember User Selection
- **User Feedback (`PHASE17-Verify.md`):** Default the `Devices` inventory filter pill to **`Online`** on first load (`gateway_devices_status_filter` in `localStorage`) and persist the user's selected filter across subsequent visits/reloads.
- **Complexity:** `1 / 5`
- **Status:** `COMPLETED (Phase 18 — v1.3.0-rc3)`

#### `FB-P18-001` — Per-Device & Global Domain and ASN Organization Blocking (`FB-P4-007`..`009`) + Backup/Restore Support
- **User Feedback (`v1.3` Q&A):** Implement per-device Domain & ASN Organization blocking (`FB-P4-007`, `FB-P4-008`, `FB-P4-009`) in the Device Analytics Drawer backed by OPNsense per-device/global Host & BGP ASN aliases + automation filter rules (plus global Unbound/alias toggles from the `Analytics` tab), and include custom Domain/ASN rules & archived device flags in Configuration Backup & Restore JSON exports.
- **Complexity:** `4 / 5`
- **Status:** `COMPLETED (Phase 18 — v1.3.0-rc3)`

#### `FB-P18-002` — Expanded Application Usage Telemetry (`Netflix`, `Disney+`, `Twitch`, `TikTok`, `Discord`, `Gaming`) & Enhanced Plex `Now Playing`
- **User Feedback (`v1.3` Q&A):** Track additional apps (`Netflix`, `Disney+`, `Twitch`, `TikTok`, `Discord`, `Gaming`) with expandable Top Devices + bandwidth breakdowns, and enhance live Plex `Now Playing` stream cards with username, playback progress bar / percentage, and transcode bitrate details.
- **Complexity:** `3 / 5`
- **Status:** `COMPLETED (Phase 18 — v1.3.0-rc3)`

#### `FB-P18-003` — `Analytics` Tab Sortable/Searchable LAN Table & Clickable Domain/ASN Client Attribution Drilldowns
- **User Feedback (`v1.3` Q&A):** Add column sorting (`DNS Queries`, `Firewall Bytes`, `Total Events`, `Device Name`) + search filter input to `Top Active LAN Devices`, and make domains & ASN organizations clickable to inspect which LAN devices queried/contacted them (with direct action links).
- **Complexity:** `2.5 / 5`
- **Status:** `COMPLETED (Phase 18 — v1.3.0-rc3)`

#### `FB-P18-004` (`BUG-P18-004`) — Auto-Unblock Group YouTube Access When Daily YouTube Quota Is Removed or Raised
- **User Feedback (`PHASE18-Verify.md` Section B):** When a Device Group has an active daily YouTube limit that was breached (causing YouTube to be blocked) and the user subsequently deletes/clears the daily limit (or raises it above today's usage), YouTube should automatically be unblocked rather than staying blocked.
- **Technical Evaluation & Planned Scope:** Update `update_group()` in `backend/app/services/group_service.py` so whenever `daily_youtube_limit_minutes` is cleared (`None`) or increased above `today_youtube_minutes`, non-protected group members not covered by an active `pause` override or active `youtube`-mode schedule have `is_youtube_blocked` released and OPNsense `gateway_youtube_blocked_devices` synchronized immediately.
- **Complexity:** `1.5 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-005` — Click-to-Expand Application Usage Telemetry Card Modal / Detail View
- **User Feedback (`PHASE18-Verify.md` Section C):** Clicking any box inside **Application Usage Stats** should open an expanded card/modal showing complete untruncated application details (e.g., full Plex `Now Playing` show/episode title, user, player/platform, resolution, transcode decision, bitrate, progress bar, and full per-device usage breakdown).
- **Technical Evaluation & Planned Scope:** Add interactive click expansion / `<AppUsageDetailModal />` across `AnalyticsPage.tsx`, `DeviceAnalyticsDrawer.tsx`, and `GroupAnalyticsDrawer.tsx` rendering the complete application telemetry metrics, untruncated `Now Playing` stream cards, and all active devices/minutes/DNS/bandwidth for the clicked app.
- **Complexity:** `2 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-006` — `Analytics` Tab Mobile-Compact `Top Active LAN Devices` Table
- **User Feedback (`PHASE18-Verify.md`):** In the mobile view (`< sm` viewport), update the `Top Active LAN Devices` table on `AnalyticsPage.tsx` to display only **Device**, **Total Events**, and **Inspect** so all columns fit cleanly on screen.
- **Technical Evaluation & Planned Scope:** Apply `hidden sm:table-cell` to the `IPv4 & Vendor`, `DNS Queries`, and `Firewall Bytes` `<th>` and `<td>` cells inside `overview-top-devices-table` in `AnalyticsPage.tsx`.
- **Complexity:** `1 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-007` (`BUG-P18-005`) — Consistent Auto-Refresh Timer Execution & `Updated: HH:MM:SS` Across All Tabs
- **User Feedback (`PHASE18-Verify.md`):** Auto-refresh timer behavior is inconsistent across tabs (`Devices` sync timer never updates live state/timestamp, `Analytics` fires a flash without refreshing cached data or `Updated:` clock, `Firewall` updates the `Updated:` timestamp without updating panel snapshots).
- **Technical Evaluation & Planned Scope:** Ensure `DevicesPage.tsx` runs `apiClient.syncDevices()` on auto-refresh ticks (updating live inventory & `Synced: HH:MM:SS`), and update `AnalyticsPage.tsx` and `FirewallPage.tsx` so scheduled background refetches pass `refresh: true` to bypass short-TTL backend cache, update `windowSnapshots[windowKey]`, and refresh `Updated: HH:MM:SS`.
- **Complexity:** `2 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-008` — Configurable App Telemetry Catalog in `System` Settings (Default `YouTube` & `Plex`, Opt-In Others) + Combined `Facebook & Threads`
- **User Feedback (`PHASE18-Verify.md`):** Add a settings area in **System** to configure which items are displayed for Application Telemetry (defaulting to **YouTube** and **Plex** enabled with all other apps opt-in), and add combined tracking for **Facebook and Threads** as a single grouped item.
- **Technical Evaluation & Planned Scope:** Add `facebook_threads` (`Facebook & Threads`: `facebook.com`, `fbcdn.net`, `instagram.com`, `threads.net`, `threads.com`, Meta ASN `AS32934` correlation) as a single grouped application category (`9` total), persist `enabled_telemetry_apps` (defaulting to `["youtube", "plex"]`) via `runtime_settings_service.py` / `api/system.py`, and add an **Application Telemetry Visibility** configuration section in `StatusPage.tsx` respected by `AnalyticsPage.tsx`, `DeviceAnalyticsDrawer.tsx`, and `GroupAnalyticsDrawer.tsx`.
- **Complexity:** `2.5 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-009` — Centered Screen Modal Popup for User `Change My Password`
- **User Feedback (`PHASE18-Verify.md`):** In the User Panel (Header User Menu dropdown), replace the inline downward-chevron accordion for changing password with a trigger that opens a centered screen modal popup to perform the password change.
- **Technical Evaluation & Planned Scope:** Move the self-service `Change My Password` form in `AppLayout.tsx` into a centered modal dialog (`ChangePasswordModal`) opened from the User Menu button and closing cleanly on backdrop click/Escape/`Cancel`.
- **Complexity:** `1.5 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-010` — `System` Tab Top 4 Service Health Cards — Remove Redundant Subtitle & Status Message Text
- **User Feedback (`PHASE18-Verify.md`):** On the **System** tab, remove the redundant subtitle (`OPNsense REST API...`, etc.) and status message paragraph (`OPNsense API connected...`, etc.) underneath the 4 top vertical Service Health Card titles because that data is already visible in the Technical Details section.
- **Technical Evaluation & Planned Scope:** Update `ServiceCard` in `StatusPage.tsx` to omit the redundant subtitle line and descriptive status paragraph underneath each card title while retaining the card title, status badge, primary KPI/shard/storage highlights, and collapsible Technical Details.
- **Complexity:** `1 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-011` — Sticky Top Page Header in Desktop / Full-Page Mode
- **User Feedback (`PHASE18-Verify.md`):** When in full-page/desktop mode (not mobile), keep the top page header always visible at the top of the viewport so users do not need to scroll back up to switch tabs (matching mobile's persistent bottom nav).
- **Technical Evaluation & Planned Scope:** Update `<header>` in `AppLayout.tsx` from `relative z-30` to `sticky top-0 z-40` so navigation tabs, health badge, and user controls remain pinned while scrolling.
- **Complexity:** `1 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P18-012` — `System` Tab `Test All Connections` Popup — Show Average Ping Latency for Multi-Node Services
- **User Feedback (`PHASE18-Verify.md`):** In the `Test All Connections` popup modal on **System**, display the average ping time in `OK (time)` when multiple nodes are configured for a service (e.g., average across 3 Elasticsearch nodes), while single-node services (e.g., OPNsense) continue showing their individual ping time.
- **Technical Evaluation & Planned Scope:** Compute the rounded arithmetic mean across `nodeRows` (`nodeRows.length > 1`) in `StatusPage.tsx` (and/or `runtime_settings_service.py`) for the service summary badge (`OK (avg XX.X ms)` / average latency) while retaining per-node latency rows underneath.
- **Complexity:** `1 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P19-001` — `Firewall` Tab Compact `Noisy LAN` Controls (`Inspect` Trigger) & Open WAN Port Service Descriptions
- **User Feedback (`v1.3` Q&A):** Convert `Noisy LAN Devices` Block/Unblock controls to compact icon buttons and add the Magnifying Glass `Inspect` button to open `DeviceAnalyticsDrawer` directly from the `Firewall` tab; display friendly OPNsense D-NAT rule descriptions (`Plex Media Server`, `WireGuard VPN`) and `Last Seen` timestamps in `Active Inbound WAN Exposure (Open Ports)`.
- **Complexity:** `2 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P19-002` — `Firewall` Tab External WAN Scanner GeoIP Badges, Clickable Google Maps Links (`FB-P16-007`) & `Block External IP at WAN` Enforcement
- **User Feedback (`v1.3` Q&A + `PHASE16-Verify.md` Round 2):** Display GeoIP Country/City badges on `Top Blocked External WAN Scanners` (clickable to filter logs), render clickable GeoIP locations across external connection drawers and scanner views (`FB-P16-007`) opening Google Maps centered with a location marker in a new tab, and add a Country summary breakdown bar + `Block External IP at WAN` button (backed by an OPNsense WAN blocklist alias) inside `FirewallOpenPortSessionsDrawer`.
- **Complexity:** `3 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

#### `FB-P19-003` — `Firewall` Tab Interactive Click-to-Filter Packet Log Explorer, Row Limits & CSV/JSON Export
- **User Feedback (`v1.3` Q&A):** Make `Source IP`, `Destination IP`, `Port`, and `Interface` cells clickable inside the Firewall Packet Log Explorer to apply removable filter chips, and add configurable row limit selectors (`50` / `100` / `250`) plus CSV/JSON export.
- **Complexity:** `2 / 5`
- **Status:** `SCHEDULED (Phase 19 — v1.3.0)`

