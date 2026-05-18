# giffgaff Shipped Notification — n8n → Google Apps Script Migration Spec

**Project:** giffgaff Shipping Notification Automation  
**Source:** n8n workflow `20260408 | giffgaff Shipped Notification`  
**Target:** Google Apps Script — **container-bound** to the giffgaff spreadsheet  
**Reference implementation:** LuckySIM `Code.gs` (already deployed and working)  
**Prepared for:** Claude Code implementation

---

## 1. Overview

This is a **second instance** of the same shipping notification pattern already implemented for LuckySIM. The logic, structure, and helper functions are identical — only the spreadsheet, column names, eligibility conditions, and email template differ.

**Claude Code should model this script directly on the existing LuckySIM `Code.gs`**, making only the targeted substitutions documented in this spec. Do not redesign the architecture.

---

## 2. Key Differences vs LuckySIM

| Aspect | LuckySIM | giffgaff |
|---|---|---|
| Spreadsheet ID | `13CtkHUt-Cmia8rC3gL2AWCWcM7eo-v9V8mftC5g4iKk` | `1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o` |
| Spreadsheet name | LuckySIM Google Sheet | 20260324 \| giffgaff Local Shipping |
| Sheet tab | `First Submission` | `First Submission` (same) |
| "Not yet sent" column | `shipping_noti_sent?` | `notified?` |
| "Shipped" column | `shipped?` | `shipped?` (same) |
| Tracking column | `tracking_id` | `tracking_no` |
| Shipping address column | `shipping_address_line` | `shipping_address` |
| Recipient name column | `legal_name_eng` | `name` |
| Porting gate (`Applied?`) | ✅ Required (3 eligibility checks) | ❌ Not present — giffgaff is a straight SIM sale, no porting |
| Email subject | `我們已寄出你的 LuckySIM \| ${phone_hk}` | `我們已寄出你的 giffgaff` (no phone suffix) |
| From name | `FlyAsia x LuckySIM` | `FlyAsia` |
| Menu label | `LuckySIM` | `giffgaff` |
| Error alert email | `luckysim.flyasia@gmail.com` | `luckysim.flyasia@gmail.com` (same) |
| Success summary email | `luckysim.flyasia@gmail.com` | `luckysim.flyasia@gmail.com` (same) |

---

## 3. Google Sheet Configuration

**Spreadsheet ID:** `1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o`  
**Sheet name:** `First Submission`

### Column Reference

| Column Name | Used For | Read/Write |
|---|---|---|
| `email` | SendGrid `to` address | Read |
| `name` | Email body greeting | Read |
| `shipping_address` | Email body | Read |
| `tracking_no` | Email body + eligibility filter (must not be empty) | Read |
| `shipped?` | Eligibility filter (must be `true`) | Read |
| `notified?` | Eligibility filter + mark as sent | Read + Write |

> Columns present in the sheet but **not used** by the script: `date`, `qty`, `phone`, `shipping_method`, `edm`. The `getColMap()` helper handles these gracefully — they are simply ignored.

---

## 4. Eligibility Criteria

A row qualifies for a shipping notification if **all three** conditions are met:

```
row['notified?']  === false   // not yet notified
AND
row['shipped?']   === true    // SIM card physically mailed
AND
row['tracking_no'] !== ''     // tracking number exists
```

> **No `Applied?` check.** giffgaff is a direct SIM card sale — there is no porting application step. This is the primary structural difference from LuckySIM.

---

## 5. Constants

```javascript
// Container-bound: use SpreadsheetApp.getActiveSpreadsheet() instead of openById().
// SPREADSHEET_ID is kept here for reference/documentation only.
const SPREADSHEET_ID = '1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o';
const SHEET_NAME = 'First Submission';
const FROM_EMAIL = 'sim@flyasia.co';
const FROM_NAME = 'FlyAsia';
const ERROR_ALERT_EMAIL = 'luckysim.flyasia@gmail.com';

const SENDGRID_API_KEY = PropertiesService.getScriptProperties().getProperty('SENDGRID_API_KEY');
```

---

## 6. Core Function: `sendShippingNotifications()`

Identical structure to LuckySIM. Substitutions required:

- Column references: `shipping_noti_sent?` → `notified?`, `tracking_id` → `tracking_no`, `shipping_address_line` → `shipping_address`, `legal_name_eng` → `name`
- Remove `Applied?` filter condition entirely
- Remove `phone_hk`, `plan_type`, `sim_no`, `activate_date` from `rowData` object (not present in this sheet)
- Email subject: `我們已寄出你的 giffgaff` (static string, no phone suffix)
- Success/failure summary emails: update prefix from `[LuckySIM]` to `[giffgaff]`

### Pseudocode

