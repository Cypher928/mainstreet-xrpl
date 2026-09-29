// test-e2e-acquisition-workspace.js
// ============================================================================
// Acquisition Review Phase 1, increment P1-1 — walked in the real page.
//
// What must hold, in the order a manager would meet it:
//
//   1. A review stored before stages existed opens with its stage derived
//      once and written down, and every value it held is still there.
//   2. The stage chips render under the header; a person can move the review
//      and the move is saved, attributed, and survives the next save (the
//      revision is tracked correctly across writes).
//   3. A review that changed underneath us is NOT overwritten. The save is
//      refused, the stored version is shown, and the user is told.
//   4. A review deleted elsewhere is not kept as a ghost.
//   5. Running the analysis is recorded on the review.
//   6. Converting the review sets it Acquired, locks the chips, and reverting
//      the conversion (the property was deleted) moves it back and says why.
//
// The Supabase stand-in honours the conditional UPDATE the glue now makes —
// filters on id, user_id and updated_at, a trigger-like new updated_at on
// every write — so a mock that always says "ok" cannot pass this.
//
// Run: node test-e2e-acquisition-workspace.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8921;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

// A store-backed stand-in. UPDATE applies only to rows matching EVERY filter
// and stamps a fresh updated_at on each, the way the set_updated_at trigger
// does; the rows it changed come back from .select(). INSERT keeps the caller's
// object (the app relies on that identity). Everything else is the usual slice.
const DB = `
(function(){
  var U = { id: 'u1', email: 'pm@example.com' };
  var STORE = { acquisition_reviews: [], properties: [], tenants: [] };
  var _seq = 0;
  function P(v) { return Promise.resolve(v); }
  function tbl(n) { STORE[n] = STORE[n] || []; return STORE[n]; }
  function q(name) {
    var filters = [], pending = null;
    function rows() { return tbl(name).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); }); }
    function run() {
      if (pending) {
        var changed = rows();
        changed.forEach(function (r) { Object.assign(r, pending); r.updated_at = 'rev-' + (++_seq) + '-' + Date.now(); });
        return P({ data: changed, error: null });
      }
      return P({ data: rows(), error: null });
    }
    var api = {
      select: function () { return api; },
      eq: function (k, v) { filters.push([k, v]); return api; },
      neq: function () { return api; }, is: function () { return api; }, not: function () { return api; },
      in: function () { return api; }, order: function () { return api; }, limit: function () { return api; },
      ilike: function () { return api; },
      single: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: null }; }); },
      maybeSingle: function () { return run().then(function (r) { return { data: (r.data || [])[0] || null, error: null }; }); },
      update: function (patch) { pending = patch; return api; },
      insert: function (r) {
        var arr = Array.isArray(r) ? r : [r];
        arr.forEach(function (x) { if (!x.id) x.id = 'p-' + (++_seq); tbl(name).push(x); });
        var p = P({ data: arr, error: null });
        p.select = function () { var s = P({ data: arr, error: null }); s.single = function () { return P({ data: arr[0], error: null }); }; return s; };
        return p;
      },
      upsert: function (r) {
        var arr = Array.isArray(r) ? r : [r], t = tbl(name);
        arr.forEach(function (x) { var i = t.findIndex(function (y) { return y.id === x.id; }); if (i >= 0) Object.assign(t[i], x); else t.push(x); });
        var p = P({ data: arr, error: null });
        p.select = function () { var s = P({ data: arr, error: null }); s.single = function () { return P({ data: arr[0], error: null }); }; return s; };
        return p;
      },
      delete: function () { return { eq: function (k, v) { STORE[name] = tbl(name).filter(function (x) { return x[k] !== v; }); return P({ error: null }); },
                                     in: function () { return P({ error: null }); } }; },
      then: function (res, rej) { return run().then(res, rej); },
    };
    return api;
  }
  window.__store = STORE;
  window.supabase = { createClient: function () { return {
    auth: {
      getUser: function () { return P({ data: { user: U }, error: null }); },
      getSession: function () { return P({ data: { session: { user: U, access_token: 't' } }, error: null }); },
      onAuthStateChange: function (cb) { setTimeout(function () { try { cb('SIGNED_IN', { user: U }); } catch (_) {} }, 40);
        return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return P({ error: null }); },
    },
    rpc: function () { return P({ data: null, error: null }); },
    from: q,
    storage: { from: function () { return { upload: function () { return P({ data: { path: 'x' }, error: null }); },
                                           getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
  }; } };
})();`;

