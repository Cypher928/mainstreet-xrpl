'use strict';
/**
 * Demo invoice document contract — Cascade Commons, 2025 register.
 *
 *   node test-demo-invoices.js
 *
 * WHY THIS EXISTS. The demo's CAM reconciliation used to be refused by the
 * product's own audit with "26 of 26 invoices missing source document". That
 * refusal was correct: the register was 26 rows of vendor, amount, category and
 * date with nothing behind any of them. The fix was to supply the documents.
 *
 * Supplying documents is only honest if each document really is the document
 * for the row it is attached to. The failure this prevents is not a crash — it
 * is a demo that shows a manager a $17,100 roof repair and opens a landscaping
 * bill, or worse, a register that *claims* documents that are not there and so
 * clears a billing gate on a promise. So this checks the correspondence from
 * the document end, against the seed:
 *
 *   A  the register and the documents are the same 26 things, in the same order
 *   B  every document states its own row's vendor, amount, date and category
 *   C  every document says on its face that it is fictional
 *   D  the seed's fileUrl/fileName resolve to files that exist
 *   E  no Northgate Exchange document is borrowed for Cascade
 *
 * Offline. Reads script.js as text and the PDFs through the same PDF.js the app
 * uses; no browser, no network.
 */
const fs = require('fs'), path = require('path');
const ROOT    = __dirname;
const SEED    = path.join(ROOT, 'script.js');
const INV_DIR = path.join(ROOT, 'assets', 'demo', 'invoices');
const BANNER  = 'Cascade Commons — Demonstration Document — Fictional';

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

const src = fs.readFileSync(SEED, 'utf8');

// ── The register, read from the seed exactly as the build tool reads it ──────
function readRegister() {
  const block = /const demoInvoiceList = \[([\s\S]*?)\n  \];/.exec(src);
  if (!block) return [];
  const rowRe = /\{\s*vendorName:\s*'([^']+)',\s*amount:\s*(\d+(?:\.\d+)?),\s*category:\s*'([^']+)',\s*invoiceDate:\s*'(\d{4}-\d{2}-\d{2})'\s*\}/g;
  const rows = []; let m;
  while ((m = rowRe.exec(block[1]))) rows.push({ vendorName: m[1], amount: Number(m[2]), category: m[3], invoiceDate: m[4] });
  return rows;
}

// The seed's own naming rules, mirrored. If script.js changes how a document is
// addressed, this test must change with it — which is the point: the two are
// supposed to be held together, not to drift quietly.
const pad4     = i => String(i + 1).padStart(4, '0');
const urlFor   = i => 'assets/demo/invoices/invoice-cc-2025-' + pad4(i) + '.pdf';
const fileFor  = (inv, i) => 'Invoice CC-2025-' + pad4(i) + ' — ' + inv.vendorName + '.pdf';
const money    = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const longDate = iso => { const [y, m, d] = iso.split('-').map(Number); return MONTHS[m - 1] + ' ' + d + ', ' + y; };
const flat     = s => String(s || '').replace(/\s+/g, ' ');

