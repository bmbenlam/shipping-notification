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
const WP_SITE              = 'https://www.flyasia.co';
const WP_POST_ID_SURFSHARK = 41060;
const WP_POST_ID_NORDVPN   = 35688;
const USD_TO_HKD = 7.85;
const BLOG_UPDATE_COOLDOWN_DAYS = 7;

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

    logToSheet(
      dateLabel, `US$${mgmRate}`,
      maxRate >= VPN_RATE_THRESHOLD ? vpn.name : 'N/A',
      maxRate >= VPN_RATE_THRESHOLD ? `${maxRate}%` : 'N/A'
    );

    if (maxRate >= VPN_RATE_THRESHOLD) {
      sendAlert(vpn.name, maxRate, mgmRate, dateLabel);
      if (vpn.name === 'SurfShark VPN') updateSurfsharkBlogPost(maxRate, mgmRate);
      if (vpn.name === 'NordVPN')        updateNordVPNBlogPost(maxRate, mgmRate);
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

// ── SurfShark Blog Update ───────────────────────────────────────

function updateSurfsharkBlogPost(rate, mgmRate) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();

  const lastUpdateStr = props.getProperty('SURFSHARK_LAST_UPDATE');
  const lastRate      = parseFloat(props.getProperty('SURFSHARK_LAST_RATE') || '0');

  const rawContent = fetchWPPostRaw(WP_POST_ID_SURFSHARK);
  if (!rawContent) return;

  const currentPrices = parseSurfsharkPricesFromPost(rawContent);
  console.log(`Surfshark current prices: 2yr=HK$${currentPrices.twoYear}, 1yr=HK$${currentPrices.oneYear}, 1mo=HK$${currentPrices.oneMonth}`);

  const scrapedPrices = scrapeSurfsharkPrices();
  const newPrices = {
    twoYear:  (scrapedPrices && scrapedPrices.twoYear)  || currentPrices.twoYear,
    oneYear:  (scrapedPrices && scrapedPrices.oneYear)  || currentPrices.oneYear,
    oneMonth: (scrapedPrices && scrapedPrices.oneMonth) || currentPrices.oneMonth,
  };
  const pricesChanged = newPrices.twoYear  !== currentPrices.twoYear  ||
                        newPrices.oneYear  !== currentPrices.oneYear  ||
                        newPrices.oneMonth !== currentPrices.oneMonth;

  console.log(`Surfshark scraped: 2yr=${scrapedPrices ? 'HK$' + scrapedPrices.twoYear : 'null'}, 1yr=${scrapedPrices ? 'HK$' + scrapedPrices.oneYear : 'null'}, 1mo=${scrapedPrices ? 'HK$' + scrapedPrices.oneMonth : 'null'} | changed=${pricesChanged}`);

  if (lastUpdateStr) {
    const daysSince = (now - new Date(lastUpdateStr)) / (1000 * 60 * 60 * 24);
    if (daysSince < BLOG_UPDATE_COOLDOWN_DAYS && rate === lastRate && !pricesChanged) {
      console.log(`Surfshark blog update skipped: ${daysSince.toFixed(1)} days ago, same rate (${rate}%), same prices`);
      return;
    }
  }

  const post = fetchWPPost(WP_POST_ID_SURFSHARK);
  const sectionToCheck = extractSurfsharkKeySection(post ? post.content.rendered : rawContent);
  const proofreadResult = proofreadWithClaude(sectionToCheck, newPrices, rate, 'SurfShark VPN');
  if (proofreadResult && proofreadResult !== '無問題') {
    console.warn(`Surfshark proofread flagged: ${proofreadResult}`);
    sendProofreadAlert('SurfShark VPN', WP_POST_ID_SURFSHARK, proofreadResult, rate, newPrices);
  }

  let updated = updateSurfsharkIntro(rawContent, rate, now);
  updated = updateSurfsharkCaption(updated, now);
  if (pricesChanged) updated = updateSurfsharkPrices(updated, currentPrices, newPrices);

  if (!pushWPPost(WP_POST_ID_SURFSHARK, updated)) return;

  props.setProperty('SURFSHARK_LAST_UPDATE', now.toISOString());
  props.setProperty('SURFSHARK_LAST_RATE',   String(rate));
  props.setProperty('SURFSHARK_PRICE_2Y',    newPrices.twoYear);
  props.setProperty('SURFSHARK_PRICE_1Y',    newPrices.oneYear);
  props.setProperty('SURFSHARK_PRICE_1M',    newPrices.oneMonth);

  console.log(`Surfshark blog updated. Prices: 2yr=HK$${newPrices.twoYear}, 1yr=HK$${newPrices.oneYear}, 1mo=HK$${newPrices.oneMonth}, Rate: ${rate}%`);
  sendBlogUpdateSummary('SurfShark VPN', WP_POST_ID_SURFSHARK, rate, newPrices, pricesChanged, proofreadResult);
}

