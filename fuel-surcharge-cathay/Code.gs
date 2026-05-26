// ── Configuration ──────────────────────────────────────────────
// Container-bound: fill DATA_SPREADSHEET_ID with the sheet ID after creating it.
const DATA_SPREADSHEET_ID = 'YOUR_SHEET_ID_HERE';
const DATA_SHEET_NAME     = 'YQ Data';
const ALERT_EMAIL  = 'info@flyasia.co';
const FROM_EMAIL   = 'info@flyasia.co';
const WP_SITE      = 'https://www.flyasia.co';
const WP_POST_ID   = 18512;
const USD_TO_HKD   = 7.85;

// Cathay Pacific fuel surcharge page (Chinese)
const CATHAY_YQ_URL = 'https://www.cathaypacific.com/cx/zh_HK/latest-news/other-news/fuel-surcharge-updates.html';

// Rates change on the 1st and 15th; run hourly but only act daily outside that window.
// HIGH_FREQ_DAYS: ±2 days around each change date.
const HIGH_FREQ_DAYS = new Set([28, 29, 30, 31, 1, 2, 3, 13, 14, 15, 16, 17]);

// ── Menu / Triggers ─────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('YQ Monitor')
    .addItem('Run Check Now',       'triggerManualRun')
    .addItem('Generate & Upload Chart', 'triggerChartUpload')
    .addToUi();
}

function triggerManualRun()   { runFuelSurchargeMonitor(); }
function triggerChartUpload() { generateAndUploadChart();  }

// ── Main Logic ──────────────────────────────────────────────────

function runFuelSurchargeMonitor() {
  const props = PropertiesService.getScriptProperties();
  const now   = new Date();
  const dateLabel = Utilities.formatDate(now, 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss');

  // Frequency gate: outside high-freq window, skip if checked within last 20 hours
  const dayOfMonth = parseInt(Utilities.formatDate(now, 'Asia/Hong_Kong', 'd'));
  if (!HIGH_FREQ_DAYS.has(dayOfMonth)) {
    const lastCheck = props.getProperty('YQ_LAST_CHECK');
    if (lastCheck) {
      const hoursSince = (now - new Date(lastCheck)) / 3600000;
      if (hoursSince < 20) {
        console.log(`[${dateLabel}] Skipping: last check ${hoursSince.toFixed(1)}h ago (non high-freq day ${dayOfMonth})`);
        return;
      }
    }
  }

  props.setProperty('YQ_LAST_CHECK', now.toISOString());
  console.log(`[${dateLabel}] Running Cathay YQ fuel surcharge monitor (day ${dayOfMonth})`);

  const html = fetchUrl(CATHAY_YQ_URL);
  if (!html) {
    console.error('Failed to fetch Cathay YQ page');
    sendErrorAlert('Failed to fetch Cathay fuel surcharge page', dateLabel);
    return;
  }

  const current = extractYQRates(html);
  if (!current) {
    console.error('Could not extract YQ rates from page — HTML structure may have changed');
    sendErrorAlert('Could not extract YQ rates — page structure may have changed', dateLabel);
    return;
  }

  console.log(`Scraped: short=${current.shortHaul} HKD, long=${current.longHaul} HKD`);

  const lastShort = parseInt(props.getProperty('YQ_LAST_SHORT') || '0');
  const lastLong  = parseInt(props.getProperty('YQ_LAST_LONG')  || '0');

  if (current.shortHaul === lastShort && current.longHaul === lastLong) {
    console.log(`No change detected (short=${lastShort}, long=${lastLong}) — nothing to do`);
    return;
  }

  console.log(`Rate change detected! ${lastShort}/${lastLong} → ${current.shortHaul}/${current.longHaul}`);

  // Log to sheet
  logRateChange(now, current.shortHaul, current.longHaul);

  // Generate chart PNG and upload to WordPress
  const mediaId = generateAndUploadChart();

  // Update blog post
  if (mediaId) {
    updateBlogPost(current, now, mediaId);
  } else {
    console.warn('Chart upload failed — updating blog post without new chart');
    updateBlogPost(current, now, null);
  }

  // Save state
  props.setProperty('YQ_LAST_SHORT', String(current.shortHaul));
  props.setProperty('YQ_LAST_LONG',  String(current.longHaul));
  props.setProperty('YQ_LAST_CHANGE', now.toISOString());

  sendRateChangeAlert(lastShort, lastLong, current.shortHaul, current.longHaul, now);
  console.log('Monitor run complete');
}

// ── Cathay Page Scraping ────────────────────────────────────────

function fetchUrl(url) {
  try {
    const res = UrlFetchApp.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.8',
      },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error(`HTTP ${res.getResponseCode()} for ${url}`);
      return null;
    }
    return res.getContentText();
  } catch (e) {
    console.error(`Fetch error: ${e.message}`);
    return null;
  }
}

