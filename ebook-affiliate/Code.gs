// ── Configuration ──────────────────────────────────────────────
// Container-bound: use SpreadsheetApp.getActiveSpreadsheet() instead of openById().
// SPREADSHEET_ID is kept here for reference/documentation only.
const SPREADSHEET_ID = '1uN-f5C7_CGIGiqNcSmk_5oWieB8suJVjKcPt0E04VAA';
const INTERNAL_EMAIL = 'flyasia.pacific@gmail.com';
const COMMISSION_RATE = 0.4;
const SETTLEMENT_THRESHOLD = 2000; // HKD

// ── Vendor Configuration ────────────────────────────────────────
// statusCol: 0-indexed column where paid/pending status lives.
// _asiamiles tabs: col E (index 4). _avios tabs: col D (index 3).
const VENDORS = [
  {
    name: 'HeaHotel',
    greeting: 'Dear Eddie and Team,',
    email: 'enjoyheahotel@gmail.com',
    cc: 'eddietin2000@yahoo.com.hk',
    tabs: [
      { sheetName: 'eddie_asiamiles', statusCol: 4 },
      { sheetName: 'eddie_avios',     statusCol: 3 },
    ],
  },
  {
    name: 'YolkInsight',
    greeting: 'Dear Mr. Poon,',
    email: 'yolkinsight@gmail.com',
    cc: '',
    tabs: [
      { sheetName: 'yolk_asiamiles', statusCol: 4 },
      { sheetName: 'yolk_avios',     statusCol: 3 },
    ],
  },
  {
    name: 'Edin',
    greeting: 'Dear Edin,',
    email: 'edintse@flywellltd.com',
    cc: '',
    tabs: [
      { sheetName: 'edin_asiamiles', statusCol: 4 },
      { sheetName: 'edin_avios',     statusCol: 3 },
    ],
  },
];

// ── Menu Setup ─────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Affiliate')
    .addItem('Run Monthly Settlement Now', 'triggerManualRun')
    .addToUi();
}

function triggerManualRun() {
  runMonthlySettlement();
}

// ── Main Logic ─────────────────────────────────────────────────

function runMonthlySettlement() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  const now = new Date();
  const monthLabel = formatMonthLabel(now); // e.g. "JUN 2026"

  console.log(`[${now.toISOString()}] Running affiliate settlement for ${monthLabel}`);

  const results = VENDORS.map(vendor => {
    const data = getVendorData(vendor, ss);
    const commission = data.totalUnpaid * COMMISSION_RATE;
    const needsSettlement = commission > SETTLEMENT_THRESHOLD;
    console.log(`${vendor.name}: unpaid HK$${data.totalUnpaid.toFixed(2)}, commission HK$${commission.toFixed(2)}, needsSettlement=${needsSettlement}`);
    return { vendor, data, commission, needsSettlement };
  });

  sendInternalSummary(results, monthLabel, now);

  results.forEach(r => {
    if (r.needsSettlement) {
      createSettlementDraft(r.vendor, r.data, r.commission, monthLabel);
    }
  });

  console.log(`[${new Date().toISOString()}] Done. Drafts created for: ${results.filter(r => r.needsSettlement).map(r => r.vendor.name).join(', ') || 'none'}`);
}

// ── Vendor Data Collection ──────────────────────────────────────

function getVendorData(vendor, ss) {
  let totalUnpaid = 0;
  const unpaidRows = [];

  vendor.tabs.forEach(tab => {
    const sheet = ss.getSheetByName(tab.sheetName);
    if (!sheet) {
      console.error(`Sheet not found: ${tab.sheetName}`);
      return;
    }

    const values = sheet.getDataRange().getValues();
    const dataRows = values.slice(1); // skip header

    dataRows.forEach(row => {
      const amount = row[1];
      const status = String(row[tab.statusCol] || '').trim().toLowerCase();

      if (!amount || typeof amount !== 'number') return;
      if (status === 'paid') return;

      totalUnpaid += amount;
      unpaidRows.push({
        date:   formatDate(row[0]),
        amount: amount,
        coupon: row[2] || '',
        source: tab.sheetName,
      });
    });
  });

  return { totalUnpaid, unpaidRows };
}

// ── Internal Summary Email ──────────────────────────────────────

