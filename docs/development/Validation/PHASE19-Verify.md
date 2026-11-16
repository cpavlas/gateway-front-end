# Phase 19 Live Validation Checklist (`docs/development/Validation/PHASE19-Verify.md`)

> **Release Candidate:** `v1.3.0` (`phase19` branch — Final `v1.3.0` Release)  
> **Target Environment:** `http://localhost:8080` (`gateway-front-end` single-container deployment)  
> **Validation Protocol:** Complete checks below in order and record your results and any observations in **Section 3** (`User Validation Feedback`).

---

## 1. Automated Pre-Validation Quality Gate Summary

| Quality Gate | Tooling / Command | Verification Criteria | Status | Results |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Unit & API Suite** | `pytest backend/tests --cov=app` | 100% pass rate, `>= 85%` coverage | **PASSED** | `156 passed` in `25.60s` (`1` warning in discovery test); `85%` coverage (`7,324` statements) |
| **Backend Lint & Static Analysis** | `ruff check backend` | 0 errors | **PASSED** | `All checks passed!` (`0` errors) |
| **Backend Static Type Checker** | `mypy backend/app` | 0 type issues | **PASSED** | `Success: no issues found in 33 source files` (`0` issues) |
| **Frontend Unit & Component Suite** | `vitest run --coverage` | 100% pass rate, `>= 85%` coverage | **PASSED** | `11` test files / `45 passed` in `14.71s`; `91.12%` statements/lines (`AppLayout` `98.78%`, `Open Port Drawer` `95.22%`, `App Usage Modal` `94.89%`, `System` `93.46%`, `Devices` `92.74%`, `Firewall` `92.72%`, `GroupFormModal` `91.66%`, `Analytics` `90.45%`) |
| **Frontend TypeScript & Build** | `tsc -b && vite build` | 0 TypeScript or bundle errors | **PASSED** | `gateway-front-end-ui@1.3.0`, `1,659` modules transformed in `1.99s`, `0` errors |
| **Container Image Rebuild** | `docker compose up -d --build` | Single-container rebuild on `8080` | **PASSED** | Multi-stage image `gateway-front-end:latest` (`gateway-frontend-backend-1.3.0`) rebuilt & started cleanly |
| **Container Healthcheck** | `docker ps` | Container status `Up ... (healthy)` | **PASSED** | `gateway-front-end` verified `Up ... (healthy)` on `0.0.0.0:8080->8000/tcp`; `GET /` returned `200`, unauthenticated `/api/v1/system/health` returned `401` |
| **Backend Version & Alias Probe** | `docker exec python -` | `app.__version__ == "1.3.0"` & live WAN roundtrip | **PASSED** | `app.__version__ == "1.3.0"`, `/api/v1/system/health` `version == "1.3.0"`, OPNsense `get_alias_uuid("gateway_wan_blocked_ips")` HTTP `200` (`UUID_PRESENT: True`), live WAN block -> config-API & list verify -> unblock cleanup verified |
| **Live Upstream & Telemetry Sync Probe** | `OPNsense`, `Elasticsearch`, `Plex` & SQLite | Live upstream connectivity & runtime telemetry override sync | **PASSED** | `overall_status == "healthy"` — OPNsense `26.7.7` (`351.71 ms`), Elasticsearch `9.4.3` `green` (`3` nodes, `732` assigned shards, `23,573,147` docs, `83.45 ms`), Plex `healthy` (`17.16 ms`), SQLite `healthy` (`3.37 MB`, `6,540` records, `93.81 ms`); `update_telemetry_apps_settings` immediately updated `overview` analytics without `?refresh=true` and restored cleanly |

---

## 2. What to Verify at http://localhost:8080

### Section A — Sticky Desktop Header (`FB-P18-011`), Centered `Change My Password` Modal (`FB-P18-009`) & `v1.3.0` Badge *(Previously PASS)*
- [pass] Sign in at `http://localhost:8080` and confirm the header displays version `v1.3.0`.
- [pass] In desktop / full-page mode, scroll down any long tab (**Analytics**, **Firewall**, or **System**) and verify the top `<header>` bar remains pinned (`sticky top-0`) at the top of the viewport.
- [pass] Click your username in the top-right User Menu, open **Change My Password**, and verify the centered modal popup opens and closes cleanly.

