# Cathay Pacific Fuel Surcharge Monitor — Apps Script Setup Guide

This script monitors Cathay Pacific's fuel surcharge page, logs rate changes to a Google Sheet, and automatically updates the FlyAsia blog post (Post ID 18512) — including three interactive trend charts (short / medium / long haul) embedded directly from Google Sheets.

---

## What the Script Does

1. **Runs hourly** via a time-based trigger
2. **Smart frequency**: acts every hour around the 1st and 15th of the month (±2 days); otherwise once per day
3. On each run: scrapes Cathay's page for current short-haul (短途), medium-haul (中途), and long-haul (長途) YQ values
4. **If rates changed**:
   - Appends a new row to the `YQ Data` sheet → the 3 embedded charts update automatically
   - Updates the blog post: date line, current-rates table (rate + effective date + ▲▼ comparison), historical-rates table (prepends new row)
   - Sends an alert email to `info@flyasia.co`
5. **Interactive charts** live in Google Sheets and are embedded in the blog post as iframes — they update automatically with the data, have a proportional time axis, and support hover tooltips

---

## Rate Types (3 Haul Categories)

| Type | Chinese | Destinations |
|---|---|---|
| Short haul | 短途 | Asia (Japan, Taiwan, Korea, Southeast Asia, etc.) |
| Medium haul | 中途 | South Asia subcontinent (India, Sri Lanka, Nepal, Bangladesh) |
| Long haul | 長途 | Europe, North America, Australia/NZ, Middle East, Africa |

Short and medium haul were priced identically before 2026-03-18. From that date onward, they diverged.

---

## Sheet Structure (`YQ Data` tab)

| Column | Header | Format | Example |
|---|---|---|---|
| A | `date` | YYYY-MM-DD | 2026-05-16 |
| B | `short_haul_hkd` | Integer | 339 |
| C | `medium_haul_hkd` | Integer | 633 |
| D | `long_haul_hkd` | Integer | 1362 |

---

## Prerequisites — Revisionary Plugin

The approval flow requires the **Revisionary** plugin on WordPress. Without it, pending revisions cannot be created and rate changes will not reach the blog.

1. In WordPress admin: **Plugins → Add New** → search **Revisionary** → Install and Activate
2. The plugin intercepts REST API posts with `status: pending-revision` and queues them as pending revisions
3. Editors receive an approval request email and can publish from **Posts → Pending Revisions** in WP admin

---

## Step 1 — Import Historical Data

1. In Google Drive, create a new Google Sheet
2. Rename the default tab to `YQ Data`
3. Add headers in row 1: `date` | `short_haul_hkd` | `medium_haul_hkd` | `long_haul_hkd`
4. **File → Import** → upload `cx_yq_history.csv` → **Append to current sheet**
   - This imports 26 historical rate periods going back to November 2018
5. Note the Spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

---

## Step 2 — Open the Apps Script Editor

1. From inside the Google Sheet: **Extensions → Apps Script**
2. Rename the project to `CX YQ Monitor`
3. Paste the contents of [`Code.gs`](./Code.gs), replacing the default content

---

## Step 3 — Fill in the Spreadsheet ID

In `Code.gs`, at the top:

```javascript
const DATA_SPREADSHEET_ID = 'YOUR_SHEET_ID_HERE';
```

Replace with the actual Sheet ID from Step 1.

---

## Step 4 — Set Script Timezone

1. Click **⚙️ Project Settings** in the left sidebar
2. Set **Time zone** to `(GMT+08:00) Asia/Hong_Kong`
3. Click **Save settings**

---

## Step 5 — Set Script Properties (Credentials)

1. Click **⚙️ Project Settings** → **Script Properties** tab
2. Add:

| Property | Value |
|---|---|
| `WP_USERNAME` | `ai@flyasia.co` |
| `WP_APP_PASSWORD` | *(WordPress application password for ai@flyasia.co)* |
| `ANTHROPIC_API_KEY` | *(your Anthropic API key — for Claude proofread)* |

