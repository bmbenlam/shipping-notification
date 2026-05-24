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
    // Reuse already-fetched HTML for NordVPN to avoid a second request
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

// ── Alert Email ─────────────────────────────────────────────────

function sendAlert(vpnName, vpnRate, mgmRate, dateLabel) {
  const subject = `Topcashback ${vpnName} | ${vpnRate}% | US$${mgmRate} | ${dateLabel.split(' ')[0]}`;
  GmailApp.sendEmail(ALERT_EMAIL, subject, 'New Promo Found!', { from: FROM_EMAIL });
  console.log(`Alert sent: ${subject}`);
}

// ── One-time Trigger Setup ──────────────────────────────────────
// Run setupTriggers() once from the editor to create both daily triggers, then delete it.
// function setupTriggers() {
//   // 2pm HKT (script timezone must be Asia/Hong_Kong)
//   ScriptApp.newTrigger('runTopCashbackMonitor').timeBased().atHour(14).everyDays(1).create();
//   // 6pm HKT
//   ScriptApp.newTrigger('runTopCashbackMonitor').timeBased().atHour(18).everyDays(1).create();
// }
