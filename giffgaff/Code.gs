// ── Constants ──────────────────────────────────────────────────
// Container-bound: use SpreadsheetApp.getActiveSpreadsheet() instead of openById().
// SPREADSHEET_ID is kept here for reference/documentation only.
const SPREADSHEET_ID = '1rE5pRAq69N_9YsTbIPmemofyNGTXrpPXIrV6Se2QL6o';
const SHEET_NAME = 'First Submission';
const FROM_EMAIL = 'sim@flyasia.co';
const FROM_NAME = 'FlyAsia';
const ERROR_ALERT_EMAIL = 'luckysim.flyasia@gmail.com';

// ── API Key (retrieved from Script Properties) ──────────────────
// Set once via: PropertiesService.getScriptProperties().setProperty('SENDGRID_API_KEY', 'SG.xxx...')
const SENDGRID_API_KEY = PropertiesService.getScriptProperties().getProperty('SENDGRID_API_KEY');

// ── Menu Setup ─────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('giffgaff')
    .addItem('Send Shipping Notifications Now', 'triggerManualSend')
    .addToUi();
}

function triggerManualSend() {
  sendShippingNotifications();
}

// ── Main Logic ─────────────────────────────────────────────────

function sendShippingNotifications() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const allValues = sheet.getDataRange().getValues();
  const colMap = getColMap(allValues[0]);
  const dataRows = allValues.slice(1);

  const eligible = dataRows.filter(row => {
    return row[colMap['notified?']] === false
      && row[colMap['shipped?']] === true
      && String(row[colMap['tracking_no']]).trim() !== '';
  });

  console.log(`[${new Date().toISOString()}] Script started. Eligible rows: ${eligible.length}`);

  const failedRows = [];

  for (const row of eligible) {
    const rowData = {
      email:            row[colMap['email']],
      name:             row[colMap['name']],
      shipping_address: row[colMap['shipping_address']],
      tracking_no:      row[colMap['tracking_no']],
    };

    const sheetRowIndex = allValues.indexOf(row) + 1;

    console.log(`Processing: email=${rowData.email}`);

    try {
      const subject = '我們已寄出你的 giffgaff';
      const htmlBody = buildEmailHtml(rowData);
      sendGridEmail(rowData.email, subject, htmlBody);

      sheet.getRange(sheetRowIndex, colMap['notified?'] + 1).setValue(true);
      console.log(`Success: email=${rowData.email}`);
    } catch (err) {
      console.error(`Failed: email=${rowData.email}, error=${err.message}`);
      failedRows.push({ email: rowData.email, error: err.message });
    }
  }

  const sentCount = eligible.length - failedRows.length;

  if (failedRows.length > 0) {
    sendErrorAlertEmail(failedRows);
  }

  if (sentCount > 0) {
    GmailApp.sendEmail(
      ERROR_ALERT_EMAIL,
      `[giffgaff] ${sentCount} shipping notification(s) sent successfully`,
      `${sentCount} shipping notification email(s) were sent successfully on ${new Date().toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong' })}.`
    );
  }

  console.log(`[${new Date().toISOString()}] Done. Sent: ${sentCount}, Failed: ${failedRows.length}`);
}

// ── SendGrid API Call ───────────────────────────────────────────

