// test-e2e-spaces-list.js
// ============================================================================
// PROPERTY WORKSPACE V2, PHASE 1 — Spaces as the tenant files.
//
//   · one row per PHYSICAL space, occupied or vacant, with Suite · Tenant ·
//     Sq ft · Lease end · Status · Records;
//   · a vacant space is a real row, labelled Vacant, contributing no lease;
//   · search and sort work on the rows the module itself exposes (listRows),
//     and the DOM order is that order;
//   · a row opens the existing TenantSpace file, now in ten sections;
//   · scoping cannot cross: one suite's records are in its file only, not in
//     another suite's, not in the property cabinet;
//   · a row with no identity says it cannot open, and offers nothing that would.
//
// Run: node test-e2e-spaces-list.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8964;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf' };

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); fail++; };
const sec = t => console.log('\n── ' + t + ' ──');
const is  = (got, want, label) => (JSON.stringify(got) === JSON.stringify(want))
  ? ok(label) : bad(label, `expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);

const MOCK = `window.supabase={createClient:function(){return {auth:{
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
      getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};`;

const YEAR = new Date().getFullYear();
const PROP = {
  id: 'prop-oak', name: 'Oak Row', totalSqft: 30000,
  tenants: [
    { id: 't1', tenant_name: 'Alder Dental',   suite: '100', leased_sqft: 4000, start_date: '2021-01-01', end_date: `${YEAR + 1}-01-31`, lease_type: 'NNN' },
    { id: 't2', tenant_name: 'Birch Books',    suite: '101', leased_sqft: 2500, end_date: `${YEAR}-12-31`, lease_type: 'Gross' },
    { id: 't3', tenant_name: 'Cedar Cafe',     suite: '12',  leased_sqft: 900,  end_date: `${YEAR + 3}-06-30`, lease_type: 'NNN' },
    { id: 't4', tenant_name: 'Vacant',         suite: '110', leased_sqft: 1500, vacant: true },
    { id: 't5', tenant_name: 'Dogwood Deli',   suite: '9',   leased_sqft: 600 },
    { id: null, tenant_name: 'Elm Optical',    suite: '102', leased_sqft: 1800 },   // no identity yet
  ],
  timeline: [
    { id: 'ev-1', manual: true, category: 'maintenance', type: 'manual_maintenance', title: 'HVAC filter change — Suite 100',
      timestamp: `${YEAR}-04-11T10:00:00Z`, subject: { type: 'suite', id: 't1', label: 'Alder Dental' },
      attachments: [{ name: 'invoice.pdf', url: 'https://x/i.pdf', kind: 'invoice' }] },
    { id: 'ev-2', manual: true, category: 'note', type: 'manual_note', title: 'Quarterly walkthrough — Suite 100',
      timestamp: `${YEAR}-03-02T10:00:00Z`, subject: { type: 'suite', id: 't1', label: 'Alder Dental' } },
    { id: 'ev-3', manual: true, category: 'note', type: 'manual_note', title: 'Signage request — Suite 101',
      timestamp: `${YEAR}-05-02T10:00:00Z`, tenantId: 't2' },
    { id: 'ev-4', manual: true, category: 'insurance', type: 'manual_insurance', title: 'Building policy renewed',
      timestamp: `${YEAR}-05-01T10:00:00Z`, subject: { type: 'property', id: 'prop-oak' } },
  ],
  invoices: [], disputes: [], activityLog: [],
  camReconciliation: { propId: 'prop-oak', camYear: YEAR, total: 10000, savedAt: `${YEAR}-04-02T12:00:00Z`,
    results: [{ tenantId: 't1', tenantName: 'Alder Dental', name: 'Alder Dental', allocatedAmount: 1234.5, variance: 0, status: 'ok' }] },
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
  const boot = async (viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',   r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(MOCK);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    return { ctx, page, errs };
  };
  const { ctx, page, errs } = await boot();

  // ══ A · the list ═══════════════════════════════════════════════════════════
  sec('A · one row per physical space');
  const A = await page.evaluate((prop) => {
    _props = [prop]; activePropId = prop.id;
    window.currentProperty = function () { return _props[0]; };
    PropertyOS.init();
    const ws = document.getElementById('mainWorkflow'); if (ws) ws.style.display = 'block';
    const pd = document.getElementById('portfolioDashboard'); if (pd) pd.style.display = 'none';
    switchWorkspaceTab('spaces');
    TenantSpace.renderList(prop);
    PropertyOS.renderPropertyPage(prop);
    const rows = Array.from(document.querySelectorAll('#spacesList .tsl-row')).map(r => ({
      suite: r.querySelector('.tsl-suite').textContent.trim(),
      tenant: Array.from(r.querySelectorAll('.tsl-tenant > span')).map(e => e.textContent.trim()).join(' '),
      sqft: r.querySelector('.tsl-sqft').textContent.trim(),
      end: r.querySelector('.tsl-end').textContent.trim(),
      status: r.querySelector('.tsl-badge').textContent.trim(),
      counts: r.querySelector('.tsl-counts').textContent.trim(),
      vacant: r.classList.contains('tsl-row--vacant'),
      open: !!r.querySelector('.tsl-open'), noopen: !!r.querySelector('.tsl-noopen'),
      clickable: r.classList.contains('tsl-row--open'),
    }));
    return { rows, summary: document.querySelector('#spacesList .tsl-summary').textContent,
             headers: Array.from(document.querySelectorAll('#spacesList th')).map(h => h.textContent.replace(/[↑↓]/g, '').trim()).filter(Boolean),
             cards: document.querySelectorAll('#spacesList .tsl-card').length };
  }, PROP);
  is(A.rows.length, 6, 'six rows for six spaces — the vacant one and the id-less one included');
  is(A.cards, 0, 'the card grid is gone');
  is(A.headers, ['Suite', 'Tenant', 'Sq ft', 'Lease end', 'Status', 'Records'], 'Suite · Tenant · Sq ft · Lease end · Status · Records');
  is(A.rows.map(r => r.suite), ['9', '12', '100', '101', '102', '110'], 'sorted by suite, numerically (9 before 12 before 100)');
  is(A.summary, '6 spaces · 5 occupied · 1 vacant · 9,800 sq ft leased', 'the summary counts occupied, vacant and leased area (the vacant 1,500 excluded)');
  const vac = A.rows.find(r => r.vacant);
  is(vac && vac.suite === '110' && vac.tenant === 'Vacant' && vac.status === 'Vacant' && vac.end === '—', true, 'the vacant space is a row: suite kept, labelled Vacant, no lease end');
  is(vac.sqft, '1,500', 'and keeps its area');
  is(A.rows.filter(r => r.status === 'Occupied').length, 5, 'five occupied');
  const alder = A.rows.find(r => r.suite === '100');
  is(alder.tenant.replace(/\s+/g, ' '), 'Alder Dental NNN', 'tenant name with lease type beneath');
  is(alder.sqft === '4,000' && /Jan 31/.test(alder.end), true, 'area and lease end read from the tenant row');
  is(alder.counts, '2 events · 1 invoice', 'records counted from the space’s own file (assemble)');
  is(A.rows.find(r => r.suite === '101').counts, '1 event', 'a bare tenantId record counts for its space');
  is(A.rows.find(r => r.suite === '12').counts, 'No records yet', 'and a space with nothing says so');
  const elm = A.rows.find(r => r.suite === '102');
  is(elm.noopen && !elm.open && !elm.clickable, true, 'the id-less space says it cannot open and offers no control that would');
  is(A.rows.filter(r => r.open).length, 5, 'every other row offers Open');

  // ══ B · search and sort ════════════════════════════════════════════════════
  sec('B · search and sort');
  const B = await page.evaluate(() => {
    const suites = () => Array.from(document.querySelectorAll('#spacesList .tsl-row .tsl-suite')).map(e => e.textContent.trim());
    TenantSpace.setListQuery('vac');   const vac = suites();
    TenantSpace.setListQuery('10');    const ten = suites();
    TenantSpace.setListQuery('birch'); const birch = suites();
    TenantSpace.setListQuery('zzz');   const none = suites(); const noneMsg = (document.querySelector('#spacesList .tsl-nomatch') || {}).textContent || '';
    TenantSpace.setListQuery('');      const all = suites();
    const searchVal = document.getElementById('tslSearch').value;
    TenantSpace.sortList('suite');     const desc = suites();      // second click flips
    TenantSpace.sortList('sqft');      const bySqft = suites();
    TenantSpace.sortList('leaseEnd');  const byEnd = suites();
    TenantSpace.sortList('status');    const byStatus = Array.from(document.querySelectorAll('#spacesList .tsl-row')).map(r => r.classList.contains('tsl-row--vacant'));
    TenantSpace.sortList('tenant');    const byTenant = Array.from(document.querySelectorAll('#spacesList .tsl-row .tsl-tenant')).map(e => e.textContent.trim().split(/\s/)[0]);
    const pure = TenantSpace.listRows(_props[0], { q: '', sort: 'tenant', dir: 1 }).map(r => (r.tenant || 'Vacant').split(/\s/)[0]);
    TenantSpace.sortList('suite');
    return { vac, ten, birch, none, noneMsg, all, searchVal, desc, bySqft, byEnd, byStatus, byTenant, pure };
  });
  is(B.vac, ['110'], '"vac" finds the vacant space');
  is(B.ten, ['100', '101', '102', '110'], '"10" matches suites by number');
  is(B.birch, ['101'], 'a tenant name finds its suite');
  is(B.none.length === 0 && /No spaces match/.test(B.noneMsg), true, 'no match says so, in words');
  is(B.all, ['9', '12', '100', '101', '102', '110'], 'clearing the search restores every row');
  is(B.searchVal, '', 'and the box reflects it');
  is(B.desc, ['110', '102', '101', '100', '12', '9'], 'clicking the sorted column again reverses it');
  is(B.bySqft, ['102', '9', '12', '110', '101', '100'], 'sort by area, ascending — the id-less space has no area on file, so it sorts first');
  is(B.byEnd.slice(0, 3), ['101', '100', '12'], 'sort by lease end — soonest first, spaces with no lease last');
  is(B.byStatus, [false, false, false, false, false, true], 'sort by status puts the vacant space last');
  is(B.byTenant, B.pure, 'the DOM order is exactly TenantSpace.listRows()’s order');

  // ══ C · the Space file ═════════════════════════════════════════════════════
  sec('C · a row opens the tenant file, in ten sections');
  const C = await page.evaluate(() => {
    const row = document.querySelector('#spacesList .tsl-row[data-space-id="t1"]');
    row.click();
    const ov = document.getElementById('tsOverlay');
    if (!ov) return { noOverlay: true };
    const secs = Array.from(ov.querySelectorAll('.ts-sec')).map(s => ({
      title: s.querySelector('.ts-sec-title').textContent, count: (s.querySelector('.ts-sec-count') || {}).textContent || null,
      text: s.textContent.replace(/\s+/g, ' ') }));
    const out = {
      head: ov.querySelector('.ts-space-name').textContent, titles: secs.map(s => s.title),
      history: secs.find(s => s.title === 'History'), invoices: secs.find(s => s.title === 'Invoices'),
      cam: secs.find(s => s.title === 'CAM'), stmt: secs.find(s => s.title === 'Statements'),
      hasViewRecon: !!ov.querySelector('#tsViewRecon'), stmtBtnInStatements: !!Array.from(ov.querySelectorAll('.ts-sec')).find(s => /Statements/.test(s.querySelector('.ts-sec-title').textContent) && s.querySelector('#tsTenantStmt')),
      leaseRows: ov.querySelectorAll('.ts-lease-row').length,
    };
    TenantSpace.closeSpace();
    return out;
  });
  if (C.noOverlay) bad('clicking a row opens the Space file');
  else {
    ok('clicking a row opens the Space file');
    is(/Alder Dental/.test(C.head) && /Suite 100/.test(C.head), true, 'named, with its suite');
    is(C.titles, ['Lease & Terms', 'Tenant Documents', 'CAM', 'Invoices', 'Statements', 'Disputes', 'Photos', 'Warranties', 'Notes', 'History'], 'the ten sections, in order');
    is(C.history.count, '2', 'History holds this suite’s two records');
    is(/HVAC filter change/.test(C.history.text) && /Quarterly walkthrough/.test(C.history.text), true, '…both of them');
    is(/Signage request/.test(C.history.text), false, 'and not the other suite’s');
    is(/Building policy renewed/.test(C.history.text), false, 'nor the property’s');
    is(C.invoices.count, '1', 'Invoices holds the invoice attached in this suite');
    is(/\$1,235/.test(C.cam.text) || /\$1,234/.test(C.cam.text), true, 'CAM shows this tenant’s allocation');
    is(C.hasViewRecon, true, 'with View Full Reconciliation');
    is(C.stmtBtnInStatements, true, 'Statements offers the tenant statement (generated in Reports)');
    is(C.leaseRows >= 3, true, 'Lease & Terms lists the lease terms');
  }
  const C2 = await page.evaluate(() => {
    document.querySelector('#spacesList .tsl-row[data-space-id="t2"] .tsl-open').click();
    const ov = document.getElementById('tsOverlay');
    const secs = {}; Array.from(ov.querySelectorAll('.ts-sec')).forEach(s => secs[s.querySelector('.ts-sec-title').textContent] = s.textContent.replace(/\s+/g, ' '));
    TenantSpace.closeSpace();
    document.querySelector('#spacesList .tsl-row[data-space-id="t4"] .tsl-open').click();
    const ov2 = document.getElementById('tsOverlay');
    const vac = { head: ov2.querySelector('.ts-space-name').textContent, badge: !!ov2.querySelector('.ts-vacant-badge'),
      lease: Array.from(ov2.querySelectorAll('.ts-sec')).find(s => /Lease/.test(s.querySelector('.ts-sec-title').textContent)).textContent };
    TenantSpace.closeSpace();
    return { secs, vac };
  });
  is(/Signage request/.test(C2.secs.History) && !/HVAC filter/.test(C2.secs.History), true, 'the other suite’s file holds only its own record');
  is(/No statement yet/.test(C2.secs.Statements), true, 'and, with no CAM result, says there is no statement yet');
  is(/No CAM activity yet/.test(C2.secs.CAM), true, 'and no CAM activity');
  is(/Vacant/.test(C2.vac.head) && /Suite 110/.test(C2.vac.head) && C2.vac.badge, true, 'a vacant space opens as a space file, headed Vacant — Suite 110');
  is(/no lease on file/i.test(C2.vac.lease), true, 'with no lease to show');

  // ══ D · scoping cannot cross into the cabinet ══════════════════════════════
  sec('D · the property cabinet holds none of the suites’ records');
  const D = await page.evaluate(() => {
    switchWorkspaceTab('property');
    PropertyCabinetView.openDrawer('history');
    const rows = Array.from(document.querySelectorAll('#propertyOsBody .pcv-arow')).map(r => r.dataset.recId);
    const cards = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec')).map(r => r.dataset.recId);
    PropertyCabinetView.openDrawer('insurance');
    const ins = Array.from(document.querySelectorAll('#propertyOsBody .pos-rec')).map(r => r.dataset.recId);
    PropertyCabinetView.closeDrawer();
    const snap = Array.from(document.querySelectorAll('.pcv-snap-cell')).map(c => c.querySelector('.pcv-snap-v').textContent.trim() + ' ' + c.querySelector('.pcv-snap-l').textContent.trim()).join(' · ');
    return { rows, cards, ins, snap };
  });
  is(D.rows, ['ev-4'], 'History lists the property record only');
  is(D.ins, ['ev-4'], 'Insurance holds it');
  is(D.cards.includes('ev-1') || D.cards.includes('ev-3'), false, 'no suite record leaked into a drawer');
  is(/6 Spaces · 5 Occupied · 1 Vacant/.test(D.snap), true, 'and the header counts the same six spaces, five occupied, one vacant');

  // ══ E · phone width ════════════════════════════════════════════════════════
  sec('E · the list fits a phone');
  const m = await boot({ width: 390, height: 900 });
  const E = await m.page.evaluate((prop) => {
    _props = [prop]; activePropId = prop.id;
    window.currentProperty = function () { return _props[0]; };
    PropertyOS.init();
    const ws = document.getElementById('mainWorkflow'); if (ws) ws.style.display = 'block';
    const pd = document.getElementById('portfolioDashboard'); if (pd) pd.style.display = 'none';
    switchWorkspaceTab('spaces');
    TenantSpace.renderList(prop);
    return { sideways: document.documentElement.scrollWidth > window.innerWidth + 2,
             rows: document.querySelectorAll('#spacesList .tsl-row').length };
  }, PROP);
  is(E.sideways, false, 'the Spaces tab does not scroll sideways at 390px');
  is(E.rows, 6, 'and still lists every space');
  await m.ctx.close();

  sec('page errors');
  const real = errs.filter(e => !/cdnjs|jsdelivr|fonts|Failed to fetch|supabase|ResizeObserver/i.test(e));
  real.length === 0 ? ok('no uncaught page errors') : bad('uncaught page errors', real.join('\n      '));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await ctx.close(); await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
