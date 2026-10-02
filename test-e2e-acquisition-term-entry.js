// test-e2e-acquisition-term-entry.js
// ============================================================================
// Manual lease-term entry and its safeguards (Step C), walked in the page with
// Maple Plaza as the Pilot holds it (fixtures/maple-plaza-acquisition.js).
//
//   1  the inline editor: Enter / Correct open it in the term's row; a value
//      the type cannot hold is refused before anything is saved — Save stays
//      disabled, Enter in the field saves nothing, and a direct call writes
//      nothing; Escape closes it and focus returns to the control
//   2  one value everywhere: an ENTERED Base Rent (Luxe Nails), a CORRECTED
//      Base Rent with a reason (ShopRite) and a REJECTED Lease Exp. (Prime
//      Wellness) read the same in the Summary, the Acquisition Matrix, the
//      lease record, the rent roll and its CSV, the analysis, the rows
//      conversion takes, both matrix CSVs and the Acquisition Report — and
//      the rejected reading is in none of them as a value
//   3  the reading set aside is kept and named: "Replaced reading",
//      "Rejected reading", the history, the reason
//   4  a later document reading never overwrites an entered value: it stands,
//      still entered, with a warning; "Keep my value" clears the warning for
//      that reading; a different reading raises it again; Reopen hands the
//      term to the document
//   5  append-only: no decision is updated or deleted; every document's
//      evidence is byte-identical; a converted review offers no editor and
//      writes nothing
//   6  the editor on a phone
//
// The stand-in database is test-e2e-acquisition-lease-matrix.js's. Nothing
// leaves the page.
//
// Run: node test-e2e-acquisition-term-entry.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8959;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = F.UID, MAPLE = F.REVIEW;
const SHOP = F.FAM.shoprite, LUXE = F.FAM.luxe, PRIME = F.FAM.prime;
const LUXE_DOC = 'd11215d4-1035-4f73-958a-5a260fb339e7';
const SRC = fs.readFileSync(path.join(ROOT, 'test-e2e-acquisition-lease-matrix.js'), 'utf8');
const DB = SRC.slice(SRC.indexOf('const DB = `') + 'const DB = `'.length, SRC.indexOf('})();`;') + '})();'.length)
  .replace('${UID}', UID);

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];

  async function open(viewport, mobile, opts) {
    const o = opts || {};
    const ctx = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => { errs.push('a browser dialog was opened: ' + d.message().slice(0, 60)); d.dismiss().catch(() => {}); });
    for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(DB);
    await page.addInitScript(() => { try { localStorage.removeItem('acqMatrixView'); } catch (_) {} });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
      const dev = document.getElementById('_devRoleSwitcher'); if (dev) dev.remove();
      // Every write to the decisions table that is not an insert is recorded:
      // there must be none.
      window.__decWrites = [];
      const orig = db.from.bind(db);
      db.from = (t) => {
        const b = orig(t);
        if (t === 'acquisition_term_decisions') ['update', 'delete', 'upsert'].forEach(m => {
          if (typeof b[m] === 'function') { const f = b[m]; b[m] = function () { window.__decWrites.push(m); return f.apply(b, arguments); }; }
        });
        return b;
      };
    });
    await page.evaluate(async ({ maple, fx, status }) => {
      fx = JSON.parse(JSON.stringify(fx));
      __store.acquisition_reviews.push({ id: maple, user_id: 'u1', name: 'Maple Plaza', status: status,
        created_at: '2026-09-17T19:14:41Z', updated_at: 'rev-0',
        converted_at: status === 'converted' ? '2026-09-30T12:00:00Z' : null,
        data: { tenants: fx.tenants, invoices: [], totalSqFt: 0, documents: [], analysis: null } });
      fx.families.forEach(f => __store.acquisition_document_families.push(f));
      fx.documents.forEach(d => __store.acquisition_documents.push(Object.assign(d,
        { extracted_text: 'LEASE. ' + 'The full stored text of this document. '.repeat(4) })));
      fx.decisions.forEach(d => __store.acquisition_term_decisions.push(d));
      await _loadAcqReviewsAndRender();
      selectAcquisitionReview(maple);
    }, { maple: MAPLE, fx: F, status: o.status || 'complete' });
    await page.waitForSelector(`#acqTermsList .acq-lm-row[data-leasehold="${SHOP}"]`, { timeout: 15000 });
    return { ctx, page };
  }

  const rowSel = (field) => `#acqTermsList .acq-term-row[data-field="${field}"]`;
  const openRecord = async (page, fam) => {
    await page.evaluate((f) => { if (_acqOpenLeasehold) acqBackToLeaseMatrix(); acqOpenLeasehold(f, { view: 'summary' }); }, fam);
    await page.waitForSelector(`#acqTermsList .acq-lh[data-leasehold="${fam}"]`);
  };
  const decCount = (page) => page.evaluate(() => __store.acquisition_term_decisions.length);

  console.log('\nManual lease-term entry and its safeguards — Maple Plaza\n' + '='.repeat(64));
  const { ctx, page } = await open({ width: 1366, height: 900 }, false);
  const EV0 = await page.evaluate(() => JSON.stringify(__store.acquisition_documents.map(d => [d.id, d.abstracted_fields])));
  const D0 = await page.evaluate(() => JSON.stringify(__store.acquisition_term_decisions));
  const n0 = await decCount(page);

  // ── 1 · the editor; nothing invalid is saved ─────────────────────────────
  await openRecord(page, SHOP);
  await page.click(`${rowSel('end_date')} .acq-term-correct`);
  await page.waitForSelector(`${rowSel('end_date')} .acq-term-editor`);
  const ed = await page.evaluate((sel) => {
    const f = document.querySelector(sel + ' .acq-term-editor');
    return { focused: document.activeElement === f.querySelector('.acq-te-input'), type: f.querySelector('.acq-te-input').type,
             reason: !!f.querySelector('.acq-te-reason'), hint: (f.querySelector('.acq-te-hint') || {}).textContent || '',
             prefill: f.querySelector('.acq-te-input').value, others: document.querySelectorAll(sel + ' .acq-term-actions').length };
  }, rowSel('end_date'));
  check('Correct opens the editor in the term\'s row, a date picker for a date, focused, prefilled with the reading',
        ed.focused && ed.type === 'date' && ed.reason && ed.prefill === '2039-02-28' && ed.others === 0, JSON.stringify(ed));
  // A value the type cannot hold: typed into a text field the date input cannot take, so drive the
  // same check through the programmatic Save the editor calls.
  const bad = await page.evaluate(async (f) => ({ r: await acqCorrectTerm(f, 'end_date', '12/31/2040'),
    err: (document.querySelector('#acqTermsList .acq-te-error') || {}).textContent || '' }), SHOP);
  check('a correction the date cannot hold is refused and nothing is saved', bad.r === null && /not a date/.test(bad.err) && (await decCount(page)) === n0, JSON.stringify(bad));
  await page.keyboard.press('Escape');
  const esc1 = await page.evaluate((sel) => ({ open: !!document.querySelector('#acqTermsList .acq-term-editor'),
    focus: document.activeElement === document.querySelector(sel + ' .acq-term-correct') }), rowSel('end_date'));
  check('Escape closes the editor and focus returns to Correct', !esc1.open && esc1.focus, JSON.stringify(esc1));

  // Base Rent: a money field, typed.
  await page.click(`${rowSel('base_rent')} .acq-term-correct`);
  await page.waitForSelector(`${rowSel('base_rent')} .acq-term-editor`);
  await page.fill(`${rowSel('base_rent')} .acq-te-input`, '1.3 million');
  const inv = await page.evaluate((sel) => { const f = document.querySelector(sel + ' .acq-term-editor');
    return { save: f.querySelector('.acq-te-save').disabled, err: f.querySelector('.acq-te-error').textContent, preview: f.querySelector('.acq-te-preview').textContent }; }, rowSel('base_rent'));
  check('an amount the field cannot hold: Save disabled, the reason given, no preview', inv.save && /dollar amount/.test(inv.err) && !inv.preview, JSON.stringify(inv));
  await page.press(`${rowSel('base_rent')} .acq-te-input`, 'Enter');
  await page.waitForTimeout(300);
  check('Enter in the field saves nothing while the value is invalid', (await decCount(page)) === n0);

  // ── 2 · correct, with a reason ───────────────────────────────────────────
  await page.fill(`${rowSel('base_rent')} .acq-te-input`, '$1,300,000');
  await page.fill(`${rowSel('base_rent')} .acq-te-reason`, 'Per the tenant estoppel');
  const pv = await page.evaluate((sel) => document.querySelector(sel + ' .acq-te-preview').textContent, rowSel('base_rent'));
  check('a valid amount: the preview names exactly what will be recorded', /Will be recorded as: \$1,300,000 · Corrected by a person/.test(pv), pv);
  await page.press(`${rowSel('base_rent')} .acq-te-input`, 'Enter');
  await page.waitForTimeout(800);
  const dCorr = await page.evaluate(() => __store.acquisition_term_decisions.slice(-1)[0]);
  check('Enter saves one correction: the stored amount, the replaced reading, the reason, the document cited',
        (await decCount(page)) === n0 + 1 && dCorr.action === 'correct' && dCorr.new_value === '1300000' && dCorr.previous_value === '1251250'
        && dCorr.note === 'Per the tenant estoppel' && !!dCorr.source_document_id, JSON.stringify(dCorr));
  const recShop = await page.evaluate((sel) => { const r = document.querySelector(sel);
    return { value: (r.querySelector('.acq-term-value') || {}).innerText, replaced: (r.querySelector('.acq-term-replaced') || {}).innerText || '',
             src: (r.querySelector(':scope > .acq-term-main > .acq-term-src') || {}).innerText || null, reason: (r.querySelector('.acq-term-reason') || {}).innerText || '',
             history: (r.querySelector('.acq-term-history') || {}).textContent || '', focus: r.contains(document.activeElement) }; }, rowSel('base_rent'));
  check('the record shows $1,300,000, and the old clause only as the "Replaced reading" — never under the new value as its support',
        recShop.value === '$1,300,000' && /Replaced reading/.test(recShop.replaced) && /\$1,251,250/.test(recShop.replaced) && recShop.src === null, JSON.stringify(recShop));
  check('the reason is shown, and the history lists every decision on the term, the correction standing',
        /Per the tenant estoppel/.test(recShop.reason) && /History \(2\)/.test(recShop.history) && /Corrected to \$1,300,000/.test(recShop.history)
        && /replaced \$1,251,250/.test(recShop.history) && /stands/.test(recShop.history), recShop.history.replace(/\s+/g, ' ').slice(0, 200));
  check('focus returns to the saved term\'s row', recShop.focus);

  // ── 2 · enter a term no document establishes ─────────────────────────────
  await openRecord(page, LUXE);
  await page.click(`${rowSel('base_rent')} .acq-term-enter`);
  await page.waitForSelector(`${rowSel('base_rent')} .acq-term-editor`);
  const note = await page.evaluate((sel) => document.querySelector(sel + ' .acq-te-note').textContent, rowSel('base_rent'));
  check('Enter says, before typing, that no document establishes it and the value will be the person\'s', /No document on file establishes this term/.test(note), note);
  await page.fill(`${rowSel('base_rent')} .acq-te-input`, '48,000');
  const pv2 = await page.evaluate((sel) => document.querySelector(sel + ' .acq-te-preview').textContent, rowSel('base_rent'));
  check('the preview names the provenance', /\$48,000 · Verified · Entered by a person · No document on file supports this value/.test(pv2), pv2);
  await page.click(`${rowSel('base_rent')} .acq-te-save`);
  await page.waitForTimeout(800);
  const dEnt = await page.evaluate(() => __store.acquisition_term_decisions.slice(-1)[0]);
  check('Save writes one entered correction: no document, no quote, no page, the entered note',
        (await decCount(page)) === n0 + 2 && dEnt.new_value === '48000' && dEnt.source_document_id === null && dEnt.source_quote === null
        && dEnt.previous_value === null && /^Entered by a person\. No document on file supports it\./.test(dEnt.note), JSON.stringify(dEnt));

  // ── 2 · reject a reading ─────────────────────────────────────────────────
  await openRecord(page, PRIME);
  await page.click(`${rowSel('end_date')} .acq-term-reject`);
  await page.waitForTimeout(800);
  const recPrime = await page.evaluate((sel) => { const r = document.querySelector(sel);
    return { label: (r.querySelector('.acq-term-rejected') || {}).innerText || '', value: (r.querySelector('.acq-term-value') || {}).innerText || null,
             reading: (r.querySelector('.acq-term-rejected-reading') || {}).innerText || '', rejectAgain: !!r.querySelector('.acq-term-reject') }; }, rowSel('end_date'));
  check('the rejected term reads "Rejected by a person", shows no value, keeps the reading named "Rejected reading", and is not offered for rejection again',
        /Rejected by a person/.test(recPrime.label) && recPrime.value === null && /Rejected reading/.test(recPrime.reading) && /2029/.test(recPrime.reading) && !recPrime.rejectAgain, JSON.stringify(recPrime));

  // ── 2 · one value everywhere ─────────────────────────────────────────────
  await page.evaluate(() => acqBackToLeaseMatrix());
  await page.evaluate(async () => { const i = document.getElementById('acqTotalSqft'); i.value = '120000'; acqSaveSqft('120000'); await runAcquisitionAnalysis(); });
  await page.waitForTimeout(800);
  const everywhere = await page.evaluate(({ m, shop, luxe, prime }) => {
    const LM = window.AcquisitionLeaseMatrix || _LM();
    const cellText = (sel) => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
    const summary = {
      shopRent: cellText(`#acqTermsList .acq-lm-row[data-leasehold="${shop}"] td[data-label="Base rent"]`),
      luxeRent: cellText(`#acqTermsList .acq-lm-row[data-leasehold="${luxe}"] td[data-label="Base rent"]`),
      primeExp: cellText(`#acqTermsList .acq-lm-row[data-leasehold="${prime}"] td[data-label="Expiration"]`),
    };
    const rows = _acqLeaseholdsOnly(_acqCanonicalRows(m));
    const by = id => rows.find(r => r._leaseholdId === id) || {};
    const conversion = { shop: by(shop).base_rent, luxe: by(luxe).base_rent, primeEnd: by(prime).end_date, luxeOrigin: (by(luxe)._origins || {}).base_rent };
    const review = _acqReviews.find(r => r.id === m);
    const ts = (review.data.analysis.tenantSummary || []);
    const rr = (review.data.analysis.rentRoll || {}).rows || (review.data.analysis.rentRoll || {}).tenants || [];
    const tsBy = id => ts.find(t => t._leaseholdId === id || t.id === id) || {};
    const analysis = { shop: tsBy(shop).base_rent, luxe: tsBy(luxe).base_rent, primeEnd: tsBy(prime).lease_end !== undefined ? tsBy(prime).lease_end : tsBy(prime).end_date };
    const m13 = _acqMatrix13For(m);
    const csv = LM.matrix13Csv(m13), prov = LM.matrix13ProvenanceCsv(m13);
    const terms = { shop: _acqFamilyTerms(shop).terms, luxe: _acqFamilyTerms(luxe).terms, prime: _acqFamilyTerms(prime).terms };
    const AR = window.AcquisitionReport;
    const facts = { shop: AR.projectTerm(terms.shop.base_rent), luxe: AR.projectTerm(terms.luxe.base_rent), prime: AR.projectTerm(terms.prime.end_date) };
    return { summary, conversion, analysis, csv, prov, facts: { shop: [facts.shop.value, facts.shop.state], luxe: [facts.luxe.value, facts.luxe.state, facts.luxe.origin], prime: [facts.prime.value, facts.prime.note] },
             rrLen: rr.length };
  }, { m: MAPLE, shop: SHOP, luxe: LUXE, prime: PRIME });
  check('Summary: $1,300,000 · $48,000 (entered) · "Rejected by a person"',
        /\$1,300,000/.test(everywhere.summary.shopRent) && /\$48,000/.test(everywhere.summary.luxeRent) && /Rejected by a person/.test(everywhere.summary.primeExp)
        && !/2029/.test(everywhere.summary.primeExp), JSON.stringify(everywhere.summary));
  check('the rows conversion takes: 1,300,000 · 48,000 (entered) · no expiration', everywhere.conversion.shop === 1300000 && everywhere.conversion.luxe === 48000
        && everywhere.conversion.luxeOrigin === 'entered' && everywhere.conversion.primeEnd === null, JSON.stringify(everywhere.conversion));
  check('the analysis (rent roll, Risk Analysis, Ask AI\'s stored copy) carries the same', everywhere.analysis.shop === 1300000 && everywhere.analysis.luxe === 48000
        && (everywhere.analysis.primeEnd === null || everywhere.analysis.primeEnd === undefined || everywhere.analysis.primeEnd === ''), JSON.stringify(everywhere.analysis));
  const csvLine = (csv, name) => csv.split('\r\n').find(l => l.indexOf(name) >= 0 || l.indexOf('"' + name) >= 0) || '';
  check('the matrix CSV writes the same values, and "Rejected by a person" for the rejected expiry',
        /\$1,300,000/.test(csvLine(everywhere.csv, 'ShopRite')) && /\$48,000/.test(csvLine(everywhere.csv, 'Luxe')) && /Rejected by a person/.test(csvLine(everywhere.csv, 'Prime'))
        && !/2\/28\/2029/.test(csvLine(everywhere.csv, 'Prime')), csvLine(everywhere.csv, 'Prime').slice(0, 120));
  const pRent = everywhere.prov.split('\r\n').find(l => /ShopRite/.test(l) && /,Base Rent,/.test(l)) || '';
  const pLuxe = everywhere.prov.split('\r\n').find(l => /Luxe/.test(l) && /,Base Rent,/.test(l)) || '';
  const pPrime = everywhere.prov.split('\r\n').find(l => /Prime/.test(l) && /,Lease Exp\.,/.test(l)) || '';
  check('the sources CSV: previous value, origin and reason for each', /\$1,251,250/.test(pRent) && /Corrected by a person/.test(pRent) && /Per the tenant estoppel/.test(pRent)
        && /Entered by a person/.test(pLuxe) && /Rejected by a person/.test(pPrime) && /2\/28\/2029/.test(pPrime), [pRent, pLuxe, pPrime].map(s => s.slice(-90)).join(' || '));
  check('the Acquisition Report\'s facts: $1,300,000 verified · $48,000 verified and entered · no expiry for Prime, saying it was rejected',
        everywhere.facts.shop[0] === 1300000 && everywhere.facts.shop[1] === 'verified' && everywhere.facts.luxe[0] === 48000 && everywhere.facts.luxe[2] === 'entered'
        && everywhere.facts.prime[0] === null && /Rejected by a person/.test(everywhere.facts.prime[1] || ''), JSON.stringify(everywhere.facts));
  // The report as drawn.
  await page.click('#acqReportV2Btn');
  await page.waitForSelector('#reportOverlay', { state: 'visible', timeout: 15000 });
  const rep = await page.evaluate(() => document.getElementById('reportOverlay').innerText.replace(/\s+/g, ' '));
  await page.evaluate(() => closeReport());
  check('the Acquisition Report as drawn shows $1,300,000 and $48,000 and never the replaced $1,251,250 as a value',
        /\$1,300,000/.test(rep) && /\$48,000/.test(rep), rep.slice(0, 80));
  // The Acquisition Matrix, and its downloads.
  await page.click('#acqTermsList .acq-lm-view[data-view="acquisition"]');
  await page.waitForSelector('#acqTermsList .acq-m13-table');
  const m13 = await page.evaluate(({ shop, luxe, prime }) => {
    const t = (id, f) => { const e = document.querySelector(`#acqTermsList .acq-m13-cell[data-leasehold="${id}"][data-field="${f}"]`); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
    return { shop: t(shop, 'base_rent'), luxe: t(luxe, 'base_rent'), prime: t(prime, 'end_date') };
  }, { shop: SHOP, luxe: LUXE, prime: PRIME });
  check('the Acquisition Matrix: the same three cells', /\$1,300,000/.test(m13.shop) && /\$48,000/.test(m13.luxe) && /Rejected by a person/.test(m13.prime), JSON.stringify(m13));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#acqTermsList .acq-m13-csv')]);
  const csvFile = fs.readFileSync(await dl.path(), 'utf8');
  check('the downloaded matrix CSV is the same file the model writes', csvFile.replace(/^﻿/, '') === everywhere.csv.replace(/^﻿/, ''));
  await page.click(`#acqTermsList .acq-m13-cell[data-leasehold="${PRIME}"][data-field="end_date"]`);
  await page.waitForSelector('#acqTermsList .acq-m13-detail');
  const det = await page.evaluate(() => document.querySelector('#acqTermsList .acq-m13-detail').innerText.replace(/\s+/g, ' '));
  check('its sources panel names the rejected reading and keeps it', /Rejected reading — set aside by a person, not used/i.test(det) && /2\/28\/2029/.test(det), det.slice(0, 160));
  await page.evaluate(() => acqCloseMatrixCell());
  // Rent roll CSV.
  await page.click('#acqTermsList .acq-lm-view[data-view="summary"]');
  const [rdl] = await Promise.all([page.waitForEvent('download'), page.click('#acqReportContainer .acq-export-btn')]);
  const rrCsv = fs.readFileSync(await rdl.path(), 'utf8');
  const rrLine = (name) => rrCsv.split('\n').find(l => l.indexOf(name) >= 0) || '';
  check('the Rent Roll CSV: 1,300,000 and 48,000, and no 2029 expiry for Prime',
        /1,?300,?000/.test(rrLine('ShopRite')) && /48,?000/.test(rrLine('Luxe')) && !/2029/.test(rrLine('Prime')), [rrLine('ShopRite'), rrLine('Luxe'), rrLine('Prime')].map(s => s.slice(0, 90)).join(' || '));

  // ── 4 · a later document reading never overwrites an entered value ───────
  await page.evaluate(async ({ doc, m }) => {
    const d = __store.acquisition_documents.find(x => x.id === doc);
    d.abstracted_fields = JSON.parse(JSON.stringify(d.abstracted_fields));
    d.abstracted_fields.fields.base_rent = { value: 52000, quote: 'Annual Base Rent shall be $52,000.', page: 2, confidence: 0.9 };
    _acqEvidence.delete(doc);
    await _acqLoadEvidence(m);
    _renderAcqTerms();
  }, { doc: LUXE_DOC, m: MAPLE });
  const sumC = await page.evaluate((luxe) => {
    const r = document.querySelector(`#acqTermsList .acq-lm-row[data-leasehold="${luxe}"]`);
    return { rent: r.querySelector('td[data-label="Base rent"]').innerText.trim(), conflict: !!r.querySelector('[data-conflict="true"]'),
             status: r.querySelector('.acq-lm-status').innerText.trim() };
  }, LUXE);
  check('after a document reads $52,000: the Summary still shows the entered $48,000, marked, and the row asks for review',
        /\$48,000/.test(sumC.rent) && !/52,000/.test(sumC.rent) && sumC.conflict && /entered value to review/i.test(sumC.status), JSON.stringify(sumC));
  await openRecord(page, LUXE);
  const recC = await page.evaluate((sel) => { const r = document.querySelector(sel);
    return { value: (r.querySelector('.acq-term-value') || {}).innerText, entered: r.getAttribute('data-origin'), warn: (r.querySelector('.acq-term-doc-conflict') || {}).innerText || '',
             keep: !!r.querySelector('.acq-term-keep'), attn: (document.querySelector('#acqTermsList .acq-lh-attn') || {}).innerText || '' }; }, rowSel('base_rent'));
  check('the record: the entered value stands, still entered, with the document\'s $52,000 beside it and a warning',
        recC.value === '$48,000' && recC.entered === 'entered' && /reads this term differently/.test(recC.warn) && /\$52,000/.test(recC.warn) && recC.keep, JSON.stringify(recC));
  check('Needs attention lists it', /entered value a document now reads differently/.test(recC.attn), recC.attn.replace(/\s+/g, ' ').slice(0, 120));
  const conv2 = await page.evaluate(({ m, luxe }) => (_acqLeaseholdsOnly(_acqCanonicalRows(m)).find(r => r._leaseholdId === luxe) || {}).base_rent, { m: MAPLE, luxe: LUXE });
  check('and conversion still takes the entered 48,000', conv2 === 48000, String(conv2));
  // Keep my value, with a reason.
  await page.click(`${rowSel('base_rent')} .acq-term-keep`);
  await page.waitForSelector(`${rowSel('base_rent')} .acq-term-editor[data-mode="keep"]`);
  await page.fill(`${rowSel('base_rent')} .acq-te-reason`, 'Confirmed with the tenant');
  await page.click(`${rowSel('base_rent')} .acq-te-save`);
  await page.waitForTimeout(800);
  const dKeep = await page.evaluate(() => __store.acquisition_term_decisions.slice(-1)[0]);
  const recK = await page.evaluate((sel) => { const r = document.querySelector(sel);
    return { value: (r.querySelector('.acq-term-value') || {}).innerText, warn: !!r.querySelector('.acq-term-doc-conflict'), kept: (r.querySelector('.acq-term-doc-kept') || {}).innerText || '',
             history: (r.querySelector('.acq-term-history') || {}).textContent.replace(/\s+/g, ' ') }; }, rowSel('base_rent'));
  check('"Keep my value" records the same entered value over the $52,000 reading, with the reason',
        dKeep.action === 'correct' && dKeep.new_value === '48000' && dKeep.previous_value === '52000' && dKeep.source_document_id === null
        && /Reason: Confirmed with the tenant/.test(dKeep.note), JSON.stringify(dKeep));
  check('the warning clears; the value is kept; the history shows the entry and the keep', recK.value === '$48,000' && !recK.warn && /You kept your entered value/.test(recK.kept)
        && /Entered \$48,000/.test(recK.history) && /Kept \$48,000/.test(recK.history) && /over the document’s \$52,000/.test(recK.history), JSON.stringify(recK));
  // A different reading later raises the warning again.
  await page.evaluate(async ({ doc, m }) => {
    const d = __store.acquisition_documents.find(x => x.id === doc);
    d.abstracted_fields = JSON.parse(JSON.stringify(d.abstracted_fields));
    d.abstracted_fields.fields.base_rent.value = 53000; d.abstracted_fields.fields.base_rent.quote = 'Annual Base Rent shall be $53,000.';
    _acqEvidence.delete(doc);
    await _acqLoadEvidence(m);
    _renderAcqTerms();
  }, { doc: LUXE_DOC, m: MAPLE });
  const recA = await page.evaluate((sel) => { const r = document.querySelector(sel);
    return { value: (r.querySelector('.acq-term-value') || {}).innerText, warn: (r.querySelector('.acq-term-doc-conflict') || {}).innerText || '' }; }, rowSel('base_rent'));
  check('a later reading of $53,000 raises the warning again; the value is still $48,000', recA.value === '$48,000' && /\$53,000/.test(recA.warn), JSON.stringify(recA));
  // Reopen hands the term to the document.
  await page.click(`${rowSel('base_rent')} .acq-term-reopen`);
  await page.waitForTimeout(800);
  const recR = await page.evaluate((sel) => { const r = document.querySelector(sel);
    return { value: (r.querySelector('.acq-term-value') || {}).innerText, state: r.getAttribute('data-state'), origin: r.getAttribute('data-origin') }; }, rowSel('base_rent'));
  check('Reopen hands the term to the document: $53,000, read by AI, not entered', recR.value === '$53,000' && recR.state === 'ai_extracted' && !recR.origin, JSON.stringify(recR));

  // ── 5 · append-only; evidence intact ─────────────────────────────────────
  const tail = await page.evaluate(() => ({ writes: window.__decWrites.slice(), decs: JSON.stringify(__store.acquisition_term_decisions), n: __store.acquisition_term_decisions.length }));
  check('no decision was updated, deleted or upserted — only inserted', tail.writes.length === 0, tail.writes.join(','));
  check('every decision that was there before is still there, unchanged, first', tail.decs.indexOf(D0.slice(0, -1)) === 0 && tail.n === n0 + 5, String(tail.n - n0) + ' added');
  const EV1 = await page.evaluate((doc) => JSON.stringify(__store.acquisition_documents.filter(d => d.id !== doc).map(d => [d.id, d.abstracted_fields])), LUXE_DOC);
  const EV0x = JSON.stringify(JSON.parse(EV0).filter(([id]) => id !== LUXE_DOC));
  check('every document\'s evidence is byte-identical (the Luxe lease was changed only by this test, to stand for a re-read)', EV1 === EV0x);
  await ctx.close();

  // ── 5 · a converted review ───────────────────────────────────────────────
  {
    const { ctx: c, page: p } = await open({ width: 1366, height: 900 }, false, { status: 'converted' });
    await openRecord(p, LUXE);
    const fz = await p.evaluate(async (luxe) => {
      const before = __store.acquisition_term_decisions.length;
      const ctl = document.querySelectorAll('#acqTermsList .acq-term-correct, #acqTermsList .acq-term-enter, #acqTermsList .acq-term-keep, #acqTermsList .acq-term-reject').length;
      acqOpenTermEditor(luxe, 'base_rent', 'enter');
      const editor = !!document.querySelector('#acqTermsList .acq-term-editor');
      const r1 = await acqEnterTerm(luxe, 'base_rent', '48000');
      const r2 = await acqCorrectTerm(luxe, 'leased_sqft', '3100');
      return { ctl, editor, r1, r2, written: __store.acquisition_term_decisions.length - before };
    }, LUXE);
    check('a converted review: no Correct, Enter, Keep or Reject; the editor cannot be opened; nothing is written',
          fz.ctl === 0 && !fz.editor && fz.r1 === null && fz.r2 === null && fz.written === 0, JSON.stringify(fz));
    await c.close();
  }

  // ── 6 · the editor on a phone ────────────────────────────────────────────
  {
    const { ctx: c, page: p } = await open({ width: 375, height: 812 }, true);
    await openRecord(p, LUXE);
    await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), rowSel('base_rent'));
    await p.click(`${rowSel('base_rent')} .acq-term-enter`);
    await p.waitForSelector(`${rowSel('base_rent')} .acq-term-editor`);
    const ph = await p.evaluate((sel) => {
      const f = document.querySelector(sel + ' .acq-term-editor').getBoundingClientRect();
      const s = document.querySelector(sel + ' .acq-te-save').getBoundingClientRect();
      const i = document.querySelector(sel + ' .acq-te-input').getBoundingClientRect();
      return { right: Math.round(f.right), vw: innerWidth, sw: document.documentElement.scrollWidth, save: Math.round(s.height), input: Math.round(i.height) };
    }, rowSel('base_rent'));
    check('on a 375px phone the editor fits the screen, and its field and Save are 44px tall', ph.right <= ph.vw && ph.sw <= ph.vw && ph.save >= 44 && ph.input >= 44, JSON.stringify(ph));
    await c.close();
  }

  check('no uncaught errors, and no browser dialog', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  srv.close();
  const passed = results.filter(r => r.ok).length;
  console.log('\n' + '='.repeat(64) + `\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
