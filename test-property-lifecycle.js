// test-property-lifecycle.js
// ============================================================================
// Archive is the normal lifecycle; Delete is the exception.
// ARCHITECTURE_PRINCIPLES §4, §5, §6, §7, §8 — and this suite is what makes
// those enforceable rather than aspirational.
//
// Walked, not asserted from internals: the delete dialog is opened the way a
// user opens it, the buttons are found by their visible labels, and the name is
// typed into the real input.
//
// The four things most likely to regress, in order of how quietly they would do
// it:
//
//   1. Archive stops excluding the property from aggregates — the dashboard
//      keeps counting a building you no longer manage, and nothing looks wrong.
//   2. The Delete dialog stops naming what it will destroy, or stops requiring
//      the name, and an irreversible cascade sits behind one click again.
//   3. Deleting a converted property stops reverting its acquisition, and
//      orphan repair silently becomes the normal path again.
//   4. The revert discards the superseded conversion instead of moving it to
//      history — one `=` where an Object.assign was meant.
//
// Run: node test-property-lifecycle.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8919;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

// A Supabase stand-in that actually stores archived_at, so the active/archived
// filter is exercised rather than assumed. `is('archived_at', null)` and
// `not('archived_at','is',null)` are the two predicates loadProperties uses.
const DB = `
(function(){
  var U={id:'u1',email:'pm@example.com'};
  window.__rows={properties:[],acquisition_reviews:[],tenants:[]};
  var _seq=0;
  function P(v){return Promise.resolve(v);}
  function tbl(n){window.__rows[n]=window.__rows[n]||[];return window.__rows[n];}
  function q(name){
    var eqs=[], isNull=null, notNull=null, single=false;
    function run(){
      var rows=tbl(name).filter(function(r){
        if(!eqs.every(function(f){return r[f[0]]===f[1];}))return false;
        if(isNull&&r[isNull]!=null)return false;
        if(notNull&&r[notNull]==null)return false;
        return true;});
      if(single)return P(rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}});
      return P({data:rows,error:null});
    }
    var api={
      select:function(){return api;},
      eq:function(k,v){eqs.push([k,v]);return api;},
      neq:function(){return api;},
      is:function(k,v){if(v===null)isNull=k;return api;},
      not:function(k,op,v){if(op==='is'&&v===null)notNull=k;return api;},
      order:function(){return api;},limit:function(){return api;},ilike:function(){return api;},
      in:function(k,vals){var rows=tbl(name).filter(function(r){return vals.indexOf(r[k])>=0;});return P({data:rows,error:null});},
      single:function(){single=true;return run();},
      insert:function(r){var rows=(Array.isArray(r)?r:[r]).map(function(x){
          var c=Object.assign({},x); if(!c.id)c.id='prop-'+(++_seq); tbl(name).push(c); return c;});
        var p=P({data:rows,error:null});
        p.select=function(){var s=P({data:rows,error:null});s.single=function(){return P({data:rows[0],error:null});};return s;};
        return p;},
      upsert:function(r){var arr=(Array.isArray(r)?r:[r]);var t=tbl(name);
        arr.forEach(function(x){var i=t.findIndex(function(y){return y.id===x.id;});
          if(i>=0)t[i]=Object.assign({},t[i],x);else t.push(Object.assign({},x));});
        var p=P({data:arr,error:null});
        p.select=function(){var s=P({data:arr,error:null});s.single=function(){return P({data:arr[0],error:null});};return s;};
        return p;},
      update:function(patch){return {eq:function(k,v){var t=tbl(name);
        t.forEach(function(r){if(r[k]===v)Object.assign(r,patch);});
        return P({data:null,error:null});}};},
      delete:function(){return {eq:function(k,v){var t=tbl(name);
        for(var i=t.length-1;i>=0;i--)if(t[i][k]===v)t.splice(i,1);
        return P({error:null});},
        in:function(k,vals){var t=tbl(name);
        for(var i=t.length-1;i>=0;i--)if(vals.indexOf(t[i][k])>=0)t.splice(i,1);
        return P({error:null});}};},
      then:function(f){return run().then(f);}};
    return api;}
  window.supabase={createClient:function(){return {auth:{
    getUser:function(){return P({data:{user:U},error:null});},
    getSession:function(){return P({data:{session:{user:U}},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return P({error:null});}},
    rpc:function(){return P({data:null,error:null});},
    from:function(n){return q(n);},
    storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};
})();`;

