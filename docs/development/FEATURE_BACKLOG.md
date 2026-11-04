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
| **`FB-P4-007`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each domain in `Top Visited Domains` to block that domain on the viewed device | New Control Feature (Per-Device Domain Block) | `4 / 5` | **Phase 6 / 7** *(Needs Architecture Sign-Off)* | `EVALUATING` |
| **`FB-P4-008`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each organization in `Top Destination Organizations (ASN)` to block that ASN on the viewed device | New Control Feature (Per-Device ASN Block) | `4 / 5` | **Phase 6 / 7** *(Needs Architecture Sign-Off)* | `EVALUATING` |
| **`FB-P4-009`** | Analytics Pop-Out Drawer | Add **Blocked Domains & ASN Organizations** panel below `Chronological Recent DNS Queries` with an **Unblock / Remove** button per item | New Control Feature (Per-Device Block Management UI) | `3 / 5` | **Phase 6 / 7** *(Paired with `FB-P4-007` & `008`)* | `EVALUATING` |
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
| **FB-P10-001** | New Firewall & Security Tab | Dedicated Firewall log explorer & security dashboard showing passed/blocked packet metrics, direction, searchable ilterlog stream, **Suspected Bad Actors / Scanners** (with 1-click LAN block), and **Active Inbound WAN Exposure (Open Ports)** | Security & Firewall Telemetry | 3.5 / 5 | **Phase 10 (1.0.4)** | SCHEDULED (Phase 10) |
| **FB-P11-001** | Header Logo & Browser Favicon | Replace the shield icon with a custom **side-profile Unicorn with Rainbow Horn** SVG icon in the app header, login screen, and browser tab favicon | Branding & Iconography | 1.5 / 5 | **Phase 11 (1.1.0)** | SCHEDULED (Phase 11) |
| **FB-P11-002** | Header User Menu & Color Themes | Clicking the user's Name in the top header opens User Settings with **3 Eye-Friendly Dark-Room Color Themes** (Default Slate, Crimson & Obsidian light/dark red on black, and Ocean & Navy light/dark blue on deep navy) persisted per user | User Preferences & Theming | 2.5 / 5 | **Phase 11 (1.1.0)** | SCHEDULED (Phase 11) |

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
- **Status:** `OPEN — Planned for v1.2 / Dedicated Plex Integration Phase`
