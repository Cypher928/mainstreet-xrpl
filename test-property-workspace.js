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

  // ── amending preserves the original (ARCHITECTURE_PRINCIPLES §6) ─────────
  // _save() used to assign straight onto the event (target.title = title), so
  // an edit destroyed what the record previously said — on the timeline whose
  // whole purpose is being the building's verified memory.
  const amended = await page.evaluate(async () => {
    const p = _props[0];
    const ev = (p.timeline || []).find(e => e.category === 'warranty');
    const originalTitle = ev.title;
    const originalSubject = ev.subject && ev.subject.id;

    // openEditEntry(id) — it resolves the property itself via currentProperty().
    PropertyTimeline.openEditEntry(ev.id);
    await new Promise(r => setTimeout(r, 300));
    if (!document.getElementById('ptlTitle')) return { modalDidNotOpen: true };
    document.getElementById('ptlTitle').value = 'Roof membrane warranty — 20 year (Carlisle)';
    document.getElementById('ptlTitle').dispatchEvent(new Event('input'));
    const sys = document.getElementById('ptlSystem');
    if (sys) { sys.value = 'hvac'; sys.dispatchEvent(new Event('change')); }
    document.getElementById('ptlSave').click();
    await new Promise(r => setTimeout(r, 700));

    const after = (p.timeline || []).find(e => e.id === ev.id);
    const revs = after.revisions || [];
    const created = revs[0];
    const edit = revs[revs.length - 1];
    return {
      originalTitle, originalSubject,
      eventCount: (p.timeline || []).length,      // amend, not append-a-duplicate
      currentTitle: after.title,
      currentSubject: after.subject && after.subject.id,
      revCount: revs.length,
      createdAction: created && created.action,
      snapshotTitle: created && created.snapshot && created.snapshot.title,
      snapshotSubject: created && created.snapshot && created.snapshot.subject && created.snapshot.subject.id,
      editBy: edit && edit.by,
      changedFields: (edit && edit.changes || []).map(c => c.field),
      titleChange: (edit && edit.changes || []).find(c => c.field === 'title'),
      subjectChange: (edit && edit.changes || []).find(c => c.field === 'subject'),
    };
  });

  check('the edit modal opens for an existing record', !amended.modalDidNotOpen,
        amended.modalDidNotOpen ? 'openEditEntry did not open the modal' : 'ok');
  check('editing amends the existing record — it does not create a second one',
        amended.eventCount === 2, String(amended.eventCount));
  check('the current values move on, as an edit should',
        /Carlisle/.test(amended.currentTitle || '') && amended.currentSubject === 'hvac',
        `${amended.currentTitle} / ${amended.currentSubject}`);
  check('revisions[0] snapshots the record AS CREATED',
        amended.createdAction === 'created' && amended.snapshotTitle === amended.originalTitle,
        `${amended.createdAction} / ${amended.snapshotTitle}`);
  check('...including the subject it originally carried',
        amended.snapshotSubject === amended.originalSubject,
        `${amended.snapshotSubject} vs ${amended.originalSubject}`);
  check('the edit is appended as its own revision', amended.revCount === 2, String(amended.revCount));
  check('and names who made it', amended.editBy === 'dana@example.com', amended.editBy);
  check('the revision reports the title change from → to',
        !!amended.titleChange && amended.titleChange.from === amended.originalTitle,
        JSON.stringify(amended.titleChange));
  check('and reports the subject moving Roof → HVAC in readable terms',
        !!amended.subjectChange && /Roof/.test(amended.subjectChange.from) && /HVAC/.test(amended.subjectChange.to),
        JSON.stringify(amended.subjectChange));

  // History that cannot be read is not preserved.
  const historyUi = await page.evaluate(() => {
    PropertyOS.setRecordFilter('all', null);
    const body = document.getElementById('propertyOsBody');
    const det = body.querySelector('.pos-revs');
    if (!det) return { present: false };
    const summary = det.querySelector('summary').textContent.trim();
    det.open = true;
    return { present: true, summary, text: det.textContent.replace(/\s+/g, ' ').trim(),
             lines: det.querySelectorAll('.pos-rev').length };
  });
  check('the record shows that it was edited', historyUi.present && /Edited 1 time/.test(historyUi.summary || ''),
        historyUi.summary || 'no history control');
  check('opening it shows the original and the change',
        /Recorded by/.test(historyUi.text || '') && /Roof/.test(historyUi.text || '') && /HVAC/.test(historyUi.text || ''),
        (historyUi.text || '').slice(0, 120));
  check('one line per revision', historyUi.lines === 2, String(historyUi.lines));

  // A no-op edit must not manufacture history.
  const noop = await page.evaluate(async () => {
    const p = _props[0];
    const ev = (p.timeline || []).find(e => e.category === 'warranty');
    const before = (ev.revisions || []).length;
    PropertyTimeline.openEditEntry(ev.id);
    await new Promise(r => setTimeout(r, 300));
    if (!document.getElementById('ptlSave')) return { before, after: before, modalDidNotOpen: true };
    document.getElementById('ptlSave').click();
    await new Promise(r => setTimeout(r, 600));
    return { before, after: ((p.timeline || []).find(e => e.id === ev.id).revisions || []).length };
  });
  check('saving without changing anything adds no revision',
        noop.after === noop.before, `${noop.before} → ${noop.after}`);

  // ── Related Items — the connective tissue ────────────────────────────────
  // A roof replacement is one story, not six records. Built here as a CHAIN
  // rather than a star, deliberately: the warranty links to the invoice, the
  // invoice links to the job. If the story were only immediate neighbours,
  // opening the warranty would show the invoice and stop — and "one connected
  // story" would only be true when you happened to start at the anchor.
  const story = await page.evaluate(async () => {
    const p = _props[0];
    p.timeline = [];
    p.invoices = [{ vendorName: 'Apex Roofing', amount: 84500, invoiceDate: '2026-05-02', system: 'roof' }];

    const mk = (title, cat, sys) => appendPropertyTimelineEvent(p, {
      manual: true, type: 'manual_' + cat, category: cat, title: title,
      timestamp: new Date().toISOString(),
      subject: sys ? { type: 'system', id: sys, label: sys } : { type: 'property', id: p.id },
      actor: 'dana@example.com', metadata: { recordedBy: 'dana@example.com' },
    });
    const job        = mk('Roof replaced — full tear-off', 'capital_improvement', 'roof');
    const warranty   = mk('Roof membrane warranty — 20 year', 'warranty', 'roof');
    const inspection = mk('Post-installation roof inspection', 'inspection', 'roof');
    const photos     = mk('Roof photos — before and after', 'building_photo', null);
    const claim      = mk('Insurance claim #4471 — storm damage', 'insurance', null);

    PropertyOS.renderPropertyPage(p);
    // A chain: claim → photos → inspection → warranty → invoice → job
    PropertyOS.linkRecord(warranty.id, 'event', job.id);
    PropertyOS.linkRecord(inspection.id, 'event', warranty.id);
    PropertyOS.linkRecord(photos.id, 'event', inspection.id);
    PropertyOS.linkRecord(claim.id, 'event', photos.id);
    PropertyOS.linkRecord(job.id, 'invoice', '0');

    const fromJob   = PropertyOS.relatedGroup(p, job.id);
    const fromClaim = PropertyOS.relatedGroup(p, claim.id);
    const unrelated = mk('2026 assessment notice', 'real_estate_taxes', null);
    const fromUnrelated = PropertyOS.relatedGroup(p, unrelated.id);

    return {
      ids: { job: job.id, warranty: warranty.id, claim: claim.id },
      fromJobEvents: fromJob.events.length, fromJobInvoices: fromJob.invoices.length,
      fromClaimEvents: fromClaim.events.length, fromClaimInvoices: fromClaim.invoices.length,
      fromClaimTitles: fromClaim.events.map(e => e.title),
      unrelatedEvents: fromUnrelated.events.length,
      linkRev: (p.timeline.find(e => e.id === warranty.id).revisions || []).map(r => r.action),
      linkNote: (p.timeline.find(e => e.id === warranty.id).revisions || []).slice(-1)[0].note,
      linkBy: (p.timeline.find(e => e.id === warranty.id).revisions || []).slice(-1)[0].by,
      strayStores: Object.keys(p).filter(k => /^(links|relations|graph|edges)$/i.test(k)),
    };
  });

  check('the whole story is reachable from the job', story.fromJobEvents === 5,
        story.fromJobEvents + ' events');
  check('including the contractor invoice', story.fromJobInvoices === 1, String(story.fromJobInvoices));
  check('and the SAME story is reachable from the far end of the chain',
        story.fromClaimEvents === 5 && story.fromClaimInvoices === 1,
        `${story.fromClaimEvents} events / ${story.fromClaimInvoices} invoices`);
  check('opening the insurance claim shows the roof job itself',
        story.fromClaimTitles.some(t => /Roof replaced/.test(t)), story.fromClaimTitles.join(' | '));
  check('an unrelated record is a story of one — links do not leak',
        story.unrelatedEvents === 1, String(story.unrelatedEvents));
  check('linking is recorded as an amendment, not a silent write',
        story.linkRev.includes('linked'), story.linkRev.join(','));
  check('the history names what was linked and who linked it',
        /Linked to/.test(story.linkNote || '') && story.linkBy === 'dana@example.com',
        `${story.linkNote} — ${story.linkBy}`);
  check('no link store appeared beside the timeline',
        story.strayStores.length === 0, story.strayStores.join(','));

  // Links are stored one way and read both ways — no second copy to drift.
  const oneWay = await page.evaluate((ids) => {
    const p = _props[0];
    const job = p.timeline.find(e => e.id === ids.job);
    const warranty = p.timeline.find(e => e.id === ids.warranty);
    return {
      jobLinks: (job.relatedTo || []).map(r => r.kind + ':' + r.id),
      warrantyLinks: (warranty.relatedTo || []).map(r => r.kind + ':' + r.id),
      jobSeesWarranty: PropertyOS.relatedGroup(p, ids.job).events.some(e => e.id === ids.warranty),
    };
  }, story.ids);
  check('the reverse direction is computed, not stored twice',
        !oneWay.jobLinks.includes('event:' + story.ids.warranty), oneWay.jobLinks.join(','));
  check('yet the job still sees the warranty', oneWay.jobSeesWarranty);

  // ── clicking a Building System ends the search ───────────────────────────
  const roofView = await page.evaluate(() => {
    PropertyOS.setRecordFilter('all', 'roof');
    const body = document.getElementById('propertyOsBody');
    return {
      recs: body.querySelectorAll('.pos-rec').length,
      note: (body.querySelector('.pos-filter-note') || {}).textContent || '',
      invRows: body.querySelectorAll('.pos-sys-invs .pos-ri-row').length,
      text: (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  check('clicking Roof shows the whole roof story, not only system-tagged records',
        roofView.recs === 5, roofView.recs + ' records');
  check('including records never tagged to Roof but linked into the job',
        /Insurance claim/.test(roofView.text) && /Roof photos/.test(roofView.text));
  check('and the roof invoices, with their total',
        roofView.invRows === 1 && /\$84,500/.test(roofView.note), roofView.note.trim().slice(0, 90));

  // ── unlink ───────────────────────────────────────────────────────────────
  const unlinked = await page.evaluate((ids) => {
    PropertyOS.setRecordFilter('all', null);
    const p = _props[0];
    PropertyOS.unlinkRecord(ids.warranty, 'event', ids.job);
    const g = PropertyOS.relatedGroup(p, ids.job);
    const w = p.timeline.find(e => e.id === ids.warranty);
    return { fromJob: g.events.length, lastAction: (w.revisions || []).slice(-1)[0].action };
  }, story.ids);
  check('unlinking splits the story', unlinked.fromJob === 1, String(unlinked.fromJob));
  check('and is itself recorded in the history', unlinked.lastAction === 'unlinked', unlinked.lastAction);

  // ── Documents are a VIEW of records, not a repository ────────────────────
  // The old section scraped attachments into a flat list with no idea which
  // record each came from — "another flat document repository", which is what
  // this workspace must not be. Every row must name its record and open it.
  const docs = await page.evaluate(async () => {
    const p = _props[0];
    p.timeline = [];
    p.invoices = [];
    const job = appendPropertyTimelineEvent(p, {
      manual: true, type: 'manual_capital_improvement', category: 'capital_improvement',
      title: 'Roof replaced — full tear-off', timestamp: new Date().toISOString(),
      subject: { type: 'system', id: 'roof', label: 'Roof' },
      actor: 'dana@example.com', metadata: { recordedBy: 'dana@example.com' },
    });
    PropertyOS.renderPropertyPage(p);

    // Attach through the REAL path: a real File, the real upload hook, the real
    // amend. Only the network is faked.
    window.uploadInvoiceFile = function (f) {
      return Promise.resolve({ url: 'https://x.supabase.co/docs/' + encodeURIComponent(f.name) });
    };
    const file = new File([new Blob(['%PDF-1.4 fake'])], 'roof-warranty.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);

    PropertyOS.pickAttachment(job.id);
    const inp = document.getElementById('posAttachInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 600));

    const after = p.timeline.find(e => e.id === job.id);
    const list = PropertyOS.propertyDocuments(p);
    return {
      attachedCount: (after.attachments || []).length,
      attachedName: (after.attachments || [])[0] && after.attachments[0].name,
      revActions: (after.revisions || []).map(r => r.action),
      revNote: (after.revisions || []).slice(-1)[0].note,
      revBy: (after.revisions || []).slice(-1)[0].by,
      docCount: list.length,
      docCarriesRecord: list[0] && list[0].recordId === job.id,
      docNamesRecord: list[0] && list[0].recordTitle,
      docSystem: list[0] && list[0].system,
      strayStores: Object.keys(p).filter(k => /^(documents|files|docs|attachments)$/i.test(k)),
      jobId: job.id,
    };
  });

  check('attaching a file to an existing record works through the real input',
        docs.attachedCount === 1 && docs.attachedName === 'roof-warranty.pdf',
        `${docs.attachedCount} / ${docs.attachedName}`);
  check('the attachment is recorded in the history',
        docs.revActions.includes('attached'), docs.revActions.join(','));
  check('naming the file and who attached it',
        /roof-warranty\.pdf/.test(docs.revNote || '') && docs.revBy === 'dana@example.com',
        `${docs.revNote} — ${docs.revBy}`);
  check('the document appears in the Documents view', docs.docCount === 1, String(docs.docCount));
  check('carrying the record it is filed on — not floating free',
        docs.docCarriesRecord, docs.docNamesRecord || 'no record');
  check('and inheriting that record\'s building system', docs.docSystem === 'roof', docs.docSystem);
  check('no document store appeared beside the timeline',
        docs.strayStores.length === 0, docs.strayStores.join(','));

  // Emptying the timeline must empty Documents too — same invariant as records.
  const docsGone = await page.evaluate(() => {
    const p = _props[0];
    const keep = p.timeline.slice();
    p.timeline = [];
    const n = PropertyOS.propertyDocuments(p).length;
    PropertyOS.renderPropertyPage(p);
    const rows = document.querySelectorAll('#propertyOsBody .pos-doc-row').length;
    p.timeline = keep; PropertyOS.renderPropertyPage(p);
    return { n, rows };
  });
  check('clearing the timeline empties Documents — no second store',
        docsGone.n === 0 && docsGone.rows === 0, `${docsGone.n} / ${docsGone.rows}`);

  // THE PROMISE: a document row says which record it is on, and opens it.
  const promise = await page.evaluate((jobId) => {
    const body = document.getElementById('propertyOsBody');
    const btn = body.querySelector('.pos-doc-on');
    if (!btn) return { noButton: true };
    const label = btn.textContent.trim();
    const carriesId = btn.dataset.rec === jobId;
    const handlerBound = typeof btn.onclick === 'function';
    btn.click();
    const focused = body.querySelector('.pos-rec--focus');
    return { label, carriesId, handlerBound,
             focusedIsJob: !!focused && focused.dataset.recId === jobId };
  }, docs.jobId);

  check('each document row names the record it is filed on',
        !promise.noButton && /on: Roof replaced/.test(promise.label || ''), promise.label || 'no control');
  check('the control carries that record\'s id — not a generic jump',
        promise.carriesId);
  check('its handler compiles', promise.handlerBound === true);
  check('and clicking it opens THAT record', promise.focusedIsJob === true);

  // ── no silent failures on attach ─────────────────────────────────────────
  const failPath = await page.evaluate(async () => {
    const p = _props[0];
    const job = p.timeline[0];
    const toasts = [];
    const realToast = window.showToast;
    window.showToast = function (m) { toasts.push(String(m)); };
    window.uploadInvoiceFile = function () { return Promise.reject(new Error('network down')); };
    const before = (job.attachments || []).length;
    const file = new File([new Blob(['x'])], 'insurance.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    PropertyOS.pickAttachment(job.id);
    const inp = document.getElementById('posAttachInput');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 600));
    window.showToast = realToast;
    return { toasts, before, after: (p.timeline[0].attachments || []).length };
  });
  check('a failed upload says so — it does not fail silently',
        failPath.toasts.some(t => /couldn.t upload|unavailable/i.test(t)), failPath.toasts.join(' | ') || 'no toast');
  check('and nothing is added to the record when the upload failed',
        failPath.after === failPath.before, `${failPath.before} → ${failPath.after}`);

  // ── mobile: the workspace must not scroll sideways ───────────────────────
  // Found by looking at the page rather than by an assertion: a record card
  // measured 623px inside a 284px column and the whole page scrolled sideways.
  // Every row here is flex with nowrap text in it, and a flex child will not
  // shrink below its content unless min-width:0 says so.
  const mobile = await (async () => {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const mp = await mctx.newPage();
    await mp.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
    await mp.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await mp.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await mp.addInitScript(`window.supabase={createClient:function(){return {auth:{
      getUser:function(){return Promise.resolve({data:{user:{id:'u1',email:'dana@example.com'}},error:null});},
      getSession:function(){return Promise.resolve({data:{session:{user:{id:'u1',email:'dana@example.com'}}},error:null});},
      onAuthStateChange:function(){return {data:{subscription:{unsubscribe:function(){}}}};},
      signOut:function(){return Promise.resolve({error:null});}},
      rpc:function(){return Promise.resolve({data:null,error:null});},
      from:function(){var q={select:function(){return q;},eq:function(){return q;},neq:function(){return q;},
        is:function(){return q;},not:function(){return q;},order:function(){return q;},limit:function(){return q;},
        ilike:function(){return q;},in:function(){return Promise.resolve({data:[],error:null});},
        single:function(){return Promise.resolve({data:null,error:null});},
        then:function(f){return Promise.resolve({data:[],error:null}).then(f);}};return q;},
      storage:{from:function(){return {getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`);
    await mp.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await mp.waitForTimeout(2200);
    const out = await mp.evaluate(() => {
      _props = [{ id: 'pm', name: 'Maple Plaza', totalSqft: 32000,
        tenants: [{ id: 't1', tenant_name: 'Sage Shield' }], invoices: [], timeline: [], disputes: [] }];
      activePropId = 'pm'; window.currentProperty = function () { return _props[0]; };
      const mk = (t, c, sys, att) => appendPropertyTimelineEvent(_props[0], {
        manual: true, type: 'manual_' + c, category: c, title: t, timestamp: new Date().toISOString(),
        subject: sys ? { type: 'system', id: sys, label: sys } : { type: 'property', id: 'pm' },
        attachments: att || [], actor: 'dana@example.com', metadata: { recordedBy: 'dana@example.com' } });
      const job = mk('Roof replaced — full tear-off with parapet reflashing', 'capital_improvement', 'roof',
        [{ name: 'apex-roofing-contract-signed-2026.pdf', url: 'https://x/c.pdf', kind: 'document' }]);
      const w = mk('Roof membrane warranty — 20 year', 'warranty', 'roof', []);
      PropertyOS.init();
      document.getElementById('wsPane-property').style.display = 'block';
      const ws = document.getElementById('mainWorkflow'); if (ws) ws.style.display = 'block';
      const pd = document.getElementById('portfolioDashboard'); if (pd) pd.style.display = 'none';
      PropertyOS.linkRecord(w.id, 'event', job.id);
      PropertyOS.renderPropertyPage(_props[0]);
      const body = document.getElementById('propertyOsBody');
      const over = [].slice.call(body.querySelectorAll('*'))
        .filter(function (e) { return e.scrollWidth > e.clientWidth + 4 && getComputedStyle(e).overflowX === 'visible'; })
        .map(function (e) { return (typeof e.className === 'string' ? e.className : e.tagName) + ' ' + e.scrollWidth + '>' + e.clientWidth; });
      return { sideways: document.documentElement.scrollWidth > window.innerWidth + 2, over: over.slice(0, 4) };
    });
    await mctx.close();
    return out;
  })();
  check('the Property workspace does not scroll sideways at 390px',
        mobile.sideways === false, mobile.sideways ? 'page is wider than the viewport' : 'fits');
  check('and no element inside it overflows its container',
        mobile.over.length === 0, mobile.over.join(' | '));

  // ── Christy's first-impression pass ──────────────────────────────────────
  const polish = await page.evaluate(() => {
    const p = _props[0];
    p.timeline = [];
    const mk = (t, c, sys) => appendPropertyTimelineEvent(p, {
      manual: true, type: 'manual_' + c, category: c, title: t, timestamp: new Date().toISOString(),
      subject: sys ? { type: 'system', id: sys, label: sys } : { type: 'property', id: p.id },
      actor: 'dana@example.com', metadata: { recordedBy: 'dana@example.com' } });
    mk('2026 assessment notice', 'real_estate_taxes', null);
    mk('General liability renewal', 'insurance', null);
    mk('Roof replaced', 'capital_improvement', 'roof');
    // A system-generated entry: not editable, so it must not offer Edit.
    appendPropertyTimelineEvent(p, { type: 'lease_uploaded', title: 'Lease uploaded — Suite 210',
      timestamp: new Date().toISOString(), subject: { type: 'property', id: p.id } });
    document.getElementById('propertyName').value = 'Maple Plaza';
    document.getElementById('totalSqft').value = '32000';
    PropertyOS.renderPropertyPage(p);

    const body = document.getElementById('propertyOsBody');
    const cards = [].slice.call(body.querySelectorAll('.pos-rec'));
    const empties = [].slice.call(body.querySelectorAll('.pos-ri-empty')).map(e => e.textContent.trim());
    const byCat = {};
    cards.forEach(c => {
      const cat = (c.querySelector('.pos-rec-cat') || {}).textContent || '';
      const em  = (c.querySelector('.pos-ri-empty') || {}).textContent || '';
      const btns = [].slice.call(c.querySelectorAll('.pos-ri-add')).map(b => b.textContent.trim());
      byCat[cat.trim()] = { empty: em.trim(), btns: btns };
    });
    const setup = document.getElementById('cardSetup');
    const sum = document.getElementById('posSetupSummary');
    return {
      empties, byCat,
      uniqueEmpties: new Set(empties).size,
      relBlockDisplay: getComputedStyle(body.querySelector('.pos-ri')).display,
      setupHidden: getComputedStyle(setup).display === 'none',
      summaryText: sum ? (sum.innerText || '').replace(/\s+/g, ' ').trim() : null,
    };
  });

  // 1 · empty-state copy must describe THIS record, not a roof repair
  check('the related-items empty state differs by category',
        polish.uniqueEmpties === polish.empties.length && polish.empties.length >= 3,
        polish.uniqueEmpties + ' distinct of ' + polish.empties.length);
  check('a tax record is not told about contractor invoices and photos',
        !/contractor invoice|photos for this job/i.test(
          (polish.byCat['🏛️ Real Estate Taxes'] || {}).empty || ''),
        ((polish.byCat['🏛️ Real Estate Taxes'] || {}).empty || '').slice(0, 80));
  check('an insurance record talks about policies and claims',
        /polic|claim/i.test((polish.byCat['🛡️ Insurance'] || {}).empty || ''),
        ((polish.byCat['🛡️ Insurance'] || {}).empty || '').slice(0, 80));

  // 2 · Edit on the record, and only where it works
  check('every manual record offers Edit on the card itself',
        Object.keys(polish.byCat).filter(k => /Taxes|Insurance|Capital/.test(k))
          .every(k => (polish.byCat[k].btns || []).some(b => /Edit/.test(b))),
        JSON.stringify(polish.byCat['🏛️ Real Estate Taxes'] && polish.byCat['🏛️ Real Estate Taxes'].btns));
  const autoKey = Object.keys(polish.byCat).find(k => /Lease/i.test(k));
  check('a system-generated record does NOT offer an Edit that would refuse',
        !autoKey || !(polish.byCat[autoKey].btns || []).some(b => /Edit/.test(b)),
        autoKey ? JSON.stringify(polish.byCat[autoKey].btns) : 'no auto record rendered');

  // 3 · class collision — .pos-rel already meant "invoice relation label"
  check('the Related Items block is not styled by the invoice-register .pos-rel rule',
        polish.relBlockDisplay === 'block', polish.relBlockDisplay);

  // 4 · setup collapses once configured, without losing the only edit path
  check('the first-run setup card is hidden once the property is configured',
        polish.setupHidden, polish.setupHidden ? 'hidden' : 'still showing');
  check('and is replaced by a summary that still offers Edit',
        /Maple Plaza/.test(polish.summaryText || '') && /32,000 sq ft/.test(polish.summaryText || '')
          && /Edit/.test(polish.summaryText || ''), polish.summaryText);

  // The hidden-once-configured check passes vacuously if something ELSE is
  // hiding the card. Prove the mechanism by clearing the configuration: an
  // unconfigured property must show the setup card, because then it is the job.
  const unconfigured = await page.evaluate(() => {
    document.getElementById('propertyName').value = '';
    document.getElementById('totalSqft').value = '';
    PropertyOS.renderPropertyPage(_props[0]);
    const setup = document.getElementById('cardSetup');
    const sum = document.getElementById('posSetupSummary');
    const out = { setupShown: getComputedStyle(setup).display !== 'none',
                  summaryShown: !!sum && getComputedStyle(sum).display !== 'none' };
    document.getElementById('propertyName').value = 'Maple Plaza';
    document.getElementById('totalSqft').value = '32000';
    PropertyOS.renderPropertyPage(_props[0]);
    return out;
  });
  check('an UNconfigured property still shows the setup card — it is the job',
        unconfigured.setupShown, unconfigured.setupShown ? 'shown' : 'hidden even when unconfigured');
  check('and shows no summary of a property that has none',
        !unconfigured.summaryShown);

  const reopened = await page.evaluate(() => {
    PropertyOS.toggleSetup();
    const setup = document.getElementById('cardSetup');
    return { shown: getComputedStyle(setup).display !== 'none',
             nameField: !!document.getElementById('propertyName') };
  });
  check('Edit re-opens setup, so name and sqft stay reachable',
        reopened.shown && reopened.nameField, JSON.stringify(reopened));

  check('no uncaught errors across the workspace', errs.length === 0,
        errs.slice(0, 2).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
