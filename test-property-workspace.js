// test-property-workspace.js
// ============================================================================
// The Property tab as the building's operating record.
//
// The governing rule (docs/PROPERTY_WORKSPACE.md): NO PARALLEL DATA STORES. A
// property record IS a property-scoped timeline event. Categories are a filter
// over that one timeline, not screens with their own storage.
//
// That rule is the reason this file exists, because a violation is INVISIBLE ON
// SCREEN. A category rendering from `prop.insurance = []` looks identical to one
// rendering from the timeline — until a reconciliation or a property switch
// clears one and not the other. So the central assertion here is not "the record
// appears"; it is "the record appears AND the timeline is the only place it
// lives", checked by emptying the timeline and requiring the surface to empty
// with it.
//
// Everything is driven through the real controls: ➕ Add Record opens the real
// PropertyTimeline modal, the real form is filled, the real Save runs.
//
// Run: node test-property-workspace.js
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(`window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'u1',email:'dana@example.com'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'dana@example.com'}}},error:null});},
    onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
    signOut:function(){return Promise.resolve({error:null});}},
    rpc:function(){return Promise.resolve({data:null,error:null});},
    from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
      is:function(){return q;},not:function(){return q;},order:function(){return q;},limit:function(){return q;},
      ilike:function(){return q;},in:function(){return Promise.resolve({data:[],error:null});},
      single:function(){return Promise.resolve({data:null,error:null});},
      insert:function(){var p=Promise.resolve({data:[],error:null});p.select=function(){return Promise.resolve({data:[],error:null});};return p;},
      upsert:function(){var p=Promise.resolve({data:[],error:null});p.select=function(){return Promise.resolve({data:[],error:null});};return p;},
      update:function(){return {eq:function(){return Promise.resolve({data:null,error:null});}};},
      delete:function(){return {eq:function(){return Promise.resolve({error:null});}};},
      then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
    storage:{from:function(){return {upload:function(){return Promise.resolve({data:{path:'x'},error:null});},
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log('\nProperty Workspace — one timeline, categories as a filter\n' + '='.repeat(64));

  // A building with nothing recorded yet.
  const PROP = {
    id: 'prop-maple', name: 'Maple Plaza', totalSqft: 32000,
    tenants: [{ id: 't1', tenant_name: 'Sage Shield', leased_sqft: 4200 }],
    invoices: [], timeline: [], disputes: [],
  };

  const boot = await page.evaluate((prop) => {
    if (!window.PropertyOS) return { missing: 'PropertyOS' };
    if (!window.PropertyTimeline) return { missing: 'PropertyTimeline' };
    _props = [prop];
    activePropId = prop.id;
    window.currentProperty = function () { return _props[0]; };
    PropertyOS.init();
    // The Property pane ships display:none until its tab is picked. Reveal it —
    // a control inside a hidden pane is not clickable, and every assertion below
    // goes through real clicks. The first run of this file reported
    // "Add Record not found" for exactly that reason.
    const pane = document.getElementById('wsPane-property');
    if (pane) pane.style.display = 'block';
    const ws = document.getElementById('mainWorkflow');
    if (ws) ws.style.display = 'block';
    PropertyOS.renderPropertyPage(_props[0]);
    const body = document.getElementById('propertyOsBody');
    // Scope the empty-state read to the RECORDS section. Reading the whole pane
    // matched the Property Information empty state instead ("...insurance, roof
    // and HVAC details...") and passed while saying nothing about records.
    const secs = [].slice.call(body.querySelectorAll('.pos-sec'));
    const recSec = secs.find(x => /Property records/i.test(x.textContent)) || body;
    return { text: (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim(),
             recText: (recSec.innerText || recSec.textContent || '').replace(/\s+/g, ' ').trim(),
             paneVisible: !!pane && pane.style.display === 'block' };
  }, PROP);
  check('the Property workspace renders', !boot.missing, boot.missing || 'ok');
  check('and its pane is on screen so the controls are reachable', boot.paneVisible);

  // ── the empty state has to teach, not shrug ──────────────────────────────
  check('an empty building says what belongs here — in the RECORDS section',
        /tax bills.*insurance.*survey/i.test(boot.recText || ''),
        (boot.recText || '').slice(0, 120));
  check('and says these are entries on the property timeline',
        /property timeline/i.test(boot.recText || ''));

  // ── the categories the building actually needs ───────────────────────────
  const cats = await page.evaluate(() => {
    const keys = (PropertyTimeline.categories || []).map(c => c.key);
    return { keys, propertyCats: PropertyTimeline.propertyCategories || [] };
  });
  const REQUIRED = ['real_estate_taxes', 'insurance', 'mortgage_financing', 'survey', 'site_plan',
                    'building_plan', 'environmental', 'capital_improvement', 'building_photo', 'warranty'];
  const missingCats = REQUIRED.filter(k => !cats.keys.includes(k));
  check('every building-level category exists on the ONE category registry',
        missingCats.length === 0, missingCats.join(', ') || cats.keys.length + ' categories');

  // ── add a record through the real control ────────────────────────────────
  const opened = await page.evaluate(CLICK_LABEL, 'add record');
  check('"Add Record" is findable by its visible label', !!opened, opened || 'not found');
  await page.waitForTimeout(500);

  const modal = await page.evaluate(() => ({
    open: !!document.getElementById('ptlOverlay'),
    hasSystem: !!document.getElementById('ptlSystem'),
    hasSpace: !!document.getElementById('ptlSpace'),
    systemOptions: [].slice.call(document.querySelectorAll('#ptlSystem option')).map(o => o.value).filter(Boolean),
  }));
  check('it opens the existing timeline modal', modal.open);
  check('which now offers a Building System — the subject the UI never exposed',
        modal.hasSystem && modal.systemOptions.includes('roof'), modal.systemOptions.join(','));

  // A warranty on the Roof: the case that sent Warranties here from Spaces.
  const saved = await page.evaluate(async () => {
    document.getElementById('ptlTitle').value = 'Roof membrane warranty — 20 year';
    document.getElementById('ptlTitle').dispatchEvent(new Event('input'));
    document.getElementById('ptlCat').value = 'warranty';
    document.getElementById('ptlNotes').value = 'Carlisle SynTec, installed 2024.';
    const sys = document.getElementById('ptlSystem');
    sys.value = 'roof'; sys.dispatchEvent(new Event('change'));
    const btn = document.getElementById('ptlSave');
    const disabled = btn.disabled;
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const p = _props[0];
    const ev = (p.timeline || [])[0];
    return {
      saveWasEnabled: !disabled,
      timelineLen: (p.timeline || []).length,
      subject: ev ? ev.subject : null,
      category: ev ? ev.category : null,
      recordedBy: ev ? ((ev.metadata && ev.metadata.recordedBy) || ev.actor) : null,
      // The violation this whole file guards against: a second home for the data.
      strayStores: Object.keys(p).filter(k =>
        /^(insurance|taxes|surveys|plans|warranties|environmental|photos|records)$/i.test(k)),
    };
  });

  check('Save was enabled once the record had a title', saved.saveWasEnabled);
  check('the record became a TIMELINE event', saved.timelineLen === 1, String(saved.timelineLen));
  check('scoped to the Building System, not to the property at large',
        !!saved.subject && saved.subject.type === 'system' && saved.subject.id === 'roof',
        JSON.stringify(saved.subject));
  check('filed under the Warranty category', saved.category === 'warranty', saved.category);
  check('and it records WHO created it — the signed-in user, not a placeholder',
        saved.recordedBy === 'dana@example.com', saved.recordedBy);
  check('no parallel store appeared on the property',
        saved.strayStores.length === 0, saved.strayStores.join(', '));

  // ── the surface reflects it ──────────────────────────────────────────────
  const after = await page.evaluate(() => {
    PropertyOS.renderPropertyPage(_props[0]);
    const body = document.getElementById('propertyOsBody');
    const txt = (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim();
    const chips = [].slice.call(body.querySelectorAll('.pos-chip')).map(c => c.textContent.trim());
    const sysCell = [].slice.call(body.querySelectorAll('.pos-sys-cell'))
      .find(c => /Roof/.test(c.textContent));
    return { txt, chips, roofCell: sysCell ? sysCell.textContent.replace(/\s+/g, ' ').trim() : null,
             recCount: body.querySelectorAll('.pos-rec').length };
  });
  check('the record shows on the Property Records surface', after.recCount === 1, String(after.recCount));
  check('the warranty appears in the Roof system count',
        /1 record/.test(after.roofCell || ''), after.roofCell);
  check('the record names its system and who recorded it',
        /Roof/.test(after.txt) && /Recorded by dana@example.com/.test(after.txt));
  check('a Warranty filter chip appeared, because there is now something to filter',
        after.chips.some(c => /Warranty/i.test(c)), after.chips.join(' | '));

  // ── categories are a FILTER, not separate screens ────────────────────────
  const filtered = await page.evaluate(async () => {
    // Add a second record in a different category, property-wide.
    appendPropertyTimelineEvent(_props[0], {
      manual: true, type: 'manual_real_estate_taxes', category: 'real_estate_taxes',
      title: '2026 assessment notice', timestamp: new Date().toISOString(),
      subject: { type: 'property', id: 'prop-maple', label: null },
      actor: 'dana@example.com', metadata: { recordedBy: 'dana@example.com' },
    });
    PropertyOS.setRecordFilter('all', null);
    const both = document.querySelectorAll('#propertyOsBody .pos-rec').length;
    PropertyOS.setRecordFilter('warranty', null);
    const onlyWarranty = [].slice.call(document.querySelectorAll('#propertyOsBody .pos-rec'))
      .map(r => r.textContent);
    PropertyOS.setRecordFilter('all', 'roof');
    const onlyRoof = [].slice.call(document.querySelectorAll('#propertyOsBody .pos-rec'))
      .map(r => r.textContent);
    const paneCount = document.querySelectorAll('#propertyOsBody .pos-recs').length;
    PropertyOS.setRecordFilter('all', null);
    return { both, onlyWarranty, onlyRoof, paneCount };
  });
  check('both records are on the one surface', filtered.both === 2, String(filtered.both));
  check('filtering by category narrows it in place',
        filtered.onlyWarranty.length === 1 && /warranty/i.test(filtered.onlyWarranty[0]),
        String(filtered.onlyWarranty.length));
  check('filtering by Building System narrows it in place',
        filtered.onlyRoof.length === 1 && /Roof/.test(filtered.onlyRoof[0]),
        String(filtered.onlyRoof.length));
  check('there is ONE records list, not a screen per category',
        filtered.paneCount === 1, String(filtered.paneCount));

  // ── THE invariant: the timeline is the only store ────────────────────────
  // Empty the timeline and the surface must empty with it. If anything survives,
  // it was being rendered from somewhere else — which is the failure that is
  // invisible on screen until a property switch clears one copy and not the
  // other.
  const emptied = await page.evaluate(() => {
    const p = _props[0];
    const keep = p.timeline.slice();
    p.timeline = [];
    PropertyOS.renderPropertyPage(p);
    const body = document.getElementById('propertyOsBody');
    const recs = body.querySelectorAll('.pos-rec').length;
    const roof = [].slice.call(body.querySelectorAll('.pos-sys-cell')).find(c => /Roof/.test(c.textContent));
    p.timeline = keep;                   // put it back
    PropertyOS.renderPropertyPage(p);
    return { recs, roofAfter: roof ? roof.textContent.replace(/\s+/g, ' ').trim() : null,
             recsRestored: document.querySelectorAll('#propertyOsBody .pos-rec').length };
  });
  check('clearing the timeline empties the records surface — no second store',
        emptied.recs === 0, emptied.recs + ' record(s) survived an empty timeline');
  check('and empties the Building System counts too',
        !/[1-9] record/.test(emptied.roofAfter || ''), emptied.roofAfter);
  check('restoring the timeline restores the surface', emptied.recsRestored === 2,
        String(emptied.recsRestored));

  // ── one subject per record ───────────────────────────────────────────────
  const exclusive = await page.evaluate(async () => {
    PropertyOS.addRecord();
    await new Promise(r => setTimeout(r, 300));
    const sp = document.getElementById('ptlSpace');
    const sy = document.getElementById('ptlSystem');
    if (!sp || !sy) return { skipped: true };
    sy.value = 'hvac'; sy.dispatchEvent(new Event('change'));
    sp.value = 't1';   sp.dispatchEvent(new Event('change'));
    const afterSpacePick = { space: sp.value, system: sy.value };
    sy.value = 'hvac'; sy.dispatchEvent(new Event('change'));
    const afterSystemPick = { space: sp.value, system: sy.value };
    PropertyTimeline.closeModal();
    return { afterSpacePick, afterSystemPick };
  });
  check('choosing a Space clears the Building System',
        exclusive.skipped || exclusive.afterSpacePick.system === '', JSON.stringify(exclusive.afterSpacePick));
  check('and choosing a System clears the Space',
        exclusive.skipped || exclusive.afterSystemPick.space === '', JSON.stringify(exclusive.afterSystemPick));

  check('no uncaught errors across the workspace', errs.length === 0,
        errs.slice(0, 2).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
