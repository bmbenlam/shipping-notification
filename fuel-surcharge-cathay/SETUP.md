# Cathay Pacific Fuel Surcharge Monitor — Apps Script Setup Guide

This script monitors Cathay Pacific's fuel surcharge page, logs rate changes to a Google Sheet, regenerates a trend chart, and automatically updates the FlyAsia blog post (Post ID 18512).

---

## What the Script Does

1. **Runs hourly** via a time-based trigger
2. **Smart frequency**: only acts once per day on normal days; runs every hour around the 1st and 15th (±2 days) when Cathay's rates are expected to change
3. On each run: scrapes `cathaypacific.com/cx/zh_HK/...fuel-surcharge-updates.html` for current short-haul and long-haul YQ values
4. **If rates changed**:
   - Appends a new row to the `YQ Data` sheet
   - Regenerates the trend chart PNG using the full history
   - Uploads the chart to WordPress media library
   - Updates the blog post: date references, rate values, featured image
   - Sends an alert email to `info@flyasia.co`
5. **If fetch/parse fails**: sends an error email (page structure may have changed)

---

## Sheet Structure (`YQ Data` tab)

| Column | Header | Format | Example |
|---|---|---|---|
| A | `date` | YYYY-MM-DD | 2026-05-16 |
| B | `short_haul_hkd` | Integer | 633 |
| C | `long_haul_hkd` | Integer | 1362 |

---

## Step 1 — Import Historical Data

1. In Google Drive, create a new Google Sheet
2. Rename the default tab to `YQ Data`
3. Add headers in row 1: `date` | `short_haul_hkd` | `long_haul_hkd`
4. **File → Import** → upload `cx_yq_history.csv` → **Append to current sheet**
   - This imports 43 historical rate periods going back to November 2018
5. Note the Spreadsheet ID from the URL (`/d/XXXXXX/edit`)

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

Replace `YOUR_SHEET_ID_HERE` with the actual Sheet ID from Step 1.

---

## Step 4 — Set Script Timezone

1. Click **⚙️ Project Settings** in the left sidebar
2. Set **Time zone** to `(GMT+08:00) Asia/Hong_Kong`
3. Click **Save settings**

---

## Step 5 — Set Script Properties (Credentials)

1. Click **⚙️ Project Settings** → **Script Properties** tab
2. Add these two properties:

| Property | Value |
|---|---|
| `WP_USERNAME` | `ai@flyasia.co` |
| `WP_APP_PASSWORD` | *(WordPress application password for ai@flyasia.co)* |

---

## Step 6 — Authorize and Test

1. Select `triggerManualRun` from the function dropdown and click **▶ Run**
2. When prompted, click **Review permissions → Allow**
3. You may see a "Google hasn't verified this app" warning — click **Advanced → Go to [project name] (unsafe)**
4. Check the **Executions** log to confirm:
   - Scraped short-haul and long-haul values are reasonable (current: HK$633 / HK$1,362)
   - A new row was appended to `YQ Data` (only if different from last known)
   - Chart PNG was generated and uploaded to WordPress

---

## Step 7 — Create the Hourly Trigger

1. Click the **clock icon (Triggers)** in the left sidebar
2. Click **+ Add Trigger**

| Setting | Value |
|---|---|
| **Function to run** | `runFuelSurchargeMonitor` |
| **Event source** | Time-driven |
| **Type** | Hour timer |
| **Interval** | Every hour |

3. Click **Save**

> The smart frequency gate in the script means it will only act once per day on normal days, and every hour on days around the 1st and 15th.

---

## Step 8 — Create the Custom Menu Trigger (optional)

Add a second trigger so the `YQ Monitor` menu appears when you open the sheet:

| Setting | Value |
|---|---|
| **Function to run** | `onOpen` |
| **Event source** | From spreadsheet |
| **Event type** | On open |

---

## Verifying a Successful Rate Change Detection

When Cathay updates rates, confirm:

- [ ] New row appended to `YQ Data` with the correct date and values
- [ ] Chart PNG updated in WordPress media library
- [ ] Blog post at `https://www.flyasia.co/2026/hkg-fuel-surcharge/` shows new date and rates
- [ ] Alert email received at `info@flyasia.co`

---

## Blog Post Regex — Adjustment Required

The regex patterns in `updateYQDateLine()` and `updateYQRateValues()` are based on expected post structure. **If the blog post content uses different phrasing or HTML structure, update these functions** in `Code.gs`:

```javascript
function updateYQDateLine(content, date) { ... }
function updateYQRateValues(content, shortHaul, longHaul) { ... }
```

Run `triggerManualRun()` after a known rate change to verify the content was patched correctly.

---

## Scraper Maintenance

If rate extractions start returning `null` (error emails arrive but no logging), Cathay Pacific may have changed their page HTML. Check the Executions log — it will say `extractYQRates: using fallback pattern C` if the primary patterns missed.

To fix: inspect `https://www.cathaypacific.com/cx/zh_HK/latest-news/other-news/fuel-surcharge-updates.html` page source and update the regex in `extractYQRates()`.

---

## Monitoring Schedule

| Day of month | Check frequency |
|---|---|
| 28–31, 1–3 (around 1st) | Every hour |
| 13–17 (around 15th) | Every hour |
| All other days | Once per day (~every 20 hours) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `extractYQRates` returns null | Cathay changed page HTML | Update regex in `extractYQRates()` |
| Chart not uploading | WP credentials wrong | Check `WP_USERNAME` / `WP_APP_PASSWORD` in Script Properties |
| Blog post rate not updating | Regex mismatch | Update `updateYQRateValues()` to match your post HTML |
| Rates changing unexpectedly | Fallback pattern C guessing wrong values | Add `console.log(html.substring(...))` to inspect raw HTML |
| Too many runs on non-change days | Frequency gate misconfigured | Check `YQ_LAST_CHECK` in Script Properties; adjust `HIGH_FREQ_DAYS` |
