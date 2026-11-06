# Phase 10 (`v1.0.4`) — Gate 2 Live UI Validation Checklist & Feedback (`PHASE10-Verify.md`)

> **Release Target:** `v1.0.4` (Phase 10 of the `v1.1` Release Roadmap)  
> **Container Endpoint:** `http://localhost:8080`  
> **Gate Status:** `COMPLETE — APPROVED BY USER (2026-11-06)`

---

## 1. Pre-Validation Automated Quality Gate & Container Smoke Test Summary

- **Backend (`pytest`, `ruff`, `mypy`):**
  - `121/121` tests passed (`100%` pass rate, **`85%`** total coverage; `firewall.py` `100%`, `elasticsearch.py` `95%`, `firewall_service.py` `90%`).
  - `ruff check backend`: **`0`** errors.
  - `mypy backend/app`: **`0`** issues across `31` source files.
- **Frontend (`vitest`, `tsc && vite build`):**
  - `27/27` tests passed across `7` test suites (`100%` pass rate, **`90.36%`** statement/line coverage; `FirewallPage.tsx` `93.14%`).
  - `tsc -b && vite build`: **`0`** TypeScript or bundle errors.
- **Live Single-Container Smoke Check (`http://localhost:8080`, `v1.0.4`):**
  - `GET /api/v1/system/health` reports `version: "1.0.4"`, `overall_status: "healthy"`.
  - `GET /api/v1/firewall/overview?window=24h` returns live Elasticsearch 9.4.3 `filterlog` telemetry (`es_reachable: true`, `~645k` total firewall packets in `24h`, `~513k` passed, `~131k` blocked (`20.4%`), `25` timeline buckets, `12` noisy internal LAN devices correlated with SQLite device inventory, `6` blocked external WAN scanner IPs, `0` unintended inbound open WAN ports after excluding local DHCP broadcast `0.0.0.0 -> 255.255.255.255:67` in `BUG-P10-003`, and `80` searchable chronological `filterlog` events).

---

## 2. What to Verify at `http://localhost:8080` (`v1.0.4`)

### 1. New `Firewall & Security` Navigation Tab & Header Controls (`FB-P10-001`)
- [PASS ] Open `http://localhost:8080`, sign in, and verify the top header displays **`v1.0.4`** and the new **`Firewall & Security`** tab between `Traffic & DNS Analytics` and `System Connectivity`.
- [PASS ] Click **`Firewall & Security`** and verify the time window selector (**`Last 1h`**, **`Last 24h`**, **`Last 7d`**, **`Last 30d`**), the **Refresh Firewall** button, and the **`Updated: HH:MM:SS`** timestamp directly underneath the Refresh button (`FB-P8-007`).

### 2. Firewall Activity KPI Summary Cards & Timeline Bar Graph (`FB-P10-001`, `FB-P8-003`, `FB-P8-004`, `FB-P8-005`)
- [PASS ] Verify the 4 KPI summary cards at the top of the `Firewall & Security` tab:
  1. **Total Firewall Packets** (with total byte volume for the selected window).
  2. **Passed Firewall Packets** (`pass` count in emerald).
  3. **Blocked Firewall Packets** (`block` count in rose, followed by the blocked traffic percentage **`(XX.X%)`**).
  4. **Direction Split & Open WAN Ports** (showing active open inbound WAN port count and `In: ... | Out: ...` packet split).
- [PASS ] Inspect the **Firewall Packet Timeline** bar chart and verify:
  - In **Stacked** mode, bars show **Allowed Packets** (emerald) and **Blocked Packets** (rose).
  - Clicking **Total** switches to total firewall packets per bucket.
  - Both vertical Y-axis (`Events`) and horizontal X-axis (`Time (XX Window)`) labels/ticks are clearly visible.

