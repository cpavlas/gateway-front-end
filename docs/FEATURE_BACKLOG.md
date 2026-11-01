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
| **`FB-P4-001`** | Page Header | Remove `SYSTEM:` prefix from health badge (`HEALTHY`, `DEGRADED`, `UNHEALTHY`) | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `OPEN (Scheduled Phase 5)` |
| **`FB-P4-002`** | Page Header / Versioning | Increment application version (`v0.1.0` → `v0.4.0` / `v0.5.0`...) on each phase push to match GitHub | Release & Versioning | `1 / 5` | **Phase 4 Exit / Every Phase Push** | `OPEN (Scheduled Phase 4/5)` |
| **`FB-P4-003`** | Devices & Access Control Tab | Change Telemetry column button label from `Usage & Domains` to `Analytics` | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `OPEN (Scheduled Phase 5)` |
| **`FB-P4-004`** | Devices & Access Control Tab | Internet Access column button: remove `— Click to Block` / `— Click to Allow` and show only current state (`Blocked` / `Allowed`) | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `OPEN (Scheduled Phase 5)` |
| **`FB-P4-005`** | Analytics Pop-Out Drawer | Remove ``(`dns.question.name`)`` from `Top Visited Domains` panel title | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `OPEN (Scheduled Phase 5)` |
| **`FB-P4-006`** | Analytics Pop-Out Drawer | Convert `Usage & Activity Timeline` bar chart to a **Stacked Bar Graph** (distinct colors for **DNS Queries** vs. **Firewall Events**, visible color legend, and breakdown in hover tooltip) | Data Visualization | `1.5 / 5` | **Phase 5** *(Quick-Win Batch)* | `OPEN (Scheduled Phase 5)` |
| **`FB-P4-007`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each domain in `Top Visited Domains` to block that domain on the viewed device | New Control Feature (Per-Device Domain Block) | `4 / 5` | **Phase 6 / 7** *(Needs Architecture Sign-Off)* | `EVALUATING` |
| **`FB-P4-008`** | Analytics Pop-Out Drawer | Add per-device **Block** button next to each organization in `Top Destination Organizations (ASN)` to block that ASN on the viewed device | New Control Feature (Per-Device ASN Block) | `4 / 5` | **Phase 6 / 7** *(Needs Architecture Sign-Off)* | `EVALUATING` |
| **`FB-P4-009`** | Analytics Pop-Out Drawer | Add **Blocked Domains & ASN Organizations** panel below `Chronological Recent DNS Queries` with an **Unblock / Remove** button per item | New Control Feature (Per-Device Block Management UI) | `3 / 5` | **Phase 6 / 7** *(Paired with `FB-P4-007` & `008`)* | `EVALUATING` |
| **`FB-P4-010`** | Traffic & DNS Analytics Tab | Remove ``(`logs-pfsense.log*`)`` from page title and change `Inspect Device` button label to `Inspect` in `Top Active LAN Devices` | UI Copy / Polish | `1 / 5` | **Phase 5** *(Quick-Win Batch)* | `OPEN (Scheduled Phase 5)` |
| **`FB-P4-011`** | System Connectivity Tab | Evaluate & replace/remove stale Phase 1 `Network Device Inventory & Internet Access Control` placeholder box at bottom of `StatusPage.tsx` | Architecture / Design Review | `1.5 / 5` | **Phase 5** *(Design Decision Below)* | `EVALUATING (Recommended Option A/B)` |

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

