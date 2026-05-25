// ── Configuration ──────────────────────────────────────────────
const LOG_SPREADSHEET_ID = '1Gg4wDji753n3UaI2zUT1meqJqrMJhHjpEGCaV4wJIIo';
const LOG_SHEET_NAME = 'VPN';
const ALERT_EMAIL = 'info@flyasia.co';
const FROM_EMAIL = 'info@flyasia.co';

const MGM_THRESHOLD = 30;       // USD — alert only fires if referral bonus >= this
const VPN_RATE_THRESHOLD = 100; // % — alert only fires if cashback rate >= this

// MGM referral amount is scraped from the NordVPN page (same page, different element)
const MGM_URL = 'https://www.topcashback.com/nordvpn/';

const VPN_PRODUCTS = [
  { name: 'NordVPN',                   url: 'https://www.topcashback.com/nordvpn/' },
  { name: 'SurfShark VPN',             url: 'https://www.topcashback.com/surfshark/' },
  { name: 'Private Internet Access',   url: 'https://www.topcashback.com/private-internet-access/' },
];

// ── WordPress / Blog Config ─────────────────────────────────────
// Credentials stored in Script Properties:
//   WP_USERNAME       → ai@flyasia.co
//   WP_APP_PASSWORD   → the application password
//   ANTHROPIC_API_KEY → your Anthropic API key
const WP_SITE   = 'https://www.flyasia.co';
const WP_POST_ID = 41060;
const USD_TO_HKD = 7.85;
const BLOG_UPDATE_COOLDOWN_DAYS = 7; // skip update if last update was within this many days AND price/rate unchanged

// ── Menu Setup ─────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('VPN Monitor')
    .addItem('Run Check Now', 'triggerManualRun')
    .addToUi();
}

function triggerManualRun() {
  runTopCashbackMonitor();
}

// ── Main Logic ─────────────────────────────────────────────────

function runTopCashbackMonitor() {
  const now = new Date();
  const dateLabel = Utilities.formatDate(now, 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss');
  console.log(`[${dateLabel}] Running Topcashback VPN monitor`);

  // Step 1: fetch MGM referral rate
  const mgmHtml = fetchUrl(MGM_URL);
  if (!mgmHtml) {
    console.error('Failed to fetch MGM page');
    return;
  }

  const mgmAmounts = extractMGMAmounts(mgmHtml);
  const mgmRate = mgmAmounts.length > 0 ? Math.max(...mgmAmounts) : 0;
  console.log(`MGM referral amounts found: ${mgmAmounts} → using max: US$${mgmRate}`);

  if (mgmRate < MGM_THRESHOLD) {
    console.log(`MGM rate US$${mgmRate} is below threshold US$${MGM_THRESHOLD} — logging N/A`);
    logToSheet(dateLabel, `US$${mgmRate}`, 'N/A', 'N/A');
    return;
  }

  // Step 2: check each VPN product
  VPN_PRODUCTS.forEach(vpn => {
    const html = vpn.url === MGM_URL ? mgmHtml : fetchUrl(vpn.url);
    if (!html) {
      console.error(`Failed to fetch ${vpn.name} page`);
      logToSheet(dateLabel, `US$${mgmRate}`, vpn.name, 'FETCH ERROR');
      return;
    }

    const rates = extractCashbackRates(html);
    const maxRate = rates.length > 0 ? Math.max(...rates) : 0;
    console.log(`${vpn.name} rates found: ${rates} → max: ${maxRate}%`);

    logToSheet(dateLabel, `US$${mgmRate}`, maxRate >= VPN_RATE_THRESHOLD ? vpn.name : 'N/A', maxRate >= VPN_RATE_THRESHOLD ? `${maxRate}%` : 'N/A');

    if (maxRate >= VPN_RATE_THRESHOLD) {
      sendAlert(vpn.name, maxRate, mgmRate, dateLabel);
      if (vpn.name === 'SurfShark VPN') {
        updateSurfsharkBlogPost(maxRate, mgmRate);
      }
    }
  });

  console.log('Monitor run complete');
}

// ── HTML Scraping ───────────────────────────────────────────────

function fetchUrl(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      console.error(`HTTP ${response.getResponseCode()} for ${url}`);
      return null;
    }
    return response.getContentText();
  } catch (e) {
    console.error(`Fetch error for ${url}: ${e.message}`);
    return null;
  }
}

