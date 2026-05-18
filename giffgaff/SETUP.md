# giffgaff Shipping Notification — Apps Script Setup Guide

This guide walks through deploying `Code.gs` as a Google Apps Script on the giffgaff spreadsheet.

> The setup steps are identical to the LuckySIM script. If you have already done that setup, follow this guide using the giffgaff spreadsheet and script instead.

---

## What the Script Does

Each run of `sendShippingNotifications()`:

1. Reads all rows in the **First Submission** sheet
2. Finds rows where all three eligibility conditions are met (see [Eligibility Criteria](#eligibility-criteria) below)
3. Sends a shipping notification email to each eligible customer via SendGrid
4. Marks the row's `notified?` checkbox as **TRUE**
5. On completion, emails `luckysim.flyasia@gmail.com` a summary of how many notifications were sent
6. If any rows fail, emails `luckysim.flyasia@gmail.com` a separate error alert listing the failures

Failed rows are **not** marked as sent — the next scheduled run retries them automatically.

---

## Prerequisites

- Access to the giffgaff Google Sheet (`1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o`)
- A SendGrid API key with **Mail Send** permission — same key used for LuckySIM
- A Google account that has edit access to the sheet

---

## Step 1 — Open the Apps Script Editor

1. Open the giffgaff Google Sheet (`1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o`).
2. In the top menu, click **Extensions → Apps Script**.
3. A new browser tab opens with the Apps Script editor.

> **Important:** Always open Apps Script from **Extensions → Apps Script** inside the Google Sheet — do not go to script.google.com directly. Opening it from the sheet creates a container-bound project, which is required for the custom menu (Step 7) to work.

### Troubleshooting: "Sorry, unable to open the file at present"

This error almost always means the browser has **multiple Google accounts signed in** and the wrong one is being used.

**Fix A — Use an Incognito / Private window (quickest)**

1. Open a new **Incognito** (Chrome) or **Private** (Firefox/Safari) window.
2. Sign in with **only** the account that has edit access to the giffgaff sheet.
3. Open the sheet, then click **Extensions → Apps Script** again.

**Fix B — Switch to the correct account in the URL**

When the error page appears, find `/u/0/`, `/u/1/`, etc. in the URL and change the number to match the account that has edit access.

**Fix C — Check Google Workspace admin restrictions**

If Apps Script is disabled by your organisation, ask your admin to enable it at: **Admin Console → Apps → Google Workspace → Drive and Docs → Features and Applications**.

---

## Step 2 — Paste the Script

1. In the editor, click on the default file `Code.gs` in the left sidebar.
2. **Select all** existing content (`Ctrl+A` / `Cmd+A`) and delete it.
3. Open [`Code.gs`](./Code.gs) in this repository, click the **Copy raw file** button (top-right of the code block), and paste it into the editor.
4. Press `Ctrl+S` / `Cmd+S` to save — you should see **"Saved"** in the top bar.

---

## Step 3 — Set the Script Timezone

> This is critical. Apps Script time-based triggers run in the **script's timezone**. If this is not set to Hong Kong time, the 5pm trigger will fire at the wrong time.

1. In the Apps Script editor, click the **gear icon (⚙️ Project Settings)** in the left sidebar.
2. Scroll down to **Time zone**.
3. Change it to **`(GMT+08:00) Asia/Hong_Kong`**.
4. Click **Save settings**.

---

## Step 4 — Add the SendGrid API Key

The API key is stored in Apps Script's **Script Properties** — it is never written in the source code.

1. In the Apps Script editor, click **⚙️ Project Settings** in the left sidebar.
2. Scroll down to the **Script Properties** section.
3. Click **Add script property**.
4. Fill in:

| Field | Value |
|---|---|
| **Property** | `SENDGRID_API_KEY` |
| **Value** | `SG.your_actual_key_here` |

5. Click **Save script properties**.

> This is the same SendGrid API key used for LuckySIM — both scripts use the same account.

---

## Step 5 — Authorize the Script

1. In the Apps Script editor, select `sendShippingNotifications` from the function dropdown (top toolbar).
2. Click **▶ Run**.
3. A dialog will appear: **"Authorization required"** → click **Review permissions**.
4. Choose your Google account.
5. You may see a **"Google hasn't verified this app"** warning — click **Advanced → Go to [project name] (unsafe)**.
6. Review the permissions and click **Allow**.

Check the **Executions** log (left sidebar → clock icon) to confirm it completed without errors.

---

## Step 6 — Create the Scheduled Trigger

1. In the Apps Script editor, click the **clock icon (Triggers)** in the left sidebar.
2. Click **+ Add Trigger** (bottom right).
3. Configure as follows:

| Setting | Value |
|---|---|
| **Choose which function to run** | `sendShippingNotifications` |
| **Choose which deployment should run** | Head |
| **Select event source** | Time-driven |
| **Select type of time based trigger** | Day timer |
| **Select time of day** | 5pm to 6pm |

4. Click **Save**.

---

## Step 7 — Set Up the Manual Menu

1. In the Apps Script editor, click the **clock icon (Triggers)** in the left sidebar.
2. Click **+ Add Trigger** (bottom right).
3. Configure as follows:

| Setting | Value |
|---|---|
| **Choose which function to run** | `onOpen` |
| **Choose which deployment should run** | Head |
| **Select event source** | From spreadsheet |
| **Select event type** | On open |

4. Click **Save**.
5. Go back to the giffgaff Google Sheet and refresh the page.
6. A **giffgaff** menu should now appear in the top menu bar.
7. Click **giffgaff → Send Shipping Notifications Now** to trigger a manual send.

> **Note:** The **From spreadsheet** event source only appears if the script was opened via **Extensions → Apps Script** from inside the sheet (container-bound). If you only see "Time-driven" and "From calendar", go back to Step 1 and reopen the editor from the sheet.

---

## Verifying a Successful Run

After the script runs, confirm:

- [ ] Rows that met all eligibility criteria have their `notified?` checkbox flipped to **TRUE**
- [ ] Customers received the shipping notification email
- [ ] `luckysim.flyasia@gmail.com` received a success summary: `[giffgaff] X shipping notification(s) sent successfully`
- [ ] The **Executions** log shows: `Done. Sent: X, Failed: 0`
- [ ] If any rows failed, a separate error alert was sent to `luckysim.flyasia@gmail.com`

---

## Eligibility Criteria

A row is processed only if **all three** conditions are true:

```
notified?    = false   ← not yet notified
shipped?     = true    ← SIM card physically mailed
tracking_no  ≠ empty   ← tracking number exists
```

> There is no `Applied?` check for giffgaff — it is a direct SIM sale with no porting step.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `SendGrid error 401` | API key missing or wrong | Re-check Script Properties → `SENDGRID_API_KEY` |
| `SendGrid error 403` | API key lacks Mail Send permission | Regenerate key in SendGrid dashboard with **Mail Send** scope |
| No giffgaff menu in sheet | `onOpen` installable trigger not created | Follow Step 7 to create an installable On open trigger |
| "From spreadsheet" missing in trigger setup | Script is standalone, not container-bound | Re-do Step 1 — open Apps Script from **Extensions → Apps Script** inside the sheet |
| Trigger fires at wrong time | Timezone not set | Re-do Step 3 — set timezone to `Asia/Hong_Kong`, then delete and recreate the trigger |
| `Exception: You do not have permission` | OAuth not granted | Re-do Step 5 — run the function manually to trigger the consent screen |
| No success summary email received | No eligible rows that run | Check that at least one row meets all three eligibility criteria |