### 3. Security Insights Panel 1: Noisy LAN Devices (with 1-Click Block) & External WAN Scanners (`FB-P10-001`)
- [PASS with Notes] Inspect the left Security Insights panel (**Noisy LAN Devices & External Scanners**):
  - Under **Internal LAN Devices Generating Blocked Packets**, verify internal LAN devices are enriched with their friendly SQLite display names/hostnames, IP address, blocked packet count, byte volume, and targeted destination ports.
  - Verify each non-protected LAN device linked to the SQLite inventory displays a 1-click **Block Device** (or **Unblock Device**) button so you can immediately block a noisy or misbehaving LAN device from the Firewall view.
  - Under **Top Blocked External WAN Scanners**, verify external public WAN source IPs blocked at the perimeter are listed with their ASN organization (when available), probed ports, and blocked packet counts.

### 4. Security Insights Panel 2: Active Inbound WAN Exposure (Open Ports) (`FB-P10-001`)
- [FAIL see Notes] Inspect the right Security Insights panel (**Active Inbound WAN Exposure (Open Ports)**):
  - Verify it audits inbound traffic from public non-RFC1918 WAN source IPs where `event.action == "pass"` to internal LAN destination `IP:Port` pairs.
  - Confirm that when no public WAN inbound ports are open/passed in the selected window, it displays the green **`No Open WAN Ports Detected` / `Zero Inbound Public WAN Connections Passed`** confirmation state (or lists the target device/IP, `:port / protocol`, passed packet count, byte volume, and unique external source IP count if any port forwards are active).

### 5. Searchable & Filterable Firewall Packet Log Explorer (`FB-P10-001`)
- [Pass with Notes ] Scroll to the **Searchable Firewall Packet Log Explorer** at the bottom of the `Firewall & Security` tab:
  - Verify the chronological packet table displays `Timestamp`, `Action` (`pass`/`block` badge), `Dir` (`inbound`/`outbound`), `Interface` (`vtnet0`/`vtnet1`), `Proto` (`TCP`/`UDP`/`ICMP`...), `Source` (`IP:Port` + friendly device name or ASN org), `Destination` (`IP:Port` + friendly device name or ASN org), and `Bytes`.
  - Test the filter controls:
    - **Search input:** Type an IP address, port (e.g., `443` or `53`), interface (`vtnet0` or `vtnet1`), or ASN name.
    - **Action filter:** Switch between `All Actions`, `Passed Only`, and `Blocked Only`.
    - **Direction filter:** Switch between `All Directions`, `Inbound`, and `Outbound`.
    - **Protocol filter:** Switch between `All Protocols`, `TCP`, `UDP`, `ICMP`, `IPv6-ICMP`, and `IGMP`.

---

## 3. User Validation Feedback
*(Please record your verification results, observations, and any change requests below, then notify the agent when review is complete.)*

### Requested Reviews
1. **New `Firewall & Security` Navigation Tab & Header Controls (`FB-P10-001`):**
   - New page shows but the refresh button is under the time selector instead of on the same row to the right of it as it is on all the other pages
   - During the auto refresh of the elasticsearch data, it occasionally times out. Suggestion to solve this in the feature requests section.
2. **Firewall Activity KPI Summary Cards & Timeline Bar Graph (`FB-P10-001`):**
   - No feedback
3. **Noisy LAN Devices (with 1-Click Block) & External WAN Scanners (`FB-P10-001`):**
   - When changing the search functions for the Searchable Firewall Packet Log Explorer, the Noisy LAN devices data will disappear. It seems the filter is applying to data outside of the intended window.
4. **Active Inbound WAN Exposure / Open Ports (`FB-P10-001`):**
   - All of the data seems present and correct except for open WAN ports. I know I have open WAN ports for port forwarding as they are listed under Firewall->NAT->Destination NAT in the OPNsense UI. There should be 3 open ports shown.
5. **Searchable & Filterable Firewall Packet Log Explorer (`FB-P10-001`):**
   - Changing any of the drop down selection items will also remove all the data from the other viewable boxes on the page. For example, all Noisy LAN Devices data disappears when changing the Action filter. The searchable filters should only apply to the data in the searchable firewall packet log explorer.

### Additional Feedback / Observations
- 

### Feature Requests
- For all areas that use a refresh button to get data that automatically refreshes at some interval, instead add a small button next to the refresh button that allows the user to toggle auto refresh of the data and set the refresh interval at the users preference.  This could be a simple dropdown with the following options: off, 5 seconds, 30 seconds, 1 minute, 5 minutes.

