// ── Constants ──────────────────────────────────────────────────
// Container-bound: use SpreadsheetApp.getActiveSpreadsheet() instead of openById().
// SPREADSHEET_ID is kept here for reference/documentation only.
const SPREADSHEET_ID = '13CtkHUt-Cmia8rC3gL2AWCWcM7eo-v9V8mftC5g4iKk';
const SHEET_NAME = 'First Submission';
const FROM_EMAIL = 'sim@flyasia.co';
const FROM_NAME = 'FlyAsia x LuckySIM';
const ERROR_ALERT_EMAIL = 'luckysim.flyasia@gmail.com';

// ── API Key (retrieved from Script Properties) ──────────────────
// Set once via: PropertiesService.getScriptProperties().setProperty('SENDGRID_API_KEY', 'SG.xxx...')
const SENDGRID_API_KEY = PropertiesService.getScriptProperties().getProperty('SENDGRID_API_KEY');

// ── Menu Setup ─────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LuckySIM')
    .addItem('Send Shipping Notifications Now', 'triggerManualSend')
    .addToUi();
}

function triggerManualSend() {
  sendShippingNotifications();
}

// ── Main Logic ─────────────────────────────────────────────────

function sendShippingNotifications() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const allValues = sheet.getDataRange().getValues();
  const colMap = getColMap(allValues[0]);
  const dataRows = allValues.slice(1);

  const eligible = dataRows.filter(row => {
    return row[colMap['shipping_noti_sent?']] === false
      && row[colMap['Applied?']] === true
      && row[colMap['shipped?']] === true
      && String(row[colMap['tracking_id']]).trim() !== '';
  });

  console.log(`[${new Date().toISOString()}] Script started. Eligible rows: ${eligible.length}`);

  const failedRows = [];

  for (const row of eligible) {
    const rowData = {
      email:                row[colMap['email']],
      phone_hk:             row[colMap['phone_hk']],
      legal_name_eng:       row[colMap['legal_name_eng']],
      plan_type:            row[colMap['plan_type']],
      sim_no:               row[colMap['sim_no']],
      tracking_id:          row[colMap['tracking_id']],
      shipping_address_line: row[colMap['shipping_address_line']],
      activate_date:        row[colMap['activate_date']],
    };

    // Determine 1-indexed sheet row number (header is row 1, data starts at row 2)
    const sheetRowIndex = allValues.indexOf(row) + 1;

    console.log(`Processing: phone_hk=${rowData.phone_hk}, email=${rowData.email}`);

    try {
      const subject = `我們已寄出你的 LuckySIM | ${rowData.phone_hk}`;
      const htmlBody = buildEmailHtml(rowData);
      sendGridEmail(rowData.email, subject, htmlBody);

      sheet.getRange(sheetRowIndex, colMap['shipping_noti_sent?'] + 1).setValue(true);
      console.log(`Success: phone_hk=${rowData.phone_hk}`);
    } catch (err) {
      console.error(`Failed: phone_hk=${rowData.phone_hk}, error=${err.message}`);
      failedRows.push({ phone_hk: rowData.phone_hk, email: rowData.email, error: err.message });
    }
  }

  if (failedRows.length > 0) {
    sendErrorAlertEmail(failedRows);
  }

  console.log(`[${new Date().toISOString()}] Done. Sent: ${eligible.length - failedRows.length}, Failed: ${failedRows.length}`);
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
  // SendGrid returns 202 Accepted on success — no response body to parse
}

// ── Error Alert ─────────────────────────────────────────────────

