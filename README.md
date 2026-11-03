# Gateway Access Control & Analytics Portal (`v1.0.1`)

Self-hosted, single-container Dockerized web application (`http://localhost:8080`) for managing LAN device internet & application access via **OPNsense (`26.7.7-amd64`)** and visualizing live network, DNS, group, and application usage telemetry from **Elasticsearch (`9.4.3` — `logs-pfsense.log*` / Elastic `pfSense` Integration `1.25.4`)**.

---

## 1. Key Capabilities (`v1.0.1`)

1. **Instant Device & Group Internet Access Control (Control Features #1 & #2):**
   - Auto-discovers LAN devices from OPNsense ARP (`get_arp`) and Dnsmasq DHCP leases (`/api/dnsmasq/leases/search`) with custom nicknames, notes, and critical-infrastructure protection locks (`OPNSENSE_PROTECTED_IPS`).
   - One-click **Block / Allow** for individual devices or entire **Device Groups / Profiles** (e.g., *Kids Devices*, *Living Room Media*, *IoT*) via OPNsense `gateway_blocked_devices` alias manipulation + immediate active connection termination (`kill_states`).
2. **Selective YouTube Application Blocking (`FB-P6-005`):**
   - Block **YouTube** (`YT Blocked` / `YT Allowed`) on any individual device or group while keeping **Plex** (`plex.tv`, `plex.direct`, `:32400`) and all other websites/Google services working normally.
   - Automatically provisions and manages the OPNsense `gateway_youtube_blocked_devices` and `gateway_youtube_domains` aliases. See [`docs/API_KEYS_SETUP.md` Step 1D](docs/API_KEYS_SETUP.md#step-1d-enable-selective-youtube-blocking-on-opnsense-keep-plex--general-internet-allowed) for the one-time OPNsense LAN rule setup.
3. **Timed Pause & Bonus Access Overrides (Control Feature #3):**
   - Centered modal timer controls (`15m`, `30m`, `1h`, `2h`, `Until 07:00`, or `20m`/`40m`/`60m` Bonus Time, plus custom minutes) with live countdowns directly inside the `Timer` button (`Paused: Xm left` / `Bonus: Xm left`) and automatic background expiration reconciliation.
4. **Recurring Access Schedules & Bedtime Rules (Control Feature #4):**
   - Weekly & overnight schedules assignable to Groups or Single Devices (with live device search) evaluated every 60 seconds using a deterministic 5-tier policy precedence order (`Protected` → `Temporary Override` → `Manual Block` → `Active Schedule` → `Default Allow`) and automatic DHCP IP-drift healing.
5. **Elasticsearch `9.4.3` Traffic, DNS & Application Usage Analytics (`FB-P6-004`):**
   - Stacked activity timelines (Unbound DNS Queries vs. Firewall Filterlog Events), 24-hour access distribution profiles, Top Visited Domains, Top Destination Organizations (ASN), searchable chronological DNS query feeds, and **YouTube & Plex Active Usage Time** tracking (`active_minutes` derived from 5-minute activity windows).
6. **System Connectivity, SQLite Telemetry, Audit History & Configuration Backup/Restore (Phase 7):**
   - Live health probes for OPNsense, Elasticsearch, and Local SQLite Store (including on-disk **Storage Size** and **Record Count** stats), filterable **Audit & Event History** (with 90-day retention pruning), and one-click **JSON Configuration Export & Restore**.

---

## 2. Quick Start (Single-Container Docker Deployment)

1. **Configure `.env` Credentials & OPNsense Firewall Rules:**
   - Follow [`docs/API_KEYS_SETUP.md`](docs/API_KEYS_SETUP.md) to configure:
     - `gateway_blocked_devices` alias & LAN Reject rule (Step 1A–1B)
     - Least-privilege `svc_gateway_ui` OPNsense API key (Step 1C)
     - `gateway_youtube_blocked_devices` / `gateway_youtube_domains` LAN Reject rule for selective YouTube blocking (Step 1D)
     - Scoped read-only Elasticsearch API key for `logs-pfsense.log*` (Step 2A)
   - Copy `.env.example` to `.env` and populate your credentials.

2. **Build & Start the Container:**
   ```bash
   docker compose -f docker/docker-compose.yml --env-file .env up -d --build
   ```

3. **Access the Web Portal:**
   - Open `http://localhost:8080` and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
   - Persistent SQLite state (`devices`, `groups`, `timers`, `schedules`, `audit_logs`) is stored on the host volume at `./data/gateway.db`.

---

## 3. Local Development & Testing

- **Backend (`Python 3.12`, `pytest`, `ruff`, `mypy`):**
  ```bash
  pytest backend/tests --cov=app
  ruff check backend
  mypy backend/app
  ```
- **Frontend (`Node 22`, `Vitest`, `TypeScript`, `Vite`):**
  ```bash
  cd frontend
  npm test
  npm run build
  ```

---

## 4. Documentation Index (`docs/`)

- [`PLAN.md`](PLAN.md) — Master 7-Phase architecture and execution plan.
- [`docs/API_KEYS_SETUP.md`](docs/API_KEYS_SETUP.md) — OPNsense aliases, LAN firewall rules (full internet + selective YouTube block), ACL privileges, and Elasticsearch API key setup.
- [`docs/FEATURE_BACKLOG.md`](docs/FEATURE_BACKLOG.md) — User feedback and feature backlog ledger (`FB-P4-*`, `FB-P5-*`, `FB-P6-*`).
- [`docs/TEST_AND_BUG_LOG.md`](docs/TEST_AND_BUG_LOG.md) — Cumulative test cycle and bug resolution ledger (`BUG-P1-*` through `BUG-P7-*`).
- [`docs/PHASE_EXIT_REPORTS.md`](docs/PHASE_EXIT_REPORTS.md) — End-of-phase retrospectives and unplanned-information audits across all 7 phases.
- [`docs/PHASE_1_TRACKING.md`](docs/PHASE_1_TRACKING.md) .. [`docs/PHASE_7_TRACKING.md`](docs/PHASE_7_TRACKING.md) — Step-by-step phase execution trackers.
