'use strict';
/**
 * Render the Cascade Commons demonstration documents to real, text-layer PDFs.
 *
 *   node tools/build-demo-records.js            # writes assets/demo/records/*.pdf
 *   node tools/build-demo-records.js --check    # exit 1 if any output is missing/stale
 *
 * WHAT THESE ARE. The seeded demo property's filing cabinet (script.js,
 * demoCabinetRecords) attaches documents to its records the way a real
 * property's records carry their bills, policies and reports. Nothing here is
 * real: every document is headed "Cascade Commons — Demonstration Document —
 * Fictional", names a fictional owner, manager, lender and contractors, and
 * agrees with the facts the rest of the demo already states (the same policy
 * number, the same parcel, the same roof, the same rooftop units, the same
 * 2025 invoice register). They open through the app's ordinary document path
 * (docLinkHtml) as static files — there is no second document system.
 *
 * WHY PDF, WHY THIS WAY. Chromium's print pipeline produces a text layer
 * (ToUnicode CMaps), the same route tools/build-demo-lease.js takes, so the
 * documents are searchable and readable rather than pictures of paper.
 */
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'demo', 'records');

const BANNER = 'Cascade Commons — Demonstration Document — Fictional';
const PROPERTY = '4820 Cascade Parkway, Austin, TX 78745';
const PARCEL = 'TRAVIS-02-4417-0209';
const OWNER = 'Cascade Commons Holdings, LLC';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function page(title, issuer, bodyHtml) {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
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
  p { margin:0 0 8pt; }
  .note { font-size:9pt; color:#555; margin-top:16pt; border-top:1px solid #ccc; padding-top:6pt; }
  .sig td { border:none; padding:18pt 6pt 0; font-size:9.5pt; }
  .sig .line { border-top:1px solid #000; width:75%; padding-top:2pt; }
</style>
<div class="banner">${esc(BANNER)}</div>
<p class="issuer">${esc(issuer)}</p>
<h1>${esc(title)}</h1>
<p class="sub">Property: Cascade Commons · ${esc(PROPERTY)} · Parcel ${esc(PARCEL)}</p>
${bodyHtml}
<p class="note">${esc(BANNER)}. This document was generated for a product demonstration. The property, owner,
manager, lender, contractors, amounts, account numbers and signatures are invented; any resemblance to a real
person, company, parcel or account is coincidental. It is not a bill, a policy, a contract or a public record.</p>`;
}

const kv = rows => '<table>' + rows.map(r => `<tr><td class="k">${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + '</table>';
const tbl = (head, rows) => '<table><tr>' + head.map((h, i) => `<th${i > 0 ? ' class="n"' : ''}>${esc(h)}</th>`).join('') + '</tr>' +
  rows.map(r => '<tr>' + r.map((c, i) => `<td${i > 0 ? ' class="n"' : ''}>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>';
const sig = names => '<table class="sig"><tr>' + names.map(n => `<td><div class="line">${esc(n)}</div></td>`).join('') + '</tr></table>';

const DOCS = {
  'tax-bill-2025.pdf': () => page('2025 Property Tax Statement', 'County Tax Assessor-Collector (fictional office for demonstration)',
    kv([['Account', PARCEL], ['Owner of record', OWNER], ['Tax year', '2025'], ['Appraised value', '$6,520,000'],
        ['Taxable value', '$6,520,000'], ['Statement date', 'October 17, 2025'], ['Due date', 'January 31, 2026']]) +
    '<h2>Levy by jurisdiction</h2>' +
    tbl(['Jurisdiction', 'Rate per $100', 'Tax'], [
      ['County', '0.3182', '$20,747'], ['City', '0.4458', '$29,066'], ['Independent School District', '1.1500', '$74,980'],
      ['Community College District', '0.1040', '$6,781'], ['Healthcare District', '0.0821', '$5,346'],
      ['Total 2025 levy', '2.1001', '$136,920']]) +
    '<p>Payment is escrowed with the mortgage lender. Real Property Taxes are recovered from tenants under the leases in proportion to rentable area.</p>'),

  'tax-appraisal-notice-2026.pdf': () => page('2026 Notice of Appraised Value', 'Central Appraisal District (fictional office for demonstration)',
    kv([['Account', PARCEL], ['Owner', OWNER], ['Notice date', 'April 15, 2026'], ['Property type', 'Commercial — retail strip center, 26,000 sqft'],
        ['Proposed market value 2026', '$6,875,000'], ['Prior year value 2025', '$6,520,000'], ['Protest deadline', 'May 15, 2026']]) +
    '<h2>Outcome</h2>' +
    kv([['Protest filed', 'May 12, 2026 — comparable sales and income approach'], ['Informal hearing', 'June 9, 2026'],
        ['Settled value', '$6,640,000'], ['Certified roll', 'July 25, 2026'], ['Next step', '2026 tax bill expected October 2026; payment due January 31, 2027']])),

  'insurance-policy-2025-26.pdf': () => page('Commercial Property Policy — Declarations', 'Issued through Meridian Property Insurance (fictional broker) · Carrier: Travelers Commercial Property',
    kv([['Policy number', 'TRV-CP-8843017-25'], ['Named insured', OWNER], ['Policy period', 'October 1, 2025 to September 30, 2026 (12:01 a.m.)'],
        ['Insured location', 'Cascade Commons, ' + PROPERTY], ['Mortgagee / loss payee', 'Pecan Valley Commercial Capital, LLC (fictional lender)']]) +
    '<h2>Coverages</h2>' +
    tbl(['Coverage', 'Limit', 'Deductible'], [
      ['Building — replacement cost', '$7,600,000', '$10,000'], ['Business income and extra expense', '12 months actual loss sustained', '72 hours'],
      ['Wind and hail', 'Included in building limit', '2% of building limit'], ['Equipment breakdown', '$7,600,000', '$5,000'],
      ['General liability (each occurrence / aggregate)', '$1,000,000 / $2,000,000', 'None']]) +
    kv([['Annual premium', '$42,000 — invoiced annually through the broker'], ['Expiration', 'September 30, 2026 — renewal due before this date']])),

  'insurance-claim-2024-hail.pdf': () => page('Claim Settlement Letter — Hail, May 28, 2024', 'Travelers Commercial Property claims (demonstration correspondence)',
    kv([['Claim number', 'CP-2024-118804 (fictional)'], ['Policy', 'TRV-CP-8843017-24 (2024–25 term)'], ['Date of loss', 'May 28, 2024'],
        ['Reported', 'May 30, 2024'], ['Adjuster inspection', 'June 6, 2024']]) +
    '<h2>Findings</h2>' +
    '<p>The TPO roof membrane was inspected with the roofing contractor and found intact with no punctures or fastener damage; minor granule loss on walkway pads is cosmetic. The claim is limited to two rooftop unit condenser coils (RTU-2 and RTU-4) damaged by hail.</p>' +
    tbl(['Item', 'Amount'], [['Condenser coil replacement, RTU-2', '$11,400'], ['Condenser coil replacement, RTU-4', '$11,400'],
      ['Crane and access', '$3,950'], ['Gross loss', '$26,750'], ['Less deductible (wind/hail)', '($8,000)'], ['Net settlement', '$18,750']]) +
    sig(['Claims representative', 'Date: June 21, 2024'])),

  'loan-note-summary.pdf': () => page('Loan Summary and Note Terms', 'Pecan Valley Commercial Capital, LLC — a fictional lender created for this demonstration',
    kv([['Borrower', OWNER], ['Guarantor', 'Cascade Commons Holdings, LLC principals'], ['Loan number', 'PVCC-2019-0441 (fictional)'],
        ['Closing date', 'November 1, 2019'], ['Original principal', '$4,150,000'], ['Term', '10 years — maturity November 1, 2029'],
        ['Amortization', '25 years'], ['Interest rate', '4.35% fixed (reduced to 4.10% by First Amendment, June 15, 2022)'],
        ['Monthly principal and interest', '$22,720 (original schedule)'], ['Escrow', 'Real estate taxes and property insurance, analysed annually'],
        ['Collateral', 'First lien deed of trust on Cascade Commons, assignment of leases and rents'],
        ['Reporting', 'Annual operating statement, rent roll and CAM reconciliation within 90 days of year end (§7.1)'],
        ['Insurance', 'Evidence of property insurance naming lender as mortgagee and loss payee (§5.2)']]) +
    '<h2>Key dates</h2>' + tbl(['Event', 'Date'], [['Closing', 'November 1, 2019'], ['First Amendment (rate modification)', 'June 15, 2022'],
      ['Maturity', 'November 1, 2029'], ['Prepayment without premium', 'From May 1, 2029']])),

  'escrow-analysis-2025.pdf': () => page('Annual Escrow Analysis — 2025', 'Pecan Valley Commercial Capital, LLC (fictional lender) · Loan PVCC-2019-0441',
    '<p>Analysis date: November 12, 2025. Escrow is collected monthly for real estate taxes and property insurance and disbursed when due.</p>' +
    tbl(['Item', 'Annual amount', 'Monthly'], [['Real estate taxes (2025 levy)', '$136,920', '$11,410'], ['Property insurance premium', '$42,000', '$3,500'],
      ['Total escrow for 2026', '$178,920', '$14,910']]) +
    tbl(['Account summary', 'Amount'], [['Balance at analysis', '$31,060'], ['Required cushion (two months)', '$29,800'], ['Surplus refunded', '$1,260']]) +
    '<p>The new monthly escrow of $14,910 is effective with the January 1, 2026 payment.</p>'),

  'cam-closeout-2024.pdf': () => page('2024 CAM Reconciliation — Close-out', 'Cascade Property Management (fictional manager) for ' + OWNER,
    '<p>Reconciliation of 2024 common area maintenance costs against estimates billed, issued February 14, 2025.</p>' +
    tbl(['Category', 'Actual 2024'], [['Insurance', '$40,500'], ['Landscaping', '$17,900'], ['Utilities (common area)', '$27,300'], ['Janitorial', '$20,400'],
      ['Management', '$29,600'], ['Security', '$11,200'], ['Maintenance (HVAC, lighting)', '$12,340'], ['Repairs', '$17,000'], ['Total operating expenses', '$176,240']]) +
    tbl(['Tenant', 'Share', 'Estimates billed', 'Actual share', 'True-up'], [
      ['Whole Health Market', '35.38%', '$60,100', '$62,354', '$2,254 due'], ['Summit Coffee & Provisions', '6.92%', '$12,200', '$12,196', '($4) credit'],
      ['ProActive Physical Therapy', '16.92%', '$29,000', '$29,820', '$820 due'], ['FitZone Athletics', '26.15%', '$44,800', '$46,087', '$1,287 due'],
      ['Harbor Nail & Beauty Studio', '4.62% (from Feb 1)', '$7,100', '$7,459', '$359 due']]) +
    '<p>No disputes were raised. These actuals are the base-year figures the 2025 caps are measured against.</p>'),

  'budget-2026-draft.pdf': () => page('2026 Operating Budget — Draft for Owner Approval', 'Cascade Property Management (fictional manager) · circulated December 3, 2025',
    tbl(['Category', '2025 budget', '2025 actual', '2026 draft'], [['Insurance', '$42,000', '$42,000', '$44,100'], ['Landscaping', '$18,000', '$19,000', '$19,600'],
      ['Utilities', '$28,000', '$28,500', '$29,650'], ['Janitorial', '$20,800', '$20,900', '$21,500'], ['Management', '$30,400', '$30,400', '$30,400'],
      ['Security', '$11,400', '$11,400', '$11,750'], ['Maintenance', '$14,900', '$13,300', '$14,800'], ['Repairs', '$16,000', '$22,800', '$18,000'],
      ['Parking seal coat reserve', '—', '—', '$5,000'], ['Total', '$181,500', '$188,300', '$194,800']]) +
    '<p>Assumptions: 4% utility increase, the renewed ComfortFirst HVAC maintenance agreement, and a reserve toward the next parking-lot seal coat. Repairs are budgeted above the 2025 plan after the October 2025 work orders.</p>'),

  'management-agreement.pdf': () => page('Property Management Agreement', OWNER + ' (Owner) and Cascade Property Management (Manager) — both fictional',
    kv([['Effective date', 'December 1, 2019'], ['Property', 'Cascade Commons, ' + PROPERTY + ' — 26,000 rentable sqft'],
        ['Term', 'Through December 31, 2026, renewing for successive one-year terms unless either party gives 60 days’ written notice'],
        ['Management fee', '4% of gross collected revenue, invoiced quarterly'], ['Leasing commission', 'Per separate schedule'],
        ['Authority', 'Manager may approve expenditures up to $5,000 per item without Owner consent; capital items require written approval'],
        ['Reporting', 'Monthly operating statements; annual CAM reconciliation by February 28; annual budget by December 15']]) +
    sig(['Owner', 'Manager', 'Date'])),

  'roof-warranty-2019.pdf': () => page('Roof System Warranty Certificate — 20 Years', 'Issued by the membrane manufacturer (fictional certificate for demonstration) · Installed by Hill Country Roofing Co. (fictional)',
    kv([['Warranty number', 'TPO-NDL-2019-77410 (fictional)'], ['Building owner', OWNER], ['Roof area', '26,400 sqft'],
        ['System', '60-mil TPO membrane, mechanically fastened, over polyiso insulation'], ['Completion date', 'August 30, 2019'],
        ['Warranty period', '20 years — expires August 30, 2039'], ['Type', 'No-dollar-limit system warranty covering membrane, seams and flashings'],
        ['Conditions', 'Annual inspection by an authorised contractor; repairs by authorised contractors only; rooftop equipment changes to be reported']]) +
    '<p>Damage from hail is covered to the extent the membrane fails to remain watertight; cosmetic damage is excluded. See the June 6, 2024 inspection record.</p>'),

  'fire-inspection-2025.pdf': () => page('Fire Protection Inspection Report — Annual', 'Fictional fire protection contractor, licensed for demonstration purposes only',
    kv([['Inspection date', 'October 20, 2025'], ['Systems', 'Wet-pipe automatic sprinkler (one riser), monitored fire alarm, exit and emergency lighting'],
        ['Result', 'PASS — tags applied'], ['Deficiencies corrected', 'Two corroded sprinkler heads in the loading corridor replaced same day'],
        ['Main drain test', 'Static 68 psi / residual 54 psi — within range'], ['Alarm transmission', 'Verified with the monitoring station'],
        ['Next annual inspection due', 'October 20, 2026']]) +
    sig(['Inspector', 'Property manager', 'Date'])),

  'hvac-rtu-replacement-2024.pdf': () => page('Rooftop Unit Replacement — Proposal and Completion', 'ComfortFirst HVAC (fictional contractor) for ' + OWNER,
    kv([['Scope', 'Replace RTU-5 and RTU-6 (original 2003 units serving Suites 140 and 150) with Carrier 48TC 7.5-ton packaged units'],
        ['Includes', 'Crane, curb adapters, new thermostats, start-up and commissioning; removal and disposal of the old units'],
        ['Proposal accepted', 'July 22, 2024'], ['Completed', 'August 16, 2024'], ['Contract amount', '$31,800 (capital — not a CAM expense)'],
        ['Warranty', '10 years compressor, 5 years parts (manufacturer); 1 year labour'],
        ['Fleet after completion', 'Six Carrier 48TC units, 3–10 tons, installed 2019–2024']]) +
    sig(['Contractor', 'Owner representative', 'Date'])),
};

(async () => {
  const check = process.argv.includes('--check');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = Object.keys(DOCS);
  if (check) {
    const missing = names.filter(n => !fs.existsSync(path.join(OUT_DIR, n)));
    console.log(missing.length ? 'missing: ' + missing.join(', ') : `all ${names.length} demonstration PDFs present`);
    process.exit(missing.length ? 1 : 0);
  }
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  let bad = 0;
  for (const name of names) {
    const out = path.join(OUT_DIR, name);
    await pg.setContent(DOCS[name](), { waitUntil: 'load' });
    await pg.pdf({ path: out, format: 'Letter', printBackground: true });
    const buf = fs.readFileSync(out);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const hasToUnicode = /ToUnicode/.test(buf.toString('latin1'));
    if (!hasToUnicode) bad++;
    console.log(`wrote ${path.relative(ROOT, out)} — ${Math.round(buf.length / 1024)} KB, ${pages} page(s), text layer: ${hasToUnicode ? 'yes' : 'NO'}`);
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