function sendErrorAlertEmail(failedRows) {
  const subject = `[LuckySIM] Shipping notification failed for ${failedRows.length} row(s)`;
  const body = failedRows.map(r =>
    `phone_hk: ${r.phone_hk}\nemail: ${r.email}\nerror: ${r.error}`
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
    <title>Lucky SIM 轉台通知</title>
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
        .info-box.warning {
            background-color: #fff5f5;
            border-left-color: #b20000;
            border: 2px solid #b20000;
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
            display: flex;
            align-items: center;
        }
        .info-box.warning .info-title {
            color: #b20000;
        }
        .info-box.highlight .info-title {
            color: #5099b3;
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
        .step-list {
            counter-reset: step-counter;
            padding: 0;
            margin: 0;
        }
        .step-item {
            counter-increment: step-counter;
            background-color: #f9f7f4;
            margin: 20px 0;
            padding: 25px;
            border-radius: 8px;
            border-left: 4px solid #b38850;
            position: relative;
            font-size: 16px;
        }
        .step-item:before {
            content: counter(step-counter);
            position: absolute;
            left: -15px;
            top: 20px;
            background-color: #b38850;
            color: white;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 16px;
        }
        .step-title {
            font-weight: bold;
            font-size: 18px;
            color: #b38850;
            margin-bottom: 10px;
        }
        a {
            color: #b38850;
            text-decoration: none;
            font-weight: 500;
            border-bottom: 1px dotted #b38850;
        }
        a:hover {
            color: #8b6a3d;
            border-bottom: 1px solid #8b6a3d;
        }
        .contact-section {
            background-color: #f0f4f7;
            border-radius: 12px;
            padding: 30px;
            margin: 30px 0;
            text-align: center;
        }
        .contact-title {
            font-size: 20px;
            font-weight: bold;
            color: #5099b3;
            margin-bottom: 20px;
        }
        .contact-item {
            margin: 10px 0;
            font-size: 16px;
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
            <div class="greeting">Hello ${row.legal_name_eng}</div>
            <div class="intro">感謝你購買 <strong>${row.plan_type}</strong> 計劃<br>我們已收到你透過 FlyAsia 提交攜號轉台至 Lucky SIM 的申請</div>
        </div>

        <!-- SIM卡寄送資訊 -->
        <div class="section-title">📦 SIM 卡寄送資訊</div>

        <div class="info-box">
            <div class="info-title">📮 郵件詳情</div>
            <p>我們已將你 <span class="highlight-text">${row.phone_hk}</span> 的 SIM 卡（卡號：${row.sim_no}）透過掛號方式經香港郵政寄出。</p>
            <p><strong>郵件編號：</strong></p>
            <div class="tracking-number">${row.tracking_id}</div>
        </div>

        <div class="info-box">
            <div class="info-title">📍 收件地址</div>
            <p>郵件以掛號形式寄至：<span class="highlight-text">${row.shipping_address_line}</span></p>
            <p>請留意電話來電/SMS通知。如需追查郵件配送進度，請到<a href="https://webapp.hongkongpost.hk/tc/mail_tracking/index.html">香港郵政局網站</a>輸入郵件編號查詢。</p>
        </div>

        <div class="info-box">
            <div class="info-title">⏰ 預計配送時間</div>
            <p><strong>🇭🇰 香港本地：</strong>約 2-5 個工作天</p>
            <p><strong>🌏 香港以外地區：</strong>空郵掛號需時 10-14 個工作天不等</p>
            <small>受香港空運限制或其他不確定因素影響，實際郵遞時間有機會需時兩至三個星期或以上。</small>
        </div>

        <div class="info-box warning">
            <div class="info-title">⚠️ 特別提醒 - 加拿大／澳洲／德國／荷蘭</div>
            <p>我們只能透過香港郵政網站得知郵件是否已完成清關並離開香港。離開香港後的派遞狀態，因上述國家郵政機關未提供國際郵件實時資訊，我們無從得知。</p>
            <p>如欲查詢郵件在上述國家境內的狀態，請直接向當地郵政機關查詢。</p>
        </div>

        <hr class="divider">

        <!-- 收卡及開卡指南 -->
        <div class="section-title">📋 收卡及開卡指南</div>

        <div class="step-list">
            <div class="step-item">
                <div class="step-title">妥善保存 SIM 卡</div>
                如遺失補領須另收 <span class="highlight-text">HK\$100</span>，過程中需出示大卡證明書。建議收到 SIM 卡後及早拍照作紀錄。
                <br><small>有關補領詳情，請參考 Lucky SIM Facebook 常見問題</small>
            </div>

            <div class="step-item">
                <div class="step-title">注意開卡時間</div>
                即使提早收到 SIM 卡，最快要等到 <span class="highlight-text">轉台日 ${row.activate_date} 的 3AM 後</span> 才能開卡，並確認是否成功轉台。
            </div>

            <div class="step-item">
                <div class="step-title">確保資料正確</div>
                請確保號碼在轉台日前未失效，及所有申請資料正確。如資料不正確將轉台失敗，需重新申請，轉台日將延遲約 <span class="highlight-text">3-5 個工作天</span>。
            </div>

            <div class="step-item">
                <div class="step-title">完成實名登記</div>
                開卡後請確認是否已完成實名登記。可到 <a href="https://rnr.luckysim.com.hk/query/input">Lucky SIM 實名登記查詢頁面</a> 確認狀態。
            </div>
        </div>

        <div class="info-box">
            <div class="info-title">📅 更改轉台日期</div>
            <p>如需在轉台日前更改轉台日期，請到：<a href="http://go.flyasia.co/luckysim-fee">http://go.flyasia.co/luckysim-fee</a></p>
        </div>

        <hr class="divider">

        <!-- 增值續期指南 -->
        <div class="section-title">💰 增值續期指南</div>

        <div class="info-box">
            <div class="info-title">🔄 如何增值續期</div>
            <p>FlyAsia 主要負責轉台申請，增值續期無需聯絡我們。</p>
            <p><strong>最快方法：</strong>直接到 Lucky SIM 官網首頁自行增值：<br>
            <a href="http://www.luckysim.com.hk/">http://www.luckysim.com.hk/</a></p>
        </div>

        <div class="info-box warning">
            <div class="info-title">⚠️ 重要提醒</div>
            <p>記得到期前需預早增值，否則電話號碼會失效且<span class="highlight-text">無法取回</span>！</p>
        </div>

        <hr class="divider">

        <!-- 客戶服務及資源 -->
        <div class="section-title">📞 客戶服務及更多資源</div>

        <div class="info-box highlight">
            <div class="info-title">📚 詳細 FAQ 頁面</div>
            <p>如果你有更多關於使用、開卡或郵寄的問題，請查閱我們的詳細 FAQ：</p>
            <p style="text-align: center; margin: 15px 0;">
                <a href="https://go.flyasia.co/luckysim-faq" style="font-size: 18px; font-weight: bold;">https://go.flyasia.co/luckysim-faq</a>
            </p>
        </div>

        <div class="contact-section">
            <div class="contact-title">Lucky SIM 香港客戶服務</div>
            <div class="contact-item"><strong>熱線：</strong>(852) 3188 2226</div>
            <div class="contact-item"><strong>Email：</strong>cs@luckysim.com.hk</div>
            <div class="contact-item"><strong>Facebook：</strong><a href="https://www.facebook.com/LuckySIMhk">https://www.facebook.com/LuckySIMhk</a></div>
            <div class="contact-item"><strong>官方網站：</strong><a href="https://www.luckysim.com.hk/TnC">https://www.luckysim.com.hk/TnC</a></div>
        </div>

        <div class="contact-section">
            <div class="contact-title">FlyAsia 聯絡資訊</div>
            <div class="contact-item"><strong>網站：</strong><a href="https://www.flyasia.co">https://www.flyasia.co</a></div>
            <div class="contact-item"><strong>Email：</strong><a href="mailto:sim@flyasia.co">sim@flyasia.co</a></div>
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
  headers.forEach((h, i) => { map[h.trim()] = i; });
  return map;
}

// ── One-time Setup (run once, then delete) ──────────────────────
// function setApiKey() {
//   PropertiesService.getScriptProperties().setProperty('SENDGRID_API_KEY', 'SG.YOUR_KEY_HERE');
// }
