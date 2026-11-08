# Phase 15.1 (`v1.2.1`) Live UI Validation Report (`PHASE15_1-Verify.md`)

> **Validation Target:** Single-container Dockerized deployment of `gateway-front-end` running `v1.2.1` at `http://localhost:8080`.  
> **Phase Scope:** Fix missing idle open WAN ports (such as **WireGuard `51820:51820 / UDP`**) in the **Active Inbound WAN Exposure (Open Ports)** panel when viewing shorter time windows (`Today`, `1h`, `24h`) where `0` inbound packets arrived during that window (`BUG-P15-002`), and add **`Today`** (`today`, from `00:00:00` local timezone to now) as the **first** and **default** time window selector across all views and drawers (`FB-P15-001`).

---

## 1. Automated Pre-Validation Quality Gate Summary

All automated quality gates have passed with zero failures or regressions prior to live validation:

| Quality Gate | Tooling / Command | Verification Criteria | Status | Results |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Unit & API Suite** | `pytest backend/tests --cov=app` | 100% pass rate, `>= 85%` coverage | **PASSED** | **129 passed in 19.88s** (`85%` coverage across 33 backend modules) |
| **Backend Lint & Static Analysis** | `ruff check backend` | 0 errors | **PASSED** | Clean (`All checks passed!`, including flake8-bandit `S` rules) |
| **Backend Static Type Checker** | `mypy backend/app` | 0 type issues | **PASSED** | Clean (`Success: no issues found in 33 source files`) |
| **Frontend Unit & Component Suite** | `vitest run --coverage` | 100% pass rate, `>= 85%` coverage | **PASSED** | **30 passed across 7 test files** (`90.98%` statement/line coverage) |
| **Frontend TypeScript & Build** | `tsc -b && vite build` | 0 TypeScript or bundle errors | **PASSED** | Built in 1.96s (code-split vendor & route chunks, 0 warnings) |
| **Container Image Rebuild** | `docker compose up -d --build` | Single-container rebuild on `8080` | **PASSED** | Rebuilt image `gateway-front-end:latest`, recreated container |
| **Container Healthcheck** | `docker ps` | Container status `Up ... (healthy)` | **PASSED** | `Up (healthy)` on `0.0.0.0:8080->8000/tcp` |
| **Backend Version Probe** | `GET /api/v1/system/health` | `app_version == "1.2.1"`, `overall_status == "healthy"` | **PASSED** | Returned `1.2.1`, `overall_status: "healthy"` |
| **Live Open WAN Ports & `Today` Probe** | `GET /api/v1/firewall/overview?window=today` | `51820:51820 / UDP` present across `today`, `1h`, `24h`, `7d`, `30d` | **PASSED** | Verified `3` open ports (`32400:32400/TCP`, `32401:32400/TCP`, `51820:51820/UDP`) in all 5 windows |

---

## 2. What to Verify at `http://localhost:8080`

Log in to `http://localhost:8080` and verify the following fixes and enhancements delivered in Phase 15.1 (`v1.2.1`):

### Section A — Release `v1.2.1` Header Badge & `Today` Default Time Window Selector (`FB-P15-001`)
- [ ] **Header Version Badge (`v1.2.1`):**
  - Verify the version badge in the top-left header brand block now displays **`v1.2.1`**.
- [ ] **`Today` Filter as First & Default Time Window Across All Views & Drawers:**
  - **`Analytics` Tab:** Navigate to the **`Analytics`** tab and verify the time window selector bar shows **`Today`**, `Last 1h`, `Last 24h`, `Last 7d`, `Last 30d`, with **`Today`** selected by default on initial load.
  - **`Firewall` Tab:** Navigate to the **`Firewall`** tab and verify the time window selector bar shows **`Today`** as the first button and active default selection.
  - **Slide-Over Drawers (`Device Analytics`, `Group Analytics`, and `Inbound WAN Port External IPs`):** Open each drawer and verify **`Today`** is the first button in the time window selector bar and the default selection when opened directly.

### Section B — WireGuard (`51820:51820 / UDP`) Visibility in Active Inbound WAN Exposure Across All Time Windows (`BUG-P15-002`)
- [ ] **WireGuard (`51820:51820 / UDP`) Displayed in `Today`, `Last 1h`, `Last 24h`, `Last 7d`, and `Last 30d`:**
  - Navigate to the **`Firewall`** tab and inspect the **Active Inbound WAN Exposure (Open Ports)** panel.
  - Verify that on **`Today`**, **`Last 1h`**, and **`Last 24h`**, the **WireGuard (`51820:51820 / UDP`)** port row is now listed alongside the two Plex (`32400:32400 / TCP` and `32401:32400 / TCP`) rows (showing `0` passed packets and `0` external IPs when no WireGuard traffic occurred during that shorter window, rather than disappearing).
  - Switch to **`Last 7d`** and **`Last 30d`** and verify the WireGuard (`51820:51820 / UDP`) row updates to show its 7-day (`393` pkts) and 30-day (`891` pkts) passed packet counts and external IP counts.
- [ ] **Optional OPNsense Privilege for Direct Destination NAT Config Inspection (`docs/API_KEYS_SETUP.md`):**
  - If desired, in OPNsense (`System -> Access -> Groups -> gateway_controller`), add the **`Firewall: NAT: Port Forward`** privilege (documented in `docs/API_KEYS_SETUP.md` Step 1C #7) so OPNsense's `/api/firewall/d_nat/searchRule` endpoint can also supply newly created port-forward rules even before their first packet arrives.

---

## 3. User Validation Feedback

Please record your verification observations, feedback, and notes below:

```markdown
### Verification Results:
- [PASS] Section A: Release v1.2.1 Header Badge & Today Default Time Window Selector: (PASS / NOTES)
- [PASS] Section B: WireGuard (51820:51820 / UDP) Visibility in Active Inbound WAN Exposure Across All Time Windows: (PASS / NOTES)

### User Observations / Feature Requests:
- 
```

