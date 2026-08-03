// test-acq-orphan-repair.js
// ============================================================================
// An acquisition review whose property was deleted must not be a dead end.
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
// This walks the repair through the real UI: render the acquisition section,
// open the orphaned review, click Convert Again by its visible label, and check
// a property comes back with the review and its analysis intact.
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
    from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},order:function(){return q;},limit:function(){return q;},ilike:function(){return q;},
      in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      insert:function(r){var rows=(Array.isArray(r)?r:[r]).map(function(x,i){return Object.assign({},x,{id:x.id||('prop-new-'+(++_seq))});});
        var p=Promise.resolve({data:rows,error:null});
        p.select=function(){var q2=Promise.resolve({data:rows,error:null});q2.single=function(){return Promise.resolve({data:rows[0],error:null});};return q2;};return p;},
      upsert:function(r){var rows=(Array.isArray(r)?r:[r]);
        var p=Promise.resolve({data:rows,error:null});
        p.select=function(){var q2=Promise.resolve({data:rows,error:null});q2.single=function(){return Promise.resolve({data:rows[0],error:null});};return q2;};return p;},
      update:function(){return Promise.resolve({data:null,error:null});},
      delete:function(){return {eq:function(){return Promise.resolve({error:null});}};},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
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
    _props = [];                 // the property was deleted
    _propsLoadedOk = true;       // ...and we know that, because the load worked
    _acqReviews = [{
      id: rid, name: 'Harborview Retail Center', status: 'converted',
      created_at: '2026-01-14T10:00:00.000Z',
      data: {
        totalSqFt: 32000,
        tenants: [{ tenant_name: 'Coastal Outfitters', leased_sqft: 4200 },
                  { tenant_name: 'Harbor Cafe',       leased_sqft: 1800 }],
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

  // ── open it and find the way out ─────────────────────────────────────────
  await page.evaluate((rid) => selectAcquisitionReview(rid), ORPHAN_ID);
  await page.waitForTimeout(700);

  const detail = await page.evaluate(() => ({
    badge: (document.getElementById('acqDetailBadge') || {}).textContent || '',
    action: (document.getElementById('acqConvertAction') || {}).innerText || '',
    analysisRendered: ((document.getElementById('acqReportContainer') || {}).innerHTML || '').length > 50,
  }));
  check('the detail badge states the orphaned state, not just "converted"',
        /no longer exists/i.test(detail.badge), detail.badge);
  check('the analysis is still rendered — nothing was lost with the property',
        detail.analysisRendered);
  check('a "Convert Again" action is offered', /convert again/i.test(detail.action),
        detail.action.replace(/\s+/g, ' ').slice(0, 90));

  const clicked = await page.evaluate(CLICK_LABEL, 'convert again');
  check('Convert Again is findable and clickable by its label', !!clicked, clicked || 'not found');
  await page.waitForTimeout(500);

  const modal = await page.evaluate(() => {
    const m = document.getElementById('acqConvertModal');
    const rep = document.getElementById('acqConvertModalRepair');
    return { open: !!m && m.style.display === 'flex',
             repairShown: !!rep && rep.style.display !== 'none',
             repairText: (rep || {}).textContent || '',
             confirm: (document.getElementById('acqConvertConfirmBtn') || {}).textContent || '' };
  });
  check('the modal explains this is a rebuild, not a first conversion',
        modal.repairShown && /rebuilds it from the same analysis/i.test(modal.repairText),
        modal.repairText.slice(0, 80));
  check('and its confirm button is labelled for the repair', /convert again/i.test(modal.confirm), modal.confirm);

  // ── the guard must NOT fire ──────────────────────────────────────────────
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); });
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(1200);

  check('the duplicate guard does not block the repair',
        !dialogs.some(m => /already been converted/i.test(m)), dialogs.join(' | ') || 'no dialog');

  const after = await page.evaluate(() => {
    const r = _acqReviews[0], d = r.data || {};
    return {
      propCount: (_props || []).length,
      newPropName: (_props || [])[0] ? _props[0].name : null,
      newPropId: (_props || [])[0] ? _props[0].id : null,
      recordId: d.conversionRecord ? d.conversionRecord.propertyId : null,
      historyLen: (d.conversionHistory || []).length,
      historyOldId: (d.conversionHistory || [])[0] ? d.conversionHistory[0].propertyId : null,
      historyReason: (d.conversionHistory || [])[0] ? d.conversionHistory[0].supersededReason : null,
      reviewName: r.name,
      status: r.status,
      analysisIntact: !!(d.analysis && d.analysis.summary && d.analysis.summary.revenueAtRisk === 41200),
      tenantsIntact: (d.tenants || []).length === 2,
      topRisksIntact: (d.analysis && d.analysis.topRisks || []).length === 1,
    };
  });

  check('a property exists again', after.propCount === 1, String(after.propCount));
  check('it is the property this review describes', after.newPropName === 'Harborview Retail Center', after.newPropName);
  check('the review still points at a property that exists',
        after.recordId && after.recordId === after.newPropId, `${after.recordId} vs ${after.newPropId}`);
  check('the review is still named and still converted',
        after.reviewName === 'Harborview Retail Center' && after.status === 'converted',
        `${after.reviewName} / ${after.status}`);

  // "Preserving the original acquisition review and analysis" is the requirement.
  check('the original analysis survived the repair', after.analysisIntact);
  check('the extracted tenants survived the repair',  after.tenantsIntact);
  check('the risk findings survived the repair',      after.topRisksIntact);

  // Nothing important disappears — same rule as the Space workspace.
  check('the superseded conversion is kept, not overwritten', after.historyLen === 1, String(after.historyLen));
  check('and it still names the property that was deleted',
        after.historyOldId === 'prop-gone-0001', after.historyOldId);
  check('and records why it was superseded',
        /no longer exists/i.test(after.historyReason || ''), after.historyReason);

  // ── the state is repaired, so the guard must come back ───────────────────
  const guardBack = await page.evaluate(() => {
    const r = _acqReviews[0];
    return { orphanNow: _acqOrphaned(r) };
  });
  check('the review is no longer orphaned once repaired', guardBack.orphanNow === false);

  dialogs.length = 0;
  await page.evaluate(() => convertAcquisitionToProperty());
  await page.waitForTimeout(900);
  check('duplicate prevention is restored — a second conversion is refused',
        dialogs.some(m => /already been converted/i.test(m)), dialogs.join(' | ') || 'no dialog');
  const propsAfterSecond = await page.evaluate(() => (_props || []).length);
  check('and no duplicate property was created', propsAfterSecond === 1, String(propsAfterSecond));

  // ── the false positive: a FAILED load must never look like a deletion ────
  const blip = await page.evaluate(() => {
    _props = [];
    _propsLoadedOk = false;   // the load failed; we know nothing
    const r = { id: 'x', name: 'Somewhere', status: 'converted',
                data: { conversionRecord: { propertyId: 'prop-real-9999' } } };
    _renderAcqSection([r]);
    return { orphan: _acqOrphaned(r),
             cardText: (document.querySelector('#acqReviewsGrid .acq-card') || {}).innerText || '' };
  });
  check('a failed properties load does NOT report properties as deleted', blip.orphan === false);
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
