# Topcashback VPN Monitor — Apps Script Setup Guide

This script runs **twice daily at 2pm and 6pm HKT**, checks Topcashback cashback rates for NordVPN, SurfShark, and Private Internet Access, and sends an alert email when a promo condition is met.

When SurfShark hits ≥ 100% cashback, the script also **automatically updates the SurfShark VPN blog post** on flyasia.co with the latest promo copy, caption date, and price — then asks Claude to proofread it for consistency.

---

## What the Script Does

1. Fetches `topcashback.com/nordvpn/` and extracts the **MGM referral bonus** (`.nav-feature-link`)
2. If MGM bonus **≥ US$30**: fetches each VPN product page and extracts the highest cashback rate
   - If any VPN rate **≥ 100%**: sends an alert email to `info@flyasia.co`
   - If it's **SurfShark**: triggers automatic blog post update (see below)
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

## SurfShark Blog Post Auto-Update

When SurfShark's cashback rate hits ≥ 100%, the script:

1. **Checks deduplication** — skips if updated within the last 7 days at the same rate
2. **Fetches the WordPress post** (Post ID 41060) with raw Gutenberg block content
3. **Updates three things** via regex:
   - Intro paragraph date and promo copy (e.g. `2026 年 7 月 7 日更新：Topcashback 現時 SurfShark VPN 有 125% 回贈優惠！...`)
   - Cashback table caption date (e.g. `上表為 2026 年 7 月 Surfshark 的收費。`)
   - All price references if the Surfshark 2-year plan price has changed
4. **Proofreads with Claude Haiku** — checks the intro + pricing table for numerical contradictions
5. **Pushes the updated post** back to WordPress via REST API
6. **Sends a summary email** to `info@flyasia.co` with what changed

### Price update logic
- Best-effort scrape of `surfshark.com/pricing` for the HK$ price
- If scraping fails (JS-rendered page): uses the last known price stored in Script Properties
- USD→HKD conversion: US$1 = HK$7.85

### Proofread behaviour
- Claude Haiku checks for numerical inconsistencies in the intro and price table
- If Claude flags something: sends a separate warning email AND still publishes the update
- If `ANTHROPIC_API_KEY` is not set: proofread is skipped silently

---

## Important Caveat — Web Scraping

This script fetches and parses Topcashback HTML directly (the same technique as the n8n workflow). If Topcashback changes their page layout or CSS class names, the extraction will break. Check the **Executions log** if alerts stop arriving and you expect them. The two CSS classes being matched:
- `.nav-feature-link` — for the MGM referral amount
- `.merch-cat__rate` — for the cashback percentage

---

## Prerequisites

- Access to the Points Sales Log spreadsheet (`1Gg4wDji753n3UaI2zUT1meqJqrMJhHjpEGCaV4wJIIo`)
- A Google account with access to the `VPN` sheet tab
- WordPress Application Password for `ai@flyasia.co` on flyasia.co
- Anthropic API key (for Claude proofread — optional but recommended)

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

## Step 4 — Set Script Properties (Credentials)

The WordPress and Anthropic credentials are stored as **Script Properties** — never hardcoded in the source.

1. Click **⚙️ Project Settings** → **Script Properties** tab.
2. Click **Add script property** and add each of the following:

| Property name | Value |
|---|---|
| `WP_USERNAME` | `ai@flyasia.co` |
| `WP_APP_PASSWORD` | *(WordPress application password for ai@flyasia.co)* |
| `ANTHROPIC_API_KEY` | *(your Anthropic API key — optional)* |

> **WordPress Application Password**: Log in to flyasia.co → Users → ai@flyasia.co → Application Passwords → generate a new one.
>
> **Anthropic API key**: Available at [console.anthropic.com](https://console.anthropic.com). If omitted, the proofread step is skipped.

3. Click **Save script properties**.

---

## Step 5 — Authorize the Script

1. Select `runTopCashbackMonitor` from the function dropdown and click **▶ Run**.
2. When prompted, click **Review permissions → Allow**.
3. You may see a "Google hasn't verified this app" warning — click **Advanced → Go to [project name] (unsafe)**.

The script will do a live test run against Topcashback. Check the **Executions** log to see extracted rates.

---

## Step 6 — Create the Two Daily Triggers

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
- [ ] If SurfShark was ≥ 100%: a blog update summary email arrived at `info@flyasia.co`
- [ ] The blog post at `https://www.flyasia.co/2025/surfshark-vpn/` reflects the updated date and promo copy

---

## Thresholds & Config

| Setting | Default | Location in `Code.gs` |
|---|---|---|
| MGM referral bonus | ≥ US$30 | `MGM_THRESHOLD` |
| VPN cashback rate | ≥ 100% | `VPN_RATE_THRESHOLD` |
| Blog update cooldown | 7 days | `BLOG_UPDATE_COOLDOWN_DAYS` |
| USD → HKD rate | 7.85 | `USD_TO_HKD` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No rates extracted (returns 0) | Topcashback changed HTML structure | Inspect the page source and update the CSS class names in `extractMGMAmounts()` / `extractCashbackRates()` |
| `HTTP 403` or `HTTP 429` | Topcashback blocking the request | Try adding a `Utilities.sleep(2000)` between fetches; check User-Agent header |
| Sheet not found | Wrong spreadsheet ID or tab name | Verify `LOG_SPREADSHEET_ID` and `LOG_SHEET_NAME` in `Code.gs` |
| Alert email not received | Rate below threshold or `from` alias not set up | Check Executions log for extracted rates; confirm `info@flyasia.co` is a Send As alias |
| WP POST fails (401) | Wrong credentials in Script Properties | Re-check `WP_USERNAME` and `WP_APP_PASSWORD`; regenerate App Password if needed |
| WP POST fails (403) | `ai@flyasia.co` lacks Editor role | Assign Editor or Administrator role to `ai@flyasia.co` in WordPress Users settings |
| Blog update skipped | Same rate, within 7-day cooldown | Expected behaviour — change `BLOG_UPDATE_COOLDOWN_DAYS` or clear `SURFSHARK_LAST_UPDATE` property to force |
| Intro paragraph not updated | Regex pattern mismatch | Inspect the raw post block content for the exact date format; update regex in `updateIntroparagraph()` |
| Claude proofread skipped | `ANTHROPIC_API_KEY` not set | Add the property in Project Settings → Script Properties |
