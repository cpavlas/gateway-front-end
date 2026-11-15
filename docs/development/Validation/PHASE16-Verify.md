# Phase 16 Live UI Validation Guide (`v1.3.0-rc1` — Round 2)

> [!NOTE]
> **Target Environment:** `http://localhost:8080` (`gateway-front-end`, version `1.3.0-rc1`)
> **Scope of Round 2 Re-Validation:** Resolves all Round 1 Gate 2 findings (`BUG-P16-003` ES `24h` query rounding error, `BUG-P16-004` YouTube block alias completeness + sync reconciliation + OPNsense `Destination / Invert` forensic diagnosis, Section B `Integration Settings` 6 UI refinements, and Section D header `Quick Search` button removal while keeping `Ctrl+K` / `Cmd+K`). Holistic Mobile Hamburger Redesign is logged separately as `FB-P16-006`.

---

## 1. Automated Pre-Validation Quality Gate Summary

| Quality Gate | Tooling / Command | Verification Criteria | Status | Results |
| :--- | :--- | :--- | :--- | :--- |
| **Backend Unit & API Suite** | `.\backend\.venv\Scripts\pytest.exe backend/tests --cov=app` | 100% pass rate, `>= 85%` coverage | **PASSED** | **135 passed in 18.63s** (`85%` coverage across `5,966` statements) |
| **Backend Lint & Static Analysis** | `.\backend\.venv\Scripts\ruff.exe check backend` | 0 errors | **PASSED** | `All checks passed!` (`0` lint errors) |
| **Backend Static Type Checker** | `.\backend\.venv\Scripts\mypy.exe backend/app` | 0 type issues | **PASSED** | `Success: no issues found in 33 source files` |
| **Frontend Unit & Component Suite** | `npm test` (`vitest run --coverage`) | 100% pass rate, `>= 85%` coverage | **PASSED** | **32 passed in 12.26s** across `8` test files (`91.1%` coverage) |
| **Frontend TypeScript & Build** | `npm run build` (`tsc -b && vite build`) | 0 TypeScript or bundle errors | **PASSED** | `1657` modules transformed; built in `1.62s` |
| **Container Image Rebuild** | `docker compose -f docker/docker-compose.yml --env-file .env up -d --build` | Single-container rebuild on `8080` | **PASSED** | Rebuilt `gateway-front-end:latest` (`1.3.0rc1`) and started `gateway-front-end` |
| **Container Healthcheck** | `docker ps --filter name=gateway-front-end` | Container status `Up ... (healthy)` | **PASSED** | `Up 33 seconds (healthy)` on `0.0.0.0:8080->8000/tcp` |
| **Backend Version Probe** | `GET /api/v1/system/ping` + `app.__version__` | `version == "1.3.0-rc1"` | **PASSED** | `200 OK` (`{"status": "ok", "version": "1.3.0-rc1"}`) |
| **Live Upstream Diagnostics** | In-container smoke checks (`health`, `analytics?window=24h`, `firewall?window=24h`, `test-all`, `devices/sync`, OPNsense YT aliases) | All upstream APIs & Round 2 fixes live-verified | **PASSED** | `health`: `overall_status: "healthy"` (`sqlite`: `38.39 ms`, `opnsense`: `276.07 ms`, `elasticsearch`: `62.92 ms`, `plex`: `11.92 ms`); `analytics 24h`: `200 OK` (`1,019,758` events, `es_reachable: true`); `firewall 24h`: `200 OK` (`544,128` packets, `es_reachable: true`); `test-all`: `overall_reachable: true` (OPNsense `1` node `250.38 ms`, ES `3` nodes `53.43/46.75/40.15 ms`, Plex `1` node `56.46 ms`); `gateway_youtube_domains`: `13/13` domains; `devices/sync`: `74` LAN devices reconciled |

---

## 2. What to Verify at `http://localhost:8080`

### Section A — Analytics & Firewall `Last 24h` Time Window Fix (`BUG-P16-003`) & ES Optimizations
- [pass] Navigate to **Analytics** (`/analytics` or `/`) and select **`Last 24h`** in the time window selector: verify data loads cleanly (`200 OK`) without any `[rounding '/' can only be used on single unit types [-24h/5m]]` Elasticsearch warning banner.
- [pass] Navigate to **Firewall** (`/firewall`) and select **`Last 24h`**: verify packet metrics, timeline buckets, Open WAN Ports, and Recent Firewall Events render cleanly with no ES parse error banner.
- [pass] Switch across **`15m`**, **`1h`**, **`Today`** (default), **`Last 24h`**, and **`Last 7d`** on both Analytics and Firewall to confirm all windows render consistently.

### Section B — System Health, Integration Settings UI Refinements (`FB-P16-005`) & `Test All Connections` Modal (`FB-P16-002`)
- [pass] Open **System** (`/status`) and locate the **Integration Settings** collapsible header (`toggle-integration-settings-btn`): confirm it uses a rotating `ChevronDown` toggle icon that smoothly expands and collapses the panel on repeat clicks.
- [pass] Expand **Integration Settings** and inspect **Elasticsearch Integration** and **Plex Media Server Integration**:
  - [pass] Verify multi-row URL inputs are displayed (one URL per row) with `+ Add URL` (`add-es-url-btn` / `add-plex-url-btn`) and per-row `Remove` buttons (`remove-es-url-btn-*` / `remove-plex-url-btn-*`), plus per-URL green/red connectivity indicator dots next to OPNsense, Elasticsearch node rows, and Plex node rows.
  - [pass] Confirm **Plex Media Server Integration** heading no longer displays `(Optional — Tautulli-Style Watch Telemetry)` and the friendly-name hint no longer displays `(e.g. LGwebOSTV)`.
