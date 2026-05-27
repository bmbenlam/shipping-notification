// ── Configuration ──────────────────────────────────────────────
// Container-bound: fill DATA_SPREADSHEET_ID with the sheet ID after creating it.
const DATA_SPREADSHEET_ID = 'YOUR_SHEET_ID_HERE';
const DATA_SHEET_NAME     = 'YQ Data';
const ALERT_EMAIL  = 'info@flyasia.co';
const FROM_EMAIL   = 'info@flyasia.co';
const WP_SITE      = 'https://www.flyasia.co';
const WP_POST_ID   = 18512;

// Cathay Pacific fuel surcharge page (Chinese)
const CATHAY_YQ_URL = 'https://www.cathaypacific.com/cx/zh_HK/latest-news/other-news/fuel-surcharge-updates.html';

// Rates change on the 1st and 15th; run hourly but only act daily outside that window.
// HIGH_FREQ_DAYS: ±2 days around each expected change date.
const HIGH_FREQ_DAYS = new Set([28, 29, 30, 31, 1, 2, 3, 13, 14, 15, 16, 17]);

// ── Menu / Triggers ─────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('YQ Monitor')
    .addItem('Run Check Now',          'triggerManualRun')
    .addItem('Setup Charts (first run)', 'setupCharts')
    .addItem('Insert Charts into Post',  'insertChartsIntoPost')
    .addToUi();
}

function triggerManualRun()      { runFuelSurchargeMonitor(); }

// ── Main Logic ──────────────────────────────────────────────────