// Extracts dollar amounts from .nav-feature-link elements (MGM referral bonus)
function extractMGMAmounts(html) {
  const amounts = [];
  const classRegex = /class="[^"]*nav-feature-link[^"]*"/g;
  let match;
  while ((match = classRegex.exec(html)) !== null) {
    const segment = html.substring(match.index, match.index + 600);
    const dollarMatch = segment.match(/\$(\d+(?:\.\d+)?)/);
    if (dollarMatch) amounts.push(parseFloat(dollarMatch[1]));
  }
  return amounts;
}

// Extracts percentage cashback rates from .merch-cat__rate elements
function extractCashbackRates(html) {
  const rates = [];
  const classRegex = /class="[^"]*merch-cat__rate[^"]*"/g;
  let match;
  while ((match = classRegex.exec(html)) !== null) {
    const segment = html.substring(match.index, match.index + 300);
    const pctMatch = segment.match(/(\d+(?:\.\d+)?)%/);
    if (pctMatch) rates.push(parseFloat(pctMatch[1]));
  }
  return rates;
}

// ── Blog Update ─────────────────────────────────────────────────

function updateSurfsharkBlogPost(rate, mgmRate) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();

  // --- Deduplication check ---
  const lastUpdateStr = props.getProperty('SURFSHARK_LAST_UPDATE');
  const lastRate      = parseFloat(props.getProperty('SURFSHARK_LAST_RATE') || '0');
  const lastPriceHKD  = props.getProperty('SURFSHARK_LAST_PRICE_HKD') || '';

  if (lastUpdateStr) {
    const daysSince = (now - new Date(lastUpdateStr)) / (1000 * 60 * 60 * 24);
    if (daysSince < BLOG_UPDATE_COOLDOWN_DAYS && rate === lastRate) {
      console.log(`Blog update skipped: last updated ${daysSince.toFixed(1)} days ago at same rate (${rate}%)`);
      return;
    }
  }

  // --- Fetch current post ---
  const post = fetchWPPost();
  if (!post) return;
  let content = post.content.rendered;

  // --- Parse current price from post ---
  const priceMatch = content.match(/Surfshark Starter<\/td><td>HK\$(\d+)<\/td>/);
  const currentPriceHKD = priceMatch ? priceMatch[1] : lastPriceHKD;

  // --- Try to scrape updated price from Surfshark ---
  const scrapedPrice = scrapeSurfsharkPrice();
  const newPriceHKD = scrapedPrice || currentPriceHKD;
  const priceChanged = newPriceHKD && newPriceHKD !== currentPriceHKD;

  console.log(`Price: current=${currentPriceHKD}, scraped=${scrapedPrice}, using=${newPriceHKD}, changed=${priceChanged}`);

  // --- Build updated content ---
  content = updateIntroparagraph(content, rate, now);
  content = updateCaptionDate(content, now);
  if (priceChanged) {
    content = updatePriceOccurrences(content, currentPriceHKD, newPriceHKD);
  }

  // --- Claude proofread ---
  const sectionToCheck = extractKeySection(content);
  const proofreadResult = proofreadWithClaude(sectionToCheck, newPriceHKD, rate);
  if (proofreadResult && proofreadResult !== '無問題') {
    console.warn(`Claude proofread flagged: ${proofreadResult}`);
    sendProofreadAlert(proofreadResult, rate, newPriceHKD);
    // Still proceed with the update — flag is informational
  }

  // --- Push to WordPress (raw content, not rendered) ---
  const rawContent = fetchWPPostRaw();
  if (!rawContent) return;
  let rawUpdated = updateIntroparagraph(rawContent, rate, now);
  rawUpdated = updateCaptionDate(rawUpdated, now);
  if (priceChanged) rawUpdated = updatePriceOccurrences(rawUpdated, currentPriceHKD, newPriceHKD);

  const success = pushWPPost(rawUpdated);
  if (!success) return;

  // --- Save state ---
  props.setProperty('SURFSHARK_LAST_UPDATE', now.toISOString());
  props.setProperty('SURFSHARK_LAST_RATE', String(rate));
  props.setProperty('SURFSHARK_LAST_PRICE_HKD', newPriceHKD);

  console.log(`Blog post updated. Price: HK$${newPriceHKD}, Rate: ${rate}%`);
  sendBlogUpdateSummary(rate, newPriceHKD, priceChanged, proofreadResult);
}

