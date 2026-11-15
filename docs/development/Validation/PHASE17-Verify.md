# Phase 17 Live UI & Container Validation (`PHASE17-Verify.md` — `v1.3.0-rc2`)

**Release Candidate:** `1.3.0-rc2` (`phase17`)  
**Scope:** Devices Tab UI/UX Overhaul (`FB-P17-001`, `FB-P17-002`), Analytics Drawers Compact Controls & Inline Timer (`FB-P17-003`), and Schedules Tab `YouTube Only` Mode, Editable Target, Duplicate/Clone, Weekly 7-Day Timeline, Compact Controls, Snooze & Auto-Refresh (`FB-P17-004`, `FB-P17-005`).  
**Target URL:** [http://localhost:8080](http://localhost:8080)

---

## 1. Automated Pre-Validation Quality Gate Summary

| Quality Gate | Tooling / Command | Verification Criteria | Status | Results |
| :--- | :--- | :--- | :---: | :--- |
| **Backend Unit & API Suite** | `.\backend\.venv\Scripts\pytest.exe backend/tests --cov=app` | 100% pass rate & `>= 85%` coverage | **PASS** | `144 passed` in `21.77s`, `85%` total coverage (`6279` stmts, `943` missed) |
| **Backend Lint** | `.\backend\.venv\Scripts\ruff.exe check backend` | `0` lint/style errors | **PASS** | `All checks passed!` (`0` errors) |
| **Backend Type Checker** | `.\backend\.venv\Scripts\mypy.exe backend/app` | `0` strict static type issues | **PASS** | `Success: no issues found in 33 source files` |
| **Frontend Unit Suite** | `npm test` (`vitest run --coverage`) | 100% pass rate & `>= 85%` coverage | **PASS** | `9/9` test files, `35 passed` in `12.72s`, `90.98%` statements/lines coverage (`DevicesPage.tsx` `92.72%`, `SchedulesPage.tsx` `89.42%`, `WeeklyScheduleTimeline.tsx` `100%`, `DeviceAnalyticsDrawer.tsx` `91.64%`) |
| **Frontend TypeScript & Build** | `npm run build` (`tsc -b && vite build`) | `0` TS or Vite bundle errors | **PASS** | `1658` modules transformed, `✓ built in 1.79s`, `0` errors |
| **Container Image Rebuild** | `docker compose -f docker/docker-compose.yml --env-file .env up -d --build` | Multi-stage Node 22 + Python 3.12 container builds and starts cleanly | **PASS** | Built `gateway-front-end:latest` (`gateway-frontend-backend==1.3.0rc2` / `gateway-front-end-ui@1.3.0-rc2`) and recreated running container |
| **Container Healthcheck** | `docker ps --filter name=gateway-front-end` | Container reports `(healthy)` bound to `0.0.0.0:8080->8000/tcp` | **PASS** | `Up ... (healthy)` on `0.0.0.0:8080->8000/tcp`, `GET http://localhost:8080/` returns `HTTP 200` |
| **Backend Version Probe** | `GET /api/v1/system/ping` & SQLite schema inspection | Running app serves `1.3.0-rc2` with migrated Phase 17 columns | **PASS** | `/api/v1/system/ping` -> `200 {"status": "ok", "version": "1.3.0-rc2"}`; SQLite `devices.is_archived`, `schedules.block_mode`, and `schedules.snoozed_until` verified present |
| **Live Upstream Diagnostics** | Authenticated `GET /api/v1/system/health`, `GET /api/v1/devices`, `GET /api/v1/devices?status=archived`, `GET /api/v1/schedules` | All configured upstreams healthy and Phase 17 endpoints respond cleanly | **PASS** | `overall_status: "healthy"`, `version: "1.3.0-rc2"` (`sqlite` `healthy` `41.64ms`, `opnsense` `healthy` `275.8ms`, `elasticsearch` `healthy` `65.84ms`, `plex` `healthy` `9.78ms`); `GET /api/v1/devices` `200` (`total_devices: 74`, `online_devices: 57`, `protected_devices: 1`, `archived_devices: 0`); `GET /api/v1/devices?status=archived` `200`; `GET /api/v1/schedules` `200` |

---

## 2. What to Verify at http://localhost:8080

### Section A — Devices Tab: Collapsible Groups Section & Compact Group Card Actions (`FB-P17-001`)
1. - [pass] Sign in at [http://localhost:8080](http://localhost:8080) as administrator and confirm the footer/header version reflects `v1.3.0-rc2`.
2. - [pass] Locate the **Device Groups & Profiles** section header and click the collapse/expand chevron toggle. Confirm the group card grid collapses cleanly to save vertical space.
3. - [pass] Refresh the browser (`F5`) and verify that the collapsed/expanded preference persists via `localStorage` (`gateway_devices_groups_collapsed`). Expand it again when ready.
4. - [pass] Inspect the action bar at the bottom of any Group Card and confirm compact icon-only controls replace wide text buttons:
   - Left cluster: **`Filter`** (funnel icon) and **`Analytics`** (bar chart icon).
   - Right cluster: **`YouTube`** (`YT` logo icon), **`Timer`** (`TimerPopoverMenu` clock icon), and **`Allow / Block Group`** (globe / shield icon).
   - Verify tooltips/hover titles clearly describe each action on desktop and fit comfortably without overflow on mobile/tablet widths.
5. - [pass] Click **`Filter`** on a group card and confirm the device inventory table filters to members of that group (and clicking again clears the group filter).

### Section B — Devices Tab: Unified `Actions` Column, Column Sorting, Inline `+ Group` Popover & Archive/Restore/Delete (`FB-P17-002`)
1. - [pass] Inspect the **Device Inventory Table** header and confirm the legacy `Telemetry` and `Internet Access` columns are merged into a single right-aligned **`Actions`** column containing **`Analytics`**, **`YouTube`**, **`Timer`**, **`Internet Access`**, and (for offline devices) **`Archive` / `Restore` / `Delete`**.
2. - [pass] Click each sortable column header — **`Online`**, **`Device / Hostname`**, **`IPv4`**, **`Vendor / OUI`**, and **`Status`** — and verify sort direction toggles ascending/descending with indicator arrows (`↑` / `↓`), sorting IPv4 addresses numerically rather than lexicographically.
3. - [pass] Click the **`+ Group`** badge next to any device row (or during inline rename) to open the quick-assign popover, toggle one or more groups on/off, and verify the device's group badges and Group Card member counts update immediately without opening the full Edit Group modal.
4. - [pass] Find an **offline** non-protected device and verify it shows an **Archive** (box) icon and **Delete** (trash) icon (whereas online devices do not show Archive/Delete).
5. - [pass] Click **Archive** on that offline test device: confirm it disappears from the default **`All`** view and the **`Archived`** filter pill counter increments (`1`).
6. - [pass] Click the **`Archived`** filter pill, verify the archived device appears with a **Restore** icon button and **Delete** icon button, click **Restore**, and confirm the device returns to the active **`All`** inventory list. (Optionally test deleting a stale offline test device, or confirm Delete works cleanly when needed.)

### Section C — Device & Group Analytics Drawers: Compact Header Controls & Inline Timer (`FB-P17-003`)
1. - [pass] Open a **Device Analytics Drawer** by clicking the chart icon on a non-protected LAN device row.
2. - [pass] Inspect the drawer header next to the close (`X`) button and verify compact icon controls render inline: **`YouTube`** toggle icon, **`Timer`** (`TimerPopoverMenu` clock icon), and **`Internet Access`** toggle icon (or **`Protected`** lock icon on a safeguarded device).
3. - [pass] Open the embedded **`Timer`** popover right inside the drawer header, set or inspect a quick timer option (e.g., 15m/30m YouTube pause or bonus), or toggle YouTube/Internet access, and confirm state stays synchronized without closing the drawer.
4. - [pass] Open a **Group Analytics Drawer** from a Group Card's chart icon and confirm the same compact **`YouTube`**, **`Timer`**, and **`Allow/Block Group`** header icon controls render and respond cleanly.

### Section D — Schedules Tab: `YouTube Only` Mode, Editable Target, Duplicate/Clone, Weekly Timeline, Snooze & Auto-Refresh (`FB-P17-004` & `FB-P17-005`)
1. - [pass] Switch to the **`Schedules`** tab and check the header for the **`AutoRefreshSelector`** dropdown (`Off`, `15s`, `30s`, `1m`, etc.).
2. - [pass] Click **`New Schedule`** and verify you can select **`Block Mode`**: **`Full Internet Access`** or **`YouTube Only`**. Create a test schedule (e.g., `YouTube Only` targeting a test device or group).
3. - [pass] Confirm the **Weekly 7-Day / 24-Hour Coverage Matrix** bar at the top of the `Schedules` page visualizes enabled rules across **Mon–Sun** (`00:00`–`24:00`), color-coded by **`Full Internet Block`**, **`YouTube Only`**, and **`Snoozed`** (and splits overnight rules such as `21:00`–`07:00` across adjacent days). Clicking a bar segment opens that rule's Edit modal.
4. - [pass] Open **`Edit`** on your test schedule and verify you can now switch **Target Type** (`Group` <-> `Device`) and pick a different target directly inside the edit modal, plus switch between **`Full Internet`** and **`YouTube Only`**.
5. - [pass] Click **`Clone / Duplicate`** on a schedule card and confirm a `(Copy)` rule is created immediately in SQLite and appears in both the card grid and the weekly timeline.
6. - [pass] Test **`Snooze / Skip`**: on an enabled schedule card, click **`Snooze 30m`** (or `1h` / `Skip Window`), verify the `Snoozed until ...` badge appears and its timeline segment switches to the muted Snoozed style, then click **`Clear Snooze`** (and optionally delete your test schedules when finished).

---

## 3. User Validation Feedback

Please record your verification observations, feedback, and notes below:

```markdown
### Verification Results:
- [pass] Section A: Devices Tab — Collapsible Groups & Compact Group Card Actions (`FB-P17-001`): (PASS / NOTES)
- [pass] Section B: Devices Tab — Unified Actions Column, Column Sorting, `+ Group` Popover & Archive/Restore/Delete (`FB-P17-002`): (PASS / NOTES)
- [pass] Section C: Analytics Drawers — Compact Header Icons & Embedded Timer (`FB-P17-003`): (PASS / NOTES)
- [pass] Section D: Schedules Tab — `YouTube Only` Mode, Editable Target, Clone, Weekly Timeline, Snooze & Auto-Refresh (`FB-P17-004` & `FB-P17-005`): (PASS / NOTES)

### User Observations / Feature Requests:
- When a Device Group is created, allow for a time limit for viewing. Meaning, be able to set a 1 hour a day limit for YT access so that no more than 1hr of YT time can be used. Reward functions can still be used to grant additional time. Reward functions should always take precendence over all other limits

- Whe on a mobile screen displaying only buttons at the bottom, for the devices tab, only show the Device/Friendly name and the buttons to interact with the device. This will keep the table compact and the buttons present without the need to scroll left / right

- For Devices view, default to showing Online items only, not all, on first load. Remember selection afterwards.
```