function runFuelSurchargeMonitor() {
  const props     = PropertiesService.getScriptProperties();
  const now       = new Date();
  const dateLabel = Utilities.formatDate(now, 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss');

  // Frequency gate: outside high-freq window, skip if checked within last 20 hours
  const dayOfMonth = parseInt(Utilities.formatDate(now, 'Asia/Hong_Kong', 'd'));
  if (!HIGH_FREQ_DAYS.has(dayOfMonth)) {
    const lastCheck = props.getProperty('YQ_LAST_CHECK');
    if (lastCheck) {
      const hoursSince = (now - new Date(lastCheck)) / 3600000;
      if (hoursSince < 20) {
        console.log(`[${dateLabel}] Skipping: last check ${hoursSince.toFixed(1)}h ago (day ${dayOfMonth})`);
        return;
      }
    }
  }

  props.setProperty('YQ_LAST_CHECK', now.toISOString());
  console.log(`[${dateLabel}] Running Cathay YQ monitor (day ${dayOfMonth})`);

  const html = fetchUrl(CATHAY_YQ_URL);
  if (!html) {
    sendErrorAlert('Failed to fetch Cathay fuel surcharge page', dateLabel);
    return;
  }

  const current = extractYQRates(html);
  if (!current) {
    sendErrorAlert('Could not extract YQ rates — page structure may have changed', dateLabel);
    return;
  }

  console.log(`Scraped: short=${current.short} HKD, medium=${current.medium} HKD, long=${current.long} HKD`);

  const prevShort  = parseInt(props.getProperty('YQ_LAST_SHORT')  || '0');
  const prevMedium = parseInt(props.getProperty('YQ_LAST_MEDIUM') || '0');
  const prevLong   = parseInt(props.getProperty('YQ_LAST_LONG')   || '0');

  if (current.short === prevShort && current.medium === prevMedium && current.long === prevLong) {
    console.log(`No change (short=${prevShort}, medium=${prevMedium}, long=${prevLong})`);
    return;
  }

  console.log(`Rate change: ${prevShort}/${prevMedium}/${prevLong} → ${current.short}/${current.medium}/${current.long}`);

  logRateChange(now, current.short, current.medium, current.long);

  const prev = { short: prevShort, medium: prevMedium, long: prevLong };
  updateBlogPost(current, prev, now);

  props.setProperty('YQ_LAST_SHORT',  String(current.short));
  props.setProperty('YQ_LAST_MEDIUM', String(current.medium));
  props.setProperty('YQ_LAST_LONG',   String(current.long));
  props.setProperty('YQ_LAST_CHANGE', now.toISOString());

  sendRateChangeAlert(prev, current, now);
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

// Returns { short, medium, long } in HKD integers, or null.
// Cathay's page lists short-haul (短途), medium-haul (中途), long-haul (長途).
// If null is returned after a page change, inspect the source and update patterns below.
function extractYQRates(html) {
  // Pattern A: three labeled rows for 短途, 中途, 長途
  const shortMatch  = html.match(/短途[\s\S]{0,400}?(?:HK\$|HKD\s*)(\d[\d,]*)/);
  const mediumMatch = html.match(/中途[\s\S]{0,400}?(?:HK\$|HKD\s*)(\d[\d,]*)/);
  const longMatch   = html.match(/長途[\s\S]{0,400}?(?:HK\$|HKD\s*)(\d[\d,]*)/);

  if (shortMatch && mediumMatch && longMatch) {
    return {
      short:  parseInt(shortMatch[1].replace(/,/g, '')),
      medium: parseInt(mediumMatch[1].replace(/,/g, '')),
      long:   parseInt(longMatch[1].replace(/,/g, '')),
    };
  }

  // Pattern B: look for short+medium (different amounts) + long (highest)
  const allHKD = [...html.matchAll(/(?:HK\$|HKD\s*)(\d[\d,]*)/g)]
    .map(m => parseInt(m[1].replace(/,/g, '')))
    .filter(n => n >= 50 && n <= 5000);
  const unique = [...new Set(allHKD)].sort((a, b) => a - b);
  if (unique.length >= 3) {
    console.warn(`extractYQRates: fallback pattern B used — values: ${unique.join(', ')}. Verify correctness.`);
    return { short: unique[0], medium: unique[1], long: unique[unique.length - 1] };
  }

  return null;
}

// ── Blog Post Update ────────────────────────────────────────────

function updateBlogPost(current, prev, date) {
  const rawContent = fetchWPPostRaw();
  if (!rawContent) return;

  let updated = updateDateLine(rawContent, date);
  updated = updateCurrentRatesTable(updated, current, prev, date);
  updated = prependHistoryRow(updated, current, date);

  pushWPPost(updated);
}

// Updates: <strong>更新日期：YYYY 年 M 月 D 日</strong>
function updateDateLine(content, date) {
  return content.replace(
    /(<strong>更新日期：)\d{4} 年 \d{1,2} 月 \d{1,2} 日(<\/strong>)/,
    `$1${formatChineseDate(date)}$2`
  );
}

// Updates the 3 rows in the current-rates table (rate, effective date, ▲▼ comparison)
function updateCurrentRatesTable(content, current, prev, date) {
  const effectiveDate = `${formatChineseDate(date)}起`;

  // Short haul row: <strong>短途</strong> ... </td><td>HK$XXX</td><td>日期</td><td>▲▼ HK$X</td>
  content = replaceRateRow(content, '短途', current.short,  prev.short,  effectiveDate);
  content = replaceRateRow(content, '中途', current.medium, prev.medium, effectiveDate);
  content = replaceRateRow(content, '長途', current.long,   prev.long,   effectiveDate);

  return content;
}

function replaceRateRow(content, label, newRate, prevRate, effectiveDate) {
  const diff = newRate - prevRate;
  const compareText = diff === 0 ? '—'
    : (diff > 0 ? '▲ ' : '▼ ') + formatHKD(Math.abs(diff));

  return content.replace(
    new RegExp(
      `(<strong>${label}<\/strong>[\\s\\S]{0,300}?<\/td>\\s*<td>)` +
      `HK\\$[\\d,]+` +
      `(<\/td>\\s*<td>)[^<]+(起?<\/td>\\s*<td>)` +
      `[^<]*(<\/td>)`
    ),
    `$1${formatHKD(newRate)}$2${effectiveDate}$3${compareText}$4`
  );
}

// Prepends a new row to the historical rates table
// (the table whose <thead> contains 生效日期/短途/中途/長途)
function prependHistoryRow(content, rates, date) {
  const dateCell = formatChineseDateNoDay(date); // "YYYY 年 M 月 D 日" (full)
  const newRow = `<tr><td>${formatChineseDate(date)}</td><td>${formatHKD(rates.short)}</td><td>${formatHKD(rates.medium)}</td><td>${formatHKD(rates.long)}</td></tr>`;

  // Find the tbody of the history table (identified by 生效日期 in its thead)
  return content.replace(
    /(生效日期<\/th>[\s\S]{0,200}?<tbody>)/,
    `$1${newRow}`
  );
}

// ── Interactive Charts Setup ────────────────────────────────────
// Charts live in Google Sheets. They update automatically as data is appended.
// Steps:
//   1. Run setupCharts() once from the menu to create the 3 embedded charts.
//   2. Publish the Google Sheet (File → Share → Publish to the web).
//   3. Run insertChartsIntoPost() to embed the iframes into the WP post.

function setupCharts() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) { console.error('YQ Data sheet not found'); return; }

  const props   = PropertiesService.getScriptProperties();
  const lastRow = sheet.getLastRow();

  // Remove all existing charts first (clean slate)
  sheet.getCharts().forEach(c => sheet.removeChart(c));

  const chartDefs = [
    { col: 2, color: '#b38850', label: '短途 YQ (HKD)',  propKey: 'CHART_OID_SHORT',  anchorRow: 2,  anchorCol: 6 },
    { col: 3, color: '#d4850a', label: '中途 YQ (HKD)',  propKey: 'CHART_OID_MEDIUM', anchorRow: 22, anchorCol: 6 },
    { col: 4, color: '#b20000', label: '長途 YQ (HKD)',  propKey: 'CHART_OID_LONG',   anchorRow: 42, anchorCol: 6 },
  ];

  chartDefs.forEach(def => {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sheet.getRange(1, 1, lastRow, 1)) // date column (col A)
      .addRange(sheet.getRange(1, def.col, lastRow, 1)) // value column
      .setOption('title', '國泰燃油附加費 — ' + def.label)
      .setOption('colors', [def.color])
      .setOption('hAxis.format', 'MMM yyyy')
      .setOption('hAxis.title', '')
      .setOption('vAxis.title', 'HKD')
      .setOption('vAxis.minValue', 0)
      .setOption('legend.position', 'none')
      .setOption('lineWidth', 2)
      .setOption('pointSize', 5)
      .setOption('width', 900)
      .setOption('height', 380)
      .setPosition(def.anchorRow, def.anchorCol, 0, 0)
      .build();

    const inserted = sheet.insertChart(chart);
    const oid = inserted.getChartId();
    props.setProperty(def.propKey, String(oid));
    console.log(`${def.label} chart created. OID: ${oid}`);
  });

  console.log('');
  console.log('Next step: publish this sheet to the web.');
  console.log('File → Share → Publish to the web → select "Entire Document" → Publish → OK');
  console.log('Then run "Insert Charts into Post" from the YQ Monitor menu.');
}

