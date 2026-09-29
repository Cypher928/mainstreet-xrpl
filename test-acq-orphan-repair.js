// test-acq-orphan-repair.js
// ============================================================================
// An acquisition review whose property was deleted must be TOLD THE TRUTH.
//
// Harborview Retail Center read "Converted" with nothing in the portfolio. Two
// separate defects behind one symptom:
//
//   1. convertAcquisitionToProperty() writes conversionRecord.propertyId, and
//      confirmDeleteProperty() deletes the property without ever looking for a
//      review pointing at it. The review went on claiming Converted.
//
//   2. Worse: the duplicate guard tests for the conversion RECORD, not the
//      property. Once the property was gone the record outlived the thing it
//      protected against — so it stopped preventing a duplicate and started
//      preventing the repair. That review could never be converted again.
//
// What this walks changed in P5-6A. A converted review is a CLOSED acquisition:
// migration 036 refuses every change to it, its documents, leaseholds and
// decisions — including the "Convert Again" write (a new conversionRecord on a
// converted row). So the orphan is still detected and still named on the card
// and in the detail badge, its analysis is still rendered, but no Convert Again
// is offered, a conversion attempt is refused before any property is built,
// and the review stays exactly as it was: the record of that acquisition.
// (Re-converting a closed record, if ever wanted, is a deliberate data act.)
//
// The false positive this must never produce: if loadProperties() FAILS, _props
// is empty and every converted review would look orphaned — the product would
// tell someone their buildings were deleted because the network blipped. The
// last section asserts silence in that case.
//
// Run: node test-acq-orphan-repair.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8918;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

