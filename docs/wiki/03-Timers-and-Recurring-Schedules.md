# 03 — Temporary Timers & Recurring Schedules (`Schedules` Tab)

> **Quick Navigation:** [Wiki Home](Home.md) · [01. Setup & OPNsense](01-Installation-and-OPNsense-Setup.md) · [02. Devices & Quotas](02-Devices-Groups-and-YouTube-Quotas.md) · **03. Timers & Schedules** · [04. Analytics & Blocking](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md) · [05. Firewall & WAN Blocking](05-Firewall-Inspector-GeoIP-and-WAN-Blocking.md) · [06. System & Admin](06-System-Administration-HA-and-Troubleshooting.md)

The portal combines **on-demand Temporary Timers** (available from `Devices` cards/rows and Analytics drawer headers) with **Recurring Weekly Schedules** (managed on the **`Schedules`** tab).

---

## 1. Temporary Access Timers (`Pause` & `Bonus Reward`)

Click any **`Timer`** icon button on a Device row, Group card, `DeviceAnalyticsDrawer`, or `GroupAnalyticsDrawer` to open the centered **Timer Popover Modal**:

### Pause Access (Temporary Block)
Immediately drops WAN traffic (`gateway_blocked_devices` + `kill_states`) for a set period, then restores access automatically upon expiration:
- **Presets:** **`15m`**, **`30m`**, **`1h`**, **`2h`**, **`Until 07:00`** *(until `07:00` local time tomorrow)*
- **Custom Duration:** Enter any duration (`1` to `1440` minutes) and click **Pause Access**.

### Grant Bonus Time (Temporary Allow Override)
Temporarily unlocks **both** Full Internet and YouTube access—overriding manual blocks, Group Daily YouTube Quotas, and active recurring schedules—then automatically re-evaluates policy once expired:
- **Presets:** **`20m`**, **`40m`**, **`60m`**
- **Custom Duration:** Enter custom minutes (`1` to `1440`) and click **Grant Bonus Time**.

> **Live Countdown & Cancel:** Active timers display a highlighted amber (**Pause**) or emerald (**Bonus**) pill with a live remaining-time indicator and a **Cancel** (`×`) button to end the override early. The backend reconciler checks for expired overrides every **60 seconds**.

---

## 2. 7-Day / 24-Hour Weekly Schedule Timeline (`Schedules` Tab)

At the top of **`Schedules`**, the interactive **Weekly Schedule Coverage Timeline** visualizes every enabled schedule across **Monday through Sunday (`00:00` – `24:00`)**:

- **Full Internet Block Windows:** Highlighted in **rose/red** (`block_mode = "internet"`).
- **YouTube-Only Block Windows:** Highlighted in **amber** (`block_mode = "youtube"`).
- **Snoozed Windows:** Visually marked as temporarily paused while snooze is active.
- **Overnight Split Handling:** Rules that cross midnight (e.g., `21:00` -> `07:00` on Monday) automatically render `21:00–24:00` on Monday and `00:00–07:00` on Tuesday so you can spot overlapping windows at a glance.
- **Click-to-Edit:** Click any schedule block in the timeline to open its edit modal immediately.

---

## 3. Creating, Editing & Cloning Recurring Schedules

Click **Create Schedule** (or **Edit** on any rule card) to configure:

1. **Rule Name & Description:** e.g., *School Night Bedtime* or *Study Hours — No YouTube*.
2. **Block Mode (`block_mode`):**
   - **`Full Internet`:** Blocks all WAN traffic via `gateway_blocked_devices` while allowing local LAN access.
   - **`YouTube Only`:** Blocks YouTube (`gateway_youtube_blocked_devices`) while leaving general web browsing and Plex online.
3. **Target Assignment (`target_type`):**
   - Switch between **`Device Group`** and **`Single Device`** (with live searchable device selector). Both **target type** and **target device/group** can be changed directly when editing an existing rule.
4. **Days of Week & Time Window:**
   - Select any combination of `Mon`–`Sun` (quick presets for weekdays/weekends or individual day pills).
   - Set **Start Time** (`HH:MM`) and **End Time** (`HH:MM`) in 24-hour format and select the **Timezone** (defaults to `TZ` from `.env`).
   - Overnight spans (`start_time > end_time`, such as `21:30` to `07:00`) are natively supported.

### Clone / Duplicate Schedule
Click the **Clone (`Copy`)** button on any Schedule Card to duplicate a rule cleanly (appending `(Copy)`), making it quick to create weekday vs. weekend variations without re-entering days or descriptions.

---

## 4. Snoozing & Toggling Schedule Rules

Each Schedule Card displays real-time status badges (`Active Now, Blocking until HH:MM`, `Scheduled Next`, `Disabled`, or `Snoozed`) plus quick footer controls:
- **`30m` / `60m` Snooze:** Temporarily suspends enforcement of an active rule for 30 or 60 minutes without disabling the recurring rule permanently.
- **`Skip Window`:** Snoozes enforcement through the end of the current/next scheduled block window (`until_end_of_window`).
- **`Resume`:** Appears whenever a rule is currently snoozed so you can end the snooze early and re-activate enforcement immediately.
- **`Enable Rule` / `Disable Rule` Toggle:** Enables or pauses the schedule long-term.

---

**Previous:** [<- 02. Devices, Groups & YouTube Quotas](02-Devices-Groups-and-YouTube-Quotas.md) · **Next:** [04. Network Analytics, App Telemetry & Domain/ASN Blocking ->](04-Analytics-App-Telemetry-and-Domain-ASN-Blocking.md)
