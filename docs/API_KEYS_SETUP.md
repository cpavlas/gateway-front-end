# API Key Generation, Firewall Rule & Least-Privilege Scoping Guide

This guide walks through setting up the required firewall aliases, LAN enforcement rules (for both full-internet blocking and selective YouTube blocking), service accounts, and least-privilege API keys for:
1. **OPNsense** *(developed and validated for `OPNsense 26.7.7-amd64`)*
2. **Elasticsearch** *(developed and validated for `Elasticsearch 9.4.3` & Elastic `pfSense` Integration `1.25.4` / `logs-pfsense.log*`)*

All generated secrets belong exclusively in the root `.env` file (which is ignored by Git and excluded from Docker build layers).

---

## 1. OPNsense Setup (`OPNsense 26.7.7-amd64`)

### Step 1A: Create the `gateway_blocked_devices` Firewall Alias (Full Internet Block)
1. Log into your OPNsense web interface.
2. Navigate to **Firewall → Aliases** and click **+** (Add).
3. Configure the alias:
   - **Enabled:** Checked
   - **Name:** `gateway_blocked_devices` *(must match `OPNSENSE_BLOCK_ALIAS` in `.env`)*
   - **Type:** `Host(s)`
   - **Content:** Leave empty initially
   - **Description:** `Managed by Gateway Front-End Container`
4. Click **Save**, then click **Apply** at the bottom of the Aliases page so the underlying `pf` table is initialized.

