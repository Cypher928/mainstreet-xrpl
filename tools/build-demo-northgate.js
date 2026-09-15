'use strict';
/**
 * Render Northgate Exchange's demonstration documents to real text-layer PDFs.
 *
 *   node tools/build-demo-northgate.js            # writes assets/demo/northgate/**
 *   node tools/build-demo-northgate.js --check    # exit 1 if any output is missing
 *
 * WHAT THESE ARE. Northgate Exchange is the demo property that MainStreet can
 * confidently bill. It can be billed because its expense pool is substantiated
 * and its leases say what the seed says they say — not because any safeguard
 * was relaxed. These documents are what "substantiated" means:
 *
 *   · one invoice PDF per register line, so the 100%-missing-source-document
 *     finding that holds Cascade Commons has nothing to fire on here;
 *   · one lease PDF per tenant, stating the same area, term, cap, base,
 *     exclusions and audit rights the seeded record carries.
 *
 * Every figure comes from demo-northgate.js. Nothing is retyped here, so a
 * change to the property cannot leave the paperwork behind — and
 * test-demo-northgate.js reads both the data and the rendered text back and
 * fails if they ever disagree.
 *
 * WHY PDF, WHY THIS WAY. Chromium's print pipeline emits ToUnicode CMaps, so
 * the documents carry a real text layer. The Evidence Viewer locates a cited
 * quote inside that layer; a picture of a page would silently fail to
 * highlight. Same route tools/build-demo-lease.js and build-demo-records.js
 * take.
 *
 * Nothing here is real. Every party, vendor, address and signature is invented.
 */
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const D    = require(path.join(ROOT, 'demo-northgate.js'));
const OUT_DIR = path.join(ROOT, 'assets', 'demo', 'northgate');
const INV_DIR = path.join(OUT_DIR, 'invoices');

const BANNER = 'Northgate Exchange — Demonstration Document — Fictional';
const P = D.PROPERTY;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = n => '$' + Number(n).toLocaleString('en-US');
const sqft = n => Number(n).toLocaleString('en-US');
const longDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
// Numbers a lease writes out in words as well as figures, the way a real one does.
const WORDS = { 4: 'four', 5: 'five', 6: 'six', 90: 'ninety', 120: 'one hundred twenty' };

const SHELL = `
  @page { size: Letter; margin: 0.85in 0.9in 0.9in 0.9in; }
  body { font: 10.5pt/1.55 "Helvetica Neue", Arial, sans-serif; color:#111; }
  .banner { border:2px solid #b45309; background:#fff7ed; color:#7c2d12; font-weight:700; text-align:center;
            padding:6pt 10pt; margin:0 0 14pt; letter-spacing:.02em; font-size:11pt; }
  .issuer { font-size:9.5pt; color:#444; margin:0 0 2pt; }
  h1 { font-size:15pt; margin:0 0 3pt; }
  .sub { color:#444; margin:0 0 14pt; font-size:10pt; }
  h2 { font-size:11pt; margin:14pt 0 5pt; border-bottom:1px solid #999; padding-bottom:2pt; }
  h3 { font-size:10.5pt; margin:11pt 0 4pt; }
  table { border-collapse:collapse; width:100%; margin:4pt 0 10pt; font-size:10pt; }
  td, th { border:1px solid #bbb; padding:4pt 6pt; vertical-align:top; text-align:left; }
  th { background:#f3f4f6; }
  td.k { width:36%; font-weight:600; background:#fafafa; }
  td.n, th.n { text-align:right; white-space:nowrap; }
  p { margin:0 0 8pt; }
  .note { font-size:9pt; color:#555; margin-top:16pt; border-top:1px solid #ccc; padding-top:6pt; }
  .sig td { border:none; padding:18pt 6pt 0; font-size:9.5pt; }
  .sig .line { border-top:1px solid #000; width:75%; padding-top:2pt; }
  .tot td { font-weight:700; background:#f9fafb; }
`;

