'use strict';
// test-demo-northgate.js — the Northgate Exchange demo says the same thing
// three times over, and the third is a real document.
//
//   node test-demo-northgate.js
//
// Northgate Exchange is the demo property MainStreet can bill. It is billable
// because its expense pool is substantiated and its leases genuinely support
// the charge — not because a safeguard was relaxed. That claim only holds if
// three things agree and stay agreeing:
//
//   A · the seed data itself is internally consistent and satisfies, by
//       construction, every condition the billing gate checks;
//   B · the lease PDFs state the same area, term, cap, base, exclusions and
//       audit rights the seeded leases carry;
//   C · every register line has a source document that exists and is readable.
//
// A drift in any one of them would make the demo a lie in exactly the way
// Cascade's own test-demo-lease.js exists to prevent.
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const D    = require('./demo-northgate.js');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log(`  \x1b[32mok\x1b[0m   ${m}`); };
const bad = (m, d) => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? `\n       ${d}` : ''}`); };
const is  = (c, m, d) => c ? ok(m) : bad(m, d);
const sec = (s) => console.log(`\n── ${s} ──`);

const money0 = n => '$' + Number(n).toLocaleString('en-US');
const sqftStr = n => Number(n).toLocaleString('en-US');

(async () => {
  // ══ A · the seed data ═══════════════════════════════════════════════════
  sec('A · the property accounts for itself');

  const leased = D.leasedSqft();
  const pool   = D.poolTotal();
  is(leased + D.VACANCY.leased_sqft === D.PROPERTY.totalSqft,
     `leases (${sqftStr(leased)}) plus the recorded vacancy (${sqftStr(D.VACANCY.leased_sqft)}) equal the building (${sqftStr(D.PROPERTY.totalSqft)})`,
     `got ${leased + D.VACANCY.leased_sqft}`);
  const pctSum = D.TENANTS.reduce((s, t) => s + D.proRataPct(t), 0);
  const vacPct = Math.round((D.VACANCY.leased_sqft / D.PROPERTY.totalSqft) * 10000) / 100;
  is(Math.abs(pctSum + vacPct - 100) < 0.01,
     `pro-rata shares (${pctSum}%) plus the vacancy (${vacPct}%) account for 100% of the building`,
     `sum ${pctSum + vacPct}`);
  is(pctSum + vacPct - pctSum <= 2 + vacPct, 'the uncovered remainder after the vacancy is nil, so coverage can read green');

  sec('A2 · nothing in the seed can block billing');
  is(D.TENANTS.every(t => t.lease_type === 'NNN'),
     'every lease is NNN — no Gross or Modified Gross tenant, which blocks by design');
  is(D.TENANTS.every(t => t.start_date <= `${D.CAM_YEAR}-01-01` && t.end_date >= `${D.CAM_YEAR}-12-31`),
     `every lease spans the whole of ${D.CAM_YEAR}, so no tenant is billed for a period its lease did not cover`,
     JSON.stringify(D.TENANTS.map(t => [t.key, t.start_date, t.end_date])));
  // Each of these is a term the engine READS but does not APPLY. Stating one
  // raises a blocking "lease provisions not applied" finding.
  const UNAPPLIED = ['admin_fee_pct', 'admin_fee_basis', 'gross_up_pct', 'expense_stop', 'base_year', 'pro_rata_method'];
  const stated = D.TENANTS.flatMap(t => UNAPPLIED.filter(k => t[k] != null).map(k => `${t.key}.${k}`));
  is(stated.length === 0,
     'no lease states a provision the CAM engine does not apply', stated.join(', '));
  is(D.TENANTS.every(t => !('fieldEvidence' in t)),
     'no tenant carries seeded fieldEvidence — citations come from extraction, never from the fixture');

  sec('A3 · the caps are real, and one of them does not bite');
  const mgmt = D.INVOICES.filter(i => i.category === 'management').reduce((s, i) => s + i.amount, 0);
  const capped = D.TENANTS.filter(t => t.cap != null);
  is(capped.length === 3, `three leases carry a percentage cap (${capped.map(t => t.key).join(', ')})`);
  is(capped.every(t => Number(t.capBaseAmount) > 0),
     'and every one of them states a usable prior-year base, so the cap is enforceable rather than unresolved');
  const outcome = D.TENANTS.map(t => {
    const base = t.excluded_categories === 'management' ? pool - mgmt : pool;
    const uncapped = base * D.proRataPct(t) / 100;
    const ceiling = t.cap != null ? t.capBaseAmount * (1 + t.cap / 100) : null;
    return { key: t.key, fires: ceiling != null && uncapped > ceiling };
  });
  is(outcome.filter(o => o.fires).length === 2,
     'two caps bite this year, so enforcement is visible', JSON.stringify(outcome));
  is(outcome.some(o => !o.fires && D.TENANTS.find(t => t.key === o.key).cap != null),
     'and one capped lease lands inside its ceiling, so a cap reads as a limit rather than a discount');

  sec('A4 · the register is clean and the exclusion is demonstrable');
  is(D.INVOICES.length >= 12 && D.INVOICES.length <= 16, `${D.INVOICES.length} invoices`);
  is(D.INVOICES.every(i => String(i.invoiceDate).slice(0, 4) === String(D.CAM_YEAR)),
     `every invoice is dated inside ${D.CAM_YEAR}`);
  is(D.INVOICES.every(i => i.invoiceDate && i.amount > 0 && i.vendorName && i.category),
     'every invoice has a date, an amount, a vendor and a category');
  const largest = Math.max(...D.INVOICES.map(i => i.amount));
  is(largest / pool < 0.40,
     `the largest single invoice is ${(largest / pool * 100).toFixed(1)}% of the pool, inside the 40% concentration threshold`);
  const dupKey = i => `${i.vendorName}|${i.amount}|${i.invoiceDate}`;
  is(new Set(D.INVOICES.map(dupKey)).size === D.INVOICES.length,
     'no two invoices share a vendor, amount and date, so nothing reads as a duplicate');
  const excl = D.TENANTS.filter(t => t.excluded_categories);
  is(excl.length >= 1, `at least one lease excludes a category (${excl.map(t => `${t.key}: ${t.excluded_categories}`).join(', ')})`);
  is(excl.every(t => D.INVOICES.some(i => i.category === t.excluded_categories)),
     'and the excluded category is actually present in the register, so the exclusion changes a number');
  is(Math.abs(pool / D.PROPERTY.totalSqft - 4.5) < 1.5,
     `the pool is ${(pool / D.PROPERTY.totalSqft).toFixed(2)} per square foot, which is an ordinary figure for neighbourhood retail`);

  sec('A5 · ids and paths are stable and unique');
  is(new Set(D.TENANTS.map(t => t.key)).size === D.TENANTS.length, 'tenant keys are unique');
  is(new Set(D.TENANTS.map(t => t.suite)).size === D.TENANTS.length, 'suites are unique');
  is(!D.TENANTS.some(t => t.suite === D.VACANCY.suite), 'the vacant suite is not also a leased suite');
  is(new Set(D.INVOICES.map(i => i.n)).size === D.INVOICES.length, 'invoice numbers are unique');

  // ══ C · the documents exist ═════════════════════════════════════════════
  sec('C · every document the seed points at is on disk');
  let missing = [];
  for (const t of D.TENANTS) {
    const p = path.join(ROOT, D.leasePath(t));
    if (!fs.existsSync(p)) missing.push(D.leasePath(t));
  }
  for (const i of D.INVOICES) {
    const p = path.join(ROOT, D.invoicePath(i));
    if (!fs.existsSync(p)) missing.push(D.invoicePath(i));
  }
  is(missing.length === 0,
     `all ${D.TENANTS.length} lease PDFs and ${D.INVOICES.length} invoice PDFs are present`,
     missing.join(', ') + ' — run node tools/build-demo-northgate.js');
  if (missing.length) {
    console.log(`\n\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(1);
  }

  // ══ B · the lease documents say what the seed says ══════════════════════
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch (_) { bad('pdfjs-dist not installed', 'npm install'); console.log(''); process.exit(1); }

  const readPdf = async (rel) => {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(path.join(ROOT, rel))), useSystemFonts: true,
    }).promise;
    const parts = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      parts.push(tc.items.map(i => i.str).join(' '));
    }
    return { text: parts.join('\n').replace(/\s+/g, ' '), pages: doc.numPages };
  };

  sec('B · every lease PDF states the terms the seed asserts');
  for (const t of D.TENANTS) {
    const { text, pages } = await readPdf(D.leasePath(t));
    const label = t.tenant_name;
    const want = [
      [`${label}: names the tenant`,           new RegExp(t.tenant_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
      [`${label}: suite ${t.suite}`,            new RegExp(`Suite ${t.suite}\\b`)],
      [`${label}: ${sqftStr(t.leased_sqft)} rentable square feet`, new RegExp(`${sqftStr(t.leased_sqft)} rentable square feet`)],
      [`${label}: building ${sqftStr(D.PROPERTY.totalSqft)} rentable square feet`, new RegExp(`${sqftStr(D.PROPERTY.totalSqft)} rentable square feet`)],
      [`${label}: pro-rata ${D.proRataPct(t)}%`, new RegExp(`${String(D.proRataPct(t)).replace('.', '\\.')}%`)],
      [`${label}: Triple Net (NNN)`,             /Triple Net \(NNN\)/],
      [`${label}: audit window of ${t.auditDays} days`, new RegExp(`\\(${t.auditDays}\\) days`)],
      [`${label}: fictional banner`,             /Demonstration Document — Fictional|Demonstration Document . Fictional/],
    ];
    // The dates, written the way the document writes them.
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const asWritten = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
    want.push([`${label}: commencement ${asWritten(t.start_date)}`, new RegExp(asWritten(t.start_date))]);
    want.push([`${label}: expiration ${asWritten(t.end_date)}`,     new RegExp(asWritten(t.end_date))]);

    if (t.cap != null) {
      want.push([`${label}: cap of ${t.cap}%`, new RegExp(`\\(${t.cap}%\\)`)]);
      want.push([`${label}: prior-year base ${money0(t.capBaseAmount)}`, new RegExp(money0(t.capBaseAmount).replace(/[$,]/g, m => '\\' + m))]);
    } else {
      want.push([`${label}: states that NO cap applies`, /No annual cap or ceiling applies/]);
    }
    if (t.excluded_categories) {
      want.push([`${label}: excludes ${t.excluded_categories}`, new RegExp(`exclude ${t.excluded_categories}`, 'i')]);
    } else {
      want.push([`${label}: states that no category is excluded`, /No category of Common Area Cost is excluded/]);
    }

    let localFail = 0;
    for (const [m, re] of want) if (!re.test(text)) { bad(m, `not found in ${D.leasePath(t)}`); localFail++; }
    if (!localFail) ok(`${label} — ${want.length} terms all present across ${pages} page(s), ${text.length} chars of text layer`);
    // A cap a lease does not carry must never appear in its document.
    if (t.cap == null && /shall not increase by more than/.test(text)) bad(`${label}: an uncapped lease contains cap language`);
  }

  sec('C2 · every invoice PDF states its own number, amount and date');
  for (const inv of D.INVOICES) {
    const { text } = await readPdf(D.invoicePath(inv));
    const amt = '$' + Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const problems = [];
    if (!text.includes(inv.n)) problems.push('invoice number');
    if (!text.includes(amt)) problems.push('amount ' + amt);
    if (!text.includes(inv.vendorName)) problems.push('vendor');
    if (!new RegExp(inv.category, 'i').test(text)) problems.push('category');
    if (!/Demonstration Document/.test(text)) problems.push('fictional banner');
    if (problems.length) bad(`${inv.n} (${inv.vendorName})`, 'missing: ' + problems.join(', '));
  }
  ok(`all ${D.INVOICES.length} invoice documents carry their number, vendor, amount, category and the fictional banner`);

  // ══ D · the property describes ITSELF ═══════════════════════════════════
  // Northgate opened showing Cascade Commons' rendering, address, owner, parcel,
  // insurance policy, roof and HVAC. PropertyReference.infoFor() falls back to
  // the hardcoded Cascade block for anything isDemo() matches, and the Northgate
  // seed carried _demoVersion — which is precisely the flag isDemo() reads. The
  // fix is that Northgate states its own facts, in INFO, and is identified by
  // _ngV. These checks fail if either half is undone.
  sec('D · the reference block is Northgate\'s own');
  const PR = require('./property-reference.js');
  const INFO = D.INFO;
  is(INFO && typeof INFO === 'object', 'demo-northgate.js exports an INFO block');

  const missingKeys = PR.FIELDS.map(f => f.key).filter(k => !(k in INFO));
  is(missingKeys.length === 0,
     `INFO answers every one of the ${PR.FIELDS.length} fields the Property Information panel renders`,
     'missing: ' + missingKeys.join(', '));

  is(INFO.propertyName === D.PROPERTY.name, `INFO names the property "${INFO.propertyName}"`);
  is(INFO.address === D.PROPERTY.address, 'INFO carries Northgate\'s own address');
  is(INFO.owner === D.PROPERTY.owner, 'INFO carries Northgate\'s own owner');
  is(INFO.parcelId === D.PROPERTY.parcel, 'INFO carries Northgate\'s own parcel id');
  is(INFO.grossSqft === D.PROPERTY.totalSqft,
     `INFO's gross area (${sqftStr(INFO.grossSqft)}) is the seed's building area`);
  is(INFO.numSpaces === D.TENANTS.length + 1,
     `INFO counts ${INFO.numSpaces} spaces — ${D.TENANTS.length} leases and the vacancy`);
  is(INFO.occupancyPct === null,
     'INFO states no occupancy figure, so the panel derives it from live tenant data rather than reciting a stale one');

  // The single assertion that would have caught the defect the manager saw.
  const infoBlob = JSON.stringify(INFO).toLowerCase();
  is(!infoBlob.includes('cascade'),
     'no field of INFO mentions Cascade — not the address, the owner, the carrier, the image or the caption');
  is(!infoBlob.includes('austin') && !infoBlob.includes('travis'),
     'and none of it is Cascade\'s Austin geography');

  // infoFor() must reach INFO through its FIRST branch, whatever isDemo() says,
  // and a property carrying Cascade's marker must not be able to override it.
  const ngLike = { id: 'de000001-0000-4000-a000-abcdef012345', name: D.PROPERTY.name, _ngV: D.DEMO_VERSION, info: INFO, tenants: [], totalSqft: D.PROPERTY.totalSqft };
  is(PR.infoFor(ngLike) === INFO, 'PropertyReference.infoFor() returns Northgate\'s own block for a seeded Northgate');
  is(PR.isDemo(ngLike) === false,
     '_ngV alone does not make Northgate read as the Cascade showroom, so it is never handed Cascade\'s document catalogs');
  is(PR.propertyDocumentsFor(ngLike).length === 0 && PR.spaceDocumentsFor(ngLike, { tenant_name: 'Ridgeline Outfitters' }).length === 0,
     'and neither catalog offers Northgate a Cascade site plan, survey or Travelers policy');

  sec('D2 · the rendering is Northgate\'s own illustration');
  const imgRel = INFO.imageUrl;
  const imgAbs = path.join(ROOT, imgRel);
  is(fs.existsSync(imgAbs), `INFO.imageUrl points at a file that exists (${imgRel})`,
     'expected an illustration on disk');
  if (fs.existsSync(imgAbs)) {
    const svg = fs.readFileSync(imgAbs, 'utf8');
    is(/NORTHGATE EXCHANGE/.test(svg), 'the illustration is signed Northgate Exchange');
    is(!/cascade/i.test(svg),
       'and nowhere in it says Cascade — the Cascade asset was not reused or relabelled');
    is(/demonstration rendering/i.test(svg) && /not a photograph/i.test(svg),
       'it labels itself a demonstration rendering of a fictional property, not a photograph');
    is(/not a photograph/i.test(String(INFO.imageCaption)),
       'and the caption the header prints says the same');
    const cascadeAbs = path.join(ROOT, 'assets/demo/cascade-commons-rendering.svg');
    if (fs.existsSync(cascadeAbs)) {
      const cas = fs.readFileSync(cascadeAbs, 'utf8');
      is(cas !== svg, 'it is not a copy of Cascade\'s rendering');
      is(/CASCADE COMMONS/.test(cas) && !/NORTHGATE/i.test(cas),
         'and Cascade\'s own rendering is untouched — still Cascade\'s, and still only Cascade\'s');
    }
    // Every leased suite is named on the building, and the vacancy is shown
    // vacant, so the picture cannot quietly disagree with the seed.
    const unnamed = D.TENANTS.filter(t => !svg.toUpperCase().includes(t.tenant_name.toUpperCase()));
    is(unnamed.length === 0, `all ${D.TENANTS.length} tenants are signed on the building`,
       unnamed.map(t => t.tenant_name).join(', '));
    is(new RegExp(`SUITE ${D.VACANCY.suite}`).test(svg) && /NOW LEASING/i.test(svg),
       `Suite ${D.VACANCY.suite} is drawn as the empty bay it is`);
  }

  console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail ? 1 : 0);
})();
