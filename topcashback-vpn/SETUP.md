# Topcashback VPN Monitor — Apps Script Setup Guide

This script runs **twice daily at 2pm and 6pm HKT**, checks Topcashback cashback rates for NordVPN, SurfShark, and Private Internet Access, and sends an alert email when a promo condition is met.

---

## What the Script Does

1. Fetches `topcashback.com/nordvpn/` and extracts the **MGM referral bonus** (`.nav-feature-link`)
2. If MGM bonus **≥ US$30**: fetches each VPN product page and extracts the highest cashback rate
   - If any VPN rate **≥ 100%**: sends an alert email to `info@flyasia.co`
   - Logs every check result to the `VPN` sheet regardless
3. If MGM bonus **< US$30**: logs N/A and stops — no email sent

### Alert email subject format
```
Topcashback NordVPN | 125% | US$35 | 2026-07-07
```

### Log sheet columns (`VPN` tab)
| Date | MGM Rate | VPN Brand | VPN Rate | Action |
|---|---|---|---|---|
| 2026-07-07 14:02:11 | US$35 | NordVPN | 125% | FALSE |

---

## Important Caveat — Web Scraping

This script fetches and parses Topcashback HTML directly (the same technique as the n8n workflow). If Topcashback changes their page layout or CSS class names, the extraction will break. Check the **Executions log** if alerts stop arriving and you expect them. The two CSS classes being matched:
- `.nav-feature-link` — for the MGM referral amount
- `.merch-cat__rate` — for the cashback percentage

---

## Prerequisites

- Access to the Points Sales Log spreadsheet (`1Gg4wDji753n3UaI2zUT1meqJqrMJhHjpEGCaV4wJIIo`)
- A Google account with access to the `VPN` sheet tab

---

## Step 1 — Open the Apps Script Editor

This script is **not** container-bound to a specific spreadsheet — it reads from the log spreadsheet by ID. Create it as a standalone project:

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Rename the project (e.g. `Topcashback VPN Monitor`)

---

## Step 2 — Paste the Script

1. Click `Code.gs` in the left sidebar, select all, delete.
2. Paste the contents of [`Code.gs`](./Code.gs).
3. Save (`Ctrl+S` / `Cmd+S`).

---

## Step 3 — Set the Script Timezone

1. Click **⚙️ Project Settings** in the left sidebar.
2. Set **Time zone** to `(GMT+08:00) Asia/Hong_Kong`.
3. Click **Save settings**.

---

## Step 4 — Authorize the Script

1. Select `runTopCashbackMonitor` from the function dropdown and click **▶ Run**.
2. When prompted, click **Review permissions → Allow**.
3. You may see a "Google hasn't verified this app" warning — click **Advanced → Go to [project name] (unsafe)**.

The script will do a live test run against Topcashback. Check the **Executions** log to see extracted rates.

---

## Step 5 — Create the Two Daily Triggers

Apps Script doesn't support multiple times in a single trigger, so create two:

**Trigger 1 — 2pm:**
1. Click the **clock icon (Triggers)** → **+ Add Trigger**

| Setting | Value |
|---|---|
| Function | `runTopCashbackMonitor` |
| Event source | Time-driven |
| Type | Day timer |
| Time of day | 2pm to 3pm |

2. Click **Save**.

**Trigger 2 — 6pm:**
Repeat the above with **6pm to 7pm**.

---

## Verifying a Successful Run

After running, confirm:

- [ ] The **Executions** log shows extracted MGM amounts and VPN rates
- [ ] A new row was appended to the `VPN` tab in the Points Sales Log spreadsheet
- [ ] If thresholds were met, an alert email arrived at `info@flyasia.co`

---

## Thresholds

| Threshold | Default | Location in `Code.gs` |
|---|---|---|
| MGM referral bonus | ≥ US$30 | `MGM_THRESHOLD` |
| VPN cashback rate | ≥ 100% | `VPN_RATE_THRESHOLD` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No rates extracted (returns 0) | Topcashback changed HTML structure | Inspect the page source and update the CSS class names in `extractMGMAmounts()` / `extractCashbackRates()` |
| `HTTP 403` or `HTTP 429` | Topcashback blocking the request | Try adding a `Utilities.sleep(2000)` between fetches; check User-Agent header |
| Sheet not found | Wrong spreadsheet ID or tab name | Verify `LOG_SPREADSHEET_ID` and `LOG_SHEET_NAME` in `Code.gs` |
| Alert email not received | Rate below threshold or `from` alias not set up | Check Executions log for extracted rates; confirm `info@flyasia.co` is a Send As alias |
