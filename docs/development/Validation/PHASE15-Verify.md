# Phase 15 Live UI Validation Report (`PHASE15-Verify.md`)

> **Validation Target:** Single-container Dockerized deployment of `gateway-front-end` running `v1.2.0` at `http://localhost:8080`.  
> **Phase Scope:** Direct Plex Media Server API & Tautulli-Style Session / Playback History Integration (`FB-P9-005` / `FB-P11-008` Proposal C), Icon-Only Refresh Buttons across all views and drawers (`FB-P14-001`), Icon-Only Larger Mobile-Friendly Action Buttons in the `Devices` inventory list (`FB-P14-002`), Magnifying Glass Icon-Only `Inspect` button in `Analytics` Top Active LAN Devices (`FB-P14-003`), and Cleaned-Up Search Field Placeholder in the External Connection Side-Drawer (`FB-P14-004`).

---

## 1. Automated Pre-Validation Quality Gate Summary

All automated quality gates have passed with zero failures or regressions prior to live validation:

| Quality Gate | Tooling / Command | Verification Criteria | Status | Results |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Unit & API Suite** | `pytest backend/tests --cov=app` | 100% pass rate, `>= 85%` coverage | **PASSED** | **129 passed in 17.57s** (`85%` coverage across 33 backend modules) |
| **Backend Lint & Static Analysis** | `ruff check backend` | 0 errors | **PASSED** | Clean (`All checks passed!`, including flake8-bandit `S` rules) |
| **Backend Static Type Checker** | `mypy backend/app` | 0 type issues | **PASSED** | Clean (`Success: no issues found in 33 source files`) |
| **Frontend Unit & Component Suite** | `vitest run --coverage` | 100% pass rate, `>= 85%` coverage | **PASSED** | **30 passed across 7 test files** (`91.03%` statement/line coverage) |
| **Frontend TypeScript & Build** | `tsc -b && vite build` | 0 TypeScript or bundle errors | **PASSED** | Built in 1.85s (code-split vendor & route chunks, 0 warnings) |
| **Container Image Rebuild** | `docker compose up -d --build` | Single-container rebuild on `8080` | **PASSED** | Rebuilt image `gateway-front-end:latest`, recreated container |
| **Container Healthcheck** | `docker ps` | Container status `Up ... (healthy)` | **PASSED** | `Up (healthy)` on `0.0.0.0:8080->8000/tcp` |
| **Backend Version Probe** | `GET /api/v1/system/health` | `app_version == "1.2.0"`, `overall_status == "healthy"` | **PASSED** | Returned `1.2.0`, `overall_status: "healthy"` |
| **Live Upstream Diagnostics** | `OPNsense`, `Elasticsearch` & `Plex` API | Live upstream connectivity & runtime settings | **PASSED** | OPNsense: `healthy`, Elasticsearch: `healthy`, Plex Settings API: `verified` |

---

## 2. What to Verify at `http://localhost:8080`

Log in to `http://localhost:8080` and verify the following visual, interactive, and functional features delivered in Phase 15 (`v1.2.0`):

### Section A — Release `v1.2.0` Header Badge & Icon-Only Refresh Buttons Across All Views & Drawers (`FB-P14-001`)
- [ ] **Header Version Badge (`v1.2.0`):**
  - Verify the version badge in the top-left header brand block now displays **`v1.2.0`**.
- [ ] **Icon-Only Refresh Buttons Across All Main Tabs:**
  - **`Devices` Tab:** Verify the top-right sync button next to the Auto-Refresh selector now displays only the circular **Refresh Icon** (`<RefreshCw />`) without the text `Sync from OPNsense` (hovering shows `Sync device inventory from OPNsense`).
  - **`Schedules` Tab:** Verify the top-right refresh button next to the Auto-Refresh selector displays only the circular **Refresh Icon** without the text `Evaluate Policies Now`.
  - **`Analytics` Tab:** Verify the top-right refresh button displays only the circular **Refresh Icon** without the text `Refresh Analytics`.
  - **`Firewall` Tab:** Verify the top-right refresh button displays only the circular **Refresh Icon** without the text `Refresh Firewall`.
  - **`System` Tab:** Verify the top-right service status refresh button, the Integration Settings refresh button, and the Audit & Event History refresh button all display only the circular **Refresh Icon** without text labels.
- [ ] **Icon-Only Refresh Buttons Inside All Slide-Over Drawers:**
  - Open the **Device Analytics Drawer** (from `Devices` or `Analytics`), the **Group Analytics Drawer** (from a Group card on `Devices`), and the **Inbound WAN Port External IPs Drawer** (from `Firewall` -> click any `External IPs` badge).
  - Verify that the refresh button in the header of each drawer displays only the circular **Refresh Icon** without the text `Refresh Telemetry`.

