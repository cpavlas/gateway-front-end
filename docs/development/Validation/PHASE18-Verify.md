# Phase 18 (`v1.3.0-rc3`) Live UI Validation Checklist (`PHASE18-Verify.md`)

**Branch:** `phase18`  
**Version / Build Tag:** `v1.3.0-rc3` (`1.3.0-rc3`)  
**Container Deployment:** `http://localhost:8080` (`gateway-front-end:latest`)  
**Date:** `2026-11-14`

---

## 1. Automated Pre-Validation Quality Gate Summary

| Quality Gate | Tooling / Command | Verification Criteria | Status | Results |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Unit & API Suite** | `.\backend\.venv\Scripts\pytest.exe backend/tests --cov=app` | 100% pass rate & `>= 85%` coverage | **PASS** | `149 passed, 1 warning in 41.39s` (`TOTAL 6883 stmts, 1046 miss, 85%` coverage) |
| **Backend Lint & Static Analysis** | `.\backend\.venv\Scripts\ruff.exe check backend` | `0` lint/style/security errors | **PASS** | `All checks passed!` (`0` errors) |
| **Backend Static Type Checker** | `.\backend\.venv\Scripts\mypy.exe backend/app` | `0` strict typing errors | **PASS** | `Success: no issues found in 33 source files` |
| **Frontend Unit & Component Suite** | `npm test` (`vitest run --coverage`) | 100% pass rate & `>= 85%` coverage | **PASS** | `Test Files 10 passed (10)`, `Tests 37 passed (37)` in `22.27s` (`90.99%` line/statement coverage) |
| **Frontend TypeScript & Build** | `npm run build` (`tsc -b && vite build`) | `0` TypeScript errors & clean bundle | **PASS** | Exited `0`, `✓ built in 3.45s` (`1658 modules transformed`, `dist/index.html 0.87 kB`) |
| **Container Image Rebuild** | `docker compose -f docker/docker-compose.yml --env-file .env up -d --build` | Single-container image rebuilt & restarted | **PASS** | `gateway-front-end:latest` built (`3.70s` container Vite build) & recreated |
| **Container Healthcheck** | `docker ps --filter "name=gateway-front-end"` | Container `Up` and `(healthy)` on port `8080` | **PASS** | `Up ... (healthy)`, `0.0.0.0:8080->8000/tcp` |
| **Live HTTP Smoke Endpoints** | `curl.exe` on `http://localhost:8080` | SPA serves HTTP `200`, `/ping` matches version, `/health` enforces auth (`401`) | **PASS** | `/` HTTP `200` (`/assets/index-CTTWAfnu.js`); `/api/v1/system/ping` -> `{"status":"ok","version":"1.3.0-rc3"}`; unauthenticated `/api/v1/system/health` HTTP `401` |
| **SQLite Schema & Upstream Health Probe** | In-container Python probe (`docker exec -i gateway-front-end python -`) | Phase 18 SQLite columns/tables & all upstream services `healthy` | **PASS** | Confirmed `device_groups.daily_youtube_limit_minutes` & `blocked_targets` table; SQLite `healthy` (`110.71 ms`, `3.10 MB`, `74` devices, `1` group, `6267` audit logs, `0` custom blocks); OPNsense `healthy` (`292.47 ms`, ARP/Dnsmasq/alias verified); Elasticsearch `healthy` (`118.44 ms`, `9.4.3`, cluster `green`, `22,965,464` docs in `logs-pfsense.log*`); Plex `healthy` (`11.44 ms`, `1.43.5.11079-b3b13e506`, `1` active session) |
| **Phase 18 Telemetry & Attribution Probe** | In-container `analytics_service` & `PlexServiceClient` live query (`window="24h"`) | 8 app telemetry keys, ASN metadata, attribution drilldown, & live Plex stream fields | **PASS** | `es_reachable: True`; all `8` app keys returned (`youtube`, `plex`, `netflix`, `disney_plus`, `twitch`, `tiktok`, `discord`, `gaming`); `36` top devices, `12` top domains, `12` top orgs (`12/12` with `asn`); sample domain attribution (`134,064` events, `8` clients) & ASN attribution (`30,518` bytes, `166` events, `4` clients); Plex `fetch_active_sessions()` returned `1` `playing` episode (`720p`, `transcode`, `36.6%` progress, `3976` kbps / `3786` kbps) |

---

## 2. What to Verify at `http://localhost:8080`

Please sign in to `http://localhost:8080` and verify each deliverable below:

### Section A — Devices Tab: Default Online Filter Persistence & Mobile-Compact Table (`FB-P17-007`, `FB-P17-008`)
- [pass] **Default `Online` Filter on Clean Load:** Clear site storage (or open a fresh incognito/private window), sign in, and navigate to **Devices**. Confirm the `Online` filter pill (`filter-pill-online`) is highlighted by default and the table shows only online devices rather than all offline historical devices.
- [pass] **`localStorage` Filter Persistence Across Reloads:** Click **All**, **Blocked**, or **Protected**, then refresh the browser (`F5`). Confirm the selected filter pill remains active after reload (`gateway_devices_status_filter` in `localStorage`).
- [pass] **Mobile-Compact Viewport Columns (`< 640px`):** Open DevTools responsive/device mode (e.g., `390px` phone width) on the **Devices** tab. Confirm secondary columns (**IPv4 & MAC**, **Vendor & Interface**, **Guardrail**) hide cleanly via responsive layout (`hidden sm:table-cell`) so device name/online status and quick **Actions** remain readable without cramped horizontal scrolling, then resize back to desktop (`>= 640px`) and confirm all columns reappear.

