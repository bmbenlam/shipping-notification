// ── Configuration ──────────────────────────────────────────────
// Container-bound: fill DATA_SPREADSHEET_ID with the sheet ID after creating it.
const DATA_SPREADSHEET_ID = '1QQe7PdG1pciliASv23YCyPkBiGIrr-WYYK00kzsNgvU';
const DATA_SHEET_NAME     = 'YQ Data';
const ALERT_EMAIL  = 'info@flyasia.co';
const HEIDI_EMAIL  = 'heidi@flyasia.co';
const FROM_EMAIL   = 'info@flyasia.co';
const WP_SITE      = 'https://www.flyasia.co';
const WP_POST_ID   = 170448;

// Cathay Pacific fuel surcharge page (Chinese)
const CATHAY_YQ_URL = 'https://www.cathaypacific.com/cx/zh_HK/latest-news/other-news/fuel-surcharge-updates.html';

// Rates change on the 1st and 15th; run hourly but only act daily outside that window.
// HIGH_FREQ_DAYS: ±2 days around each expected change date.
const HIGH_FREQ_DAYS = new Set([28, 29, 30, 31, 1, 2, 14, 15, 16]);

// ── Menu / Triggers ─────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('YQ Monitor')
    .addItem('Run Check Now',              'triggerManualRun')
    .addItem('Force Full Run (test)',      'forceFullRun')
    .addItem('Test Scrape Only',           'testScrapeOnly')
    .addSeparator()
    .addItem('Fix Sheet Dates (one-time)', 'fixSheetDates')
    .addItem('Setup Charts (first run)',   'setupCharts')
    .addItem('Insert Charts into Post',    'insertChartsIntoPost')
    .addToUi();
}

function triggerManualRun() { runFuelSurchargeMonitor(); }

// Bypasses the frequency gate and resets stored rates to 0 so the current
// scraped values always appear as a change. Use this to test the full flow
// (sheet logging + pending revision + approval email) without waiting for
// the gate or a real rate change.
function forceFullRun() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('YQ_LAST_CHECK');
  props.deleteProperty('YQ_LAST_SHORT');
  props.deleteProperty('YQ_LAST_MEDIUM');
  props.deleteProperty('YQ_LAST_LONG');
  console.log('Gate and stored rates cleared — running full flow now...');
  runFuelSurchargeMonitor();
}

// Fetches the Cathay page and logs extracted rates — no sheet writes, no emails, no WP update.
// Use this to verify the scraper works without triggering the full flow or being blocked by the gate.
function testScrapeOnly() {
  console.log('=== Test scrape (no side effects) ===');
  const html = fetchUrl(CATHAY_YQ_URL);
  if (!html) { console.error('Fetch failed'); return; }
  console.log(`Fetched ${html.length} bytes`);

  const rates = extractYQRates(html);
  if (!rates) {
    console.error('extractYQRates returned null — check logs above for detail');
    return;
  }
  console.log(`short  = ${rates.short}  HKD (${formatHKD(rates.short)})`);
  console.log(`medium = ${rates.medium} HKD (${formatHKD(rates.medium)})`);
  console.log(`long   = ${rates.long}   HKD (${formatHKD(rates.long)})`);
  console.log('=== Done ===');
}

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

  logRateChange(now, current, prev);

  const prev = { short: prevShort, medium: prevMedium, long: prevLong };

  // Build the updated blog post content, proofread it, and save as WP autosave revision
  const { proofResult, revisionUrl } = prepareBlogRevision(current, prev, now);

  props.setProperty('YQ_LAST_SHORT',  String(current.short));
  props.setProperty('YQ_LAST_MEDIUM', String(current.medium));
  props.setProperty('YQ_LAST_LONG',   String(current.long));
  props.setProperty('YQ_LAST_CHANGE', now.toISOString());

  sendApprovalRequest(prev, current, now, proofResult, revisionUrl);
  console.log('Monitor run complete');
}

// ── Cathay Page Scraping ────────────────────────────────────────