// Attempts to scrape the HK$ price of Surfshark Starter 2-year plan
function scrapeSurfsharkPrice() {
  try {
    const html = fetchUrl('https://surfshark.com/pricing');
    if (!html) return null;

    // Try to find HK$ price near "Starter"
    const hkMatch = html.match(/HK\$\s*(\d+(?:\.\d+)?)/i);
    if (hkMatch) return hkMatch[1];

    // Fallback: find USD price and convert
    const usdMatch = html.match(/\$\s*(\d+\.\d{2})\s*(?:USD)?/);
    if (usdMatch) {
      const hkd = Math.round(parseFloat(usdMatch[1]) * USD_TO_HKD);
      console.log(`Converted USD price ${usdMatch[1]} → HK$${hkd}`);
      return String(hkd);
    }
  } catch (e) {
    console.warn(`Surfshark price scrape failed: ${e.message}`);
  }
  return null;
}

// Updates the red intro update paragraph (date pattern: YYYY 年 M 月 D 日更新：...)
function updateIntroparagraph(content, rate, date) {
  const chineseDate = formatChineseDate(date);
  const newText = `${chineseDate}更新：Topcashback 現時 SurfShark VPN 有 ${rate}% 回贈優惠！根據以往的經驗，這類高回贈優惠不會維持太久，有興趣的朋友請把握機會，立即行動啦！`;

  // Match the intro red paragraph that starts with a date pattern
  return content.replace(
    /(\d{4} 年 \d{1,2} 月 \d{1,2} 日更新：)[^<]*/,
    newText
  );
}

// Updates the cashback table caption date
function updateCaptionDate(content, date) {
  const chineseMonthYear = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy') + ' 年 ' +
    parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'M')) + ' 月';
  return content.replace(
    /上表為 \d{4} 年 \d{1,2} 月 Surfshark 的收費。/,
    `上表為 ${chineseMonthYear} Surfshark 的收費。`
  );
}

// Replaces all Surfshark price occurrences when price changes
function updatePriceOccurrences(content, oldPrice, newPrice) {
  const oldHKD  = `HK$${oldPrice}`;
  const newHKD  = `HK$${newPrice}`;

  // Replace positive price references
  content = content.split(oldHKD).join(newHKD);

  // Update the inline calculation: HK$XXX ÷ 7.85 = US$YY.Y
  const newUSD  = (parseInt(newPrice) / USD_TO_HKD).toFixed(1);
  content = content.replace(
    /HK\$\d+ ÷ 7\.85 = US\$[\d.]+/,
    `${newHKD} ÷ ${USD_TO_HKD} = US$${newUSD}`
  );

  return content;
}

// ── WordPress API ───────────────────────────────────────────────

function wpAuthHeader() {
  const props = PropertiesService.getScriptProperties();
  const user  = props.getProperty('WP_USERNAME') || 'ai@flyasia.co';
  const pass  = props.getProperty('WP_APP_PASSWORD');
  return 'Basic ' + Utilities.base64Encode(`${user}:${pass}`);
}

