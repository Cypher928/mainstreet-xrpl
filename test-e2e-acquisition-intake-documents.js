// test-e2e-acquisition-intake-documents.js
// ============================================================================
// Acquisition Intake — the Documents step (I-2): sixty files held, read and
// classified in the tab, nothing filed.
//
// Sixty files are dropped at once — leases, amendments, rent rolls, statements
// as PDFs with a text layer, invoice images, two scanned PDFs, a low-confidence
// reading, an unknown, a duplicate, an over-cap text, a file with nothing to
// read — plus three that are refused at the drop. One reader reads them one at
// a time; every image and every scan waits for a person instead of being
// transcribed; a 429 from the classifier pauses the queue and re-queues the
// file; a file left out while it is being read stays left out; a person's type
// wins and keeps the AI's answer beside it; Clear all empties the tab. The
// memory and text footprint of sixty held files is MEASURED and reported.
// Nothing is written anywhere: no document row, no upload, no transcription.
//
// The Supabase stand-in is test-e2e-acquisition-intake.js's; pdf.js 3.11.174 is
// served from node_modules/pdfjs-v3 so PDFs are read as the app reads them.
//
// Run: node test-e2e-acquisition-intake-documents.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8932;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

// ── pdf.js, as the app loads it ──────────────────────────────────────────────
let PDFJS = null;
for (const p of ['node_modules/pdfjs-v3/build/pdf.min.js', 'node_modules/pdfjs-v3/build/pdf.js']) {
  if (fs.existsSync(path.join(ROOT, p))) { PDFJS = path.join(ROOT, p); break; }
}
const PDF_WORKER = PDFJS && path.join(path.dirname(PDFJS), 'pdf.worker.min.js');