### Section B — `System` Tab: Dynamic Version Header (`FB-P19-006`), Service Cards (`FB-P18-010`), Multi-Node Avg Ping (`FB-P18-012`) & Telemetry Visibility Sync (`BUG-P19-002`)
- [pass] Confirm the top 4 vertical Service Health Cards render cleanly without redundant status subtitles and average multi-node latency under **Test All Connections**.
- [pass] Under **"System Connectivity & Telemetry Status"**, verify the description text automatically interpolates the live connected **OPNsense** version (`26.7.7`) and **Elasticsearch** version (`9.4.3`) rather than static hardcoded strings.
- [pass] Scroll to **Application Telemetry Visibility** settings on the **System** tab:
  - [pass] Confirm **YouTube** and **Plex** are enabled initially and the remaining 7 categories (**Netflix**, **Disney+**, **Twitch**, **TikTok**, **Discord**, **Facebook & Threads**, **Gaming**) are selectable.
  - [pass] Toggle **Facebook & Threads** (and optionally other apps) ON, save settings (or rely on immediate persistence), switch to the **Analytics** tab **without forcing refresh**, and verify the newly enabled categories immediately render in **Application Usage Stats**, **Device Analytics Drawer**, and **Group Analytics Drawer**.
  - [pass] Reload the page and confirm the selection persists from SQLite across reloads; restore defaults afterward if desired.

### Section C — `Analytics` Tab & Drawers: Synced **Configure Apps** Modal (`FB-P19-004`), Detail Modal (`FB-P18-005`), Combined `Facebook & Threads` (`FB-P18-008`) & Mobile LAN Table (`FB-P18-006`)
- [pass] On **Analytics** -> **Application Usage Stats**, click the new **Configure Apps** button in the card header:
  - [pass] Verify a centered modal popup opens listing all 9 telemetry categories matching the current active selection.
  - [pass] Toggle categories inside the **Configure Apps** modal and save: verify **Application Usage Stats** (and Device/Group Drawers) update immediately, AND navigating back to **System** -> **Application Telemetry Visibility** reflects the exact same checkboxes.
- [pass] If **Facebook & Threads** is enabled, confirm it aggregates `facebook.com`, `fbcdn.net`, `instagram.com`, `threads.net`, `threads.com`, and Meta ASN traffic cleanly across Overview, Device Drawer, and Group Drawer.
- [pass] Click an application card (**Plex** or **YouTube**) to open the centered **Application Usage Detail Modal** and verify mobile LAN table responsive columns (`< 640px`).

### Section D — `Devices` & `Groups`: Auto-Unblock YouTube on Quota Removal (`FB-P18-004`), Unified Group Buttons (`FB-P19-007`) & Current Members Card (`FB-P19-008`)
- [pass] Quota removal / increase auto-unblocks eligible non-protected group members in OPNsense (`gateway_youtube_blocked_devices`).
- [pass] Inspect each **Device Group / Profile** card on the **Devices** tab and verify **Filter**, **Analytics**, **YouTube**, **Timer**, and **Internet** action buttons are all the exact same unified button size (`h-9 w-9` square icon buttons with `h-4 w-4` icons — matching the Timer button).
- [pass] Click **Edit Group** on any populated Device Group to open `GroupFormModal`:
  - [pass] Verify a compact **Current Group Members** card renders showing currently assigned devices with names/IPs and a 1-click **Remove** button per member.
  - [pass] Click **Remove** on a member, save (or inspect the updated assignment list), and verify the member is removed without having to scroll through the full assignment list.

### Section E — Cross-Tab Auto-Refresh Timer Execution & `Synced:` / `Updated: HH:MM:SS` Consistency (`FB-P18-007` / `BUG-P18-005`) *(Previously verified on Devices/Analytics/Firewall)*
- [pass] Set Auto-Refresh to **`5s`** across **Devices**, **Analytics**, and **Firewall** and verify periodic ticks refresh telemetry and advance `Synced:` / `Updated: HH:MM:SS`.