// Fetches the Cathay page, routing through the Cloud Function proxy when PROXY_URL is set.
// Falls back to direct fetch if not configured (direct fetch is blocked by Cathay's Akamai CDN).
function fetchUrl(url) {
  const props     = PropertiesService.getScriptProperties();
  const proxyUrl  = props.getProperty('PROXY_URL');
  const proxyKey  = props.getProperty('PROXY_API_KEY');

  if (proxyUrl) {
    return fetchViaProxy(proxyUrl, proxyKey);
  }
  console.warn('PROXY_URL not set — attempting direct fetch (likely blocked by Akamai CDN)');
  return fetchDirect(url);
}

function fetchViaProxy(proxyUrl, apiKey) {
  console.log(`Fetching via proxy: ${proxyUrl}`);
  const t0 = Date.now();
  try {
    const opts = { muteHttpExceptions: true };
    if (apiKey) opts.headers = { 'x-proxy-key': apiKey };
    const res = UrlFetchApp.fetch(proxyUrl, opts);
    console.log(`Proxy responded in ${((Date.now() - t0) / 1000).toFixed(1)}s — HTTP ${res.getResponseCode()}`);
    if (res.getResponseCode() !== 200) {
      console.error(`Proxy error: HTTP ${res.getResponseCode()} — ${res.getContentText().substring(0, 200)}`);
      return null;
    }
    return res.getContentText();
  } catch (e) {
    console.error(`Proxy fetch error: ${e.message}`);
    return null;
  }
}

function fetchDirect(url) {
  console.log(`Direct fetch: ${url}`);
  const t0 = Date.now();
  try {
    const res = UrlFetchApp.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,zh;q=0.8',
      },
      muteHttpExceptions: true,
    });
    console.log(`Direct fetch in ${((Date.now() - t0) / 1000).toFixed(1)}s — HTTP ${res.getResponseCode()}`);
    if (res.getResponseCode() !== 200) {
      console.error(`Direct fetch HTTP ${res.getResponseCode()}`);
      return null;
    }
    return res.getContentText();
  } catch (e) {
    console.error(`Direct fetch error: ${e.message}`);
    return null;
  }
}

// Returns { short, medium, long } in HKD integers, or null.
//
// Page structure (as of 2026-05):
//   Values are formatted "NNN 港幣" — NOT "HK$NNN".
//   Sections are split by two unique anchor strings:
//     • 南亞次大陸  → marks start of medium-haul (South Asia subcontinent) section
//     • 上表未提及的航班 → marks start of short-haul (all other routes) section
//   Long haul is the section before 南亞次大陸.
//   Each section's table has a "香港" row; we take the last 港幣 value in that row
//   (= the most recently-effective column).
//   Desktop and mobile views are both in the HTML; 香港<\/td> only matches desktop <td> cells.
//
// If extractYQRates returns null, check the Executions log for detail, inspect the page source,
// and update the anchor strings or lastHKDInRow() regex accordingly.
function extractYQRates(html) {
  const mediumIdx = html.indexOf('南亞次大陸');
  const shortIdx  = html.indexOf('上表未提及的航班');

  if (mediumIdx > 0 && shortIdx > mediumIdx) {
    const longSection   = html.substring(0, mediumIdx);
    const mediumSection = html.substring(mediumIdx, shortIdx);
    // Limit short section to ~5000 chars — enough for the first table, avoids picking
    // up the later China/Japan/Korea/Philippines sub-tables in the same section.
    const shortSection  = html.substring(shortIdx, shortIdx + 5000);

    const long   = lastHKDInRow(longSection);
    const medium = lastHKDInRow(mediumSection);
    const short  = lastHKDInRow(shortSection);

    if (long !== null && medium !== null && short !== null) {
      console.log(`Pattern A: short=${short}, medium=${medium}, long=${long}`);
      return { short, medium, long };
    }
    console.warn(`Pattern A partial: short=${short}, medium=${medium}, long=${long}. Trying fallback.`);
  } else {
    console.warn(`Anchor strings not found (mediumIdx=${mediumIdx}, shortIdx=${shortIdx}). Trying fallback.`);
  }

  // Fallback: collect all "NNN 港幣" values in the plausible YQ range, pick lowest/mid/highest.
  const allHKD = [...html.matchAll(/(\d{3,4}) 港幣/g)]
    .map(m => parseInt(m[1]))
    .filter(n => n >= 100 && n <= 5000);
  const unique = [...new Set(allHKD)].sort((a, b) => a - b);
  if (unique.length >= 3) {
    console.warn(`Fallback used — all 港幣 values in range: ${unique.join(', ')}. Verify correctness.`);
    return { short: unique[0], medium: unique[1], long: unique[unique.length - 1] };
  }

  return null;
}

