# Phase 11 (`v1.1.0`) — Gate 2 Live UI Validation Checklist & Feedback (`PHASE11-Verify.md`)

> **Release Target:** `v1.1.0` (Phase 11 — Final Phase of the `v1.1` Release Roadmap)  
> **Container Endpoint:** `http://localhost:8080`  
> **Gate Status:** `COMPLETE — APPROVED BY USER (2026-11-06)`

---

## 1. Pre-Validation Automated Quality Gate & Container Smoke Test Summary

- **Backend (`pytest`, `ruff`, `mypy`):**
  - `121/121` tests passed (`100%` pass rate, **`85%`** total coverage).
  - `ruff check backend`: **`0`** errors.
  - `mypy backend/app`: **`0`** issues across `31` source files.
- **Frontend (`vitest`, `tsc && vite build`):**
  - `28/28` tests passed across `7` test suites (`100%` pass rate, **`90.70%`** statement/line coverage; `UnicornLogo.tsx` `100%`, `AppLayout.tsx` `98.67%`, `AuthContext.tsx` `90.0%`).
  - `tsc -b && vite build`: **`0`** TypeScript or bundle errors.
- **Live Single-Container Smoke Check (`http://localhost:8080`, `v1.1.0`):**
  - `GET /api/v1/system/health` reports `version: "1.1.0"`, `overall_status: "healthy"`.
  - `GET /unicorn-favicon.svg` returns `200 OK` (`image/svg+xml`) with the side-profile unicorn & rainbow horn SVG.
  - `PATCH /api/v1/auth/preferences` persists `theme_preference` (`default`, `crimson`, `ocean`) in SQLite (`User.theme_preference`) and returns the updated `AuthUserResponse`.

---

## 2. What to Verify at `http://localhost:8080`

### Item 1 — Custom Side-Profile Unicorn with Rainbow Horn Logo & Browser Favicon (`FB-P11-001`)
- [PASS] **1A. Browser Tab Favicon:** Open or refresh (`Ctrl+F5`) `http://localhost:8080` and verify that the browser tab displays the custom **side-profile Unicorn with a rainbow-colored horn** next to `OPNsense Gateway Control`.
- [PASS] **1B. Header & Login Brand Icon:** Verify that the top-left header brand badge (and the Login / First-Boot Setup screen if you log out) displays the side-profile Unicorn with a rainbow horn instead of the previous shield icon.

### Item 2 — Clickable Header User Name Menu & 3 Eye-Friendly Dark-Room Color Themes (`FB-P11-002`)
- [PASS] **2A. Clickable User Name in Header:** Click your signed-in username (`admin`) in the top-right header (to the left of the `Logout` button). Verify that a **User Preferences & View Theme** popover opens showing your username, role badge (`ADMIN`), and the **Color Theme** selector with 3 options:
  1. **`Default Slate`** (Deep slate & soft indigo accents)
  2. **`Crimson & Obsidian`** (Soft light/dark red & black surfaces)
  3. **`Ocean & Navy`** (Soft light/dark blue & deep navy)
- [PASS] **2B. Real-Time Theme Switching & Dark-Room Comfort:** Click each of the 3 themes (`Default Slate`, `Crimson & Obsidian`, `Ocean & Navy`) and navigate across tabs (`Devices & Access Control`, `Schedules & Bedtime`, `Traffic & DNS Analytics`, `Firewall & Security`, `System Connectivity`). Confirm that the background surfaces, borders, active tab highlights, and buttons update immediately and remain comfortable on the eyes in a dark room without harsh neon glare.
- [PASS] **2C. Per-User Theme Persistence:** Select **`Crimson & Obsidian`** or **`Ocean & Navy`**, refresh the browser page (`F5`), and verify that your selected theme stays active across page reloads and re-logins.

---

## 3. User Validation Feedback
*(Please record your verification results, observations, and any change requests below, then notify the agent when review is complete.)*

### Requested Reviews
1. **Unicorn Side-Profile with Rainbow Horn Logo & Browser Tab Favicon (`FB-P11-001`):**
   - No Feedback
2. **Clickable Header User Name Menu & 3 Eye-Friendly Color Themes (`FB-P11-002`):**
   - No Feedback

### Additional Feedback / Observations
- Sometimes when we attempt to load data from ES for analytics, or on first load and refresh, we will get a timeout error. When this happens, I can typically refresh the page, and that will resolve the issue. What is the default timeout set for ES analytics requests? Addittionally, evaluate if we are using the most optimal calls to get the data we need efficiently, or if perhaps there is a more optimal way to retrieve this data based on Elastic search best practices.

- Well not part of the plan for this phase, note that in the next planning phase we should consider the following items:
  - Code security scanning to ensure we do not have any open source vulnerabilites or code paths that could be used to bypass security or gain access to systems. We should determine the best methods for testing this, and the best tools to use. Perhaps there is a way to integrate this into our CI/CD pipeline.
  - General UI updates based on the following: 
    - Page Header alignment is not even. Currently the logout button is sitting higher than the other elements in the header. This is probably due to the clocks location, perhaps we should find a better place to put the clock so that it does not cause the alignment to be skewed.
    - Page Header labels are too verbose, I would rather increase the size of the icons for each item and reduce the label text to single words like Devices, Schedules, Analytics, Firewall, and System.
    - Page header label OPNSense Gateway Control is too long. Lets change this to just say Gateway Control and also remove the OPNsense and Elasticsearch version labels, since this is available in the system tab. Leave Access & Telemetry portal though and move the current version of the code to be in line with the Access & Telemetry Portal label
    - The buttons for YT Allowed are rather large. Change this to just be the Youtube logo and have it be bright if its allowing YT, but dim when it is not, like the Allowed button already operates
    - When clicking blocked in Devices & Access Control within the show list (All, Online,...) the blocked view should also include devices that have YT blocked for easier view and access. 
    - The Unicorn icon in the page header is slightly difficult to make out. Perhaps we can make it slightly larger, and with a more defined border.
  - In the next planning phase, for the discussion, lets also include determining better ways of showing data that is is waiting to load from ES for presentation. Sometimes stale data, or no data, will show while the system is refreshing and it is not obvious that the stale data is bad. Perhaps we could do something like grey out the windows of where the data loads and slowly blink the data as it is loaded.
  - When we do get errors when trying to access ES or OPNsense, be sure those errors are logged in our System tab logs.
  - Additionally as part of the next planning phase, present improvement options, performance enhancements or other changes that you think would improve the application for discussion.
### Feature Requests
- See all requests made above in Feedback.