// Replaces the chart placeholder paragraphs in the WP post with Google Sheets iframe embeds.
// Must run setupCharts() and publish the sheet before calling this.
function insertChartsIntoPost() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = DATA_SPREADSHEET_ID === 'YOUR_SHEET_ID_HERE'
    ? SpreadsheetApp.getActiveSpreadsheet().getId()
    : DATA_SPREADSHEET_ID;

  const oidShort  = props.getProperty('CHART_OID_SHORT');
  const oidMedium = props.getProperty('CHART_OID_MEDIUM');
  const oidLong   = props.getProperty('CHART_OID_LONG');

  if (!oidShort || !oidMedium || !oidLong) {
    console.error('Chart OIDs not set. Run setupCharts() first.');
    return;
  }

  const iframeBlock = (oid, title) =>
    `<!-- wp:html -->\n<iframe title="${title}" width="100%" height="400" seamless frameborder="0" scrolling="no" ` +
    `src="https://docs.google.com/spreadsheets/d/${sheetId}/pubchart?oid=${oid}&amp;format=interactive"></iframe>\n<!-- /wp:html -->`;

  const rawContent = fetchWPPostRaw();
  if (!rawContent) return;

  let updated = rawContent;

  // Replace each placeholder paragraph with the corresponding iframe block
  updated = updated.replace(
    /<!-- wp:paragraph -->\s*<p>\[此處插入短途走勢圖[^\]]*\]<\/p>\s*<!-- \/wp:paragraph -->/,
    iframeBlock(oidShort, '國泰短途燃油附加費走勢')
  );
  updated = updated.replace(
    /<!-- wp:paragraph -->\s*<p>\[此處插入中途走勢圖[^\]]*\]<\/p>\s*<!-- \/wp:paragraph -->/,
    iframeBlock(oidMedium, '國泰中途燃油附加費走勢')
  );
  updated = updated.replace(
    /<!-- wp:paragraph -->\s*<p>\[此處插入長途走勢圖[^\]]*\]<\/p>\s*<!-- \/wp:paragraph -->/,
    iframeBlock(oidLong, '國泰長途燃油附加費走勢')
  );

  if (updated === rawContent) {
    console.warn('No placeholder paragraphs found — charts may already be embedded, or placeholders differ from expected format.');
    return;
  }

  if (pushWPPost(updated)) {
    console.log('Chart iframes inserted into blog post.');
    console.log(`Review: ${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`);
  }
}