// Within a section of HTML, finds the first <td>香港</td> table row and returns
// the LAST "NNN 港幣" value in that row (= current/latest effective-date column).
function lastHKDInRow(sectionHtml) {
  const rowMatch = sectionHtml.match(/香港<\/td>([\s\S]{0,500}?)<\/tr>/);
  if (!rowMatch) return null;
  const vals = [...rowMatch[1].matchAll(/(\d{3,4}) 港幣/g)];
  return vals.length ? parseInt(vals[vals.length - 1][1]) : null;
}

// ── Blog Post Revision (Approval Flow) ─────────────────────────
// When a rate change is detected the script builds the updated content,
// saves it as a WordPress autosave revision (native WP feature — no plugin
// needed), and emails both editors a direct link to the revision for review.
// The live post is NEVER changed automatically.
//
// To publish: open the revision link in the email → click "Restore This
// Revision" → review in the editor → click "Update".

function prepareBlogRevision(current, prev, date) {
  const post = fetchWPPostRaw();
  if (!post) {
    console.error('WP post fetch returned null — check WP_USERNAME / WP_APP_PASSWORD');
    return { proofResult: '（無法取得文章內容）', revisionUrl: null };
  }
  const { content: rawContent, title } = post;
  if (!rawContent || rawContent.length < 500) {
    console.error(`WP post content is only ${rawContent ? rawContent.length : 0} chars — post appears empty. ` +
      'Paste the full template content into post 170448 before running the monitor.');
    return { proofResult: '（文章內容過短，請先貼上完整模板）', revisionUrl: null };
  }
  console.log(`Fetched post: "${title}" (${rawContent.length} chars)`);

  let updated = updateDateLine(rawContent, date);
  updated = updateCurrentRatesTable(updated, current, prev, date);
  updated = prependHistoryRow(updated, current, date);

  const proofResult = proofreadWithClaude(current, updated);
  console.log(`Proofread result: ${proofResult}`);

  const revisionId  = saveWPAutosave(updated, title);
  const revisionUrl = revisionId
    ? `${WP_SITE}/wp-admin/revision.php?revision=${revisionId}`
    : `${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`;

  return { proofResult, revisionUrl };
}