function parseSurfsharkPricesFromPost(content) {
  const match = content.match(/Surfshark Starter<\/td><td>HK\$(\d+)<\/td><td>HK\$(\d+)<\/td><td>HK\$(\d+)<\/td>/);
  if (match) return { twoYear: match[1], oneYear: match[2], oneMonth: match[3] };
  const props = PropertiesService.getScriptProperties();
  return {
    twoYear:  props.getProperty('SURFSHARK_PRICE_2Y')  || '',
    oneYear:  props.getProperty('SURFSHARK_PRICE_1Y')  || '',
    oneMonth: props.getProperty('SURFSHARK_PRICE_1M')  || '',
  };
}

// Attempts to scrape all three HK$ prices for Surfshark Starter (2yr, 1yr, 1mo)
function scrapeSurfsharkPrices() {
  try {
    const html = fetchUrl('https://surfshark.com/pricing');
    if (!html) return null;

    const hkMatches = [...html.matchAll(/HK\$\s*(\d+(?:\.\d+)?)/gi)];
    if (hkMatches.length >= 3) {
      const unique = [...new Set(hkMatches.map(m => String(Math.round(parseFloat(m[1])))))];
      unique.sort((a, b) => parseInt(a) - parseInt(b));
      if (unique.length >= 3) {
        console.log(`Surfshark scraped HK$ prices: ${unique.join(', ')}`);
        return { twoYear: unique[0], oneYear: unique[1], oneMonth: unique[2] };
      }
    }
    if (hkMatches.length === 1) {
      return { twoYear: String(Math.round(parseFloat(hkMatches[0][1]))), oneYear: null, oneMonth: null };
    }
    const usdMatch = html.match(/\$\s*(\d+\.\d{2})\s*(?:USD)?/);
    if (usdMatch) {
      const hkd = String(Math.round(parseFloat(usdMatch[1]) * USD_TO_HKD));
      console.log(`Surfshark: converted USD ${usdMatch[1]} → HK$${hkd} (2-year only)`);
      return { twoYear: hkd, oneYear: null, oneMonth: null };
    }
  } catch (e) {
    console.warn(`Surfshark price scrape failed: ${e.message}`);
  }
  return null;
}

// Updates the red intro paragraph: YYYY 年 M 月 D 日更新：...
function updateSurfsharkIntro(content, rate, date) {
  const chineseDate = formatChineseDate(date);
  return content.replace(
    /\d{4} 年 \d{1,2} 月 \d{1,2} 日更新：[^<]*/,
    `${chineseDate}更新：Topcashback 現時 SurfShark VPN 有 ${rate}% 回贈優惠！根據以往的經驗，這類高回贈優惠不會維持太久，有興趣的朋友請把握機會，立即行動啦！`
  );
}

// Updates the cashback table caption: 上表為 YYYY 年 M 月 Surfshark 的收費。
function updateSurfsharkCaption(content, date) {
  const y = Utilities.formatDate(date, 'Asia/Hong_Kong', 'yyyy');
  const m = parseInt(Utilities.formatDate(date, 'Asia/Hong_Kong', 'M'));
  return content.replace(
    /上表為 \d{4} 年 \d{1,2} 月 Surfshark 的收費。/,
    `上表為 ${y} 年 ${m} 月 Surfshark 的收費。`
  );
}