// ── WordPress API ───────────────────────────────────────────────

function wpAuthHeader() {
  const props = PropertiesService.getScriptProperties();
  const user  = props.getProperty('WP_USERNAME') || 'ai@flyasia.co';
  const pass  = props.getProperty('WP_APP_PASSWORD');
  return 'Basic ' + Utilities.base64Encode(`${user}:${pass}`);
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

function pushWPPost(rawContent) {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: wpAuthHeader() },
      payload: JSON.stringify({ content: rawContent }),
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

// ── Sheet Logging ───────────────────────────────────────────────

function logRateChange(date, short, medium, long) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) { console.error(`Sheet "${DATA_SHEET_NAME}" not found`); return; }
  const dateStr = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy-MM-dd');
  sheet.appendRow([dateStr, short, medium, long]);
  console.log(`Logged: ${dateStr} | short=${short} | medium=${medium} | long=${long}`);
}

// ── Notification Emails ─────────────────────────────────────────

function sendRateChangeAlert(prev, current, date) {
  const dateStr = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy-MM-dd');
  const subject = `[CX YQ] 燃油附加費更新 | 短途 ${formatHKD(current.short)} | 中途 ${formatHKD(current.medium)} | 長途 ${formatHKD(current.long)} | ${dateStr}`;
  const body = [
    '國泰燃油附加費有變更：',
    '',
    `短途 (Short Haul):   ${formatHKD(prev.short)}  →  ${formatHKD(current.short)}  ${diffText(prev.short, current.short)}`,
    `中途 (Medium Haul):  ${formatHKD(prev.medium)} →  ${formatHKD(current.medium)} ${diffText(prev.medium, current.medium)}`,
    `長途 (Long Haul):    ${formatHKD(prev.long)}   →  ${formatHKD(current.long)}   ${diffText(prev.long, current.long)}`,
    '',
    `博客文章已更新: ${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`,
    '',
    '請手動確認:',
    '  - 現行收費表數值正確',
    '  - 歷史收費表已新增最新一行',
    '  - 正文中的示例金額是否需要手動更新',
  ].join('\n');
  GmailApp.sendEmail(ALERT_EMAIL, subject, body, { from: FROM_EMAIL });
  console.log(`Alert sent: ${subject}`);
}

function sendErrorAlert(message, dateLabel) {
  GmailApp.sendEmail(
    ALERT_EMAIL,
    `[CX YQ Monitor] ⚠ 錯誤 — ${dateLabel}`,
    `Cathay YQ 監控出現問題:\n\n${message}\n\n請手動檢查: ${CATHAY_YQ_URL}`,
    { from: FROM_EMAIL }
  );
}

// ── Helpers ─────────────────────────────────────────────────────

// Format integer as HKD with thousands separator: 1362 → "HK$1,362", 339 → "HK$339"
function formatHKD(amount) {
  const n = parseInt(amount);
  if (n >= 1000) {
    return `HK$${Math.floor(n / 1000)},${String(n % 1000).padStart(3, '0')}`;
  }
  return `HK$${n}`;
}

// Returns ▲/▼ diff text for alert emails
function diffText(prev, current) {
  const diff = current - prev;
  if (diff === 0) return '(不變)';
  return (diff > 0 ? '▲ +' : '▼ ') + formatHKD(Math.abs(diff));
}

// Returns "YYYY 年 M 月 D 日" (no trailing 起)
function formatChineseDate(date) {
  const y = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy');
  const m = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'M'));
  const d = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'd'));
  return `${y} 年 ${m} 月 ${d} 日`;
}

// ── One-time Setup ──────────────────────────────────────────────
// 1. Create a Google Sheet with a tab named 'YQ Data'.
//    Headers: date | short_haul_hkd | medium_haul_hkd | long_haul_hkd
//    Import cx_yq_history.csv into rows 2 onward.
// 2. In Project Settings, set timezone to Asia/Hong_Kong.
// 3. Set Script Properties: WP_USERNAME, WP_APP_PASSWORD.
// 4. Fill in DATA_SPREADSHEET_ID above.
// 5. Run setupCharts() from the YQ Monitor menu.
// 6. Publish the sheet: File → Share → Publish to the web → Publish.
// 7. Run insertChartsIntoPost() from the YQ Monitor menu.
// 8. Run setupTrigger() once to start the hourly monitoring trigger.

// function setupTrigger() {
//   ScriptApp.newTrigger('runFuelSurchargeMonitor')
//     .timeBased()
//     .everyHours(1)
//     .create();
// }
