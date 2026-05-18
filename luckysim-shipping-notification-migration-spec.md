# LuckySIM Shipped Notification — n8n → Google Apps Script Migration Spec

**Project:** LuckySIM Shipping Notification Automation  
**Source:** n8n workflow `20250531 | LuckySIM Shipped Notification`  
**Target:** Google Apps Script (standalone or container-bound to the LuckySIM spreadsheet)  
**Prepared for:** Claude Code implementation

---

## 1. Overview

This automation sends a shipping notification email (via SendGrid) to LuckySIM customers once their SIM card has been physically mailed. It reads eligibility from a Google Sheet, sends the email, then marks the row as notified.

### Current n8n Flow (for reference)

```
[Schedule Trigger 17:00]  ──┐
[Form Trigger (manual)]   ──┤──► [Read Sheet] ──► [Filter: shipped?=true] ──► [SendGrid] ──► [Update Sheet]
[Error Trigger]           ──► [Wait 15min] ──┘
```

### Target Apps Script Flow

```
[Time-based Trigger 17:00 HKT]  ──┐
[Manual menu / direct call]      ──┤──► sendShippingNotifications()
                                         │
                                         ├─ 1. Read Sheet rows (shipping_noti_sent? = false)
                                         ├─ 2. Filter: shipped?=true AND tracking_id not empty
                                         ├─ 3. For each row: call SendGrid API
                                         └─ 4. On success: update shipping_noti_sent? = TRUE
```

---

## 2. Google Sheet Configuration

**Spreadsheet ID:** `13CtkHUt-Cmia8rC3gL2AWCWcM7eo-v9V8mftC5g4iKk`  
**Sheet name:** `First Submission` (gid=0)

### Column Reference

The script must resolve column indices by **header name** (row 1), not by hard-coded position, since columns may shift. Below are the columns the script reads or writes:

| Column Name | Used For | Read/Write |
|---|---|---|
| `email` | SendGrid `to` address | Read |
| `phone_hk` | Email subject + match key for row update | Read |
| `legal_name_eng` | Email body greeting | Read |
| `plan_type` | Email body | Read |
| `sim_no` | Email body | Read |
| `tracking_id` | Email body + eligibility filter (must not be empty) | Read |
| `shipping_address_line` | Email body | Read |
| `activate_date` | Email body | Read |
| `shipped?` | Eligibility filter (must be `true`) | Read |
| `shipping_noti_sent?` | Eligibility filter + mark as sent | Read + Write |

> **Checkbox values in Apps Script:** `getValues()` returns actual booleans (`true`/`false`) for Google Sheets checkbox cells. Do NOT compare against the strings `"TRUE"` / `"FALSE"` or `"=true"`.  
> The n8n workflow used `.contains("=true")` — this was an n8n-specific quirk. In Apps Script, use strict `=== true`.

---

## 3. Eligibility Criteria

A row qualifies for a shipping notification if **all three** conditions are met:

```
row['shipping_noti_sent?'] === false   // not yet notified
AND
row['shipped?'] === true               // physically mailed
AND
row['tracking_id'] !== ''              // tracking number exists
```

---

## 4. Triggers

### 4.1 Scheduled Trigger (replaces n8n Schedule Trigger)

- **Type:** Apps Script time-based trigger
- **Function:** `sendShippingNotifications`
- **Schedule:** Daily, 5:00 PM – 6:00 PM HKT
- **Setup:** Create programmatically via `ScriptApp.newTrigger()` **or** manually in the Apps Script dashboard under *Triggers*

> ⚠️ Apps Script time-based triggers run in **script timezone**. Set the script project timezone to `Asia/Hong_Kong` (Apps Script editor → Project Settings → Time zone) **before** creating the trigger.

### 4.2 Manual Trigger (replaces n8n Form Trigger + On form submission)

- **Type:** Custom Google Sheets menu item **and/or** a standalone callable function
- **Function:** `triggerManualSend` (calls `sendShippingNotifications` directly)
- **Menu:** Add a `LuckySIM` menu to the spreadsheet UI via `onOpen()` with item "Send Shipping Notifications Now"

```javascript
// Menu setup example
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LuckySIM')
    .addItem('Send Shipping Notifications Now', 'triggerManualSend')
    .addToUi();
}

function triggerManualSend() {
  sendShippingNotifications();
}
```