const CLICK_LABEL = function (rx) {
  var re = new RegExp(rx, 'i');
  var els = [].slice.call(document.querySelectorAll('a,button,[role="button"]'));
  var hit = els.filter(function (e) {
    var r = e.getBoundingClientRect(); var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 2 || r.height < 2) return false;
    if (e.disabled) return false;
    return re.test((e.innerText || e.textContent || '').trim());
  });
  if (!hit.length) return null;
  hit[0].click();
  return (hit[0].innerText || hit[0].textContent || '').trim().slice(0, 40);
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
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(DB);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nProperty Lifecycle — Archive normal, Delete exceptional\n' + '='.repeat(64));

  // ── the activity predicate ───────────────────────────────────────────────
  const pred = await page.evaluate(() => {
    if (typeof _propertyActivity !== 'function') return { missing: true };
    const empty = { id: 'p0', name: 'Just Named', totalSqft: 12000, tenants: [], invoices: [] };
    const busy  = { id: 'p1', name: 'Maple Plaza', totalSqft: 32000,
      tenants: [{ tenant_name: 'Sage Shield', leaseUrl: 'x.pdf' }, { tenant_name: 'Cascade' }],
      invoices: [{ vendor: 'Atlas' }, { vendor: 'Bright' }],
      timeline: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      camReconciliation: { results: [{ tenant: 'Sage Shield' }], settlement: { txHash: 'ABC' } },
      disputes: [] };
    return {
      emptyHas: _propertyHasActivity(empty),
      busyHas:  _propertyHasActivity(busy),
      desc:     _describePropertyActivity(busy),
      emptyDesc: _describePropertyActivity(empty),
    };
  });
  check('the app exposes one activity predicate', !pred.missing);
  check('a property with only a name and sqft has NO activity', pred.emptyHas === false);
  check('a property with leases, invoices and history HAS activity', pred.busyHas === true);
  check('the description names each kind and its count',
        /2 tenants/.test(pred.desc) && /1 lease document/.test(pred.desc) &&
        /3 timeline entries/.test(pred.desc) && /1 CAM reconciliation/.test(pred.desc) &&
        /1 settlement/.test(pred.desc), pred.desc);
  check('and it lists nothing for an empty property', pred.emptyDesc === '', pred.emptyDesc);

  // ── the Delete dialog on an EMPTY property: no ceremony ──────────────────
  const emptyDlg = await page.evaluate(() => {
    _props = [{ id: 'p-empty', name: 'Typo Plaza', totalSqft: 0, tenants: [], invoices: [] }];
    activePropId = 'p-empty';
    openDeletePropertyModal();
    const g = document.getElementById('delModalGuard');
    const i = document.getElementById('delModalConfirmName');
    const b = document.getElementById('delModalConfirmBtn');
    const a = document.getElementById('delModalAdvice');
    return { guard: g.style.display, input: i.style.display, disabled: b.disabled,
             advice: a.style.display };
  });
  check('deleting an empty property does not lecture the user', emptyDlg.guard === 'none');
  // A warning shown every time is one people learn to dismiss unread — which is
  // how it stops working on the day it matters.
  check('and the Archive guidance stays out of the way when there is no history',
        emptyDlg.advice === 'none', emptyDlg.advice);
  check('and does not demand the name be typed', emptyDlg.input === 'none');
  check('and Delete is immediately usable', emptyDlg.disabled === false);

  // ── the Delete dialog on a property WITH history ─────────────────────────
  const busyDlg = await page.evaluate(() => {
    _props = [{ id: 'p-busy', name: 'Maple Plaza', totalSqft: 32000,
      tenants: [{ tenant_name: 'Sage Shield', leaseUrl: 'x.pdf' }],
      invoices: [{ vendor: 'Atlas' }],
      timeline: [{ id: 't1' }, { id: 't2' }],
      camReconciliation: { results: [{ tenant: 'Sage Shield' }] } }];
    activePropId = 'p-busy';
    openDeletePropertyModal();
    return {
      guard:    document.getElementById('delModalGuard').style.display,
      activity: document.getElementById('delModalActivity').textContent,
      advice:   document.getElementById('delModalAdvice').style.display,
      adviceText: document.getElementById('delModalAdvice').textContent.replace(/\s+/g, ' ').trim(),
      inputShown: document.getElementById('delModalConfirmName').style.display,
      disabled: document.getElementById('delModalConfirmBtn').disabled,
      archiveBtn: (document.getElementById('delModalArchiveBtn') || {}).textContent || '',
    };
  });
  check('deleting a property with history names what would be destroyed',
        busyDlg.guard === 'block' && /timeline entries/.test(busyDlg.activity), busyDlg.activity);
  check('the counts are real, not a generic list',
        /1 tenant/.test(busyDlg.activity) && /2 timeline entries/.test(busyDlg.activity), busyDlg.activity);
  check('the dialog explains why Archive is recommended',
        busyDlg.advice === 'block' && /Archive.{0,40}preserves its history/i.test(busyDlg.adviceText),
        busyDlg.adviceText.slice(0, 90));
  check('and says Delete is for properties created by mistake',
        /created by mistake/i.test(busyDlg.adviceText));
  check('Archive is offered as an action in the dialog', /archive/i.test(busyDlg.archiveBtn), busyDlg.archiveBtn);
  check('Delete is disabled until the name is typed', busyDlg.disabled === true);
  check('and the name input is shown', busyDlg.inputShown !== 'none');

  const typing = await page.evaluate(() => {
    const i = document.getElementById('delModalConfirmName');
    const b = document.getElementById('delModalConfirmBtn');
    i.value = 'Maple'; _delModalNameTyped(); const partial = b.disabled;
    i.value = 'maple plaza'; _delModalNameTyped(); const wrongCase = b.disabled;
    i.value = 'Maple Plaza'; _delModalNameTyped(); const exact = b.disabled;
    return { partial, wrongCase, exact };
  });
  check('a partial name does not unlock Delete', typing.partial === true);
  check('the wrong case does not unlock Delete', typing.wrongCase === true);
  check('the exact name unlocks Delete', typing.exact === false);

  // ── Archive must be reachable WITHOUT going through Delete ───────────────
  // It shipped reachable only from the Delete dialog's "Archive Instead"
  // button, which made the normal lifecycle a subordinate of the exceptional
  // one. Nothing in the suite noticed, because every archive test called
  // archiveActiveProperty() directly.
  const reach = await page.evaluate(() => {
    // Close whatever an earlier step left open, or this assertion measures the
    // previous test's state rather than this one's.
    closeDeletePropertyModal();
    _props = [{ id: 'p-reach', name: 'Reachable Plaza', totalSqft: 1000, tenants: [{ tenant_name: 'A' }] }];
    activePropId = 'p-reach';
    openRecoveryModal();
    const body = document.getElementById('recoveryModalBody');
    const txt  = (body.innerText || body.textContent || '');
    const btns = [].slice.call(body.querySelectorAll('button'))
      .map(b => (b.innerText || b.textContent || '').trim());
    const deleteModalOpen = document.getElementById('deletePropertyModal').classList.contains('open');
    closeRecoveryModal();
    return { archiveBtn: btns.find(t => /archive/i.test(t)) || null,
             deleteBtn:  btns.find(t => /delete property/i.test(t)) || null,
             deleteModalOpen, mentionsRestore: /undone|restore/i.test(txt) };
  });
  check('Archive has its own entry point, not only the Delete dialog',
        !!reach.archiveBtn, reach.archiveBtn || 'no Archive control in Data Health');
  check('and reaching it did not require opening the Delete dialog',
        reach.deleteModalOpen === false);
  check('it says the history is kept and the action can be undone', reach.mentionsRestore);
  check('Delete is still reachable too — demoted, not hidden', !!reach.deleteBtn, reach.deleteBtn || '');

  // ── Archive: nothing destroyed, gone from the portfolio ──────────────────
  const archived = await page.evaluate(async () => {
    __rows.properties = [{ id: 'p-busy', user_id: 'u1', name: 'Maple Plaza', sqft: 32000, archived_at: null }];
    _props = [{ id: 'p-busy', name: 'Maple Plaza', totalSqft: 32000,
      tenants: [{ tenant_name: 'Sage Shield' }], timeline: [{ id: 't1' }] }];
    portfolio.splice(0, portfolio.length, ..._props);
    activePropId = 'p-busy';
    await archiveActiveProperty();
    const active   = await loadProperties();
    const archived = await loadProperties({ archived: true });
    return {
      rowStillThere: __rows.properties.length === 1,
      archivedAtSet: !!__rows.properties[0].archived_at,
      activeCount: active.length,
      archivedCount: archived.length,
      archivedName: archived[0] ? archived[0].name : null,
      inMemory: _props.length,
    };
  });
  check('archiving destroys nothing — the row is still there', archived.rowStillThere);
  check('archived_at is stamped with when, not a boolean', archived.archivedAtSet);
  check('the property leaves the active portfolio', archived.activeCount === 0 && archived.inMemory === 0,
        `active=${archived.activeCount} memory=${archived.inMemory}`);
  check('and is readable from the archived view', archived.archivedCount === 1 && archived.archivedName === 'Maple Plaza');

  // ARCHITECTURE_PRINCIPLES §4: an archived building must not move the numbers.
  const agg = await page.evaluate(async () => {
    const active = await loadProperties();
    const pid = AcquisitionEngine.computePortfolioIntelligence(active);
    return { propsIn: active.length, totalBldgSqft: pid.totalBldgSqft ?? pid.totalSqft ?? null };
  });
  check('portfolio intelligence sees no archived property', agg.propsIn === 0,
        JSON.stringify(agg));

  // ── Restore — by CLICKING the button, not by calling the function ────────
  //
  // The previous version of this section called restoreProperty() directly. It
  // passed for weeks while Restore was completely dead in the browser: the
  // button was rendered as
  //   onclick="restoreProperty('${esc(p.id)}', ${JSON.stringify(p.name)})"
  // and JSON.stringify emits double quotes inside a double-quoted attribute, so
  // the browser truncated the handler to `restoreProperty('p-1', ` — a syntax
  // error, therefore a null onclick. Nothing happened on click, and nothing
  // could report that, because no code ran.
  //
  // Calling the handler proves the handler works. It says nothing about whether
  // a user can trigger it. Everything below goes through the rendered control,
  // with a name chosen to break naive quoting.
  const HOSTILE_NAME = 'O\'Neill & Sons "Annex"';

  const rendered = await page.evaluate(async (nm) => {
    __rows.properties = [{ id: 'p-restore', user_id: 'u1', name: nm, sqft: 24000,
                           archived_at: '2026-07-01T10:00:00.000Z' }];
    _props = [];
    _archivedProps = null;                 // force a real read
    await _refreshArchivedLink();
    const list = document.getElementById('ptfArchivedList');
    list.style.display = 'block';
    _renderArchivedList();
    const btn = list.querySelector('.ptf-arch-restore');
    return {
      barShown:   document.getElementById('ptfArchivedBar').style.display !== 'none',
      linkText:   document.getElementById('ptfArchivedLink').textContent,
      buttonThere: !!btn,
      // The whole bug, in one value: a broken onclick attribute compiles to null.
      handlerBound: !!(btn && typeof btn.onclick === 'function'),
      nameRendered: btn ? (btn.parentElement.parentElement.querySelector('.ptf-arch-name') || {}).textContent : null,
      junkAttrs: btn ? [].slice.call(btn.attributes).map(a => a.name)
        .filter(n => !/^(class|data-prop-id|data-prop-name|onclick)$/.test(n)) : null,
    };
  }, HOSTILE_NAME);

  check('the archived link appears and counts correctly',
        rendered.barShown && /1 archived property/.test(rendered.linkText), rendered.linkText);
  check('a Restore button is rendered', rendered.buttonThere);
  check('and it has a WORKING click handler, not a truncated one',
        rendered.handlerBound, 'onclick compiled to ' + (rendered.handlerBound ? 'a function' : 'null'));
  check('a name with quotes and an ampersand survives rendering',
        rendered.nameRendered === HOSTILE_NAME, rendered.nameRendered);
  check('and it did not leak into stray attributes',
        Array.isArray(rendered.junkAttrs) && rendered.junkAttrs.length === 0,
        JSON.stringify(rendered.junkAttrs));

  // Now actually click it, the way a person does.
  const clicked = await page.evaluate(CLICK_LABEL, '^restore$');
  check('Restore is findable and clickable by its visible label', !!clicked, clicked || 'not found');
  await page.waitForTimeout(900);

  const restored = await page.evaluate(async () => {
    const row = __rows.properties.find(r => r.id === 'p-restore');
    const active = await loadProperties();
    const arch   = await loadProperties({ archived: true });
    const bar    = document.getElementById('ptfArchivedBar');
    return {
      archivedAtInDb: row ? row.archived_at : 'ROW GONE',
      active: active.length,
      archivedRows: arch.length,
      name: active[0] ? active[0].name : null,
      inMemory: _props.length,
      barShown: bar.style.display !== 'none',
      linkText: document.getElementById('ptfArchivedLink').textContent,
    };
  });

  check('clicking Restore sets archived_at back to NULL in the database',
        restored.archivedAtInDb === null, String(restored.archivedAtInDb));
  check('the property returns to the active list',
        restored.active === 1 && restored.name === HOSTILE_NAME, restored.name);
  check('and to the in-memory portfolio, without a page reload',
        restored.inMemory === 1, String(restored.inMemory));
  check('it is no longer in the archived view', restored.archivedRows === 0);
  check('the archived count decrements — the link hides at zero',
        restored.barShown === false, restored.barShown ? restored.linkText : 'hidden');

  // Portfolio metrics must move with it: restoring puts the building back into
  // every aggregate, the mirror of archiving taking it out.
  const metricsBack = await page.evaluate(async () => {
    const active = await loadProperties();
    const pid = AcquisitionEngine.computePortfolioIntelligence(active);
    return { propsIn: active.length, sqft: pid.totalBldgSqft ?? null };
  });
  check('portfolio intelligence counts the restored property again',
        metricsBack.propsIn === 1, JSON.stringify(metricsBack));

  // ── PREVENTION: deleting a converted property reverts its acquisition ────
  const reverted = await page.evaluate(async () => {
    __rows.properties = [{ id: 'p-conv', user_id: 'u1', name: 'Harborview Retail Center', sqft: 32000, archived_at: null }];
    _props = [{ id: 'p-conv', name: 'Harborview Retail Center', totalSqft: 32000, tenants: [], invoices: [] }];
    _propsLoadedOk = true;
    activePropId = 'p-conv';
    _acqReviews = [{ id: 'rev-1', name: 'Harborview Retail Center', status: 'converted',
      data: {
        analysis: { summary: { revenueAtRisk: 41200 }, topRisks: ['Cap ambiguity'] },
        tenants: [{ tenant_name: 'Coastal Outfitters' }],
        conversionRecord: { propertyId: 'p-conv', propertyName: 'Harborview Retail Center',
                            convertedAt: '2026-01-20T09:00:00.000Z' },
      } }];
    await confirmDeleteProperty();
    const r = _acqReviews[0], d = r.data || {};
    return {
      status: r.status,
      stillClaimsConverted: !!d.conversionRecord,
      historyLen: (d.conversionHistory || []).length,
      historyOldId: (d.conversionHistory || [])[0] ? d.conversionHistory[0].propertyId : null,
      historyReason: (d.conversionHistory || [])[0] ? d.conversionHistory[0].supersededReason : null,
      analysisIntact: !!(d.analysis && d.analysis.summary && d.analysis.summary.revenueAtRisk === 41200),
      tenantsIntact: (d.tenants || []).length === 1,
      orphanNow: _acqOrphaned(r),
      propsLeft: _props.length,
    };
  });
  check('deleting a converted property actually deletes it', reverted.propsLeft === 0);
  check('its acquisition reverts to Ready to Convert', reverted.status === 'complete', reverted.status);
  check('and stops claiming it is converted to something', reverted.stillClaimsConverted === false);
  check('so it is NOT left as an orphan — repair is the backstop, not the path',
        reverted.orphanNow === false);
  check('the superseded conversion is moved to history, not discarded',
        reverted.historyLen === 1 && reverted.historyOldId === 'p-conv',
        `${reverted.historyLen} / ${reverted.historyOldId}`);
  check('and records that the property was deleted',
        /deleted/i.test(reverted.historyReason || ''), reverted.historyReason);
  check('the analysis survives the revert', reverted.analysisIntact);
  check('the extracted tenants survive the revert', reverted.tenantsIntact);

  // ── ARCHIVING a converted property leaves the acquisition alone ──────────
  const archConv = await page.evaluate(async () => {
    __rows.properties = [{ id: 'p-conv2', user_id: 'u1', name: 'Lakeview', sqft: 18000, archived_at: null }];
    _props = [{ id: 'p-conv2', name: 'Lakeview', totalSqft: 18000, tenants: [{ tenant_name: 'X' }] }];
    _propsLoadedOk = true;
    activePropId = 'p-conv2';
    _acqReviews = [{ id: 'rev-2', name: 'Lakeview', status: 'converted',
      data: { conversionRecord: { propertyId: 'p-conv2', propertyName: 'Lakeview' } } }];
    await archiveActiveProperty();
    const r = _acqReviews[0];
    return { status: r.status, keepsRecord: !!r.data.conversionRecord, orphan: _acqOrphaned(r) };
  });
  check('archiving leaves the acquisition Converted — the property still exists',
        archConv.status === 'converted' && archConv.keepsRecord === true);
  check('and an archived property is not mistaken for a deleted one',
        archConv.orphan === false);

  // ── P0.2: STAGE. A prospect never enters the portfolio; it joins by ─────
  //    TRANSITION to acquired — the same row, never a copy.
  const stage = await page.evaluate(async () => {
    __rows.properties = [
      { id: 'p-mgd',  user_id: 'u1', name: 'Managed Plaza',  sqft: 10000, archived_at: null, lifecycle_stage: 'acquired' },
      { id: 'p-pros', user_id: 'u1', name: 'Prospect Tower', sqft: 90000, archived_at: null, lifecycle_stage: 'prospect' },
      { id: 'p-dd',   user_id: 'u1', name: 'Diligence Mall', sqft: 70000, archived_at: null, lifecycle_stage: 'due_diligence' },
      { id: 'p-pass', user_id: 'u1', name: 'Passed Centre',  sqft: 80000, archived_at: null, lifecycle_stage: 'passed' },
      { id: 'p-old',  user_id: 'u1', name: 'Legacy Row',     sqft: 5000,  archived_at: null },   // predates 023
      { id: 'p-arch', user_id: 'u1', name: 'Archived Plaza', sqft: 60000, archived_at: '2026-01-01T00:00:00Z', lifecycle_stage: 'acquired' },
    ];
    __rows.tenants = [
      { id: 't-p', property_id: 'p-pros', name: 'Anchor Prospect', sqft: 90000, end_date: '2026-10-01' },
      { id: 't-m', property_id: 'p-mgd',  name: 'Managed Tenant',  sqft: 8000,  end_date: '2030-01-01' },
    ];
    _acqReviews = [];
    _props = await loadProperties();
    _propsLoadedOk = true;
    portfolio.splice(0, portfolio.length, ..._props);
    renderPortfolio(_props);
    const k   = portfolioKPIs(_props);
    const pid = AcquisitionEngine.computePortfolioIntelligence(_props);
    const rar = AcquisitionEngine.computeRevenueAtRisk(_props);
    // The same engines over the UNCLASSIFIED rows — what leakage would look like.
    const naive = __rows.properties.map(r => ({ id: r.id, name: r.name, totalSqft: r.sqft,
      tenants: __rows.tenants.filter(t => t.property_id === r.id).map(t => ({ tenant_name: t.name, leased_sqft: t.sqft, end_date: t.end_date })) }));
    const kNaive = portfolioKPIs(naive);
    const archived = await loadProperties({ archived: true });
    return {
      ids: _props.map(p => p.id).sort(),
      prospects: _prospectProps.map(p => p.id).sort(),
      kpiTile: document.getElementById('pKpiProperties').textContent,
      kProps: k.properties, kOcc: k.occupancyPct, kNaiveProps: kNaive.properties, kNaiveOcc: kNaive.occupancyPct,
      pidCount: pid.propertyCount, pidSqft: pid.totalBuildingSqft,
      rarHasProspect: [...rar.expired, ...rar.critical, ...rar.high, ...rar.medium].some(a => a.propertyId === 'p-pros'),
      archivedIds: archived.map(p => p.id),
      prospectsAfterArchivedRead: _prospectProps.map(p => p.id).sort(),
      rowCount: __rows.properties.length,
    };
  });
  check('P0.2: the portfolio holds the acquired, active properties only', JSON.stringify(stage.ids) === '["p-mgd","p-old"]', JSON.stringify(stage.ids));
  check('a prospect, a deal in diligence and a passed deal are held apart in _prospectProps',
        JSON.stringify(stage.prospects) === '["p-dd","p-pass","p-pros"]', JSON.stringify(stage.prospects));
  check('the Properties KPI tile counts 2, not 6', stage.kpiTile === '2' && stage.kProps === 2, `${stage.kpiTile} / ${stage.kProps}`);
  check('occupancy is the managed buildings\' occupancy (8,000 of 15,000)', stage.kOcc === 53, String(stage.kOcc));
  check('THE TEETH: the same KPI over the unclassified rows would say 6 properties and a different occupancy',
        stage.kNaiveProps === 6 && stage.kNaiveOcc !== stage.kOcc, `${stage.kNaiveProps} / ${stage.kNaiveOcc}`);
  check('portfolio intelligence sees 2 properties and 15,000 sqft', stage.pidCount === 2 && stage.pidSqft === 15000, `${stage.pidCount} / ${stage.pidSqft}`);
  check('revenue at risk carries no prospect lease', stage.rarHasProspect === false);
  check('the archived view shows the archived managed property only', JSON.stringify(stage.archivedIds) === '["p-arch"]', JSON.stringify(stage.archivedIds));
  check('and reading the archived view did not disturb the deal list', JSON.stringify(stage.prospectsAfterArchivedRead) === '["p-dd","p-pass","p-pros"]');

  const joined = await page.evaluate(async () => {
    const before = __rows.properties.length;
    const row = __rows.properties.find(r => r.id === 'p-pros');
    const tr  = PropertyLifecycle.transition(row, 'acquired', { actorUid: 'u1', now: '2026-09-18T12:00:00.000Z' });
    if (!tr.ok) return { ok: false, error: tr.error };
    // The patch, applied to the SAME row — the only write a transition makes.
    await db.from('properties').update(tr.patch).eq('id', 'p-pros');
    _props = await loadProperties();
    portfolio.splice(0, portfolio.length, ..._props);
    renderPortfolio(_props);
    const after = __rows.properties.find(r => r.id === 'p-pros');
    return {
      ok: true,
      patchKeys: Object.keys(tr.patch).sort(),
      ids: _props.map(p => p.id).sort(),
      prospects: _prospectProps.map(p => p.id).sort(),
      kpiTile: document.getElementById('pKpiProperties').textContent,
      sameRowCount: __rows.properties.length === before,
      sameId: after && after.id === 'p-pros' && after.name === 'Prospect Tower' && after.sqft === 90000,
      acquiredAt: after && after.acquired_at, by: after && after.stage_changed_by,
      tenantsCameAlong: (_props.find(p => p.id === 'p-pros') || { tenants: [] }).tenants.length,
    };
  });
  check('a prospect joins the portfolio by a stage TRANSITION', joined.ok === true && JSON.stringify(joined.ids) === '["p-mgd","p-old","p-pros"]', JSON.stringify(joined));
  check('the transition wrote stage columns and nothing else',
        JSON.stringify(joined.patchKeys) === '["acquired_at","lifecycle_stage","stage_changed_at","stage_changed_by"]', JSON.stringify(joined.patchKeys));
  check('NO ROW WAS COPIED OR REBUILT — same row count, same id, same name, same sqft', joined.sameRowCount && joined.sameId);
  check('acquired_at and who are stamped on that row', joined.acquiredAt === '2026-09-18T12:00:00.000Z' && joined.by === 'u1');
  check('the KPI tile now counts 3', joined.kpiTile === '3', joined.kpiTile);
  check('and the deal list no longer holds it', JSON.stringify(joined.prospects) === '["p-dd","p-pass"]', JSON.stringify(joined.prospects));
  check('its tenant came with it — the same record, now managed', joined.tenantsCameAlong === 1, String(joined.tenantsCameAlong));

  const terminal = await page.evaluate(() => {
    const mgd = __rows.properties.find(r => r.id === 'p-mgd');
    return { back: PropertyLifecycle.transition(mgd, 'prospect').error, pass: PropertyLifecycle.transition(mgd, 'passed').error,
             reopen: PropertyLifecycle.transition(__rows.properties.find(r => r.id === 'p-pass'), 'prospect').ok };
  });
  check('a managed property cannot be sent back to a deal stage — archive is its exit',
        terminal.back === 'not_allowed' && terminal.pass === 'not_allowed', JSON.stringify(terminal));
  check('a passed deal can be reopened', terminal.reopen === true);

  check('no uncaught errors across the lifecycle', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