(async () => {
  console.log('\n── A · the register and the documents are the same 26 things ──');
  const register = readRegister();
  register.length === 26
    ? ok('the seed register parses to 26 invoices')
    : bad('register did not parse to 26 rows', String(register.length));
  if (!register.length) { console.log('\n\x1b[31mRESULT: cannot continue without the register\x1b[0m'); process.exit(1); }

  const onDisk = fs.existsSync(INV_DIR)
    ? fs.readdirSync(INV_DIR).filter(f => /^invoice-cc-2025-\d{4}\.pdf$/.test(f)).sort()
    : [];
  onDisk.length === register.length
    ? ok(`${onDisk.length} invoice PDFs on disk, one per row`)
    : bad('document count does not match the register', `${onDisk.length} files vs ${register.length} rows`);

  const missing = register.map((_, i) => urlFor(i)).filter(u => !fs.existsSync(path.join(ROOT, u)));
  missing.length === 0
    ? ok('every row’s document exists at the path the seed names')
    : bad('documents missing', missing.join(', '));

  const extra = onDisk.filter(f => !register.some((_, i) => path.basename(urlFor(i)) === f));
  extra.length === 0
    ? ok('no orphan documents in assets/demo/invoices')
    : bad('documents with no row', extra.join(', '));

  const total = register.reduce((s, r) => s + r.amount, 0);
  total === 188300
    ? ok('the register totals $188,300.00 — the demo’s stated CAM pool')
    : bad('register total moved', money(total));

  // ── B, C · what each document actually says ────────────────────────────────
  console.log('\n── B · every document states its own row ──');
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch (_) { bad('pdfjs-dist not installed', 'npm install'); console.log(''); process.exit(1); }

  const texts = [];
  let noTextLayer = 0, wrongVendor = [], wrongAmount = [], wrongDate = [], wrongCategory = [], noBanner = [], crossRef = [];
  for (let i = 0; i < register.length; i++) {
    const inv = register[i];
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(path.join(ROOT, urlFor(i)))),
      useSystemFonts: true, verbosity: 0,
    }).promise;
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items;
      text += items.map(it => it.str).join(' ') + ' ';
    }
    text = flat(text);
    texts.push(text);
    if (text.length < 200) noTextLayer++;
    if (!text.includes(inv.vendorName))              wrongVendor.push(i);
    if (!text.includes(money(inv.amount)))           wrongAmount.push(i);
    if (!text.includes(longDate(inv.invoiceDate)))   wrongDate.push(i);
    if (!text.includes(inv.category))                wrongCategory.push(i);
    if (!text.includes(BANNER))                      noBanner.push(i);
    // A document must not name a row it is not for. Vendor names repeat across
    // the register, so this checks the one field that is unique per document.
    for (let j = 0; j < register.length; j++) {
      if (j !== i && text.includes('CC-2025-' + pad4(j))) crossRef.push(i + '→' + j);
    }
  }

  noTextLayer === 0
    ? ok('all 26 documents carry a readable text layer')
    : bad('documents with no recoverable text', String(noTextLayer));
  wrongVendor.length === 0   ? ok('each document names its row’s vendor')   : bad('vendor mismatch at rows', wrongVendor.join(', '));
  wrongAmount.length === 0   ? ok('each document states its row’s amount')  : bad('amount mismatch at rows', wrongAmount.join(', '));
  wrongDate.length === 0     ? ok('each document carries its row’s date')   : bad('date mismatch at rows', wrongDate.join(', '));
  wrongCategory.length === 0 ? ok('each document names its row’s expense category') : bad('category mismatch at rows', wrongCategory.join(', '));
  crossRef.length === 0
    ? ok('no document references another row’s invoice number')
    : bad('cross-referenced documents', crossRef.join(', '));

  console.log('\n── C · nothing here pretends to be real ──');
  noBanner.length === 0
    ? ok('every document is headed "' + BANNER + '"')
    : bad('documents without the fictional banner', noBanner.join(', '));
  const noDisclaimer = texts.filter(t => !/It is not a bill, a contract or a public record/.test(t)).length;
  noDisclaimer === 0
    ? ok('every document carries the closing disclaimer')
    : bad('documents without the disclaimer', String(noDisclaimer));
  const notFictionalVendor = texts.filter(t => !/\(fictional[^)]*\)/.test(t)).length;
  notFictionalVendor === 0
    ? ok('every document marks its vendor as fictional')
    : bad('documents whose vendor is not marked fictional', String(notFictionalVendor));

  // ── D · the seed attaches them, and by the index, not by name ──────────────
  console.log('\n── D · the seed attaches the documents ──');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  /_demoInvoiceUrl\s*\(\s*i\s*\)/.test(code)
    ? ok('the seed derives each fileUrl from the row index')
    : bad('the seed no longer derives fileUrl from the index', 'a document could sit against the wrong row');
  /fileUrl:\s*inv\.fileUrl/.test(code) && /invoicesFull:\s*demoInvoiceRegister/.test(code)
    ? ok('the register the audit reads carries the same documents as the one the screen renders')
    : bad('invoicesFull and invoices disagree', 'buildAuditSummary reads lastInvoicesFull');
  const ver = /const DEMO_VERSION = (\d+);/.exec(code);
  ver && Number(ver[1]) >= 9
    ? ok('DEMO_VERSION is ' + ver[1] + ' — existing seeded copies re-seed and pick the documents up')
    : bad('DEMO_VERSION was not bumped', ver ? ver[1] : 'not found');
  !/_demoV:\s*\d/.test(code) && !/_demoV\s*===\s*\d/.test(code)
    ? ok('no hard-coded version literal survives beside the constant')
    : bad('a literal version number is still in the seed', 'bumping it would miss a place');

  // The document naming the seed produces must be the naming on disk.
  const nameMismatch = register.map((inv, i) => fileFor(inv, i))
    .filter((n, i) => !new RegExp('Invoice CC-2025-' + pad4(i)).test(n));
  nameMismatch.length === 0
    ? ok('the fileName shown in the register carries the document’s own number')
    : bad('fileName does not match the document', nameMismatch.join(', '));

  console.log('\n── E · nothing borrowed from the other demo property ──');
  const borrowed = register.map((_, i) => urlFor(i)).filter(u => /northgate/i.test(u));
  borrowed.length === 0
    ? ok('no Cascade row points at a Northgate document')
    : bad('Northgate documents reused', borrowed.join(', '));
  const namesNorthgate = texts.filter(t => /northgate/i.test(t)).length;
  namesNorthgate === 0
    ? ok('no Cascade document mentions Northgate Exchange')
    : bad('documents naming the other property', String(namesNorthgate));
  const wrongAddress = texts.filter(t => !/4820 Cascade Parkway/.test(t)).length;
  wrongAddress === 0
    ? ok('every document is addressed to Cascade Commons')
    : bad('documents not addressed to this property', String(wrongAddress));

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail ? 1 : 0);
})();
