# Phase Exit Analyses & Unplanned-Information Retrospectives

At the completion of every phase (before Git check-in and unlocking the next phase), this document captures:
1. **Test Cycle & Quality Gate Summary** (unit test counts, coverage, resolved vs. deferred bugs).
2. **Waterfall Impact Analysis** (how deferred bugs or newly discovered technical details alter upcoming phases and complexity ratings in [PLAN.md](../PLAN.md)).
3. **Unplanned Information Audit** (*"What information or configuration was needed that we did not plan for?"* and how those learnings are applied to the next phase).

---

## Phase 1 Exit Report (`2026-10-31`)

### 1. Quality Gate Summary
- **Backend Unit Tests (`pytest`):** `33 / 33 passed` in `1.02s` — **93.0% total statement coverage** (exceeds `>= 85%` gate).
- **Backend Static Analysis (`ruff` + `mypy`):** `0 errors` across all 15 source files and test suites.
- **Frontend Unit Tests (`Vitest`):** `4 / 4 passed` in `1.33s` — **98.78% line/statement coverage**, **92.85% branch coverage**, **100% function coverage**.
- **Frontend Production Build (`tsc -b && vite build`):** Succeeded in `1.49s` with `0 errors`.
- **Full-Stack Live Smoke Test:** Passed against live `https://opnsense.example.local` (`373.01 ms`), `https://elasticsearch.example.local:9200` (`39.53 ms`, `6,689,623` docs in `logs-pfsense.log*`), and local SQLite (`54.11 ms`).
- **Bugs Resolved in Phase 1:** `5` (`BUG-P1-001` through `BUG-P1-005` in [docs/development/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `3` live environment schema discoveries waterfalled into Phases 2 and 3 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments to Future Phases (`PLAN.md`)
1. **Waterfalled into Phase 2 (Device Discovery & Instant Block/Unblock):**
   - **Update 2A — Dnsmasq Lease Field Mapping & `"*"` Placeholder Handling:** Live inspection of `/api/dnsmasq/leases/search` on OPNsense `26.7.7-amd64` showed lease objects use `address` (IPv4), `hwaddr` (MAC), `mac_info` (manufacturer), `if_descr`, and literal `"*"` when `hostname` or `client_id` is unknown. Added explicit requirement in Phase 2 to map `address`/`hwaddr`/`mac_info` alongside ARP's `ip`/`mac`/`manufacturer` and normalize `hostname == "*"` to `None`.
   - **Update 2B — Dual-Path Alias Mutation (`alias_util` + `/api/firewall/alias/*` Config Fallback):** Because `Firewall: Aliases` (`page-firewall-aliases`) grants access to `/api/firewall/alias/*` (`get_alias_uuid`, `get_item`, `set_item`, `reconfigure`) whereas `/api/firewall/alias_util/*` requires `Diagnostics: PF Table IP addresses` (`page-diagnostics-table`), Phase 2's `block_ip()` and `unblock_ip()` methods in `OPNsenseClient` will support `alias_util/add` & `alias_util/delete` with an automatic fallback to `get_alias_uuid` → `get_item` → `set_item` → `reconfigure` so blocking works with or without `page-diagnostics-table`.
   - **Phase 2 Complexity Impact:** Remains **3 / 5 (Medium)** (risk reduced because exact ARP/Dnsmasq JSON schemas and alias UUID `7eb9bc75-bcba-42f9-8193-f5b14090488a` are already verified).
2. **Waterfalled into Phase 3 (Elasticsearch `9.4.3` Analytics):**
   - **Phase 3 Complexity Impact:** Confirmed at **3.5 / 5 (Medium–High)** (down from original `4 / 5`).

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 2
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (Host & TLS Setup):* OPNsense is accessed via FQDN `https://opnsense.example.local` (`192.168.1.1`) and Elasticsearch via `https://elasticsearch.example.local:9200`, both with valid TLS certificates (`VERIFY_SSL=true`).
  - *Finding 2 (OPNsense `26.7.7-amd64` GUI & `ACL.xml` Exact Naming):*
    1. Dnsmasq only exposes `Services: Dnsmasq DNS/DHCP: Settings` and `Services: Dnsmasq DNS/DHCP: Logfile` (`Settings` maps to `api/dnsmasq/*`, which covers `/api/dnsmasq/leases/search`).
    2. `Diagnostics: ARP Table` (`page-diagnostics-arptable`) maps strictly to `snake_case` `api/diagnostics/interface/get_arp*` and `api/diagnostics/interface/search_arp*` — camelCase `getArp` would fail with `403` for a non-root user.
    3. In `System → Access → Users`, the non-interactive Login Shell option is labeled **`Default (none for all but root)`**, and API keys are generated from the **ticket icon** on the user row / **API Keys** tab.
    4. `Firewall: Aliases` (`page-firewall-aliases`) unlocks `/api/firewall/alias/*`, whereas `/api/firewall/alias_util/*` requires `Diagnostics: PF Table IP addresses` (`page-diagnostics-table`).
  - *Finding 3 (Elasticsearch `9.4.3` + `pfSense 1.25.4` Data Stream):*
    1. All OPNsense logs ship into `logs-pfsense.log*` (`.ds-logs-pfsense.log-default-2026.10.25-000001`), allowing a single permanent read-only API key scoped directly to `logs-pfsense.log*`.
    2. Unbound DNS queries (`3.02M+` docs) and filterlog packet records (`3.63M+` docs) are already parsed into ECS fields (`dns.question.name`, `dns.question.registered_domain`, `network.bytes`, `destination.as.organization.name`).
  - *Finding 4 (Local Windows Dev Environment Tooling & Docker Desktop Path):*
    1. Neither Python nor Node.js were on the global system `PATH`; we provisioned portable CPython `3.12.15` and Node.js `v22.14.0` inside `.uv/` (git-ignored and docker-ignored).
    2. Docker Desktop (`v29.9.2`, Compose `v5.6.1`) is installed in the per-user directory `Docker Desktop (`docker.exe`)` (rather than `C:\Program Files\Docker`) and should be prepended to `$env:PATH` in tool sessions.
    3. `coverage.py`'s legacy C-tracer (`ctrace`) deadlocks with `aiosqlite` worker threads on Windows Python 3.12; setting `core = "sysmon"` (PEP 669) in `backend/pyproject.toml` resolved it permanently (`BUG-P1-001`).
- **How we will apply these learnings to Phase 2:**
  2. Implement both `alias_util` (`add`/`delete`) and `/api/firewall/alias/*` (`set_item` + `reconfigure`) fallback in `OPNsenseClient` so device blocking works reliably under your current `svc_gateway_ui` privileges.

---

## Phase 2 Exit Report (`2026-10-31`)

### 1. Quality Gate Summary
- **Backend Unit Tests (`pytest`):** `72 / 72 passed` in `1.72s` — **89.0% total statement coverage** (exceeds `>= 85%` gate; `100%` on `models`, `95%` on `clients/opnsense.py`, `86%` on `services/device_service.py`).
- **Backend Static Analysis (`ruff` + `mypy`):** `0 errors` across all 16 source files and 8 test suites.
- **Frontend Unit Tests (`Vitest`):** `7 / 7 passed` in `3.56s` — **96.59% line/statement coverage**, **87.15% branch coverage**, **90.16% function coverage**.
- **Frontend Production Build (`tsc -b && vite build`):** Succeeded in `1.57s` with `0 errors`.
- **Full-Stack Live Smoke & Manual UI Verification (`http://localhost:8080`):**
  - Reconciled **`69` total network devices** (`57` online in ARP, `0` literal `"*"` hostnames remaining, `192.168.1.1` automatically locked as Protected).
  - Verified live single-click **Block** and **Allow (Unblock)** end-to-end against `https://opnsense.example.local` (`OPNsense 26.7.7-amd64`).
- **Bugs Resolved in Phase 2:** `4` (`BUG-P2-001` through `BUG-P2-004` in [docs/development/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `1` enrichment update waterfalled into Phase 3 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments to Future Phases (`PLAN.md`)
1. **Waterfalled into Phase 3 (Elasticsearch `9.4.3` Analytics):**
   - **Update 3B — SQLite `Device` Metadata Enrichment for Elasticsearch IP Buckets:** Since Phase 2 stores `69` discovered devices in SQLite with `effective_name` (`display_name` → `hostname` → `ipv4_address` → `mac_address`), `vendor`, `is_online`, and `is_blocked`, Phase 3's Network Overview (`/api/v1/analytics/overview`) will join Elasticsearch `source.ip`/`client.ip` aggregations with the SQLite `devices` table so charts and tables display user-friendly device names alongside IPs.
   - **Phase 3 Complexity Impact:** Remains **3.5 / 5 (Medium–High)**.

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 3
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (OPNsense `26.7.7-amd64` `Core/ACL/ACL.xml` Granular Privilege Split — `BUG-P2-004`):*
    - In OPNsense `26.7`, the **`Firewall: Aliases`** (`page-firewall-aliases`) privilege only unlocks **read-only** API routes (`api/firewall/alias/get*`, `list*`, `search*`, `export`) and returns `HTTP 403` on `api/firewall/alias/set_item/*` and `api/firewall/alias/reconfigure`.
    - Mutating aliases requires enabling **`Firewall: Alias: Edit`** (`page-firewall-alias-edit` → `api/firewall/alias/*`) and **`Diagnostics: PF Table IP addresses`** (`page-diagnostics-tables` → `api/firewall/alias_util/*`). Both were added to the OPNsense service user/group and documented in [docs/API_KEYS_SETUP.md](API_KEYS_SETUP.md) and [PLAN.md](../PLAN.md).
  - *Finding 2 (OPNsense `alias/get_item` Option-Dict Structure vs. `alias/set_item` Flat Strings):*
    - `GET /api/firewall/alias/get_item/{uuid}` returns option fields (`type`, `proto`, `interface`, `authtype`, `content`) as dictionaries of `{key: {"value": ..., "selected": 0|1}}`, whereas `POST /api/firewall/alias/set_item/{uuid}` requires flattened strings (`"type": "host"`, `"content": "ip1\nip2"`). `_mutate_alias_ips_via_config_api()` in `OPNsenseClient` flattens those fields automatically.
  - *Finding 3 (Python 3.12 `sys.monitoring` + SQLAlchemy `greenlet` Tracing — `BUG-P2-002`):*
    - When `coverage.py` uses `core = "sysmon"` on Python 3.12, `greenlet` C-stack switches inside `await db.execute(...)` cause `sys.monitoring` to stop emitting `LINE` events for the remainder of that coroutine frame. Placing post-query synchronous business logic in dedicated helper functions ensures fresh stack frames that `sys.monitoring` traces at 100%.
- **How we will apply these learnings to Phase 3:**
  1. Structure Phase 3's `backend/app/services/analytics_service.py` with clean synchronous query-builder and response-normalizer helper functions around async Elasticsearch calls so unit tests stay fast, deterministic, and 100% traced by `sys.monitoring`.

---

## Phase 3 Exit Report (`2026-10-31`)

### 1. Quality Gate Summary
- **Backend Unit Tests (`pytest`):** `79 / 79 passed` in `2.17s` — **95.0% total statement coverage** (exceeds `>= 85%` gate; `100%` on `services/analytics_service.py` and `api/analytics.py`, `97%` on `clients/elasticsearch.py`).
- **Backend Static Analysis (`ruff` + `mypy`):** `0 errors` across all 18 source files and 10 test suites.
- **Frontend Unit Tests (`Vitest`):** `10 / 10 passed` in `3.79s` — **95.71% line/statement coverage**, **85.94% branch coverage**, **91.91% function coverage**.
- **Frontend Production Build (`tsc -b && vite build`):** Succeeded in `1.54s` with `0 errors`.
- **Full-Stack Live Smoke & Manual UI Verification (`http://localhost:8080`):**
  - Network Overview (`/api/v1/analytics/overview?window=24h`) aggregated **`967,295` total events**, **`65.3 MB` firewall traffic**, and **`428,506` Unbound DNS queries**, automatically enriching top RFC1918 LAN IPs with SQLite `Device` metadata (`Chrispy`, `ProxmoxVM`, `elastic-node-02`, `elastic-node-03`).
  - Per-Device Analytics (`/api/v1/devices/{id}/analytics`) verified live with Usage Timeline, 24-Hour Access Time Profile (`00:00`–`23:00` local timezone), Top Visited Domains, Top Destination ASN Organizations, and Chronological Recent DNS Query search.
- **Bugs Resolved in Phase 3:** `1` (`BUG-P3-001` in [docs/development/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `1` multi-IP group aggregation enhancement waterfalled into Phase 4 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments to Future Phases (`PLAN.md`)
1. **Waterfalled into Phase 4 (Device Groups / Profiles & Bulk Access Control):**
   - **Update 4A — Multi-IP Group Analytics & Per-Member Contribution Breakdown:** Phase 4's Group Analytics (`/api/v1/groups/{group_id}/analytics`) will reuse Phase 3's `filterlog` + `unbound` aggregation pipeline using multi-IP `terms` filters (`source.ip`, `destination.ip`, `client.ip`) and add a `by_member_ip` `terms` sub-aggregation so Group Analytics displays both combined profile telemetry and each member device's individual share of bytes and DNS queries.
   - **Phase 4 Complexity Impact:** Remains **3 / 5 (Medium)**.

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 4
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (OPNsense `filterlog` WAN SNAT & IPv6 Link-Local Source IPs in `logs-pfsense.log*`):*
    - In OPNsense `filterlog`, outbound WAN packets logged after SNAT carry the router's public WAN IP (`50.39.173.134`) as `source.ip`, and IPv6 neighbor discovery events carry `fe80::*` / `fd8a::*`.
    - Because `source.ip` is mapped as a native Elasticsearch `ip` field type, filtering the `top_devices` aggregation with `{"terms": {"source.ip": ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]}}` cleanly isolates RFC1918 LAN devices in a single query clause without post-filtering noise.
  - *Finding 2 (Combining `filterlog` + `unbound` for Complete Per-Device Activity Timelines):*
    - Because OPNsense's default LAN allow rule does not log every permitted TCP packet unless explicitly enabled, some LAN clients generate far more `unbound` DNS query events than `filterlog` packet logs. Aggregating both `filterlog` (`source.ip` / `destination.ip`) and `unbound` (`source.ip` / `client.ip`) per device ensures the Usage Timeline and 24-Hour Access Profile accurately reflect online hours for all devices.
  - *Finding 3 (Script-Free 24-Hour Access Time Profile via Hourly `date_histogram` + Python Bucketing):*
    - Instead of running an Elasticsearch Painless script (`doc['@timestamp'].value.hour`) across millions of documents, requesting a `1h` `date_histogram` with `time_zone` set to the configured `TZ` and folding `key_as_string` into 24 hour-of-day buckets (`00:00`..`23:00`) in Python (`_compute_24h_access_profile()`) is faster, avoids cluster script execution limits, and respects DST/timezone offsets automatically.
  - *Finding 4 (TanStack Query Input Focus Preservation on Key Changes — `BUG-P3-001`):*
    - When a search input or window selector updates a `useQuery` key, setting `placeholderData: (previousData) => previousData` prevents the component tree from unmounting into a skeleton loader while the new query resolves.
- **How we will apply these learnings to Phase 4:**
  1. Reuse `_compute_24h_access_profile()` and the combined `filterlog` + `unbound` query structure for Group-Level Analytics (`/api/v1/groups/{group_id}/analytics`).
  2. Use `placeholderData: (previousData) => previousData` in all Phase 4 Group Analytics and Group filter hooks in React.


---

## Phase 4 Exit Report (`2026-10-31`)

### 1. Quality Gate Summary
- **Backend Unit Tests (`pytest`):** `87 / 87 passed` in `3.01s` — **96.0% total statement coverage** (exceeds `>= 85%` gate; `100%` on `api/groups.py` and `models`, `96%` on `services/group_service.py` and `clients/elasticsearch.py`).
- **Backend Static Analysis (`ruff` + `mypy`):** `0 errors` across all 20 source files and 12 test suites.
- **Frontend Unit Tests (`Vitest`):** `12 / 12 passed` in `3.92s` — **94.06% line/statement coverage**, **84.22% branch coverage**, **89.70% function coverage**.
- **Frontend Production Build (`tsc -b && vite build`):** Succeeded in `1.59s` with `0 errors`.
- **Full-Stack Live Smoke & Manual UI Verification (`http://localhost:8080`):**
  - Verified live Group creation, member assignment, one-click Group Block/Unblock against `https://opnsense.example.local`, and multi-IP Group Analytics (`108,822` events / `37.65 MB` / `32,692` DNS queries with per-member contribution breakdown) against `https://elasticsearch.example.local:9200`.
  - User confirmed manual verification: *"Buttons are working; Block / Unblock works, including with created groups"*, and provided 11 structured UI & feature feedback items logged in [docs/development/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md).
- **Bugs Resolved in Phase 4:** `1` (`BUG-P4-001` in [docs/development/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `11` user UI/feature feedback items logged in [docs/development/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md) and waterfalled into Phases 5–7 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments & Feature Backlog Integration (`PLAN.md` & `docs/development/FEATURE_BACKLOG.md`)
1. **Established `docs/development/FEATURE_BACKLOG.md` as a Mandatory Phase-Gate Artifact:**
   - All 11 Phase 4 user feedback items (`FB-P4-001` through `FB-P4-011`) are tracked with complexity ratings, code references, and architectural evaluations in [docs/development/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md), and reviewed at the start and end of every phase.
2. **Waterfalled into Phase 5 (Update 5A — Quick-Win UI Polish, Versioning, Stacked Timeline Chart & Status Page Cleanup):**
   - **`FB-P4-001`:** Remove `SYSTEM:` prefix from the header health badge (`HEALTHY`, `DEGRADED`, `DOWN` / `UNHEALTHY`).
   - **`FB-P4-002`:** Increment application version (`backend/app/__init__.py`, `backend/pyproject.toml`, `frontend/package.json`) with each phase push to match GitHub (`v0.4.0` → `v0.5.0` → `v0.6.0` → `v1.0.0`).
   - **`FB-P4-003`:** Change Telemetry column button label in `DevicesPage.tsx` from `Usage & Domains` to `Analytics`.
   - **`FB-P4-004`:** Remove `— Click to Block` / `— Click to Allow` from Internet Access column button in `DevicesPage.tsx` and display only the current state (`Blocked` / `Allowed`).
   - **`FB-P4-005`:** Remove ``(`dns.question.name`)`` from `Top Visited Domains` heading in `DeviceAnalyticsDrawer.tsx`.
   - **`FB-P4-006`:** Upgrade `Usage & Activity Timeline` bar chart in `DeviceAnalyticsDrawer.tsx` and `GroupAnalyticsDrawer.tsx` to a **Stacked Bar Graph** showing distinct colors for **DNS Queries** and **Firewall Events**, with a color key legend in the chart header and detailed DNS vs. Firewall event breakdown in the hover tooltip.
   - **`FB-P4-010`:** Remove ``(`logs-pfsense.log*`)`` from the `Traffic & DNS Analytics` page title and change `Inspect Device` button label to `Inspect`.
   - **`FB-P4-011`:** Replace or remove the stale Phase 1 `Network Device Inventory & Internet Access Control` placeholder box at the bottom of `StatusPage.tsx` (since the full table was implemented in Phase 2 as the dedicated `Devices & Access Control` tab).
   - **Phase 5 Complexity Impact:** Remains **3.5 / 5 (Medium–High)**.
3. **Evaluated for Phase 6 / Phase 7 (`FB-P4-007`, `FB-P4-008`, `FB-P4-009` — Per-Device Domain & ASN Organization Blocking):**
   - Documented technical architecture options in [docs/development/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md) for per-device domain (`type: "host"`) and ASN (`type: "asn"` + `destination.as.number` ES sub-aggregation) blocking via OPNsense aliases and per-device firewall rules, plus the **Blocked Domains & ASN Organizations** management panel in the Analytics Drawer.

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 5
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (SQLite Foreign Key Cascade Enforcement Requires Explicit Connection Pragma):*
    - SQLite parses `ON DELETE CASCADE` in `CREATE TABLE` DDL (`device_group_memberships`), but does **not** enforce foreign key cascades unless `PRAGMA foreign_keys=ON` is executed on each SQLite connection. Registering an SQLAlchemy `@event.listens_for(engine.sync_engine, "connect")` hook in `backend/app/db/__init__.py` guarantees cascade deletes work reliably when deleting a `DeviceGroup` or `Device`.
  - *Finding 2 (In-Memory ORM Column Defaults Before SQLite Flush — `BUG-P4-001`):*
    - SQLAlchemy `mapped_column(..., default=...)` populates defaults on `flush()`/`commit()`, so pure unit tests constructing transient `Device(...)` objects in memory had `lease_type=None`. Defensive coalescing (`device.lease_type or "unknown"`) in response builders keeps pure unit tests fast and database-free.
  - *Finding 3 (Multi-IP Group Aggregation Attribution for Shared Local Traffic):*
    - When querying `logs-pfsense.log*` across multiple group member IPs, using a `terms` aggregation on `source.ip` (`by_member_ip` for `filterlog` and `by_member_dns` for `unbound`) cleanly attributes each member's outbound traffic and DNS query share in a single round-trip query.
- **How we will apply these learnings to Phase 5:**
  1. Leverage `PRAGMA foreign_keys=ON` for Phase 5's `temporary_overrides` table (`device_id` and `group_id` foreign keys with `ON DELETE CASCADE`) so deleting a group automatically cleans up its timers.
  2. Begin Phase 5 by reviewing [docs/development/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md) and executing the scheduled Phase 4 UI & chart enhancements alongside the Temporary Pause / Bonus Access timer engine.

---

## Phase 5 Exit Analysis & Unplanned-Information Retrospective (`2026-11-01`)

### 1. Phase 5 Execution Summary & Verification Metrics
- **Branch:** `phase5` (merged to `main` as `v0.5.0`)
- **Automated Test Gate Results:**
  - **Backend (`pytest` + `coverage` + `ruff` + `mypy`):** **100 passed** in `5.04s`, **88% total coverage** (`100%` on `api/timers.py` and `models/__init__.py`, `85%` on `services/timer_service.py`), `0` `ruff` warnings, `0` `mypy` type errors across 22 source files.
  - **Frontend (`vitest --coverage` + `tsc -b && vite build`):** **15 passed** across 5 test files (`App.test.tsx`, `DevicesPage.test.tsx`, `Analytics.test.tsx`, `Groups.test.tsx`, `Timers.test.tsx`), **93.57% statement/line coverage** (`97.32%` on `TimerPopoverMenu.tsx`, `99.2%` on `StatusPage.tsx`, `96.49%` on `DeviceAnalyticsDrawer.tsx`), `0` TypeScript/Vite build errors.
  - **Live Container & User UI Verification (`http://localhost:8080`):**
    - Confirmed header displays `v0.5.0` and `HEALTHY` (without `SYSTEM:`).
    - Confirmed `Traffic & DNS Analytics` title/button updates (`FB-P4-010`) and new live enforcement summary panel on `System Connectivity` (`FB-P4-011`).
    - Confirmed `Analytics` button label (`FB-P4-003`), simplified `Blocked` / `Allowed` state labels (`FB-P4-004`), `Top Visited Domains` label (`FB-P4-005`), and the new **Stacked Bar Graph** (`FB-P4-006`) with DNS Queries vs. Firewall Events color legend and hover breakdown.
    - Confirmed Pause & Bonus timers, live countdown pills, and timer cancellation on live devices and groups.

---

### 2. Waterfall Impact & Plan Adjustments for Subsequent Phases (`PLAN.md` & `docs/development/FEATURE_BACKLOG.md`)
1. **Zero Deferred Bugs from Phase 5:**
   - All 3 defects discovered during Phase 5 (`BUG-P5-001`, `BUG-P5-002`, and `BUG-P5-003`) were resolved and verified with regression tests before Phase 5 check-in.
2. **User Phase 5 UI & Persistence Feedback Logged in `docs/development/FEATURE_BACKLOG.md` & Scheduled for Phase 6 (`FB-P5-001` – `FB-P5-010`):**
   - **`FB-P5-001` (Centered Modal Dialog for Timer Controls):** Convert the Timer popover into a centered screen modal dialog (`fixed inset-0 z-50`) so it never requires scrolling near the bottom of the viewport and prevents multiple timer menus from opening simultaneously.
   - **`FB-P5-002` (Active Countdown & Mode Color on Timer Button):** Merge the active countdown directly into the `Timer` button (`Paused · Xm left` in amber, `Bonus · Xm left` in emerald) instead of rendering a separate pill.
   - **`FB-P5-003` (Duration-Only Preset Button Labels):** Show only duration values (`15m`, `30m`, `1h`, `2h`, `Until 07:00`) inside the modal preset buttons without repeating `Pause` or `Bonus`.
   - **`FB-P5-004` (Bonus Access Presets `20m`, `40m`, `60m`):** Change Bonus Access default preset buttons to `20m`, `40m`, and `60m` (and add `"20m": 20`, `"40m": 40`, `"60m": 60` to `PRESET_MINUTES`).
   - **`FB-P5-005` (Timer Button Height Alignment):** Match the `Timer` button height (`px-2.5 py-1.5 text-xs`) to the adjacent buttons on the Device Groups & Profiles cards.
   - **`FB-P5-006` (Header `Logout` Label):** Change the header `Sign Out` button text to `Logout`.
   - **`FB-P5-007` (Stable Group Card Filter Button Layout):** Keep `Filter` button text and dimensions constant when toggled so clicking `Filter` only highlights the button without shifting or stacking buttons on the card.
   - **`FB-P5-008` (Remove `(gateway_blocked_devices)` from Devices Header):** Remove ``(`gateway_blocked_devices`)`` from the `Devices & Access Control` page subtitle.
   - **`FB-P5-009` (24-Hour `Synced:` Clock Under `Sync from OPNsense` Button):** Format `Synced: HH:MM:SS` in 24-hour time (`hour12: false`) on a single line directly below the `Sync from OPNsense` button.
   - **`FB-P5-010` (Persistent SQLite Volume Path Across Container Resets/Rebuilds):** Wire `SQLITE_DB_PATH` (`/app/data/gateway.db`) into `Settings.database_url` (`sqlite+aiosqlite:////app/data/gateway.db`) so the container writes to the host-mounted `../data:/app/data` volume rather than `/app/backend/data/gateway.db`.

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 6
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (WSL2 / Hyper-V Sub-Second Clock Jitter vs. `PyJWT` `iat` Validation — `BUG-P5-003`):*
    - On Windows Docker Desktop (WSL2), Hyper-V NTP clock synchronization can nudge the Linux VM clock backwards by `< 1s` between consecutive HTTP requests. Because `PyJWT >= 2.6.0` validates `iat` (`verify_iat=True`) with `leeway=0` by default, a request arriving immediately after `/api/v1/auth/login` could fail with `jwt.ImmatureSignatureError` (`InvalidTokenError`). Adding `leeway=10` to `jwt.decode()` eliminates false `401` rejections from sub-second clock jitter.
  - *Finding 2 (SQLAlchemy ORM Attribute Expiration After `await db.rollback()` — `BUG-P5-001`):*
    - Calling `await db.rollback()` inside an exception handler expires all ORM attributes on loaded instances (`ov`). Accessing `ov.id` in the `except` block to log an error message triggers a synchronous lazy reload outside `greenlet_spawn` (`MissingGreenlet`). Capturing primitive IDs (`ov_id = ov.id`) before the `try` block avoids post-rollback lazy loads.
  - *Finding 3 (`WORKDIR /app/backend` vs. Relative `./data/gateway.db` Volume Mount — `FB-P5-010`):*
    - In `docker/Dockerfile`, `WORKDIR` is `/app/backend`, while `docker/docker-compose.yml` mounts `../data:/app/data` and sets `SQLITE_DB_PATH=/app/data/gateway.db`. Because `Settings.database_url` defaulted to `sqlite+aiosqlite:///./data/gateway.db` without reading `SQLITE_DB_PATH`, SQLite created `/app/backend/data/gateway.db` inside the ephemeral container layer instead of `/app/data/gateway.db` on the host volume.
- **How we will apply these learnings to Phase 6:**
  1. Fix `Settings.database_url` in Phase 6 Step 6.1 to honor `SQLITE_DB_PATH=/app/data/gateway.db` so all groups, nicknames, active timers, and recurring schedules persist across container rebuilds and restarts (`FB-P5-010`).
  2. Capture primitive IDs prior to `try / except` blocks in `ScheduleService`'s background reconciliation loop.
  3. Implement all 10 Phase 5 UI & Persistence feedback items (`FB-P5-001` through `FB-P5-010`) alongside Phase 6's Recurring Schedules & Bedtime Rules engine.

---

## Phase 6 (Test Cycle 6) Exit Analysis: Control Feature #4 — Recurring Schedules & Bedtime Rules + Phase 5 UI Backlog Batch

### 1. Phase 6 Execution Summary & Verification Metrics
- **Branch:** `phase6` (merged to `main` as `v0.6.0`)
- **Automated Test Gate Results:**
  - **Backend (`pytest` + `coverage` + `ruff` + `mypy`):** **107 passed** in `10.89s`, **88% total coverage** (`97%` on `api/schedules.py`, `88%` on `services/schedule_service.py`, `99%` on `models/__init__.py` and `config.py`), `0` `ruff` warnings, `0` `mypy` type errors across 24 source files.
  - **Frontend (`vitest --coverage` + `tsc -b && vite build`):** **17 passed** across 6 test files (`App.test.tsx`, `DevicesPage.test.tsx`, `Analytics.test.tsx`, `Groups.test.tsx`, `Timers.test.tsx`, `Schedules.test.tsx`), **92.03% statement/line coverage** (`98.75%` on `AppLayout.tsx`, `94.77%` on `TimerPopoverMenu.tsx`, `94.01%` on `DevicesPage.tsx`, `89.66%` on `ScheduleFormModal.tsx`), `0` TypeScript/Vite build errors.
  - **Live Container & User UI Verification (`http://localhost:8080`):**
    - Confirmed header displays `v0.6.0`, `Logout` (`FB-P5-006`), and the new **`Schedules & Bedtime`** navigation tab.
    - Confirmed `Devices & Access Control` header description cleanup (`FB-P5-008`), 24-hour `Synced: HH:MM:SS` clock beneath `Sync from OPNsense` (`FB-P5-009`), aligned `Timer` button height (`FB-P5-005`), and fixed-width Group `Filter` button (`FB-P5-007`).
    - Confirmed centered screen modal for Timer controls (`FB-P5-001`), unified active countdown & color inside the `Timer` button (`FB-P5-002`), duration-only preset labels (`FB-P5-003`), and `20m`/`40m`/`60m` Bonus Access presets (`FB-P5-004`).
    - Confirmed `Schedules & Bedtime` tab (`SchedulesPage.tsx` & `ScheduleFormModal.tsx`) and host SQLite persistence at `<repo-root>\data\gateway.db` (`FB-P5-010`).

---

### 2. Waterfall Impact & Plan Adjustments for Phase 7 (`PLAN.md` & `docs/development/FEATURE_BACKLOG.md`)
1. **Zero Deferred Bugs from Phase 6:**
   - Both defects discovered during Phase 6 (`BUG-P6-001` and `BUG-P6-002`) were resolved and verified with regression tests before Phase 6 check-in.
2. **User Phase 6 Feedback & Feature Requests Logged in `docs/development/FEATURE_BACKLOG.md` & Scheduled for Phase 7 (`FB-P6-001` – `FB-P6-005`):**
   - **`FB-P6-001` (Schedule Modal Single-Device Search Field):** Add a search input above the Target Device selector when creating a single-device schedule in `ScheduleFormModal.tsx`.
   - **`FB-P6-002` (Per-Second System Clock Below `Logout` Button):** Display a live 1-second updating system clock directly below the `Logout` button in `AppLayout.tsx`.
   - **`FB-P6-003` (`Local SQLite Store` Storage Size & Record Count Stats):** Add on-disk storage size (`KB`/`MB`) and total/per-table record count metrics to `/api/v1/system/health` (`sqlite.details`) and `StatusPage.tsx`.
   - **`FB-P6-004` (Application Usage Stats — Active Usage Time Tracking for YouTube & Plex):** Aggregate 5-minute active session intervals, query/packet counts, and bandwidth for **YouTube** (`youtube.com`, `googlevideo.com`, `ytimg.com`, `youtu.be`) and **Plex** (`plex.tv`, `plex.direct`, `:32400`) from `logs-pfsense.log*`, and display active usage duration in `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`, and `AnalyticsPage.tsx`.
   - **`FB-P6-005` (Selective Application Blocking — Block YouTube While Allowing Plex & Everything Else):** Implement per-device and per-group YouTube blocking (`is_youtube_blocked` on `Device` + OPNsense `gateway_youtube_blocked_devices` / `gateway_youtube_domains` aliases) with one-click UI toggles so YouTube can be blocked while Plex and general internet access remain allowed.

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 7
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (Distinguishing Manual Permanent Blocks from Temporary Timer / Schedule Blocks — `BUG-P6-001`):*
    - When `TimerService.start_device_override` delegated a `pause` timer to `block_device_internet(..., actor="admin")`, `block_device_internet` treated any `actor` not starting with `"timer"` or `"schedule"` as a manual permanent block (`dev.is_manually_blocked = True`). Consequently, when the pause timer expired and `reconcile_schedules_and_policies()` evaluated the 5-tier policy, Tier 3 (`Manual Permanent Block`) re-blocked the device! Prefixing `actor=f"timer ({actor})"` inside `timer_service.py` cleanly separates temporary timer blocks from permanent manual blocks.
  - *Finding 2 (Selective Application Blocking for YouTube vs. Plex on OPNsense `26.7.7` — `FB-P6-005`):*
    - Blocking YouTube without impacting Plex or general Google services cannot rely on blocking all of Google's ASN (`AS15169`). Instead, maintaining a dedicated source IP alias (`gateway_youtube_blocked_devices`) paired with a YouTube FQDN/host alias (`gateway_youtube_domains`) on OPNsense allows selective per-device/per-group YouTube blocking while leaving Plex (`plex.tv`, `plex.direct`, `:32400`) and all other traffic untouched.
- **How we will apply these learnings to Phase 7:**
  1. Keep `is_youtube_blocked` independent of `is_blocked` and `is_manually_blocked` so full-internet schedules/timers and selective YouTube app blocks never overwrite each other.
  2. Deliver all 5 Phase 6 feedback items (`FB-P6-001` through `FB-P6-005`) alongside Phase 7's Audit Log & Settings Backup (`v1.0.0`).

---

## Phase 7 Exit Report: Audit Log UI, Settings Backup, Selective Application Blocking (YouTube vs. Plex), Application Usage Telemetry & `v1.0.0` Production Hardening

- **Phase Status:** `COMPLETE` (`v1.0.0` — Final Release)
- **Completed Date:** `2026-11-02`
- **Git Branch / Tag:** `phase7` merged (`--no-ff`) into `main`, tagged `v1.0.0`

### 1. Test & Coverage Metrics (`v1.0.0`)
- **Backend (`Python 3.12.15`, `pytest`, `ruff`, `mypy`):**
  - **Unit Tests:** `112 passed` (`100%` pass rate across 18 test suites)
  - **Code Coverage:** `86%` total statement coverage (`3,338` statements, exceeding the `>= 85%` gate)
  - **Static Analysis:** `ruff check backend` (`0` errors) and `mypy backend/app` (`0` issues in 25 source files)
- **Frontend (`Node 22`, `Vitest`, `TypeScript`, `Vite`):**
  - **Unit Tests:** `23 passed` across 7 test suites (`100%` pass rate)
  - **Code Coverage:** `91.28%` statement/line coverage (`83.1%` branch coverage, exceeding the `>= 85%` gate)
  - **Production Bundle:** `tsc -b && vite build` (`0` errors)

### 2. Delivered Phase 7 Scope & Phase 6 Backlog Batch (`FB-P6-001` – `FB-P6-005`)
1. **`FB-P6-001` (`ScheduleFormModal.tsx`):** Added real-time single-device search input (`data-testid="schedule-device-search"`) above the Target Device selector when creating a recurring schedule for a single device.
2. **`FB-P6-002` (`AppLayout.tsx`):** Added live 24-hour system clock (`HH:MM:SS` monospace, `data-testid="header-system-clock"`) directly below the `Logout` button in the top-right header, updating every 1 second.
3. **`FB-P6-003` (`system.py`, `StatusPage.tsx`):** Added on-disk SQLite **Storage Size** (`storage_bytes`, `storage_size_formatted`) and **Record Count** telemetry (`total_records` + per-table breakdown for `devices`, `groups`, `timers`, `schedules`, `audit_logs`) on the `Local SQLite Store` service card.
4. **`FB-P6-004` (`elasticsearch.py`, `analytics_service.py`, `AnalyticsPage.tsx`, `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`):** Added **Application Usage Stats (YouTube & Plex)** computing active usage duration (`active_minutes` from 5-minute activity buckets), DNS query counts, bandwidth, and `last_active_at` across network overview, device analytics, and group analytics.
5. **`FB-P6-005` (`opnsense.py`, `device_service.py`, `group_service.py`, `DevicesPage.tsx`, `docs/API_KEYS_SETUP.md`):** Added **Selective Application Blocking for YouTube** (`Device.is_youtube_blocked`, `GroupResponse.youtube_status`, `POST /api/v1/devices/{id}/youtube/{block,unblock}`, `POST /api/v1/groups/{id}/youtube/{block,unblock}`), automatically provisioning and managing `gateway_youtube_blocked_devices` and `gateway_youtube_domains` on OPNsense `26.7.7-amd64` while keeping Plex and general internet access allowed. Documented the one-time OPNsense LAN Reject rule in [`docs/API_KEYS_SETUP.md` Step 1D](API_KEYS_SETUP.md#step-1d-enable-selective-youtube-blocking-on-opnsense-fb-p6-005--keep-plex--general-internet-allowed).
6. **Core Phase 7 Deliverables:**
   - Filterable & searchable **Audit & Event History** (`GET /api/v1/audit-logs`) with automatic 90-day retention pruning.
   - **Configuration Backup & Restore** (`GET /api/v1/system/backup` & `POST /api/v1/system/restore`) exporting and restoring device nicknames/protection/YouTube blocks, groups, and schedules as portable JSON without exposing `.env` secrets.
   - Security response headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`), comprehensive [`README.md`](../README.md) runbook, and semantic version bump to `v1.0.0`.

### 3. Unplanned Information Audit & Final Project Retrospective
- **What unplanned technical details surfaced during Phase 7?**
  1. *OPNsense `filterdns` Domain Alias Pair (`gateway_youtube_blocked_devices` + `gateway_youtube_domains`):*
     - While the backend automatically creates and updates both `gateway_youtube_blocked_devices` (host IPs) and `gateway_youtube_domains` (YouTube FQDNs) via `/api/firewall/alias/*` and `/api/firewall/alias_util/*`, OPNsense requires a one-time LAN `Reject` firewall rule (`Source: gateway_youtube_blocked_devices` → `Destination: gateway_youtube_domains`, `Protocol: any` to cover both TCP `80/443` and UDP `443` QUIC) above the general LAN pass rule. We documented this step-by-step in [`docs/API_KEYS_SETUP.md` Step 1D](API_KEYS_SETUP.md#step-1d-enable-selective-youtube-blocking-on-opnsense-fb-p6-005--keep-plex--general-internet-allowed).
  2. *Browser vs. `jsdom` File Upload API (`BUG-P7-002`):*
     - `StatusPage.tsx`'s JSON configuration restore handler initially called `await file.text()`, which is standard in modern browsers but unimplemented on `jsdom`'s `File` prototype during `Vitest` runs. Adding a `FileReader.readAsText(file)` fallback ensured identical behavior across both headless test runners and production browsers.


---

## Phase 8 Exit Report: Telemetry Accuracy Fixes, Bar Chart `Stacked`/`Total` Selector & X/Y Axes, Elasticsearch Cluster/Shard Health & Global UI Polish (`v1.0.2`)

- **Phase Status:** `COMPLETE` (`v1.0.2` — First Phase of the `v1.1` Release Cycle)
- **Completed Date:** `2026-11-03`
- **Git Branch / Tag:** `phase8` merged (`--no-ff`) into `main`, tagged `v1.0.2`

### 1. Test & Coverage Metrics (`v1.0.2`)
- **Backend (`Python 3.12.15`, `pytest`, `ruff`, `mypy`):**
  - **Unit Tests:** `113 passed` (`100%` pass rate across 18 test suites)
  - **Code Coverage:** `86%` total statement coverage (exceeding the `>= 85%` gate)
  - **Static Analysis:** `ruff check backend` (`0` errors) and `mypy backend/app` (`0` issues in 26 source files)
- **Frontend (`Node 22`, `Vitest`, `TypeScript`, `Vite`):**
  - **Unit Tests:** `24 passed` across 7 test suites (`100%` pass rate)
  - **Code Coverage:** `91.16%` statement/line coverage (`83.02%` branch coverage, exceeding the `>= 85%` gate)
  - **Production Bundle:** `tsc -b && vite build` (`0` errors)

### 2. Delivered Phase 8 Scope (`FB-P8-001` – `FB-P8-007`)
1. **`FB-P8-001` & `FB-P8-002` (`elasticsearch.py`, `analytics_service.py`, `AnalyticsPage.tsx`):**
   - Resolved the near-100% YouTube active-time inflation (`BUG-P8-001`) by excluding protected gateway IPs (`filterdns` on `.1`), excluding `event.action: "block"`, excluding passive thumbnail/background domains (`ytimg.com`, `youtubei.googleapis.com`), and aggregating 5-minute active windows **per LAN device (`source.ip`)** with `min_doc_count: 5`.
   - Added **Top 3 Devices (Active Time)** enriched with SQLite device names inside each Application Usage Stats card.
2. **`FB-P8-003` (`client.ts`, `AnalyticsPage.tsx`, `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`):**
   - Appended the blocked traffic percentage (`(XX.X%)`) directly after the packet count in the `Blocked Firewall Packets` KPI box across the network overview and device/group analytics drawers.
3. **`FB-P8-004` & `FB-P8-005` (`TelemetryBarChart.tsx`, `AnalyticsPage.tsx`, `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`):**
   - Created reusable `TimelineBarChart` and `HourlyProfileBarChart` components featuring a **`Stacked` | `Total`** mode selector, color legend, explicit **Y-Axis scale** (`Max`, `50%`, `0` + vertical `Events` label), **X-Axis tick labels** (timestamps/hours + horizontal axis title), and at-a-glance value labels on bars.
4. **`FB-P8-006` (`elasticsearch.py`, `StatusPage.tsx`, `docs/API_KEYS_SETUP.md`):**
   - Added `GET /_cluster/health` telemetry (`cluster_status`, `assigned_shards`, `unassigned_shards`, `relocating_shards`) to `ElasticsearchServiceClient.check_health()` and rendered Cluster Health (`GREEN` / `YELLOW` / `RED`) and Shard Counts on the `Elasticsearch 9.4.3` service card, plus documented `cluster: ["monitor"]` in `docs/API_KEYS_SETUP.md`.
5. **`FB-P8-007` (Global UI & Backend):**
   - Removed all EM dashes (`—`) across `frontend/src/` and `backend/app/` (shortening `"Application Usage Stats — YouTube & Plex (24h)"` to `"Application Usage Stats"`) and added a 24-hour `Updated: HH:MM:SS` timestamp directly below every `Refresh` button across all pages and drawers.

### 3. Waterfall Impact & Adjustments for Phase 9 (`v1.0.3`)
1. **Waterfalled Bug Fix (`BUG-P8-003` / `FB-P8-008` — Plex Local LAN Client Streaming Detection):**
   - During Gate 2 live UI validation (`docs/development/Validation/PHASE8-Verify.md`), YouTube usage and Top-3 devices reported accurately, but Plex missed local LAN streaming from `LGwebOSTV` (`.243`) and LAN streaming clients (`.66`, `.70`).
   - Live Elasticsearch inspection showed that intra-VLAN traffic on port `32400` switches at Layer 2 without traversing OPNsense's `filterlog`, and removing `plex.direct` / `plex.tv` playback domains (`analytics.plex.tv`, `discover.provider.plex.tv`, `luma.plex.tv`, `images.plex.tv`, `watch.plex.tv`, `scrobbles.plex.tv`) in `CP-8.1` filtered out LAN client playback DNS telemetry.
   - Scheduled as **`FB-P8-008` in Step 9.1 of Phase 9 (`v1.0.3`)**: restore `plex.direct`, `plex.tv`, and `*plex*` client playback domains in `_build_app_usage_agg()`, use a sub-aggregation on `servers.plex.tv` (which only Plex Media Server hosts query) + 24/7 poller heuristics (`>= 140` slots with zero playback/scrobble domains) to separate servers/pollers from LAN clients, and lower the per-client Plex DNS slot threshold to `min_doc_count: 1`.
2. **Process Governance Enhancement (`AGENTS.md` & `docs/development/Validation/PHASEx-Verify.md`):**
   - Updated `AGENTS.md` so every Gate 2 (`Step X.4`) publishes a dedicated `docs/development/Validation/PHASEx-Verify.md` file with the full "What to Verify" checklist and a feedback section for user sign-off.

### 4. Unplanned Information Audit & Feed-Forward Learnings for Phase 9
- *Finding 1 (`elastic_transport.ObjectApiResponse` vs. `dict` — `BUG-P8-002`):*
  - `await client.cluster.health()` in the `elasticsearch` v9 Python client returns an `elastic_transport.ObjectApiResponse` (a `Mapping` supporting `.get()`), not a `dict` subclass. Using `hasattr(health_resp, "get")` ensures compatibility with both live `ObjectApiResponse` instances and unit test `dict` mocks.
- *Finding 2 (Layer-2 Intra-Subnet Plex Streaming vs. Unbound DNS Signatures — `BUG-P8-003`):*
  - Unlike YouTube (which always traverses the WAN gateway and queries public `googlevideo.com` CDN edges), a local Plex Media Server on the same `/24` LAN streams video directly over Layer 2 without generating OPNsense `filterlog` port-32400 packets. Therefore, LAN Plex client detection must rely on Unbound DNS queries for `*.plex.direct` and `*.plex.tv` playback domains while filtering out Plex Media Server hosts via `servers.plex.tv` registration queries.

---

## Phase 9 Exit Analysis & Unplanned-Information Retrospective (`v1.0.3` — 2026-11-04)

### 1. Phase 9 Deliverables & Quality Gate Summary
- **Deliverables Completed (`FB-P9-001` – `FB-P9-004`):**
  1. **`FB-P9-001` (NGINX-Style First-Boot `admin` Password Creation):** Added `GET /api/v1/auth/setup-status` and `POST /api/v1/auth/setup-admin`, automatic SQLite `admin` seeding when a real `ADMIN_PASSWORD` is present in `.env`, and the First-Boot Password Creation form on `LoginPage.tsx`.
  2. **`FB-P9-002` (UI Admin Panel for OPNsense & Elasticsearch Variables + Live Connectivity Test):** Added SQLite `system_settings` persistence with AEAD-encrypted secrets (`ENC:v1:...`), runtime override precedence over `.env` (`GET / PUT / DELETE /api/v1/system/settings`), and live connectivity diagnostic endpoints (`POST /api/v1/system/settings/test-opnsense`, `POST /api/v1/system/settings/test-elasticsearch`) that surface detailed troubleshooting hints in `StatusPage.tsx` and log failures to `audit_logs` (`DIAGNOSTIC_ERROR`).
  3. **`FB-P9-003` (Multi-User Management & Built-in `admin` Protection):** Added SQLite `users` table (`admin` vs. `operator` roles), `/api/v1/users` (`GET`, `POST`, `PATCH /{id}`, `DELETE /{id}`), and strict enforcement (`403 Forbidden` + UI lock) preventing deletion, disabling, or demotion of the built-in `admin` account.
  4. **`FB-P9-004` (Per-User Action Attribution & `audit_label` Badges):** Added `audit_label` to `AuditLog`, recorded `actor = current_user.username` across all mutations, and added the `Audit Label` badge column and filter selector in `StatusPage.tsx`.
  5. **`FB-P8-008` / `BUG-P9-002` (Plex Local LAN Streaming Investigation -> Deferred to Direct Plex API Integration `FB-P9-005`):** Evaluated Unbound DNS `*.plex.direct` / `plex.tv` playback heuristics in `CP-9.1`, which confirmed during Gate 2 validation (`PHASE9-Verify.md`) that LG webOS Smart TVs streaming over same-subnet L2 bypass both OPNsense `filterlog` and Unbound DNS during multi-hour sessions while other local services trigger `*.plex.direct` DNS queries. Per user decision, deeper Tautulli-style direct Plex Media Server API integration is logged as `FB-P9-005` (`BUG-P9-002`) for a future release.
- **Final Automated Quality Metrics (`v1.0.3`):**
  - **Backend (`pytest`, `ruff`, `mypy`):** `118 / 118` passed (`85%` coverage), `0` ruff errors, `0` mypy issues.
  - **Frontend (`vitest`, `tsc && vite build`):** `26 / 26` passed (`90.37%` coverage), `0` build/type errors.

### 2. Unplanned Information Audit & Feed-Forward Adjustments
- **Why Gateway Firewall/DNS Logs Cannot Replace Direct Plex API Telemetry (`BUG-P9-002` / `FB-P9-005`):**
  - In a local LAN where Smart TVs (`LGwebOSTV`) and the Plex Media Server reside on the same `/24` subnet, video streams travel at Layer 2 without crossing OPNsense (`filterlog`), and Smart TV apps cache `*.plex.direct` or use local GDM discovery without querying Unbound DNS during playback. Meanwhile, media automation/monitoring services on other LAN hosts periodically query `*.plex.direct`, skewing DNS-derived device rankings and `Last active` timestamps. Querying the Plex Media Server API directly (like Tautulli) is the authoritative solution and is tracked under `FB-P9-005`.
- **Feed-Forward into Phase 10 (`v1.0.4` — Dedicated `Firewall & Security` Tab):**
  - Phase 10 proceeds cleanly with `FB-P10-001` (Firewall & Security dashboard, pass/block/direction KPIs, timeline bar chart, Suspected Bad Actors / Scanners with 1-click LAN block, Active Inbound WAN Exposure / Open Ports, and searchable `filterlog` explorer).

---

## Phase 10 Exit Analysis & Unplanned-Information Retrospective (`v1.0.4` — 2026-11-06)

### 1. Phase 10 Deliverables & Quality Gate Summary
- **Deliverables Completed (`FB-P10-001`, `FB-P10-002` & Gate 2 Refinements `BUG-P10-004`..`BUG-P10-008`):**
  1. **`FB-P10-001` (Dedicated `Firewall & Security` Navigation Tab — `FirewallPage.tsx`, `firewall_service.py`, `firewall.py`, `elasticsearch.py`):**
     - Added `GET /api/v1/firewall/overview` and the `Firewall & Security` navigation tab displaying Total/Passed/Blocked (`(XX.X%)`) and Inbound/Outbound KPI cards, `Allowed` vs. `Blocked` timeline bar chart (with `Stacked | Total` selector and X/Y axis labels), **Noisy LAN Devices** (with SQLite device correlation and 1-click **Block Device** / **Allowed** toggle) & **External WAN Scanners**, **Active Inbound WAN Exposure (Open Ports)** with full `external_port:destination_port` mappings (`32400:32400 / TCP`, `32401:32400 / TCP`, `51820:51820 / UDP`), and the **Searchable Firewall Packet Log Explorer**.
  2. **`FB-P10-002` (Compact User-Configurable Auto-Refresh Interval Selector):**
     - Added `<AutoRefreshSelector />` (`Off`, `5s`, `30s`, `1m`, `5m` next to the timer icon, persisted in `localStorage`) directly next to Refresh buttons across `Firewall & Security`, `Traffic & DNS Analytics`, `Devices & Access Control`, `System & Admin`, and the Device/Group Analytics Drawers (excluding `Schedules & Bedtime` per user feedback).
  3. **Gate 2 Refinements (`BUG-P10-004` – `BUG-P10-008`):**
     - Aligned the `Firewall & Security` header controls on a single horizontal row (`BUG-P10-004`).
     - Isolated the Searchable Firewall Packet Log Explorer filters (`Action`, `Direction`, `Protocol`, `Search`) using Elasticsearch `post_filter`, split `size: 0` shard-cached `aggs` (`request_cache=True`) from `size: 80` `recent_events`, and locked window-level aggregations to `firewall_window:{win_key}` / `windowSnapshots[windowKey]` so changing log filters never alters `Noisy LAN Devices`, `External Scanners`, or `Active Inbound WAN Exposure` (`BUG-P10-005`, `BUG-P10-007`).
     - Replaced BKD CIDR range scans in `inbound_wan_passed` with `exists: {"field": "source.as.number"}` + `observer.ingress.interface.name: "vtnet1"`, cutting `24h` query execution time from `7.7s+` to `0.11s–0.58s` (`BUG-P10-006`).
     - Added `OPNsenseClient.get_destination_nat_mappings()` and `external_port:destination_port` resolution so shared internal redirect ports display their full external-to-internal port mappings (`32400:32400 / TCP`, `32401:32400 / TCP`, `51820:51820 / UDP` — `BUG-P10-008`).
- **Final Automated Quality Metrics (`v1.0.4`):**
  - **Backend (`pytest`, `ruff`, `mypy`):** `121 / 121` passed (`85%` coverage; `firewall.py` `100%`, `elasticsearch.py` `93%`, `firewall_service.py` `93%`), `0` ruff errors, `0` mypy issues across `31` source files.
  - **Frontend (`vitest`, `tsc && vite build`):** `27 / 27` passed across `7` test suites (`90.49%` coverage; `FirewallPage.tsx` `93.4%`, `AutoRefreshSelector.tsx` `94.52%`), `0` build/type errors.

### 2. Unplanned Information Audit & Feed-Forward Adjustments
- **Finding 1 — OPNsense Destination NAT (`rdr`) Logging Behavior in `filterlog` (`BUG-P10-006`, `BUG-P10-008`):**
  - When OPNsense forwards an inbound WAN packet via Destination NAT (`rdr`), `pf` translates `destination.ip` and `destination.port` prior to `filterlog` emission and logs the `pass` event as the packet exits the LAN interface (`observer.ingress.interface.name: "vtnet1"`) with `network.direction: "outbound"` and the internal redirect port (`32400`). Matching `exists: source.as.number` + `destination.ip in RFC1918` + `observer.ingress.interface.name: "vtnet1"` and enriching with OPNsense NAT state/rule mappings (`external_port:destination_port`) accurately surfaces all active port-forward exposures without slow BKD CIDR exclusions.
- **Finding 2 — Point-in-Time Snapshot Drift Across Separate Filter Cache Keys (`BUG-P10-007`):**
  - Even when Elasticsearch aggregations are unaffected by `post_filter`, keying React Query and backend TTL caches by `{window}:{action}:{direction}:{protocol}:{search}` causes filter switches after TTL expiration to compare aggregations from different timestamps (`T=0` vs `T+20s`). Locking window-level aggregations to a window-only cache key (`firewall_window:{win_key}`) and React `windowSnapshots[windowKey]` guarantees 100% visual stability when exploring logs.
- **Feed-Forward into Phase 11 (`v1.1.0` — Final Phase of `v1.1` Release Cycle):**
  - Zero open bugs waterfalled from Phase 10. Phase 11 proceeds directly with **`FB-P11-001`** (Custom Side-Profile Unicorn with Rainbow Horn Logo & Browser Favicon) and **`FB-P11-002`** (Clickable Header User Name Menu & 3 Eye-Friendly Dark-Room Color Themes: `Default Slate`, `Crimson & Obsidian`, and `Ocean & Navy`).




---

## Phase 11 Exit Analysis & `v1.1.0` Release Retrospective (`v1.1.0` — 2026-11-06)

### 1. Phase 11 Deliverables & Quality Gate Summary
- **Deliverables Completed (`FB-P11-001` & `FB-P11-002`):**
  1. **`FB-P11-001` (Custom Side-Profile Unicorn with Rainbow Horn Logo & Browser Favicon — `UnicornLogo.tsx`, `unicorn-favicon.svg`, `index.html`, `AppLayout.tsx`, `LoginPage.tsx`):**
     - Created `<UnicornLogo />` and `/unicorn-favicon.svg` featuring a side-profile unicorn silhouette with a multi-stop rainbow-gradient horn (`#f43f5e -> #fb923c -> #facc15 -> #34d399 -> #38bdf8 -> #a855f7`).
     - Replaced the shield brand icon in `AppLayout.tsx` and `LoginPage.tsx` and wired `<link rel="icon" type="image/svg+xml" href="/unicorn-favicon.svg" />` in `frontend/index.html`.
  2. **`FB-P11-002` (Clickable Header User Name Menu & 3 Eye-Friendly Dark-Room Color Themes — `auth.py`, `user_service.py`, `index.css`, `AuthContext.tsx`, `AppLayout.tsx`):**
     - Added `PATCH /api/v1/auth/preferences` and `update_self_theme_preference()` so any authenticated user (`admin` or `operator`) can persist their chosen `theme_preference` (`default`, `crimson`, or `ocean`) in SQLite (`User.theme_preference`) with `USER_MGMT` audit logging.
     - Defined 3 dark-room-friendly color themes via Tailwind v4 CSS custom property overrides in `frontend/src/index.css` (`Default Slate`, `Crimson & Obsidian` soft light/dark red on black, and `Ocean & Navy` soft light/dark blue on deep navy) and made the signed-in user badge in `AppLayout.tsx` clickable to open the **User Preferences & View Theme** popover.
- **Final Automated Quality Metrics (`v1.1.0`):**
  - **Backend (`pytest`, `ruff`, `mypy`):** `121 / 121` passed (`85%` coverage), `0` ruff errors, `0` mypy issues across `31` source files.
  - **Frontend (`vitest`, `tsc && vite build`):** `28 / 28` passed across `7` test suites (`90.70%` coverage; `UnicornLogo.tsx` `100%`, `AppLayout.tsx` `98.67%`, `AuthContext.tsx` `90.0%`), `0` build/type errors.

### 2. Unplanned Information Audit & Feed-Forward into `v1.2` Planning
- **Captured `v1.2` Planning Items from `PHASE11-Verify.md` (`FB-P11-003` – `FB-P11-008` / `BUG-P11-001`):**
  1. **`FB-P11-003` (`BUG-P11-001`):** Optimize cold-load Elasticsearch queries in `Traffic & DNS Analytics` (`track_total_hits: False`, `request_cache=True`, remove `*plex*` wildcard from `_build_app_usage_agg()`, tune `ELASTICSEARCH_TIMEOUT_SECONDS` from `10.0s` to `20.0s`) and automatically log runtime ES/OPNsense errors to `audit_logs` in the `System` tab.
  2. **`FB-P11-004`:** Integrate automated SAST/SCA/Container & Route Auth-Bypass security scanning (`pip-audit`, `npm audit`, `bandit`/`ruff S`, `trivy`, and programmatic FastAPI route auth assertions) into local checks and CI/CD.
  3. **`FB-P11-005`:** Streamline top header alignment (relocate clock so `Logout` aligns evenly), shorten tab labels to single words (`Devices`, `Schedules`, `Analytics`, `Firewall`, `System`) with larger icons, shorten title to `Gateway Control` with `Access & Telemetry Portal` + inline version badge, and enlarge `<UnicornLogo />` with a more defined border.
  4. **`FB-P11-006`:** Replace `YT Allowed` / `YT Blocked` text buttons with a compact YouTube logo button (bright when allowed, dim when blocked) and include `is_youtube_blocked` devices in the `Blocked` filter view on `Devices & Access Control`.
  5. **`FB-P11-007`:** Add a visual loading/refreshing state (greyed-out + slow pulse/blink) when waiting for Elasticsearch data so stale data is clearly distinguished during refreshes.
  6. **`FB-P11-008` & `FB-P9-005`:** Present architectural/performance improvement proposals and Tautulli-style direct Plex API integration during the `v1.2` planning phase.

---

## Phase 12 Exit Analysis & Unplanned-Information Retrospective (`v1.2.0-rc1` — 2026-11-06)

### 1. Phase 12 Deliverables & Quality Gate Summary
- **Deliverables Completed (`FB-P11-005`, `FB-P11-006`, `FB-P11-007`):**
  1. **`FB-P11-005` (Streamlined Header Brand Grid, Single-Word Tabs with Larger Icons, Even Vertical Alignment & Defined Unicorn Logo — `AppLayout.tsx`, `UnicornLogo.tsx`):**
     - Restructured the header brand block into a 2×2 left-justified CSS Grid (`grid grid-cols-[auto_auto] items-center justify-items-start gap-x-2.5 gap-y-0.5`): `Gateway Control` and `Access & Telemetry Portal` in Column 1, and `v1.2.0-rc1` + live `HH:MM:SS` clock (`text-xs leading-tight whitespace-nowrap`) in Column 2.
     - Removed the clock from underneath `Logout` so `Logout`, the User Name menu button, the `HEALTHY` badge, and the Navigation tabs share a single vertical center line.
     - Shortened navigation tabs to single-word labels (`Devices`, `Schedules`, `Analytics`, `Firewall`, `System`) with larger `h-4.5 w-4.5` icons, and enlarged `<UnicornLogo />` (`h-11 w-11`) with a defined indigo border and crisp silhouette stroke.
  2. **`FB-P11-006` (Compact YouTube Logo Toggle Button & Unified `Blocked` Filter — `YouTubeLogoIcon.tsx`, `DevicesPage.tsx`, `device_service.py`):**
     - Replaced the wide `YT Allowed` / `YT Blocked` text button on device rows with `<YouTubeLogoIcon />` inside a compact `h-8 w-8` button (vivid red when YouTube is allowed, dim/muted slate when YouTube is blocked).
     - Updated `status_filter == "blocked"` and `summary.blocked_devices` in `backend/app/services/device_service.py` and `DevicesPage.tsx` so the `Blocked` filter pill includes both full-internet blocked devices (`is_blocked`) and YouTube-blocked devices (`is_youtube_blocked`).
  3. **`FB-P11-007` (Visual Loading / Refreshing State with Slow Pulse & Centered Notification Pill — `TelemetryLoadingShell.tsx`, `index.css`, `AnalyticsPage.tsx`, `FirewallPage.tsx`, `DeviceAnalyticsDrawer.tsx`, `GroupAnalyticsDrawer.tsx`):**
     - Created `<TelemetryLoadingShell />` applying `@keyframes telemetry-slow-pulse` (`opacity: 0.42..0.72`, `saturate(0.35..0.65)`) and a centered gentle-bouncing notification pill (`fixed top-28 left-1/2 -translate-x-1/2`) while preserving `space-y-6` vertical card spacing across all wrapped views.
- **Final Automated Quality Metrics (`v1.2.0-rc1`):**
  - **Backend (`pytest`, `ruff`, `mypy`):** `122 / 122` passed (`84.4%` coverage), `0` ruff errors, `0` mypy issues across `31` source files.
  - **Frontend (`vitest`, `tsc && vite build`):** `28 / 28` passed across `7` test suites (`90.78%` coverage; `TelemetryLoadingShell.tsx` `100%`, `YouTubeLogoIcon.tsx` `100%`, `AppLayout.tsx` `98.65%`), `0` build/type errors.

### 2. Unplanned Information Audit & Feed-Forward into Phase 13 (`v1.2.0-rc2`)
- **Finding 1 — Wrapper Components & Tailwind `space-y-*` Direct-Child Combinators (`BUG-P12-001`):**
  - Wrapping multiple sibling sections inside a layout wrapper component (`<TelemetryLoadingShell>`) breaks parent `space-y-6` (`> :not([hidden]) ~ :not([hidden])`) spacing unless the wrapper's internal container explicitly re-applies `space-y-6`.
- **Finding 2 — Left-Justified Multi-Row Alignment Requires CSS Grid over Flex Rows (`BUG-P12-002`):**
  - When aligning two stacked labels of different widths (`Gateway Control` vs. `Access & Telemetry Portal`) alongside two right-hand indicators (`v1.2.0-rc1` vs. `HH:MM:SS`), separate flex rows cannot left-align the second column. A 2-column CSS Grid (`grid-cols-[auto_auto] justify-items-start`) guarantees strict vertical left-justification across both rows without text wrapping.
- **Feed-Forward into Phase 13 (`v1.2.0-rc2`):**
  - Zero open bugs waterfalled from Phase 12. Phase 13 proceeds with **`FB-P11-003` (`BUG-P11-001`)** (Elasticsearch cold-load query optimization, `ELASTICSEARCH_TIMEOUT_SECONDS` bump from `10.0s` to `20.0s`, and automatic runtime ES/OPNsense error logging to SQLite `audit_logs`) plus **`FB-P11-008` Proposals A & B** (background APScheduler cache pre-warming for `24h` Analytics & Firewall, and Elasticsearch `_msearch` consolidation).

---

## Phase 13 Exit Analysis & Unplanned-Information Retrospective (`v1.2.0-rc2` — 2026-11-06)

### 1. Phase 13 Deliverables & Quality Gate Summary
- **Deliverables Completed (`FB-P11-003` / `BUG-P11-001`, `FB-P11-008` Proposals A & B):**
  1. **`FB-P11-003` (`BUG-P11-001`) — Elasticsearch Query Optimization, Parallel `_msearch` & Timeout Tuning (`config.py`, `elasticsearch.py`):**
     - Increased default `ELASTICSEARCH_TIMEOUT_SECONDS` from `10.0s` to `20.0s` in `backend/app/config.py` and `.env.example`, and enforced `max(float(settings.elasticsearch_timeout_seconds), 20.0)` in `ElasticsearchServiceClient.__init__`.
     - Added `"track_total_hits": False` to `build_network_overview_query()`, `build_device_analytics_query()`, and `build_group_analytics_query()`, deriving `summary.total_events` from `max(hits_total, timeline_total, provider_total)`.
     - Removed leading-wildcard scans (`*.googlevideo.com` and `*plex*`), redundant `RFC1918_CIDRS` BKD scans inside `youtube`/`plex` filters, and `time_zone` rounding overhead on 5-minute `active_slots` histograms in `_build_app_usage_agg()`, and reduced `devices` `size` to `15`.
  2. **`FB-P11-008` Proposal B — Elasticsearch `_msearch` Consolidation (`elasticsearch.py`):**
     - Consolidated `aggs` + `recent_queries`/`recent_events` in `fetch_device_analytics()`, `fetch_group_analytics()`, and `fetch_firewall_overview()` into single `/_msearch` HTTP round-trips via `_execute_aggs_and_recent_search()`.
     - Split `fetch_network_overview()` into a 3-way parallel `client.msearch()` (`q_core`, `q_lan`, and `q_app` with top-level inverted-index filter for `youtube OR plex` and `/m` date rounding), reducing live `24h` forced-refresh query latency from **`13,621.4 ms` to `621.6 ms` (`21.9×` speedup)**.
  3. **`FB-P11-003` — Automatic Runtime Upstream Error Audit Logging (`audit_and_backup_service.py`, `models/__init__.py`, services):**
     - Added `record_upstream_error_audit_log()` with a 60-second per-`(service, operation)` deduplication window (`_UPSTREAM_ERROR_DEDUP`) and wired it across `analytics_service.py`, `firewall_service.py`, `group_service.py`, and `api/devices.py` so runtime Elasticsearch and OPNsense failures/timeouts are automatically persisted in `audit_logs` under `audit_label="DIAGNOSTIC_ERROR"`.
  4. **`FB-P11-008` Proposal A — Background APScheduler `24h` Cache Pre-Warming (`main.py`, `analytics_service.py`):**
     - Increased default `AnalyticsCache` TTL from `20.0s` to `90.0s` and registered `run_telemetry_cache_prewarm()` in `backend/app/main.py` (every 60s via APScheduler + initial startup task), delivering **`25.6 ms`** `24h` Analytics loads and **`7.4 ms`** `24h` Firewall loads from warm cache.
- **Final Automated Quality Metrics (`v1.2.0-rc2`):**
  - **Backend (`pytest`, `ruff`, `mypy`):** `124 / 124` passed (`85%` coverage; `elasticsearch.py` `97%`, `audit_and_backup_service.py` `87%`), `0` ruff errors, `0` mypy issues across `31` source files.
  - **Frontend (`vitest`, `tsc && vite build`):** `28 / 28` passed across `7` test suites (`90.78%` coverage), `0` build/type errors.

### 2. Unplanned Information Audit & Feed-Forward into Phase 14 (`v1.2.0-rc3`)
- **Finding 1 — Single-Shard Sequential Aggregation Bottleneck vs. Multi-Query `_msearch` Parallelism:**
  - `logs-pfsense.log*` resolves to a single active primary shard (`.ds-logs-pfsense.log-default-2026.10.25-000001`). In Elasticsearch, a single `_search` request executes all top-level aggregations sequentially on a single shard search thread. Splitting `fetch_network_overview()` into a 3-way `_msearch` allows Elasticsearch to execute `q_core`, `q_lan`, and `q_app` concurrently across 3 search threads while applying a top-level inverted-index filter (`youtube OR plex`) to `q_app`, cutting `24h` execution time from `13.6s` to `0.62s`.
- **Finding 2 — `30d` Window (`14.28M` Docs) Cold Latency & Captured User Enhancements (`FB-P13-001` / `BUG-P13-002` & `FB-P13-002`):**
  - During Gate 2 live UI validation (`PHASE13-Verify.md`), the user observed much faster load times across `1h`, `24h`, and `7d`, with occasional cold timeouts on `30d` (`14.28M` docs), and requested two enhancements that are waterfalled into **Phase 14 (`v1.2.0-rc3`)**:
    1. **`FB-P13-001` (`BUG-P13-002`) — `PERFORMANCE_ANALYSIS` Audit Label & `30d` Window Optimization:** Record per-window telemetry load times in `audit_logs` under a new `PERFORMANCE_ANALYSIS` audit label, optimize `30d` `lan_devices` and `app_usage` slot intervals (`15m` for `7d`, `30m` for `30d` + top-level `RFC1918_CIDRS` filter on `q_lan`), and extend background cache pre-warming to cover `7d` and `30d`.
    2. **`FB-P13-002` — Firewall Active WAN Ports Connected External IPs Side-Drawer Inspector:** Make the `External IPs` count in the **Active Inbound WAN Exposure (Open Ports)** table clickable to open a slide-over side drawer displaying connected external IP details (IP address, GeoIP city/region/country/coordinates, ISP/ASN organization, connection duration `first_seen -> last_seen` & active minutes, packet/byte volume, source ports/TCP flags, and recent packet log entries).
- **Feed-Forward into Phase 14 (`v1.2.0-rc3`):**
  - Phase 14 combines the originally scheduled **`FB-P11-004`** (Automated Code & Dependency Security Scanning, SAST/SCA, and FastAPI Route Auth-Bypass & RBAC Audit Suite) and **`FB-P11-008` Proposal D** (Frontend Route Code-Splitting via `React.lazy()` + Vite `manualChunks`) with the two Phase 13 waterfall items **`FB-P13-001`** (`PERFORMANCE_ANALYSIS` audit load-time tracking + `30d` optimization) and **`FB-P13-002`** (Firewall Active WAN Ports Connected External IPs Side-Drawer Inspector).