// Click strictly by visible label, inside the stage row.
const CLICK_CHIP = function (label) {
  var re = new RegExp('^' + label + '$', 'i');
  var els = [].slice.call(document.querySelectorAll('#acqStageChips .acq-stage-chip'));
  var hit = els.filter(function (e) {
    var r = e.getBoundingClientRect(); var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) return false;
    if (e.disabled) return false;
    return re.test((e.innerText || e.textContent || '').trim());
  });
  if (!hit.length) return null;
  hit[0].click();
  return (hit[0].innerText || hit[0].textContent || '').trim();
};

const CHIPS = () => [].slice.call(document.querySelectorAll('#acqStageChips .acq-stage-chip')).map(function (b) {
  return { key: b.getAttribute('data-stage'), label: (b.innerText || b.textContent || '').trim(),
           state: b.classList.contains('current') ? 'current' : b.classList.contains('done') ? 'done' : 'upcoming',
           disabled: !!b.disabled };
});

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
  const errs = [], dialogs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nAcquisition Workspace — record, stage, activity, conflict\n' + '='.repeat(64));

  // Toasts are how the product tells the user; capture them.
  await page.evaluate(() => {
    window.__toasts = [];
    const orig = window.showToast;
    window.showToast = function (m, o) { window.__toasts.push(String(m)); return orig ? orig(m, o) : undefined; };
    const w = document.getElementById('obWelcomeModal');
    if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
  });

  const appVisible = await page.evaluate(() => {
    const a = document.getElementById('appContent');
    return !!a && a.style.display !== 'none' && a.style.display !== '';
  });
  check('the app is shown (mock sign-in fired)', appVisible);

  // ── 1 · a legacy review, loaded from the database ────────────────────────
  const LEGACY_ID = 'aaaaaaaa-1111-4000-b000-000000000001';
  const loaded = await page.evaluate(async (id) => {
    __store.acquisition_reviews.push({
      id, user_id: 'u1', name: 'Harborview Retail Center', status: 'complete',
      created_at: '2026-01-14T10:00:00.000Z', updated_at: 'rev-loaded-1',
      data: {
        tenants:   [{ id: 't1', tenant_name: 'Coastal Outfitters', leased_sqft: '4200', end_date: '2028-12-31' },
                    { id: 't2', tenant_name: 'Harbor Cafe',        leased_sqft: '1800', end_date: '2027-06-30' }],
        invoices:  [{ id: 'i1', vendorName: 'Atlas Landscaping', amount: 18400, category: 'landscaping' }],
        totalSqFt: 32000,
        documents: [],
        analysis:  { summary: { recoveryRate: 71.2, tenantCount: 2, invoiceCount: 1, annualMissedRecovery: 0, capLeakageAnnualized: 0, openAuditWindows: 0, criticalRenewalCount: 0 },
                     topRisks: [], findings: [], underbilling: [], auditWindows: [], renewalRisk: [], proRataRisk: [],
                     tenantSummary: [], rentRoll: null },
      },
    });
    await _loadAcqReviewsAndRender();
    const r = _acqReviews.find(x => x.id === id);
    return {
      found: !!r,
      stage: r && r.data.stage, version: r && r.data.schemaVersion,
      tenants: r && r.data.tenants.length, invoices: r && r.data.invoices.length,
      recovery: r && r.data.analysis && r.data.analysis.summary.recoveryRate,
      activity: r && Array.isArray(r.data.activity) ? r.data.activity.length : -1,
      rev: _acqRevs.get(id) || null,
      storeUntouched: __store.acquisition_reviews[0].data.stage === undefined,
    };
  }, LEGACY_ID);
  check('the legacy review is loaded', loaded.found);
  check('it is upgraded to v2 in memory', loaded.version === 2, String(loaded.version));
  check('its stage is derived once — analysis on file ⇒ Report', loaded.stage === 'report', loaded.stage);
  check('tenants, invoices and analysis all survive', loaded.tenants === 2 && loaded.invoices === 1 && loaded.recovery === 71.2,
        JSON.stringify([loaded.tenants, loaded.invoices, loaded.recovery]));
  check('it starts with an empty activity record, not an invented one', loaded.activity === 0, String(loaded.activity));
  check('the revision it was read at is remembered', loaded.rev === 'rev-loaded-1', String(loaded.rev));
  check('loading writes nothing back — upgrade is applied in memory until the next real change', loaded.storeUntouched);

  // ── 2 · the stage chips ──────────────────────────────────────────────────
  await page.evaluate((id) => selectAcquisitionReview(id), LEGACY_ID);
  await page.waitForTimeout(400);
  const chips = await page.evaluate(CHIPS);
  check('six stage chips render under the header', chips.length === 6, chips.map(c => c.label).join(' › '));
  check('Report is current; Intake, Abstraction, Financials, Review are done',
        chips.map(c => c.state).join(',') === 'done,done,done,done,current,upcoming', chips.map(c => c.state).join(','));
  check('Acquired is disabled — the acquisition sets it', !!chips[5] && chips[5].disabled && chips[5].key === 'acquired');
  check('the other chips are clickable', chips.slice(0, 5).every(c => !c.disabled));

  const moved = await page.evaluate(CLICK_CHIP, 'Financials');
  check('a person can move the review by clicking a stage', moved === 'Financials', moved || 'not found');
  await page.waitForTimeout(400);
  const afterMove = await page.evaluate((id) => {
    const row = __store.acquisition_reviews.find(x => x.id === id);
    const mem = _acqReviews.find(x => x.id === id);
    const a = (row.data.activity || []);
    return { storedStage: row.data.stage, memStage: mem.data.stage, chips: CHIPS_INLINE(),
             lastType: a.length ? a[a.length - 1].type : null, lastMeta: a.length ? a[a.length - 1].meta : null,
             lastActor: a.length ? a[a.length - 1].actor : null, storedVersion: row.data.schemaVersion,
             rev: _acqRevs.get(id), storeRev: row.updated_at, toasts: window.__toasts.slice() };
    function CHIPS_INLINE() { return [].slice.call(document.querySelectorAll('#acqStageChips .acq-stage-chip.current')).map(b => b.getAttribute('data-stage')); }
  }, LEGACY_ID);
  check('the move is SAVED — the stored row now reads Financials', afterMove.storedStage === 'financials', String(afterMove.storedStage));
  check('the stored row is now at v2 (the upgrade lands with the first real change)', afterMove.storedVersion === 2);
  check('the chip row shows Financials as current', afterMove.chips.join() === 'financials', afterMove.chips.join());
  check('the move is recorded as activity with from/to', afterMove.lastType === 'stage_changed'
        && afterMove.lastMeta && afterMove.lastMeta.from === 'report' && afterMove.lastMeta.to === 'financials',
        JSON.stringify([afterMove.lastType, afterMove.lastMeta]));
  check('and attributed to the signed-in person', !!afterMove.lastActor && afterMove.lastActor.email === 'pm@example.com', JSON.stringify(afterMove.lastActor));
  check('the new revision is remembered so the NEXT save is conditional on it',
        afterMove.rev && afterMove.rev === afterMove.storeRev && afterMove.rev !== 'rev-loaded-1', `${afterMove.rev} vs ${afterMove.storeRev}`);
  check('no conflict was reported for an ordinary save', !afterMove.toasts.some(t => /changed elsewhere|deleted elsewhere/.test(t)), afterMove.toasts.join(' | '));

  // A second move must succeed too — proves the revision was tracked across writes.
  await page.evaluate(CLICK_CHIP, 'Review');
  await page.waitForTimeout(400);
  const second = await page.evaluate((id) => {
    const row = __store.acquisition_reviews.find(x => x.id === id);
    return { stage: row.data.stage, activity: row.data.activity.length, toasts: window.__toasts.slice() };
  }, LEGACY_ID);
  check('a second move saves against the revision the first one returned', second.stage === 'review' && second.activity === 2,
        JSON.stringify(second));

  // ── 3 · changed underneath us ────────────────────────────────────────────
  const conflict = await page.evaluate(async (id) => {
    window.__toasts = [];
    // Another tab saved: a new revision, a different name and stage.
    const row = __store.acquisition_reviews.find(x => x.id === id);
    row.updated_at = 'rev-external-9';
    row.name = 'Harborview — renamed elsewhere';
    row.data = Object.assign({}, row.data, { stage: 'abstraction' });
    const storedBefore = JSON.stringify(row.data);
    // This tab tries to move to Report.
    acqSetStage('report');
    await new Promise(r => setTimeout(r, 500));
    const after = __store.acquisition_reviews.find(x => x.id === id);
    const mem = _acqReviews.find(x => x.id === id);
    return {
      storedStage: after.data.stage, storedUnchanged: JSON.stringify(after.data) === storedBefore,
      storedRev: after.updated_at,
      memName: mem && mem.name, memStage: mem && mem.data.stage,
      title: (document.getElementById('acqDetailTitle') || {}).textContent,
      current: [].slice.call(document.querySelectorAll('#acqStageChips .acq-stage-chip.current')).map(b => b.getAttribute('data-stage')).join(),
      toasts: window.__toasts.slice(), rev: _acqRevs.get(id),
    };
  }, LEGACY_ID);
  check('the stored row is NOT overwritten by a stale client', conflict.storedStage === 'abstraction' && conflict.storedUnchanged,
        `stored stage ${conflict.storedStage}`);
  check('the stored revision is untouched — no write happened', conflict.storedRev === 'rev-external-9', String(conflict.storedRev));
  check('the user is told their change was not saved', conflict.toasts.some(t => /changed elsewhere/.test(t) && /not saved/.test(t)),
        conflict.toasts.join(' | ') || 'no toast');
  check('the latest stored version replaces the local one', conflict.memName === 'Harborview — renamed elsewhere' && conflict.memStage === 'abstraction',
        `${conflict.memName} / ${conflict.memStage}`);
  check('the open panel re-renders from it (title and current stage)',
        /renamed elsewhere/.test(conflict.title || '') && conflict.current === 'abstraction', `${conflict.title} / ${conflict.current}`);
  check('and the external revision is now the one we hold', conflict.rev === 'rev-external-9', String(conflict.rev));

  // ── 4 · deleted elsewhere ────────────────────────────────────────────────
  const gone = await page.evaluate(async (id) => {
    window.__toasts = [];
    __store.acquisition_reviews = __store.acquisition_reviews.filter(x => x.id !== id);
    acqSetStage('report');
    await new Promise(r => setTimeout(r, 500));
    return {
      inMemory: _acqReviews.some(x => x.id === id),
      panelHidden: (document.getElementById('acqDetailPanel') || {}).style.display === 'none',
      toasts: window.__toasts.slice(),
    };
  }, LEGACY_ID);
  check('a review deleted elsewhere is removed here, not kept as a ghost', gone.inMemory === false);
  check('its panel closes', gone.panelHidden);
  check('and the user is told', gone.toasts.some(t => /deleted elsewhere/.test(t)), gone.toasts.join(' | ') || 'no toast');

  // ── 5 · analysis is recorded ─────────────────────────────────────────────
  const NEW_ID = 'aaaaaaaa-2222-4000-b000-000000000002';
  const analysed = await page.evaluate(async (id) => {
    window.__toasts = [];
    __store.acquisition_reviews.push({
      id, user_id: 'u1', name: 'Lakeview Plaza', status: 'draft',
      created_at: '2026-03-01T10:00:00.000Z', updated_at: 'rev-lakeview-1',
      data: { tenants: [{ id: 't1', tenant_name: 'Coastal Outfitters', leased_sqft: '4200', end_date: '2028-12-31', cam_cap: 5, capBaseAmount: 4000 }],
              invoices: [{ id: 'i1', vendorName: 'Atlas Landscaping', amount: 18400, category: 'landscaping' }],
              totalSqFt: 12000, documents: [], analysis: null },
    });
    // Option B: only a leasehold is a tenant. The lease that produced t1 is on
    // file and filed into its leasehold, so t1 is represented, not unmatched.
    (__store.acquisition_document_families = __store.acquisition_document_families || []).push({
      id: 'fam-coastal', review_id: id, user_id: 'u1', label: 'Coastal Outfitters', tenant_hint: 'Coastal Outfitters',
      family_kind: 'lease', created_at: '2026-03-01T10:00:00.000Z' });
    (__store.acquisition_documents = __store.acquisition_documents || []).push({
      id: 'doc-coastal', review_id: id, user_id: 'u1', intake_id: 'ik-coastal', file_name: 'Coastal_Outfitters_Lease.pdf',
      intake_kind: 'lease', parsing_status: 'success', produced_kind: 'tenant', produced_id: 't1',
      doc_type: 'original_lease', doc_type_status: 'confirmed', family_id: 'fam-coastal', family_status: 'confirmed',
      created_at: '2026-03-01T10:00:00.000Z' });
    await _loadAcqReviewsAndRender();
    selectAcquisitionReview(id);
    const before = _acqReviews.find(x => x.id === id).data.stage;
    await runAcquisitionAnalysis();
    await new Promise(r => setTimeout(r, 300));
    const row = __store.acquisition_reviews.find(x => x.id === id);
    const a = row.data.activity || [];
    return { before, status: row.status, hasAnalysis: !!(row.data.analysis && row.data.analysis.summary),
             lastType: a.length ? a[a.length - 1].type : null, stageAfter: row.data.stage,
             badge: (document.getElementById('acqDetailBadge') || {}).textContent, toasts: window.__toasts.slice() };
  }, NEW_ID);
  check('a draft with leases and invoices derives to Abstraction', analysed.before === 'abstraction', analysed.before);
  check('running the analysis completes the review and stores the report', analysed.status === 'complete' && analysed.hasAnalysis && analysed.badge === 'complete');
  check('the run is recorded on the review', analysed.lastType === 'analysis_run', String(analysed.lastType));
  check('running the analysis does not move the stage on its own — that is a decision, not a side effect',
        analysed.stageAfter === 'abstraction', analysed.stageAfter);
  check('and it saved without conflict', !analysed.toasts.some(t => /elsewhere|save failed/i.test(t)), analysed.toasts.join(' | '));

  // ── 6 · acquired, then reverted ──────────────────────────────────────────
  const converted = await page.evaluate(async (id) => {
    window.__toasts = [];
    _props = []; _propsLoadedOk = true; _archivedProps = [];
    await convertAcquisitionToProperty();
    await new Promise(r => setTimeout(r, 300));
    const row = __store.acquisition_reviews.find(x => x.id === id);
    const a = row.data.activity || [];
    const chips = [].slice.call(document.querySelectorAll('#acqStageChips .acq-stage-chip')).map(b => ({ k: b.getAttribute('data-stage'), cur: b.classList.contains('current'), dis: !!b.disabled }));
    return { status: row.status, stage: row.data.stage, propertyId: row.data.conversionRecord && row.data.conversionRecord.propertyId,
             lastType: a.length ? a[a.length - 1].type : null, lastPid: a.length && a[a.length - 1].meta ? a[a.length - 1].meta.propertyId : null,
             chips, note: (document.getElementById('acqStageChips') || {}).innerText || '', props: _props.length, toasts: window.__toasts.slice() };
  }, NEW_ID);
  check('converting the review creates the property and marks it converted', converted.status === 'converted' && converted.props === 1 && !!converted.propertyId,
        JSON.stringify([converted.status, converted.props, converted.propertyId]));
  check('the stage becomes Acquired and is stored', converted.stage === 'acquired', converted.stage);
  check('the conversion is recorded, naming the property', converted.lastType === 'converted' && converted.lastPid === converted.propertyId,
        JSON.stringify([converted.lastType, converted.lastPid]));
  check('every chip is locked and Acquired is current', converted.chips.every(c => c.dis) && converted.chips.some(c => c.k === 'acquired' && c.cur),
        JSON.stringify(converted.chips));
  check('the row says why', /stage is fixed/i.test(converted.note), converted.note.replace(/\s+/g, ' ').slice(0, 80));

  // ── 6a · P5-6A: the converted review is FROZEN on screen ─────────────────
  // The panel is redrawn as the product does it (re-open the review), then
  // every control is looked for, and every entry point is called directly —
  // the way a stale tab, a keyboard or a console would — and must write nothing.
  const frozenUI = await page.evaluate(async (id) => {
    window.__toasts = [];
    selectAcquisitionReview(id);
    await new Promise(r => setTimeout(r, 400));
    // A record a legacy episode could hold: a proposed, unfiled, readable
    // document and a raw extracted row with no document — in memory only.
    const rev = _acqReviews.find(x => x.id === id);
    rev.data.tenants.push({ id: 't-late', tenant_name: 'Late Row', leased_sqft: '900', _status: 'ok' });
    (_acqDocs.get(id) || []).push({ id: 'doc-late', review_id: id, user_id: 'u1', intake_id: 'ik-late', file_name: 'Late_Amendment.pdf', intake_kind: 'lease',
      parsing_status: 'success', doc_type: 'amendment', doc_type_status: 'proposed', doc_type_source: 'ai', family_id: null, family_status: 'unfiled',
      classification_history: [], created_at: '2026-03-02T10:00:00.000Z' });
    _renderAcqDocuments();   // documents, and the Lease Matrix with its unmatched list
    await new Promise(r => setTimeout(r, 200));
    const q = (s) => document.querySelectorAll('#acqDetailPanel ' + s).length;
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
    const notice = document.getElementById('acqFrozenNotice');
    const um = { umControls: q('.acq-um-new') + q('.acq-um-dismiss') + q('.acq-um-match') + q('.acq-um-reopen') + q('.acq-um-docs'), umShown: q('.acq-um-open') };
    acqOpenLeasehold('fam-coastal');   // the leasehold's record, where the five acts would be drawn
    await new Promise(r => setTimeout(r, 100));
    return Object.assign(um, {
      panelFrozen: document.getElementById('acqDetailPanel').classList.contains('acq-frozen'),
      notice: vis(notice) ? notice.textContent.replace(/\s+/g, ' ').trim() : null,
      termActs: q('.acq-term-confirm') + q('.acq-term-correct') + q('.acq-term-reject') + q('.acq-term-reopen') + q('.acq-term-enter'),
      termRows: q('.acq-term-row'),
      evidenceNote: (document.querySelector('#acqTermsList .acq-lh-evidence-note') || {}).textContent || '',
      docControls: q('select.acq-doc-type') + q('.acq-doc-confirm') + q('.acq-doc-reabstract') + q('.acq-doc-begin') + q('.acq-doc-confirm-family') + q('.acq-doc-match') + q('.acq-doc-dispose') + q('.acq-doc-undispose'),
      docRows: q('.acq-doc-row'), fixedTypes: q('.acq-doc-type-fixed'),
      lateDocShown: !!document.querySelector('#acqDocsList .acq-doc-row[data-doc-id="doc-late"]'),
      lateDocWhy: (document.querySelector('#acqDocsList .acq-doc-row[data-doc-id="doc-late"] .acq-doc-place-why') || {}).textContent || '',
      uploadsVisible: [].slice.call(document.querySelectorAll('#acqDetailPanel .acq-upload-btn')).filter(vis).length,
      deleteVisible: vis(document.getElementById('acqDeleteBtn')),
      analyzeVisible: vis(document.querySelector('#acqDetailPanel .acq-analyze-bar')),
      analyzeDisabled: document.getElementById('acqAnalyzeBtn').disabled,
      analyzeNote: (document.getElementById('acqAnalyzeNote') || {}).textContent,
      staleVisible: vis(document.getElementById('acqStaleNotice')),
      chips: document.querySelectorAll('#acqStageChips .acq-stage-chip').length,
      chipsEnabled: [].slice.call(document.querySelectorAll('#acqStageChips .acq-stage-chip')).filter(b => !b.disabled).length,
      convertLink: !!document.querySelector('#acqConvertAction .acq-converted-link'),
      report: !!document.querySelector('#acqReportContainer') && document.getElementById('acqReportContainer').innerHTML.length > 0,
    });
  }, NEW_ID);
  check('P5-6A: the panel is dressed read-only and the notice says the acquisition is closed',
        frozenUI.panelFrozen && /This acquisition is closed\. Its record is read-only\./.test(frozenUI.notice || '') && /Acquired /.test(frozenUI.notice || ''), String(frozenUI.notice));
  check('P5-6A: the leasehold\'s terms are all drawn, and not one Confirm / Correct / Reject / Reopen / Enter; the evidence note says the record is closed',
        frozenUI.termRows > 0 && frozenUI.termActs === 0 && /This record is closed/.test(frozenUI.evidenceNote), JSON.stringify([frozenUI.termRows, frozenUI.termActs, frozenUI.evidenceNote.slice(-40)]));
  check('P5-6A: every document is drawn with its type fixed, and no type select, Confirm, Read terms, begin, confirm-leasehold, match, disposition or Undo',
        frozenUI.docRows === 2 && frozenUI.fixedTypes === 2 && frozenUI.docControls === 0, JSON.stringify([frozenUI.docRows, frozenUI.fixedTypes, frozenUI.docControls]));
  check('P5-6A: a document left pending is named as left at acquisition, with nothing to do', frozenUI.lateDocShown && /Left unresolved at acquisition/.test(frozenUI.lateDocWhy), frozenUI.lateDocWhy.slice(0, 80));
  check('P5-6A: an unmatched extraction is listed and offers no match / new leasehold / not a tenant / undo', frozenUI.umShown === 1 && frozenUI.umControls === 0, JSON.stringify([frozenUI.umShown, frozenUI.umControls]));
  check('P5-6A: Upload Leases, Upload Invoices, Delete and Run Analysis are gone; the button is disabled underneath and says why',
        frozenUI.uploadsVisible === 0 && !frozenUI.deleteVisible && !frozenUI.analyzeVisible && frozenUI.analyzeDisabled && /read-only/.test(frozenUI.analyzeNote || ''),
        JSON.stringify([frozenUI.uploadsVisible, frozenUI.deleteVisible, frozenUI.analyzeVisible, frozenUI.analyzeDisabled, frozenUI.analyzeNote]));
  check('P5-6A: no "analysis out of date" notice invites a refresh (a raw row was added; the record is the record)', !frozenUI.staleVisible);
  check('P5-6A: what stays — the stage chips (all locked), the Converted → Open Property link, the report', frozenUI.chips === 6 && frozenUI.chipsEnabled === 0 && frozenUI.convertLink && frozenUI.report, JSON.stringify([frozenUI.chips, frozenUI.chipsEnabled, frozenUI.convertLink, frozenUI.report]));

  const frozenWrites = await page.evaluate(async (id) => {
    window.__toasts = [];
    const S = window.__store;
    S.acquisition_term_decisions = S.acquisition_term_decisions || [];
    const before = {
      row: JSON.stringify(S.acquisition_reviews.find(x => x.id === id)),
      decs: S.acquisition_term_decisions.length, docs: S.acquisition_documents.length, fams: S.acquisition_document_families.length,
      props: _props.length, sqft: _acqReviews.find(x => x.id === id).data.totalSqFt,
    };
    const results = {};
    // the five acts
    window.prompt = () => '777';
    results.confirm = await acqConfirmTerm('fam-coastal', 'leased_sqft');
    results.correct = await acqCorrectTerm('fam-coastal', 'leased_sqft');
    results.reject  = await acqRejectTerm('fam-coastal', 'tenant_name');
    results.enter   = await acqEnterTerm('fam-coastal', 'security_deposit');
    results.decision = await _acqSaveDecision({ familyId: 'fam-coastal', fieldKey: 'leased_sqft', action: 'confirm', newValue: '4200' }, { value: 4200 });
    // documents, families, analysis, uploads, sqft, dispositions, extractions, delete, convert-again
    results.doc    = await _acqSaveDocument({ reviewId: id, intakeId: 'ik-x', fileName: 'x.pdf', intakeKind: 'lease' });
    results.retype = await acqSetDocType('doc-coastal', 'amendment');
    results.read   = await acqReabstractDocument('doc-coastal');
    results.fam    = await _acqSaveFamily(id, { label: 'Late Leasehold', tenantHint: 'Late', familyKind: 'lease' });
    results.refresh = await _acqRefreshAnalysis(id);
    await runAcquisitionAnalysis();
    await acqHandleLeaseFiles([new File(['x'], 'late.pdf', { type: 'application/pdf' })]);
    await acqHandleInvoiceFiles([new File(['x'], 'inv.pdf', { type: 'application/pdf' })]);
    acqSaveSqft('999');
    results.dispose = await acqSetDocDisposition('doc-late', 'not_relevant');
    results.resolve = await acqResolveExtraction('t-late', 'dismissed');
    results.reopen  = await acqReopenExtraction('t-late');
    window.confirm = () => { results.confirmAsked = true; return true; };
    await deleteActiveAcquisitionReview();
    await convertAcquisitionToProperty();
    await new Promise(r => setTimeout(r, 400));
    const after = {
      row: JSON.stringify(S.acquisition_reviews.find(x => x.id === id)),
      decs: S.acquisition_term_decisions.length, docs: S.acquisition_documents.length, fams: S.acquisition_document_families.length,
      props: _props.length, sqft: _acqReviews.find(x => x.id === id).data.totalSqFt,
      sqftField: document.getElementById('acqTotalSqft').value,
      panelOpen: document.getElementById('acqDetailPanel').style.display === 'block',
    };
    return { before, after, results, toasts: window.__toasts.slice(), rowSame: before.row === after.row };
  }, NEW_ID);
  const rz = frozenWrites.results;
  check('P5-6A: the five acts and the decision writer return null and file nothing', rz.confirm == null && rz.correct == null && rz.reject == null && rz.enter == null && rz.decision === null
        && frozenWrites.after.decs === frozenWrites.before.decs, JSON.stringify([rz.confirm, rz.correct, rz.reject, rz.enter, rz.decision, frozenWrites.before.decs, frozenWrites.after.decs]));
  check('P5-6A: document, retype, read, family and upload writes return null and store nothing', rz.doc === null && rz.fam === null && frozenWrites.after.docs === frozenWrites.before.docs && frozenWrites.after.fams === frozenWrites.before.fams,
        JSON.stringify([rz.doc, rz.fam, frozenWrites.before.docs, frozenWrites.after.docs, frozenWrites.before.fams, frozenWrites.after.fams]));
  check('P5-6A: the analysis is not re-run and the stored row is byte-identical after every attempt (no save, no activity, no revision)', rz.refresh === false && frozenWrites.rowSame, frozenWrites.rowSame ? '' : 'ROW CHANGED');
  check('P5-6A: the area is not changed, on the record or in the field', frozenWrites.after.sqft === frozenWrites.before.sqft && String(frozenWrites.after.sqftField) === String(frozenWrites.before.sqft), JSON.stringify([frozenWrites.before.sqft, frozenWrites.after.sqft, frozenWrites.after.sqftField]));
  check('P5-6A: dispositions and extraction resolutions are refused', rz.dispose === false && rz.resolve === false && rz.reopen === false, JSON.stringify([rz.dispose, rz.resolve, rz.reopen]));
  check('P5-6A: Delete never even asks; the review stays and the panel stays open', !rz.confirmAsked && frozenWrites.after.panelOpen && !!JSON.parse(frozenWrites.after.row), JSON.stringify([rz.confirmAsked, frozenWrites.after.panelOpen]));
  check('P5-6A: Convert again builds no property', frozenWrites.after.props === frozenWrites.before.props, JSON.stringify([frozenWrites.before.props, frozenWrites.after.props]));
  check('P5-6A: each refusal tells the person, in the one sentence', frozenWrites.toasts.length >= 10 && frozenWrites.toasts.every(t => /This acquisition is closed\. Its record is read-only\./.test(t)),
        frozenWrites.toasts.length + ' toasts; other: ' + frozenWrites.toasts.filter(t => !/read-only/.test(t)).join(' | '));

  // An orphan — the property this record produced is gone — is still closed, and offered nothing.
  const orphan = await page.evaluate(async (id) => {
    window.__toasts = [];
    const keep = _props.slice();
    _props = []; _propsLoadedOk = true; _archivedProps = [];
    const rev = _acqReviews.find(x => x.id === id);
    _renderAcqConvertAction(rev);
    const html = document.getElementById('acqConvertAction').innerHTML;
    const propsBefore = _props.length;
    await convertAcquisitionToProperty();
    await new Promise(r => setTimeout(r, 300));
    const out = { orphaned: _acqOrphaned(rev), frozenBox: /acq-orphan-frozen/.test(html), readOnly: /read-only/.test(html), convertBtn: /acq-convert-btn|Convert Again/.test(html),
                  propsAfter: _props.length, propsBefore, status: __store.acquisition_reviews.find(x => x.id === id).status, toasts: window.__toasts.slice() };
    _props = keep; _renderAcqConvertAction(rev);
    return out;
  }, NEW_ID);
  check('P5-6A: an orphaned converted review says its property is gone and that the record is kept read-only — no Convert Again',
        orphan.orphaned && orphan.frozenBox && orphan.readOnly && !orphan.convertBtn, JSON.stringify(orphan));
  check('P5-6A: converting the orphan again is refused before any property is built', orphan.propsAfter === orphan.propsBefore && orphan.status === 'converted' && orphan.toasts.some(t => /read-only/.test(t)), JSON.stringify([orphan.propsAfter, orphan.status, orphan.toasts]));

  const lockedTry = await page.evaluate(async (id) => {
    window.__toasts = [];
    const before = __store.acquisition_reviews.find(x => x.id === id).data.stage;
    acqSetStage('intake');
    await new Promise(r => setTimeout(r, 300));
    return { before, after: __store.acquisition_reviews.find(x => x.id === id).data.stage, toasts: window.__toasts.slice() };
  }, NEW_ID);
  check('a stage change on an acquired review is refused and explained',
        lockedTry.after === 'acquired' && lockedTry.toasts.some(t => /acquired/i.test(t) && /fixed/i.test(t)), lockedTry.toasts.join(' | '));

  const reverted = await page.evaluate(async (id) => {
    window.__toasts = [];
    const pid = __store.acquisition_reviews.find(x => x.id === id).data.conversionRecord.propertyId;
    const n = await _revertAcquisitionsForDeletedProperty(pid);
    await new Promise(r => setTimeout(r, 300));
    const row = __store.acquisition_reviews.find(x => x.id === id);
    const a = row.data.activity || [];
    return { n, status: row.status, stage: row.data.stage, record: !!row.data.conversionRecord, history: (row.data.conversionHistory || []).length,
             lastType: a.length ? a[a.length - 1].type : null, lastTo: a.length && a[a.length - 1].meta ? a[a.length - 1].meta.to : null,
             analysisIntact: !!(row.data.analysis && row.data.analysis.summary), toasts: window.__toasts.slice() };
  }, NEW_ID);
  check('reverting the conversion moves the review back to Ready to Convert', reverted.n === 1 && reverted.status === 'complete' && !reverted.record && reverted.history === 1,
        JSON.stringify(reverted));
  check('its stage is re-derived (analysis on file ⇒ Report) and stored', reverted.stage === 'report', reverted.stage);
  check('the revert is recorded with the stage it moved to', reverted.lastType === 'conversion_reverted' && reverted.lastTo === 'report',
        JSON.stringify([reverted.lastType, reverted.lastTo]));
  check('the analysis survives the whole round trip', reverted.analysisIntact);

  // The freeze follows the status, both ways: reverted to complete, the review
  // is open again and the controls return. (On Pilot 034's CHECK refuses this
  // revert; the stand-in has no CHECK, so the client's half is what is proved.)
  const thawed = await page.evaluate(async (id) => {
    selectAcquisitionReview(id);
    await new Promise(r => setTimeout(r, 400));
    acqOpenLeasehold('fam-coastal');
    const q = (s) => document.querySelectorAll('#acqDetailPanel ' + s).length;
    return { frozen: document.getElementById('acqDetailPanel').classList.contains('acq-frozen'),
             notice: getComputedStyle(document.getElementById('acqFrozenNotice')).display,
             acts: q('.acq-term-confirm') + q('.acq-term-enter'), types: q('select.acq-doc-type'), status: _acqReviews.find(x => x.id === id).status };
  }, NEW_ID);
  check('P5-6A: once reverted (status complete) the panel is open again — notice gone, acts and type selects back', !thawed.frozen && thawed.notice === 'none' && thawed.acts > 0 && thawed.types > 0 && thawed.status === 'complete', JSON.stringify(thawed));

  check('no unexpected dialogs', dialogs.length === 0, dialogs.join(' | ') || 'none');
  check('no uncaught errors across the walk', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
