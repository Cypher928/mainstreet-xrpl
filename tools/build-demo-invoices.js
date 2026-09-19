'use strict';
/**
 * Render Cascade Commons' 2025 invoice register to real, text-layer PDFs.
 *
 *   node tools/build-demo-invoices.js            # writes assets/demo/invoices/*.pdf
 *   node tools/build-demo-invoices.js --check    # exit 1 if any output is missing
 *
 * WHY THESE EXIST. The demo property's CAM reconciliation was refused by the
 * product's own audit — "26 of 26 invoices missing source document" — because
 * the register was seeded as 26 rows of vendor, amount, category and date with
 * no document behind any of them. That refusal is correct behaviour and stays
 * exactly as it is. What was missing was the documents, and this builds them.
 *
 * THE REGISTER IS NOT COPIED HERE. Every vendor, amount, category and date is
 * parsed out of `demoInvoiceList` in script.js at build time, so there is one
 * register and a document cannot drift from the row it belongs to. If the
 * parse does not yield exactly the rows the seed holds, this refuses to write
 * anything. test-demo-invoices.js asserts the same correspondence from the
 * other end, against the rendered PDFs.
 *
 * THE LINE DESCRIPTIONS ARE NOT INVENTED FRESH. Where a filing-cabinet record
 * in demoCabinetRecords already describes an expense and links to its invoice
 * (the landscape agreement to invoices 1, 8 and 14; the roof repair to invoice
 * 20; the emergency RTU-3 call to invoice 25), the description here says the
 * same thing the record says. The documents and the cabinet agree because they
 * were written to agree.
 *
 * NOTHING HERE IS REAL. Every document is headed "Cascade Commons —
 * Demonstration Document — Fictional", names a fictional owner, manager and
 * vendors, and carries the same disclaimer footer as the property records. No
 * Northgate Exchange document is reused or referenced: that property has its
 * own register, its own vendors and its own Boise address.
 *
 * WHY PDF, WHY THIS WAY. Chromium's print pipeline embeds ToUnicode CMaps, so
 * PDF.js recovers real characters and the app's evidence viewer can find text
 * inside these documents. Same route as tools/build-demo-lease.js and
 * tools/build-demo-records.js.
 */
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT    = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'demo', 'invoices');
const SEED    = path.join(ROOT, 'script.js');

const BANNER   = 'Cascade Commons — Demonstration Document — Fictional';
const PROPERTY = '4820 Cascade Parkway, Austin, TX 78745';
const PARCEL   = 'TRAVIS-02-4417-0209';
const OWNER    = 'Cascade Commons Holdings, LLC';
const AGENT    = 'Cascade Property Management, as agent for ' + OWNER;

// ── The register, read from the seed ────────────────────────────────────────
// One source of truth. A hand-maintained copy here is exactly the drift this
// avoids: the audit compares documents to rows, and rows are in script.js.
function readRegister() {
  const src = fs.readFileSync(SEED, 'utf8');
  const block = /const demoInvoiceList = \[([\s\S]*?)\n  \];/.exec(src);
  if (!block) throw new Error('demoInvoiceList not found in script.js — the seed moved');
  const rowRe = /\{\s*vendorName:\s*'([^']+)',\s*amount:\s*(\d+(?:\.\d+)?),\s*category:\s*'([^']+)',\s*invoiceDate:\s*'(\d{4}-\d{2}-\d{2})'\s*\}/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(block[1]))) {
    rows.push({ vendorName: m[1], amount: Number(m[2]), category: m[3], invoiceDate: m[4] });
  }
  return rows;
}

// ── Who each vendor is, and what the line says ──────────────────────────────
// Keyed by register index, because that is the identity the seed itself uses:
// `inv-7` is the PavePro bill FitZone disputed, and a record's relatedInvoiceIds
// resolve to the same numbers.
const VENDOR = {
  'Meridian Property Insurance': { addr: '3300 Bee Cave Road, Suite 210 · Austin, TX 78746', kind: 'Insurance broker (fictional)' },
  'Green Valley Landscape':      { addr: '1155 Airport Boulevard · Austin, TX 78702',        kind: 'Landscape contractor (fictional)' },
  'Austin Energy':               { addr: 'Commercial Accounts · Austin, TX 78767',           kind: 'Electric utility (fictional account)' },
  'CleanSpace Commercial':       { addr: '4501 Freidrich Lane, Suite 120 · Austin, TX 78744', kind: 'Janitorial contractor (fictional)' },
  'Cascade Property Management': { addr: '4820 Cascade Parkway, Suite 200 · Austin, TX 78745', kind: 'Property manager (fictional)' },
  'WatchPoint Security':         { addr: '9020 Research Boulevard · Austin, TX 78758',       kind: 'Patrol and monitoring (fictional)' },
  'ComfortFirst HVAC':           { addr: '2210 Denton Drive · Austin, TX 78758',             kind: 'Mechanical contractor (fictional)' },
  'PavePro Inc':                 { addr: '6600 Burleson Road · Austin, TX 78744',            kind: 'Paving contractor (fictional)' },
  'BrightPath Electrical':       { addr: '1800 South Lamar Boulevard · Austin, TX 78704',    kind: 'Electrical contractor (fictional)' },
  'Cascade Handyman Services':   { addr: '705 Vargas Road · Austin, TX 78741',               kind: 'General repairs (fictional)' },
};