> **ANTHROPIC_API_KEY**: Available at [console.anthropic.com](https://console.anthropic.com). If omitted, the proofread step is skipped silently.

---

## Step 6 — Authorize and Test

1. Select `triggerManualRun` from the function dropdown and click **▶ Run**
2. When prompted, click **Review permissions → Allow**
3. Click **Advanced → Go to [project name] (unsafe)** if prompted
4. Check the Executions log — you should see the scraped short/medium/long values

---

## Step 7 — Set Up Interactive Charts

This is a one-time setup to create the 3 trend charts in the sheet and embed them in the blog post.

### 7a — Create the Charts

1. In the Google Sheet, click **Extensions → Apps Script** → open the Apps Script editor
2. From the **YQ Monitor** menu (refresh the sheet first if you don't see it), click **Setup Charts (first run)**
3. This creates 3 embedded line charts in the sheet (one per haul type) and saves their OIDs to Script Properties

### 7b — Publish the Sheet

The charts need to be publicly accessible for the iframe embeds to work without login:

1. In the Google Sheet: **File → Share → Publish to the web**
2. Leave defaults (Entire Document → Web page) and click **Publish**
3. Click **OK** to confirm

### 7c — Insert Charts into the Blog Post

1. From the **YQ Monitor** menu, click **Insert Charts into Post**
2. This replaces the three placeholder paragraphs in the blog post with `<!-- wp:html -->` iframe blocks
3. Verify in the WP editor that the 3 iframes are visible

> After this, charts update automatically every time new data is logged. No further manual action needed for charts.

---

## Step 8 — Create the Hourly Trigger

1. Click the **clock icon (Triggers)** in the left sidebar
2. Click **+ Add Trigger**

| Setting | Value |
|---|---|
| **Function to run** | `runFuelSurchargeMonitor` |
| **Event source** | Time-driven |
| **Type** | Hour timer |
| **Interval** | Every hour |

3. Click **Save**

---

## Monitoring Schedule

| Day of month | Check frequency |
|---|---|
| 28–31, 1–3 (around 1st) | Every hour |
| 13–17 (around 15th) | Every hour |
| All other days | Once per day (~20h gate) |

---

## Approval Flow

When a rate change is detected, the script does **not** publish immediately. Instead:

1. **Logs** the new rates to the `YQ Data` sheet (charts update automatically)
2. **Builds** the updated blog post content:
   - `更新日期：` line → new date
   - Current-rates table → new rate, effective date, ▲▼ comparison for all 3 rows
   - Historical-rates table → new row prepended at top
3. **Proofreads** the updated content using Claude Haiku (checks for numerical inconsistencies)
4. **Saves a pending revision** via the Revisionary plugin — the live post is untouched
5. **Sends an approval request email** to `info@flyasia.co` and `heidi@flyasia.co` with:
   - Rate changes (before → after, ▲▼ diff)
   - Claude proofread result (✓ or ⚠ with note)
   - Direct link to the WP admin revision for one-click approval

### To publish the pending revision

1. Open the link in the approval email, or go to **WordPress admin → Posts → [the post] → Revisions**
2. Review the changes (diff view shows exactly what changed)
3. Click **Approve** — the pending revision becomes the live post immediately

> Charts update automatically every time new data is logged, regardless of whether the revision has been approved. No manual action needed for charts.

---

## Scraper Maintenance

If rate extractions start returning `null` (error emails arrive but no logging), Cathay Pacific may have changed their page HTML. Check the Executions log for `fallback pattern B used` warnings.

To fix: inspect the page source at `cathaypacific.com/cx/zh_HK/.../fuel-surcharge-updates.html` and update the regex in `extractYQRates()` in `Code.gs`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `extractYQRates` returns null | Cathay changed page HTML | Update regex in `extractYQRates()` |
| Wrong value in 中途 (medium) | Fallback pattern B picked wrong number | Inspect HTML, update primary Pattern A |
| Charts not visible on blog | Sheet not published or OIDs not set | Re-run Step 7b and 7c |
| Iframes show "You need access" | Sheet sharing permissions | Publish to the web (Step 7b) |
| Blog date/rates not updating | Regex mismatch in post content | Check `updateDateLine()` / `replaceRateRow()` patterns |
| Historical table not updated | `生效日期` heading pattern changed | Update `prependHistoryRow()` regex |
| WP POST fails (401) | Wrong credentials | Re-check `WP_USERNAME` and `WP_APP_PASSWORD` |
| Pending revision not created | Revisionary plugin not installed or inactive | Install and activate Revisionary (see Prerequisites section) |
| Approval email not received | Wrong recipients or `from` alias not set up | Verify `ALERT_EMAIL` / `HEIDI_EMAIL` constants and `info@flyasia.co` Send As alias |
| Claude proofread skipped | `ANTHROPIC_API_KEY` not set | Add the property in Project Settings → Script Properties |
| Revision link in email is broken | Revisionary returns different revision ID field | Go to WP admin → Posts → Revisions to find pending revision manually |