---

## 5. Core Function: `sendShippingNotifications()`

### Pseudocode

```
function sendShippingNotifications():
  1. Open spreadsheet by ID (SPREADSHEET_ID constant)
  2. Get sheet "First Submission"
  3. Read all values (getValues()) — returns 2D array
  4. Row 0 is the header row → build a column index map: { columnName: colIndex }
  5. For each data row (rows 1..end):
     a. Read fields using column index map
     b. Skip if shipping_noti_sent? !== false
     c. Skip if shipped? !== true
     d. Skip if tracking_id is empty/blank
     e. Build HTML email body (see Section 7)
     f. Call sendGridEmail(to, subject, htmlBody)
     g. If sendGridEmail succeeds:
        - Update cell at (rowIndex, shipping_noti_sent? colIndex) to TRUE
     h. If sendGridEmail throws:
        - Log error with row identifier (phone_hk)
        - Continue to next row (do NOT mark as sent)
```

### Key Notes

- Process rows sequentially, not in parallel, to avoid race conditions on the sheet update.
- A failed send leaves `shipping_noti_sent?` as `false` so the next scheduled run will retry it automatically. This replaces the n8n Error Trigger → Wait 15 min → retry pattern.
- Use `sheet.getRange(rowNumber, colIndex).setValue(true)` for the update (1-indexed, not 0-indexed).

---

## 6. SendGrid API Call: `sendGridEmail()`

**Endpoint:** `POST https://api.sendgrid.com/v3/mail/send`  
**Auth header:** `Authorization: Bearer <SENDGRID_API_KEY>`  
**Method:** `UrlFetchApp.fetch()`

### Request Payload

```javascript
{
  "from": {
    "email": "sim@flyasia.co",
    "name": "FlyAsia x LuckySIM"
  },
  "personalizations": [
    {
      "to": [{ "email": row.email }]
    }
  ],
  "subject": `我們已寄出你的 LuckySIM | ${row.phone_hk}`,
  "content": [
    {
      "type": "text/html",
      "value": "<html email body string>"
    }
  ]
}
```

### Apps Script Fetch Example

```javascript
function sendGridEmail(toEmail, subject, htmlBody) {
  const url = 'https://api.sendgrid.com/v3/mail/send';
  const payload = {
    from: { email: 'sim@flyasia.co', name: 'FlyAsia x LuckySIM' },
    personalizations: [{ to: [{ email: toEmail }] }],
    subject: subject,
    content: [{ type: 'text/html', value: htmlBody }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + SENDGRID_API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true  // IMPORTANT: prevents throws on 4xx/5xx, lets us handle manually
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error(`SendGrid error ${code}: ${response.getContentText()}`);
  }
  // SendGrid returns 202 Accepted on success — no response body to parse
}
```

---

## 7. Email Template

The HTML body is identical to the n8n template. The only change is replacing n8n template syntax (`{{ $json.field }}`) with JavaScript template literals.

### Variable Substitution Map

| n8n expression | JS variable |
|---|---|
| `{{ $json.legal_name_eng }}` | `row.legal_name_eng` |
| `{{ $json.plan_type }}` | `row.plan_type` |
| `{{ $json.phone_hk }}` | `row.phone_hk` |
| `{{ $json.sim_no }}` | `row.sim_no` |
| `{{ $json.tracking_id }}` | `row.tracking_id` |
| `{{ $json.shipping_address_line }}` | `row.shipping_address_line` |
| `{{ $('Google Sheets').item.json.activate_date }}` | `row.activate_date` |

### Subject Line

```javascript
const subject = `我們已寄出你的 LuckySIM | ${row.phone_hk}`;
```

### HTML Body Function Signature

```javascript
function buildEmailHtml(row) {
  // row is an object with keys matching column names
  // Returns the full HTML string
  return `<!DOCTYPE html>
<html lang="zh-HK">
... (full template from n8n, with {{ }} replaced by ${} template literals)
`;
}
```

> **Implementation note for Claude Code:** Copy the exact HTML from the n8n workflow's `contentValue` field. Replace every `{{ $json.FIELD }}` with `${row.FIELD}` and `{{ $('Google Sheets').item.json.activate_date }}` with `${row.activate_date}`. Wrap the whole thing in a template literal.