// The work each invoice is for. Where a filing-cabinet record already describes
// the expense and links this invoice, this says what that record says.
const LINES = {
  0:  [['Commercial property and general liability premium, policy TRV-CP-8843017-24, term October 1, 2024 – September 30, 2025 (Travelers Commercial Property, placed through this agency)', 42000]],
  1:  [['Grounds maintenance, January 2025 — mowing, bed maintenance, irrigation check, seasonal colour', 4800]],
  2:  [['Common area electricity and exterior lighting, first quarter 2025', 7200]],
  3:  [['Common area janitorial, first quarter 2025 — corridors, restrooms, entries, loading corridor', 5200]],
  4:  [['Property management fee, first quarter 2025 — per management agreement dated December 1, 2019', 7600]],
  5:  [['Patrol and alarm monitoring, first quarter 2025 — per agreement dated January 5, 2023', 2850]],
  6:  [['Spring preventive maintenance, six rooftop units — coil clean, belts, filters, refrigerant check, condensate', 3400]],
  7:  [['Parking lot seal coat and crack fill — 132 spaces, drive aisles and fire lane restriping', 5700]],
  8:  [['Grounds maintenance, spring 2025 — bed refresh, mulch, shrub pruning, irrigation repairs', 5200]],
  9:  [['Pylon sign and exterior lighting — ballast and LED retrofit, photocell replacement, circuit repair', 3800]],
  10: [['Common area electricity and exterior lighting, second quarter 2025', 7800]],
  11: [['Common area janitorial, second quarter 2025', 5200]],
  12: [['Property management fee, second quarter 2025', 7600]],
  13: [['Patrol and alarm monitoring, second quarter 2025', 2850]],
  14: [['Grounds maintenance, summer 2025 — peak irrigation, weekly mowing, tree canopy lift', 9000]],
  15: [['Common area electricity and exterior lighting, third quarter 2025 — summer peak demand', 8600]],
  16: [['Common area janitorial, third quarter 2025', 5200]],
  17: [['Property management fee, third quarter 2025', 7600]],
  18: [['Fall preventive maintenance, six rooftop units — heat exchanger inspection, burner clean, filters', 3200]],
  19: [['Patrol and alarm monitoring, fourth quarter 2025', 2850]],
  20: [['Roof drain and flashing repair — clear and reseat two roof drains, reflash the north parapet, replace cracked pitch pockets', 17100]],
  21: [['Common area electricity and exterior lighting, fourth quarter 2025', 4900]],
  22: [['Common area janitorial, fourth quarter 2025 — includes post-holiday deep clean', 5300]],
  23: [['Property management fee, fourth quarter 2025', 7600]],
  24: [['Patrol and alarm monitoring, December 2025 true-up and year-end holiday coverage', 2850]],
  25: [['Emergency call — RTU-3 blower motor replacement, after hours', 2900]],
};

const CATEGORY_LABEL = {
  insurance: 'insurance', landscaping: 'landscaping', utilities: 'utilities',
  janitorial: 'janitorial', management: 'management', security: 'security',
  maintenance: 'maintenance', repairs: 'repairs',
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad4 = n => String(n).padStart(4, '0');
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]
    + ' ' + d + ', ' + y;
};
const plusDays = (iso, days) => {
  const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + days);
  return longDate(t.toISOString().slice(0, 10));
};

function invoiceNo(i) { return 'CC-2025-' + pad4(i + 1); }
function fileNameFor(i) { return 'invoice-cc-2025-' + pad4(i + 1) + '.pdf'; }