### Section B — Device Groups: Daily YouTube Viewing Time Quota & Override Precedence (`FB-P17-006`)
- [pass] **Group Daily YouTube Quota Configuration:** On **Devices**, click **New Group** (or the Edit icon on an existing non-protected test group). Verify the Daily YouTube quota preset selector (`group-daily-youtube-limit-select`) and custom minutes input (`group-daily-youtube-limit-input`, `1–1440` minutes) appear cleanly in the modal and save any valid custom minute value (such as `45` or `12`) without HTML5 validation issues.
- [pass] **Group Card Badge & Drawer Progress Banner:** Confirm the group card displays the `YT Today: Xm / Ym` badge (`group-youtube-quota-badge-*`), and clicking **Analytics** opens `GroupAnalyticsDrawer` showing the **Daily YouTube Quota** progress bar, remaining minutes, and percentage consumed.
- [partial] **Quota Auto-Enforcement & Override Precedence:** For a test group whose quota is lower than or reached by today's YouTube minutes (note: automatic enforcement waits until the background poll/quota check evaluates), verify `Quota Reached` displays cleanly and YouTube access enforces as expected, while granting a temporary YouTube **Allow** Reward/Bonus timer or manual **Unblock** keeps YouTube allowed without immediately re-blocking until the timer/override ends (or vice versa across midnight rollover).

### Section C — Expanded 8-App Telemetry & Enhanced Plex Now Playing Cards (`FB-P18-002`)
- [pass] **8 Application Telemetry Cards:** Open **Analytics** (Network Overview) and confirm the Application Usage grid displays all **8** applications: **YouTube**, **Plex**, **Netflix**, **Disney+**, **Twitch**, **TikTok**, **Discord**, and **Gaming** — each showing `Active Time`, `DNS Queries`, `Bandwidth`, and last active timestamp/attribution.
- [pass] **Device & Group Drawer 8-App Parity:** Open any active device's **Inspect** analytics drawer (`DeviceAnalyticsDrawer`) and any group's **Analytics** drawer (`GroupAnalyticsDrawer`) and confirm the same 8 application categories appear cleanly inside both drawers.
- [pass] **Enhanced Plex `Now Playing` Card (`1` live stream observed during smoke check):** While an active Plex stream is playing, verify the **Plex** card shows the green `N Now Playing` live badge and amber **Active Plex Streams** panel (`overview-plex-now-playing`) rendering device name + formatted media title (`Show · SxxExx · Episode`), `state · stream_decision` pill (`PLAYING · TRANSCODE` or `DIRECT PLAY`), user/player + resolution (`720p` / `1080p` / `4K`), live bitrate (`kbps` / `Mbps`), and playback progress bar (`progress_percent%`). Check the streaming device's `DeviceAnalyticsDrawer` for matching per-device `Now Playing` details as well.

### Section D — Analytics Tab: Sortable/Searchable Top Active LAN Devices & Client Attribution Drilldown Modal (`FB-P18-003`)
- [pass] **`Top Active LAN Devices (RFC1918)` Search & Sorting:** On **Analytics**, type a partial device name, IP, or vendor into **Filter by name, IP, or vendor...** and confirm live filtering works without re-querying ES. Click column headers (**Device**, **IPv4 & Vendor**, **DNS Queries**, **Firewall Bytes**, **Total Events**) and verify ascending/descending sort toggles smoothly.
- [pass] **Click-to-Drilldown on Domain / Registered Domain / Organization (ASN):** Click any entry under **Top DNS Domains**, **Top Registered Domains**, or **Top Destination Organizations (ASN)**. Confirm the **Client Attribution** modal opens (`attribution-drilldown-modal`) listing Total Events, Total Bytes, and every LAN client that generated traffic for that target.
- [pass] **Inspect Client from Attribution Modal:** Click **Inspect** next to any mapped device in the attribution modal table and confirm the modal closes and transitions directly into that device's `DeviceAnalyticsDrawer`.

### Section E — Analytics & Device Drawer: Domain / ASN Blocking, OPNsense Alias Sync & Panel Management (`FB-P18-001` / `FB-P4-007`..`009`)
- [pass] **Inline Domain / ASN Block Actions:** On **Analytics** (or inside the Client Attribution modal or `DeviceAnalyticsDrawer`), click **Block** on a test/disposable domain (or **Block Globally** / **Block Device** on a non-protected client) and verify a success banner appears, the target updates to **Blocked**, and the rule row appears in **Blocked Domains & ASN Organizations**.
- [pass] **Manual Custom Block Rule Form:** In **Blocked Domains & ASN Organizations**, test adding a manual rule (choose `Domain / Host` or `ASN (e.g. AS15169)`, scope `Global (All LAN)` or `Single Device`, and submit **Add Block Rule**). Verify OPNsense alias synchronization succeeds without errors.
- [pass] **Pause/Resume (`Active`/`Paused`) & `Unblock` Cleanup:** Toggle the rule status pill between **Active** and **Paused**, then click **Unblock** on your test rule(s) to remove them and confirm they disappear cleanly and resync with OPNsense. Also check the top-right badge (`X Custom Blocks Active`) updates accurately.

