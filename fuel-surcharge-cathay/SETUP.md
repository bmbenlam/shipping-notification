# Cathay Pacific Fuel Surcharge Monitor — Setup Guide

This script monitors Cathay Pacific's fuel surcharge page, logs rate changes to a Google Sheet, and automatically saves a WordPress revision for editor review. Three interactive trend charts (short / medium / long haul) are embedded in the blog post directly from Google Sheets.

---

## What the Script Does

1. **Runs hourly** via a time-based trigger
2. **Smart frequency**: acts every hour around the 1st and 15th of the month (±2 days); otherwise once per day
3. On each run: scrapes Cathay's page for current short-haul (短途), medium-haul (中途), and long-haul (長途) YQ values
4. **If rates changed**:
   - Appends a new row to the `YQ Data` sheet and rebuilds step-chart data → charts update automatically
   - Fetches the live post content and applies updates: date line, current-rates table (rate + effective date + ▲▼ comparison), historical-rates table (prepends new row)
   - Proofreads the updated content with Claude Haiku
   - Saves a WordPress autosave revision (live post untouched)
   - Sends an approval email to `info@flyasia.co` and `heidi@flyasia.co` with a direct revision link

---

## Rate Types (3 Haul Categories)

| Type | Chinese | Destinations |
|---|---|---|
| Short haul | 短途 | Asia (Japan, Taiwan, Korea, Southeast Asia, etc.) |
| Medium haul | 中途 | South Asia subcontinent (India, Sri Lanka, Nepal, Bangladesh) |
| Long haul | 長途 | Europe, North America, Australia/NZ, Middle East, Africa |

Short and medium haul were priced identically before 2026-03-18. From that date onward, they diverged.

---

## Sheet Structure

| Tab | Purpose |
|---|---|
| `YQ Data` | One row per rate change. Columns: `date` \| `short_haul_hkd` \| `medium_haul_hkd` \| `long_haul_hkd` |
| `_chart_data` | Hidden. Auto-generated step-chart data (bridge rows for staircase display). Do not edit manually. |
| `_pending` | Hidden. Legacy — no longer used. Can be deleted. |

---

## GCP Cloud Function Proxy

### Why it exists

Cathay Pacific's website is served via Akamai CDN, which blocks Google Apps Script's IP range. A lightweight Google Cloud Function acts as a proxy — Apps Script calls the function, the function fetches Cathay's page from GCP Cloud Run IPs (which Akamai doesn't flag), and returns the HTML.

### Current deployment (flyasia-automation)

| Detail | Value |
|---|---|
| GCP project | `project-b815d528-9385-4925-8ae` (flyasia-automation) |
| Function name | `cathayProxy` |
| Region | `asia-east1` (Hong Kong) |
| Runtime | Node.js 22 |
| Memory | 256 MiB |
| Timeout | 30 s |
| Auth | `--allow-unauthenticated` + `PROXY_API_KEY` header check |
| URL | `https://asia-east1-project-b815d528-9385-4925-8ae.cloudfunctions.net/cathayProxy` |
| Cost | Free tier — 2M invocations/month free; this function runs at most ~720×/month |

### How to redeploy (e.g. after code changes)

```bash
gcloud config set project project-b815d528-9385-4925-8ae

gcloud functions deploy cathayProxy \
  --runtime nodejs22 \
  --region asia-east1 \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars PROXY_API_KEY=YOUR_EXISTING_KEY \
  --timeout 30 \
  --memory 256MiB \
  --source fuel-surcharge-cathay/proxy
```

The PROXY_API_KEY is stored in Apps Script Script Properties — use the same value so the key doesn't need to change.

### How to deactivate (temporarily pause)

Delete just the PROXY_URL Script Property in the Apps Script editor. Without it, the script falls back to direct fetch (which will be blocked by Akamai and time out). Effectively pauses the scraper without touching GCP.

To re-enable: add `PROXY_URL` back to Script Properties.

### How to decommission (permanently shut down)

```bash
# Delete the Cloud Function
gcloud functions delete cathayProxy --region asia-east1

# Optional: disable the APIs if not used by other projects
gcloud services disable cloudfunctions.googleapis.com
gcloud services disable cloudbuild.googleapis.com
```

The GCP project `flyasia-automation` itself can remain (it has no ongoing charges) or be deleted via the GCP Console → IAM & Admin → Manage Resources.

### How to adopt this pattern for a new project

1. Write a new proxy in `your-project/proxy/index.js` following the same pattern as `fuel-surcharge-cathay/proxy/index.js`
2. Deploy with a new function name and optionally a new project:
   ```bash
   gcloud functions deploy myNewProxy \
     --runtime nodejs22 \
     --region asia-east1 \
     --trigger-http \
     --allow-unauthenticated \
     --set-env-vars PROXY_API_KEY=NEW_KEY \
     --timeout 30 \
     --memory 256MiB \
     --source your-project/proxy
   ```
3. Store the URL and key in the new Apps Script project's Script Properties under `PROXY_URL` and `PROXY_API_KEY`
4. Call `fetchUrl(targetUrl)` — the same pattern used here works as-is

---

## Step 1 — Import Historical Data

1. In Google Drive, create a new Google Sheet
2. Rename the default tab to `YQ Data`
3. Add headers in row 1: `date` | `short_haul_hkd` | `medium_haul_hkd` | `long_haul_hkd`
4. **File → Import** → upload `cx_yq_history.csv` → **Append to current sheet**
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
2. Add all of the following:

| Property | Value |
|---|---|
| `WP_USERNAME` | `ai@flyasia.co` |
| `WP_APP_PASSWORD` | *(WordPress application password for ai@flyasia.co)* |
| `ANTHROPIC_API_KEY` | *(Anthropic API key — for Claude proofread; omit to skip)* |
| `PROXY_URL` | `https://asia-east1-project-b815d528-9385-4925-8ae.cloudfunctions.net/cathayProxy` |
| `PROXY_API_KEY` | *(the key set when deploying the Cloud Function)* |

---

## Step 6 — Authorize and Test

1. Select `testScrapeOnly` from the function dropdown and click **▶ Run**
2. When prompted, click **Review permissions → Allow**
3. Click **Advanced → Go to [project name] (unsafe)** if prompted
4. Check the Executions log — you should see the scraped short/medium/long values within ~3 seconds

---

## Step 7 — Set Up Interactive Charts

One-time setup to create the 3 trend charts and embed them in the blog post.

### 7a — Fix date format and create charts

1. Refresh the Google Sheet so the **YQ Monitor** menu appears
2. Click **YQ Monitor → Fix Sheet Dates (one-time)** — converts any text-string dates in column A to proper Date values so the chart X-axis is time-proportional
3. Click **YQ Monitor → Setup Charts (first run)** — creates 3 line charts in the sheet and saves their OIDs to Script Properties

### 7b — Publish the sheet

Charts must be publicly accessible for the iframe embeds to work:

1. **File → Share → Publish to the web**
2. Leave defaults (Entire Document → Web page) → **Publish** → **OK**

### 7c — Insert charts into the blog post

1. Click **YQ Monitor → Insert Charts into Post**
2. This replaces the three `[此處插入...走勢圖]` placeholders in the post with `<!-- wp:html -->` iframe blocks
3. Verify in the WP editor that the 3 iframes are visible

> After this, charts update automatically every time a new rate change is logged. No further action needed.

---

## Step 8 — Create the Hourly Trigger

1. Click the **clock icon (Triggers)** in the Apps Script left sidebar
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

When a rate change is detected, the script does **not** publish immediately:

1. **Logs** the new rates to `YQ Data` and rebuilds `_chart_data` → charts update automatically
2. **Fetches** the live post content and applies updates:
   - `更新日期：` line → new date
   - Current-rates table → new rate, effective date, ▲▼ comparison for all 3 rows
   - Historical-rates table → new row prepended at top
3. **Proofreads** with Claude Haiku (checks for numerical inconsistencies)
4. **Saves a WordPress autosave revision** — live post is untouched, no plugin required
5. **Sends an approval email** to `info@flyasia.co` and `heidi@flyasia.co` with:
   - Rate changes (before → after, ▲▼ diff)
   - Claude proofread result (✓ or ⚠ with note)
   - Direct link to the revision for one-click restore

### To publish the revision

1. Open the revision link in the approval email
2. Review the diff (WP shows exactly what changed)
3. Click **Restore This Revision**
4. Back in the post editor, click **Update** to publish

> Charts are already live the moment the rate change is logged, regardless of whether the revision has been approved.

---

## Scraper Maintenance

The script extracts values formatted as `NNN 港幣` (e.g. `339 港幣`) from the Hong Kong rows in the desktop table view. It splits the page into three sections using two anchor strings:

| Anchor string | Section |
|---|---|
| `南亞次大陸` | Start of medium-haul (South Asia subcontinent) section |
| `上表未提及的航班` | Start of short-haul (all other routes) section |
| Before `南亞次大陸` | Long-haul section |

If rate extractions return `null`, check the Executions log for `Anchor strings not found` or `Fallback used` warnings.

To fix: inspect the page source and check:
1. Are the anchor strings still present? → update `mediumIdx`/`shortIdx` in `extractYQRates()`
2. Is the value format still `NNN 港幣`? → update the regex in `lastHKDInRow()`
3. Is the 香港 row structure still `<td>香港</td>`? → update the row regex in `lastHKDInRow()`

If the proxy fetch itself times out, the GCP function may need redeployment or the User-Agent header may need updating.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Fetch times out or returns 403 | Akamai started blocking the proxy IP | Redeploy the Cloud Function (new IPs assigned) |
| `extractYQRates` returns null | Cathay changed page HTML | Update anchors or regex in `extractYQRates()` |
| Wrong value in 中途 (medium) | Fallback pattern picked wrong number | Inspect HTML, update primary Pattern A |
| Blog date/rates not updating | Regex mismatch in post content | Check `updateDateLine()` / `replaceRateRow()` patterns |
| Historical table not updated | Anchor string changed | Update `prependHistoryRow()` anchor |
| WP autosave fails (401) | Wrong credentials | Re-check `WP_USERNAME` and `WP_APP_PASSWORD` in Script Properties |
| Approval email not received | Wrong recipients or Send As alias missing | Verify `ALERT_EMAIL` / `HEIDI_EMAIL` constants and `info@flyasia.co` Send As alias in Gmail |
| Claude proofread skipped | `ANTHROPIC_API_KEY` not set | Add property in Project Settings → Script Properties |
| Charts not visible on blog | Sheet not published or OIDs not set | Re-run Steps 7b and 7c |
| Iframes show "You need access" | Sheet not published to web | Publish sheet (Step 7b) |
| Chart X-axis shows equal spacing | Column A dates stored as text | Run **YQ Monitor → Fix Sheet Dates (one-time)**, then re-run Setup Charts |
| Chart shows slope instead of flat line | `_chart_data` sheet missing or stale | Run **YQ Monitor → Setup Charts (first run)** to rebuild |
| WP post content fetched as empty | Post was created without content | Paste full template into WP post and save before running the monitor |