// Replaces Surfshark Starter prices in: comparison table, 官網價格 row, rebate row, ÷ calc
function updateSurfsharkPrices(content, oldPrices, newPrices) {
  const { twoYear: o2, oneYear: o1, oneMonth: om } = oldPrices;
  const { twoYear: n2, oneYear: n1, oneMonth: nm } = newPrices;

  if (n2 && n1 && nm) {
    content = content.replace(
      new RegExp(`(Surfshark Starter<\\/td><td>)HK\\$${o2}(<\\/td><td>)HK\\$${o1}(<\\/td><td>)HK\\$${om}(<\\/td>)`),
      `$1HK$${n2}$2HK$${n1}$3HK$${nm}$4`
    );
    content = content.replace(
      new RegExp(`(官網價格<\\/td><td>)HK\\$${o2}(<\\/td><td>)HK\\$${o1}(<\\/td><td>)HK\\$${om}(<\\/td>)`),
      `$1HK$${n2}$2HK$${n1}$3HK$${nm}$4`
    );
    content = content.replace(
      new RegExp(`-HK\\$${o2}(<\\/td><td>)-HK\\$${o1}(<\\/td><td>)-HK\\$${om}(<\\/td>)`),
      `-HK$${n2}$1-HK$${n1}$2-HK$${nm}$3`
    );
  } else if (n2 && n2 !== o2) {
    content = content.split(`HK$${o2}`).join(`HK$${n2}`);
  }

  if (n2 && n2 !== o2) {
    const newUSD = (parseInt(n2) / USD_TO_HKD).toFixed(1);
    content = content.replace(
      /HK\$\d+ ÷ 7\.85 = US\$[\d.]+/,
      `HK$${n2} ÷ ${USD_TO_HKD} = US$${newUSD}`
    );
  }

  return content;
}

function extractSurfsharkKeySection(content) {
  const introMatch = content.match(/\d{4} 年 \d{1,2} 月 \d{1,2} 日更新：[^<]*/);
  const tableMatch  = content.match(/Surfshark Starter[\s\S]{0,800}上表為[^<]+/);
  return [
    introMatch ? introMatch[0] : '',
    tableMatch ? tableMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '',
  ].join('\n\n');
}

// ── NordVPN Blog Update ─────────────────────────────────────────

