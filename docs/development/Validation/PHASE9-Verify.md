# Phase 9 (`v1.0.3`) — Gate 2 Live UI Validation Checklist & Feedback (`PHASE9-Verify.md`)

> **Release Target:** `v1.0.3` (Phase 9 of the `v1.1` Release Roadmap)  
> **Container Endpoint:** `http://localhost:8080`  
> **Gate Status:** `COMPLETE — USER FEEDBACK RECORDED`

---

## 1. Pre-Validation Automated Quality Gate & Container Smoke Test Summary

- **Backend (`pytest`, `ruff`, `mypy`):**
  - `118/118` tests passed (`100%` pass rate, **`85%`** total coverage).
  - `ruff check backend`: **`0`** errors.
  - `mypy backend/app`: **`0`** issues across `29` source files.
- **Frontend (`vitest`, `tsc && vite build`):**
  - `26/26` tests passed across `7` test suites (`100%` pass rate, **`90.37%`** statement/line coverage).
  - `tsc -b && vite build`: **`0`** TypeScript or bundle errors.
- **Live Single-Container Smoke Check (`http://localhost:8080`, `v1.0.3`):**
  - `GET /api/v1/system/health` reports `version: "1.0.3"`, `overall_status: "healthy"`, `cluster_status: "green"`.
  - `GET /api/v1/auth/setup-status` reports `needs_initial_setup: false`, `admin_username: "admin"` (auto-seeded from `.env` on upgrade).
  - `GET /api/v1/users` lists the built-in `admin` user with `role: "admin"` and `is_protected_admin: true`.
  - `GET /api/v1/system/settings` returns sanitized OPNsense and Elasticsearch runtime settings (`source: "env"`, `has_opnsense_api_key: true`, `has_elasticsearch_api_key: true`).
  - `GET /api/v1/analytics/overview` (`24h` & `7d`) confirms **Plex Local LAN Client Streaming (`FB-P8-008` / `BUG-P8-003`)** now captures LAN client playback (`245m` / `4h 5m` active over 24h; `1,455m` / `24h 15m` over 7d across LAN streaming clients) while excluding Plex Media Server hosts and 24/7 health pollers.

---

## 2. What to Verify at `http://localhost:8080` (`v1.0.3`)

### 1. Plex Local LAN Client Streaming Detection Fix (`FB-P8-008` / `BUG-P8-003`)
- [Fail ] Open the **Traffic & DNS Analytics** tab (`http://localhost:8080`) and inspect the **Application Usage Stats** panel (`24h` and `7d` windows).
- [Fail ] Verify **Plex** now reports active LAN client streaming duration (`~4h 5m` in `24h`, `~24h 15m` in `7d`) and lists the **Top 3 Devices** streaming Plex on the LAN (while excluding the Plex Media Server host `.2`/`.250` and 24/7 health poller `.3`).
- [Fail ] *(Note on `LGwebOSTV` `.243`)*: If `LGwebOSTV` connects to the local Plex server via a cached `*.plex.direct` DNS lease or direct LAN IP without re-querying Unbound DNS during playback, start or resume a stream on `LGwebOSTV` (or inspect `7d`) to confirm its `*.plex.direct` / `plex.tv` playback queries register in `Top 3 Devices`.

**Validation**: Fail: See 1 and 2 above.

### 2. NGINX-Style First-Boot `admin` Password Creation (`FB-P9-001`)
- [Pass ] Verify that on this existing deployment (where `ADMIN_PASSWORD` is configured in `.env`), the container automatically seeded the `admin` account in SQLite so your existing login works seamlessly without interruption.
- [Pass ] On the **Login** screen (click **Logout** in the top-right header), verify the **"First-boot clean container? Create initial admin password"** toggle link is available and displays the First-Boot `admin` Password Creation form (`New Administrator Password` + `Confirm New Password`), which is automatically shown on a clean container build when no `ADMIN_PASSWORD` is set.

### 3. UI Admin Panel for OPNsense & Elasticsearch Variables + Live Connectivity Test (`FB-P9-002`)
- [Pass ] Open the **System Connectivity** tab (`StatusPage`) while signed in as `admin`.
- [Pass ] Locate the **Integration Settings & Connectivity Diagnostics** panel and click **Configure Connections**.
- [Pass ] Verify the panel displays:
  - The current configuration source badge (**`Source: .env`** or **`Source: UI Override`**).
  - Editable fields for **OPNsense 26.7.7 Connection** (`Base URL`, masked `API Key`, masked `API Secret`, `Verify TLS Certificate`) and **Elasticsearch 9.4.3 Connection** (`Elasticsearch URL`, masked `Base64 API Key`, `Index Patterns`, `Verify TLS Certificate`).