function sendInternalSummary(results, monthLabel, runDate) {
  const subject = `[Affiliate Settlement] ${monthLabel} Monthly Summary`;

  const rows = results.map(r => {
    const badge = r.needsSettlement ? '[NEEDS SETTLEMENT]' : 'Below threshold';
    const badgeStyle = r.needsSettlement
      ? 'color:#b20000;font-weight:bold'
      : 'color:#2e7d32';
    return `
      <tr>
        <td style="padding:10px;border:1px solid #ddd;font-weight:bold">${r.vendor.name}</td>
        <td style="padding:10px;border:1px solid #ddd">HK$${r.data.totalUnpaid.toFixed(2)}</td>
        <td style="padding:10px;border:1px solid #ddd">HK$${r.commission.toFixed(2)}</td>
        <td style="padding:10px;border:1px solid #ddd;font-size:13px">${r.data.unpaidRows.length} row(s)</td>
        <td style="padding:10px;border:1px solid #ddd;${badgeStyle}">${badge}</td>
      </tr>`;
  }).join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:700px">
      <h2 style="color:#b38850">Affiliate Settlement Summary — ${monthLabel}</h2>
      <p style="color:#666">Run on: ${runDate.toLocaleString('en-HK', { timeZone: 'Asia/Hong_Kong' })}</p>
      <table style="border-collapse:collapse;width:100%;margin-top:20px">
        <thead>
          <tr style="background:#b38850;color:white">
            <th style="padding:10px;border:1px solid #ddd;text-align:left">Vendor</th>
            <th style="padding:10px;border:1px solid #ddd;text-align:left">Total Unpaid Sales</th>
            <th style="padding:10px;border:1px solid #ddd;text-align:left">Commission (40%)</th>
            <th style="padding:10px;border:1px solid #ddd;text-align:left">Unpaid Rows</th>
            <th style="padding:10px;border:1px solid #ddd;text-align:left">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:20px;color:#666;font-size:13px">
        Settlement threshold: HK$${SETTLEMENT_THRESHOLD.toFixed(2)} commission.<br>
        Gmail drafts have been created for all vendors marked [NEEDS SETTLEMENT].
      </p>
    </div>`;

  GmailApp.sendEmail(INTERNAL_EMAIL, subject, '', { htmlBody, from: 'info@flyasia.co' });
  console.log(`Internal summary sent to ${INTERNAL_EMAIL}`);
}

// ── Settlement Draft ────────────────────────────────────────────

function createSettlementDraft(vendor, data, commission, monthLabel) {
  const subject = `FlyAsia x ${vendor.name} / ${monthLabel} Affiliate Payment`;

  const salesRows = data.unpaidRows.map(r => `
        <tr>
          <td style="padding:8px;border:1px solid #ddd">${r.date}</td>
          <td style="padding:8px;border:1px solid #ddd">HK$${r.amount.toFixed(2)}</td>
          <td style="padding:8px;border:1px solid #ddd">${r.coupon}</td>
          <td style="padding:8px;border:1px solid #ddd;color:#666;font-size:12px">${r.source}</td>
        </tr>`).join('');

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:700px">
      <p>${vendor.greeting}</p>

      <p>Hope you are well.</p>

      <p>
        We would like to settle the affiliate commission for <strong>${monthLabel}</strong>.
        Below is a summary of the outstanding sales attributed to your referral code during this period.
      </p>

      <p>
        Could you please provide a tax invoice made out to <strong>FlyAsia Ltd.</strong>
        for the commission amount of <strong>HK$${commission.toFixed(2)}</strong>?
      </p>

      <h3 style="color:#b38850;border-bottom:2px solid #b38850;padding-bottom:8px">Outstanding Sales Details</h3>

      <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
        <thead>
          <tr style="background:#b38850;color:white">
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Date</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Amount (HKD)</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Coupon Code</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Source</th>
          </tr>
        </thead>
        <tbody>${salesRows}</tbody>
        <tfoot>
          <tr style="background:#f9f7f4;font-weight:bold">
            <td style="padding:8px;border:1px solid #ddd" colspan="1">Total</td>
            <td style="padding:8px;border:1px solid #ddd">HK$${data.totalUnpaid.toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ddd" colspan="2"></td>
          </tr>
          <tr style="background:#fff5f5;font-weight:bold;color:#b20000">
            <td style="padding:8px;border:1px solid #ddd" colspan="1">Commission (40%)</td>
            <td style="padding:8px;border:1px solid #ddd">HK$${commission.toFixed(2)}</td>
            <td style="padding:8px;border:1px solid #ddd" colspan="2"></td>
          </tr>
        </tfoot>
      </table>

      <p>Please send the invoice to <a href="mailto:sim@flyasia.co">sim@flyasia.co</a> at your earliest convenience.</p>

      <p>Thank you and looking forward to hearing from you!</p>

      <p>
        Best regards,<br>
        FlyAsia Team<br>
        <a href="https://www.flyasia.co">www.flyasia.co</a>
      </p>
    </div>`;

  const draftOptions = { htmlBody, from: 'info@flyasia.co' };
  if (vendor.cc) draftOptions.cc = vendor.cc;

  GmailApp.createDraft(vendor.email, subject, '', draftOptions);
  console.log(`Draft created for ${vendor.name} → ${vendor.email}${vendor.cc ? ` (cc: ${vendor.cc})` : ''}`);
}

// ── Helpers ─────────────────────────────────────────────────────

function formatMonthLabel(date) {
  return date.toLocaleString('en-HK', { month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' })
             .toUpperCase(); // e.g. "JUN 2026"
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toLocaleString('en-HK', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Hong_Kong' });
  }
  return String(val).split(' ')[0]; // trim time from "DD-MM-YYYY HH:MM:SS" strings
}

// ── One-time Trigger Setup ──────────────────────────────────────
// Run setupMonthlyTrigger() once from the editor to create the trigger, then delete it.
// function setupMonthlyTrigger() {
//   ScriptApp.newTrigger('runMonthlySettlement')
//     .timeBased()
//     .onMonthDay(14)
//     .atHour(9)
//     .create();
// }