// Returns { shortHaul: int, longHaul: int } in HKD, or null if not found.
// Cathay's page lists short-haul (短途) and long-haul (長途) YQ in HKD.
// If this returns null after a change to Cathay's site, inspect the page source
// and update the regex patterns below accordingly.
function extractYQRates(html) {
  // Pattern A: table cells near 短途 and 長途 labels
  const shortMatch = html.match(/短途[\s\S]{0,300}?HK\$?\s*(\d+)/);
  const longMatch  = html.match(/長途[\s\S]{0,300}?HK\$?\s*(\d+)/);

  if (shortMatch && longMatch) {
    return { shortHaul: parseInt(shortMatch[1]), longHaul: parseInt(longMatch[1]) };
  }

  // Pattern B: look for two consecutive HKD integer values after a surcharge heading
  const tableMatch = html.match(/(?:fuel.surcharge|燃油附加費)[\s\S]{0,1000}?(\d{2,4})[\s\S]{0,200}?(\d{3,4})/i);
  if (tableMatch) {
    return { shortHaul: parseInt(tableMatch[1]), longHaul: parseInt(tableMatch[2]) };
  }

  // Pattern C: look for the two distinct HKD amounts (short < long) anywhere on page
  const allAmounts = [...html.matchAll(/HK\$?\s*(\d{2,4})/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n >= 50 && n <= 3000);
  const unique = [...new Set(allAmounts)].sort((a, b) => a - b);
  if (unique.length >= 2) {
    console.warn(`extractYQRates: using fallback pattern C — values found: ${unique.join(', ')}. Verify correctness.`);
    return { shortHaul: unique[0], longHaul: unique[unique.length - 1] };
  }

  return null;
}

// ── Chart Generation ────────────────────────────────────────────

// Generates a PNG trend chart from the YQ Data sheet and uploads it to WordPress.
// Returns the WordPress media ID (integer) on success, or null on failure.
function generateAndUploadChart() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${DATA_SHEET_NAME}" not found`);
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    console.warn('Not enough data to generate chart');
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // skip header

  // Build data table for Charts service
  const dataTable = Charts.newDataTable()
    .addColumn(Charts.ColumnType.DATE,   '日期')
    .addColumn(Charts.ColumnType.NUMBER, '短途 (HKD)')
    .addColumn(Charts.ColumnType.NUMBER, '長途 (HKD)');

  values.forEach(row => {
    const date = row[0] instanceof Date ? row[0] : new Date(row[0]);
    const sh   = Number(row[1]);
    const lh   = Number(row[2]);
    if (!isNaN(date.getTime()) && !isNaN(sh) && !isNaN(lh)) {
      dataTable.addRow([date, sh, lh]);
    }
  });
  dataTable.build();

  const chart = Charts.newLineChart()
    .setDataTable(dataTable)
    .setTitle('Cathay Pacific 燃油附加費 (YQ) 趨勢')
    .setXAxisTitle('')
    .setYAxisTitle('HKD')
    .setColors(['#b38850', '#b20000'])
    .setDimensions(960, 480)
    .setOption('legend', { position: 'bottom' })
    .setOption('vAxis', { minValue: 0, gridlines: { count: 6 } })
    .setOption('chartArea', { left: 60, top: 40, right: 20, bottom: 60 })
    .setOption('lineWidth', 2)
    .setOption('pointSize', 4)
    .build();

  const blob = chart.getAs('image/png').setName('cx-yq-chart.png');
  console.log(`Chart PNG generated (${(blob.getBytes().length / 1024).toFixed(0)} KB)`);

  return uploadImageToWP(blob);
}

// ── WordPress API ───────────────────────────────────────────────

function wpAuthHeader() {
  const props = PropertiesService.getScriptProperties();
  const user  = props.getProperty('WP_USERNAME') || 'ai@flyasia.co';
  const pass  = props.getProperty('WP_APP_PASSWORD');
  return 'Basic ' + Utilities.base64Encode(`${user}:${pass}`);
}

// Uploads a PNG blob to WordPress media library.
// Returns the media ID (integer) or null on failure.
function uploadImageToWP(blob) {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/media`, {
      method: 'post',
      headers: {
        Authorization:       wpAuthHeader(),
        'Content-Disposition': 'attachment; filename="cx-yq-chart.png"',
        'Content-Type':      'image/png',
      },
      payload: blob.getBytes(),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      console.error(`WP media upload failed: ${res.getResponseCode()} ${res.getContentText().substring(0, 300)}`);
      return null;
    }
    const media = JSON.parse(res.getContentText());
    console.log(`Chart uploaded to WP: media ID=${media.id}, URL=${media.source_url}`);
    return media.id;
  } catch (e) {
    console.error(`WP media upload error: ${e.message}`);
    return null;
  }
}

function fetchWPPostRaw() {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}?context=edit`, {
      headers: { Authorization: wpAuthHeader() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error(`WP GET raw failed: ${res.getResponseCode()}`);
      return null;
    }
    return JSON.parse(res.getContentText()).content.raw;
  } catch (e) {
    console.error(`WP raw fetch error: ${e.message}`);
    return null;
  }
}

