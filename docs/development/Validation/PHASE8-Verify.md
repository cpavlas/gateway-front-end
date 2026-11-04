# Phase 8 (`v1.0.2`) — Gate 2 Live UI Validation Checklist & Feedback (`PHASE8-Verify.md`)

> **Release Target:** `v1.0.2` (Phase 8 of the `v1.1` Release Roadmap)  
> **Container Endpoint:** `http://localhost:8080`  
> **Gate Status:** `COMPLETE — USER FEEDBACK RECORDED`

---

## 1. Pre-Validation Automated Quality Gate Summary

- **Backend (`pytest`, `ruff`, `mypy`):** `113/113` tests passed (`86%` total coverage), `0` ruff errors, `0` mypy issues.
- **Frontend (`vitest`, `tsc && vite build`):** `24/24` tests passed across `7` test suites (`91.16%` statement/line coverage), `0` build/type errors.
- **Live Container Smoke Check (`v1.0.2`):**
  - `/api/v1/system/health` reports `version: "1.0.2"`, `overall_status: "healthy"`, `cluster_status: "green"`, `assigned_shards: 1638`, `unassigned_shards: 0`, `relocating_shards: 0`.
  - `/api/v1/analytics/overview?time_range=24h` reports per-device 5-minute active windows and `top_devices` after filtering out OPNsense `filterdns` alias refresh queries on `.1`.

---

## 2. What to Verify at `http://localhost:8080` (`v1.0.2`)

### 1. Application Usage Stats Accuracy & Top 3 Devices (`FB-P8-001`, `FB-P8-002`, `FB-P8-007`)
- [x] Open the **Traffic & DNS Analytics** tab.
- [x] Verify the section title reads **"Application Usage Stats"** (no EM dash or redundant suffix).
- [x] Verify **YouTube** no longer shows near-100% (`~20–24h`) active time when idle, and instead reflects actual LAN client streaming windows.
- [x] Verify the bottom of each card lists the **Top 3 Devices (Active Time)** with device name, IP address, and active duration.
- [ ] **Plex Accuracy Issue Observed (`BUG-P8-003`):** Plex does not capture local LAN streaming time and devices (e.g., `LGwebOSTV` on `.243`). Logged as `BUG-P8-003` / `FB-P8-008` for Phase 9 (`v1.0.3`).

### 2. Blocked Firewall Packets Percentage (`FB-P8-003`)
- [x] Check the **Blocked Firewall Packets** KPI box on **Traffic & DNS Analytics**, inside a **Device Analytics Drawer**, and inside a **Group Analytics Drawer** to confirm the blocked percentage (`(XX.X%)`) is displayed immediately after the packet count.

### 3. Bar Graph `Stacked` | `Total` View Selector & X/Y Axis Keys (`FB-P8-004`, `FB-P8-005`)
- [x] Check all 5 bar graphs:
  1. Network Overview: **Usage & Activity Timeline** (`AnalyticsPage`)
  2. Device Analytics Drawer: **Usage & Activity Timeline** & **24-Hour Active Access Profile**
  3. Group Analytics Drawer: **Group Usage & Activity Timeline** & **24-Hour Group Access Profile**
- [x] Verify each bar graph includes:
  - A **`Stacked` | `Total`** toggle in the header and a color key legend.
  - A visible **Vertical (Y) Axis** with `Events` key and `Max` / `50%` / `0` scale ticks.
  - A visible **Horizontal (X) Axis** with timestamp/hour ticks and axis title (`Time Window` or `Hour of Day (00:00 - 23:00)`), plus at-a-glance value labels on active bars.

### 4. Elasticsearch 9.4.3 Cluster Health & Shard Counts (`FB-P8-006`)
- [x] Open the **System Connectivity** tab (`StatusPage`) and inspect the **Elasticsearch 9.4.3** card.
- [x] Verify **Cluster Health** (`GREEN`) and **Shards (Assigned / Unassigned / Relocating)** are displayed.

### 5. Global EM-Dash (`—`) Removal & `Updated: HH:MM:SS` Below Refresh Buttons (`FB-P8-007`)
- [x] Verify **`Updated: HH:MM:SS`** (24-hour time) appears directly underneath every **Refresh** button across **Devices & Groups**, **Schedules**, **Traffic & DNS Analytics**, **System Connectivity** (both `Refresh Status` and `Refresh Audit Log`), and the **Device / Group Analytics Drawers**.
- [x] Verify EM dashes (`—`) have been removed across UI headers and labels.

---

## 3. User Validation Feedback (`2026-11-03`)

### Requested Reviews
1. **Application Usage Stats Accuracy & Top 3 Devices (`FB-P8-001`, `FB-P8-002`, `FB-P8-007`):**
   - All items are confirmed working and correct as planned for everything except **Plex**, which does not appear to be catching the correct time used and devices. Local traffic from `LGwebOSTV` (`.243`) during several hours of Plex playback was not present. Logged as `BUG-P8-003` (`docs/development/TEST_AND_BUG_LOG.md`) and `FB-P8-008` (`docs/development/FEATURE_BACKLOG.md`) for investigation and resolution in Phase 9 (`v1.0.3`).
2. **Blocked Firewall Packets Percentage (`FB-P8-003`):**
   - Confirmed.
3. **Bar Graph `Stacked` | `Total` View Selector & X/Y Axis Keys (`FB-P8-004`, `FB-P8-005`):**
   - Confirmed.
4. **Elasticsearch 9.4.3 Cluster Health & Shard Counts (`FB-P8-006`):**
   - Confirmed.
5. **Global EM-Dash (`—`) Removal & `Updated: HH:MM:SS` Below Refresh Buttons (`FB-P8-007`):**
   - Confirmed.

### Process Feedback
- Update `AGENTS.md` to create `docs/development/Validation/PHASEx-Verify.md` for Live UI Validation at the Gate 2 checkpoints and publish all the required "What to Verify" items in the document for easy review so the user can record feedback at the end of verification.

### Feature Requests
- None.