### Section B — Icon-Only, Larger Mobile-Friendly Action Buttons in `Devices` Inventory List (`FB-P14-002`)
- [ ] **Per-Device Row Action Buttons (`Devices` Tab):**
  - Navigate to the **`Devices`** tab and inspect the **Network Device Inventory & Internet Access Control** table.
  - Verify that all action buttons in each device row (`Telemetry`, `Timer`, and `Internet Access` columns) are now **icon-only** (no text labels) and sized larger (`h-9 w-9` / `36x36px` touch targets) for easy clicking/tapping on mobile and desktop:
    1. **Analytics (`Telemetry` column):** Displays only the bar-chart icon (`<BarChart3 />`). Clicking opens the Device Analytics slide-over drawer.
    2. **Timer (`Timer` column):** Displays only the clock/sparkles icon (`<Clock />` / `<Sparkles />`) inside a square button when idle, or compact active timer icon + countdown badge when a Pause/Bonus timer is running. Clicking opens the centered Timer modal.
    3. **YouTube Toggle (`Internet Access` column):** Displays the square YouTube play logo icon (`h-9 w-9`), bright red when YouTube is allowed and dim slate when YouTube is blocked.
    4. **Internet Access Toggle (`Internet Access` column):**
       - **Allowed devices:** Emerald square button with `<ShieldCheck />` icon (`title="Internet Allowed — Click to block internet access"`).
       - **Blocked devices:** Rose square button with `<ShieldOff />` icon (`title="Internet Blocked — Click to allow internet access"`).
       - **Protected infrastructure devices:** Amber square badge with `<Lock />` icon (`title="Always Allowed (Protected Infrastructure)"`).

### Section C — Magnifying Glass Icon-Only `Inspect` Button in `Analytics` (`FB-P14-003`)
- [ ] **Top Active LAN Devices Table (`Analytics` Tab):**
  - Navigate to the **`Analytics`** tab and scroll to the **Top Active LAN Devices** table.
  - In the rightmost **`Inspect`** column, verify that the text `Inspect` button has been replaced with an icon-only **Magnifying Glass (`<Search />`)** button.
  - Click the magnifying glass button for any device row and verify it opens that device's **Device Analytics Drawer**.

### Section D — External Connection Side-Drawer Search Placeholder Cleanup (`FB-P14-004`)
- [ ] **Clean Search Placeholder Text (`FirewallOpenPortSessionsDrawer`):**
  - Navigate to the **`Firewall`** tab and locate the **Active Inbound WAN Exposure (Open Ports)** panel.
  - Click any **`External IPs`** badge to open the **Inbound WAN Port External IPs & Sessions** side drawer.
  - Inspect the search input field at the top-right of the **Connected External IP Addresses (`source.ip`)** table.
  - Verify the placeholder text cleanly reads **`Filter by external IP, city, country, or ISP`** (and no longer ends with clipped `"or ISP/,"`).

### Section E — Direct Plex Media Server API & Tautulli-Style Telemetry Integration (`FB-P9-005` / `FB-P11-008` Proposal C)
- [ ] **Plex Media Server Configuration & Live Connectivity Test (`System` Tab):**
  - Navigate to the **`System`** tab and scroll to **Integration Settings (Runtime Override)**.
  - Verify there is a new **Plex Media Server (`X-Plex-Token` — Tautulli-Style Telemetry)** configuration card alongside OPNsense and Elasticsearch with fields for:
    - **Plex Base URL** (e.g., `http://<plex-ip>:32400`)
    - **Plex API Token (`X-Plex-Token`)** (masked password input; encrypted at rest in SQLite)
    - **Timeout (Seconds)** and **Verify TLS Certificate (`PLEX_VERIFY_SSL`)**
  - Enter your Plex Media Server URL and `X-Plex-Token`, click **Save Settings**, and click **Test Plex Connection**:
    - Verify the diagnostic banner reports **Connected** along with your Plex Server Friendly Name, Version, Active Streams count, and History Records count.
- [ ] **Tautulli-Style Plex Watch Time, Top Devices & Active Stream Details (`Analytics` Tab & Drawers):**
  - Navigate to the **`Analytics`** tab (or open a **Device / Group Analytics Drawer**) and inspect the **Application Usage Stats** panel (`Plex` card):
    - When Plex API is configured, verify a **`Tautulli API`** badge appears next to `Plex` (or `Active: N` badge when streams are currently playing).
    - Verify the **Top 3 Devices** list accurately reflects devices that watched Plex (including same-VLAN Smart TVs like `LGwebOSTV` whose local Layer-2 traffic previously bypassed OPNsense `filterlog`) with their exact watch time.
    - When a stream is actively playing on Plex, verify the **Now Playing** section inside the Plex card displays the active player name, media title, playback state (`playing` / `paused`), video resolution (`1080p` / `4K`), and stream decision (`Direct Play` / `Transcode`).

---

## 3. User Validation Feedback

Please record your verification observations, feedback, and notes below:

```markdown
### Verification Results:
- [PASS] Section A: Release v1.2.0 Header Badge & Icon-Only Refresh Buttons Across All Views & Drawers: (PASS / NOTES)
- [PASS] Section B: Icon-Only, Larger Mobile-Friendly Action Buttons in Devices Inventory List: (PASS / NOTES)
- [PASS] Section C: Magnifying Glass Icon-Only Inspect Button in Analytics: (PASS / NOTES)
- [PASS] Section D: External Connection Side-Drawer Search Placeholder Cleanup: (PASS / NOTES)
- [PASS] Section E: Direct Plex Media Server API & Tautulli-Style Telemetry Integration: (PASS / NOTES)

### User Observations / Feature Requests:
- 
```

