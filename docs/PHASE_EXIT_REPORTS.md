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
- **Full-Stack Live Smoke Test:** Passed against live `https://gateway.sparkle-pony.com` (`373.01 ms`), `https://es1.sparkle-pony.com` (`39.53 ms`, `6,689,623` docs in `logs-pfsense.log*`), and local SQLite (`54.11 ms`).
- **Bugs Resolved in Phase 1:** `5` (`BUG-P1-001` through `BUG-P1-005` in [docs/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `3` live environment schema discoveries waterfalled into Phases 2 and 3 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments to Future Phases (`PLAN.md`)
1. **Waterfalled into Phase 2 (Device Discovery & Instant Block/Unblock):**
   - **Update 2A — Dnsmasq Lease Field Mapping & `"*"` Placeholder Handling:** Live inspection of `/api/dnsmasq/leases/search` on OPNsense `26.7.7-amd64` showed lease objects use `address` (IPv4), `hwaddr` (MAC), `mac_info` (manufacturer), `if_descr`, and literal `"*"` when `hostname` or `client_id` is unknown. Added explicit requirement in Phase 2 to map `address`/`hwaddr`/`mac_info` alongside ARP's `ip`/`mac`/`manufacturer` and normalize `hostname == "*"` to `None`.
   - **Update 2B — Dual-Path Alias Mutation (`alias_util` + `/api/firewall/alias/*` Config Fallback):** Because `Firewall: Aliases` (`page-firewall-aliases`) grants access to `/api/firewall/alias/*` (`get_alias_uuid`, `get_item`, `set_item`, `reconfigure`) whereas `/api/firewall/alias_util/*` requires `Diagnostics: PF Table IP addresses` (`page-diagnostics-table`), Phase 2's `block_ip()` and `unblock_ip()` methods in `OPNsenseClient` will support `alias_util/add` & `alias_util/delete` with an automatic fallback to `get_alias_uuid` → `get_item` → `set_item` → `reconfigure` so blocking works with or without `page-diagnostics-table`.
   - **Phase 2 Complexity Impact:** Remains **3 / 5 (Medium)** (risk reduced because exact ARP/Dnsmasq JSON schemas and alias UUID `7eb9bc75-bcba-42f9-8193-f5b14090488a` are already verified).
2. **Waterfalled into Phase 3 (Elasticsearch `9.4.3` Analytics):**
   - **Update 3A — Verified `filterlog` & `unbound` ECS Field Paths:** Live inspection (`docs/ES_SCHEMA_DISCOVERY.md`) confirmed that OPNsense uses **Unbound** for DNS resolution (`event.provider: "unbound"`, `3.02M+` docs) and that `dns.question.name`, `dns.question.registered_domain`, `dns.question.subdomain`, `source.ip`, and `client.ip` are already populated without needing any custom ingest pipeline changes. Bandwidth/connection queries will filter by `event.provider: "filterlog"` (`network.bytes`, `event.action: pass | block`, `destination.as.organization.name`).
   - **Phase 3 Complexity Impact:** Confirmed at **3.5 / 5 (Medium–High)** (down from original `4 / 5`).

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 2
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (Host & TLS Setup):* OPNsense is accessed via FQDN `https://gateway.sparkle-pony.com` (`192.168.50.1`) and Elasticsearch via `https://es1.sparkle-pony.com`, both with valid TLS certificates (`VERIFY_SSL=true`).
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
    2. Docker Desktop (`v29.9.2`, Compose `v5.6.1`) is installed in the per-user directory `C:\Users\cpavl\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe` (rather than `C:\Program Files\Docker`) and should be prepended to `$env:PATH` in tool sessions.
    3. `coverage.py`'s legacy C-tracer (`ctrace`) deadlocks with `aiosqlite` worker threads on Windows Python 3.12; setting `core = "sysmon"` (PEP 669) in `backend/pyproject.toml` resolved it permanently (`BUG-P1-001`).
- **How we will apply these learnings to Phase 2:**
  1. Use the real (redacted) ARP and Dnsmasq lease JSON structures from [docs/ES_SCHEMA_DISCOVERY.md](ES_SCHEMA_DISCOVERY.md) directly in Phase 2 `respx` test fixtures.
  2. Implement both `alias_util` (`add`/`delete`) and `/api/firewall/alias/*` (`set_item` + `reconfigure`) fallback in `OPNsenseClient` so device blocking works reliably under your current `svc_gateway_ui` privileges.

---

## Phase 2 Exit Report (`2026-10-31`)

### 1. Quality Gate Summary
- **Backend Unit Tests (`pytest`):** `72 / 72 passed` in `1.72s` — **89.0% total statement coverage** (exceeds `>= 85%` gate; `100%` on `models`, `95%` on `clients/opnsense.py`, `86%` on `services/device_service.py`).
- **Backend Static Analysis (`ruff` + `mypy`):** `0 errors` across all 16 source files and 8 test suites.
- **Frontend Unit Tests (`Vitest`):** `7 / 7 passed` in `3.56s` — **96.59% line/statement coverage**, **87.15% branch coverage**, **90.16% function coverage**.
- **Frontend Production Build (`tsc -b && vite build`):** Succeeded in `1.57s` with `0 errors`.
- **Full-Stack Live Smoke & Manual UI Verification (`http://localhost:8080`):**
  - Reconciled **`69` total network devices** (`57` online in ARP, `0` literal `"*"` hostnames remaining, `192.168.50.1` automatically locked as Protected).
  - Verified live single-click **Block** and **Allow (Unblock)** end-to-end against `https://gateway.sparkle-pony.com` (`OPNsense 26.7.7-amd64`).
- **Bugs Resolved in Phase 2:** `4` (`BUG-P2-001` through `BUG-P2-004` in [docs/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
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
  2. Use the verified `filterlog` (`3.63M+` docs) and `unbound` (`3.02M+` docs) ECS field paths (`network.bytes`, `event.action`, `dns.question.name`, `dns.question.registered_domain`, `destination.as.organization.name`) from [docs/ES_SCHEMA_DISCOVERY.md](ES_SCHEMA_DISCOVERY.md).

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
- **Bugs Resolved in Phase 3:** `1` (`BUG-P3-001` in [docs/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
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
  - Verified live Group creation, member assignment, one-click Group Block/Unblock against `https://gateway.sparkle-pony.com`, and multi-IP Group Analytics (`108,822` events / `37.65 MB` / `32,692` DNS queries with per-member contribution breakdown) against `https://es1.sparkle-pony.com`.
  - User confirmed manual verification: *"Buttons are working; Block / Unblock works, including with created groups"*, and provided 11 structured UI & feature feedback items logged in [docs/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md).
- **Bugs Resolved in Phase 4:** `1` (`BUG-P4-001` in [docs/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `11` user UI/feature feedback items logged in [docs/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md) and waterfalled into Phases 5–7 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments & Feature Backlog Integration (`PLAN.md` & `docs/FEATURE_BACKLOG.md`)
1. **Established `docs/FEATURE_BACKLOG.md` as a Mandatory Phase-Gate Artifact:**
   - All 11 Phase 4 user feedback items (`FB-P4-001` through `FB-P4-011`) are tracked with complexity ratings, code references, and architectural evaluations in [docs/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md), and reviewed at the start and end of every phase.
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
   - Documented technical architecture options in [docs/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md) for per-device domain (`type: "host"`) and ASN (`type: "asn"` + `destination.as.number` ES sub-aggregation) blocking via OPNsense aliases and per-device firewall rules, plus the **Blocked Domains & ASN Organizations** management panel in the Analytics Drawer.

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
  2. Begin Phase 5 by reviewing [docs/FEATURE_BACKLOG.md](FEATURE_BACKLOG.md) and executing the scheduled Phase 4 UI & chart enhancements alongside the Temporary Pause / Bonus Access timer engine.

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

### 2. Waterfall Impact & Plan Adjustments for Subsequent Phases (`PLAN.md` & `docs/FEATURE_BACKLOG.md`)
1. **Zero Deferred Bugs from Phase 5:**
   - All 3 defects discovered during Phase 5 (`BUG-P5-001`, `BUG-P5-002`, and `BUG-P5-003`) were resolved and verified with regression tests before Phase 5 check-in.
2. **User Phase 5 UI & Persistence Feedback Logged in `docs/FEATURE_BACKLOG.md` & Scheduled for Phase 6 (`FB-P5-001` – `FB-P5-010`):**
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
    - Confirmed `Schedules & Bedtime` tab (`SchedulesPage.tsx` & `ScheduleFormModal.tsx`) and host SQLite persistence at `d:\source\gateway-front-end\data\gateway.db` (`FB-P5-010`).

---

### 2. Waterfall Impact & Plan Adjustments for Phase 7 (`PLAN.md` & `docs/FEATURE_BACKLOG.md`)
1. **Zero Deferred Bugs from Phase 6:**
   - Both defects discovered during Phase 6 (`BUG-P6-001` and `BUG-P6-002`) were resolved and verified with regression tests before Phase 6 check-in.
2. **User Phase 6 Feedback & Feature Requests Logged in `docs/FEATURE_BACKLOG.md` & Scheduled for Phase 7 (`FB-P6-001` – `FB-P6-005`):**
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