function pushWPPost(rawContent, mediaId) {
  try {
    const payload = { content: rawContent };
    if (mediaId) payload.featured_media = mediaId;
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: wpAuthHeader() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      console.error(`WP POST failed: ${res.getResponseCode()} ${res.getContentText().substring(0, 300)}`);
      return false;
    }
    console.log(`Blog post ${WP_POST_ID} updated (HTTP ${res.getResponseCode()})`);
    return true;
  } catch (e) {
    console.error(`WP push error: ${e.message}`);
    return false;
  }
}

// ── Blog Post Update ────────────────────────────────────────────

function updateBlogPost(rates, date, mediaId) {
  const rawContent = fetchWPPostRaw();
  if (!rawContent) return;

  let updated = updateYQDateLine(rawContent, date);
  updated = updateYQRateValues(updated, rates.shortHaul, rates.longHaul);

  pushWPPost(updated, mediaId);
}

// Updates last-updated date reference in the post.
// Adjust the regex below to match your actual post copy once the post is live.
function updateYQDateLine(content, date) {
  const chineseDate = formatChineseDate(date);

  // Pattern: 更新日期：YYYY 年 M 月 D 日  (adjust to match actual post)
  content = content.replace(
    /更新日期：\d{4} 年 \d{1,2} 月 \d{1,2} 日/,
    `更新日期：${chineseDate}`
  );
  // Also handles: 截至 YYYY 年 M 月 D 日 更新
  content = content.replace(
    /截至 \d{4} 年 \d{1,2} 月 \d{1,2} 日/,
    `截至 ${chineseDate}`
  );
  return content;
}

// Updates the short-haul and long-haul YQ rate values in the post table.
// Adjust the regex patterns to match your actual post table structure.
function updateYQRateValues(content, shortHaul, longHaul) {
  // Pattern: table cell immediately following 短途 label
  // e.g. <td>短途</td><td>HK$633</td>
  content = content.replace(
    /(短途(?:<\/[^>]+>)?<\/td>\s*<td[^>]*>)HK\$\d+/,
    `$1HK$${shortHaul}`
  );
  // e.g. <td>長途</td><td>HK$1362</td>
  content = content.replace(
    /(長途(?:<\/[^>]+>)?<\/td>\s*<td[^>]*>)HK\$\d+/,
    `$1HK$${longHaul}`
  );
  return content;
}

// ── Sheet Logging ───────────────────────────────────────────────

function logRateChange(date, shortHaul, longHaul) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${DATA_SHEET_NAME}" not found`);
    return;
  }
  const dateStr = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy-MM-dd');
  sheet.appendRow([dateStr, shortHaul, longHaul]);
  console.log(`Logged: ${dateStr} | short=${shortHaul} | long=${longHaul}`);
}

// ── Notification Emails ─────────────────────────────────────────

function sendRateChangeAlert(oldShort, oldLong, newShort, newLong, date) {
  const dateStr = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy-MM-dd');
  const subject = `[Cathay YQ] 燃油附加費更新 | 短途 HK$${newShort} | 長途 HK$${newLong} | ${dateStr}`;
  const body = [
    `Cathay Pacific 燃油附加費有變更。`,
    ``,
    `短途 (Short Haul):  HK$${oldShort} → HK$${newShort}`,
    `長途 (Long Haul):   HK$${oldLong} → HK$${newLong}`,
    ``,
    `博客文章已自動更新: ${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`,
    `請確認以下更新是否正確:`,
    `  - 日期已更新`,
    `  - 短途/長途金額已更新`,
    `  - 圖表已更新`,
  ].join('\n');
  GmailApp.sendEmail(ALERT_EMAIL, subject, body, { from: FROM_EMAIL });
  console.log(`Rate change alert sent: ${subject}`);
}

function sendErrorAlert(message, dateLabel) {
  GmailApp.sendEmail(
    ALERT_EMAIL,
    `[Cathay YQ Monitor] ⚠ 錯誤 — ${dateLabel}`,
    `Cathay YQ 監控出現問題:\n\n${message}\n\n請手動檢查: ${CATHAY_YQ_URL}`,
    { from: FROM_EMAIL }
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function formatChineseDate(date) {
  const y = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy');
  const m = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'M'));
  const d = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'd'));
  return `${y} 年 ${m} 月 ${d} 日`;
}

// ── One-time Setup ──────────────────────────────────────────────
// 1. Create a new Google Sheet. Add a tab named 'YQ Data' with headers:
//    A1=date | B1=short_haul_hkd | C1=long_haul_hkd
//    Then import cx_yq_history.csv into rows 2 onward.
// 2. In Project Settings, set the timezone to Asia/Hong_Kong.
// 3. Set Script Properties:
//    WP_USERNAME      → ai@flyasia.co
//    WP_APP_PASSWORD  → (WordPress application password)
// 4. Fill in DATA_SPREADSHEET_ID at the top of this file with your sheet ID.
// 5. Run setupTrigger() once to create the hourly trigger.
// 6. Run triggerManualRun() to verify the first run.

// function setupTrigger() {
//   ScriptApp.newTrigger('runFuelSurchargeMonitor')
//     .timeBased()
//     .everyHours(1)
//     .create();
// }