function fetchWPPost() {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}`, {
      headers: { Authorization: wpAuthHeader() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error(`WP GET failed: ${res.getResponseCode()} ${res.getContentText().substring(0, 200)}`);
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch (e) {
    console.error(`WP fetch error: ${e.message}`);
    return null;
  }
}

// Fetches the raw (unrendered) post content for editing
function fetchWPPostRaw() {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}?context=edit`, {
      headers: { Authorization: wpAuthHeader() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error(`WP GET (raw) failed: ${res.getResponseCode()}`);
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
    const payload = JSON.stringify({ content: rawContent });
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${WP_POST_ID}`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: wpAuthHeader() },
      payload: payload,
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      console.error(`WP POST failed: ${res.getResponseCode()} ${res.getContentText().substring(0, 300)}`);
      return false;
    }
    console.log(`WP post updated successfully (HTTP ${res.getResponseCode()})`);
    return true;
  } catch (e) {
    console.error(`WP push error: ${e.message}`);
    return false;
  }
}

// ── Claude API Proofread ────────────────────────────────────────

function extractKeySection(content) {
  // Pull out just the intro paragraph + cashback table section for the proofread
  const introMatch = content.match(/\d{4} 年 \d{1,2} 月 \d{1,2} 日更新：[^<]*/);
  const tableMatch  = content.match(/Surfshark Starter[\s\S]{0,800}上表為[^<]+/);
  return [
    introMatch ? introMatch[0] : '',
    tableMatch ? tableMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '',
  ].join('\n\n');
}

function proofreadWithClaude(section, priceHKD, rate) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — skipping proofread');
    return null;
  }

  const prompt = `You are proofreading a Traditional Chinese blog post section about Surfshark VPN. ` +
    `The expected values are: 2-year Starter plan price = HK$${priceHKD}, Topcashback cashback rate = ${rate}%. ` +
    `Check the following text for any numerical contradictions or inconsistencies. ` +
    `Reply with '無問題' if everything is consistent, or briefly describe what is inconsistent.\n\n${section}`;

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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() !== 200) {
      console.error(`Claude API error: ${res.getResponseCode()}`);
      return null;
    }
    const result = JSON.parse(res.getContentText()).content[0].text.trim();
    console.log(`Claude proofread: ${result}`);
    return result;
  } catch (e) {
    console.error(`Claude API call failed: ${e.message}`);
    return null;
  }
}

// ── Notification Emails ─────────────────────────────────────────

function sendAlert(vpnName, vpnRate, mgmRate, dateLabel) {
  const subject = `Topcashback ${vpnName} | ${vpnRate}% | US$${mgmRate} | ${dateLabel.split(' ')[0]}`;
  GmailApp.sendEmail(ALERT_EMAIL, subject, 'New Promo Found!', { from: FROM_EMAIL });
  console.log(`Alert sent: ${subject}`);
}

function sendBlogUpdateSummary(rate, priceHKD, priceChanged, proofreadNote) {
  const subject = `[SurfShark Blog] Post updated — ${rate}% promo | HK$${priceHKD}`;
  const body = [
    `The Surfshark VPN blog post (Post ID ${WP_POST_ID}) has been automatically updated.`,
    ``,
    `Cashback rate:  ${rate}%`,
    `2-year price:   HK$${priceHKD}`,
    `Price changed:  ${priceChanged ? 'YES — all price references updated' : 'No change'}`,
    `Claude check:   ${proofreadNote || 'Skipped (no API key)'}`,
    ``,
    `Review the post: ${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`,
  ].join('\n');
  GmailApp.sendEmail(ALERT_EMAIL, subject, body, { from: FROM_EMAIL });
}

function sendProofreadAlert(note, rate, priceHKD) {
  GmailApp.sendEmail(
    ALERT_EMAIL,
    `[SurfShark Blog] ⚠ Proofread flag — please review`,
    `Claude flagged a potential inconsistency in the updated post:\n\n${note}\n\nRate: ${rate}%, Price: HK$${priceHKD}\n\nPost: ${WP_SITE}/wp-admin/post.php?post=${WP_POST_ID}&action=edit`,
    { from: FROM_EMAIL }
  );
}

// ── Sheet Logging ───────────────────────────────────────────────

function logToSheet(date, mgmRate, vpnBrand, vpnRate) {
  const ss = SpreadsheetApp.openById(LOG_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    console.error(`Sheet "${LOG_SHEET_NAME}" not found in spreadsheet ${LOG_SPREADSHEET_ID}`);
    return;
  }
  sheet.appendRow([date, mgmRate, vpnBrand, vpnRate, false]);
  console.log(`Logged: ${date} | ${mgmRate} | ${vpnBrand} | ${vpnRate}`);
}

// ── Helpers ─────────────────────────────────────────────────────

function formatChineseDate(date) {
  const y = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy');
  const m = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'M'));
  const d = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'd'));
  return `${y} 年 ${m} 月 ${d} 日`;
}

// ── One-time Setup ──────────────────────────────────────────────
// Run setupCredentials() once from the editor, then delete it.
// function setupCredentials() {
//   const props = PropertiesService.getScriptProperties();
//   props.setProperty('WP_USERNAME',     'ai@flyasia.co');
//   props.setProperty('WP_APP_PASSWORD', 'Yk4d f5hH f1AF qtTd O49e ftYX');
//   props.setProperty('ANTHROPIC_API_KEY', 'sk-ant-YOUR_KEY_HERE');
// }

// Run setupTriggers() once to create both daily triggers, then delete it.
// function setupTriggers() {
//   ScriptApp.newTrigger('runTopCashbackMonitor').timeBased().atHour(14).everyDays(1).create();
//   ScriptApp.newTrigger('runTopCashbackMonitor').timeBased().atHour(18).everyDays(1).create();
// }