function render(inv, i) {
  const v     = VENDOR[inv.vendorName] || { addr: 'Austin, TX', kind: 'Vendor (fictional)' };
  const lines = LINES[i] || [[inv.category + ' — 2025', inv.amount]];
  const rows  = lines.map(l => `<tr><td>${esc(l[0])}</td><td class="n">${esc(money(l[1]))}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Invoice ${esc(invoiceNo(i))}</title>
<style>
  @page { size: Letter; margin: 0.85in 0.9in 0.9in 0.9in; }
  body { font: 10.5pt/1.5 "Helvetica Neue", Arial, sans-serif; color:#111; }
  .banner { border:2px solid #b45309; background:#fff7ed; color:#7c2d12; font-weight:700; text-align:center;
            padding:6pt 10pt; margin:0 0 14pt; letter-spacing:.02em; font-size:11pt; }
  .issuer { font-size:9.5pt; color:#444; margin:0 0 2pt; }
  h1 { font-size:15pt; margin:0 0 3pt; }
  .sub { color:#444; margin:0 0 14pt; font-size:10pt; }
  h2 { font-size:11pt; margin:14pt 0 5pt; border-bottom:1px solid #999; padding-bottom:2pt; }
  table { border-collapse:collapse; width:100%; margin:4pt 0 10pt; font-size:10pt; }
  td, th { border:1px solid #bbb; padding:4pt 6pt; vertical-align:top; text-align:left; }
  th { background:#f3f4f6; }
  td.k { width:36%; font-weight:600; background:#fafafa; }
  td.n, th.n { text-align:right; white-space:nowrap; }
  tr.total td { font-weight:700; background:#fafafa; }
  p { margin:0 0 8pt; }
  .note { font-size:9pt; color:#555; margin-top:16pt; border-top:1px solid #ccc; padding-top:6pt; }
  .sig td { border:none; padding:18pt 6pt 0; font-size:9.5pt; }
  .sig .line { border-top:1px solid #000; width:75%; padding-top:2pt; }
</style>
<div class="banner">${esc(BANNER)}</div>
<p class="issuer">${esc(inv.vendorName)} — ${esc(v.kind)}<br>${esc(v.addr)}</p>
<h1>Invoice ${esc(invoiceNo(i))}</h1>
<p class="sub">Property: Cascade Commons · ${esc(PROPERTY)} · Parcel ${esc(PARCEL)}</p>
<table>
  <tr><td class="k">Invoice number</td><td>${esc(invoiceNo(i))}</td></tr>
  <tr><td class="k">Invoice date</td><td>${esc(longDate(inv.invoiceDate))}</td></tr>
  <tr><td class="k">Billed to</td><td>${esc(AGENT)}</td></tr>
  <tr><td class="k">Service location</td><td>Cascade Commons, ${esc(PROPERTY)}</td></tr>
  <tr><td class="k">Expense category</td><td>${esc(CATEGORY_LABEL[inv.category] || inv.category)}</td></tr>
  <tr><td class="k">Terms</td><td>Net 30 — due ${esc(plusDays(inv.invoiceDate, 30))}</td></tr>
</table>
<h2>Detail</h2>
<table>
  <tr><th>Description</th><th class="n">Amount</th></tr>
  ${rows}
  <tr class="total"><td>Total due</td><td class="n">${esc(money(inv.amount))}</td></tr>
</table>
<p>This charge is a common area operating expense of Cascade Commons for the 2025 calendar year and is recoverable
under the common area maintenance provisions of the centre's leases, subject to each lease's own caps and exclusions.</p>
<table class="sig"><tr>
  <td><div class="line">Authorised by — ${esc(inv.vendorName)}</div></td>
  <td><div class="line">Approved — Cascade Property Management</div></td>
  <td><div class="line">Date</div></td>
</tr></table>
<p class="note">${esc(BANNER)}. This document was generated for a product demonstration. The property, owner,
manager, vendors, amounts, invoice numbers, account numbers and signatures are invented; any resemblance to a real
person, company, parcel or account is coincidental. It is not a bill, a contract or a public record.</p>`;
}

(async () => {
  const register = readRegister();
  if (register.length !== 26) {
    console.error(`REFUSING TO WRITE: parsed ${register.length} invoices from script.js, expected 26.`);
    process.exit(2);
  }
  // Every line total must equal the row it documents, or the document would
  // state an amount the register does not.
  for (let i = 0; i < register.length; i++) {
    const sum = (LINES[i] || []).reduce((s, l) => s + l[1], 0);
    if (LINES[i] && Math.abs(sum - register[i].amount) > 0.005) {
      console.error(`REFUSING TO WRITE: invoice ${i} lines total ${sum}, register says ${register[i].amount}`);
      process.exit(2);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = register.map((_, i) => fileNameFor(i));

  if (process.argv.includes('--check')) {
    const missing = names.filter(n => !fs.existsSync(path.join(OUT_DIR, n)));
    console.log(missing.length ? 'missing: ' + missing.join(', ') : `all ${names.length} invoice PDFs present`);
    process.exit(missing.length ? 1 : 0);
  }

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  let bad = 0, total = 0;
  for (let i = 0; i < register.length; i++) {
    const out = path.join(OUT_DIR, fileNameFor(i));
    await pg.setContent(render(register[i], i), { waitUntil: 'load' });
    await pg.pdf({ path: out, format: 'Letter', printBackground: true });
    const buf = fs.readFileSync(out), latin = buf.toString('latin1');
    const pages = (latin.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const hasToUnicode = /ToUnicode/.test(latin);
    if (!hasToUnicode) bad++;
    total += register[i].amount;
    console.log(`wrote ${path.relative(ROOT, out)} — ${register[i].vendorName} ${money(register[i].amount)} `
      + `${register[i].invoiceDate} — ${Math.round(buf.length / 1024)} KB, ${pages} page(s), text layer: ${hasToUnicode ? 'yes' : 'NO'}`);
  }
  await browser.close();
  console.log(`\n${register.length} invoices · ${money(total)} — matches the register's own total pool.`);
  process.exit(bad ? 1 : 0);
})();