### Step 1B: Create the LAN Firewall Rule for Blocked Devices (Full Internet Block)
1. *(If you don't already have a Private Networks alias)* In **Firewall → Aliases**, create an alias named `RFC1918_Private_Networks` of type `Network(s)` containing `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
2. Navigate to **Firewall → Rules → LAN** (and any other client VLANs you want controlled) and click **+** (Add):
   - **Action:** `Reject` *(recommended over `Block` so browsers/apps fail immediately instead of hanging)*
   - **Interface:** `LAN`
   - **Direction:** `in`
   - **TCP/IP Version:** `IPv4+IPv6` (or `IPv4`)
   - **Protocol:** `any`
   - **Source:** `gateway_blocked_devices`
   - **Destination / Invert:** Checked (**Invert**)
   - **Destination:** `RFC1918_Private_Networks`
   - **Description:** `Reject WAN/Internet traffic for devices in gateway_blocked_devices`
3. Place this rule **near the top of your LAN rule list** (above your default `LAN net -> any` allow rule, and below any anti-lockout or local DHCP/DNS rules).
4. Click **Save** and **Apply Changes**.

---

### Step 1C: Create the Least-Privilege API Group & Service User (`OPNsense 26.7.7-amd64`)
Never use the `root` API key. Instead, create a dedicated non-login service user restricted to the exact MVC controllers needed by this application:

1. **Create Group (`System → Access → Groups`):**
   - Click **+** (Add), set **Group name** to `gateway_controller`, and click **Save**.
   - Click the **Edit (pencil)** icon on `gateway_controller`, then click **Edit** next to **Assigned Privileges** (or select directly in the **Assigned Privileges** multi-select modal).
   - In **OPNsense 26.7.7-amd64**, search for and check **only** these 6 privileges:
     1. **`Firewall: Aliases`** *(filter by `Aliases` — internal key `page-firewall-aliases`; unlocks read-only `api/firewall/alias/get*`, `list*`, `search*`, `export`)*
     2. **`Firewall: Alias: Edit`** *(filter by `Alias: Edit` — internal key `page-firewall-alias-edit`; unlocks `api/firewall/alias/*` including `add_item`, `set_item`, and `reconfigure`)*
     3. **`Diagnostics: PF Table IP addresses`** *(filter by `PF Table` — internal key `page-diagnostics-tables`; unlocks runtime `api/firewall/alias_util/*` for instant `list`, `add`, and `delete`)*
     4. **`Diagnostics: ARP Table`** *(filter by `ARP` — internal key `page-diagnostics-arptable`; unlocks snake_case `api/diagnostics/interface/get_arp*` and `api/diagnostics/interface/search_arp*`)*
     5. **`Diagnostics: Show States`** *(filter by `States` — internal key `page-diagnostics-showstates`; unlocks `api/diagnostics/firewall/query_states*` and `api/diagnostics/firewall/kill_states*`)*
     6. **`Services: Dnsmasq DNS/DHCP: Settings`** *(filter by `Dnsmasq` — internal key `page-services-dnsmasq`; unlocks `api/dnsmasq/*` including `/api/dnsmasq/leases/search`. Note: in OPNsense 26.7.7-amd64 there is no separate `Leases` privilege, and `Services: Dnsmasq DNS/DHCP: Logfile` is **not** needed)*
   - Click **Save** twice. *(Ensure `GUI - All pages` is **NOT** checked.)*

2. **Create User (`System → Access → Users`):**
   - Click **+** (Add) to open the **Edit User** modal dialog.
   - **Username:** `svc_gateway_ui`
   - **Scrambled Password:** Check the box (*"Generate a scrambled password to prevent local database logins for this user."*).
   - **Login shell:** Leave set to **`Default (none for all but root)`** *(OPNsense automatically disables shell access / maps this to `/sbin/nologin` for all non-root accounts)*.
   - **Group membership:** Select `gateway_controller`.
   - Click **Save** at the bottom-right of the modal.

3. **Generate API Key & Secret (`System → Access → Users` Grid):**
   - In `OPNsense 26.7.7-amd64`, API keys are generated from the main **Users** table (outside the `Edit User` modal):
     - Locate the `svc_gateway_ui` row in the **Users** table and click the **ticket (`+` API key) icon** in the right-hand commands column *(or switch to the **API Keys** tab at the top of the Users page and click **+** for `svc_gateway_ui`)*.
   - A text file (`*_svc_gateway_ui_apikey.txt`) downloads automatically containing:
     ```ini
     key=YOUR_OPNSENSE_KEY
     secret=YOUR_OPNSENSE_SECRET
     ```
   - Copy `key` into `OPNSENSE_API_KEY` and `secret` into `OPNSENSE_API_SECRET` in `.env`, then delete the downloaded `.txt` file.

> **OPNsense 26.7.7-amd64 Endpoint Note:** Beginning in OPNsense 25.7/26.x, MVC ACL patterns enforce `snake_case` endpoint paths for non-root API keys (for example, `/api/diagnostics/interface/get_arp` or `/api/diagnostics/interface/search_arp` instead of legacy camelCase `getArp`). The backend `OPNsenseClient` uses these 26.7 `snake_case` endpoints natively.

---

### Step 1D: Enable Selective YouTube Blocking on OPNsense (Keep Plex & General Internet Allowed)

The application supports per-device and per-group **YT Allowed / YT Blocked** controls so you can block **YouTube** on specific devices or groups while keeping **Plex** (`plex.tv`, `plex.direct`, `:32400`) and all other websites/Google services working normally.

#### 1. Verify (or Create) the Two YouTube Aliases (`Firewall → Aliases`)
Using the `Firewall: Alias: Edit` privilege configured in Step 1C, the backend **automatically provisions and updates** both aliases on OPNsense whenever you toggle **YT Blocked / YT Allowed**:

| Alias Name (Default `.env`) | Type | Purpose & Managed Content |
| :--- | :---: | :--- |
| **`gateway_youtube_blocked_devices`**<br/>*(`OPNSENSE_YOUTUBE_BLOCK_ALIAS`)* | `Host(s)` | Dynamically holds the IPv4 addresses of LAN devices that currently have **YouTube Blocked** (`YT Blocked`). |
| **`gateway_youtube_domains`**<br/>*(`OPNSENSE_YOUTUBE_DOMAINS_ALIAS`)* | `Host(s)` | Holds YouTube & Google Video FQDNs resolved by OPNsense's `filterdns` daemon into `pf` table IPs:<br/>`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `kids.youtube.com`, `youtu.be`, `googlevideo.com`, `ytimg.com`, `i.ytimg.com`, `s.ytimg.com`, `yt3.ggpht.com`, `youtubei.googleapis.com`, `youtube-nocookie.com`. |

- **To verify in OPNsense:** Navigate to **Firewall → Aliases** and confirm that both `gateway_youtube_blocked_devices` and `gateway_youtube_domains` appear in the list and have **Enabled** checked. *(If you want to add any custom regional YouTube CDN hostnames later, you can append them directly to `gateway_youtube_domains` in the OPNsense GUI.)*

#### 2. Create the LAN Firewall Rule for Selective YouTube Blocking (`Firewall → Rules → LAN`)
For OPNsense to drop traffic matching those two aliases, add a single **Reject** rule on your LAN interface:

1. Navigate to **Firewall → Rules → LAN** (and any other client VLANs you want controlled) and click **+** (Add).
2. Configure the rule with the following settings:
   - **Action:** `Reject` *(recommended over `Block` so the YouTube mobile/TV app or browser fails immediately instead of spinning)*
   - **Disabled:** Unchecked (Enabled)
   - **Interface:** `LAN`
   - **Direction:** `in`
   - **TCP/IP Version:** `IPv4` (or `IPv4+IPv6`)
   - **Protocol:** `any` *(important: covers both TCP `80/443` and UDP `443` / HTTP/3 QUIC used by YouTube apps on iOS, Android, and Apple TV)*
   - **Source / Invert:** Unchecked
   - **Source:** `gateway_youtube_blocked_devices`
   - **Destination / Invert:** **Unchecked** *(unlike the full-internet rule, do **NOT** invert destination — we only want to reject traffic destined for `gateway_youtube_domains`)*
   - **Destination:** `gateway_youtube_domains`
   - **Log:** Checked *(recommended so rejected YouTube packets appear in Elasticsearch `logs-pfsense.log*` analytics)*
   - **Description:** `Reject YouTube traffic for devices in gateway_youtube_blocked_devices (Plex & general internet allowed)`
3. **Rule Ordering (`Firewall → Rules → LAN`):**
   - Place this rule **near the top of your LAN rule list**, right above or below your `gateway_blocked_devices` rule and **above** your general `LAN net -> any` allow rule:
     1. Anti-Lockout / Local Gateway DNS & DHCP rules
     2. **`Reject` — Source: `gateway_blocked_devices` → Destination: `!RFC1918_Private_Networks`** *(Full Internet Block)*
     3. **`Reject` — Source: `gateway_youtube_blocked_devices` → Destination: `gateway_youtube_domains`** *(Selective YouTube Block)*
     4. Default `Allow` — Source: `LAN net` → Destination: `any` *(Allows Plex & all other internet traffic)*
4. Click **Save**, then click **Apply Changes**.

#### 3. Recommended OPNsense DNS & Client Cache Considerations
- **Ensure LAN Clients Use OPNsense Unbound DNS:**
  - OPNsense's `filterdns` daemon resolves the hostnames in `gateway_youtube_domains` through OPNsense's local DNS resolver (`Unbound`) and populates the `gateway_youtube_domains` PF table with the returned A/AAAA records. Having LAN clients use your OPNsense gateway for DNS ensures clients resolve the exact same Google/YouTube edge IPs that `filterdns` loads into PF.
- **Immediate State Termination (`kill_states`):**
  - Whenever you click **`YT Blocked`** on a device or group in the Gateway UI, the backend adds the device IP(s) to `gateway_youtube_blocked_devices` and immediately invokes `/api/diagnostics/firewall/kill_states` for that device IP so existing open TCP/QUIC streams are severed without waiting for connection timeouts.

---

## 2. Elasticsearch Setup (`Elasticsearch 9.4.3`)

When OPNsense firewall (`filterlog`) and DNS (`unbound`) logs are ingested via the **Elastic `pfSense` Integration (`v1.25.4`)** into the **`logs-pfsense.log*`** data stream (`logs-pfsense.log-default`), scope your read-only API key directly to `logs-pfsense.log*`.

### Step 2A — Create the Scoped Read-Only API Key for `logs-pfsense.log*`
In **Kibana (`v9.4.3`) → Management → Dev Tools → Console** (or via **Stack Management → Security → API Keys**), run:

```json
POST /_security/api_key
{
  "name": "gateway-frontend-pfsense-logs-readonly",
  "role_descriptors": {
    "gateway_pfsense_logs_readonly": {
      "cluster": [ "monitor" ],
      "indices": [
        {
          "names": [ "logs-pfsense.log*" ],
          "privileges": [ "read", "view_index_metadata" ]
        }
      ]
    }
  }
}
```

- **Why `"cluster": ["monitor"]`?** Allows `/api/v1/system/health` (`client.info()` / `client.ping()`) to verify cluster reachability and report Elasticsearch `9.4.3` health without granting any write or administrative permissions.
- **Why `"names": ["logs-pfsense.log*"]`?** Restricts document searches (`read`) and field mapping checks (`view_index_metadata`) strictly to the `logs-pfsense.log` data stream and its backing `.ds-logs-pfsense.log-*` indices.
- Copy the **`encoded`** value from the JSON response (Base64-encoded `id:api_key`) and set it in `.env`:
  ```dotenv
  ELASTICSEARCH_API_KEY=PASTE_ENCODED_STRING_HERE
  ELASTICSEARCH_INDEX_PATTERNS=logs-pfsense.log*
  ```
