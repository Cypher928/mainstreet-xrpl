// test-e2e-acquisition-match-safeguards.js
// ============================================================================
// Matching and conversion safeguards, walked in the page with Maple Plaza as
// the Pilot holds it (fixtures/maple-plaza-acquisition.js), its five
// unmatched extractions unresolved — the state it was in on 2026-09-26 before
// SafeShield Security was matched to Sunrise Cafe & Bakery.
//
//   1  Sunrise becomes a new leasehold (no document on file)
//   2  SafeShield Security → Sunrise: the row asks first — the extracted
//      tenant, the leasehold, the source file and property, the concern;
//      Cancel writes nothing; Match anyway with no reason writes nothing;
//      with a reason, the resolution and activity carry both
//   3  genuine matches (Luxe Nails, Maple Coffee Co → Maple Coffee Co.,
//      Prime Wellness Spa) are recorded at once, as before
//   4  conversion: Sunrise, with no lease on file, blocks it — named — until a
//      person acknowledges it; the acknowledgement is recorded, says it
//      verifies nothing, and changes no term, decision or document
//   5  a converted acquisition offers none of this and writes nothing
//
// The stand-in database is test-e2e-acquisition-lease-matrix.js's. Nothing
// leaves the page.
//
// Run: node test-e2e-acquisition-match-safeguards.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const F = require('./fixtures/maple-plaza-acquisition.js');
const ROOT = __dirname, PORT = 8973;
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
      fx.tenants.forEach(t => {
        if (t.id === '1f89d42e-0651-490c-b6f7-ffc091f8eb0c') t.property_name = '500 Main Street';
        if (t.id === '18868fa7-5a14-43df-ac36-eba092b52445') t.property_name = 'Maple Plaza Shopping Center, 1240 Commerce Blvd, Austin TX 78701';
      });
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


  const SAFE = '1f89d42e-0651-490c-b6f7-ffc091f8eb0c', SUNRISE_ROW = '18868fa7-5a14-43df-ac36-eba092b52445';
  const LUXE_ROW = 'ef57f534-9d56-4b49-a12d-ba0f6be65bf1', COFFEE_ROW = 'fbfa929b-5013-475c-838e-af8b03cacd44', PRIME_ROW = '6bfe2b5e-c418-4248-b6d5-6888e7563dd3';
  const INS_ROW = '3b9f05c3-2560-4c60-8ded-cf2a4a78d2c8';
  const review = (page) => page.evaluate((m) => JSON.parse(JSON.stringify(__store.acquisition_reviews.find(r => r.id === m).data)), MAPLE);
  const openList = async (page) => {
    await page.evaluate(() => { if (_acqOpenLeasehold) acqBackToLeaseMatrix(); const d = document.querySelector('#acqTermsList details.acq-lm-unfiled'); if (d) d.open = true; });
    await page.waitForSelector('#acqTermsList details.acq-lm-unfiled');
    await page.evaluate(() => { document.querySelector('#acqTermsList details.acq-lm-unfiled').open = true; });
  };
  const rowLi = (key) => `#acqTermsList li[data-row="${key}"]`;

  console.log('\nMatching and conversion safeguards — Maple Plaza\n' + '='.repeat(64));
  const { ctx, page } = await open({ width: 1366, height: 900 }, false);
  const DEC0 = await page.evaluate(() => JSON.stringify(__store.acquisition_term_decisions));
  await openList(page);
  check('the five unmatched extractions are unresolved (the state before 2026-09-26)',
    await page.evaluate(() => document.querySelectorAll('#acqTermsList li.acq-um-open').length) >= 5);

  // ── 1 · Sunrise becomes a new leasehold ─────────────────────────────────
  await page.click(`${rowLi(SUNRISE_ROW)} .acq-um-new`);
  await page.waitForTimeout(700);
  const SUN = await page.evaluate((m) => (__store.acquisition_document_families.find(f => f.review_id === m && /Sunrise/.test(f.label)) || {}).id, MAPLE);
  check('Sunrise Cafe & Bakery LLC is a new leasehold with no document filed into it', !!SUN
    && await page.evaluate((id) => !__store.acquisition_documents.some(d => d.family_id === id), SUN));

  // ── 2 · SafeShield Security → Sunrise asks first ──────────────────────────
  await openList(page);
  const D1 = await review(page);
  await page.selectOption(`${rowLi(SAFE)} select.acq-um-match`, SUN);
  await page.waitForSelector(`${rowLi(SAFE)} .acq-um-confirm`);
  const box = await page.evaluate((sel) => {
    const b = document.querySelector(sel + ' .acq-um-confirm');
    const f = (k) => (b.querySelector(`dd[data-fact="${k}"]`) || {}).textContent || '';
    return { extracted: f('extracted'), selected: f('selected'), file: f('file'), property: f('property'), acquisition: f('acquisition'),
             concerns: [...b.querySelectorAll('.acq-um-concerns li')].map(li => [li.getAttribute('data-kind'), li.getAttribute('data-level'), li.textContent]),
             needsReason: b.getAttribute('data-requires-reason'), buttons: [...b.querySelectorAll('button')].map(x => x.textContent.trim()),
             focus: document.activeElement && document.activeElement.className };
  }, rowLi(SAFE));
  check('the row shows the extracted tenant, the selected leasehold, the source file and the property the lease names',
    box.extracted === 'SafeShield Security, LLC' && box.selected === 'Sunrise Cafe & Bakery LLC' && box.file === 'messy_scanned_lease.pdf'
    && box.property === '500 Main Street' && /Maple plaza/i.test(box.acquisition), JSON.stringify(box).slice(0, 300));
  check('it explains the concern: the tenant names do not match (material); the property may not (uncertain)',
    box.concerns.length === 2 && box.concerns[0][0] === 'tenant_name' && box.concerns[0][1] === 'mismatch' && /do not match/.test(box.concerns[0][2])
    && box.concerns[1][0] === 'property_name' && box.concerns[1][1] === 'uncertain', JSON.stringify(box.concerns));
  check('it offers Cancel and Match anyway, and requires a reason', JSON.stringify(box.buttons) === JSON.stringify(['Cancel', 'Match anyway']) && box.needsReason === 'true');
  check('nothing is written while it asks', JSON.stringify(await review(page)) === JSON.stringify(D1));

  await page.click(`${rowLi(SAFE)} .acq-um-cancel`);
  await page.waitForTimeout(300);
  const afterCancel = await page.evaluate((sel) => ({ box: !!document.querySelector(sel + ' .acq-um-confirm'), sel: (document.querySelector(sel + ' select.acq-um-match') || {}).value }), rowLi(SAFE));
  check('Cancel: the question closes, the row is unmatched again, and the resolution and activity log are unchanged',
    !afterCancel.box && afterCancel.sel === '' && JSON.stringify(await review(page)) === JSON.stringify(D1), JSON.stringify(afterCancel));

  check('…and the list stays open where the person was working', await page.evaluate(() => document.querySelector('#acqTermsList details.acq-lm-unfiled').open));
  await page.selectOption(`${rowLi(SAFE)} select.acq-um-match`, SUN);
  await page.waitForSelector(`${rowLi(SAFE)} .acq-um-confirm`);
  await page.click(`${rowLi(SAFE)} .acq-um-confirm-btn`);
  await page.waitForTimeout(300);
  const noReason = await page.evaluate((sel) => (document.querySelector(sel + ' .acq-um-confirm-error') || {}).textContent || '', rowLi(SAFE));
  check('Match anyway with no reason: refused, said why, nothing written', /Give a reason/.test(noReason) && JSON.stringify(await review(page)) === JSON.stringify(D1), noReason);

  await page.fill(`${rowLi(SAFE)} .acq-um-reason`, 'Seller confirms SafeShield occupies the Sunrise suite (test)');
  await page.click(`${rowLi(SAFE)} .acq-um-confirm-btn`);
  await page.waitForTimeout(800);
  const D2 = await review(page);
  const r2 = (D2.extractionResolutions || {})[SAFE] || {};
  const a2 = (D2.activity || []).slice(-1)[0] || {};
  check('with a reason: the resolution records the match, the concerns and the reason',
    r2.action === 'matched' && r2.familyId === SUN && r2.reason === 'Seller confirms SafeShield occupies the Sunrise suite (test)'
    && Array.isArray(r2.concerns) && r2.concerns[0].kind === 'tenant_name' && r2.concerns[0].level === 'mismatch', JSON.stringify(r2).slice(0, 300));
  check('and so does the append-only activity entry', a2.type === 'extraction_resolved' && a2.meta && a2.meta.rowId === SAFE
    && a2.meta.reason === r2.reason && a2.meta.concerns.length === 2 && /confirmed by a person despite/.test(a2.summary)
    && (D2.activity || []).length === (D1.activity || []).length + 1, JSON.stringify(a2).slice(0, 300));
  await openList(page);
  const resolvedLine = await page.evaluate((key) => (document.querySelector(`#acqTermsList li.acq-um-resolved[data-row="${key}"]`) || {}).innerText || '', SAFE);
  check('the resolved line says it was matched despite the concern, with the reason', /matched despite/.test(resolvedLine) && /Seller confirms/.test(resolvedLine), resolvedLine.slice(0, 200));

  // ── 3 · genuine matches are recorded at once ─────────────────────────────
  for (const [row, fam, name] of [[LUXE_ROW, F.FAM.luxe, 'Luxe Nails'], [COFFEE_ROW, F.FAM.coffee, 'Maple Coffee Co → Maple Coffee Co.'], [PRIME_ROW, F.FAM.prime, 'Prime Wellness Spa']]) {
    await openList(page);
    const n0 = (await review(page)).activity.length;
    await page.selectOption(`${rowLi(row)} select.acq-um-match`, fam);
    await page.waitForTimeout(700);
    const d = await review(page);
    const r = (d.extractionResolutions || {})[row] || {};
    const asked = await page.evaluate((sel) => !!document.querySelector(sel + ' .acq-um-confirm'), rowLi(row));
    check(`${name}: matched at once — no question, no concern fields`, !asked && r.action === 'matched' && r.familyId === fam
      && !('concerns' in r) && !('reason' in r) && d.activity.length === n0 + 1, JSON.stringify(r));
  }
  await openList(page);
  await page.click(`${rowLi(INS_ROW)} .acq-um-dismiss`);
  await page.waitForTimeout(700);

  // Confirm the leaseholds the AI filed documents into (Documents panel), so
  // only the missing lease stands between this review and acquisition.
  for (let i = 0; i < 6; i++) {
    const id = await page.evaluate(() => { const b = document.querySelector('#acqDocsList .acq-doc-confirm-family'); return b && b.getAttribute('data-doc-id'); });
    if (!id) break;
    await page.click(`#acqDocsList .acq-doc-confirm-family[data-doc-id="${id}"]`);
    await page.waitForTimeout(500);
  }
  const pend = await page.evaluate(() => _acqPendingDocuments(_activeAcqId).map(p => p.doc.file_name + ': ' + p.reasons.join('; ')));
  check('nothing else is pending in Documents', pend.length === 0, JSON.stringify(pend));

  // ── 4 · conversion: Sunrise has no lease on file ──────────────────────────
  await page.evaluate(async () => { const i = document.getElementById('acqTotalSqft'); if (i) i.value = '120000'; acqSaveSqft('120000'); await runAcquisitionAnalysis(); });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const r = _acqReviews.find(x => x.id === _activeAcqId); _renderAcqConvertAction(r); });
  const gate = await page.evaluate((sun) => {
    const el = document.getElementById('acqConvertAction');
    const item = el.querySelector(`.acq-docless-item[data-family="${sun}"]`);
    return { disabled: !!(el.querySelector('.acq-convert-btn') || {}).disabled, why: (el.querySelector('.acq-convert-blocked') || {}).textContent || '',
             item: item ? item.textContent.replace(/\s+/g, ' ') : null, ack: item ? item.getAttribute('data-acknowledged') : null,
             others: el.querySelectorAll('.acq-docless-item').length };
  }, SUN);
  check('Acquire is blocked, naming Sunrise and the missing lease, and saying an acknowledgement verifies nothing',
    gate.disabled && /Sunrise Cafe & Bakery LLC/.test(gate.why) && /no lease document on file/.test(gate.why) && /does not verify any term/.test(gate.why), gate.why);
  check('Sunrise is listed — the only one — with the missing-document condition, not yet acknowledged',
    gate.others === 1 && /No lease document is filed into this leasehold/.test(gate.item || '') && gate.ack === 'false', JSON.stringify(gate));
  const opened = await page.evaluate(() => { _showAcqConvertModal(); return document.getElementById('acqConvertModal').style.display; });
  check('the convert dialog will not open past it', opened !== 'flex', opened);

  const D3 = await review(page);
  const DECA = await page.evaluate(() => JSON.stringify(__store.acquisition_term_decisions));
  const DOCA = await page.evaluate(() => JSON.stringify(__store.acquisition_documents));
  const FAMA = await page.evaluate(() => JSON.stringify(__store.acquisition_document_families));
  await page.click(`#acqConvertAction .acq-docless-ack-btn[data-family="${SUN}"]`);
  await page.waitForTimeout(800);
  const D4 = await review(page);
  const ack = (D4.leaseholdAcknowledgements || {})[SUN] || {};
  const a4 = (D4.activity || []).slice(-1)[0] || {};
  check('the acknowledgement is recorded on the review: condition, who, when — and verifiesTerms false',
    ack.condition === 'no_document_on_file' && ack.verifiesTerms === false && ack.by === F.UID && typeof ack.at === 'string', JSON.stringify(ack));
  check('and in the activity history, worded as a missing lease, not a verification',
    a4.type === 'leasehold_acknowledged' && a4.meta.familyId === SUN && a4.meta.verifiesTerms === false && /does not verify them/.test(a4.summary)
    && D4.activity.length === D3.activity.length + 1, a4.summary);
  const after = await page.evaluate((sun) => {
    const el = document.getElementById('acqConvertAction');
    const item = el.querySelector(`.acq-docless-item[data-family="${sun}"]`);
    const terms = _acqFamilyTerms(sun).terms;
    const states = Object.keys(terms).map(k => terms[k].state);
    return { disabled: !!(el.querySelector('.acq-convert-btn') || {}).disabled, item: item ? item.textContent.replace(/\s+/g, ' ') : '',
             ack: item && item.getAttribute('data-acknowledged'), verified: states.filter(s => s === 'verified').length,
             missing: states.filter(s => s === 'missing').length, total: states.length };
  }, SUN);
  check('the panel says it is acknowledged and that this does not verify any lease term',
    after.ack === 'true' && /does not verify any lease term; its terms remain not established/.test(after.item), after.item);
  check('Sunrise’s terms are unchanged: every one still not established, none verified', after.verified === 0 && after.missing === after.total && after.total > 0, JSON.stringify(after));
  check('acknowledging wrote no decision, document or leasehold', DECA === await page.evaluate(() => JSON.stringify(__store.acquisition_term_decisions))
    && DOCA === await page.evaluate(() => JSON.stringify(__store.acquisition_documents))
    && FAMA === await page.evaluate(() => JSON.stringify(__store.acquisition_document_families)));
  check('across the whole walk, no term decision was written', DEC0 === await page.evaluate(() => JSON.stringify(__store.acquisition_term_decisions)));
  check('Acquire is offered once it is acknowledged', !after.disabled, JSON.stringify(after));
  const modal = await page.evaluate(() => { _showAcqConvertModal(); const m = document.getElementById('acqConvertModal');
    const t = (document.getElementById('acqConvertModalDocless') || {}).textContent || ''; _hideAcqConvertModal(); return { shown: m.style.display, t }; });
  check('the convert dialog says again that Sunrise converts with no lease on file, unverified',
    /no lease on file for Sunrise Cafe & Bakery LLC/.test(modal.t) && /does not verify them/.test(modal.t), modal.t);
  await ctx.close();

  // ── 5 · a converted acquisition ─────────────────────────────────────────
  const c = await open({ width: 1366, height: 900 }, false, { status: 'converted' });
  const fz0 = await review(c.page);
  const fz = await c.page.evaluate(async ({ safe, sun }) => {
    const box = document.getElementById('acqTermsList');
    const r1 = await acqRequestMatch(safe, sun);
    const r2 = await acqAcknowledgeDocumentless(sun);
    const r3 = await acqResolveExtraction(safe, _AL().RESOLUTION.MATCHED, sun, { confirmed: true, reason: 'x' });
    return { selects: box.querySelectorAll('select.acq-um-match').length, confirm: box.querySelectorAll('.acq-um-confirm').length,
             ackBtns: document.querySelectorAll('.acq-docless-ack-btn').length, r1, r2, r3 };
  }, { safe: SAFE, sun: F.FAM.luxe });
  check('a converted acquisition: no match control, no question, no acknowledgement — and every call refuses, writing nothing',
    fz.selects === 0 && fz.confirm === 0 && fz.ackBtns === 0 && fz.r1 === false && fz.r2 === false && fz.r3 === false
    && JSON.stringify(await review(c.page)) === JSON.stringify(fz0), JSON.stringify(fz));
  await c.ctx.close();

  check('no uncaught errors, and no browser dialog', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(64) + '\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
