# Ebook Affiliate Settlement — Apps Script Setup Guide

This script runs on the **14th of every month**, calculates outstanding affiliate commission for each vendor, sends an internal summary to `flyasia.pacific@gmail.com`, and creates Gmail **draft** emails for vendors who need settlement.

---

## What the Script Does

1. Reads unpaid rows from each vendor's two tabs (asiamiles + avios)
2. Sums their outstanding amounts and calculates commission (× 40%)
3. Sends an **internal summary email** to `flyasia.pacific@gmail.com` listing all vendors regardless of threshold
4. For vendors where commission **> HK$2,000**: creates a **Gmail draft** addressed to the vendor requesting an invoice, with a table of their unpaid sales (date, amount, coupon — no buyer email)
5. You review and send the drafts manually

---

## Sheet Structure Expected

| Tab | Vendor | Status column |
|---|---|---|
| `eddie_asiamiles` | HeaHotel | Col E |
| `eddie_avios` | HeaHotel | Col D |
| `yolk_asiamiles` | YolkInsight | Col E |
| `yolk_avios` | YolkInsight | Col D |
| `edin_asiamiles` | Edin | Col E |
| `edin_avios` | Edin | Col D |

**Status values:** `paid` = settled. Anything else (`pending`, blank) = outstanding.

---

## Prerequisites

- Access to the ebook affiliate Google Sheet
- A Google account that has edit access to the sheet
- Vendor email addresses for HeaHotel, YolkInsight, and Edin

---

## Step 1 — Fill in Configuration

Before pasting the script, update these values at the top of `Code.gs`:

```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // from the sheet URL
const VENDORS = [
  { name: 'HeaHotel',    email: 'HEAHOTEL_EMAIL_HERE',    ... },
  { name: 'YolkInsight', email: 'YOLKINSIGHT_EMAIL_HERE', ... },
  { name: 'Edin',        email: 'EDIN_EMAIL_HERE',        ... },
];
```

The Spreadsheet ID is in the Google Sheet URL:
`https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

---

## Step 2 — Open the Apps Script Editor

1. Open the ebook affiliate Google Sheet.
2. Click **Extensions → Apps Script** — this creates a container-bound project.

> Always open from **Extensions → Apps Script** inside the sheet, not from script.google.com. This is required for the custom menu to work.

If you see **"Sorry, unable to open the file at present"**, see the troubleshooting steps in [`luckysim/SETUP.md`](../luckysim/SETUP.md#troubleshooting-sorry-unable-to-open-the-file-at-present).

---

## Step 3 — Paste the Script

1. Click `Code.gs` in the left sidebar.
2. Select all (`Ctrl+A` / `Cmd+A`), delete, paste the contents of [`Code.gs`](./Code.gs).
3. Save (`Ctrl+S` / `Cmd+S`).

---

## Step 4 — Set the Script Timezone

1. Click **⚙️ Project Settings** in the left sidebar.
2. Set **Time zone** to `(GMT+08:00) Asia/Hong_Kong`.
3. Click **Save settings**.

---

## Step 5 — Authorize the Script

1. Select `runMonthlySettlement` from the function dropdown and click **▶ Run**.
2. When prompted, click **Review permissions → Allow**.
3. You may see a "Google hasn't verified this app" warning — click **Advanced → Go to [project name] (unsafe)**.

The script will do a test run. Check **Executions** to confirm no errors.

---

## Step 6 — Create the Monthly Trigger (14th of each month)

1. Click the **clock icon (Triggers)** in the left sidebar.
2. Click **+ Add Trigger**.

| Setting | Value |
|---|---|
| **Function to run** | `runMonthlySettlement` |
| **Deployment** | Head |
| **Event source** | Time-driven |
| **Type** | Month timer |
| **Day of month** | 14 |
| **Hour** | 9am to 10am |

3. Click **Save**.

> The script will now run automatically on the 14th of every month at ~9am HKT.

---

## Step 7 — Set Up the Manual Menu (optional)

1. In Triggers, add another trigger:

| Setting | Value |
|---|---|
| **Function to run** | `onOpen` |
| **Event source** | From spreadsheet |
| **Event type** | On open |

2. Refresh the sheet — an **Affiliate** menu will appear in the top menu bar.
3. Use **Affiliate → Run Monthly Settlement Now** to trigger a manual run at any time.

---

## Verifying a Successful Run

After the script runs, check:

- [ ] `flyasia.pacific@gmail.com` received the internal summary email with all three vendors listed
- [ ] Gmail **Drafts** folder has emails for vendors whose commission exceeded HK$2,000
- [ ] Each draft: correct subject (`FlyAsia x [Vendor] / [MONTH] Affiliate Payment`), correct sales table, **no buyer email addresses**
- [ ] The **Executions** log shows `Done. Drafts created for: [vendor names]`

---

## Monthly Workflow

1. Script runs automatically on the 14th at ~9am
2. Check `flyasia.pacific@gmail.com` for the internal summary
3. Open Gmail Drafts — review each vendor draft
4. Add any context if needed, then **send manually**
5. Once vendor provides invoice and payment is made, mark the relevant rows as `paid` in the sheet

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sheet not found error | Tab name mismatch | Verify sheet tab names match exactly: `eddie_asiamiles`, `eddie_avios`, etc. |
| No draft created | Commission ≤ HK$2,000 | Check internal summary email — vendor may be below threshold |
| Wrong amounts | Status column misconfigured | `_asiamiles` tabs use col E (index 4); `_avios` tabs use col D (index 3) |
| Draft sent to wrong email | Vendor email placeholder not updated | Update `email` in the `VENDORS` config in `Code.gs` |
| No Affiliate menu | `onOpen` trigger not created | Follow Step 7 to create an installable On open trigger |
