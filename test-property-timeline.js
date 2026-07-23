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
    (reg.cats && reg.cats.includes('maintenance') && reg.cats.length === 6) ? ok('6 manual categories registered') : bad('categories', JSON.stringify(reg.cats));

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

    sec('Add-entry modal — end-to-end (fill → save → persists)');
    await page.evaluate(() => { window.uploadInvoiceFile = async () => ({ url: 'https://mock.local/up.png', error: null }); });
    const before = await page.evaluate(() => (currentProperty().timeline || []).length);
    await page.evaluate(() => PropertyTimeline.openAddEntry(currentProperty()));
    await page.waitForSelector('#ptlOverlay', { timeout: 3000 });
    ok('modal opens');
    await page.fill('#ptlTitle', 'Tenant reported HVAC noise');
    await page.selectOption('#ptlCat', 'communication');
    await page.fill('#ptlNotes', 'Call from tenant 3pm; scheduled vendor.');
    await page.check('input[name="ptlResp"][value="landlord"]');
    await page.fill('#ptlLease', '§9.1 HVAC');
    await page.click('#ptlSave');
    await page.waitForSelector('#ptlOverlay', { state: 'detached', timeout: 5000 });
    ok('modal closes after Save');
    const saved = await page.evaluate(() => {
      const tl = currentProperty().timeline || [];
      const e = tl[tl.length - 1];
      return { len: tl.length, title: e.title, manual: e.manual, cat: e.category, resp: e.responsibility, lease: e.leaseRef };
    });
    (saved.len === before + 1) ? ok('one entry appended') : bad('count', before + '→' + saved.len);
    (saved.title === 'Tenant reported HVAC noise' && saved.manual === true && saved.cat === 'communication'
      && saved.resp === 'landlord' && saved.lease === '§9.1 HVAC')
      ? ok('entry persisted with title, manual, category, responsibility, leaseRef')
      : bad('persisted fields', JSON.stringify(saved));
    const shown = await page.evaluate(() => /Tenant reported HVAC noise/.test(document.getElementById('propertyActivitySlot').innerHTML));
    shown ? ok('new entry appears in the rendered timeline') : bad('entry not rendered');

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