// Saves content as a WordPress autosave revision.
// The live post is untouched; the revision appears in WP Admin → Revisions.
// Returns the revision ID on success, null on failure.
function saveWPAutosave(rawContent, title) {
  try {
    const payload = { content: rawContent };
    if (title) payload.title = title;
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}/autosaves`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: wpAuthHeader() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      console.error(`WP autosave failed: HTTP ${res.getResponseCode()} — ${res.getContentText().substring(0, 300)}`);
      return null;
    }
    const result = JSON.parse(res.getContentText());
    console.log(`WP autosave created: revision ID ${result.id}`);
    return result.id;
  } catch (e) {
    console.error(`WP autosave error: ${e.message}`);
    return null;
  }
}

// Updates: <strong>更新日期：YYYY 年 M 月 D 日</strong>
function updateDateLine(content, date) {
  return content.replace(
    /(<strong>更新日期：)\d{4} 年 \d{1,2} 月 \d{1,2} 日(<\/strong>)/,
    `$1${formatChineseDate(date)}$2`
  );
}

// Updates the 3 rows in the current-rates table (rate, effective date, ▲▼ comparison)
// and the inline short-haul round-trip example in the paragraph below the table.
//
// Current-rates table structure (new template):
//   <tr>
//     <td><strong>短途</strong><br>destinations</td>
//     <td>HK$339</td>
//     <td>2026 年 5 月 16 日起</td>
//     <td>▼ HK$50</td>
//   </tr>
function updateCurrentRatesTable(content, current, prev, date) {
  const effectiveDate = `${formatChineseDate(date)}起`;

  content = replaceRateRow(content, '短途', current.short,  prev.short,  effectiveDate);
  content = replaceRateRow(content, '中途', current.medium, prev.medium, effectiveDate);
  content = replaceRateRow(content, '長途', current.long,   prev.long,   effectiveDate);

  // Update the inline round-trip example sentence below the table:
  // "短途機票來回兩程的燃油附加費為 HK$339 x 2 = HK$678"
  content = content.replace(
    /短途機票來回兩程的燃油附加費為 HK\$[\d,]+ x 2 = HK\$[\d,]+/,
    `短途機票來回兩程的燃油附加費為 ${formatHKD(current.short)} x 2 = ${formatHKD(current.short * 2)}`
  );

  return content;
}

// Matches the current-rates table row for 短途/中途/長途 and replaces:
//   rate cell, effective-date cell, comparison cell.
// Uses a function replacement (not a string) to avoid $ being misread as
// a backreference — formatHKD() returns strings like "HK$339" / "HK$1,362"
// whose $ would corrupt the output if used in a string replacement.
function replaceRateRow(content, label, newRate, prevRate, effectiveDate) {
  const diff = newRate - prevRate;
  const compareText = diff === 0 ? '—'
    : (diff > 0 ? '▲ ' : '▼ ') + formatHKD(Math.abs(diff));
  const newRateFmt = formatHKD(newRate);

  // Group 1: <strong>label</strong><br>destinations</td><td>
  // Group 2: </td><td>  (after old rate)
  // [^<]+:   old effective date + 起  (consumed, not captured)
  // Group 3: </td><td>  (起? matches empty since 起 was consumed)
  // [^<]*:   old comparison text
  // Group 4: </td>
  return content.replace(
    new RegExp(
      `(<strong>${label}<\/strong>[\\s\\S]{0,400}?<\/td>\\s*<td>)` +
      `HK\\$[\\d,]+` +
      `(<\/td>\\s*<td>)[^<]+(起?<\/td>\\s*<td>)` +
      `[^<]*(<\/td>)`
    ),
    (_, g1, g2, g3, g4) => `${g1}${newRateFmt}${g2}${effectiveDate}${g3}${compareText}${g4}`
  );
}

// Prepends a new row to the historical rates table.
// The history table header is: 生效日期 | 短途 | 中途 | 長途
// This is distinct from the current-rates table whose header is:
//   航線類別 | 每程收費 | 生效日期 | 與上期對比
// Using 生效日期</th><th>短途 as the unique anchor for the history table.
// Uses function replacement to avoid HK$1,362 being misread as a backreference.
function prependHistoryRow(content, rates, date) {
  const newRow = `<tr><td>${formatChineseDate(date)}</td><td>${formatHKD(rates.short)}</td><td>${formatHKD(rates.medium)}</td><td>${formatHKD(rates.long)}</td></tr>`;

  return content.replace(
    /(生效日期<\/th><th>短途<\/th>[\s\S]{0,200}?<tbody>)/,
    (_, g1) => `${g1}${newRow}`
  );
}

// ── Claude Proofread ────────────────────────────────────────────

// Extracts the key sections (date line, current-rates table) from the post content
// to send to Claude for a sanity check.
function extractYQKeySection(content) {
  const dateMatch = content.match(/<strong>更新日期：[^<]+<\/strong>/);
  // 航線類別 is the first column header of the current-rates table and appears
  // nowhere else — use it instead of 短途 which appears throughout the post.
  const rateTableMatch = content.match(/航線類別[\s\S]{0,2000}?<\/table>/);
  const parts = [];
  if (dateMatch)     parts.push(dateMatch[0]);
  if (rateTableMatch) parts.push(rateTableMatch[0]);
  return parts.join('\n\n') || content.substring(0, 2000);
}

// Calls Claude Haiku to proofread the key post sections for numerical inconsistencies.
// Returns '無問題' if all looks correct, or a short description of the issue found.
function proofreadWithClaude(rates, updatedContent) {
  const props   = PropertiesService.getScriptProperties();
  const apiKey  = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.log('ANTHROPIC_API_KEY not set — skipping proofread');
    return '（未設定 API Key，已跳過校對）';
  }

  const keySection = extractYQKeySection(updatedContent);
  const prompt = [
    `你是文章校對員。以下是一篇關於國泰航空燃油附加費的博客文章片段，剛剛更新了以下數值：`,
    `短途 YQ: ${formatHKD(rates.short)}，中途 YQ: ${formatHKD(rates.medium)}，長途 YQ: ${formatHKD(rates.long)}`,
    ``,
    `請檢查以下內容，確認日期和金額數字一致，沒有矛盾或舊數據殘留。`,
    `如沒有問題，只回覆「無問題」。如有問題，簡短描述（不超過 80 字）。`,
    ``,
    `--- 文章片段 ---`,
    keySection,
    `--- 結束 ---`,
  ].join('\n');

  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() !== 200) {
      console.error(`Claude API error: ${res.getResponseCode()}`);
      return '（Claude API 錯誤，已跳過校對）';
    }

    const text = JSON.parse(res.getContentText()).content[0].text.trim();
    return text;
  } catch (e) {
    console.error(`proofreadWithClaude error: ${e.message}`);
    return '（校對時出現錯誤）';
  }
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

  const props = PropertiesService.getScriptProperties();

  // Build step-chart data first (creates staircase effect — no false slopes)
  const chartSheet = buildStepChartData(ss, sheet);

  // Remove all existing charts (clean slate), then flush so removals commit
  sheet.getCharts().forEach(c => sheet.removeChart(c));
  SpreadsheetApp.flush();

  // Ensure the sheet has enough rows to anchor charts at rows 2, 22, 42
  const neededRows = 80;
  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }

  // Use a large fixed range so future rows in _chart_data are auto-included
  const MAX_ROWS = 1000;

  const chartDefs = [
    { col: 2, color: '#b38850', label: '短途 YQ (HKD)',  propKey: 'CHART_OID_SHORT',  anchorRow: 2,  anchorCol: 6 },
    { col: 3, color: '#d4850a', label: '中途 YQ (HKD)',  propKey: 'CHART_OID_MEDIUM', anchorRow: 22, anchorCol: 6 },
    { col: 4, color: '#b20000', label: '長途 YQ (HKD)',  propKey: 'CHART_OID_LONG',   anchorRow: 42, anchorCol: 6 },
  ];

  chartDefs.forEach(def => {
    const chart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(chartSheet.getRange(1, 1, MAX_ROWS, 1))       // date column from _chart_data
      .addRange(chartSheet.getRange(1, def.col, MAX_ROWS, 1)) // value column from _chart_data
      .setOption('title', '國泰燃油附加費 — ' + def.label)
      .setOption('colors', [def.color])
      .setOption('hAxis.format', 'yyyy-MM')
      .setOption('hAxis.title', '')
      .setOption('vAxis.title', 'HKD')
      .setOption('vAxis.minValue', 0)
      .setOption('legend.position', 'none')
      .setOption('lineWidth', 2)
      .setOption('pointSize', 4)
      .setOption('width', 900)
      .setOption('height', 380)
      .setPosition(def.anchorRow, def.anchorCol, 0, 0)
      .build();

    const inserted = sheet.insertChart(chart);
    SpreadsheetApp.flush(); // commit each chart before reading its ID
    const oid = inserted.getChartId();
    props.setProperty(def.propKey, String(oid));
    console.log(`${def.label} chart created. OID: ${oid}`);
  });

  console.log('Next step: publish this sheet to the web.');
  console.log('File → Share → Publish to the web → select "Entire Document" → Publish → OK');
  console.log('Then run "Insert Charts into Post" from the YQ Monitor menu.');
}

// Builds (or rebuilds) a hidden '_chart_data' sheet with bridge rows inserted between
// each rate change so line charts display a staircase rather than false slopes.
// For each rate period: [change_date, rate] then [next_change_date − 1 day, same_rate].
// Called by setupCharts() and automatically by logRateChange() on every update.
function buildStepChartData(ss, dataSheet) {
  if (!ss)        ss        = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  if (!dataSheet) dataSheet = ss.getSheetByName(DATA_SHEET_NAME);

  const CHART_SHEET = '_chart_data';
  let chartSheet = ss.getSheetByName(CHART_SHEET);
  if (!chartSheet) {
    chartSheet = ss.insertSheet(CHART_SHEET);
    chartSheet.hideSheet();
  } else {
    chartSheet.clearContents();
  }

  const data = dataSheet.getDataRange().getValues();
  const rows = data.slice(1).filter(r => r[0]); // skip header + empty rows

  const output = [data[0]]; // header row

  for (let i = 0; i < rows.length; i++) {
    const [date, s, m, l] = rows[i];
    const dateObj = date instanceof Date ? date : new Date(date);
    output.push([dateObj, s, m, l]);

    if (i < rows.length - 1) {
      // Bridge point: hold the current value until 1 day before the next change
      const nextDate  = rows[i + 1][0] instanceof Date ? rows[i + 1][0] : new Date(rows[i + 1][0]);
      const bridgeDay = new Date(nextDate.getTime() - 86400000);
      output.push([bridgeDay, s, m, l]);
    }
  }

  if (output.length > 1) {
    chartSheet.getRange(1, 1, output.length, 4).setValues(output);
    chartSheet.getRange(2, 1, output.length - 1, 1).setNumberFormat('yyyy-MM-dd');
  }

  console.log(`Step chart data rebuilt: ${rows.length} periods → ${output.length - 1} rows`);
  return chartSheet;
}

// Replaces the chart placeholder paragraphs in the WP post with Google Sheets iframe embeds.
// Must run setupCharts() and publish the sheet before calling this.
// Publishes directly to the live post (admin-only chart setup, not subject to approval flow).
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

  const post = fetchWPPostRaw();
  if (!post) return;

  let updated = post.content;

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

  if (updated === post.content) {
    console.warn('No placeholder paragraphs found — charts may already be embedded, or placeholders differ from expected format.');
    return;
  }

  if (pushWPPost(updated, post.title)) {
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

// Returns { content: string, title: string } or null.
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
    const post = JSON.parse(res.getContentText());
    return { content: post.content.raw, title: post.title.raw };
  } catch (e) {
    console.error(`WP raw fetch error: ${e.message}`);
    return null;
  }
}

// Direct publish — only used for chart setup (insertChartsIntoPost).
// Rate change updates go through saveWPAutosave() for the approval flow.
function pushWPPost(rawContent, title) {
  try {
    const payload = { content: rawContent };
    if (title) payload.title = title;
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

// ── Sheet Logging ───────────────────────────────────────────────

function logRateChange(date, current, prev) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) { console.error(`Sheet "${DATA_SHEET_NAME}" not found`); return; }
  const dateStr = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy-MM-dd');
  sheet.appendRow([date, current.short, current.medium, current.long]);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('yyyy-MM-dd');
  console.log(`Logged: ${dateStr} | short=${current.short} | medium=${current.medium} | long=${current.long}`);
  // Rebuild step-chart data so charts always show correct staircase (no false slopes)
  buildStepChartData(ss, sheet);
}

// Converts any text-string dates in column A to proper Date values.
// Run once after importing historical CSV data so chart X-axis is time-proportional.
function fixSheetDates() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  let fixed = 0;
  for (let row = 2; row <= lastRow; row++) {
    const cell = sheet.getRange(row, 1);
    const val  = cell.getValue();
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const [y, m, d] = val.split('-').map(Number);
      cell.setValue(new Date(y, m - 1, d));
      cell.setNumberFormat('yyyy-MM-dd');
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} date cells (${lastRow - 1} rows total). Re-run setupCharts to refresh.`);
  SpreadsheetApp.getUi().alert(`Fixed ${fixed} date cells. Now run Setup Charts (first run) from the menu to refresh the charts.`);
}

