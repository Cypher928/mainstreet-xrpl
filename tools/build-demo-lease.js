'use strict';
/**
 * Render the Whole Health Market demo lease to a real PDF.
 *
 * The Evidence Viewer's tier 3 locates a cited quote inside the PDF's own text
 * layer (evidence-viewer.js, locateQuoteInItems). A raster or image-only PDF
 * would have no text layer, the highlight would silently fail, and the citation
 * would degrade to "couldn't identify the paragraph". So this must produce a
 * text-layer PDF — Chromium's print pipeline does.
 *
 *   node tools/build-demo-lease.js
 */
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'assets', 'demo', 'lease-whole-health-market.html');
const OUT  = path.join(ROOT, 'assets', 'demo', 'lease-whole-health-market.pdf');

// NOTE ON VERIFICATION
// An earlier version of this script tried to confirm the text layer by
// inflating the content streams and reading the Tj operands directly. That does
// not work: Chromium embeds subset CIDFontType2 fonts, so those operands are
// glyph indices, not characters — the check reported every clause missing on a
// PDF that was perfectly fine. Real verification needs the ToUnicode CMaps,
// which is exactly what PDF.js does, so it lives in test-demo-lease.js against
// the same library the app uses.

(async () => {
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file://' + SRC, { waitUntil: 'load' });
  await page.pdf({ path: OUT, format: 'Letter', printBackground: true });
  await browser.close();

  const buf = fs.readFileSync(OUT);
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const hasToUnicode = /ToUnicode/.test(buf.toString('latin1'));

  console.log(`wrote ${path.relative(ROOT, OUT)} — ${Math.round(buf.length / 1024)} KB, ${pages} pages`);
  console.log(`ToUnicode CMaps present: ${hasToUnicode ? 'yes' : 'NO — text would not be extractable'}`);
  console.log('run `node test-demo-lease.js` to verify the clause is citable.');
  process.exit(hasToUnicode ? 0 : 1);

})();