function updateNordVPNBlogPost(rate, mgmRate) {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();

  const lastUpdateStr = props.getProperty('NORDVPN_LAST_UPDATE');
  const lastRate      = parseFloat(props.getProperty('NORDVPN_LAST_RATE') || '0');

  const rawContent = fetchWPPostRaw(WP_POST_ID_NORDVPN);
  if (!rawContent) return;

  const currentPrices = parseNordVPNPricesFromPost(rawContent);
  console.log(`NordVPN current prices: 2yr=HK$${currentPrices.twoYear}, 1yr=HK$${currentPrices.oneYear}, 1mo=HK$${currentPrices.oneMonth}`);

  const scrapedPrices = scrapeNordVPNPrices();
  const newPrices = {
    twoYear:  (scrapedPrices && scrapedPrices.twoYear)  || currentPrices.twoYear,
    oneYear:  (scrapedPrices && scrapedPrices.oneYear)  || currentPrices.oneYear,
    oneMonth: (scrapedPrices && scrapedPrices.oneMonth) || currentPrices.oneMonth,
  };
  const pricesChanged = newPrices.twoYear  !== currentPrices.twoYear  ||
                        newPrices.oneYear  !== currentPrices.oneYear  ||
                        newPrices.oneMonth !== currentPrices.oneMonth;

  console.log(`NordVPN scraped: 2yr=${scrapedPrices ? 'HK$' + scrapedPrices.twoYear : 'null'}, 1yr=${scrapedPrices ? 'HK$' + scrapedPrices.oneYear : 'null'}, 1mo=${scrapedPrices ? 'HK$' + scrapedPrices.oneMonth : 'null'} | changed=${pricesChanged}`);

  if (lastUpdateStr) {
    const daysSince = (now - new Date(lastUpdateStr)) / (1000 * 60 * 60 * 24);
    if (daysSince < BLOG_UPDATE_COOLDOWN_DAYS && rate === lastRate && !pricesChanged) {
      console.log(`NordVPN blog update skipped: ${daysSince.toFixed(1)} days ago, same rate (${rate}%), same prices`);
      return;
    }
  }

  const post = fetchWPPost(WP_POST_ID_NORDVPN);
  const sectionToCheck = extractNordVPNKeySection(post ? post.content.rendered : rawContent);
  const proofreadResult = proofreadWithClaude(sectionToCheck, newPrices, rate, 'NordVPN');
  if (proofreadResult && proofreadResult !== '無問題') {
    console.warn(`NordVPN proofread flagged: ${proofreadResult}`);
    sendProofreadAlert('NordVPN', WP_POST_ID_NORDVPN, proofreadResult, rate, newPrices);
  }

  let updated = updateNordVPNIntro(rawContent, rate, now);
  updated = updateNordVPNCaption(updated, now);
  if (pricesChanged) updated = updateNordVPNPrices(updated, currentPrices, newPrices);

  if (!pushWPPost(WP_POST_ID_NORDVPN, updated)) return;

  props.setProperty('NORDVPN_LAST_UPDATE', now.toISOString());
  props.setProperty('NORDVPN_LAST_RATE',   String(rate));
  props.setProperty('NORDVPN_PRICE_2Y',    newPrices.twoYear);
  props.setProperty('NORDVPN_PRICE_1Y',    newPrices.oneYear);
  props.setProperty('NORDVPN_PRICE_1M',    newPrices.oneMonth);

  console.log(`NordVPN blog updated. Prices: 2yr=HK$${newPrices.twoYear}, 1yr=HK$${newPrices.oneYear}, 1mo=HK$${newPrices.oneMonth}, Rate: ${rate}%`);
  sendBlogUpdateSummary('NordVPN', WP_POST_ID_NORDVPN, rate, newPrices, pricesChanged, proofreadResult);
}

function parseNordVPNPricesFromPost(content) {
  const match = content.match(/售價<\/td><td>HK\$(\d+)<\/td><td>HK\$(\d+)<\/td><td>HK\$(\d+)<\/td>/);
  if (match) return { twoYear: match[1], oneYear: match[2], oneMonth: match[3] };
  const props = PropertiesService.getScriptProperties();
  return {
    twoYear:  props.getProperty('NORDVPN_PRICE_2Y')  || '',
    oneYear:  props.getProperty('NORDVPN_PRICE_1Y')  || '',
    oneMonth: props.getProperty('NORDVPN_PRICE_1M')  || '',
  };
}

// Attempts to scrape all three HK$ prices for NordVPN Basic (2yr, 1yr, 1mo)
function scrapeNordVPNPrices() {
  try {
    const html = fetchUrl('https://nordvpn.com/pricing/');
    if (!html) return null;

    const hkMatches = [...html.matchAll(/HK\$\s*(\d+(?:\.\d+)?)/gi)];
    if (hkMatches.length >= 3) {
      const unique = [...new Set(hkMatches.map(m => String(Math.round(parseFloat(m[1])))))];
      unique.sort((a, b) => parseInt(a) - parseInt(b));
      if (unique.length >= 3) {
        console.log(`NordVPN scraped HK$ prices: ${unique.join(', ')}`);
        return { twoYear: unique[0], oneYear: unique[1], oneMonth: unique[2] };
      }
    }
    if (hkMatches.length === 1) {
      return { twoYear: String(Math.round(parseFloat(hkMatches[0][1]))), oneYear: null, oneMonth: null };
    }
    const usdMatch = html.match(/\$\s*(\d+\.\d{2})\s*(?:USD)?/);
    if (usdMatch) {
      const hkd = String(Math.round(parseFloat(usdMatch[1]) * USD_TO_HKD));
      console.log(`NordVPN: converted USD ${usdMatch[1]} → HK$${hkd} (2-year only)`);
      return { twoYear: hkd, oneYear: null, oneMonth: null };
    }
  } catch (e) {
    console.warn(`NordVPN price scrape failed: ${e.message}`);
  }
  return null;
}