---

## 8. Configuration Constants

Store all configuration at the top of the script file. **Do not hardcode the API key in source.** Use `PropertiesService` to retrieve it at runtime.

```javascript
// ── Constants ──────────────────────────────────────────────────
const SPREADSHEET_ID = '13CtkHUt-Cmia8rC3gL2AWCWcM7eo-v9V8mftC5g4iKk';
const SHEET_NAME = 'First Submission';
const FROM_EMAIL = 'sim@flyasia.co';
const FROM_NAME = 'FlyAsia x LuckySIM';

// ── API Key (retrieved from Script Properties) ──────────────────
// Set once via: PropertiesService.getScriptProperties().setProperty('SENDGRID_API_KEY', 'SG.xxx...')
const SENDGRID_API_KEY = PropertiesService.getScriptProperties().getProperty('SENDGRID_API_KEY');
```

### Setting the API Key (one-time setup)

Run this once in the script editor console, then delete it:

```javascript
function setApiKey() {
  PropertiesService.getScriptProperties().setProperty('SENDGRID_API_KEY', 'SG.YOUR_KEY_HERE');
}
```

---

## 9. Logging & Error Reporting

- Use `console.log()` / `console.error()` — visible in Apps Script *Executions* log
- Log the following at minimum:
  - Script start time and number of eligible rows found
  - Each row processed: `phone_hk`, `email`, success/failure
  - Any SendGrid error response body
- Optionally: send an error summary email to an admin address (`sim@flyasia.co`) if any rows fail

---

## 10. Module Structure

Suggested file layout for a single `.gs` file (or split by concern):

```
Code.gs
  ├─ onOpen()                    // Adds LuckySIM menu
  ├─ triggerManualSend()         // Menu action / manual entry point
  ├─ sendShippingNotifications() // Main logic
  ├─ buildEmailHtml(row)         // HTML template builder
  ├─ sendGridEmail(to, subj, html) // SendGrid API call
  └─ getColMap(headers)          // Helper: header array → { name: index } map
```

---

## 11. Helper: Column Index Map

Since column order may change, always derive indices from headers dynamically:

```javascript
function getColMap(headers) {
  const map = {};
  headers.forEach((h, i) => { map[h.trim()] = i; });
  return map;
}

// Usage:
const allValues = sheet.getDataRange().getValues();
const colMap = getColMap(allValues[0]);
const dataRows = allValues.slice(1);

dataRows.forEach((row, i) => {
  const email = row[colMap['email']];
  const shipped = row[colMap['shipped?']];
  // etc.
});
```

---

## 12. Deployment Checklist

1. **Create script:** In the LuckySIM Google Sheet → *Extensions → Apps Script*, or as a new standalone project
2. **Set timezone:** Project Settings → Time zone → `Asia/Hong_Kong`
3. **Set API key:** Run `setApiKey()` once, then delete the function
4. **Authorize:** Run `sendShippingNotifications()` manually once to trigger OAuth consent for Sheets + UrlFetch scopes
5. **Create scheduled trigger:**
   - Apps Script editor → *Triggers* → *Add Trigger*
   - Function: `sendShippingNotifications`
   - Event source: Time-driven → Day timer → 5pm–6pm
6. **Test manual menu:** Open the spreadsheet → *LuckySIM* menu → "Send Shipping Notifications Now"
7. **Verify:** Check *Executions* log and confirm `shipping_noti_sent?` cells flip to `TRUE` for processed rows

---

## 13. Key Differences from n8n (Summary)

| Aspect | n8n | Apps Script |
|---|---|---|
| Scheduled trigger | Built-in cron at 17:00 | Time-based trigger, 5pm–6pm window |
| Manual trigger | n8n Form Trigger (webhook form) | Google Sheets custom menu item |
| Sheet checkbox values | String `"=true"` / `"=false"` (n8n quirk) | Native boolean `true` / `false` |
| Error retry | Error Trigger → Wait 15 min → re-run | Failed rows stay `shipping_noti_sent?=false` and are retried on next 5pm run |
| Credentials | n8n credential manager | `PropertiesService` for API key; OAuth for Sheets (built-in) |
| Row update key | Matches on `phone_hk` column | Direct cell reference by row number (more reliable) |