// ── fixtures ─────────────────────────────────────────────────────────────────
// A one-page PDF with a text layer (Helvetica, Tj operators) — or a blank page,
// which is what a scan looks like to a text reader: pages and no letters.
function makePdf(lines, opts) {
  const blank = !!(opts && opts.blank);
  const e = s => s.replace(/[\\()]/g, m => '\\' + m);
  const content = blank ? '' : 'BT /F1 11 Tf 14 TL 50 740 Td ' + lines.map(l => `(${e(l)}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
       + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// A real (tiny) PNG, so the browser reports image/png and the file is not empty.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const PAD = ' The parties agree to the covenants, conditions and provisions set out in the schedules attached hereto.';
const lease = (p, t) => `LEASE AGREEMENT\nThis Lease is made between ${p} Owner LLC (Landlord) and Tenant: ${t}\nPremises: Suite 110, ${p}\nDated: 2023-03-01\nTerm: sixty (60) months.${PAD}`;
const amendment = (t) => `FIRST AMENDMENT TO LEASE\nBetween Landlord and Tenant: ${t}\nDated: 2024-05-01\nBase Rent is amended to $2,600 per month.${PAD}`;
const rentroll = (p) => `RENT ROLL AS OF 2024-06-30\n${p.toUpperCase()}\nSuite 110 Tenant One LLC $2,400\nSuite 120 Tenant Two Inc $4,100\nSuite 130 Tenant Three PC $3,000${PAD}`;
const statementLines = (p) => ['OPERATING STATEMENT - ' + p, 'For the year ended 2023-12-31', 'Rental income by tenant: Tenant One 28,800; Tenant Two 49,200; Tenant Three 36,000.', 'Total 114,000. The parties agree to the covenants, conditions and provisions set out in the schedules attached hereto.'];

const PROPS = ['Maple Plaza', 'Cedar Court', 'Harbor Point', 'Oak Ridge', 'Pine Crossing', 'Birch Commons', 'Elm Street Plaza', 'Willow Park', 'Aspen Row', 'Juniper Square'];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const F = (name, buf, mime) => ({ name, mimeType: mime || MIME[path.extname(name)] || 'application/octet-stream', buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8') });

const FILES = [];
PROPS.forEach((p, i) => {
  const s = slug(p);
  FILES.push(F(`${s}-lease.txt`, lease(p, `Tenant ${i} LLC`)));
  FILES.push(F(`${s}-amendment.txt`, amendment(`Tenant ${i} LLC`)));
  FILES.push(F(`${s}-rentroll.txt`, rentroll(p)));
  FILES.push(F(`${s}-invoice.png`, PNG));                                  // an image: never read, never classified
  FILES.push(F(`${s}-statement.pdf`, makePdf(statementLines(p))));          // a PDF with a text layer: read by pdf.js
});
FILES.push(F('scan-a.pdf', makePdf([], { blank: true })));                 // a scan: pages, no letters
FILES.push(F('scan-b.pdf', makePdf([], { blank: true })));
FILES.push(F('lowconf.txt', 'LOWCONF MEMO\nSomething about the parking lot and the holiday kiosk, undated.' + PAD));
FILES.push(F('lowish.txt', 'LOWISH NOTICE\nTo tenants: the lot will be resurfaced on Monday.' + PAD));
FILES.push(F('mystery.txt', 'UNKNOWN DOCUMENT\nNothing here says what this is.' + PAD));
FILES.push(F('maple-plaza-lease.txt', lease('Maple Plaza', 'Tenant 0 LLC')));   // the same name and size as the first file: a duplicate
FILES.push(F('big.txt', 'LEASE AGREEMENT\nTenant: Big Tenant LLC\n' + 'The parties agree to a great many things. '.repeat(5000)));
FILES.push(F('noise.txt', '0x00 0x00 .. .. 12 34 56 ..'));                    // nothing to read
FILES.push(F('side-letter.txt', 'SIDE LETTER\nBetween Landlord and Tenant: Tenant 3 LLC regarding signage.' + PAD));
FILES.push(F('psa.txt', 'PURCHASE AND SALE AGREEMENT\nThe Properties: Pine Crossing; Birch Commons.' + PAD));
if (FILES.length !== 60) throw new Error('fixture count ' + FILES.length);
const REFUSED = [F('rent.xlsx', 'not a document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
                 F('empty.txt', ''),                                           // empty
                 F('lease.pdf', PNG, 'image/png')];                            // says png, named pdf
// Expected: classified 44 (30 txt + 10 pdf + lowish + big + side + psa), needs a type 15 (10 images + 2 scans + lowconf + mystery + noise), left out 1.
// Classifier calls: every read text with letters, not left out: 30 + 10 + lowconf + lowish + mystery + big + side + psa = 46.

// The classifier, answering from the TEXT it is given.
function classify(text) {
  const r = (docType, confidence, evidence) => ({ docType, docDate: null, tenantName: (text.match(/Tenant: ([^\n]+)/) || [])[1] || null, suite: null, confidence, evidence });
  if (/LOWCONF/.test(text))                     return r('other', 0.3, 'MEMO');
  if (/LOWISH/.test(text))                      return r('other', 0.6, 'NOTICE');
  if (/UNKNOWN DOCUMENT/.test(text))            return r('unknown', 0.2, null);
  if (/FIRST AMENDMENT TO LEASE/.test(text))    return r('amendment', 0.88, 'FIRST AMENDMENT TO LEASE');
  if (/RENT ROLL/.test(text))                   return r('rent_roll', 0.94, 'RENT ROLL');
  if (/OPERATING STATEMENT/.test(text))         return r('financial_statement', 0.9, 'OPERATING STATEMENT');
  if (/PURCHASE AND SALE AGREEMENT/.test(text)) return r('psa', 0.93, 'PURCHASE AND SALE AGREEMENT');
  if (/SIDE LETTER/.test(text))                 return r('side_letter', 0.9, 'SIDE LETTER');
  if (/LEASE AGREEMENT/.test(text))             return r('original_lease', 0.95, 'LEASE AGREEMENT');
  return r('other', 0.8, null);
}

const DB = fs.readFileSync(path.join(ROOT, 'test-e2e-acquisition-intake.js'), 'utf8').match(/const DB = `([\s\S]*?)`;\n/)[1];

(async () => {
  if (!PDFJS) { console.error('pdfjs-v3 is not installed (npm ci) — the PDF checks cannot run and this suite FAILS rather than skips.'); process.exit(2); }
  const net = { classify: [], upload: 0, explain: 0, other: [] };
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) {
      if (u === '/api/upload') net.upload++; else if (u === '/api/explain') net.explain++; else if (u !== '/api/claude') net.other.push(u);
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return;
    }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];
  const control = { failOnce: null, slowFor: null };   // 429 once for a file; a slow answer for a file

  async function boot(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**', r => {
      const u = r.request().url();
      if (/pdf\.worker(\.min)?\.js/.test(u) && fs.existsSync(PDF_WORKER)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(PDF_WORKER, 'utf8') });
      if (/pdf(\.min)?\.js/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(PDFJS, 'utf8') });
      return r.fulfill({ status: 200, body: '/*x*/' });
    });
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/claude', async route => {
      const post = route.request().postData() || '';
      let body = {}; try { body = JSON.parse(post); } catch (_) {}
      const content = body.messages && body.messages[0] ? String(body.messages[0].content) : '';
      const fileName = (content.match(/File name \(context only, do not classify from it\): ([^\n]+)/) || [])[1] || '';
      const text = content.slice(content.indexOf('Document text:\n') + 15);
      net.classify.push({ fileName, task: body.task, len: text.length });
      if (control.failOnce === fileName) { control.failOnce = null; return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '1' }, body: JSON.stringify({ error: 'Too many requests — please slow down. Try again in 1 second.', retryAfter: 1 }) }); }
      if (control.slowFor === fileName) { control.slowFor = null; await new Promise(r => setTimeout(r, 1500)); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(classify(text)) });
    });
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    return { ctx, page };
  }
  const idle = (page, timeout) => page.waitForFunction(() => !_acqIntakeReader.running && !_acqIntakeReader.paused
    && !_acqIntakeHeld.some(i => i.state === 'queued' || i.state === 'reading'), null, { timeout: timeout || 120000 }).catch(() => null);
  const counts = (page) => page.evaluate(() => { const c = {}; _acqIntakeHeld.forEach(i => { c[i.state] = (c[i.state] || 0) + 1; }); return c; });
  const rowOf = (page, name) => page.evaluate((n) => { const it = _acqIntakeHeld.find(i => i.name === n); if (!it) return null;
    const el = document.querySelector(`.acq-intake-doc[data-item="${it.itemId}"]`);
    return { id: it.itemId, state: it.state, reason: it.reason, type: it.type, aiType: it.aiType, lane: it.lane, warnings: it.warnings, truncated: it.truncated, textLen: (it.text || '').length,
             text: el ? el.innerText.replace(/\s+/g, ' ') : '', hasPicker: !!(el && el.querySelector('select[data-type]')), hasRetry: !!(el && el.querySelector('.acq-intake-doc-retry')),
             badge: el && el.querySelector('.acq-intake-badge') ? el.querySelector('.acq-intake-badge').innerText : null }; }, name);
  const vis = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; }, sel);

  console.log('\nAcquisition Intake I-2 — sixty documents held, read and classified; nothing filed\n' + '='.repeat(64));
  const { ctx, page } = await boot({ width: 1280, height: 1000 });
  await page.click('.acq-intake-start');
  await page.waitForTimeout(300);
  check('the Documents step is on the Intake, with a drop zone and a file control that accepts the union of both lanes',
        await vis(page, '#acqIntakeDocuments') && await vis(page, '#acqIntakeDropZone') && (await page.$eval('#acqIntakeFileInput', el => el.getAttribute('accept'))) === '.pdf,.txt,.jpg,.jpeg,.png,.webp');
  check('pdf.js is loaded as the app loads it', await page.evaluate(() => !!window.pdfjsLib));

  // ── 1 · sixty files, three refusals ──────────────────────────────────────
  const t0 = Date.now();
  await page.setInputFiles('#acqIntakeFileInput', FILES.concat(REFUSED));
  await page.waitForTimeout(300);
  const early = await counts(page);
  check('1. sixty files are held at once, three are refused at the drop, and the reader starts on the first', (await page.evaluate(() => _acqIntakeHeld.length)) === 60
        && (await page.evaluate(() => _acqIntakeRefused.length)) === 3 && (early.reading || 0) <= 1, JSON.stringify(early));
  const refused = await page.evaluate(() => _acqIntakeRefused.map(r => r.name + ': ' + r.reason));
  check('   the refusals are named with their reasons: a spreadsheet, an empty file, a PDF that says it is an image',
        refused.some(r => /rent\.xlsx: \.xlsx is not a document Intake reads/.test(r)) && refused.some(r => /empty\.txt: The file is empty/.test(r)) && refused.some(r => /lease\.pdf: The file says it is image\/png, not a \.pdf/.test(r)), refused.join(' | '));
  check('   while files are held, closing the tab asks first', await page.evaluate(() => _acqIntakeUnloadArmed === true));
  await idle(page, 180000);
  const elapsed = Date.now() - t0;
  const c1 = await counts(page);
  check('   all sixty settle: 44 classified, 15 need a type, 1 left out', c1.classified === 44 && c1.needs_type === 15 && c1.left_out === 1 && !c1.queued && !c1.reading, JSON.stringify(c1) + ` in ${Math.round(elapsed / 1000)}s`);
  check('   exactly 46 classification calls — one per readable text, none for an image, a scan, a left-out duplicate or a file with nothing to read', net.classify.length === 46, String(net.classify.length));
  check('   every classification call was the server-owned task, given the text and never only the name', net.classify.every(c => c.task === 'document_classification' && c.len > 40));
  check('   no classification call was made for an image or a scan', !net.classify.some(c => /\.png$|^scan-/.test(c.fileName)), net.classify.filter(c => /\.png$|^scan-/.test(c.fileName)).map(c => c.fileName).join(','));
  const footprint = await page.evaluate(() => ({ textChars: _acqIntakeHeld.reduce((n, i) => n + (i.text || '').length, 0), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, cap: AcquisitionIntake.TEXT_CAP }));
  check('   the footprint is measured: held text within the cap for sixty files', footprint.textChars <= 60 * footprint.cap, `held text ${footprint.textChars.toLocaleString()} chars; JS heap ${footprint.heapMB === null ? 'n/a' : footprint.heapMB + ' MB'}; cap ${footprint.cap} chars/file`);
  check('   the summary line counts them', /60 files held · 44 classified · 15 need a type · 1 left out/.test(await page.$eval('#acqIntakeDocSummary', el => el.textContent)), await page.$eval('#acqIntakeDocSummary', el => el.textContent));

  // ── 2 · what each kind became ────────────────────────────────────────────
  const lease0 = await rowOf(page, 'maple-plaza-lease.txt');
  check('2. a text lease is classified by AI with its confidence and lane', lease0.state === 'classified' && lease0.type.value === 'original_lease' && lease0.type.source === 'ai' && lease0.lane === 'lease'
        && /Original Lease/.test(lease0.text) && /proposed by AI at 95%/.test(lease0.text) && /Lease lane/.test(lease0.text) && /Tenant: Tenant 0 LLC/.test(lease0.text), lease0.text.slice(0, 200));
  const stmt = await rowOf(page, 'maple-plaza-statement.pdf');
  check('   a PDF with a text layer is read through pdf.js and classified; the documents lane', stmt.state === 'classified' && stmt.type.value === 'financial_statement' && stmt.lane === 'other' && stmt.textLen > 100 && /Documents lane/.test(stmt.text), JSON.stringify({ state: stmt.state, type: stmt.type, len: stmt.textLen }));
  const img = await rowOf(page, 'maple-plaza-invoice.png');
  check('   an image is never read or classified: it needs a type, says so, and offers the picker', img.state === 'needs_type' && img.reason === 'image' && img.hasPicker && /An image is not read here/.test(img.text) && img.type.value === null, img.text.slice(0, 200));
  const scan = await rowOf(page, 'scan-a.pdf');
  check('   a scanned PDF needs a type and is never transcribed; the row says a lease named here is read when filed', scan.state === 'needs_type' && scan.reason === 'scanned' && /no text layer/.test(scan.text) && /read when it is filed/.test(scan.text), scan.text.slice(0, 220));
  const low = await rowOf(page, 'lowconf.txt');
  check('   below the floor the AI answer is a hint and the file needs a type', low.state === 'needs_type' && low.reason === 'low_confidence' && low.aiType && low.aiType.value === 'other' && /AI was not sure — it read "Other" at 30%/.test(low.text), low.text.slice(0, 200));
  const lowish = await rowOf(page, 'lowish.txt');
  check('   below the confidence line the type stands, badged Low confidence', lowish.state === 'classified' && lowish.type.value === 'other' && /low confidence/i.test(lowish.badge || ''), JSON.stringify({ badge: lowish.badge, type: lowish.type }));
  const myst = await rowOf(page, 'mystery.txt');
  check('   "unknown" from the AI needs a person', myst.state === 'needs_type' && myst.reason === 'unknown' && /could not tell/.test(myst.text), myst.text.slice(0, 160));
  const dup = await rowOf(page, 'maple-plaza-lease.txt');
  const dups = await page.evaluate(() => _acqIntakeHeld.filter(i => i.name === 'maple-plaza-lease.txt').map(i => ({ state: i.state, warnings: i.warnings })));
  check('   the duplicate (same name, same size) is held but left out, with the warning', dups.length === 2 && dups.filter(d => d.state === 'left_out').length === 1 && dups.some(d => d.warnings.some(w => /already held/.test(w))), JSON.stringify(dups));
  const big = await rowOf(page, 'big.txt');
  check('   over-cap text is capped, said on the item, and still classified', big.truncated === true && big.textLen === footprint.cap && big.state === 'classified', JSON.stringify({ truncated: big.truncated, len: big.textLen, state: big.state }));
  const noise = await rowOf(page, 'noise.txt');
  check('   a file with nothing to read needs a type without a classifier call', noise.state === 'needs_type' && noise.reason === 'no_text' && !net.classify.some(c => c.fileName === 'noise.txt'));
  check('   Read again is offered on an AI type and on a question, never on a type a person set', lease0.hasRetry && img.hasRetry);
  void dup;

  // ── 3 · a person says what it is ─────────────────────────────────────────
  await page.selectOption(`.acq-intake-doc[data-item="${img.id}"] select[data-type]`, 'invoice');
  await page.waitForTimeout(150);
  const img2 = await rowOf(page, 'maple-plaza-invoice.png');
  check('3. a person types an image: classified, set by you, the documents lane, no Read again', img2.state === 'classified' && img2.type.value === 'invoice' && img2.type.source === 'human' && img2.lane === 'other' && /set by you/.test(img2.text) && !img2.hasRetry, img2.text.slice(0, 160));
  await page.selectOption(`.acq-intake-doc[data-item="${scan.id}"] select[data-type]`, 'original_lease');
  await page.waitForTimeout(150);
  const scan2 = await rowOf(page, 'scan-a.pdf');
  check('   a person names a scan a lease: the lease lane — to be read when filed, not here', scan2.state === 'classified' && scan2.lane === 'lease' && scan2.type.source === 'human' && net.classify.length === 46, JSON.stringify({ lane: scan2.lane, calls: net.classify.length }));
  await page.click(`.acq-intake-doc[data-item="${lowish.id}"] .acq-intake-doc-change`);
  await page.waitForTimeout(100);
  await page.selectOption(`.acq-intake-doc[data-item="${lowish.id}"] select[data-type]`, 'side_letter');
  await page.waitForTimeout(150);
  const lowish2 = await rowOf(page, 'lowish.txt');
  check('   Change type on a proposal: the person\'s type wins and the AI\'s answer stays beside it', lowish2.type.value === 'side_letter' && lowish2.type.source === 'human' && lowish2.aiType.value === 'other' && /set by you \(AI read "Other"\)/.test(lowish2.text) && lowish2.badge === null, lowish2.text.slice(0, 160));
  const pre = await page.evaluate(() => __rpcCalls.length);
  await page.evaluate((id) => acqIntakeRetry(id), lowish2.id);
  await page.waitForTimeout(200);
  check('   Read again on a human type is refused by the module and changes nothing', (await rowOf(page, 'lowish.txt')).type.source === 'human' && net.classify.length === 46 && (await page.evaluate(() => __rpcCalls.length)) === pre);

  // ── 4 · a 429 pauses the queue and re-queues the file; nothing fails ─────
  control.failOnce = 'retry-me.txt';
  await page.setInputFiles('#acqIntakeFileInput', [F('retry-me.txt', lease('Retry Plaza', 'Retry Tenant LLC'))]);
  await page.waitForFunction(() => _acqIntakeReader.paused === true, null, { timeout: 10000 }).catch(() => null);
  const paused = await page.evaluate(() => ({ paused: _acqIntakeReader.paused, status: document.getElementById('acqIntakeReadStatus').textContent, it: _acqIntakeHeld.find(i => i.name === 'retry-me.txt').state }));
  check('4. a 429 pauses the reader for the interval the server named and puts the file back in the queue', paused.paused === true && /Paused — the classifier asked for a wait/.test(paused.status) && paused.it === 'queued', JSON.stringify(paused));
  await idle(page, 20000);
  const retried = await rowOf(page, 'retry-me.txt');
  check('   after the wait the file is read again and classified; the 429 cost one extra call and no failure', retried.state === 'classified' && retried.type.value === 'original_lease' && net.classify.filter(c => c.fileName === 'retry-me.txt').length === 2 && !(await page.evaluate(() => _acqIntakeHeld.some(i => i.state === 'read_failed'))), JSON.stringify({ state: retried.state, calls: net.classify.filter(c => c.fileName === 'retry-me.txt').length }));

  // ── 5 · left out while reading stays left out ────────────────────────────
  control.slowFor = 'slow.txt';
  await page.setInputFiles('#acqIntakeFileInput', [F('slow.txt', lease('Slow Plaza', 'Slow Tenant LLC'))]);
  await page.waitForFunction(() => { const i = _acqIntakeHeld.find(x => x.name === 'slow.txt'); return i && i.state === 'reading'; }, null, { timeout: 10000 }).catch(() => null);
  await page.evaluate(() => acqIntakeLeaveOut(_acqIntakeHeld.find(x => x.name === 'slow.txt').itemId));
  await page.waitForTimeout(2200);
  const slow = await rowOf(page, 'slow.txt');
  check('5. a file left out while it is being read stays left out when the read lands — no type, no lane', slow.state === 'left_out' && slow.type.value === null && slow.lane === null, JSON.stringify({ state: slow.state, type: slow.type }));
  await page.evaluate(() => acqIntakeInclude(_acqIntakeHeld.find(x => x.name === 'slow.txt').itemId));
  await idle(page, 20000);
  check('   Include brings it back through the reader', (await rowOf(page, 'slow.txt')).state === 'classified');

  // ── 6 · remove, clear, and the tab ────────────────────────────────────────
  const before = await page.evaluate(() => _acqIntakeHeld.length);
  await page.click(`.acq-intake-doc[data-item="${noise.id}"] .acq-intake-doc-remove`);
  await page.waitForTimeout(100);
  check('6. Remove takes one file out of the tab', (await page.evaluate(() => _acqIntakeHeld.length)) === before - 1 && !(await page.evaluate(() => _acqIntakeHeld.some(i => i.name === 'noise.txt'))));
  check('   nothing was written: no document, family, review, property or storage write, no upload, no transcription, no RPC',
        (await page.evaluate(() => __writes.length)) === 0 && (await page.evaluate(() => __rpcCalls.length)) === 0 && net.upload === 0 && net.explain === 0 && net.other.length === 0,
        `writes=${await page.evaluate(() => __writes.length)} rpcs=${await page.evaluate(() => __rpcCalls.length)} upload=${net.upload} explain=${net.explain} other=${net.other.join(',')}`);
  check('   no document rows exist', (await page.evaluate(() => __store.acquisition_documents.length)) === 0);
  await page.click('#acqIntakeClearBtn');
  await page.waitForTimeout(150);
  check('   Clear all empties the tab and the refusals, and closing the tab no longer asks', (await page.evaluate(() => _acqIntakeHeld.length + _acqIntakeRefused.length)) === 0 && await page.evaluate(() => _acqIntakeUnloadArmed === false) && (await page.$eval('#acqIntakeDocSummary', el => el.textContent)) === '');

  // ── 7 · a phone ──────────────────────────────────────────────────────────
  const m = await boot({ width: 390, height: 844 });
  await m.page.click('.acq-intake-start');
  await m.page.waitForTimeout(300);
  await m.page.setInputFiles('#acqIntakeFileInput', [F('one-lease.txt', lease('One Plaza', 'One Tenant LLC')), F('one-invoice.png', PNG)]);
  await idle(m.page, 30000);
  const geo = await m.page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#acqIntakeHeld .acq-intake-doc'));
    const r = rows[1], main = r.querySelector('.acq-intake-doc-main'), acts = r.querySelector('.acq-intake-doc-actions');
    const btn = acts.querySelector('.acq-btn');
    return { rows: rows.length, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
             stacked: acts.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 1, btnH: btn.getBoundingClientRect().height };
  });
  check('7. phone: no horizontal scroll, the row stacks its controls under its text, the controls are 44px', geo.rows === 2 && geo.scrollW <= geo.innerW + 1 && geo.stacked && geo.btnH >= 44, JSON.stringify(geo));
  await m.ctx.close();

  check('no uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();
  const failed = results.filter(x => !x.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