function page(title, issuer, bodyHtml) {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>${SHELL}</style>
<div class="banner">${esc(BANNER)}</div>
<p class="issuer">${esc(issuer)}</p>
<h1>${esc(title)}</h1>
<p class="sub">Property: ${esc(P.name)} · ${esc(P.address)} · Parcel ${esc(P.parcel)}</p>
${bodyHtml}
<p class="note">${esc(BANNER)}. This document was generated for a product demonstration. The property, owner,
manager, tenants, vendors, amounts, account numbers and signatures are invented; any resemblance to a real
person, company, parcel or account is coincidental. It is not a bill, a lease, a contract or a public record.</p>`;
}

const kv = rows => '<table>' + rows.map(r => `<tr><td class="k">${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('') + '</table>';
const sig = names => '<table class="sig"><tr>' + names.map(n => `<td><div class="line">${esc(n)}</div></td>`).join('') + '</tr></table>';

// ── The lease ────────────────────────────────────────────────────────────────
//
// Only the articles the extraction fields actually need, written the way a
// retail lease writes them. Every figure is read from the tenant record, so the
// document and the seed state the same terms by construction.
function leaseHtml(t) {
  const pct = D.proRataPct(t);
  const capArticle = t.cap != null
    ? `<h3>6.4 Annual Cap on Controllable Common Area Costs</h3>
       <p>Tenant's Share of Common Area Costs payable in any calendar year shall not increase by more than
       <strong>${esc(WORDS[t.cap] || t.cap)} percent (${esc(t.cap)}%)</strong> over the amount payable by Tenant for the
       immediately preceding calendar year. Any amount in excess of that ceiling shall be borne by Landlord and
       shall not be carried forward.</p>
       <h3>6.5 Prior Year Base</h3>
       <p>For purposes of Section 6.4, Tenant's Share of Common Area Costs for the calendar year immediately
       preceding the Commencement of the current billing year was
       <strong>${esc(money0(t.capBaseAmount))}.00</strong> (${esc(money(t.capBaseAmount))}).</p>`
    : `<h3>6.4 Annual Cap on Controllable Common Area Costs</h3>
       <p>No annual cap or ceiling applies to Tenant's Share of Common Area Costs under this Lease. Tenant shall
       pay Tenant's Share as calculated under Section 6.2 without limitation.</p>`;

  const exclArticle = t.excluded_categories
    ? `<h3>6.6 Exclusions from Common Area Costs</h3>
       <p>Notwithstanding Section 6.1, Common Area Costs shall <strong>exclude ${esc(t.excluded_categories)}</strong>
       fees and charges of every kind, and no portion of any such cost shall be included in Tenant's Share.</p>`
    : `<h3>6.6 Exclusions from Common Area Costs</h3>
       <p>No category of Common Area Cost is excluded from Tenant's Share under this Lease.</p>`;

  return page(`Retail Lease Agreement — ${t.tenant_name}`,
    `${P.owner} (Landlord) and ${t.tenant_name} (Tenant) — fictional parties for demonstration`,
    `<p>This Retail Lease Agreement (the "Lease") is made as of ${esc(t.signedOn)} between
     <strong>${esc(P.owner)}</strong>, an Idaho limited liability company ("Landlord"), and
     <strong>${esc(t.tenant_name)}</strong> ("Tenant"), for premises at ${esc(P.address)}.</p>

    <h2>Article 1 — Basic Lease Provisions</h2>
    ${kv([
      ['1.1 Premises', `Suite ${t.suite}, comprising approximately ${sqft(t.leased_sqft)} rentable square feet`],
      ['1.2 Building', `${P.name}, containing approximately ${sqft(P.totalSqft)} rentable square feet`],
      ['1.3 Tenant’s Share', `${pct}% (Suite ${t.suite} rentable area divided by Building rentable area)`],
      ['1.4 Commencement Date', longDate(t.start_date)],
      ['1.5 Expiration Date', longDate(t.end_date)],
      ['1.6 Lease Type', 'Triple Net (NNN)'],
      ['1.7 Permitted Use', `Operation of ${t.use}`],
      ['1.8 Base Rent', `${money0(t.base_rent)}.00 per annum, payable in equal monthly instalments`],
      ['1.9 Security Deposit', `${money0(t.security_deposit)}.00`],
    ])}

    <h2>Article 2 — Term</h2>
    <p>The Term commences on ${esc(longDate(t.start_date))} and expires at 11:59 p.m. on
    ${esc(longDate(t.end_date))}, unless sooner terminated in accordance with this Lease.</p>

    <h2>Article 6 — Common Area Maintenance</h2>
    <h3>6.1 Common Area Costs</h3>
    <p>"Common Area Costs" means the actual costs incurred by Landlord in operating, maintaining, repairing,
    insuring and securing the common areas of the Building, including landscaping, parking field maintenance,
    common area utilities, janitorial and porter service, security, mechanical maintenance, property insurance
    and property management.</p>
    <h3>6.2 Tenant's Share</h3>
    <p>Tenant shall pay <strong>Tenant's Share</strong>, being <strong>${esc(pct)}%</strong> of Common Area Costs,
    determined by dividing the rentable area of the Premises (${esc(sqft(t.leased_sqft))} rentable square feet) by the
    rentable area of the Building (${esc(sqft(P.totalSqft))} rentable square feet). This Lease being
    <strong>Triple Net (NNN)</strong>, Tenant's Share is payable in addition to Base Rent.</p>
    <h3>6.3 Reconciliation</h3>
    <p>Within one hundred twenty (120) days after the end of each calendar year, Landlord shall deliver to Tenant a
    statement of the actual Common Area Costs for that year and Tenant's Share of them.</p>
    ${capArticle}
    ${exclArticle}

    <h2>Article 7 — Audit Rights</h2>
    <p>Tenant may, within <strong>${esc(WORDS[t.auditDays] || t.auditDays)} (${esc(t.auditDays)}) days</strong> after
    Tenant's receipt of Landlord's annual statement, give notice of its intention to examine Landlord's books and
    records supporting that statement, and may do so at Landlord's management office during business hours.</p>

    ${sig(['Landlord — ' + P.owner, 'Tenant — ' + t.tenant_name, 'Date'])}`);
}

// ── The invoice ──────────────────────────────────────────────────────────────
function invoiceHtml(inv) {
  return page(`Invoice ${inv.n}`, `${inv.vendorName} (fictional vendor) — billed to ${P.manager}, agent for ${P.owner}`,
    kv([
      ['Invoice number', inv.n],
      ['Invoice date', longDate(inv.invoiceDate)],
      ['Billed to', `${P.manager}, as agent for ${P.owner}`],
      ['Service location', `${P.name}, ${P.address}`],
      ['Expense category', inv.category],
      ['Terms', 'Net 30'],
    ]) +
    '<h2>Detail</h2>' +
    `<table><tr><th>Description</th><th class="n">Amount</th></tr>
      <tr><td>${esc(inv.desc)}</td><td class="n">${esc(money(inv.amount))}</td></tr>
      <tr class="tot"><td>Total due</td><td class="n">${esc(money(inv.amount))}</td></tr></table>` +
    `<p>This charge is a common area operating expense of ${esc(P.name)} for the ${esc(String(D.CAM_YEAR))}
     calendar year and is recoverable under the common area maintenance provisions of the centre's leases.</p>` +
    sig(['Authorised by — ' + inv.vendorName, 'Approved — ' + P.manager, 'Date']));
}

const DOCS = {};
D.TENANTS.forEach(t => { DOCS[path.join(OUT_DIR, D.leaseFileName(t))] = () => leaseHtml(t); });
D.INVOICES.forEach(i => { DOCS[path.join(INV_DIR, D.invoiceFileName(i))] = () => invoiceHtml(i); });

(async () => {
  const check = process.argv.includes('--check');
  fs.mkdirSync(INV_DIR, { recursive: true });
  const names = Object.keys(DOCS);
  if (check) {
    const missing = names.filter(n => !fs.existsSync(n)).map(n => path.relative(ROOT, n));
    console.log(missing.length ? 'missing: ' + missing.join(', ') : `all ${names.length} Northgate demonstration PDFs present`);
    process.exit(missing.length ? 1 : 0);
  }
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  let bad = 0;
  for (const out of names) {
    await pg.setContent(DOCS[out](), { waitUntil: 'load' });
    await pg.pdf({ path: out, format: 'Letter', printBackground: true });
    const buf = fs.readFileSync(out);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    const hasToUnicode = /ToUnicode/.test(buf.toString('latin1'));
    if (!hasToUnicode) bad++;
    console.log(`wrote ${path.relative(ROOT, out)} — ${Math.round(buf.length / 1024)} KB, ${pages} page(s), text layer: ${hasToUnicode ? 'yes' : 'NO'}`);
  }
  await browser.close();
  console.log(`\n${names.length} documents, ${bad} without a text layer`);
  process.exit(bad ? 1 : 0);
})();