// Click strictly by visible label — if a person could not find it, nor can this.
const CLICK_LABEL = function (rx) {
  var re = new RegExp(rx, 'i');
  var els = [].slice.call(document.querySelectorAll('a,button,[role="button"],.acq-converted-link'));
  var hit = els.filter(function (e) {
    var r = e.getBoundingClientRect(); var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) return false;
    return re.test((e.innerText || e.textContent || '').trim());
  });
  if (!hit.length) return null;
  hit.sort(function (a, b) {
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    return (rb.width * rb.height) - (ra.width * ra.height);
  });
  hit[0].click();
  return (hit[0].innerText || hit[0].textContent || '').trim().slice(0, 50);
};

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.dismiss().catch(() => {}));   // an alert() here IS the bug

  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(`var _seq=0;\nwindow.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'u1',email:'pm@example.com'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'pm@example.com'}}},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(name){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},order:function(){return q;},limit:function(){return q;},ilike:function(){return q;},
      in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      insert:function(r){var rows=(Array.isArray(r)?r:[r]).map(function(x,i){return Object.assign({},x,{id:x.id||('prop-new-'+(++_seq))});});
        var p=Promise.resolve({data:rows,error:null});
        p.select=function(){var q2=Promise.resolve({data:rows,error:null});q2.single=function(){return Promise.resolve({data:rows[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=(Array.isArray(r)?r:[r]);
        var p=Promise.resolve({data:rows,error:null});
        p.select=function(){var q2=Promise.resolve({data:rows,error:null});q2.single=function(){return Promise.resolve({data:rows[0],error:null});};return q2;};return p;},
      update:function(){var p=Promise.resolve({data:[],error:null});p.eq=function(){return p;};p.select=function(){return p;};return p;},
      delete:function(){return {eq:function(){return Promise.resolve({error:null});}};},
      then:function(f){return Promise.resolve({data:((window.__tables||{})[name]||[]).slice(),error:null}).then(f);}};return q;},
    storage:{from:function(){return {upload:function(){return Promise.resolve({data:{path:'x'},error:null});},
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nOrphaned acquisition — the repair, walked\n' + '='.repeat(60));

  // Build the exact broken state: a converted review whose property is gone.
  // Nothing is written to a database — this is the page's own in-memory state,
  // the same shape loadProperties()/_loadAcqReviews() produce.
  const ORPHAN_ID = 'rev-harborview';
  //
  // BARE identifiers, never window.X. _props, _propsLoadedOk and _acqReviews are
  // top-level `let` in a classic script, which puts them in the global LEXICAL
  // environment — they are not properties of window. `window._props = []`
  // creates a second, unrelated object that the application never reads, and
  // the first run of this test "passed" its opening assertions on state it had
  // not actually set. page.evaluate runs in the same realm, so an unqualified
  // assignment resolves to the real binding.
  const setup = await page.evaluate((rid) => {
    if (typeof _acqOrphaned !== 'function') return { missing: '_acqOrphaned' };
    _props = [];                 // not in the active portfolio
    _propsLoadedOk = true;       // ...and we know that, because the load worked
    // AND not in the archived list either — which is what makes it deleted
    // rather than archived. _acqPropertyState() answers 'unknown' while this is
    // null, deliberately: an archived property is not a missing one, and
    // reporting one as the other is how archiving Lakeview announced that its
    // property had been deleted. [] means "read, and it is not in there".
    _archivedProps = [];
    _acqReviews = [{
      id: rid, name: 'Harborview Retail Center', status: 'converted',
      created_at: '2026-01-14T10:00:00.000Z',
      data: {
        totalSqFt: 32000,
        tenants: [{ id: 't-coastal', tenant_name: 'Coastal Outfitters', leased_sqft: 4200 },
                  { id: 't-harbor',  tenant_name: 'Harbor Cafe',       leased_sqft: 1800 }],
        invoices: [{ vendor: 'Atlas Landscaping', amount: 18400 }],
        analysis: { summary: { revenueAtRisk: 41200 }, topRisks: ['Cap ambiguity in Section 7.3'],
                    rentRoll: { occupancy: 0.81, walt: 3.4 } },
        conversionRecord: { propertyId: 'prop-gone-0001', propertyName: 'Harborview Retail Center',
                            convertedAt: '2026-01-20T09:00:00.000Z' },
      },
    }];
    _renderAcqSection(_acqReviews);
    return { orphan: _acqOrphaned(_acqReviews[0]), reviewsLen: _acqReviews.length };
  }, ORPHAN_ID);

  check('the app exposes an orphan predicate', !setup.missing, setup.missing || 'ok');
  // Proof the setup wrote to the REAL binding rather than a lookalike on window.
  check('the harness reached the application\'s own review list', setup.reviewsLen === 1,
        String(setup.reviewsLen));
  check('a converted review with a missing property is detected as orphaned', setup.orphan === true);

  // ── the card ─────────────────────────────────────────────────────────────
  const card = await page.evaluate(() => {
    const c = document.querySelector('#acqReviewsGrid .acq-card');
    return c ? { text: (c.innerText || '').replace(/\s+/g, ' ').trim(),
                 chip: (c.querySelector('.acq-card-status') || {}).className || '' } : null;
  });
  check('the review card says the property no longer exists',
        !!card && /no longer exists/i.test(card.text), card ? card.text : 'no card');
  check('and the card does not present a healthy "Converted"',
        !!card && /orphaned/.test(card.chip), card ? card.chip : '');

  // ── P5-6A: a raw-only orphan is a closed record, offered nothing ─────────
  // Harborview on the Pilot is exactly this: raw extracted rows, no leasehold.
  // Before P5-6A the screen offered Convert Again, disabled until the
  // extractions were resolved. A converted review is frozen now, so there is
  // nothing to resolve them INTO: the unmatched entries are listed, read-only.
  await page.evaluate((rid) => { window.__tables = {}; selectAcquisitionReview(rid); }, ORPHAN_ID);
  await page.waitForTimeout(900);
  const rawOnly = await page.evaluate(() => ({
    action: ((document.getElementById('acqConvertAction') || {}).innerText || '').replace(/\s+/g, ' '),
    convertBtn: !!document.querySelector('#acqConvertAction .acq-convert-btn'),
    frozen: document.getElementById('acqDetailPanel').classList.contains('acq-frozen'),
    unmatched: document.querySelectorAll('#acqTermsList .acq-um-open').length,
    umControls: document.querySelectorAll('#acqTermsList .acq-um-new, #acqTermsList .acq-um-dismiss, #acqTermsList .acq-um-match').length }));
  check('P5-6A: a raw-only orphan is closed — no Convert Again, its 2 extractions listed with nothing to resolve them into',
        rawOnly.frozen && !rawOnly.convertBtn && /read-only/i.test(rawOnly.action) && rawOnly.unmatched === 2 && rawOnly.umControls === 0,
        JSON.stringify([rawOnly.frozen, rawOnly.convertBtn, rawOnly.unmatched, rawOnly.umControls, rawOnly.action.slice(0, 100)]));

  // The same review with its leases on file, each in its leasehold — the
  // state a resolved review is in. Before P5-6A this is where the repair ran.
  await page.evaluate(async (rid) => {
    const fam = (id, label) => ({ id, review_id: rid, user_id: 'u1', label, tenant_hint: label, family_kind: 'lease', created_at: '2026-01-14T10:00:00.000Z' });
    const doc = (id, fid, produced, file) => ({ id, review_id: rid, user_id: 'u1', intake_id: 'ik-' + id, file_name: file, intake_kind: 'lease',
      parsing_status: 'success', produced_kind: 'tenant', produced_id: produced, doc_type: 'original_lease', doc_type_status: 'confirmed',
      family_id: fid, family_status: 'confirmed', created_at: '2026-01-14T10:00:00.000Z' });
    window.__tables = {
      acquisition_document_families: [fam('fam-coastal', 'Coastal Outfitters'), fam('fam-harbor', 'Harbor Cafe')],
      acquisition_documents: [doc('doc-coastal', 'fam-coastal', 't-coastal', 'Coastal_Outfitters_Lease.pdf'),
                              doc('doc-harbor', 'fam-harbor', 't-harbor', 'Harbor_Cafe_Lease.pdf')],
    };
    _acqFamilies.delete(rid); _acqDocs.delete(rid); _acqDecisions.delete(rid); _acqEvidenceLoaded.delete(rid);
    await _acqEnsureRecord(rid);
  }, ORPHAN_ID);

  // ── open it: the truth is told, and nothing is offered ───────────────────
  await page.evaluate((rid) => selectAcquisitionReview(rid), ORPHAN_ID);
  await page.waitForTimeout(700);

  const detail = await page.evaluate(() => ({
    badge: (document.getElementById('acqDetailBadge') || {}).textContent || '',
    action: (document.getElementById('acqConvertAction') || {}).innerText || '',
    actionHtml: (document.getElementById('acqConvertAction') || {}).innerHTML || '',
    notice: ((document.getElementById('acqFrozenNotice') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    noticeShown: getComputedStyle(document.getElementById('acqFrozenNotice')).display !== 'none',
    analysisRendered: ((document.getElementById('acqReportContainer') || {}).innerHTML || '').length > 50,
    termRows: document.querySelectorAll('#acqTermsList .acq-lm-row').length,
  }));
  check('the detail badge states the orphaned state, not just "converted"',
        /no longer exists/i.test(detail.badge), detail.badge);
  check('the analysis is still rendered — nothing was lost with the property',
        detail.analysisRendered);
  check('P5-6A: the closed-acquisition notice is shown', detail.noticeShown && /This acquisition is closed\. Its record is read-only\./.test(detail.notice), detail.notice.slice(0, 90));
  check('P5-6A: the action area says the property is gone and the record is kept read-only — NO "Convert Again"',
        /no longer exists/i.test(detail.action) && /read-only/i.test(detail.action) && !/convert again/i.test(detail.action) && !/acq-convert-btn/.test(detail.actionHtml),
        detail.action.replace(/\s+/g, ' ').slice(0, 120));
  check('P5-6A: the two leaseholds are still drawn, read-only', detail.termRows === 2, String(detail.termRows));

  const clicked = await page.evaluate(CLICK_LABEL, 'convert again');
  check('P5-6A: there is no Convert Again to find by its label', clicked === null, clicked || 'none');

  // ── a conversion attempt is refused before anything is built ─────────────
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); });
  const before = await page.evaluate(() => JSON.stringify(_acqReviews[0]));
  await page.evaluate(() => { window.__toasts = []; const o = window.showToast; window.showToast = function (m, x) { window.__toasts.push(String(m)); return o ? o(m, x) : undefined; }; });
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => {
    const r = _acqReviews[0], d = r.data || {};
    return {
      propCount: (_props || []).length,
      recordId: d.conversionRecord ? d.conversionRecord.propertyId : null,
      historyLen: (d.conversionHistory || []).length,
      reviewName: r.name,
      status: r.status,
      analysisIntact: !!(d.analysis && d.analysis.summary && d.analysis.summary.revenueAtRisk === 41200),
      tenantsIntact: (d.tenants || []).length === 2,
      topRisksIntact: (d.analysis && d.analysis.topRisks || []).length === 1,
      row: JSON.stringify(r),
      modalOpen: (document.getElementById('acqConvertModal') || {}).style.display === 'flex',
      toasts: window.__toasts.slice(),
    };
  });

  check('P5-6A: the conversion is refused with the one sentence, not with an alert', after.toasts.some(t => /This acquisition is closed\. Its record is read-only\./.test(t)) && dialogs.length === 0,
        (after.toasts.join(' | ') || 'no toast') + (dialogs.length ? ' | dialogs: ' + dialogs.join(' | ') : ''));
  check('P5-6A: no property is built', after.propCount === 0, String(after.propCount));
  check('P5-6A: the review is untouched — still converted, still naming the deleted property, no conversion history written',
        after.row === before && after.status === 'converted' && after.recordId === 'prop-gone-0001' && after.historyLen === 0, JSON.stringify([after.status, after.recordId, after.historyLen]));
  check('and the modal is closed', !after.modalOpen);

  // "Preserving the original acquisition review and analysis" is still the requirement.
  check('the original analysis survived', after.analysisIntact);
  check('the extracted tenants survived',  after.tenantsIntact);
  check('the risk findings survived',      after.topRisksIntact);

  // ── the orphan stays an orphan, and stays closed ─────────────────────────
  const still = await page.evaluate(() => {
    const r = _acqReviews[0];
    return { orphanNow: _acqOrphaned(r), frozen: _acqFrozen(r) };
  });
  check('P5-6A: the review is still orphaned (nothing pretended to repair it) and still frozen', still.orphanNow === true && still.frozen === true, JSON.stringify(still));

  dialogs.length = 0;
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(900);
  check('a second attempt is refused the same way, without a dialog', dialogs.length === 0, dialogs.join(' | ') || 'no dialog');
  const propsAfterSecond = await page.evaluate(() => (_props || []).length);
  check('and still no property was created', propsAfterSecond === 0, String(propsAfterSecond));

  // ── the false positive: a FAILED load must never look like a deletion ────
  const blip = await page.evaluate(() => {
    _props = [];
    _archivedProps = [];
    _propsLoadedOk = false;   // the load failed; we know nothing
    const r = { id: 'x', name: 'Somewhere', status: 'converted',
                data: { conversionRecord: { propertyId: 'prop-real-9999' } } };
    _renderAcqSection([r]);
    return { orphan: _acqOrphaned(r),
             cardText: (document.querySelector('#acqReviewsGrid .acq-card') || {}).innerText || '' };
  });
  check('a failed properties load does NOT report properties as deleted', blip.orphan === false);

  // The other way to be ignorant: properties loaded fine, but the archived list
  // has not come back. Not-in-_props is then either archived or deleted, and
  // guessing produces the Lakeview report — "property no longer exists" about a
  // property that was merely archived.
  // Caught inside the page: without the 'unknown' gate this throws on
  // _archivedProps.some(), and an uncaught throw kills the run with a stack
  // trace instead of reporting which invariant broke. A test that crashes is a
  // test whose result nobody reads.
  const unread = await page.evaluate(() => {
    try {
      _props = [];
      _propsLoadedOk = true;
      _archivedProps = null;        // never read
      const r = { id: 'y', name: 'Lakeview', status: 'converted',
                  data: { conversionRecord: { propertyId: 'prop-arch-1' } } };
      return { state: _acqPropertyState(r), orphan: _acqOrphaned(r) };
    } catch (e) { return { threw: String(e.message).split('\n')[0] }; }
  });
  check('an unread archived list is "unknown", not "missing"',
        unread.state === 'unknown', unread.threw ? 'threw: ' + unread.threw : unread.state);
  check('and nothing is reported as deleted on that basis',
        unread.orphan === false, unread.threw ? 'threw: ' + unread.threw : String(unread.orphan));
  check('and the card says nothing about a missing property',
        !/no longer exists/i.test(blip.cardText), blip.cardText.replace(/\s+/g, ' ').slice(0, 70));

  check('no uncaught errors during the repair', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(60));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