---

## 4. Option A Resolution Summary (`v1.0.4` Rebuilt & Ready for Re-Verification)

All 3 observed bugs (`BUG-P10-004`, `BUG-P10-005`, `BUG-P10-006`) and the Auto-Refresh Interval Selector feature request (`FB-P10-002`) have been implemented, unit-tested (`121/121` backend tests, `27/27` frontend tests), and deployed to the running `v1.0.4` container at `http://localhost:8080`:

1. **Header Refresh Button Alignment & Auto-Refresh Interval Selector (`BUG-P10-004` + `FB-P10-002`):**
   - Added `<AutoRefreshSelector />` (`Auto: Off`, `Auto: 5s`, `Auto: 30s`, `Auto: 1m`, `Auto: 5m`, persisted in `localStorage`) directly next to the Refresh button across **`Firewall & Security`**, **`Traffic & DNS Analytics`**, **`Devices & Access Control`**, **`Schedules & Bedtime`**, **`System & Admin`**, and both **Device / Group Analytics Drawers**.
   - Updated the `Firewall & Security` header toolbar to keep the Time Window Selector, Auto-Refresh dropdown, and `Refresh Firewall` button aligned on the **same horizontal row**.
2. **Searchable Firewall Packet Log Explorer Filter Isolation (`BUG-P10-005`):**
   - Moved `Action`, `Direction`, `Protocol`, and `Search` filters out of `query.bool.filter` into Elasticsearch's top-level **`post_filter`** clause in `build_firewall_overview_query()`.
   - Changing any filter in the **Searchable Firewall Packet Log Explorer** now filters **only** the packet table at the bottom of the page while keeping **KPI Cards**, **Firewall Packet Timeline**, **Noisy LAN Devices & External Scanners**, and **Active Inbound WAN Exposure (Open Ports)** untouched.
3. **Active Inbound WAN Exposure (3 OPNsense Destination NAT Ports) & Fast Query Optimization (`BUG-P10-006`):**
   - Updated `inbound_wan_passed` in `build_firewall_overview_query()` to capture external public WAN (`!RFC1918`) packets passed by OPNsense Destination NAT (`rdr`) rules exiting `vtnet1` toward internal RFC1918 hosts. All **3 configured Destination NAT port forwards** (`:32400/TCP` on two internal servers and `:51820/UDP` on one internal server) now appear in **Active Inbound WAN Exposure (Open Ports)** with their friendly device names, passed packet counts, byte volumes, and unique external source counts.
   - Optimized the Elasticsearch query (`track_total_hits: False`, `execution_hint: "direct"`, streamlined CIDR terms), cutting query execution time from `6-10s+` down to **`0.16s-0.52s`** across `1h`, `24h`, `7d`, and `30d` so auto-refresh no longer times out.

## 5. Option A Gate 2 Re-Verification (http://localhost:8080)

Please refresh http://localhost:8080 and verify:

1. [PASS with notes] The Time Window Selector, Auto: 30s dropdown (Off, 5s, 30s, 1m, 5m), and Refresh Firewall button sit on the same horizontal row in the header (and the Auto selector appears next to Refresh buttons across the other tabs/drawers).
2. [PASS with notes] Active Inbound WAN Exposure (Open Ports) displays all 3 Destination NAT port-forward rules (:32400/TCP and :51820/UDP).
3. [PASS with notes] Changing Action, Direction, Protocol, or Search in the Searchable Firewall Packet Log Explorer updates only the packet table at the bottom while Noisy LAN Devices & External Scanners and Active Inbound WAN Exposure stay populated.

## Feedback and observations
1. Remove the auto refresh button from the schedules and bedtime pages, we only need the refresh button for this page.
2. For the refresh selector button, get rid of the "Auto:" text and just have the button have the icon and the timeframe value.
3. In the firewall and security tab, changing the searchable filter between blocked, passed and all is still changing the values shown in the noisy LAN and External Scanners panel. It is not as bad as it was before, but it is still happening.
4. In the firewall and security tab, while the Active Inbound drawer is showing the correct information, it is not showing the full mappings. Instead it shows the redirect port but not the incoming port. The OPEN PORT column should show the full mapping, so 32401:32400 for example. 