// Updates the alert intro paragraph: YYYY 年 M 月 D 日：100% 回贈出現了！...
function updateNordVPNIntro(content, rate, date) {
  const chineseDate = formatChineseDate(date);
  return content.replace(
    /\d{4} 年 \d{1,2} 月 \d{1,2} 日：[^<]*/,
    `${chineseDate}：${rate}% 回贈出現了！所以現在買 NordVPN 免費！`
  );
}

// Updates the table caption: 以上資料截至 YYYY 年 M 月 D 日。
function updateNordVPNCaption(content, date) {
  return content.replace(
    /以上資料截至 \d{4} 年 \d{1,2} 月 \d{1,2} 日。/,
    `以上資料截至 ${formatChineseDate(date)}。`
  );
}

// Replaces NordVPN Basic prices in: 售價 row, rebate row, ÷ calc
function updateNordVPNPrices(content, oldPrices, newPrices) {
  const { twoYear: o2, oneYear: o1, oneMonth: om } = oldPrices;
  const { twoYear: n2, oneYear: n1, oneMonth: nm } = newPrices;

  if (n2 && n1 && nm) {
    content = content.replace(
      new RegExp(`(售價<\\/td><td>)HK\\$${o2}(<\\/td><td>)HK\\$${o1}(<\\/td><td>)HK\\$${om}(<\\/td>)`),
      `$1HK$${n2}$2HK$${n1}$3HK$${nm}$4`
    );
    content = content.replace(
      new RegExp(`-HK\\$${o2}(<\\/td><td>)-HK\\$${o1}(<\\/td><td>)-HK\\$${om}(<\\/td>)`),
      `-HK$${n2}$1-HK$${n1}$2-HK$${nm}$3`
    );
  } else if (n2 && n2 !== o2) {
    content = content.split(`HK$${o2}`).join(`HK$${n2}`);
  }

  if (n2 && n2 !== o2) {
    const newUSD = (parseInt(n2) / USD_TO_HKD).toFixed(1);
    content = content.replace(
      /HK\$\d+ ÷ 7\.85 = US\$[\d.]+/,
      `HK$${n2} ÷ ${USD_TO_HKD} = US$${newUSD}`
    );
  }

  return content;
}

function extractNordVPNKeySection(content) {
  const introMatch = content.match(/\d{4} 年 \d{1,2} 月 \d{1,2} 日：[^<]*/);
  const tableMatch  = content.match(/售價<\/td>[\s\S]{0,600}以上資料截至[^<]+/);
  return [
    introMatch ? introMatch[0] : '',
    tableMatch ? tableMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '',
  ].join('\n\n');
}

// ── WordPress API ───────────────────────────────────────────────

function wpAuthHeader() {
  const props = PropertiesService.getScriptProperties();
  const user  = props.getProperty('WP_USERNAME') || 'ai@flyasia.co';
  const pass  = props.getProperty('WP_APP_PASSWORD');
  return 'Basic ' + Utilities.base64Encode(`${user}:${pass}`);
}

function fetchWPPost(postId) {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${postId}`, {
      headers: { Authorization: wpAuthHeader() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error(`WP GET failed (post ${postId}): ${res.getResponseCode()} ${res.getContentText().substring(0, 200)}`);
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch (e) {
    console.error(`WP fetch error (post ${postId}): ${e.message}`);
    return null;
  }
}

function fetchWPPostRaw(postId) {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${postId}?context=edit`, {
      headers: { Authorization: wpAuthHeader() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error(`WP GET raw failed (post ${postId}): ${res.getResponseCode()}`);
      return null;
    }
    return JSON.parse(res.getContentText()).content.raw;
  } catch (e) {
    console.error(`WP raw fetch error (post ${postId}): ${e.message}`);
    return null;
  }
}

