# LuckySIM Shipping Notification — Apps Script Setup Guide

This guide walks through deploying `Code.gs` as a container-bound Google Apps Script on the LuckySIM spreadsheet.

---

## Prerequisites

- Access to the LuckySIM Google Sheet (`13CtkHUt-Cmia8rC3gL2AWCWcM7eo-v9V8mftC5g4iKk`)
- A SendGrid API key with **Mail Send** permission (`SG.xxx...`)
- A Google account that has edit access to the sheet

---

## Step 1 — Open the Apps Script Editor

1. Open the LuckySIM Google Sheet.
2. In the top menu, click **Extensions → Apps Script**.
3. A new browser tab opens with the Apps Script editor. The project is automatically container-bound to the sheet.

---

## Step 2 — Paste the Script

1. In the editor, click on the default file `Code.gs` in the left sidebar.
2. **Select all** existing content and delete it.
3. Copy the full contents of [`Code.gs`](./Code.gs) from this repository and paste it in.
4. Click the **Save** icon (or press `Ctrl+S` / `Cmd+S`).

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

### 4.1 Open the Script Properties panel

1. In the Apps Script editor, click **⚙️ Project Settings** in the left sidebar.
2. Scroll down to the **Script Properties** section.
3. Click **Add script property**.

### 4.2 Add the property

| Field | Value |
|---|---|
| **Property** | `SENDGRID_API_KEY` |
| **Value** | `SG.your_actual_key_here` |

4. Click **Save script properties**.

> Your API key is now securely stored. The script retrieves it at runtime via `PropertiesService.getScriptProperties().getProperty('SENDGRID_API_KEY')` and it will never appear in the source code or logs.

---

## Step 5 — Authorize the Script

The first time the script runs, Google will ask for OAuth consent.

1. In the Apps Script editor, select `sendShippingNotifications` from the function dropdown (top toolbar).
2. Click **▶ Run**.
3. A dialog will appear: **"Authorization required"** → click **Review permissions**.
4. Choose your Google account.
5. You may see a **"Google hasn't verified this app"** warning — click **Advanced → Go to [project name] (unsafe)**.
6. Review the permissions requested (Google Sheets, Gmail, external URL fetch) and click **Allow**.

The script will run once. Check the **Executions** log (left sidebar → clock icon) to confirm it ran without errors.

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

> Apps Script will now automatically run `sendShippingNotifications` daily between 5:00 PM and 6:00 PM Hong Kong time.

---

## Step 7 — Test the Manual Menu

1. Go back to the **LuckySIM Google Sheet** (not the script editor).
2. Refresh the page.
3. A new **LuckySIM** menu should appear in the top menu bar.
4. Click **LuckySIM → Send Shipping Notifications Now**.
5. The script runs immediately. Switch to the Apps Script editor and check **Executions** to see the log output.

---

## Verifying a Successful Run

After the script runs, confirm:

- [ ] Rows that met all eligibility criteria have their `shipping_noti_sent?` checkbox flipped to **TRUE**
- [ ] Customers received the shipping notification email
- [ ] The **Executions** log shows: `Done. Sent: X, Failed: 0`
- [ ] If any rows failed, an alert email was sent to `luckysim.flyasia@gmail.com`

---

## Eligibility Criteria (recap)

A row is processed only if **all four** conditions are true:

```
shipping_noti_sent? = false   ← not yet notified
Applied?            = true    ← porting application submitted
shipped?            = true    ← SIM card physically mailed
tracking_id         ≠ empty   ← tracking number exists
```

Failed rows are **not** marked as sent, so the next scheduled run will automatically retry them.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `SendGrid error 401` | API key missing or wrong | Re-check Script Properties → `SENDGRID_API_KEY` |
| `SendGrid error 403` | API key lacks Mail Send permission | Regenerate key in SendGrid dashboard with **Mail Send** scope |
| No LuckySIM menu in sheet | `onOpen` hasn't run yet | Refresh the sheet; or run `onOpen` manually from the editor |
| Trigger fires at wrong time | Timezone not set | Re-do Step 3 — set timezone to `Asia/Hong_Kong`, then delete and recreate the trigger |
| `Exception: You do not have permission` | OAuth not granted | Re-do Step 5 — run the function manually to trigger the consent screen |