---

## 6. Round 2 Gate 2 Updates & Re-Verification (`v1.0.4` Rebuilt at `http://localhost:8080`)

All 4 items from the Section 5 feedback have been implemented, unit-tested (`121/121` backend tests, `27/27` frontend tests), and deployed to the rebuilt `v1.0.4` container:

1. **Removed Auto-Refresh Selector from `Schedules & Bedtime` Page:**
   - Removed `<AutoRefreshSelector />` from [`frontend/src/pages/SchedulesPage.tsx`](../../../frontend/src/pages/SchedulesPage.tsx) so only the manual `Evaluate Policies Now` refresh button is displayed on that page.
2. **Compact Auto-Refresh Button Label (Timer Icon + Timeframe Value Only):**
   - Updated [`frontend/src/components/AutoRefreshSelector.tsx`](../../../frontend/src/components/AutoRefreshSelector.tsx) to remove the `"Auto: "` prefix so the button renders only the timer icon and timeframe value (`Off`, `5s`, `30s`, `1m`, `5m`).
3. **Strict Snapshot Locking for `Noisy LAN Devices & External Scanners` (`BUG-P10-007`):**
   - **Root Cause:** Each filter combination had its own React Query key and 15s backend TTL cache entry (`firewall:{win}:{action}:{dir}:{proto}:{search}`). Switching between `All`, `Passed`, and `Blocked` after 15 seconds caused the UI to swap between point-in-time Elasticsearch snapshots taken at different timestamps.
   - **Fix:** Locked window-level aggregations (`summary`, `timeline`, `noisy_lan_sources`, `external_scanners`, `open_wan_ports`) to a window-only snapshot (`firewall_window:{win_key}`) in [`backend/app/services/firewall_service.py`](../../../backend/app/services/firewall_service.py) and `windowSnapshots[windowKey]` in [`frontend/src/pages/FirewallPage.tsx`](../../../frontend/src/pages/FirewallPage.tsx). Toggling `Action`, `Direction`, `Protocol`, or `Search` now strictly updates **only** `recent_events` in the bottom packet table while keeping the top panels 100% locked until you switch the time window or click `Refresh Firewall`.
4. **Full `incoming_port:redirect_port` Mapping in `Active Inbound WAN Exposure (Open Ports)` (`BUG-P10-008`):**
   - Added `OPNsenseClient.get_destination_nat_mappings()` in [`backend/app/clients/opnsense.py`](../../../backend/app/clients/opnsense.py) and `external_port` / `port_mapping` resolution in [`backend/app/services/firewall_service.py`](../../../backend/app/services/firewall_service.py) and [`frontend/src/pages/FirewallPage.tsx`](../../../frontend/src/pages/FirewallPage.tsx).
   - The **Open Port** column now renders the full `external_port:destination_port` mapping: **`32400:32400 / TCP`**, **`32401:32400 / TCP`**, and **`51820:51820 / UDP`**.

### Round 2 What to Re-Verify at `http://localhost:8080`
- [PASS] **1. `Schedules & Bedtime` Page:** Confirm the auto-refresh selector is removed and only the manual refresh button remains.
- [PASS] **2. Auto-Refresh Selector Button:** Confirm the selector button next to Refresh buttons displays only the timer icon and timeframe (`Off`, `5s`, `30s`, `1m`, `5m`) without `"Auto:"`.
- [PASS] **3. `Noisy LAN Devices & External Scanners` Stability (`BUG-P10-007`):** In `Firewall & Security`, toggle the Searchable Firewall Packet Log Explorer `Action` dropdown repeatedly between `All Actions`, `Passed Only`, and `Blocked Only` (even after waiting 15–30 seconds) and confirm the counts in **Noisy LAN Devices** and **External Scanners** do not change at all.
- [PASS] **4. Full Port Mappings in `Active Inbound WAN Exposure (Open Ports)` (`BUG-P10-008`):** Confirm the **Open Port** column displays **`32400:32400 / TCP`**, **`32401:32400 / TCP`**, and **`51820:51820 / UDP`**.

### Round 2 User Re-Verification Feedback
- None