function pushWPPost(postId, rawContent) {
  try {
    const res = UrlFetchApp.fetch(`${WP_SITE}/wp-json/wp/v2/posts/${postId}`, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: wpAuthHeader() },
      payload: JSON.stringify({ content: rawContent }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      console.error(`WP POST failed (post ${postId}): ${res.getResponseCode()} ${res.getContentText().substring(0, 300)}`);
      return false;
    }
    console.log(`WP post ${postId} updated successfully (HTTP ${res.getResponseCode()})`);
    return true;
  } catch (e) {
    console.error(`WP push error (post ${postId}): ${e.message}`);
    return false;
  }
}

// ── Claude API Proofread ────────────────────────────────────────

// prices: { twoYear, oneYear, oneMonth }; brand: e.g. 'SurfShark VPN', 'NordVPN'
function proofreadWithClaude(section, prices, rate, brand) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — skipping proofread');
    return null;
  }

  const priceDesc = `2-year = HK$${prices.twoYear}, 1-year = HK$${prices.oneYear}, 1-month = HK$${prices.oneMonth}`;
  const prompt = `You are proofreading a Traditional Chinese blog post section about ${brand}. ` +
    `The expected values are: plan prices (${priceDesc}), Topcashback cashback rate = ${rate}%. ` +
    `Check the following text for any numerical contradictions or inconsistencies across all plan prices and the cashback rate. ` +
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
    console.log(`Claude proofread (${brand}): ${result}`);
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

// prices: { twoYear, oneYear, oneMonth }
function sendBlogUpdateSummary(brand, postId, rate, prices, pricesChanged, proofreadNote) {
  const subject = `[${brand} Blog] Post updated — ${rate}% promo | HK$${prices.twoYear} / HK$${prices.oneYear} / HK$${prices.oneMonth}`;
  const body = [
    `The ${brand} blog post (Post ID ${postId}) has been automatically updated.`,
    ``,
    `Cashback rate:  ${rate}%`,
    `2-year price:   HK$${prices.twoYear}`,
    `1-year price:   HK$${prices.oneYear}`,
    `1-month price:  HK$${prices.oneMonth}`,
    `Prices changed: ${pricesChanged ? 'YES — all price rows updated' : 'No change'}`,
    `Claude check:   ${proofreadNote || 'Skipped (no API key)'}`,
    ``,
    `Review the post: ${WP_SITE}/wp-admin/post.php?post=${postId}&action=edit`,
  ].join('\n');
  GmailApp.sendEmail(ALERT_EMAIL, subject, body, { from: FROM_EMAIL });
}

// prices: { twoYear, oneYear, oneMonth }
function sendProofreadAlert(brand, postId, note, rate, prices) {
  GmailApp.sendEmail(
    ALERT_EMAIL,
    `[${brand} Blog] ⚠ Proofread flag — please review`,
    `Claude flagged a potential inconsistency in the updated post:\n\n${note}\n\nRate: ${rate}%\n2-yr: HK$${prices.twoYear}, 1-yr: HK$${prices.oneYear}, 1-mo: HK$${prices.oneMonth}\n\nPost: ${WP_SITE}/wp-admin/post.php?post=${postId}&action=edit`,
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
//   props.setProperty('WP_USERNAME',       'ai@flyasia.co');
//   props.setProperty('WP_APP_PASSWORD',   'Yk4d f5hH f1AF qtTd O49e ftYX');
//   props.setProperty('ANTHROPIC_API_KEY', 'sk-ant-YOUR_KEY_HERE');
//   // Prices are auto-populated on first run from the live post content
// }

// Run setupTriggers() once to create both daily triggers, then delete it.
// function setupTriggers() {
//   ScriptApp.newTrigger('runTopCashbackMonitor').timeBased().atHour(14).everyDays(1).create();
//   ScriptApp.newTrigger('runTopCashbackMonitor').timeBased().atHour(18).everyDays(1).create();
// }