### Section F — `Firewall` Tab: Compact `Noisy LAN` Controls (`Inspect` Trigger) & Open WAN Port D-NAT Descriptions (`FB-P19-001`)
- [pass] On the **Firewall** tab under **Noisy LAN Devices**, verify Block/Unblock controls render as compact icon buttons alongside the Magnifying Glass (**Inspect**) button.
- [pass] Click **Inspect** on any noisy LAN device and verify `DeviceAnalyticsDrawer` opens directly over the **Firewall** tab.
- [pass] Inspect **Active Inbound WAN Exposure (Open Ports)** and verify friendly OPNsense D-NAT descriptions (e.g., `Plex Media Server`, `WireGuard VPN`) and `Last Seen` timestamps display cleanly for mapped ports.

### Section G — `Firewall` Tab & Drawer: OPNsense `gateway_wan_blocked_ips` Persistence (`BUG-P19-003`), **Blocked External WAN IPs** Card (`FB-P19-005`), GeoIP Google Maps Links (`FB-P16-007`) & `Block External IP at WAN` (`FB-P19-002`)
- [pass] Under **Top Blocked External WAN Scanners**, verify GeoIP badges, Google Maps links (`maps.google.com/?api=1&query=...`), click-to-filter IP actions, and the drawer Country Breakdown bar work as expected.
- [pass] On **Firewall**, verify the new **Blocked External WAN IPs (`gateway_wan_blocked_ips`)** card is displayed:
  - [pass] Test adding a public IPv4 address manually (e.g., a disposable public scanner IP from the Scanners card or Open Port Drawer), and verify validation rejects invalid or private RFC1918 LAN IPs.
  - [pass] Confirm in OPNsense **Firewall -> Aliases** that `gateway_wan_blocked_ips` exists automatically and now contains the newly blocked IP (persisted in config + `alias_util`).
  - [pass] Click **Block at WAN** from either **Top Blocked External WAN Scanners** or `FirewallOpenPortSessionsDrawer` and confirm it adds the IP to **Blocked External WAN IPs**, toggles state to **`Blocked at WAN`**, and syncs OPNsense.
  - [pass] Click an IP pill inside **Blocked External WAN IPs** to filter the Packet Log Explorer below.
  - [pass] Click the 1-click **Unblock** button on **Blocked External WAN IPs** (or inside the scanner/drawer controls) and verify the IP disappears from both the UI list and OPNsense `gateway_wan_blocked_ips`.

### Section H — `Firewall` Tab: Interactive Click-to-Filter Packet Log Explorer, Row Limits (`50`/`100`/`250`) & CSV / JSON Export (`FB-P19-003`) *(Previously PASS)*
- [pass] Clickable table cells (`Interface`, `Protocol`, `Source IP`, `Destination IP`, `Port`), stacked filter chips, row limits (`50`/`100`/`250`), and CSV/JSON exports verified.

---

## 3. User Validation Feedback

Please record your verification observations, feedback, and notes below:

```markdown
### Verification Results:
- [pass] Section A: Sticky Desktop Header, Centered Change My Password Modal & v1.3.0 Badge: (PASS / NOTES)
- [pass] Section B: System Tab — Dynamic Version Header, Service Cards, Avg Ping & Telemetry Visibility Sync: (PASS / NOTES)
- [pass] Section C: Analytics Tab & Drawers — Synced Configure Apps Modal, Detail Modal, Facebook & Threads & Mobile Table: (PASS / NOTES)
- [pass] Section D: Devices & Groups — Quota Auto-Unblock, Unified Group Buttons & Current Group Members Card: (PASS / NOTES)
- [pass] Section E: Cross-Tab Auto-Refresh Timer Execution & Clock Consistency: (PASS / NOTES)
- [pass] Section F: Firewall Tab — Compact Noisy LAN Inspect & Open WAN Port NAT Descriptions: (PASS / NOTES)
- [pass] Section G: Firewall Tab & Drawer — OPNsense `gateway_wan_blocked_ips` Persistence, Blocked WAN IPs Card, GeoIP & WAN Blocking: (PASS / NOTES)
- [pass] Section H: Firewall Tab — Click-to-Filter Packet Log Explorer, Row Limits & CSV/JSON Export: (PASS / NOTES)

### User Observations / Feature Requests:
- 
```