function sendGridEmail(toEmail, subject, htmlBody) {
  const url = 'https://api.sendgrid.com/v3/mail/send';
  const payload = {
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [{ to: [{ email: toEmail }] }],
    subject: subject,
    content: [{ type: 'text/html', value: htmlBody }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + SENDGRID_API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error(`SendGrid error ${code}: ${response.getContentText()}`);
  }
}

// ── Error Alert ─────────────────────────────────────────────────

function sendErrorAlertEmail(failedRows) {
  const subject = `[giffgaff] Shipping notification failed for ${failedRows.length} row(s)`;
  const body = failedRows.map(r =>
    `email: ${r.email}\nerror: ${r.error}`
  ).join('\n\n---\n\n');

  GmailApp.sendEmail(ERROR_ALERT_EMAIL, subject, body);
}

// ── Email Template ──────────────────────────────────────────────

function buildEmailHtml(row) {
  return `<!DOCTYPE html>
<html lang="zh-HK">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>giffgaff SIM 寄送通知</title>
    <style>
        body {
            font-family: 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 650px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f8f8;
            font-size: 16px;
        }
        .email-container {
            background-color: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #b38850;
            padding-bottom: 30px;
            margin-bottom: 40px;
        }
        .greeting {
            font-size: 24px;
            font-weight: 600;
            color: #b38850;
            margin-bottom: 10px;
        }
        .intro {
            font-size: 18px;
            color: #666;
            margin-top: 20px;
        }
        .info-box {
            background-color: #f9f7f4;
            border-left: 4px solid #b38850;
            border-radius: 8px;
            padding: 25px;
            margin: 25px 0;
            font-size: 16px;
        }
        .info-box.highlight {
            background-color: #e8f4f8;
            border-left-color: #5099b3;
            border: 2px solid #5099b3;
        }
        .info-title {
            font-size: 18px;
            font-weight: bold;
            color: #b38850;
            margin-bottom: 15px;
        }
        .highlight-text {
            color: #b20000;
            font-weight: bold;
            background-color: #fff5f5;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 17px;
        }
        .tracking-number {
            font-size: 22px;
            font-weight: bold;
            color: #b20000;
            background-color: #fff5f5;
            padding: 12px 16px;
            border-radius: 8px;
            display: inline-block;
            margin: 10px 0;
            letter-spacing: 1px;
        }
        .section-title {
            color: #b38850;
            font-size: 22px;
            font-weight: bold;
            margin: 40px 0 25px 0;
            padding: 15px 0;
            border-bottom: 3px solid #b38850;
            text-align: center;
        }
        a {
            color: #b38850;
            text-decoration: none;
            font-weight: 500;
            border-bottom: 1px dotted #b38850;
        }
        .divider {
            border: none;
            height: 3px;
            background: linear-gradient(to right, #b38850, #5099b3, transparent);
            margin: 50px 0;
            border-radius: 2px;
        }
        .footer {
            text-align: center;
            color: #666;
            font-size: 15px;
            margin-top: 40px;
            padding-top: 30px;
            border-top: 2px solid #eee;
        }
        small {
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <div class="greeting">你好</div>
            <div class="intro">感謝你透過 FlyAsia 訂購 <strong>giffgaff SIM 卡</strong><br>我們已經為你安排寄出</div>
        </div>

        <!-- 寄送資訊 -->
        <div class="section-title">📦 SIM 卡寄送資訊</div>

        <div class="info-box">
            <div class="info-title">📮 郵件詳情</div>
            <p>你好，我們已經寄出你的 <span class="highlight-text">giffgaff 電話卡</span>。</p>
            <p>香港郵政應該會在數個工作天內將電話卡送抵以下地址：</p>
            <p class="highlight-text">${row.shipping_address}</p>

            <p><strong>追蹤編號：</strong></p>
            <div class="tracking-number">${row.tracking_no}</div>
        </div>

        <div class="info-box">
            <div class="info-title">⏰ 預計配送時間</div>
            <p><strong>🇭🇰 香港本地：</strong>約 1-5 個工作天</p>
            <small>實際時間可能因郵政安排有所延誤，敬請留意。</small>
        </div>

        <div class="info-box highlight">
            <div class="info-title">📍 追蹤郵件</div>
            <p>你可以到以下網站查詢派遞狀態：</p>
            <p>
                <a href="https://webapp.hongkongpost.hk/tc/mail_tracking/index.html">
                    香港郵政郵件追蹤
                </a>
            </p>
        </div>

        <hr class="divider">

        <!-- 使用提示 -->
        <div class="section-title">📱 使用提示</div>

        <div class="info-box">
            <div class="info-title">💡 開卡及使用</div>
            <p>收到 SIM 卡後，你可按照官方指示插卡並啟動服務。</p>
            <p>詳細使用教學可參考：</p>
            <p>
                <a href="https://www.flyasia.co/2026/giffgaff/">
                    https://www.flyasia.co/2026/giffgaff/
                </a>
            </p>
        </div>

        <hr class="divider">

        <!-- 聯絡 -->
        <div class="section-title">📞 聯絡我們</div>

        <div class="info-box">
            <div class="info-title">FlyAsia 客戶支援</div>
            <p><strong>Email：</strong><a href="mailto:sim@flyasia.co">sim@flyasia.co</a></p>
            <p><strong>網站：</strong><a href="https://www.flyasia.co">https://www.flyasia.co</a></p>
        </div>

        <div class="footer">
            <div style="background-color: #fff5f5; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <p style="margin: 0; font-size: 15px; color: #666;">
                    <strong>📧 電郵查詢注意事項：</strong><br>
                    由於目前訂單及查詢較多，電郵查詢回覆時間或會較長。我們會優先回覆較舊的電郵，重複寄送電郵可能減慢回覆進度，敬請原諒！
                </p>
            </div>
        </div>
    </div>
</body>
</html>`;
}

// ── Helpers ─────────────────────────────────────────────────────

function getColMap(headers) {
  const map = {};
  headers.forEach((h, i) => { const k = String(h).trim(); if (k) map[k] = i; });
  return map;
}

// ── One-time Setup (run once, then delete) ──────────────────────
// function setApiKey() {
//   PropertiesService.getScriptProperties().setProperty('SENDGRID_API_KEY', 'SG.YOUR_KEY_HERE');
// }
