'use strict';
/**
 * Demo lease document contract.
 *
 * The Whole Health Market demo lease exists so the Evidence Viewer has a real
 * document to cite. That only works if three things hold:
 *
 *   1. the PDF carries a text layer PDF.js can read;
 *   2. every term the demo tenant config asserts is actually IN the document;
 *   3. the cap clause can be located by the SAME matching logic the viewer's
 *      tier 3 uses, so a citation will highlight rather than silently degrade.
 *
 * (3) is the important one. If the clause is not locatable, the viewer falls
 * back to "the exact paragraph couldn't be automatically identified" — which is
 * the honest failure, but it means the film's key frame does not exist.
 *
 * This test asserts the DOCUMENT is citable. It does not assert that evidence
 * has been extracted — that happens through the ingestion pipeline at runtime
 * and is deliberately not seeded. See docs/DEMO_LEASE.md.
 */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const PDF = path.join(ROOT, 'assets', 'demo', 'lease-whole-health-market.pdf');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

// ── the viewer's own matching logic, mirrored exactly ─────────────────────────
// Kept in step with evidence-viewer.js:40 (_normalizeForMatch) and :54
// (locateQuoteInItems). If those change, this test must change with them.
const normalize = s => String(s || '')
  .toLowerCase()
  .replace(/[‘’“”'"`]/g, '')
  .replace(/[-‐-―]/g, ' ')
  .replace(/[^a-z0-9\s%$.,]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function locateQuoteInItems(items, quote) {
  const safe = (items || []).map(it => normalize(it && it.str));
  if (!safe.length) return null;
  let hay = ''; const owner = [];
  safe.forEach((s, i) => {
    if (!s) return;
    if (hay) { hay += ' '; owner.push(-1); }
    for (let k = 0; k < s.length; k++) owner.push(i);
    hay += s;
  });
  let needle = normalize(quote);
  if (needle.length < 8) return null;
  let at = hay.indexOf(needle), exact = true;
  if (at === -1 && needle.length > 40) { needle = needle.slice(0, 40); at = hay.indexOf(needle); exact = false; }
  if (at === -1) return null;
  const itemIndexes = [];
  for (let k = at; k < at + needle.length; k++) {
    const idx = owner[k];
    if (idx >= 0 && itemIndexes[itemIndexes.length - 1] !== idx) itemIndexes.push(idx);
  }
  return itemIndexes.length ? { itemIndexes, exact } : null;
}

// Terms the demo tenant config asserts (script.js, demoTenantConfigs).
const TERMS = [
  ['cap percentage 5%',    /not increase by more than five percent \(5%\)/i],
  ['cap base $33,000',     /Thirty-Three Thousand and 00\/100 Dollars \(\$33,000\.00\)/i],
  ['leased sqft 9,200',    /9,200 rentable square feet/i],
  ['building 26,000 sqft', /26,000 rentable square feet/i],
  ['pro-rata 35.38%',      /35\.38%/],
  ['start 2021-01-01',     /January 1, 2021/i],
  ['end 2028-12-31',       /December 31, 2028/i],
  ['lease type NNN',       /Triple Net \(NNN\)/i],
  ['audit rights 90 days', /ninety \(90\) days after Tenant.s receipt/i],
  ['no exclusions',        /no category of Common Area\s+Maintenance Costs is excluded/i],
];

// The clause an extractor should return as the cap quote.
const CAP_QUOTE = "Tenant's Proportionate Share of Common Area Maintenance Costs payable in "
                + "respect of any calendar year shall not increase by more than five percent (5%)";

(async () => {
  if (!fs.existsSync(PDF)) {
    bad('lease PDF missing', 'run node tools/build-demo-lease.js');
    console.log(`\n\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); process.exit(1);
  }

  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch (e) { bad('pdfjs-dist not installed', 'npm install'); console.log(''); process.exit(1); }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(PDF)), useSystemFonts: true,
  }).promise;

  console.log('\n── The document is readable ──');
  ok(`PDF opens with PDF.js — ${doc.numPages} pages, ${Math.round(fs.statSync(PDF).size / 1024)} KB`);

  const pageItems = [], pageText = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    pageItems.push(tc.items);
    pageText.push(tc.items.map(i => i.str).join(' '));
  }
  const all = pageText.join('\n').replace(/\s+/g, ' ');
  all.length > 2000
    ? ok(`text layer present — ${all.length} characters across ${doc.numPages} pages`)
    : bad('text layer too thin', `${all.length} chars`);

  console.log('\n── Every asserted term is in the lease ──');
  for (const [label, re] of TERMS) {
    re.test(all) ? ok(label) : bad(`${label} not found in the document`);
  }

  console.log('\n── The cap clause is citable (viewer tier 3) ──');
  let found = null;
  for (let p = 0; p < pageItems.length; p++) {
    const hit = locateQuoteInItems(pageItems[p], CAP_QUOTE);
    if (hit) { found = { page: p + 1, hit }; break; }
  }
  if (found) {
    ok(`cap clause located on page ${found.page} by the viewer's own matcher`);
    found.hit.exact
      ? ok(`match is exact — the highlight will cover the full clause (${found.hit.itemIndexes.length} text runs)`)
      : ok(`match is partial — viewer highlights the clause start and says so (${found.hit.itemIndexes.length} runs)`);
  } else {
    bad('cap clause NOT locatable', 'a citation would degrade to "paragraph could not be identified"');
  }

  console.log('\n── Evidence is not pre-seeded ──');
  const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const seed = script.slice(script.indexOf('const demoTenantConfigs'), script.indexOf('const demoInvoiceList'))
    // Strip comments first: prose explaining why evidence is NOT seeded would
    // otherwise trip the very check it is explaining.
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  !/\bfieldEvidence\s*:/.test(seed)
    ? ok('demo tenant config seeds no fieldEvidence — citations must come from extraction')
    : bad('demo config contains fieldEvidence', 'evidence must not be hard-coded');
  /lease-whole-health-market\.pdf/.test(seed)
    ? ok('demo tenant points at the real lease document')
    : bad('demo tenant has no leaseUrl', 'the viewer cannot open a document that is not attached');

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail ? 1 : 0);
})();