// ── Notification Emails ─────────────────────────────────────────

// Sends an approval request to both info@ and heidi@, with rate changes,
// proofread result, and a direct link to the WordPress revision for review.
function sendApprovalRequest(prev, current, date, proofResult, revisionUrl) {
  const dateStr = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy-MM-dd');
  const subject = `[CX YQ] 待審批修訂 | 短途 ${formatHKD(current.short)} | 中途 ${formatHKD(current.medium)} | 長途 ${formatHKD(current.long)} | ${dateStr}`;

  const proofLine = (proofResult && proofResult !== '無問題')
    ? `⚠ Claude 校對發現問題：\n  ${proofResult}\n\n  請在批准前仔細核對文章內容。`
    : `✓ Claude 校對：無問題`;

  const editUrl     = `${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`;
  const reviewLink  = revisionUrl || editUrl;

  const body = [
    '國泰燃油附加費有變更，更新版本已儲存至 WordPress 修訂版本。',
    '',
    '── 費率變更 ──',
    `短途 (Short Haul):   ${formatHKD(prev.short)}  →  ${formatHKD(current.short)}  ${diffText(prev.short, current.short)}`,
    `中途 (Medium Haul):  ${formatHKD(prev.medium)} →  ${formatHKD(current.medium)} ${diffText(prev.medium, current.medium)}`,
    `長途 (Long Haul):    ${formatHKD(prev.long)}   →  ${formatHKD(current.long)}   ${diffText(prev.long, current.long)}`,
    '',
    '── 自動校對結果 ──',
    proofLine,
    '',
    '── 發布步驟 ──',
    '1. 點擊以下連結查看修訂版本：',
    '   ' + reviewLink,
    '2. 確認日期及費率正確',
    '3. 點擊「Restore This Revision」',
    '4. 返回文章編輯頁 → 點擊「Update」正式發布',
    '',
    '   （如連結為修訂比較頁，直接找右側最新版本的 Restore 按鈕即可）',
    '',
    '── 發布後請確認 ──',
    '  - 現行收費表數值正確',
    '  - 歷史收費表已新增最新一行',
    '  - 正文示例金額如需手動更新請一並處理',
    '',
    '文章編輯頁: ' + editUrl,
  ].join('\n');

  const recipients = [ALERT_EMAIL, HEIDI_EMAIL].join(',');
  GmailApp.sendEmail(recipients, subject, body, { from: FROM_EMAIL });
  console.log(`Approval request sent to ${recipients}: ${subject}`);
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
// 3. Set Script Properties: WP_USERNAME, WP_APP_PASSWORD, ANTHROPIC_API_KEY,
//    PROXY_URL, PROXY_API_KEY.
// 4. Fill in DATA_SPREADSHEET_ID above.
// 5. Paste the full post template into WP post 170448 and publish it.
// 6. Run setupCharts() from the YQ Monitor menu.
// 7. Publish the sheet: File → Share → Publish to the web → Publish.
// 8. Run insertChartsIntoPost() from the YQ Monitor menu.
// 9. Run setupTrigger() once to start the hourly monitoring trigger.
//
// Approval flow (no plugin required):
//   Rate change detected → WP autosave revision created → approval email sent
//   → editor opens revision link → Restore This Revision → Update

// function setupTrigger() {
//   ScriptApp.newTrigger('runFuelSurchargeMonitor')
//     .timeBased()
//     .everyHours(1)
//     .create();
// }
