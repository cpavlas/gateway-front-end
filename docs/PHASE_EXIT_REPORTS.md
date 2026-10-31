# Phase Exit Analyses & Unplanned-Information Retrospectives

At the completion of every phase (before Git check-in and unlocking the next phase), this document captures:
1. **Test Cycle & Quality Gate Summary** (unit test counts, coverage, resolved vs. deferred bugs).
2. **Waterfall Impact Analysis** (how deferred bugs or newly discovered technical details alter upcoming phases and complexity ratings in [PLAN.md](../PLAN.md)).
3. **Unplanned Information Audit** (*"What information or configuration was needed that we did not plan for?"* and how those learnings are applied to the next phase).

---

## Phase 1 Exit Report (`2026-10-31`)

### 1. Quality Gate Summary
- **Backend Unit Tests (`pytest`):** `33 / 33 passed` in `1.02s` — **93.0% total statement coverage** (exceeds `>= 85%` gate).
- **Backend Static Analysis (`ruff` + `mypy`):** `0 errors` across all 15 source files and test suites.
- **Frontend Unit Tests (`Vitest`):** `4 / 4 passed` in `1.33s` — **98.78% line/statement coverage**, **92.85% branch coverage**, **100% function coverage**.
- **Frontend Production Build (`tsc -b && vite build`):** Succeeded in `1.49s` with `0 errors`.
- **Full-Stack Live Smoke Test:** Passed against live `https://gateway.sparkle-pony.com` (`373.01 ms`), `https://es1.sparkle-pony.com` (`39.53 ms`, `6,689,623` docs in `logs-pfsense.log*`), and local SQLite (`54.11 ms`).
- **Bugs Resolved in Phase 1:** `5` (`BUG-P1-001` through `BUG-P1-005` in [docs/TEST_AND_BUG_LOG.md](TEST_AND_BUG_LOG.md)).
- **Bugs Deferred / Waterfalled:** `0` unresolved bugs deferred; `3` live environment schema discoveries waterfalled into Phases 2 and 3 of [PLAN.md](../PLAN.md).

---

### 2. Waterfall Adjustments to Future Phases (`PLAN.md`)
1. **Waterfalled into Phase 2 (Device Discovery & Instant Block/Unblock):**
   - **Update 2A — Dnsmasq Lease Field Mapping & `"*"` Placeholder Handling:** Live inspection of `/api/dnsmasq/leases/search` on OPNsense `26.7.7-amd64` showed lease objects use `address` (IPv4), `hwaddr` (MAC), `mac_info` (manufacturer), `if_descr`, and literal `"*"` when `hostname` or `client_id` is unknown. Added explicit requirement in Phase 2 to map `address`/`hwaddr`/`mac_info` alongside ARP's `ip`/`mac`/`manufacturer` and normalize `hostname == "*"` to `None`.
   - **Update 2B — Dual-Path Alias Mutation (`alias_util` + `/api/firewall/alias/*` Config Fallback):** Because `Firewall: Aliases` (`page-firewall-aliases`) grants access to `/api/firewall/alias/*` (`get_alias_uuid`, `get_item`, `set_item`, `reconfigure`) whereas `/api/firewall/alias_util/*` requires `Diagnostics: PF Table IP addresses` (`page-diagnostics-table`), Phase 2's `block_ip()` and `unblock_ip()` methods in `OPNsenseClient` will support `alias_util/add` & `alias_util/delete` with an automatic fallback to `get_alias_uuid` → `get_item` → `set_item` → `reconfigure` so blocking works with or without `page-diagnostics-table`.
   - **Phase 2 Complexity Impact:** Remains **3 / 5 (Medium)** (risk reduced because exact ARP/Dnsmasq JSON schemas and alias UUID `7eb9bc75-bcba-42f9-8193-f5b14090488a` are already verified).
