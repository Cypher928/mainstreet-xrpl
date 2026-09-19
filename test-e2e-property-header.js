// test-e2e-property-header.js
// ============================================================================
// THE PROPERTY WORKSPACE HEADER IS THE PROPERTY, NOT A CAM YEAR.
//
// The header carries the CAM year in force — the breadcrumb badge on desktop,
// the line under the name on mobile. Beside the Taxes, Insurance or Building
// & Systems drawers that read as if the cabinet were scoped to a year. On the
// Property and Spaces tabs the header reads the property's name and nothing
// else; on Overview, CAM, Reports and Reserves it reads exactly as before.
//
// Run: node test-e2e-property-header.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8973;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const yes = (c, label, d) => c ? ok(label) : bad(label, d);

const MOCK = `window.supabase={createClient:function(){return {auth:{
    getUser:function(){return Promise.resolve({data:{user:{id:'hdr-user-0001-4000-a000-000000000001',email:'pm@example.com'}},error:null});},
    getSession:function(){return Promise.resolve({data:{session:{user:{id:'hdr-user-0001-4000-a000-000000000001'}}},error:null});},
    onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:{id:'hdr-user-0001-4000-a000-000000000001'}});},40);return {data:{subscription:{unsubscribe:function(){}}}};},
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
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`;

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

  const boot = async (viewport) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript('window.__TEST_AUTHED=true;');
    await page.addInitScript(MOCK);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { window.MainStreetLanding && window.MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForTimeout(500);
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => {
      const el = document.getElementById('mainWorkflow');
      return el && el.style.display !== 'none' && (currentProperty() || {}).name === 'Cascade Commons';
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    return { page, errs };
  };

  // What the header reads: the visible text of the breadcrumb (desktop) and the
  // mobile bar, and whether each CAM-year element is shown.
  const HEADER = `(function () {
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const bc = document.getElementById('propertyBreadcrumb'), mb = document.getElementById('wsMobileBar');
    const badge = document.getElementById('camYearBadge'), my = document.getElementById('wsMobileCamYear');
    const text = el => vis(el) ? el.innerText.replace(/\\s+/g, ' ').trim() : null;
    const pathEl = bc && bc.querySelector('.breadcrumb-path');
    return { tab: _activeWorkspaceTab, breadcrumb: text(bc), mobile: text(mb),
             path: vis(pathEl) ? pathEl.innerText.replace(/\\s+/g, ' ').trim() : null,
             badgeShown: vis(badge), badgeText: badge ? badge.textContent : null,
             mobileYearShown: vis(my), mobileYearText: my ? my.textContent : null,
             year: getCamYear() };
  })()`;
  const header = (page, tab) => page.evaluate((args) => { switchWorkspaceTab(args.tab); return eval(args.src); }, { tab, src: HEADER });

  // ══ desktop ════════════════════════════════════════════════════════════════
  sec('desktop · the breadcrumb');
  const D = await boot({ width: 1400, height: 1000 });
  const ov = await header(D.page, 'overview');
  is(ov.year, 2025, 'the demo is on its 2025 reconciliation');
  yes(ov.badgeShown && ov.badgeText === '2025 CAM', 'Overview: the header shows the "2025 CAM" badge, as before', JSON.stringify(ov));
  const pr = await header(D.page, 'property');
  yes(!pr.badgeShown, 'Property: the "2025 CAM" badge is not shown', JSON.stringify(pr));
  is(pr.path, 'Portfolio › Cascade Commons', 'the header reads "Portfolio › Cascade Commons" and nothing about a CAM year');
  yes(pr.breadcrumb && !/CAM/.test(pr.breadcrumb.split(' Ask AI')[0]), 'no "CAM" anywhere in the header text on Property');
  for (const drawer of ['taxes', 'insurance', 'financing', 'building', 'history']) {
    const d = await D.page.evaluate((args) => { PropertyCabinetView.openDrawer(args.k); return eval(args.src); }, { k: drawer, src: HEADER });
    yes(d.tab === 'property' && !d.badgeShown, `…and stays that way inside the ${drawer} drawer`, JSON.stringify(d));
  }
  const sp = await header(D.page, 'spaces');
  yes(!sp.badgeShown, 'Spaces: the badge is not shown either — the Space file is not a CAM year', JSON.stringify(sp));
  const cam = await header(D.page, 'cam');
  yes(cam.badgeShown && cam.badgeText === '2025 CAM', 'CAM: "2025 CAM" is back, unchanged', JSON.stringify(cam));
  const camTitle = await D.page.evaluate(() => (document.getElementById('resultsTitle') || {}).textContent || '');
  yes(/^2025 CAM — Cascade Commons$/.test(camTitle), 'and the CAM results heading still reads "2025 CAM — Cascade Commons"', camTitle);
  const rp = await header(D.page, 'reports');
  yes(rp.badgeShown, 'Reports: shown, as before');
  const rs = await header(D.page, 'reserves');
  yes(rs.badgeShown, 'Reserves: shown, as before');
  const back = await header(D.page, 'property');
  yes(!back.badgeShown, 'back on Property: hidden again');
  const changed = await D.page.evaluate((src) => { setCamYear(2024); return eval(src); }, HEADER);
  yes(!changed.badgeShown && changed.badgeText === '2024 CAM', 'a CAM-year change while on Property keeps the badge maintained but still hidden', JSON.stringify(changed));
  const camAfter = await header(D.page, 'cam');
  yes(camAfter.badgeShown && camAfter.badgeText === '2024 CAM', '…and CAM shows the new year', JSON.stringify(camAfter));
  is(D.errs, [], 'no uncaught errors (desktop)');
  await D.page.context().close();

  // ══ mobile ═════════════════════════════════════════════════════════════════
  sec('mobile · the compact bar');
  const M = await boot({ width: 400, height: 860 });
  const mo = await header(M.page, 'overview');
  yes(mo.mobileYearShown && mo.mobileYearText === '2025 CAM' && /Cascade Commons/.test(mo.mobile || ''), 'Overview: name with "2025 CAM" beneath, as before', JSON.stringify(mo));
  const mp = await header(M.page, 'property');
  yes(!mp.mobileYearShown && /Cascade Commons/.test(mp.mobile || '') && !/CAM/.test(mp.mobile || ''), 'Property: the name alone — no year line', JSON.stringify(mp));
  const mc = await header(M.page, 'cam');
  yes(mc.mobileYearShown && mc.mobileYearText === '2025 CAM', 'CAM: the year line is back', JSON.stringify(mc));
  is(M.errs, [], 'no uncaught errors (mobile)');
  await M.page.context().close();

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
