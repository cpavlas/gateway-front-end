# Phase 13 (`v1.2.0-rc2`) Live UI Validation Checklist (`PHASE13-Verify.md`)

> **Deployment Under Test:** `gateway-front-end` single-container deployment at [`http://localhost:8080`](http://localhost:8080)  
> **Version:** `v1.2.0-rc2` (Git branch: `phase13`)  
> **Scope:** `FB-P11-003` (`BUG-P11-001`) — Elasticsearch Cold-Load Query Optimization, Timeout Tuning (`20.0s`), Parallel `_msearch` Consolidation (`FB-P11-008` Proposal B), Background `24h` Cache Pre-Warming (`FB-P11-008` Proposal A), and Automatic Runtime Upstream Error Audit Logging (`DIAGNOSTIC_ERROR` in `System` Audit & Event History).

---

## 1. Pre-Validation Automated Quality Gate & Live Benchmark Summary

| Quality Gate / Benchmark | Target | Result |
| :--- | :--- | :--- |
| **Backend Unit Tests & Coverage** (`pytest backend/tests --cov=app`) | `100%` pass, `>= 85%` coverage | **Passed (`124 / 124` tests, `85%` total coverage, `97%` on `elasticsearch.py`)** |
| **Backend Static Analysis** (`ruff check backend` & `mypy backend/app`) | `0` errors / `0` issues | **Passed (`0` errors, `0` issues across 31 source files)** |
| **Container Health & Version** (`/api/v1/system/health`) | `healthy`, `version == "1.2.0-rc2"` | **Passed (`Up (healthy)` on `0.0.0.0:8080->8000/tcp`, `v1.2.0-rc2`)** |
| **Live `Analytics` `24h` Warm Cache Latency** (`/api/v1/analytics/overview?window=24h`) | `< 50 ms` (Pre-warmed every 60s) | **`25.6 ms` (`1,278,038` events)** |
| **Live `Analytics` `24h` Forced Refresh (`?refresh=true` 3-Way `_msearch`)** | `< 2,000 ms` (Previously `13,621 ms`) | **`621.6 ms` (`21.9×` speedup over unoptimized `13.6s` query)** |
| **Live `Firewall` `24h` Warm Cache Latency** (`/api/v1/firewall/overview?window=24h`) | `< 50 ms` (Pre-warmed every 60s) | **`7.4 ms` (`743,381` packets)** |
| **Live Per-Device Analytics `_msearch` Consolidation** (`/api/v1/devices/{id}/analytics?window=24h&refresh=true`) | Single `/_msearch` round-trip | **`685.1 ms` (`78,506` events)** |

---

## 2. What to Verify at `http://localhost:8080`

### A. Version & Header Verification (`v1.2.0-rc2`)
- [PASS] **1. Header Version Badge:** Open [`http://localhost:8080`](http://localhost:8080) and confirm the top-left header displays **`v1.2.0-rc2`** inline with `Gateway Control`, alongside the live `HH:MM:SS` clock below it.

### B. `Analytics` Tab Speed, Multi-Window Responsiveness & Pre-Warmed Cache (`FB-P11-003`, `FB-P11-008` Proposals A & B)
- [PASS] **2. Instant `24h` Analytics Tab Load:** Click the **`Analytics`** tab in the top navigation bar. Confirm the default `24h` overview loads near-instantly (`~25 ms` from the background-warmed cache) with zero timeout warnings.
- [PARTIAL] **3. Fast Manual Refresh (`Refresh Analytics`) & Window Switching (`1h`, `24h`, `7d`, `30d`):**
  - Click **`Refresh Analytics`** on the `24h` view and observe that the forced live refresh completes in under 1 second (`~0.6s`) while briefly displaying the centered `Refreshing telemetry…` indicator.
  - Switch across **`1h`**, **`24h`**, **`7d`**, and **`30d`** time windows and confirm all windows load cleanly without timing out.
- [PASS] **4. Device & Group Analytics Drawers (`_msearch` Single-Round-Trip):**
  - Open **`Analytics`** on any active device (from `Devices` or `Top Active LAN Devices`) and on a Device Group card.
  - Confirm both the top KPI/timeline/domain aggregations and the bottom `Chronological Recent DNS Queries` table populate together in a single fast request.

### C. `Firewall` Tab Pre-Warmed Cache & `_msearch` Consolidation
- [PASS] **5. Instant `24h` Firewall Tab Load & Refresh:** Click the **`Firewall`** tab and confirm `24h` metrics, charts, noisy devices, external scanners, open WAN ports, and packet logs load immediately (`< 15 ms` from warm cache) and refresh smoothly when clicking **`Refresh Firewall`**.

### D. Runtime Upstream Error Audit Logging (`FB-P11-003` — `System` Tab)
- [PASS] **6. `Diagnostic Error` Filter in `System` -> `Audit & Event History`:**
  - Navigate to the **`System`** tab and scroll to **Audit & Event History**.
  - Verify the category filter dropdown includes **`Diagnostic Error`** (`DIAGNOSTIC_ERROR`), where any runtime Elasticsearch or OPNsense connection/timeout errors (`upstream.elasticsearch.error` / `upstream.opnsense.error`) are automatically recorded (deduplicated once per 60s per operation so outages never flood SQLite).

---

## 3. User Validation Feedback

> **Instructions:** Please record your verification results, observations, or any requested adjustments below and let me know when your review is complete.

- **Verification Status:** `REVIEWED`
[PARTIAL] **3. Fast Manual Refresh (`Refresh Analytics`) & Window Switching (`1h`, `24h`, `7d`, `30d`):
  - Much improved on load times. I was able to get timeouts occasionally on 30d window, but not consistently.

- **User Notes / Feedback:**
  - Start tracking load times for each window to store in the audit logs using a new audit label named PERFORMANCE_ANALYSIS.
  - In firewall tab, for the active WAN ports, add the ability to click on the number of external IP addresses count and have it open a side window, like analytics does, to show all the relevant details about the connected ip, including address, location, connection length  and whatever else is available from the data in the logs. This should be possible given how the pfSense firewall dashboard works in Kibana.