2. **Waterfalled into Phase 3 (Elasticsearch `9.4.3` Analytics):**
   - **Update 3A — Verified `filterlog` & `unbound` ECS Field Paths:** Live inspection (`docs/ES_SCHEMA_DISCOVERY.md`) confirmed that OPNsense uses **Unbound** for DNS resolution (`event.provider: "unbound"`, `3.02M+` docs) and that `dns.question.name`, `dns.question.registered_domain`, `dns.question.subdomain`, `source.ip`, and `client.ip` are already populated without needing any custom ingest pipeline changes. Bandwidth/connection queries will filter by `event.provider: "filterlog"` (`network.bytes`, `event.action: pass | block`, `destination.as.organization.name`).
   - **Phase 3 Complexity Impact:** Confirmed at **3.5 / 5 (Medium–High)** (down from original `4 / 5`).

---

### 3. Unplanned Information Audit & Feed-Forward Learnings for Phase 2
- **What information or configuration was needed that we did not originally plan for?**
  - *Finding 1 (Host & TLS Setup):* OPNsense is accessed via FQDN `https://gateway.sparkle-pony.com` (`192.168.50.1`) and Elasticsearch via `https://es1.sparkle-pony.com`, both with valid TLS certificates (`VERIFY_SSL=true`).
  - *Finding 2 (OPNsense `26.7.7-amd64` GUI & `ACL.xml` Exact Naming):*
    1. Dnsmasq only exposes `Services: Dnsmasq DNS/DHCP: Settings` and `Services: Dnsmasq DNS/DHCP: Logfile` (`Settings` maps to `api/dnsmasq/*`, which covers `/api/dnsmasq/leases/search`).
    2. `Diagnostics: ARP Table` (`page-diagnostics-arptable`) maps strictly to `snake_case` `api/diagnostics/interface/get_arp*` and `api/diagnostics/interface/search_arp*` — camelCase `getArp` would fail with `403` for a non-root user.
    3. In `System → Access → Users`, the non-interactive Login Shell option is labeled **`Default (none for all but root)`**, and API keys are generated from the **ticket icon** on the user row / **API Keys** tab.
    4. `Firewall: Aliases` (`page-firewall-aliases`) unlocks `/api/firewall/alias/*`, whereas `/api/firewall/alias_util/*` requires `Diagnostics: PF Table IP addresses` (`page-diagnostics-table`).
  - *Finding 3 (Elasticsearch `9.4.3` + `pfSense 1.25.4` Data Stream):*
    1. All OPNsense logs ship into `logs-pfsense.log*` (`.ds-logs-pfsense.log-default-2026.10.25-000001`), allowing a single permanent read-only API key scoped directly to `logs-pfsense.log*`.
    2. Unbound DNS queries (`3.02M+` docs) and filterlog packet records (`3.63M+` docs) are already parsed into ECS fields (`dns.question.name`, `dns.question.registered_domain`, `network.bytes`, `destination.as.organization.name`).
  - *Finding 4 (Local Windows Dev Environment Tooling & Docker Desktop Path):*
    1. Neither Python nor Node.js were on the global system `PATH`; we provisioned portable CPython `3.12.15` and Node.js `v22.14.0` inside `.uv/` (git-ignored and docker-ignored).
    2. Docker Desktop (`v29.9.2`, Compose `v5.6.1`) is installed in the per-user directory `C:\Users\cpavl\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe` (rather than `C:\Program Files\Docker`) and should be prepended to `$env:PATH` in tool sessions.
    3. `coverage.py`'s legacy C-tracer (`ctrace`) deadlocks with `aiosqlite` worker threads on Windows Python 3.12; setting `core = "sysmon"` (PEP 669) in `backend/pyproject.toml` resolved it permanently (`BUG-P1-001`).
- **How we will apply these learnings to Phase 2:**
  1. Use the real (redacted) ARP and Dnsmasq lease JSON structures from [docs/ES_SCHEMA_DISCOVERY.md](ES_SCHEMA_DISCOVERY.md) directly in Phase 2 `respx` test fixtures.
  2. Implement both `alias_util` (`add`/`delete`) and `/api/firewall/alias/*` (`set_item` + `reconfigure`) fallback in `OPNsenseClient` so device blocking works reliably under your current `svc_gateway_ui` privileges.