```
function sendShippingNotifications():
  1. Get active spreadsheet (container-bound)
  2. Get sheet "First Submission"
  3. Read all values → build colMap from header row
  4. For each data row:
     a. Skip if notified? !== false
     b. Skip if shipped? !== true
     c. Skip if tracking_no is empty/blank
     d. Build rowData: { email, name, shipping_address, tracking_no }
     e. Call sendGridEmail(rowData.email, subject, buildEmailHtml(rowData))
     f. On success: set notified? cell to TRUE
     g. On failure: push to failedRows, continue
  5. After loop:
     - If failedRows.length > 0 → sendErrorAlertEmail(failedRows)
     - If sentCount > 0 → send success summary to luckysim.flyasia@gmail.com
```

---

## 7. Email Template

The giffgaff template is **simpler** than LuckySIM's — no porting steps, no activate date, no plan details. Copy the HTML from the n8n workflow's `contentValue` field verbatim, replacing all n8n template expressions with JS template literals.

### Variable Substitution Map

| n8n expression | JS variable |
|---|---|
| `{{ $('Google Sheets').item.json.shipping_address }}` | `${row.shipping_address}` |
| `{{ $('Google Sheets').item.json.tracking_no }}` | `${row.tracking_no}` |

> **Note:** The giffgaff template does not personalise with the recipient's name (unlike LuckySIM's `Hello ${row.legal_name_eng}`). The greeting in the n8n template is the generic `你好`. Keep it as-is.

### Subject Line

```javascript
const subject = '我們已寄出你的 giffgaff';
```

### `buildEmailHtml(row)` Signature

```javascript
function buildEmailHtml(row) {
  // row = { email, name, shipping_address, tracking_no }
  return `...giffgaff HTML template...`;
}
```

---

## 8. Error Alert Email

Identical to LuckySIM, with updated prefix and identifier field. Since giffgaff rows don't have `phone_hk`, use `email` as the row identifier in the alert body:

```javascript
function sendErrorAlertEmail(failedRows) {
  const subject = `[giffgaff] Shipping notification failed for ${failedRows.length} row(s)`;
  const body = failedRows.map(r =>
    `email: ${r.email}\nerror: ${r.error}`
  ).join('\n\n---\n\n');

  GmailApp.sendEmail(ERROR_ALERT_EMAIL, subject, body);
}
```

---

## 9. Module Structure

```
Code.gs  (giffgaff spreadsheet)
  ├─ onOpen()                        // Adds 'giffgaff' menu to spreadsheet
  ├─ triggerManualSend()             // Menu action
  ├─ sendShippingNotifications()     // Main logic
  ├─ buildEmailHtml(row)             // giffgaff HTML template
  ├─ sendGridEmail(to, subj, html)   // SendGrid API call (identical to LuckySIM)
  ├─ sendErrorAlertEmail(failedRows) // Alert to luckysim.flyasia@gmail.com
  └─ getColMap(headers)              // Helper (identical to LuckySIM)
```

---

## 10. Triggers

Identical setup to LuckySIM:

| Trigger | Function | Schedule |
|---|---|---|
| Scheduled | `sendShippingNotifications` | Day timer, 5pm–6pm HKT |
| Manual | `onOpen` (installable) | On spreadsheet open |

> Set script timezone to `Asia/Hong_Kong` before creating the time-based trigger.

---

## 11. Deployment Checklist

Follow the same steps as the LuckySIM `SETUP.md`, with these substitutions:

1. Open Apps Script from **inside the giffgaff spreadsheet** (`1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o`) via Extensions → Apps Script
2. Paste the giffgaff `Code.gs`
3. Set timezone → `Asia/Hong_Kong`
4. Add Script Property: `SENDGRID_API_KEY` = `SG.your_key_here` (same key as LuckySIM — both use the same SendGrid account)
5. Authorize (run `sendShippingNotifications` once manually to grant `UrlFetchApp` + `GmailApp` consent)
6. Create time-based trigger: `sendShippingNotifications`, Day timer, 5pm–6pm
7. Create installable `onOpen` trigger: From spreadsheet → On open
8. Refresh spreadsheet → confirm **giffgaff** menu appears

### Verifying a Successful Run

- [ ] Processed rows have `notified?` flipped to **TRUE**
- [ ] Customers received the shipping notification email
- [ ] `luckysim.flyasia@gmail.com` received `[giffgaff] X shipping notification(s) sent successfully`
- [ ] Executions log shows: `Done. Sent: X, Failed: 0`
- [ ] If failures: error alert sent to `luckysim.flyasia@gmail.com`

---

## 12. What Claude Code Does NOT Need to Change

The following are identical to LuckySIM and can be copied without modification:

- `sendGridEmail()` function (same endpoint, same auth pattern)
- `getColMap()` helper
- `triggerManualSend()` wrapper
- SendGrid payload structure (from/to/subject/content)
- `muteHttpExceptions: true` + response code check pattern
- `PropertiesService` API key retrieval
- `GmailApp.sendEmail()` success summary pattern
