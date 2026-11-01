# Feature & UI Feedback Backlog (`docs/FEATURE_BACKLOG.md`)

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
| **`FB-P4-002`** | Page Header / Versioning | Increment application version (`v0.1.0` → `v0.4.0` / `v0.5.0`...) on each phase push to match GitHub | Release & Versioning | `1 / 5` | **Phase 4 Exit / Every Phase Push** | `COMPLETED (Ongoing Rule — v0.5.0 in Phase 5)` |
| **`FB-P4-003`** | Devices & Access Control Tab | Change Telemetry column button label from `Usage & Domains` to `Analytics` | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-004`** | Devices & Access Control Tab | Internet Access column button: remove `— Click to Block` / `— Click to Allow` and show only current state (`Blocked` / `Allowed`) | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-005`** | Analytics Pop-Out Drawer | Remove ``(`dns.question.name`)`` from `Top Visited Domains` panel title | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-006`** | Analytics Pop-Out Drawer | Convert `Usage & Activity Timeline` bar chart to a **Stacked Bar Graph** (distinct colors for **DNS Queries** vs. **Firewall Events**, visible color legend, and breakdown in hover tooltip) | Data Visualization | `1.5 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-007`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each domain in `Top Visited Domains` to block that domain on the viewed device | New Control Feature (Per-Device Domain Block) | `4 / 5` | **Phase 6 / 7** *(Needs Architecture Sign-Off)* | `EVALUATING` |
| **`FB-P4-008`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each organization in `Top Destination Organizations (ASN)` to block that ASN on the viewed device | New Control Feature (Per-Device ASN Block) | `4 / 5` | **Phase 6 / 7** *(Needs Architecture Sign-Off)* | `EVALUATING` |
| **`FB-P4-009`** | Analytics Pop-Out Drawer | Add **Blocked Domains & ASN Organizations** panel below `Chronological Recent DNS Queries` with an **Unblock / Remove** button per item | New Control Feature (Per-Device Block Management UI) | `3 / 5` | **Phase 6 / 7** *(Paired with `FB-P4-007` & `008`)* | `EVALUATING` |
| **`FB-P4-010`** | Traffic & DNS Analytics Tab | Remove ``(`logs-pfsense.log*`)`` from page title and change `Inspect Device` button label to `Inspect` in `Top Active LAN Devices` | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `COMPLETED (Phase 5)` |
| **`FB-P4-011`** | System Connectivity Tab | Evaluate & replace/remove stale Phase 1 `Network Device Inventory & Internet Access Control` placeholder box at bottom of `StatusPage.tsx` | Architecture / Design Review | `1.5 / 5` | **Phase 5** *(Design Decision Below)* | `COMPLETED (Phase 5 — Option A)` |
| **`FB-P5-001`** | Timer Controls (Modal) | Open Timer controls as a **centered screen modal dialog** instead of an inline dropdown so it never requires scrolling and prevents multiple menus from opening simultaneously | UX / Modal Interaction | `1.5 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-002`** | Timer Controls (Active Button) | When a timer is active, display the **live countdown directly inside the Timer button** (`Paused: 28m left` / `Bonus: 19m left`) and color the button (`amber` for Pause, `emerald` for Bonus) instead of rendering a separate pill | UI / Control Polish | `1.5 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-003`** | Timer Controls (Preset Labels) | Show only durations (`15m`, `30m`, `1h`, `2h`, `Until 07:00`) on preset buttons inside the Timer modal without repeating `Pause` or `Bonus` inside each button | UI Copy / Polish | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-004`** | Timer Controls (Bonus Presets) | Change Bonus Access default preset values to **`20m`**, **`40m`**, and **`60m`** | Control Feature Update | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-005`** | Device Groups & Profiles | Match the `Timer` button height (`py-1.5 text-xs`) to the adjacent buttons (`Filter`, `Analytics`, `Allow All`, `Block All`) in the Device Groups & Profiles cards | UI Alignment | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-006`** | Top Page Header | Change the header `Sign Out` button label to simply say `Logout` | UI Copy / Polish | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-007`** | Device Groups & Profiles | When clicking `Filter` on a Group card, highlight the button (`Filter` active state) **without changing button text width or rearranging/stacking** the card's buttons | UI Layout Stability | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-008`** | Devices & Access Control Header | Remove ``(`gateway_blocked_devices`)`` from the page header description | UI Copy / Polish | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-009`** | Devices & Access Control Header | Format `Synced: HH:MM:SS` as a **24-hour clock** (single line, no `AM/PM`) and move it directly underneath the `Sync from OPNsense` button | UI Layout / Formatting | `1 / 5` | **Phase 6** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |
| **`FB-P5-010`** | Container & SQLite Persistence | Ensure saved groups, nicknames, timers, and schedules persist across container restarts/rebuilds (`SQLITE_DB_PATH=/app/data/gateway.db` bound to `../data:/app/data` in `Settings.database_url`) | Infrastructure / Persistence | `1.5 / 5` | **Phase 6 & 7** *(Scheduled Batch)* | `OPEN (Scheduled Phase 6)` |

---

## 2. Detailed Item Specifications & Technical Evaluations

### Area 1 — Page Header (`frontend/src/components/AppLayout.tsx`, `backend/app/__init__.py`)

#### `FB-P4-001` — Remove `SYSTEM:` Prefix from Header Health Status Pill
- **User Feedback:** *"Remove the word SYSTEM: from SYSTEM: HEALTHY and instead just show the health status (HEALTHY, DOWN, etc)"*
- **Current Implementation:**
  - In [frontend/src/components/AppLayout.tsx](file:///d:/source/gateway-front-end/frontend/src/components/AppLayout.tsx#L140-L149), the top navigation status badge renders:
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
  - [backend/app/__init__.py](file:///d:/source/gateway-front-end/backend/app/__init__.py#L3) hardcodes `__version__ = "0.1.0"`, which is returned by `/api/v1/system/health` (`app_version`) and rendered in [frontend/src/components/AppLayout.tsx](file:///d:/source/gateway-front-end/frontend/src/components/AppLayout.tsx#L151) (`v{health?.app_version || '0.1.0'}`).
  - [backend/pyproject.toml](file:///d:/source/gateway-front-end/backend/pyproject.toml#L7) and [frontend/package.json](file:///d:/source/gateway-front-end/frontend/package.json#L4) also declare `"0.1.0"`.
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
  - In [frontend/src/pages/DevicesPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/DevicesPage.tsx#L535), the Telemetry button on each row renders `Usage & Domains`.
- **Planned Change:**
  - Change the button label from `Usage & Domains` to `Analytics` in `DevicesPage.tsx` and update matching queries in `frontend/src/__tests__/DeviceAnalytics.test.tsx`.
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-004` — Internet Access Column Button: Show Only Current State (`Blocked` / `Allowed`)
- **User Feedback:** *"For internet access column, remove the -- Click to block and instead just show the current state. Clicking will still change the state appropriately"*
- **Current Implementation:**
  - In [frontend/src/pages/DevicesPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/DevicesPage.tsx#L563-L578), the toggle button displays `Blocked — Click to Allow` when blocked and `Allowed — Click to Block` when allowed.
- **Planned Change:**
  - Simplify the visible button text to `Blocked` (when `device.is_blocked === true`) and `Allowed` (when `device.is_blocked === false`), preserving the click handler, hover styling, `title` tooltip, and `aria-label` accessibility attributes.
  - Update matching button text assertions in `frontend/src/__tests__/DevicesPage.test.tsx`.
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-005` — Remove ``(`dns.question.name`)`` from `Top Visited Domains` Label in Analytics Drawer
- **User Feedback:** *"Analytics pop out drawer, remove ('dns.question.name') from Top Visited Domains label"*
- **Current Implementation:**
  - In [frontend/src/components/DeviceAnalyticsDrawer.tsx](file:///d:/source/gateway-front-end/frontend/src/components/DeviceAnalyticsDrawer.tsx#L431-L435), the card header reads:
    `Top Visited Domains (dns.question.name)`.
- **Planned Change:**
  - Change the header to `Top Visited Domains` (matching `GroupAnalyticsDrawer.tsx`).
- **Complexity:** `1 / 5` (Low).

---

#### `FB-P4-006` — Stacked Usage & Activity Timeline Bar Graph with Color Key & Hover Breakdown
- **User Feedback:** *"Analytics pop out drawer, For Usage & Activity Timeline graph, change graph to a stacked graph that shows different colors for DNS and Firewall Events stacked on the bar. Show the key for the colors as a label in the graph and have it reflected in the pop up when mouse over for details"*
- **Current Implementation:**
  - In [frontend/src/components/DeviceAnalyticsDrawer.tsx](file:///d:/source/gateway-front-end/frontend/src/components/DeviceAnalyticsDrawer.tsx#L330-L371) (and [frontend/src/components/GroupAnalyticsDrawer.tsx](file:///d:/source/gateway-front-end/frontend/src/components/GroupAnalyticsDrawer.tsx#L382-L414)), each timeline bucket already receives `total_events`, `dns_queries`, `allowed_events`, `blocked_events`, and `bytes_total` from the backend, but renders a single solid cyan bar sized by `total_events`.
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
  - In [frontend/src/pages/AnalyticsPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/AnalyticsPage.tsx#L91), the page `<h2>` reads:
    `Network Traffic & DNS Analytics (logs-pfsense.log*)`.
  - In [frontend/src/pages/AnalyticsPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/AnalyticsPage.tsx#L285), the action button in the `Inspect` column of `Top Active LAN Devices` reads `Inspect Device`.
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
     - In **Phase 1**, before any tabs existed, `StatusPage.tsx` was the *only* page in the app. At the bottom of [frontend/src/pages/StatusPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/StatusPage.tsx#L203-L218), we placed a dashed placeholder card titled `Network Device Inventory & Internet Access Control` with a badge saying `"Phase 1 Foundation Ready"` and copy stating *"Phase 2 connects live ARP & Dnsmasq DHCP leases from OPNsense to populate the interactive device control table here."*
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
  - In [frontend/src/components/AppLayout.tsx](file:///d:/source/gateway-front-end/frontend/src/components/AppLayout.tsx#L166), change `Sign Out` to `Logout` (keep `aria-label="Logout"` / update unit tests in `App.test.tsx`).
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-007` — Keep Group Card Button Layout Fixed When `Filter` Is Clicked
- **User Feedback:** *"When clicking filter, the window reorganizes the buttons and stacks them. Update to instead only highlight the Filtered Button but not change the layout at all"*
- **Root Cause & Planned Change:**
  - In [frontend/src/pages/DevicesPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/DevicesPage.tsx#L288-L300), clicking `Filter` currently changes the button label from `Filter` to `Filtered` (widening the button) AND wraps the flex row on narrower cards.
  - Keep the button text constant as `Filter` (with `whitespace-nowrap`) and only toggle the highlighted visual state (`border-indigo-400 bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-400/40` vs. default slate), so zero width or layout shift occurs when toggling a group filter.
- **Complexity:** `1 / 5` (Low).

#### `FB-P5-008` — Remove ``(`gateway_blocked_devices`)`` from Devices Page Header Description
- **User Feedback:** *"In the page header for the view, remove (`gateway_blocked_services`) from the description"*
- **Planned Change:**
  - In [frontend/src/pages/DevicesPage.tsx](file:///d:/source/gateway-front-end/frontend/src/pages/DevicesPage.tsx#L162-L166), change the subtitle from:
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
    1. Update `Settings` in `backend/app/config.py` (and `docker/Dockerfile` + `docker/docker-compose.yml`) so that when `SQLITE_DB_PATH` is set (or in container defaults), `database_url` resolves to `sqlite+aiosqlite:////app/data/gateway.db` (the host-mounted `d:\source\gateway-front-end\data\gateway.db` volume).
    2. Ensure startup initialization (`init_db()` / Alembic migrations) non-destructively creates/upgrades tables in `/app/data/gateway.db` so device nicknames, protection flags, groups, active timers, and recurring schedules all survive container restarts, rebuilds, and version upgrades.
- **Complexity:** `1.5 / 5` (Low–Medium).

