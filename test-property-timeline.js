'use strict';
/**
 * test-property-timeline.js — Property Timeline v1 (Phase 2) verification.
 * Reuses the local-server + Supabase-mock pattern from test-e2e-activity-timeline.js.
 * Verifies: schema defaults, registry describe(), enhanced render (day dividers,
 * responsibility badge, lease-ref chip, attachments), and the add-entry modal
 * end-to-end (fill → save → new manual row persists in property.timeline).
 */
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/home/user/mainstreet-xrpl', PORT = 8733;
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon' };
let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const sec = m => console.log('\n── ' + m + ' ──');

// Reuse the exact Supabase mock shape from test-e2e-activity-timeline.js.
const SRC = fs.readFileSync(path.join(ROOT, 'test-e2e-activity-timeline.js'), 'utf8');
const SUPABASE_MOCK = SRC.slice(SRC.indexOf('const SUPABASE_MOCK = `') + 'const SUPABASE_MOCK = `'.length, SRC.indexOf('`;\n\n(async'));

const srv = http.createServer((rq, rs) => {
  let f = path.join(ROOT, rq.url === '/' ? '/index.html' : rq.url).split('?')[0];
  fs.readFile(f, (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; } rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); rs.end(d); });
});

srv.listen(PORT, '127.0.0.1', async () => {
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); }
  catch (_) { browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }); }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push({ t: m.type(), x: m.text() }));
  page.on('pageerror', e => logs.push({ t: 'PAGEERROR', x: e.message }));
  await page.route('**/supabase-js**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/*mock*/' }));
  await page.addInitScript(SUPABASE_MOCK);

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => { const a = document.getElementById('appContent'); return a && a.style.display !== 'none' && a.style.display !== ''; }, { timeout: 10000 });
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => { const el = document.getElementById('mainWorkflow'); return el && el.style.display !== 'none'; }, { timeout: 15000 });
    await page.evaluate(() => switchWorkspaceTab('overview'));
    await page.waitForTimeout(500);

    sec('Module + registry');
    const reg = await page.evaluate(() => ({
      exists: !!window.PropertyTimeline,
      maint: window.PropertyTimeline && PropertyTimeline.describe({ manual: true, category: 'maintenance' }),
      lease: window.PropertyTimeline && PropertyTimeline.describe({ type: 'lease_uploaded' }),
      cats:  window.PropertyTimeline && PropertyTimeline.categories.map(c => c.key),
    }));
    reg.exists ? ok('window.PropertyTimeline loaded') : bad('module missing');
    (reg.maint && reg.maint.label === 'Maintenance') ? ok('describe() resolves manual category → "Maintenance"') : bad('describe manual', JSON.stringify(reg.maint));
    (reg.lease && reg.lease.label === 'Lease') ? ok('describe() resolves auto type → "Lease"') : bad('describe auto', JSON.stringify(reg.lease));
    (reg.cats && reg.cats.includes('maintenance') && reg.cats.includes('capital_improvement') && reg.cats.length === 11) ? ok('11 property-management categories registered') : bad('categories', JSON.stringify(reg.cats));

    sec('Schema defaults (additive, back-compatible)');
    const sch = await page.evaluate(() => {
      const p = currentProperty();
      const e = appendPropertyTimelineEvent(p, { type: 'x_test', title: 't' });
      return { manual: e.manual, responsibility: e.responsibility, leaseRef: e.leaseRef, attachments: Array.isArray(e.attachments) && e.attachments.length };
    });
    (sch.manual === false && sch.responsibility === 'na' && sch.leaseRef === null && sch.attachments === 0)
      ? ok('new fields default safely (manual:false, responsibility:na, leaseRef:null, attachments:[])')
      : bad('schema defaults', JSON.stringify(sch));

    sec('Enhanced render — header, add button, day dividers');
    const r = await page.evaluate(() => {
      const s = document.getElementById('propertyActivitySlot');
      return {
        header: /Property Timeline/.test(s.innerHTML),
        addBtn: !!s.querySelector('.tl-add-btn'),
        dividers: s.querySelectorAll('.tl-day-divider').length,
      };
    });
    r.header ? ok('panel titled "Property Timeline"') : bad('header');
    r.addBtn ? ok('"+ Add" button present') : bad('no add button');
    r.dividers > 0 ? ok('day dividers render (' + r.dividers + ')') : bad('no day dividers');

    sec('Render of new fields — responsibility, lease ref, attachments');
    await page.evaluate(() => {
      const p = currentProperty();
      appendPropertyTimelineEvent(p, {
        manual: true, type: 'manual_maintenance', category: 'maintenance', severity: 'info',
        title: 'Roof leak patched — Bldg C', description: 'Vendor: PavePro',
        responsibility: 'tenant', leaseRef: '§7.2 Roof & Structure',
        attachments: [{ name: 'roof.jpg', url: 'https://mock.local/roof.jpg', kind: 'photo' },
                      { name: 'pavepro.pdf', url: 'https://mock.local/pavepro.pdf', kind: 'invoice' }],
        actor: 'Property Manager', timestamp: new Date().toISOString(),
      });
      renderPropertyActivity(p);
    });
    await page.waitForTimeout(200);
    const nf = await page.evaluate(() => {
      const s = document.getElementById('propertyActivitySlot');
      return {
        resp:  !!s.querySelector('.tl-resp--tenant'),
        lease: /§7.2 Roof/.test(s.innerHTML) && !!s.querySelector('.tl-lease-ref'),
        thumb: !!s.querySelector('.tl-thumb'),
        chip:  !!s.querySelector('.tl-attach:not(.tl-attach--photo)'),
        badge: Array.from(s.querySelectorAll('.tl-type-badge')).some(b => b.textContent === 'Maintenance'),
      };
    });
    nf.badge ? ok('manual entry renders with "Maintenance" badge') : bad('no maintenance badge');
    nf.resp  ? ok('responsibility badge (Tenant) renders') : bad('no responsibility badge');
    nf.lease ? ok('lease-ref chip renders (§7.2 …)') : bad('no lease ref');
    nf.thumb ? ok('photo attachment renders as thumbnail') : bad('no photo thumb');
    nf.chip  ? ok('invoice/PDF attachment renders as chip') : bad('no attachment chip');

    sec('Add-entry form — field order + Save validation');
    await page.evaluate(() => { window.uploadInvoiceFile = async () => ({ url: 'https://mock.local/up.png', error: null }); });
    await page.evaluate(() => PropertyTimeline.openAddEntry(currentProperty()));
    await page.waitForSelector('#ptlOverlay', { timeout: 3000 });
    ok('modal opens');
    const firstLabel = await page.evaluate(() => { const l = document.querySelector('#ptlOverlay .ptl-field .ptl-label'); return l ? l.textContent.trim() : ''; });
    (firstLabel === 'What happened') ? ok('"What happened" is the first field') : bad('form order', firstLabel);
    const disabled0 = await page.evaluate(() => document.getElementById('ptlSave').disabled);
    disabled0 ? ok('Save disabled while "What happened" is empty') : bad('Save not disabled initially');
    await page.fill('#ptlTitle', 'Tenant reported HVAC noise');
    await page.waitForTimeout(60);
    const enabled1 = await page.evaluate(() => !document.getElementById('ptlSave').disabled);
    enabled1 ? ok('Save enables once "What happened" has content') : bad('Save not enabled after typing');

    sec('Add-entry — save persists (new category taxonomy)');
    const before = await page.evaluate(() => (currentProperty().timeline || []).length);
    await page.selectOption('#ptlCat', 'tenant');
    await page.fill('#ptlNotes', 'Call from tenant 3pm; scheduled vendor.');
    await page.check('input[name="ptlResp"][value="landlord"]');
    await page.fill('#ptlLease', '§9.1 HVAC');
    await page.click('#ptlSave');
    await page.waitForSelector('#ptlOverlay', { state: 'detached', timeout: 5000 });
    const saved = await page.evaluate(() => {
      const tl = currentProperty().timeline || []; const e = tl[tl.length - 1];
      return { id: e.id, len: tl.length, title: e.title, manual: e.manual, cat: e.category, resp: e.responsibility, lease: e.leaseRef };
    });
    (saved.len === before + 1) ? ok('one entry appended') : bad('count', before + '→' + saved.len);
    (saved.title === 'Tenant reported HVAC noise' && saved.manual === true && saved.cat === 'tenant'
      && saved.resp === 'landlord' && saved.lease === '§9.1 HVAC')
      ? ok('entry persisted (title, category=tenant, responsibility=landlord, leaseRef)')
      : bad('persisted fields', JSON.stringify(saved));

    sec('Edit existing entry — same modal, update in place');
    await page.evaluate(id => PropertyTimeline.openEditEntry(id), saved.id);
    await page.waitForSelector('#ptlOverlay', { timeout: 3000 });
    const pf = await page.evaluate(() => ({
      title: document.getElementById('ptlTitle').value,
      cat: document.getElementById('ptlCat').value,
      saveOn: !document.getElementById('ptlSave').disabled,
      heading: document.querySelector('.ptl-title').textContent,
    }));
    (pf.title === 'Tenant reported HVAC noise' && pf.cat === 'tenant' && pf.saveOn && /Edit/.test(pf.heading))
      ? ok('edit modal prefills fields, Save enabled, "Edit" heading') : bad('edit prefill', JSON.stringify(pf));
    await page.fill('#ptlTitle', 'Tenant reported HVAC noise — Suite 210');
    await page.click('#ptlSave');
    await page.waitForSelector('#ptlOverlay', { state: 'detached', timeout: 5000 });
    const edited = await page.evaluate(id => {
      const tl = currentProperty().timeline || []; const e = tl.find(x => x.id === id);
      return { len: tl.length, title: e ? e.title : null };
    }, saved.id);
    (edited.len === before + 1 && edited.title === 'Tenant reported HVAC noise — Suite 210')
      ? ok('edit updates in place (same id, no new row, new title)') : bad('edit', JSON.stringify(edited));
    const shown = await page.evaluate(() => /Suite 210/.test(document.getElementById('propertyActivitySlot').innerHTML));
    shown ? ok('edited text appears in the rendered timeline') : bad('edit not rendered');
    const hasEditBtn = await page.evaluate(() => !!document.querySelector('#propertyActivitySlot .tl-edit-btn'));
    hasEditBtn ? ok('manual entries expose an Edit affordance in the timeline') : bad('no edit button rendered');

    sec('Connected workspace — timeline event → source pane (move #1)');
    const navChecks = await page.evaluate(() => {
      const tl = currentProperty().timeline || [];
      const disp = tl.find(e => e.type === 'dispute_created' || e.type === 'dispute_resolved');
      return {
        hasDisp: !!disp,
        dispNav: disp ? !!PropertyTimeline.navFor(disp) : false,
        manualNav: PropertyTimeline.navFor({ manual: true, category: 'note' }),
      };
    });
    navChecks.dispNav ? ok('dispute event exposes a "View" source link (navFor)') : bad('dispute has no nav');
    (navChecks.manualNav === null) ? ok('manual note has no "View" (it is its own record)') : bad('manual nav should be null', JSON.stringify(navChecks.manualNav));
    const hasViewBtn = await page.evaluate(() => !!document.querySelector('#propertyActivitySlot .tl-view-btn'));
    hasViewBtn ? ok('auto events render a "View →" affordance in the timeline') : bad('no view button rendered');
    const switched = await page.evaluate(() => {
      const tl = currentProperty().timeline || [];
      const disp = tl.find(e => e.type === 'dispute_created' || e.type === 'dispute_resolved');
      PropertyTimeline.viewSource(disp.id);
      const cam = document.getElementById('wsPane-cam');
      return cam ? getComputedStyle(cam).display !== 'none' : false;
    });
    switched ? ok('clicking "View" on a dispute event switches to the CAM pane') : bad('did not switch to CAM pane');
    // return to overview so the console-error scan sees a clean state
    await page.evaluate(() => switchWorkspaceTab('overview'));
    await page.waitForTimeout(200);

    sec('Complete event coverage — workflow types register + link (move #2)');
    const cov = await page.evaluate(() => ({
      cam:    PropertyTimeline.describe({ type: 'cam_reconciled' }).label,
      res:    PropertyTimeline.describe({ type: 'reserve_updated' }).label,
      camTab: (PropertyTimeline.navFor({ type: 'cam_reconciled' }) || {}).tab,
      resTab: (PropertyTimeline.navFor({ type: 'reserve_updated' }) || {}).tab,
    }));
    (cov.cam === 'CAM') ? ok('cam_reconciled registers as "CAM"') : bad('cam label', cov.cam);
    (cov.res === 'Reserve') ? ok('reserve_updated registers as "Reserve"') : bad('reserve label', cov.res);
    (cov.camTab === 'cam') ? ok('cam_reconciled links to the CAM pane') : bad('cam nav', cov.camTab);
    (cov.resTab === 'reserves') ? ok('reserve_updated links to the Reserves pane') : bad('reserve nav', cov.resTab);
    const camRendered = await page.evaluate(() => {
      const p = currentProperty();
      appendPropertyTimelineEvent(p, { type: 'cam_reconciled', severity: 'success', title: 'CAM reconciled — 2025', description: '5 tenants · $185,450 in expenses', actor: 'Property Manager' });
      renderPropertyActivity(p);
      const s = document.getElementById('propertyActivitySlot');
      return Array.from(s.querySelectorAll('.tl-type-badge')).some(b => b.textContent === 'CAM') && /CAM reconciled — 2025/.test(s.innerHTML);
    });
    camRendered ? ok('a cam_reconciled event renders with a "CAM" badge + summary') : bad('cam event not rendered');
    await page.evaluate(() => switchWorkspaceTab('overview'));
    await page.waitForTimeout(150);

    sec('Advisor surface — "What needs your attention" (move #3)');
    const attn = await page.evaluate(() => {
      const p = currentProperty();
      const tenants = (p.tenants || []).map(t => Object.assign({}, t));
      if (tenants[0]) tenants[0].end_date = '2020-01-01'; // force an expired lease
      const test = Object.assign({}, p, { tenants, disputes: [{ id: 9991, status: 'open' }] });
      const items = PropertyWorkspace.collectAttention(test);
      return {
        first: items[0] && items[0].severity,
        hasExpired: items.some(i => /expired/.test(i.title)),
        hasDispute: items.some(i => /dispute/.test(i.title)),
        allHaveWhyAndAction: items.every(i => i.why && i.action),
      };
    });
    (attn.first === 'critical') ? ok('most severe item ranks first (prioritization)') : bad('ranking', attn.first);
    attn.hasExpired ? ok('expired lease surfaces as an attention item') : bad('no expired item');
    attn.hasDispute ? ok('open dispute surfaces as an attention item') : bad('no dispute item');
    attn.allHaveWhyAndAction ? ok('every item carries a "why" and one action (what/why/what-next)') : bad('items missing why/action');

    const rendered = await page.evaluate(() => {
      const p = currentProperty();
      const tenants = (p.tenants || []).map(t => Object.assign({}, t));
      if (tenants[0]) tenants[0].end_date = '2020-01-01';
      PropertyWorkspace.renderAttention(Object.assign({}, p, { tenants, disputes: [{ id: 1, status: 'open' }] }));
      const slot = document.getElementById('propertyAttentionSlot');
      const act = document.getElementById('propertyActivitySlot');
      const before = slot && act && (slot.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        exists: !!slot,
        before: !!before,
        title: slot ? /What needs your attention/.test(slot.innerHTML) : false,
        shown: slot ? slot.querySelectorAll('.pw-item').length : 0,
        action: slot ? !!slot.querySelector('.pw-item-act') : false,
      };
    });
    rendered.exists ? ok('attention panel renders') : bad('no panel');
    rendered.before ? ok('panel sits above the timeline in the overview') : bad('panel placement');
    rendered.title ? ok('panel titled "What needs your attention"') : bad('no title');
    (rendered.shown >= 1 && rendered.shown <= 3) ? ok('shows a ranked, capped set (' + rendered.shown + ' ≤ 3) — prioritization over density') : bad('cap', String(rendered.shown));
    rendered.action ? ok('each item has one clear action button') : bad('no action button');

    const clear = await page.evaluate(() => {
      PropertyWorkspace.renderAttention({ id: 'x', tenants: [], disputes: [], camReconciliation: null });
      const s = document.getElementById('propertyAttentionSlot');
      return s ? /all caught up/i.test(s.innerHTML) : false;
    });
    clear ? ok('"all caught up" state when nothing needs action (reduces load)') : bad('no clear state');

    const navd = await page.evaluate(() => {
      const p = currentProperty();
      const tenants = (p.tenants || []).map(t => Object.assign({}, t));
      if (tenants[0]) tenants[0].end_date = '2020-01-01';
      PropertyWorkspace.renderAttention(Object.assign({}, p, { tenants, disputes: [] }));
      PropertyWorkspace.act(0); // first item = expired lease → documents pane
      const docs = document.getElementById('wsPane-documents');
      return docs ? getComputedStyle(docs).display !== 'none' : false;
    });
    navd ? ok('clicking an item action navigates to its source pane') : bad('action did not navigate');
    await page.evaluate(() => { renderProperty(currentProperty()); switchWorkspaceTab('overview'); });
    await page.waitForTimeout(200);

    sec('Contextual records — subject/scope room (Property + Tenant Space)');
    const subj = await page.evaluate(() => {
      const p = currentProperty(); const t = (p.tenants || [])[0];
      const suiteEv = appendPropertyTimelineEvent(p, { type: 'manual_note', manual: true, category: 'note', title: 'suite note', tenantId: t && t.id });
      const propEv  = appendPropertyTimelineEvent(p, { type: 'manual_note', manual: true, category: 'note', title: 'prop note' });
      return { suiteType: suiteEv.subject && suiteEv.subject.type, suiteId: suiteEv.subject && suiteEv.subject.id, propType: propEv.subject && propEv.subject.type, tId: t && t.id };
    });
    (subj.suiteType === 'suite' && subj.suiteId === subj.tId) ? ok('event with a tenant → subject {type:"suite"}') : bad('suite subject', JSON.stringify(subj));
    (subj.propType === 'property') ? ok('event without a tenant → subject {type:"property"}') : bad('property subject', subj.propType);

    const scope = await page.evaluate(() => {
      const p = currentProperty(); renderPropertyActivity(p);
      const hasSel = !!document.querySelector('#propertyActivitySlot .tl-scope-sel');
      const t = (p.tenants || [])[0];
      filterTimelineScope(t.id);
      const s = document.getElementById('propertyActivitySlot');
      const shownTitles = Array.from(s.querySelectorAll('.tl-title')).map(e => e.textContent);
      const belongs = (p.timeline || []).filter(e => (e.subject && e.subject.id === t.id) || e.tenantId === t.id).length;
      filterTimelineScope(null);
      return { hasSel, shown: shownTitles.length, belongs };
    });
    scope.hasSel ? ok('timeline shows a Space (subject) selector') : bad('no scope selector');
    (scope.belongs > 0 && scope.shown > 0 && scope.shown <= scope.belongs) ? ok('scoping to a tenant space narrows the timeline to that space') : bad('scope filter', JSON.stringify(scope));

    const spaceSave = await page.evaluate(async () => {
      window.uploadInvoiceFile = async () => ({ url: 'x', error: null });
      PropertyTimeline.openAddEntry(currentProperty());
      const hasSpace = !!document.getElementById('ptlSpace');
      const t = (currentProperty().tenants || [])[0];
      const ti = document.getElementById('ptlTitle');
      ti.value = 'Roof patch — space'; ti.dispatchEvent(new Event('input'));
      if (document.getElementById('ptlSpace')) document.getElementById('ptlSpace').value = t.id;
      document.getElementById('ptlSave').click();
      await new Promise(r => setTimeout(r, 300));
      const tl = currentProperty().timeline || []; const e = tl[tl.length - 1];
      return { hasSpace, subjType: e.subject && e.subject.type, subjId: e.subject && e.subject.id, tId: t.id };
    });
    spaceSave.hasSpace ? ok('add-entry modal has a "Space" field') : bad('no space field');
    (spaceSave.subjType === 'suite' && spaceSave.subjId === spaceSave.tId) ? ok('saving with a space tags the entry to that tenant space') : bad('space save', JSON.stringify(spaceSave));

    sec('Tenant Space view — the complete story of a space');
    const wk = await page.evaluate(() => {
      const p = currentProperty();
      const e = appendPropertyTimelineEvent(p, { title: 'w', attachments: [{ name: 'w.pdf', url: 'https://m/w.pdf', kind: 'warranty' }] });
      return e.attachments[0].kind;
    });
    (wk === 'warranty') ? ok('warranty is a first-class attachment kind (a record, not a module)') : bad('warranty kind', wk);

    const rec = await page.evaluate(() => {
      const p = currentProperty(); const t = (p.tenants || [])[0];
      appendPropertyTimelineEvent(p, {
        manual: true, type: 'manual_maintenance', category: 'maintenance', title: 'HVAC replaced', tenantId: t.id,
        responsibility: 'landlord', leaseRef: '§8.3',
        attachments: [{ name: 'invoice.pdf', url: 'https://m/inv.pdf', kind: 'invoice' },
                      { name: 'warranty.pdf', url: 'https://m/war.pdf', kind: 'warranty' },
                      { name: 'unit.jpg', url: 'https://m/u.jpg', kind: 'photo' }],
      });
      const r = TenantSpace.assemble(p, t.id);
      return { inv: r.counts.invoices, warr: r.counts.warranties, ph: r.counts.photos, summary: r.summary };
    });
    (rec.inv >= 1) ? ok('space record gathers invoices from the scoped timeline') : bad('invoices', String(rec.inv));
    (rec.warr >= 1) ? ok('space record gathers warranties') : bad('warranties', String(rec.warr));
    (rec.ph >= 1) ? ok('space record gathers photos') : bad('photos', String(rec.ph));
    (/warranty doc/.test(rec.summary)) ? ok('grounded space summary reads the record ("warranty on file")') : bad('summary', rec.summary);

    const view = await page.evaluate(() => {
      const p = currentProperty(); const t = (p.tenants || [])[0];
      TenantSpace.openSpace(t.id);
      const ov = document.getElementById('tsOverlay');
      const titles = ov ? Array.from(ov.querySelectorAll('.ts-sec-title')).map(e => e.textContent) : [];
      const photoImg = ov ? !!ov.querySelector('.ts-photo img') : false;
      TenantSpace.closeSpace();
      return { open: !!ov, framing: ov ? /Everything about this space/.test(ov.innerHTML) : false, titles, photoImg };
    });
    view.open ? ok('Tenant Space view opens') : bad('space view did not open');
    view.framing ? ok('"everything about this space, in one place" framing present') : bad('no framing');
    (['Lease & terms', 'Timeline', 'Photos', 'Invoices', 'Warranties', 'Documents', 'Notes', 'CAM activity'].every(s => view.titles.includes(s)))
      ? ok('all sections render (lease · timeline · photos · invoices · warranties · docs · notes · CAM)') : bad('sections', JSON.stringify(view.titles));
    view.photoImg ? ok('photos render as thumbnails in the space view') : bad('no photo thumbnails');

    const openBtn = await page.evaluate(() => {
      const t = (currentProperty().tenants || [])[0];
      filterTimelineScope(t.id);
      const has = !!document.querySelector('#propertyActivitySlot .tl-open-space');
      filterTimelineScope(null);
      return has;
    });
    openBtn ? ok('timeline scope bar offers "Open space →" when a space is selected') : bad('no open-space button');

    sec('Console errors');
    const errs = logs.filter(l => (l.t === 'error' || l.t === 'PAGEERROR')
      && !/favicon|Failed to load resource|ERR_CERT|\[saveCamResults\]|\[loadCamResults\]|net::ERR/.test(l.x));
    errs.length === 0 ? ok('no unexpected console errors') : bad('console errors', JSON.stringify(errs.slice(0, 4)));
  } catch (e) {
    bad('UNCAUGHT', e.message);
    logs.slice(-25).forEach(l => console.error('   ' + l.t + ': ' + l.x));
  } finally {
    await browser.close(); srv.close();
    console.log('\n' + (fail === 0 ? '\x1b[32m' : '\x1b[31m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
    process.exit(fail === 0 ? 0 : 1);
  }
});