### Section F — System Tab: Live Upstream Health, Custom Block Count & Backup/Restore Preservation (`FB-P18-001`)
- [pass] **Live Connectivity Health & Custom Block Telemetry:** Open **System**, verify all four upstreams (**SQLite**, **OPNsense**, **Elasticsearch**, **Plex**) show healthy status, and verify `/api/v1/system/health` (`services.sqlite.details.custom_blocked_targets_count`) and the **Analytics** header pill (`X Custom Blocks Active`) reflect active custom block rule counts accurately.
- [pass] **Configuration Backup & Restore Custom Block Rules (`FB-P4-007..009`):** Click **Export Configuration JSON** under **Configuration Backup & Restore**, inspect the downloaded JSON to confirm `blocked_targets` rules (alongside `daily_youtube_limit_minutes` on groups) are included in the payload, and optionally verify restoring that JSON preserves custom block rules cleanly.

---

## 3. User Validation Feedback

Please record your verification observations, feedback, and notes below:

```markdown
### Verification Results:
- [pass] Section A: Devices Tab: Default Online Filter Persistence & Mobile-Compact Table (FB-P17-007, FB-P17-008): (PASS / NOTES)
- [partrial] Section B: Device Groups: Daily YouTube Viewing Time Quota & Override Precedence (FB-P17-006): (PASS / NOTES)
    - If a device group is configured to a daily limit, the limit is breached, YT is correctly blocked. If I use the add time function, this correctly re-enables YT. However, if I delete the daily limit value, and YT is already blocked from the previous setting, YT remains blocked. I would expect it to be unblocked if the daily limit is removed.
- [pass] Section C: Expanded 8-App Telemetry & Enhanced Plex Now Playing Cards (FB-P18-002): (PASS / NOTES)
    - When viewing the Application Usage Stats, add a feature such that clicking on one of the boxes will expand that card and show more details on that application. This will allow seeing more details on things like the full name of the show someone is watching on plex, which is obscured due to the box sizing in the current small format. 
- [pass] Section D: Analytics Tab: Sortable/Searchable Top Active LAN Devices & Client Attribution Drilldown Modal (FB-P18-003): (PASS / NOTES)
- [pass] Section E: Analytics & Device Drawer: Domain / ASN Blocking, OPNsense Alias Sync & Panel Management (FB-P18-001 / FB-P4-007..009): (PASS / NOTES)
- [pass] Section F: System Tab: Live Upstream Health, Custom Block Count & Backup/Restore Preservation (FB-P18-001): (PASS / NOTES)

### User Observations / Feature Requests:
- Analytics Tab: In the mobile view, change the Top Active LAN Devices to only show Deivce, Total Events and the Inspect labels so they fit on the screen.
- Refresh timer inconsistently working on some tabs:
    - Devices Tab: The sync timer never seems to trigger an update at any interval. Manual sync button does work
    - Scheduiles Tab: The sync timer appears to be working correctly
    - Analytics Tab: Timer fires what looks like a refresh, based on a quick flash of a loading indicator, but the data does not refresh and the Updated: time below the sync setting does not update unless you click the sync button
    - Firewall tab: Similar to the analytics tab, the timer setting appears to fire, but data is not updated. However, the Updated: label does properly update. Clicking the refresh button updates the data and the Updated: label correctly.
    - System Tab: Refresh timer appears to work correctly with the Updated: label updating correctly, and I can see the Round-trip latency times updating. 
- 8-App Telemetry: Add a settings area in System to configure what items are displayed for App Telemtry. By default, Plex and YT should be enabled, but the other options should be opt in. Additionally, add tracking for Facebook and Threads but keep Facebook and Threads as a single grouped item.
- User Panel (clicking on the user name drop down): Instead of a down chevron that opens a change password dialogue, instead create a center screen pop up to perform this procedure.
- System Tab: For the main telemtry items at the top of the screen (4 Vertical boxes), lets remove all the text that shows under the labels since this data mostly shows in the technical details. For example, currently for OPNsense Fireall, additional text is under the title that says OPNsense REST API... and more text is under that starting with OPNSense API. 
- Page Top Header: When in full page mode (not mobile), keep the top page header always showing so users do not have to scroll to the top of the screen to change which tab they are looking at. Mobile already does this by keeping the tabs at the bottom of the screen.
- System Tab: When clicking the test all connections button, the pop up should show the average ping time when there is more than one connection service configured in a group. For example, I have 3 Elasticsearch nodes, so where it shows OK (time), the time should be the average of the 3 nodes individual values. If there is only one item, like OPNSENSE, then just show that individual time.
```