- [pass] Click **Test All Connections**: verify parallel diagnostics run for OPNsense, Elasticsearch, and Plex and open results inside a **popup modal** (`all-connectivity-diagnostic-result`) showing per-service health cards and per-URL node statuses, and confirm the modal dismisses via both the header `X` button and footer `Close` button.
- [pass] Confirm per-URL green/red status dots inside the Integration Settings form update cleanly from `node_results` returned by connectivity tests.

### Section C — YouTube Block Remediation (`BUG-P16-004`)
> [!IMPORTANT]
> **Manual OPNsense Rule Action Required Before Testing YouTube Block:** Live packet-log forensics confirmed OPNsense LAN rule `f3e0be6e-8d08-4f11-99af-bd7b4eb18071` (`Reject` from `gateway_youtube_blocked_devices`) has **`Destination / Invert`** checked in OPNsense, which caused any device in `gateway_youtube_blocked_devices` to match every non-YouTube destination (DNS `:53` and general HTTPS). Before testing device YouTube blocking below, open **OPNsense -> Firewall -> Rules -> LAN**, edit rule `f3e0be6e-8d08-4f11-99af-bd7b4eb18071`, **uncheck `Destination / Invert`** so Destination is `gateway_youtube_domains` (not `!gateway_youtube_domains`), save, and click **Apply Changes**.

- [pass] After unchecking `Destination / Invert` in OPNsense, open the **Devices** view and click **Sync Now** (`POST /api/v1/devices/sync`): verify device `is_youtube_blocked` state matches OPNsense `gateway_youtube_blocked_devices` accurately.
- [pass] Toggle **YouTube Block** ON for a test device: verify general internet browsing and DNS remain fully operational while YouTube (`youtube.com`, `m.youtube.com`, `youtu.be`, `googlevideo.com`, `music.youtube.com`, `kids.youtube.com`, `yt3.ggpht.com`) is blocked cleanly.
- [pass] Toggle **YouTube Block** OFF on that test device and verify YouTube connectivity returns to normal.

### Section D — Navigation Header Cleanup (`Quick Search` Button Removal + `Ctrl+K` Shortcut)
- [pass] On Desktop across `/`, `/firewall`, `/plex`, `/status`, `/users`, and `/analytics/rules`, confirm the top header navigation bar no longer renders the `Quick Search` button (`header-quick-search-btn`).
- [pass] Press **`Ctrl+K`** (Windows/Linux) or **`Cmd+K`** (macOS) from the app and confirm the **Global Quick Search** modal still opens, returns matches across devices/domains/IPs, and closes with **`Esc`**.
- [pass] Confirm the separate **Mobile Responsive UI Redesign** (hamburger menu, zero horizontal overflow, core mobile dashboard/device controls focus) is logged as **`FB-P16-006`** in [`docs/development/FEATURE_BACKLOG.md`](../FEATURE_BACKLOG.md) for dedicated scheduling.

---

## 3. User Validation Feedback

Please record your verification observations, feedback, and notes below:

```markdown
### Verification Results:
- [pass] Section A: Analytics & Firewall Last 24h Time Window Fix & ES Optimizations: (PASS / NOTES)
- [pass] Section B: System Health, Integration Settings UI Refinements & Test All Modal: (PASS / NOTES)
  - Bug: When clicking the save integration settins button, a "Request failed with status 500" error is reported in the panel. However, the settings do seem to save as the UI updates to reflect the new settings.
- [pass] Section C: YouTube Block Remediation (After OPNsense Rule Invert Fix): (PASS / NOTES)
- [pass] Section D: Navigation Header Cleanup (Quick Search Removed + Ctrl+K Active): (PASS / NOTES)

### User Observations / Feature Requests:
- Feature Request: When viewing data that shows GEOIP location, make the location clickable such that it opens google maps in a new tab with the location centered and a marker at the location.
```

> [!NOTE]
> **Gate 3 Resolution Summary (`BUG-P16-005` & `FB-P16-007`):**
> - **`BUG-P16-005` (Fixed in `v1.3.0-rc1`):** Saving Integration Settings (`PUT /api/v1/system/settings`) committed successfully to SQLite but threw `HTTP 500` (`TypeError: can't compare offset-naive and offset-aware datetimes`) in `sync_runtime_cache_and_build_view()`. Fixed in `backend/app/services/runtime_settings_service.py` via `_normalize_utc_datetime()`, regression-tested (`135 passed` in `pytest`, `85%` coverage), rebuilt in `gateway-front-end`, and verified live (`200 OK` on repeated `PUT /api/v1/system/settings` calls).
> - **`FB-P16-007` (Scheduled for Phase 19 — `v1.3.0`):** Logged clickable GeoIP locations (opening Google Maps in a new tab centered with a marker pin) in [`docs/development/FEATURE_BACKLOG.md`](../FEATURE_BACKLOG.md) and [`PLAN.md`](../../../PLAN.md).