- [Pass ] Click **Test OPNsense Connection** and **Test Elasticsearch Connection** and verify the live connectivity diagnostic banner reports **`REACHABLE`** with round-trip latency in `ms` (or surfaces a detailed `Diagnostic` + `Hint` message and logs a `DIAGNOSTIC_ERROR` entry in Audit History if an invalid URL/key is tested).
- [Pass ] Verify **Save Integration Settings** persists overrides in SQLite (`Source: UI Override`) and **Reset to .env Defaults** reverts back to `.env`.

### 4. Multi-User Management & Built-in `admin` Protection (`FB-P9-003`)
- [Pass ] On the **System Connectivity** tab, locate the **User Accounts & Access Management** panel and click **Manage Users**.
- [Pass ] Verify the built-in **`admin`** row displays the **`Protected Default Admin`** lock badge and that its **Disable** and **Delete** buttons are disabled/locked.
- [Pass ] Use the **Add User** form to create a test user (e.g., username `test_operator`, password `OperatorPass!123`, role `Standard User (Operator)` or `Administrator`).
- [Pass ] Verify the new user appears in the table and can be **Disabled / Enabled**, **Deleted**, and used to sign in on the Login page (note: `Standard User (Operator)` accounts can manage devices/groups/schedules/analytics but do not see the Admin-only Integration Settings or User Management panels).

### 5. Per-User Action Attribution & `Audit Label` Badges (`FB-P9-004`)
- [Pass ] Scroll to the **Audit & Event History** panel at the bottom of the **System Connectivity** tab and click **Load Audit Logs** (or **Refresh Audit Logs**).
- [Pass ] Verify each row now includes an **`Audit Label`** badge column (`AUTH_EVENT`, `USER_MGMT`, `SETTINGS_CHANGE`, `DIAGNOSTIC_ERROR`, `DEVICE_CONTROL`, `YOUTUBE_CONTROL`, `GROUP_CONTROL`, `TIMER_OVERRIDE`, `SCHEDULE_CHANGE`, `CONFIG_BACKUP`, or `SYSTEM`) and records the exact username in the **`Actor`** column.
- [Pass ] Verify the **All Audit Labels** filter dropdown filters the audit log table by category label.

---

## 3. User Validation Feedback
*(Please record your verification results, observations, and any change requests below, then notify the agent when review is complete.)*

### Requested Reviews
1. **Plex Local LAN Client Streaming Detection Fix (`FB-P8-008` / `BUG-P8-003`):**
   - **Fail (`BUG-P9-002` / `FB-P9-005`):** Time accuracy is still incorrect. While there is some logging occurring, we still do not see the correct time for all devices. Yesterday several hours were logged on two LG televisions and neither of those are showing. It will be much more accurate to directly query the Plex Media Server API interface to get these details, much like the app **Tautulli** does. Logged as **`BUG-P9-002`** and **`FB-P9-005`** to plan for deeper direct Plex API / Tautulli-like integration (out of scope for Phase 9).
   - **Additional Plex Observation:** None of the LG TV streaming devices are showing properly in the 24h Top 3 list (`Active Time: 3h`, `DNS Queries: 22,808`, `Last active: 06:00:58`, showing other LAN hosts `.66`, `.70`, `.134`), and the `Last active` timestamp is always near the current time (`last_active` max-timestamp aggregation was computed at the global `plex` bucket level before excluding background pollers/servers), indicating other background processes utilizing Plex or Plex itself are triggering DNS traffic.

2. **NGINX-Style First-Boot `admin` Password Creation (`FB-P9-001`):**
   - **Pass** (Verified in Section 2 Item 2 above).

3. **UI Admin Panel for OPNsense & Elasticsearch Variables + Live Connectivity Test (`FB-P9-002`):**
   - **Pass:** Looks good.
4. **Multi-User Management & Built-in `admin` Protection (`FB-P9-003`):**
   - **Pass:** Looks good.
5. **Per-User Action Attribution & `Audit Label` Badges (`FB-P9-004`):**
   - **Pass:** Looks good.

### Additional Feedback / Observations
- None

### Feature Requests
- None

